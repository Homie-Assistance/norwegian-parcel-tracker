import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

# Stub homeassistant and voluptuous so api.py can be imported without a full HA install
for mod in [
    "homeassistant",
    "homeassistant.config_entries",
    "homeassistant.core",
    "homeassistant.helpers",
    "homeassistant.helpers.config_validation",
    "homeassistant.helpers.aiohttp_client",
    "homeassistant.helpers.update_coordinator",
    "homeassistant.helpers.selector",
    "voluptuous",
]:
    sys.modules.setdefault(mod, MagicMock())

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))
