"""Tests for email_watcher helpers: sender allowlist and password breach check."""
import email as email_lib
import hashlib
import imaplib
import unittest.mock as mock

import pytest

from custom_components.norwegian_parcel_tracker.email_watcher import (
    _check_password_pwned_sync,
    _domain_allowed,
    _imap_poll,
    _parse_sender_allowlist,
    _sender_domain,
)


# ── _parse_sender_allowlist ───────────────────────────────────────────────────

def test_parse_allowlist_basic():
    result = _parse_sender_allowlist("amazon.com, komplett.no")
    assert result == frozenset({"amazon.com", "komplett.no"})


def test_parse_allowlist_empty_string():
    assert _parse_sender_allowlist("") == frozenset()


def test_parse_allowlist_whitespace_only():
    assert _parse_sender_allowlist("  ,  ") == frozenset()


def test_parse_allowlist_lowercases():
    result = _parse_sender_allowlist("Amazon.COM")
    assert "amazon.com" in result


def test_parse_allowlist_at_prefix():
    """@amazon.com should normalise to amazon.com."""
    result = _parse_sender_allowlist("@amazon.com")
    assert result == frozenset({"amazon.com"})


def test_parse_allowlist_wildcard_prefix():
    """*.amazon.com should normalise to amazon.com."""
    result = _parse_sender_allowlist("*.amazon.com")
    assert result == frozenset({"amazon.com"})


def test_parse_allowlist_dot_prefix():
    """.amazon.com should normalise to amazon.com."""
    result = _parse_sender_allowlist(".amazon.com")
    assert result == frozenset({"amazon.com"})


def test_parse_allowlist_full_email():
    """order@amazon.com should reduce to amazon.com."""
    result = _parse_sender_allowlist("order@amazon.com")
    assert result == frozenset({"amazon.com"})


# ── _sender_domain ────────────────────────────────────────────────────────────

def _msg_with_from(from_header: str):
    import email as email_lib
    msg = email_lib.message_from_string(f"From: {from_header}\r\n\r\n")
    return msg


def test_sender_domain_simple():
    assert _sender_domain(_msg_with_from("noreply@amazon.com")) == "amazon.com"


def test_sender_domain_display_name():
    assert _sender_domain(_msg_with_from("Amazon <order@email.amazon.com>")) == "email.amazon.com"


def test_sender_domain_no_at_sign():
    assert _sender_domain(_msg_with_from("not-an-email")) is None


def test_sender_domain_missing_header():
    import email as email_lib
    msg = email_lib.message_from_string("\r\n")
    assert _sender_domain(msg) is None


# ── _domain_allowed ───────────────────────────────────────────────────────────

def test_domain_allowed_empty_allowlist():
    """Empty allowlist permits everything."""
    assert _domain_allowed("evil.com", frozenset()) is True


def test_domain_allowed_exact_match():
    assert _domain_allowed("amazon.com", frozenset({"amazon.com"})) is True


def test_domain_allowed_subdomain_match():
    """email.amazon.com matches allowlist entry amazon.com."""
    assert _domain_allowed("email.amazon.com", frozenset({"amazon.com"})) is True


def test_domain_not_allowed():
    assert _domain_allowed("phishing.example.com", frozenset({"amazon.com", "komplett.no"})) is False


def test_domain_allowed_none_sender():
    """Missing From header is denied when allowlist is non-empty."""
    assert _domain_allowed(None, frozenset({"amazon.com"})) is False


def test_domain_not_prefix_match():
    """notamazon.com must NOT match amazon.com."""
    assert _domain_allowed("notamazon.com", frozenset({"amazon.com"})) is False


# ── _check_password_pwned_sync ────────────────────────────────────────────────

def _mock_hibp_response(password: str, count: int):
    """Build a fake HIBP range response that includes (or excludes) password's suffix."""
    sha1 = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    suffix = sha1[5:]
    lines = f"{suffix}:{count}\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n"
    return lines.encode("utf-8")


def test_pwned_password_found():
    password = "hunter2"
    response_body = _mock_hibp_response(password, 42)
    mock_resp = mock.MagicMock()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = mock.MagicMock(return_value=False)
    mock_resp.read.return_value = response_body

    with mock.patch("urllib.request.urlopen", return_value=mock_resp):
        result = _check_password_pwned_sync(password)

    assert result == 42



def test_pwned_network_error_returns_none():
    """Network failure must return None (not 0) so the coordinator retries next poll."""
    with mock.patch("urllib.request.urlopen", side_effect=OSError("timeout")):
        result = _check_password_pwned_sync("anypassword")

    assert result is None


def test_pwned_password_not_found_returns_zero():
    """A clean response (suffix absent) must return 0, not None."""
    mock_resp = mock.MagicMock()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = mock.MagicMock(return_value=False)
    mock_resp.read.return_value = b"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:5\n"

    with mock.patch("urllib.request.urlopen", return_value=mock_resp):
        result = _check_password_pwned_sync("some-unique-password-not-in-fixture")

    assert result == 0


def test_pwned_padded_entry_with_zero_count_returns_zero():
    """Padded responses include SUFFIX:0 entries — they should return 0, not 1."""
    password = "hunter2"
    sha1 = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    suffix = sha1[5:]
    # Padded entry for the real suffix has count 0
    response = f"{suffix}:0\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n".encode("utf-8")
    mock_resp = mock.MagicMock()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = mock.MagicMock(return_value=False)
    mock_resp.read.return_value = response

    with mock.patch("urllib.request.urlopen", return_value=mock_resp):
        result = _check_password_pwned_sync(password)

    assert result == 0


def test_pwned_request_sends_add_padding_header():
    """The HIBP request must include Add-Padding: true for privacy."""
    captured: list = []

    def fake_urlopen(req, timeout=None):
        captured.append(req)
        raise OSError("abort after capture")

    with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
        _check_password_pwned_sync("anypassword")

    assert captured, "urlopen was never called"
    req = captured[0]
    # urllib capitalises headers: "Add-Padding" is stored as "Add-padding"
    assert req.get_header("Add-padding") == "true"


# ── _imap_poll sender filter ──────────────────────────────────────────────────

def _make_raw_email(from_header: str, body: str) -> bytes:
    return (
        f"From: {from_header}\r\nSubject: Order\r\n\r\n{body}\r\n"
    ).encode("utf-8")


def test_imap_poll_sender_filter():
    """Only emails from allowed domains are scanned for tracking numbers."""
    bring_raw = _make_raw_email("Bring <noreply@bring.com>", "Your parcel JD123456789012")
    spam_raw = _make_raw_email("Spammer <x@spam.example>", "Win JD999988887766")

    uid_responses = {
        b"1": bring_raw,
        b"2": spam_raw,
    }

    def fake_uid(cmd, uid_bytes, *args):
        if cmd == "search":
            return ("OK", [b"1 2"])
        if cmd == "fetch":
            raw = uid_responses.get(uid_bytes)
            if raw:
                return ("OK", [(b"1 (RFC822 ...)", raw)])
            return ("NO", [])
        return ("OK", [])

    fake_conn = mock.MagicMock()
    fake_conn.status.return_value = ("OK", [b"INBOX (UIDVALIDITY 42)"])
    fake_conn.select.return_value = ("OK", [b"2"])
    fake_conn.uid.side_effect = fake_uid
    fake_conn.logout.return_value = None

    with mock.patch("imaplib.IMAP4_SSL", return_value=fake_conn):
        tracking, all_uids, uidvalidity = _imap_poll(
            "imap.example.com", 993, "user", "pass",
            "INBOX", 30, set(), None,
            sender_allowlist=frozenset({"bring.com"}),
        )

    # Only Bring's number should be returned
    assert "JD123456789012" in tracking
    assert "JD999988887766" not in tracking
    # Both UIDs are recorded as seen (skipped email is still marked seen)
    assert set(all_uids) == {"1", "2"}
