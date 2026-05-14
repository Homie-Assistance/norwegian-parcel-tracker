from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfLength, UnitOfMass
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_DISPLAY_NAME, DOMAIN, PICKUP_NOT_AVAILABLE_NO
from .coordinator import PostenTrackingCoordinator


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
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

    def __init__(self, coordinator: PostenTrackingCoordinator, entry: ConfigEntry, key: str, name: str) -> None:
        super().__init__(coordinator)
        self.entry = entry
        self._key = key
        self._attr_name = name
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
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "status", "Status")

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
        return attrs


class LatestEventSensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "latest_event", "Latest event")

    @property
    def native_value(self):
        latest = self.coordinator.data.latest_event if self.coordinator.data else None
        return latest.description if latest else None

    @property
    def extra_state_attributes(self):
        attrs = super().extra_state_attributes
        latest = self.coordinator.data.latest_event if self.coordinator.data else None
        if latest:
            attrs.update({"event_time": latest.date_iso, "event_location": latest.location})
        return attrs


class EstimatedDeliverySensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "estimated_delivery", "Estimated delivery")

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
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "pickup_point", "Pickup point")

    @property
    def native_value(self):
        data = self.coordinator.data
        if not data:
            return None
        return data.pickup_name or PICKUP_NOT_AVAILABLE_NO

    @property
    def extra_state_attributes(self):
        attrs = super().extra_state_attributes
        data = self.coordinator.data
        if data and data.pickup_name:
            attrs["pickup_url"] = data.pickup_url
        return attrs

    @property
    def icon(self): return "mdi:map-marker"


class SenderSensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "sender", "Sender")

    @property
    def native_value(self):
        return self.coordinator.data.sender_name if self.coordinator.data else None

    @property
    def icon(self): return "mdi:account-arrow-right"


class DeliveryMethodSensor(BaseParcelSensor):
    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "delivery_method", "Delivery method")

    @property
    def native_value(self):
        data = self.coordinator.data
        return data.delivery_method or data.product_name if data else None

    @property
    def icon(self): return "mdi:truck-delivery"


class ParcelWeightSensor(BaseParcelSensor):
    _attr_native_unit_of_measurement = UnitOfMass.KILOGRAMS

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "weight", "Weight")

    @property
    def native_value(self): return self.coordinator.data.weight_kg if self.coordinator.data else None

    @property
    def icon(self): return "mdi:weight-kilogram"


class ParcelLengthSensor(BaseParcelSensor):
    _attr_native_unit_of_measurement = UnitOfLength.CENTIMETERS

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "length", "Length")

    @property
    def native_value(self): return self.coordinator.data.length_cm if self.coordinator.data else None


class ParcelWidthSensor(BaseParcelSensor):
    _attr_native_unit_of_measurement = UnitOfLength.CENTIMETERS

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "width", "Width")

    @property
    def native_value(self): return self.coordinator.data.width_cm if self.coordinator.data else None


class ParcelHeightSensor(BaseParcelSensor):
    _attr_native_unit_of_measurement = UnitOfLength.CENTIMETERS

    def __init__(self, coordinator, entry): super().__init__(coordinator, entry, "height", "Height")

    @property
    def native_value(self): return self.coordinator.data.height_cm if self.coordinator.data else None
