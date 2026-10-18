"""Tests for ParcelMetaStore — per-parcel note/icon/display_name storage."""
import pytest
from custom_components.norwegian_parcel_tracker.event_history import ParcelMetaStore


class FakeMetaStore:
    """Synchronous stand-in for homeassistant.helpers.storage.Store."""

    def __init__(self):
        self._data = None

    async def async_load(self):
        return self._data

    def async_delay_save(self, callback, delay):
        self._data = callback()

    async def async_remove(self):
        self._data = None


def _make_meta() -> ParcelMetaStore:
    meta = ParcelMetaStore.__new__(ParcelMetaStore)
    meta._store = FakeMetaStore()
    meta._data = {}
    return meta


# ── get: unknown key returns empty dict ───────────────────────────────────────

def test_get_unknown_returns_empty():
    m = _make_meta()
    assert m.get("ABC123") == {}


# ── set/get round-trip ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_note_roundtrip():
    m = _make_meta()
    await m.async_set("abc123", note="test note")
    assert m.get("abc123")["note"] == "test note"


@pytest.mark.asyncio
async def test_set_icon_roundtrip():
    m = _make_meta()
    await m.async_set("abc123", npt_icon="mdi:gift")
    assert m.get("abc123")["npt_icon"] == "mdi:gift"


# ── keys are uppercased ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_key_normalization():
    m = _make_meta()
    await m.async_set("abc123", note="hi")
    assert m.get("ABC123")["note"] == "hi"
    assert m.get("Abc123")["note"] == "hi"


# ── set with None removes the field ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_none_removes_field():
    m = _make_meta()
    await m.async_set("abc123", note="existing")
    await m.async_set("abc123", note=None)
    assert "note" not in m.get("abc123")


# ── set preserves unrelated fields ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_preserves_other_fields():
    m = _make_meta()
    await m.async_set("abc123", note="n", npt_icon="mdi:box")
    await m.async_set("abc123", note="updated")
    data = m.get("abc123")
    assert data["note"] == "updated"
    assert data["npt_icon"] == "mdi:box"


# ── clear_field removes one field, keeps others ───────────────────────────────

@pytest.mark.asyncio
async def test_clear_field():
    m = _make_meta()
    await m.async_set("abc123", note="n", npt_icon="mdi:box")
    await m.async_clear_field("abc123", "note")
    data = m.get("abc123")
    assert "note" not in data
    assert data["npt_icon"] == "mdi:box"


@pytest.mark.asyncio
async def test_clear_field_unknown_field_is_noop():
    m = _make_meta()
    await m.async_set("abc123", note="n")
    await m.async_clear_field("abc123", "nonexistent")
    assert m.get("abc123")["note"] == "n"


# ── clear removes the whole entry ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_clear_removes_entry():
    m = _make_meta()
    await m.async_set("abc123", note="n", npt_icon="mdi:box")
    await m.async_clear("abc123")
    assert m.get("abc123") == {}


@pytest.mark.asyncio
async def test_clear_unknown_is_noop():
    m = _make_meta()
    await m.async_clear("not_there")
    assert m.get("not_there") == {}


# ── persistence: async_load restores saved state ─────────────────────────────

@pytest.mark.asyncio
async def test_load_restores_state():
    m = _make_meta()
    await m.async_set("abc123", note="persisted")

    m2 = _make_meta()
    m2._store = m._store
    await m2.async_load()
    assert m2.get("abc123")["note"] == "persisted"


@pytest.mark.asyncio
async def test_load_empty_store_is_safe():
    m = _make_meta()
    await m.async_load()
    assert m.get("abc123") == {}
