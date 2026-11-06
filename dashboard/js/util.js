/* Habitat — shared helpers: escaping, storage, number and time formatting. */
(function (HB) {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Escapes any value for safe interpolation into HTML text or attribute values. */
  HB.esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

  HB.clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /** localStorage wrapper that never throws (private windows, blocked or full storage). */
  HB.storage = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {
        /* storage unavailable: settings simply won't persist */
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch (_) {
        /* storage unavailable */
      }
    },
  };

  const NUMERIC_RE = /^\s*-?\d+(\.\d+)?\s*$/;

  /** True when a Home Assistant state string holds a plain number. */
  HB.isNumeric = (state) => (typeof state === 'number' ? Number.isFinite(state) : NUMERIC_RE.test(String(state ?? '')));

  const numberFormats = new Map();
  function numberFormat(digits) {
    let format = numberFormats.get(digits);
    if (!format) {
      format = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
      numberFormats.set(digits, format);
    }
    return format;
  }

  function maxDigitsFor(value) {
    const abs = Math.abs(value);
    if (abs >= 100) return 0;
    if (abs >= 10) return 1;
    if (abs >= 1) return 2;
    return 3;
  }

  /**
   * Formats a number for display. An explicit precision (the entity's display precision) wins;
   * otherwise the precision of the raw value is kept, capped by the value's magnitude.
   */
  HB.formatNumber = (value, precision) => {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(num)) return '—';
    let digits = precision;
    if (digits == null) {
      const text = String(value);
      const dot = text.indexOf('.');
      const given = dot === -1 ? 0 : text.length - dot - 1;
      digits = Math.min(given, maxDigitsFor(num));
    }
    return numberFormat(digits).format(num);
  };

  const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  HB.formatCompact = (value) => (Number.isFinite(value) ? compactFormat.format(value) : '—');

  const POWER_FACTORS = { mW: 0.001, W: 1, kW: 1000, MW: 1e6 };

  /** Converts a power reading to watts, or returns null when the unit is not a power unit. */
  HB.toWatts = (value, unit) => {
    const factor = POWER_FACTORS[unit];
    const num = parseFloat(value);
    return factor && Number.isFinite(num) ? num * factor : null;
  };

  /** Formats watts with a unit that keeps the figure short. */
  HB.formatWatts = (watts) => {
    if (!Number.isFinite(watts)) return { value: '—', unit: 'W' };
    if (Math.abs(watts) >= 10000) return { value: HB.formatNumber(watts / 1000, 1), unit: 'kW' };
    return { value: HB.formatNumber(watts, 0), unit: 'W' };
  };

  const MS_SECOND = 1000;
  const MS_MINUTE = 60 * MS_SECOND;
  const MS_HOUR = 60 * MS_MINUTE;
  const MS_DAY = 24 * MS_HOUR;
  HB.MS = { SECOND: MS_SECOND, MINUTE: MS_MINUTE, HOUR: MS_HOUR, DAY: MS_DAY };

  /** Normalises Home Assistant timestamps (ISO strings, seconds or milliseconds) to milliseconds. */
  HB.toMs = (value) => {
    if (value == null) return NaN;
    if (typeof value === 'number') return value < 1e11 ? value * MS_SECOND : value;
    return Date.parse(value);
  };

  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const longDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const dayTimeFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const dayDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  HB.fmtTime = (ms) => timeFormat.format(ms);
  HB.fmtWeekday = (ms) => weekdayFormat.format(ms);
  HB.fmtLongDate = (ms) => longDateFormat.format(ms);
  HB.fmtDayTime = (ms) => dayTimeFormat.format(ms);
  HB.fmtDayDate = (ms) => dayDateFormat.format(ms);

  /** Formats a duration as a short human string: 45s, 12m, 3h 12m, 2d 4h. */
  HB.fmtDuration = (ms) => {
    const seconds = Math.max(0, Math.round(ms / MS_SECOND));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
  };

  /** Formats a timestamp relative to now: "just now", "12m ago", "in 3h". */
  HB.fmtAgo = (ms, now = Date.now()) => {
    const diff = now - ms;
    if (!Number.isFinite(diff)) return '';
    if (Math.abs(diff) < 45 * MS_SECOND) return 'just now';
    return diff > 0 ? `${HB.fmtDuration(diff)} ago` : `in ${HB.fmtDuration(-diff)}`;
  };

  /** Turns snake_case identifiers into sentence case: "not_home" -> "Not home". */
  HB.humanize = (text) => {
    const clean = String(text ?? '').replace(/_/g, ' ').trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  };

  /** Converts a simple glob ("sensor.*_signal") to an anchored regular expression. */
  HB.globToRegExp = (glob) => {
    const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
  };

  /** Parses "#38d9f5" into "56,217,245" for use in rgba(). */
  HB.hexToRgb = (hex) => {
    const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim());
    if (!match) return null;
    return match.slice(1).map((part) => parseInt(part, 16)).join(',');
  };

  /** Validates an [r, g, b] attribute and returns "r,g,b", or null. */
  HB.rgbList = (value) => {
    if (!Array.isArray(value) || value.length < 3) return null;
    const parts = value.slice(0, 3).map((part) => HB.clamp(Math.round(Number(part)), 0, 255));
    return parts.some((part) => Number.isNaN(part)) ? null : parts.join(',');
  };

  /** Allows only same-origin paths and http(s) URLs for images coming from entity attributes. */
  HB.safeImageUrl = (url, baseUrl) => {
    if (typeof url !== 'string' || !url) return null;
    if (url.startsWith('/') && !url.startsWith('//')) return `${baseUrl || ''}${url}`;
    return /^https?:\/\//i.test(url) ? url : null;
  };

  HB.objectId = (entityId) => entityId.slice(entityId.indexOf('.') + 1);
  HB.domainOf = (entityId) => entityId.slice(0, entityId.indexOf('.'));
})(window.HB = window.HB || {});
