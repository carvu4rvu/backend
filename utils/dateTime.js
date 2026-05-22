/** Indian Standard Time — use project-wide for display in messages and emails. */

const IST_TIMEZONE = 'Asia/Kolkata';
const IST_LOCALE = 'en-IN';

function parseAppDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTimeIST(value, options = {}) {
  const d = parseAppDate(value);
  if (!d) return '—';
  return d.toLocaleString(IST_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: IST_TIMEZONE,
    ...options,
  });
}

function formatDateIST(value, options = {}) {
  const d = parseAppDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(IST_LOCALE, {
    dateStyle: 'medium',
    timeZone: IST_TIMEZONE,
    ...options,
  });
}

module.exports = {
  IST_TIMEZONE,
  IST_LOCALE,
  parseAppDate,
  formatDateTimeIST,
  formatDateIST,
};
