export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

export const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];
export const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(value) {
  return String(value).padStart(2, "0");
}

export function isValidISO(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function parseISO(value) {
  if (!isValidISO(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function toISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function isValidTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function timeToMinutes(value) {
  if (!isValidTime(value)) {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(total) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(total) || 0)));
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

export function formatTime(value) {
  const total = timeToMinutes(value);
  if (total === null) {
    return "";
  }
  const hours24 = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${pad(minutes)} ${suffix}`;
}

export function formatTimeRange(start, end) {
  if (!isValidTime(start) || !isValidTime(end)) {
    return "";
  }
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function hoursToMinutes(hours) {
  return Math.max(0, Math.round((Number(hours) || 0) * 60));
}

export function minutesToHours(minutes) {
  return Math.max(0, Number(minutes) || 0) / 60;
}

export function formatHours(hours) {
  const value = Math.max(0, Number(hours) || 0);
  return `${Number(value.toFixed(2))}h`;
}

export function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) {
    return `${value}m`;
  }
  return `${Number((value / 60).toFixed(2))}h`;
}

export function addDays(value, amount) {
  const date = typeof value === "string" ? parseISO(value) : new Date(value.getTime());
  if (!date) {
    return "";
  }
  date.setDate(date.getDate() + amount);
  return toISO(date);
}

export function addMonths(value, amount) {
  const date = typeof value === "string" ? parseISO(value) : new Date(value.getTime());
  if (!date) {
    return "";
  }
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return toISO(date);
}

export function compareISO(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function isWithin(iso, startISO, endISO) {
  return isValidISO(iso) && compareISO(iso, startISO) >= 0 && compareISO(iso, endISO) <= 0;
}

export function eachDate(startISO, endISO) {
  const out = [];
  if (!isValidISO(startISO) || !isValidISO(endISO) || compareISO(startISO, endISO) > 0) {
    return out;
  }
  let current = startISO;
  while (compareISO(current, endISO) <= 0) {
    out.push(current);
    current = addDays(current, 1);
  }
  return out;
}

export function weekdayShort(iso) {
  const date = parseISO(iso);
  return date ? WEEKDAY_SHORT[date.getDay()] : "";
}

export function weekdayLong(iso) {
  const date = parseISO(iso);
  return date ? WEEKDAY_LONG[date.getDay()] : "";
}

export function weekdayMondayIndex(iso) {
  const date = parseISO(iso);
  if (!date) {
    return 0;
  }
  return (date.getDay() + 6) % 7;
}

export function formatShort(iso) {
  const date = parseISO(iso);
  if (!date) {
    return "";
  }
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
}

export function formatWithYear(iso) {
  const date = parseISO(iso);
  if (!date) {
    return "";
  }
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function formatLong(iso) {
  const date = parseISO(iso);
  if (!date) {
    return "";
  }
  return `${WEEKDAY_LONG[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function formatRange(startISO, endISO) {
  if (!startISO && !endISO) {
    return "—";
  }
  if (!startISO) {
    return formatShort(endISO);
  }
  if (!endISO || startISO === endISO) {
    return formatShort(startISO);
  }
  return `${formatShort(startISO)} – ${formatShort(endISO)}`;
}

export function monthLabel(iso) {
  const date = parseISO(iso);
  if (!date) {
    return "";
  }
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function startOfMonth(iso) {
  const date = parseISO(iso);
  if (!date) {
    return "";
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

export function startOfWeek(iso) {
  const offset = weekdayMondayIndex(iso);
  return addDays(iso, -offset);
}

export function monthGrid(iso) {
  const first = startOfMonth(iso);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function weekDates(iso) {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function weekLabel(iso) {
  const dates = weekDates(iso);
  return `${formatShort(dates[0])} – ${formatWithYear(dates[6])}`;
}
