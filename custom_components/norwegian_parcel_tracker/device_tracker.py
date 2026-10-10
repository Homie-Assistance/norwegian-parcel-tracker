from __future__ import annotations

from homeassistant.components.device_tracker import SourceType, TrackerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_ENTRY_TYPE, DOMAIN, ENTRY_TYPE_EMAIL_WATCHER, ENTRY_TYPE_GLOBAL
from .coordinator import PostenTrackingCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    entry_type = entry.data.get(CONF_ENTRY_TYPE)
    if entry_type in (ENTRY_TYPE_GLOBAL, ENTRY_TYPE_EMAIL_WATCHER):
        return

    coordinator: PostenTrackingCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([ParcelTrackerEntity(coordinator, entry)])


class ParcelTrackerEntity(CoordinatorEntity[PostenTrackingCoordinator], TrackerEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "location"

    def __init__(
        self,
        coordinator: PostenTrackingCoordinator,
        entry: ConfigEntry,
    ) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_location"

    @property
    def source_type(self) -> SourceType:
        return SourceType.GPS

    @property
    def latitude(self) -> float | None:
        return self.coordinator._location_coords[0] if self.coordinator._location_coords else None

    @property
    def longitude(self) -> float | None:
        return self.coordinator._location_coords[1] if self.coordinator._location_coords else None

    @property
    def location_accuracy(self) -> int:
        return 5000  # postal-code resolution, roughly 5 km

    @property
    def location_name(self) -> str | None:
        parcel = self.coordinator.data
        if not parcel:
            return None
        latest = parcel.latest_event
        return latest.location if latest else None

    @property
    def device_info(self):  # type: ignore[override]
        from homeassistant.helpers.device_registry import DeviceInfo
        parcel = self.coordinator.data
        name = (parcel.sender_name if parcel else None) or self.coordinator.tracking_number
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=name,
        )
