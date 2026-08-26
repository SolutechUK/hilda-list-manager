"""To-do platform for Hilda List Manager."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any
from uuid import uuid4

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_LISTS, DOMAIN
from . import HildaListStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Hilda-managed To-do entities."""
    store: HildaListStore = hass.data[DOMAIN][entry.entry_id]
    definitions = entry.options.get(CONF_LISTS, [])

    entities = [
        HildaTodoEntity(
            store=store,
            entry_id=entry.entry_id,
            list_id=item["list_id"],
            name=item["name"],
            object_id=item.get("object_id"),
        )
        for item in definitions
    ]

    async_add_entities(entities)


class HildaTodoEntity(TodoListEntity):
    """A local persistent To-do list managed by Hilda."""

    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
    )
    _attr_icon = "mdi:format-list-checks"

    def __init__(
        self,
        store: HildaListStore,
        entry_id: str,
        list_id: str,
        name: str,
        object_id: str | None,
    ) -> None:
        self._store = store
        self._list_id = list_id
        self._attr_name = name
        self._attr_unique_id = f"{entry_id}_{list_id}"
        if object_id:
            self._attr_suggested_object_id = object_id

    @property
    def todo_items(self) -> list[TodoItem]:
        """Return current items."""
        return [self._deserialize(raw) for raw in self._store.get_items(self._list_id)]

    def _deserialize(self, raw: dict[str, Any]) -> TodoItem:
        """Deserialize a stored item."""
        status_raw = raw.get("status", TodoItemStatus.NEEDS_ACTION)
        try:
            status = TodoItemStatus(status_raw)
        except ValueError:
            status = TodoItemStatus.NEEDS_ACTION

        return TodoItem(
            summary=raw.get("summary"),
            uid=raw.get("uid"),
            status=status,
        )

    def _serialize(self, item: TodoItem) -> dict[str, Any]:
        """Serialize the supported fields."""
        return {
            "summary": item.summary or "",
            "uid": item.uid or uuid4().hex,
            "status": str(item.status or TodoItemStatus.NEEDS_ACTION),
        }

    async def _save_and_refresh(self) -> None:
        """Persist then push entity/listener updates."""
        await self._store.async_save()
        self.async_write_ha_state()
        self.async_update_listeners()

    async def async_create_todo_item(self, item: TodoItem) -> None:
        """Create a new item."""
        if item.uid is None:
            item.uid = uuid4().hex
        if item.status is None:
            item.status = TodoItemStatus.NEEDS_ACTION
        self._store.get_items(self._list_id).append(self._serialize(item))
        await self._save_and_refresh()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        """Update an existing item."""
        if item.uid is None:
            return

        items = self._store.get_items(self._list_id)
        for index, raw in enumerate(items):
            if raw.get("uid") == item.uid:
                items[index] = self._serialize(item)
                await self._save_and_refresh()
                return

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        """Delete one or more items."""
        uid_set = set(uids)
        items = self._store.get_items(self._list_id)
        items[:] = [raw for raw in items if raw.get("uid") not in uid_set]
        await self._save_and_refresh()
