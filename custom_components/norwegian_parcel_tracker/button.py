from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_DISPLAY_NAME, DOMAIN
from .coordinator import PostenTrackingCoordinator
from .runtime_strings import _t


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: PostenTrackingCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([HomeDeliveryButton(coordinator, entry)])


class HomeDeliveryButton(CoordinatorEntity[PostenTrackingCoordinator], ButtonEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "order_home_delivery"
    _attr_icon = "mdi:home-import-outline"

    def __init__(self, coordinator: PostenTrackingCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self.entry = entry
        self._attr_unique_id = f"{entry.entry_id}_order_home_delivery"
        display_name = entry.data.get(CONF_DISPLAY_NAME) or coordinator.tracking_number
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": display_name,
            "manufacturer": "Posten / Bring",
            "model": "Parcel",
        }

    @property
    def available(self) -> bool:
        return bool(self.coordinator.data and self.coordinator.data.home_delivery_url)

    async def async_press(self) -> None:
        url = self.coordinator.data.home_delivery_url if self.coordinator.data else None
        if not url:
            return
        await self.hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": _t(self.hass, "home_delivery_title"),
                "message": _t(self.hass, "home_delivery_msg", url=url),
                "notification_id": f"home_delivery_{self.entry.entry_id}",
            },
        )

    @property
    def extra_state_attributes(self):
        return {"url": self.coordinator.data.home_delivery_url if self.coordinator.data else None}
