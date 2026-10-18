from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfLength, UnitOfMass
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    CARRIER_HELTHJEM,
    CARRIER_POSTEN,
    CONF_DISPLAY_NAME,
    CONF_ENTRY_TYPE,
    DOMAIN,
    ENTRY_TYPE_GLOBAL,
)
from .coordinator import PostenTrackingCoordinator
from .event_history import DeliveryStatsStore
from .runtime_strings import _t

STATS_UPDATED_SIGNAL = f"{DOMAIN}_stats_updated"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    if entry.data.get(CONF_ENTRY_TYPE) == ENTRY_TYPE_GLOBAL:
        stats: DeliveryStatsStore = hass.data[DOMAIN].get("_stats") or DeliveryStatsStore(hass)
        hass.data[DOMAIN].setdefault("_stats", stats)
        entities = []
        for carrier, carrier_label in ((CARRIER_POSTEN, "Posten"), (CARRIER_HELTHJEM, "Helthjem")):
            for stat in ("avg", "min", "max", "count"):
                entities.append(DeliveryStatsSensor(hass, stats, carrier, carrier_label, stat))
        async_add_entities(entities)
        return

    coordinator: PostenTrackingCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            ParcelStatusSensor(coordinator, entry),
            LatestEventSensor(coordinator, entry),
            EstimatedDeliverySensor(coordinator, entry),
            PickupPointSensor(coordinator, entry),
            SenderSensor(coordinator, entry),
            DeliveryMethodSensor(coordinator, entry),
            ParcelWeightSensor(coordinator, entry),
            ParcelLengthSensor(coordinator, entry),
            ParcelWidthSensor(coordinator, entry),
            ParcelHeightSensor(coordinator, entry),
        ]
    )


class BaseParcelSensor(CoordinatorEntity[PostenTrackingCoordinator], SensorEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator: PostenTrackingCoordinator, entry: ConfigEntry, key: str) -> None:
        super().__init__(coordinator)
        self.entry = entry
        self._key = key
        self._attr_translation_key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        display_name = entry.data.get(CONF_DISPLAY_NAME) or coordinator.tracking_number
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": display_name,
            "manufacturer": "Posten / Bring",
            "model": "Parcel",
            "entry_type": "service",
        }

    @property
    def icon(self) -> str:
        return "mdi:package-variant-closed"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"parcel_tracker_entity": self._key}


class ParcelStatusSensor(BaseParcelSensor):
    _unrecorded_attributes = frozenset({"recent_events", "route_coords"})

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "status")

    @property
    def native_value(self):
        data = self.coordinator.data
        return data.status_description or data.current_status or data.status if data else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        if not self.coordinator.data:
            return {}
        attrs = self.coordinator.data.as_dict()
        attrs["parcel_tracker_entity"] = self._key
        attrs["npt_master_entity"] = True
        attrs["refreshing"] = self.coordinator._refreshing
        attrs.update(self.coordinator.fits_attributes)
        attrs["recent_events"] = self.coordinator._history.recent(10)
        if self.coordinator._route_coords:
            attrs["route_coords"] = self.coordinator._route_coords
        meta_store = self.hass.data.get(DOMAIN, {}).get("_meta")
        if meta_store:
            meta = meta_store.get(self.coordinator.tracking_number)
            if meta.get("note"):
                attrs["note"] = meta["note"]
            if meta.get("notes"):
                attrs["notes"] = meta["notes"]
            if meta.get("npt_icon"):
                attrs["npt_icon"] = meta["npt_icon"]
            if meta.get("display_name"):
                attrs["display_name"] = meta["display_name"]
        return attrs


class LatestEventSensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "latest_event")

    @property
    def native_value(self):
        latest = self.coordinator.data.latest_event if self.coordinator.data else None
        return latest.description if latest else None

    @property
    def extra_state_attributes(self):
        attrs = {"parcel_tracker_entity": self._key}
        latest = self.coordinator.data.latest_event if self.coordinator.data else None
        if latest:
            attrs.update({"event_time": latest.date_iso, "event_location": latest.location})
        return attrs


class EstimatedDeliverySensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "estimated_delivery")

    @property
    def native_value(self):
        data = self.coordinator.data
        if not data:
            return None
        value = data.estimated_delivery_iso or data.estimated_delivery
        if value in ("estimatedTimeSpanOfDelivery", "EstimatedTimeSpanOfDelivery"):
            return None
        return value

    @property
    def icon(self): return "mdi:calendar"


class PickupPointSensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "pickup_point")

    @property
    def native_value(self):
        data = self.coordinator.data
        if not data:
            return None
        return data.pickup_name or _t(self.hass, "pickup_not_available")

    @property
    def extra_state_attributes(self):
        attrs = {"parcel_tracker_entity": self._key}
        data = self.coordinator.data
        if data and data.pickup_name:
            attrs["pickup_url"] = data.pickup_url
        return attrs

    @property
    def icon(self): return "mdi:map-marker"


class SenderSensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "sender")

    @property
    def native_value(self):
        return self.coordinator.data.sender_name if self.coordinator.data else None

    @property
    def icon(self): return "mdi:account-arrow-right"


class DeliveryMethodSensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "delivery_method")

    @property
    def native_value(self):
        data = self.coordinator.data
        return data.delivery_method or data.product_name if data else None

    @property
    def icon(self): return "mdi:truck-delivery"


class ParcelWeightSensor(BaseParcelSensor):
    _attr_native_unit_of_measurement = UnitOfMass.KILOGRAMS

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "weight")

    @property
    def native_value(self): return self.coordinator.data.weight_kg if self.coordinator.data else None

    @property
    def icon(self): return "mdi:weight-kilogram"


class ParcelLengthSensor(BaseParcelSensor):
    _attr_native_unit_of_measurement = UnitOfLength.CENTIMETERS

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "length")

    @property
    def native_value(self): return self.coordinator.data.length_cm if self.coordinator.data else None


class ParcelWidthSensor(BaseParcelSensor):
    _attr_native_unit_of_measurement = UnitOfLength.CENTIMETERS

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "width")

    @property
    def native_value(self): return self.coordinator.data.width_cm if self.coordinator.data else None


class ParcelHeightSensor(BaseParcelSensor):
    _attr_native_unit_of_measurement = UnitOfLength.CENTIMETERS

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "height")


def _transit_days(record: dict[str, Any]) -> float | None:
    try:
        t0 = datetime.fromisoformat(record["first_event_time"])
        t1 = datetime.fromisoformat(record["delivered_time"])
        if t0.tzinfo is None:
            t0 = t0.replace(tzinfo=timezone.utc)
        if t1.tzinfo is None:
            t1 = t1.replace(tzinfo=timezone.utc)
        delta = (t1 - t0).total_seconds() / 86400
        return round(delta, 1) if delta >= 0 else None
    except (KeyError, TypeError, ValueError):
        return None


class DeliveryStatsSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "d"
    _attr_icon = "mdi:chart-bar"

    def __init__(
        self,
        hass: HomeAssistant,
        store: DeliveryStatsStore,
        carrier: str,
        carrier_label: str,
        stat: str,
    ) -> None:
        self._hass = hass
        self._store = store
        self._carrier = carrier
        self._stat = stat
        self._attr_unique_id = f"npt_stats_{carrier}_{stat}"
        self._attr_translation_key = f"stats_{stat}"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"stats_{carrier}")},
            "name": f"{carrier_label} delivery statistics",
            "manufacturer": carrier_label,
            "model": "Delivery statistics",
            "entry_type": "service",
        }
        if stat == "count":
            self._attr_native_unit_of_measurement = None
            self._attr_state_class = SensorStateClass.TOTAL_INCREASING
            self._attr_icon = "mdi:counter"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self._hass, STATS_UPDATED_SIGNAL, self._handle_stats_update)
        )

    @callback
    def _handle_stats_update(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self) -> float | int | None:
        records = [r for r in self._store.get_records() if r.get("carrier") == self._carrier]
        if not records:
            return None
        if self._stat == "count":
            return len(records)
        days = [d for d in (_transit_days(r) for r in records) if d is not None]
        if not days:
            return None
        if self._stat == "avg":
            return round(sum(days) / len(days), 1)
        if self._stat == "min":
            return min(days)
        if self._stat == "max":
            return max(days)
        return None
