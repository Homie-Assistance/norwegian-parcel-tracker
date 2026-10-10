import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# Stub homeassistant and voluptuous so api.py can be imported without a full HA install
for mod in [
    "homeassistant",
    "homeassistant.components",
    "homeassistant.components.device_tracker",
    "homeassistant.config_entries",
    "homeassistant.core",
    "homeassistant.helpers",
    "homeassistant.helpers.config_validation",
    "homeassistant.helpers.aiohttp_client",
    "homeassistant.helpers.device_registry",
    "homeassistant.helpers.entity_platform",
    "homeassistant.helpers.selector",
    "homeassistant.helpers.storage",
    "homeassistant.util",
    "homeassistant.util.dt",
    "voluptuous",
]:
    sys.modules.setdefault(mod, MagicMock())

# DataUpdateCoordinator must be a real class (not a MagicMock instance) so that
# PostenTrackingCoordinator inherits from it correctly and becomes a real type.
class _StubDataUpdateCoordinator:
    def __class_getitem__(cls, item):
        return cls

    def __init__(self, hass=None, logger=None, *, name="", update_interval=None, config_entry=None):
        pass

    def async_update_listeners(self):
        pass


_stub_udc_module = types.ModuleType("homeassistant.helpers.update_coordinator")
_stub_udc_module.DataUpdateCoordinator = _StubDataUpdateCoordinator
_stub_udc_module.UpdateFailed = Exception
sys.modules["homeassistant.helpers.update_coordinator"] = _stub_udc_module

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))
