DOMAIN = "norwegian_parcel_tracker"
NAME = "Norwegian Parcel Tracker"
VERSION = "0.1.6"

# ── Config entry types ─────────────────────────────────────────────────────────
CONF_ENTRY_TYPE = "entry_type"
ENTRY_TYPE_GLOBAL = "global"
ENTRY_TYPE_PARCEL = "parcel"
GLOBAL_ENTRY_UNIQUE_ID = "norwegian_parcel_tracker_global"

# ── Parcel entry config ────────────────────────────────────────────────────────
CONF_TRACKING_NUMBER = "tracking_number"
CONF_DISPLAY_NAME = "name"

# ── Language ───────────────────────────────────────────────────────────────────
CONF_LANGUAGE = "language"
LANGUAGE_NORWEGIAN = "nb"
LANGUAGE_ENGLISH = "en"

# ── Delivery fit contexts ──────────────────────────────────────────────────────
CONF_MAILBOX_ENABLED = "mailbox_enabled"
CONF_MAILBOX_L = "mailbox_length_cm"
CONF_MAILBOX_W = "mailbox_width_cm"
CONF_MAILBOX_H = "mailbox_height_cm"
DEFAULT_MAILBOX_L, DEFAULT_MAILBOX_W, DEFAULT_MAILBOX_H = 38, 30, 10

CONF_CAR_ENABLED = "car_enabled"
CONF_CAR_L = "car_length_cm"
CONF_CAR_W = "car_width_cm"
CONF_CAR_H = "car_height_cm"
DEFAULT_CAR_L, DEFAULT_CAR_W, DEFAULT_CAR_H = 100, 80, 60

CONF_CARRY_ENABLED = "carry_enabled"
CONF_CARRY_L = "carry_length_cm"
CONF_CARRY_W = "carry_width_cm"
CONF_CARRY_H = "carry_height_cm"
DEFAULT_CARRY_L, DEFAULT_CARRY_W, DEFAULT_CARRY_H = 60, 40, 40

# ── Global notification / calendar defaults (pre-fill per-parcel options) ──────
CONF_DEFAULT_NOTIFY_TARGET = "default_notify_target"
CONF_DEFAULT_CALENDAR_ENTITY = "default_calendar_entity"
CONF_DEFAULT_NOTIFY_ALL_EVENTS = "default_notify_all_events"
CONF_DEFAULT_NOTIFY_DELIVERED = "default_notify_delivered"
CONF_DEFAULT_CREATE_CALENDAR_EVENT = "default_create_calendar_event"
CONF_DEFAULT_STALE_WARNING_HOURS = "default_stale_warning_hours"
CONF_DEFAULT_STALE_CRITICAL_HOURS = "default_stale_critical_hours"

# ── Per-parcel options ─────────────────────────────────────────────────────────
CONF_NOTIFY_TARGET = "notify_target"
CONF_CALENDAR_ENTITY = "calendar_entity"
CONF_NOTIFY_ALL_EVENTS = "notify_all_events"
CONF_NOTIFY_DELIVERED = "notify_delivered"
CONF_CREATE_CALENDAR_EVENT = "create_calendar_event"
CONF_STALE_WARNING_HOURS = "stale_warning_hours"
CONF_STALE_CRITICAL_HOURS = "stale_critical_hours"
CONF_MAX_WEIGHT_KG = "max_weight_kg"
CONF_MAX_LENGTH_CM = "max_length_cm"
CONF_MAX_WIDTH_CM = "max_width_cm"
CONF_MAX_HEIGHT_CM = "max_height_cm"

# ── Misc ───────────────────────────────────────────────────────────────────────
DEFAULT_SCAN_INTERVAL_MINUTES = 30
CARD_REPO_URL = "https://github.com/Homie-Assistance/norwegian-parcel-tracker-card"
