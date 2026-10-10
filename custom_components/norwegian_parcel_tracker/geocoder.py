from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

_STORE_KEY = "norwegian_parcel_tracker_geocache"
_RATE_LIMIT = 1.1  # seconds between Nominatim requests (policy: ≤1 req/s)
_USER_AGENT = (
    "norwegian-parcel-tracker/1.3 "
    "(github.com/Homie-Assistance/norwegian-parcel-tracker)"
)

# Module-level rate-limit state shared across all coordinators / HA instances.
_nominatim_lock: asyncio.Lock | None = None
_nominatim_last: float = 0.0


def _get_lock() -> asyncio.Lock:
    global _nominatim_lock
    if _nominatim_lock is None:
        _nominatim_lock = asyncio.Lock()
    return _nominatim_lock


class NominatimGeocoder:
    """Geocodes postal-code/city pairs via Nominatim with persistent caching."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, 1, _STORE_KEY, atomic_writes=True)
        self._cache: dict[str, tuple[float, float] | None] = {}
        self._loaded = False
        self._hass = hass

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        raw: dict[str, Any] = data.get("cache", {})
        self._cache = {
            k: tuple(v) if v is not None else None  # type: ignore[misc]
            for k, v in raw.items()
        }
        self._loaded = True

    async def geocode(
        self,
        postal_code: str | None,
        city: str | None,
        country: str = "NO",
    ) -> tuple[float, float] | None:
        if not postal_code and not city:
            return None
        if not self._loaded:
            await self.async_load()

        key = f"{country}|{postal_code or ''}|{city or ''}".lower()
        if key in self._cache:
            return self._cache[key]

        coords = await self._fetch(postal_code, city, country)
        self._cache[key] = coords
        await self._store.async_delay_save(
            lambda: {"cache": {k: list(v) if v else None for k, v in self._cache.items()}},
            30,
        )
        return coords

    async def _fetch(
        self,
        postal_code: str | None,
        city: str | None,
        country: str,
    ) -> tuple[float, float] | None:
        global _nominatim_last
        lock = _get_lock()
        async with lock:
            now = time.monotonic()
            wait = _RATE_LIMIT - (now - _nominatim_last)
            if wait > 0:
                await asyncio.sleep(wait)
            _nominatim_last = time.monotonic()

        from homeassistant.helpers.aiohttp_client import async_get_clientsession

        session = async_get_clientsession(self._hass)
        params: dict[str, str] = {"format": "json", "limit": "1", "country": country}
        if postal_code:
            params["postalcode"] = postal_code
        if city:
            params["city"] = city

        try:
            async with session.get(
                "https://nominatim.openstreetmap.org/search",
                params=params,
                headers={"User-Agent": _USER_AGENT},
                timeout=10,
            ) as resp:
                if resp.status != 200:
                    _LOGGER.debug("Nominatim returned %s for %s/%s", resp.status, postal_code, city)
                    return None
                data = await resp.json(content_type=None)
                if not data:
                    return None
                return float(data[0]["lat"]), float(data[0]["lon"])
        except Exception as exc:
            _LOGGER.debug("Nominatim geocode failed for %s/%s: %s", postal_code, city, exc)
            return None
