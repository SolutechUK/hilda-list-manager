"""Hilda List Manager integration."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

import voluptuous as vol

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import LOVELACE_DATA, MODE_STORAGE
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.script import Script
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import slugify, dt as dt_util

from .const import (
    CONF_LISTS,
    DOMAIN,
    SERVICE_CREATE_LIST,
    STORAGE_KEY,
    STORAGE_VERSION,
)

PLATFORMS: list[Platform] = [Platform.TODO]

CREATE_LIST_SCHEMA = vol.Schema(
    {
        vol.Required("name"): vol.All(cv.string, vol.Length(min=1, max=80)),
    }
)

EXECUTE_ACTIONS_SERVICE = "execute_actions"
EXECUTE_ACTIONS_SCHEMA = vol.Schema(
    {
        vol.Required("actions"): list,
    }
)

SEND_LIST_SERVICE = "send_list"
SEND_LIST_SCHEMA = vol.Schema(
    {
        vol.Required("list_entity"): cv.entity_id,
        vol.Required("destination_type"): vol.In(["notify", "rest_command"]),
        vol.Required("destination"): cv.string,
        vol.Optional("heading"): cv.string,
    }
)

SET_ZONE_RULE_SERVICE = "set_zone_rule"
CLEAR_ZONE_RULE_SERVICE = "clear_zone_rule"

CARD_RESOURCE_BASE = "/hilda_list_manager/multi-list-card.js"
CARD_RESOURCE_URL = f"{CARD_RESOURCE_BASE}?v=0.4.0-beta.7"
CARD_RESOURCE_TYPE = "module"

SET_ZONE_RULE_SCHEMA = vol.Schema(
    {
        vol.Required("list_entity"): cv.entity_id,
        vol.Required("person_entity"): cv.entity_id,
        vol.Required("zone_entity"): cv.entity_id,
        vol.Required("event"): vol.In(["enter", "leave"]),
        vol.Required("destination_type"): vol.In(["notify", "rest_command"]),
        vol.Required("destination"): cv.string,
        vol.Optional("heading"): cv.string,
        vol.Optional("cooldown_minutes", default=10): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=1440)
        ),
    }
)

CLEAR_ZONE_RULE_SCHEMA = vol.Schema(
    {
        vol.Required("list_entity"): cv.entity_id,
    }
)


class HildaListStore:
    """Persistent item store for Hilda-managed To-do lists."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store[dict[str, Any]](
            hass, STORAGE_VERSION, STORAGE_KEY
        )
        self.data: dict[str, Any] = {"lists": {}, "zone_rules": {}}

    async def async_load(self) -> None:
        """Load stored items."""
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            self.data = loaded
        self.data.setdefault("lists", {})
        self.data.setdefault("zone_rules", {})

    async def async_save(self) -> None:
        """Persist current data."""
        await self.store.async_save(self.data)

    def get_items(self, list_id: str) -> list[dict[str, Any]]:
        """Return serialized items for a list."""
        lists = self.data.setdefault("lists", {})
        entry = lists.setdefault(list_id, {"items": []})
        return entry.setdefault("items", [])

    async def async_ensure_list(self, list_id: str) -> None:
        """Ensure backing storage exists for a list."""
        self.get_items(list_id)
        await self.async_save()



def _zone_person_state(hass: HomeAssistant, zone_entity: str) -> str | None:
    """Return the person-state value that represents being inside a zone."""
    if zone_entity == "zone.home":
        return "home"

    zone_state = hass.states.get(zone_entity)
    if zone_state is None:
        return None

    return str(zone_state.attributes.get("friendly_name") or zone_entity.split(".", 1)[1])


async def _format_list_message(
    hass: HomeAssistant,
    list_entity: str,
    heading: str,
) -> str:
    """Build a message from the pending items in a To-do list."""
    response = await hass.services.async_call(
        "todo",
        "get_items",
        {"status": ["needs_action"]},
        target={"entity_id": list_entity},
        blocking=True,
        return_response=True,
    )

    items = []
    if isinstance(response, dict):
        block = response.get(list_entity, {})
        items = block.get("items", []) if isinstance(block, dict) else []

    pending = [
        str(item.get("summary", "")).strip()
        for item in items
        if isinstance(item, dict) and str(item.get("summary", "")).strip()
    ]

    if pending:
        return heading + ":\n" + "\n".join(f"- {item}" for item in pending)

    return heading + ":\nNothing on the list right now."


async def _send_message(
    hass: HomeAssistant,
    destination_type: str,
    destination: str,
    message: str,
) -> None:
    """Send a prepared message to a supported destination."""
    if destination_type == "notify":
        await hass.services.async_call(
            "notify",
            "send_message",
            {"message": message},
            target={"entity_id": destination},
            blocking=True,
        )
        return

    service = destination
    if service.startswith("rest_command."):
        service = service.split(".", 1)[1]

    await hass.services.async_call(
        "rest_command",
        service,
        {"message": message},
        blocking=True,
    )


class ZoneRuleManager:
    """Manage persistent zone-send rules."""

    def __init__(self, hass: HomeAssistant, store: HildaListStore) -> None:
        self.hass = hass
        self.store = store
        self._unsubs: list[Any] = []
        self._last_sent: dict[str, Any] = {}

    def unload(self) -> None:
        """Remove all listeners."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()

    def refresh(self) -> None:
        """Rebuild listeners from persisted rules."""
        self.unload()
        rules = self.store.data.setdefault("zone_rules", {})

        people = sorted(
            {
                rule.get("person_entity")
                for rule in rules.values()
                if isinstance(rule, dict) and rule.get("person_entity")
            }
        )

        if not people:
            return

        self._unsubs.append(
            async_track_state_change_event(
                self.hass,
                people,
                self._handle_person_state,
            )
        )

    @callback
    def _handle_person_state(self, event) -> None:
        """Schedule matching zone-send rules after a person state change."""
        old_state = event.data.get("old_state")
        new_state = event.data.get("new_state")

        if old_state is None or new_state is None:
            return
        if old_state.state == new_state.state:
            return

        person_entity = new_state.entity_id
        rules = self.store.data.setdefault("zone_rules", {})

        for list_entity, rule in rules.items():
            if not isinstance(rule, dict):
                continue
            if rule.get("person_entity") != person_entity:
                continue

            zone_entity = rule.get("zone_entity")
            target_state = _zone_person_state(self.hass, zone_entity)
            if target_state is None:
                continue

            entered = old_state.state != target_state and new_state.state == target_state
            left = old_state.state == target_state and new_state.state != target_state

            desired = rule.get("event")
            matched = (desired == "enter" and entered) or (desired == "leave" and left)

            if matched:
                self.hass.async_create_task(
                    self._run_rule(list_entity, rule)
                )

    async def _run_rule(self, list_entity: str, rule: dict[str, Any]) -> None:
        """Execute a matching rule with cooldown protection."""
        now = dt_util.utcnow()
        cooldown = int(rule.get("cooldown_minutes", 10) or 0)

        last = self._last_sent.get(list_entity)
        if last is not None and cooldown > 0:
            elapsed = (now - last).total_seconds()
            if elapsed < cooldown * 60:
                return

        heading = rule.get("heading") or self.hass.states.get(list_entity, {}).attributes.get("friendly_name", "H.I.L.D.A List") if self.hass.states.get(list_entity) else "H.I.L.D.A List"

        message = await _format_list_message(
            self.hass,
            list_entity,
            heading,
        )

        await _send_message(
            self.hass,
            rule["destination_type"],
            rule["destination"],
            message,
        )

        self._last_sent[list_entity] = now


async def _async_register_card_resource(hass: HomeAssistant) -> None:
    """Register or update the H.I.L.D.A dashboard card module."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    if lovelace_data is None:
        return

    resources = lovelace_data.resources

    if lovelace_data.resource_mode == MODE_STORAGE:
        await resources.async_get_info()
        existing = next(
            (
                item
                for item in resources.async_items()
                if str(item.get("url", "")).startswith(CARD_RESOURCE_BASE)
            ),
            None,
        )

        if existing is None:
            await resources.async_create_item(
                {"res_type": CARD_RESOURCE_TYPE, "url": CARD_RESOURCE_URL}
            )
        elif (
            existing.get("url") != CARD_RESOURCE_URL
            or existing.get("type") != CARD_RESOURCE_TYPE
        ):
            await resources.async_update_item(
                existing["id"],
                {"res_type": CARD_RESOURCE_TYPE, "url": CARD_RESOURCE_URL},
            )
        return

    frontend.add_extra_js_url(hass, CARD_RESOURCE_URL)


async def _async_remove_card_resource(hass: HomeAssistant) -> None:
    """Remove H.I.L.D.A's frontend registration when the integration is deleted."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    if lovelace_data is None:
        return

    resources = lovelace_data.resources

    if lovelace_data.resource_mode == MODE_STORAGE:
        await resources.async_get_info()
        for item in list(resources.async_items()):
            if str(item.get("url", "")).startswith(CARD_RESOURCE_BASE):
                await resources.async_delete_item(item["id"])
        return

    frontend.remove_extra_js_url(hass, CARD_RESOURCE_URL)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up H.I.L.D.A Multi List."""
    if entry.title != "H.I.L.D.A Multi List":
        hass.config_entries.async_update_entry(entry, title="H.I.L.D.A Multi List")

    domain_data = hass.data.setdefault(DOMAIN, {})

    store = HildaListStore(hass)
    await store.async_load()
    domain_data[entry.entry_id] = store

    zone_manager = ZoneRuleManager(hass, store)
    domain_data[f"{entry.entry_id}_zone_manager"] = zone_manager
    zone_manager.refresh()

    frontend_dir = Path(__file__).parent / "frontend"
    if not domain_data.get("_static_registered"):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    "/hilda_list_manager",
                    str(frontend_dir),
                    cache_headers=False,
                )
            ]
        )
        domain_data["_static_registered"] = True

    await _async_register_card_resource(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    if not hass.services.has_service(DOMAIN, SERVICE_CREATE_LIST):

        async def async_create_list(call: ServiceCall) -> ServiceResponse:
            """Create a new Hilda-managed To-do list."""
            name = call.data["name"].strip()

            current_entry = next(iter(hass.config_entries.async_entries(DOMAIN)), None)

            if current_entry is None:
                return {"success": False, "error": "integration_not_configured"}

            lists = list(current_entry.options.get(CONF_LISTS, []))

            if any(str(item.get("name", "")).casefold() == name.casefold() for item in lists):
                return {"success": False, "error": "duplicate_name", "name": name}

            list_id = uuid4().hex
            object_id = f"hilda_{slugify(name)}"

            lists.append(
                {
                    "list_id": list_id,
                    "name": name,
                    "object_id": object_id,
                }
            )

            await store.async_ensure_list(list_id)

            hass.config_entries.async_update_entry(
                current_entry,
                options={**current_entry.options, CONF_LISTS: lists},
            )

            # Reload creates the new todo entity immediately.
            await hass.config_entries.async_reload(current_entry.entry_id)

            return {
                "success": True,
                "list_id": list_id,
                "name": name,
                "expected_entity_id": f"todo.{object_id}",
            }

        hass.services.async_register(
            DOMAIN,
            SERVICE_CREATE_LIST,
            async_create_list,
            schema=CREATE_LIST_SCHEMA,
            supports_response=SupportsResponse.OPTIONAL,
        )

    if not hass.services.has_service(DOMAIN, EXECUTE_ACTIONS_SERVICE):

        async def async_execute_actions(call: ServiceCall) -> None:
            """Execute a Home Assistant action sequence selected by the card editor."""
            actions = call.data["actions"]
            runner = Script(
                hass,
                actions,
                "H.I.L.D.A Multi List send action",
                DOMAIN,
            )
            await runner.async_run()

        hass.services.async_register(
            DOMAIN,
            EXECUTE_ACTIONS_SERVICE,
            async_execute_actions,
            schema=EXECUTE_ACTIONS_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SEND_LIST_SERVICE):

        async def async_send_list(call: ServiceCall) -> None:
            """Format the pending items from a To-do list and send them."""
            list_entity = call.data["list_entity"]
            destination_type = call.data["destination_type"]
            destination = call.data["destination"]
            heading = call.data.get("heading") or "H.I.L.D.A List"

            message = await _format_list_message(
                hass,
                list_entity,
                heading,
            )

            await _send_message(
                hass,
                destination_type,
                destination,
                message,
            )

        hass.services.async_register(
            DOMAIN,
            SEND_LIST_SERVICE,
            async_send_list,
            schema=SEND_LIST_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SET_ZONE_RULE_SERVICE):

        async def async_set_zone_rule(call: ServiceCall) -> None:
            """Create or replace a zone-send rule for a list."""
            rule = {
                "person_entity": call.data["person_entity"],
                "zone_entity": call.data["zone_entity"],
                "event": call.data["event"],
                "destination_type": call.data["destination_type"],
                "destination": call.data["destination"],
                "heading": call.data.get("heading"),
                "cooldown_minutes": call.data.get("cooldown_minutes", 10),
            }

            store.data.setdefault("zone_rules", {})[call.data["list_entity"]] = rule
            await store.async_save()
            zone_manager.refresh()

        hass.services.async_register(
            DOMAIN,
            SET_ZONE_RULE_SERVICE,
            async_set_zone_rule,
            schema=SET_ZONE_RULE_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, CLEAR_ZONE_RULE_SERVICE):

        async def async_clear_zone_rule(call: ServiceCall) -> None:
            """Remove a zone-send rule for a list."""
            store.data.setdefault("zone_rules", {}).pop(call.data["list_entity"], None)
            await store.async_save()
            zone_manager.refresh()

        hass.services.async_register(
            DOMAIN,
            CLEAR_ZONE_RULE_SERVICE,
            async_clear_zone_rule,
            schema=CLEAR_ZONE_RULE_SCHEMA,
        )

    return True



async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Clean up the automatically registered dashboard resource."""
    await _async_remove_card_resource(hass)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Hilda List Manager."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        domain_data = hass.data.get(DOMAIN, {})
        manager = domain_data.pop(f"{entry.entry_id}_zone_manager", None)
        if manager is not None:
            manager.unload()
        domain_data.pop(entry.entry_id, None)
    return unloaded
