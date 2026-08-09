"""Email watcher: polls an IMAP mailbox and auto-adds parcel tracking numbers."""
from __future__ import annotations

import email as email_lib
import html as html_module
import imaplib
import logging
import re
from datetime import datetime, timedelta
from email.header import decode_header, make_header
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_EMAIL_DAYS_BACK,
    CONF_EMAIL_FOLDER,
    CONF_EMAIL_PASSWORD,
    CONF_EMAIL_POLL_INTERVAL_MINUTES,
    CONF_EMAIL_PORT,
    CONF_EMAIL_SERVER,
    CONF_EMAIL_USERNAME,
    DEFAULT_EMAIL_DAYS_BACK,
    DEFAULT_EMAIL_FOLDER,
    DEFAULT_EMAIL_POLL_INTERVAL_MINUTES,
    DEFAULT_EMAIL_PORT,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

_STORAGE_VERSION = 1

# Tracking number extraction patterns (applied against uppercased text)
_PATTERNS: list[re.Pattern] = [
    # Bring/Posten proprietary letter prefixes — unambiguous
    re.compile(r'\b(JD\d{10,18})\b'),
    re.compile(r'\b(JVNO\d{6,14})\b'),
    re.compile(r'\b(JV\d{6,14})\b'),
    # International postal UPU format: 2 letters + 8-9 digits + 2 letters
    re.compile(r'\b([A-Z]{2}\d{8,9}[A-Z]{2})\b'),
    # GS1/EAN-128 20-digit codes starting with known carrier prefixes
    re.compile(r'\b(00(?:37|33)\d{18})\b'),
]

_MAX_NEW_PER_POLL = 20


def _extract_text(msg: email_lib.message.Message) -> str:
    parts: list[str] = []
    subject_raw = msg.get("Subject", "")
    try:
        parts.append(str(make_header(decode_header(subject_raw))))
    except Exception:
        parts.append(subject_raw)

    for part in msg.walk():
        content_type = part.get_content_type()
        if content_type not in ("text/plain", "text/html"):
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        charset = part.get_content_charset() or "utf-8"
        try:
            text = payload.decode(charset, errors="replace")
        except Exception:
            text = payload.decode("utf-8", errors="replace")
        if content_type == "text/html":
            text = re.sub(r"<[^>]+>", " ", text)
            text = html_module.unescape(text)
        parts.append(text)

    return "\n".join(parts)


def _extract_tracking_numbers(text: str) -> list[str]:
    upper = text.upper()
    seen: set[str] = set()
    found: list[str] = []
    for pattern in _PATTERNS:
        for match in pattern.finditer(upper):
            tn = match.group(1)
            if tn not in seen:
                seen.add(tn)
                found.append(tn)
    return found


def _imap_poll(
    server: str,
    port: int,
    username: str,
    password: str,
    folder: str,
    days_back: int,
    seen_uids: set[str],
    known_uidvalidity: str | None,
) -> tuple[list[str], list[str], str | None]:
    """Synchronous IMAP scan. Returns (tracking_numbers, all_uids_in_window, uidvalidity)."""
    conn = imaplib.IMAP4_SSL(server, port)
    try:
        conn.login(username, password)

        # Read UIDVALIDITY before selecting; a change means the UID sequence was reset.
        sv_status, sv_data = conn.status(folder, "(UIDVALIDITY)")
        uidvalidity: str | None = None
        if sv_status == "OK" and sv_data:
            m = re.search(rb"UIDVALIDITY (\d+)", sv_data[0])
            if m:
                uidvalidity = m.group(1).decode()

        conn.select(folder, readonly=True)

        # If the UID sequence was reset, the cached seen_uids belong to the old sequence
        # and can no longer be trusted — treat the folder as completely fresh.
        active_seen = seen_uids
        if uidvalidity and known_uidvalidity and uidvalidity != known_uidvalidity:
            active_seen = set()

        since_date = (datetime.now() - timedelta(days=days_back)).strftime("%d-%b-%Y")
        status, data = conn.uid("search", None, f"(SINCE {since_date})")  # type: ignore[misc]
        if status != "OK" or not data or not data[0]:
            return [], [], uidvalidity

        all_uid_bytes = data[0].split()
        all_uids = [u.decode() for u in all_uid_bytes]
        unseen_uid_bytes = [u for u in all_uid_bytes if u.decode() not in active_seen]

        tracking_numbers: list[str] = []

        for uid_bytes in unseen_uid_bytes:
            status, email_data = conn.uid("fetch", uid_bytes, "(RFC822)")  # type: ignore[misc]
            if status != "OK" or not email_data or not email_data[0]:
                continue

            raw = email_data[0][1]
            if not isinstance(raw, bytes):
                continue

            msg = email_lib.message_from_bytes(raw)
            text = _extract_text(msg)
            found = _extract_tracking_numbers(text)
            tracking_numbers.extend(found)

        return tracking_numbers, all_uids, uidvalidity
    finally:
        try:
            conn.logout()
        except Exception:
            pass


class EmailWatcherCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.entry = entry
        self._seen_uids: set[str] = set()
        self._seen_tracking_numbers: set[str] = set()
        self._uidvalidity: str | None = None
        self._store_loaded: bool = False
        self._store: Store = Store(
            hass, _STORAGE_VERSION, f"{DOMAIN}_email_{entry.entry_id}"
        )
        poll_minutes = int(
            entry.options.get(CONF_EMAIL_POLL_INTERVAL_MINUTES, DEFAULT_EMAIL_POLL_INTERVAL_MINUTES)
        )
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_email_{entry.unique_id or entry.entry_id}",
            update_interval=timedelta(minutes=poll_minutes),
            config_entry=entry,
        )

    async def async_config_entry_first_refresh(self) -> None:
        """Load persisted state before the first poll so UIDs are not re-scanned."""
        await self._async_load_store()
        await super().async_config_entry_first_refresh()

    async def _async_load_store(self) -> None:
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            self._seen_uids = set(stored.get("seen_uids", []))
            self._seen_tracking_numbers = set(stored.get("seen_tracking_numbers", []))
            self._uidvalidity = stored.get("uidvalidity")
        self._store_loaded = True

    async def _async_save_store(self) -> None:
        await self._store.async_save({
            "seen_uids": list(self._seen_uids),
            "seen_tracking_numbers": list(self._seen_tracking_numbers),
            "uidvalidity": self._uidvalidity,
        })

    async def _async_update_data(self) -> dict[str, Any]:
        # Safety net: load store if async_config_entry_first_refresh was bypassed
        if not self._store_loaded:
            await self._async_load_store()

        cfg = self.entry.options
        server = str(cfg.get(CONF_EMAIL_SERVER, ""))
        port = int(cfg.get(CONF_EMAIL_PORT, DEFAULT_EMAIL_PORT))
        username = str(cfg.get(CONF_EMAIL_USERNAME, ""))
        password = str(cfg.get(CONF_EMAIL_PASSWORD, ""))
        folder = str(cfg.get(CONF_EMAIL_FOLDER, DEFAULT_EMAIL_FOLDER))
        days_back = int(cfg.get(CONF_EMAIL_DAYS_BACK, DEFAULT_EMAIL_DAYS_BACK))

        if not server or not username or not password:
            raise UpdateFailed("Email watcher not fully configured")

        try:
            raw_numbers, all_uids, uidvalidity = await self.hass.async_add_executor_job(
                _imap_poll,
                server, port, username, password, folder, days_back,
                self._seen_uids, self._uidvalidity,
            )
        except imaplib.IMAP4.error as err:
            raise UpdateFailed(f"IMAP error: {err}") from err
        except OSError as err:
            raise UpdateFailed(f"Connection error: {err}") from err

        if uidvalidity and self._uidvalidity and uidvalidity != self._uidvalidity:
            _LOGGER.warning(
                "IMAP UIDVALIDITY changed for folder %s (was %s, now %s); resetting seen UIDs",
                folder, self._uidvalidity, uidvalidity,
            )

        # Replace seen_uids with only UIDs currently in the window. This prunes UIDs
        # from messages that have aged out of the days_back window, keeping the stored
        # set bounded to the size of the current inbox window.
        self._seen_uids = set(all_uids)
        self._uidvalidity = uidvalidity

        new_numbers = [tn for tn in raw_numbers if tn not in self._seen_tracking_numbers]
        unique_new: list[str] = []
        seen_this_poll: set[str] = set()
        for tn in new_numbers:
            if tn not in seen_this_poll:
                unique_new.append(tn)
                seen_this_poll.add(tn)

        if len(unique_new) > _MAX_NEW_PER_POLL:
            _LOGGER.warning(
                "Email watcher found %d new tracking numbers; processing first %d",
                len(unique_new),
                _MAX_NEW_PER_POLL,
            )
            unique_new = unique_new[:_MAX_NEW_PER_POLL]

        added: list[str] = []
        for tn in unique_new:
            self._seen_tracking_numbers.add(tn)
            try:
                result = await self.hass.config_entries.flow.async_init(
                    DOMAIN,
                    context={"source": "user"},
                    data={"tracking_number": tn},
                )
                if result.get("type") == "create_entry":
                    added.append(tn)
                    _LOGGER.info("Email watcher auto-added parcel %s", tn)
                elif result.get("type") == "abort":
                    _LOGGER.debug(
                        "Email watcher skipped %s (reason: %s)",
                        tn,
                        result.get("reason", "unknown"),
                    )
                else:
                    # "form" means the carrier API rejected the number. Abort the
                    # in-progress flow so it does not accumulate in the flow manager.
                    flow_id = result.get("flow_id")
                    if flow_id:
                        try:
                            await self.hass.config_entries.flow.async_abort(flow_id)
                        except Exception:
                            pass
                    _LOGGER.debug(
                        "Email watcher: %s not recognised as a valid tracking number", tn
                    )
            except Exception:
                _LOGGER.debug("Email watcher could not add %s", tn, exc_info=True)

        await self._async_save_store()

        return {
            "scanned_uids": len(all_uids),
            "new_tracking_numbers": added,
        }
