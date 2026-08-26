"""Config and options flows for H.I.L.D.A Multi List."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntry, OptionsFlowWithReload
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult

from .const import CONF_LISTS, DOMAIN


class HildaListManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for H.I.L.D.A Multi List."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Create the single H.I.L.D.A Multi List entry."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="H.I.L.D.A Multi List",
                data={},
                options={"lists": []},
            )

        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> HildaListManagerOptionsFlow:
        """Return the options flow."""
        return HildaListManagerOptionsFlow()


class HildaListManagerOptionsFlow(OptionsFlowWithReload):
    """Manage H.I.L.D.A-created To-do lists from the integration UI."""

    def __init__(self) -> None:
        """Initialize options flow."""
        self._selected_list_id: str | None = None

    def _lists(self) -> list[dict[str, Any]]:
        """Return a mutable copy of configured managed lists."""
        return deepcopy(list(self.config_entry.options.get(CONF_LISTS, [])))

    def _selected_definition(self) -> dict[str, Any] | None:
        """Return the selected list definition."""
        if self._selected_list_id is None:
            return None
        return next(
            (
                item
                for item in self._lists()
                if item.get("list_id") == self._selected_list_id
            ),
            None,
        )

    def _store(self):
        """Return the persistent list store for this config entry."""
        return self.hass.data.get(DOMAIN, {}).get(self.config_entry.entry_id)

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Choose a H.I.L.D.A list and management action."""
        lists = self._lists()

        if not lists:
            return self.async_abort(reason="no_managed_lists")

        choices = {
            item["list_id"]: item["name"]
            for item in lists
            if item.get("list_id") and item.get("name")
        }

        if user_input is not None:
            self._selected_list_id = user_input["list_id"]
            action = user_input["action"]
            if action == "rename":
                return await self.async_step_rename()
            return await self.async_step_delete()

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required("list_id"): vol.In(choices),
                    vol.Required("action", default="rename"): vol.In(
                        {
                            "rename": "Rename list",
                            "delete": "Delete list",
                        }
                    ),
                }
            ),
        )

    async def async_step_rename(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Rename a managed list while keeping its entity identity stable."""
        selected = self._selected_definition()
        if selected is None:
            return self.async_abort(reason="list_not_found")

        errors: dict[str, str] = {}

        if user_input is not None:
            new_name = user_input["name"].strip()

            if not new_name:
                errors["name"] = "name_required"
            else:
                lists = self._lists()

                if any(
                    item.get("list_id") != selected["list_id"]
                    and str(item.get("name", "")).casefold() == new_name.casefold()
                    for item in lists
                ):
                    errors["name"] = "duplicate_name"
                else:
                    for item in lists:
                        if item.get("list_id") == selected["list_id"]:
                            item["name"] = new_name
                            break

                    return self.async_create_entry(
                        title="",
                        data={**self.config_entry.options, CONF_LISTS: lists},
                    )

        return self.async_show_form(
            step_id="rename",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "name",
                        default=selected["name"],
                    ): str
                }
            ),
            errors=errors,
            description_placeholders={
                "current_name": selected["name"],
            },
        )

    async def async_step_delete(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Safely delete a H.I.L.D.A-managed list."""
        selected = self._selected_definition()
        if selected is None:
            return self.async_abort(reason="list_not_found")

        store = self._store()
        item_count = 0
        if store is not None:
            item_count = len(store.get_items(selected["list_id"]))

        errors: dict[str, str] = {}

        if user_input is not None:
            confirmation = user_input["confirm_name"].strip()

            if confirmation != selected["name"]:
                errors["confirm_name"] = "confirmation_mismatch"
            else:
                lists = [
                    item
                    for item in self._lists()
                    if item.get("list_id") != selected["list_id"]
                ]

                # Remove the backing item data only after the user typed
                # the exact list name, including when the list is non-empty.
                if store is not None:
                    stored_lists = store.data.setdefault("lists", {})
                    stored_lists.pop(selected["list_id"], None)
                    await store.async_save()

                return self.async_create_entry(
                    title="",
                    data={**self.config_entry.options, CONF_LISTS: lists},
                )

        return self.async_show_form(
            step_id="delete",
            data_schema=vol.Schema(
                {
                    vol.Required("confirm_name"): str,
                }
            ),
            errors=errors,
            description_placeholders={
                "name": selected["name"],
                "item_count": str(item_count),
            },
        )
