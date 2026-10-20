const DAY = 86_400_000;
const isoDate = (date) => date.toISOString().slice(0, 10);
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

export function rollingWindow(now = new Date()) {
  // Match the local day shown on this profile, including the leading partial week.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const to = `${parts.year}-${parts.month}-${parts.day}`;
  const start = new Date(`${to}T00:00:00Z`);
  const month = start.getUTCMonth();
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  if (start.getUTCMonth() !== month) start.setUTCDate(0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return { from: isoDate(start), to };
}

export function parseCalendar(html) {
  const heading = html.match(/([\d,]+)\s+contributions?\s+in (?:the last year|\d{4})/);
  if (heading === null) throw new Error('GitHub contribution heading is missing');
  const total = Number(heading[1].replaceAll(',', ''));
  const tips = new Map([...html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/g)].map((m) => [attributes(m[1]).for, m[2].trim()]));
  const days = [];
  for (const match of html.matchAll(/<td\b([^>]*)>/g)) {
    const attrs = attributes(match[1]);
    if (attrs['data-date'] === undefined) continue;
    const date = attrs['data-date'];
    const text = tips.get(attrs.id);
    const countMatch = text?.match(/^([\d,]+) contributions? on /);
    if (countMatch == null && !text?.startsWith('No contributions on ')) {
      throw new Error(`GitHub contribution tooltip is missing or changed for ${date}`);
    }
    const count = countMatch == null ? 0 : Number(countMatch[1].replaceAll(',', ''));
    const level = Number(attrs['data-level']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || isoDate(new Date(date)) !== date ||
        !Number.isSafeInteger(count) || count < 0 || !Number.isInteger(level) || level < 0 || level > 4 || (count === 0) !== (level === 0)) {
      throw new Error(`Invalid GitHub contribution day: ${date}`);
    }
    days.push({ date, count, level });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0 || !Number.isSafeInteger(total) || days.reduce((sum, day) => sum + day.count, 0) !== total) {
    throw new Error('GitHub contribution total does not match its daily counts');
  }
  for (let i = 1; i < days.length; i++) {
    if (Date.parse(days[i].date) - Date.parse(days[i - 1].date) !== DAY) throw new Error('GitHub contribution dates are duplicated or incomplete');
  }
  return { days, total };
}

export async function calendar(login, now = new Date()) {
  const { from, to } = rollingWindow(now);
  const years = Array.from({ length: Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1 }, (_, i) => Number(from.slice(0, 4)) + i);
  // Website calendars include the activity missing from the GraphQL total. Read whole years
  // so a UTC day change cannot drop the profile's first week or add tomorrow locally.
  const calendars = await Promise.all(years.map(async (year) => {
    const url = `https://github.com/users/${encodeURIComponent(login)}/contributions?from=${year}-01-01&to=${year}-12-31`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`GitHub contributions for ${login}/${year}: ${response.status}`);
    return parseCalendar(await response.text());
  }));
  const days = calendars.flatMap((cal) => cal.days).filter((day) => day.date >= from && day.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length !== (Date.parse(to) - Date.parse(from)) / DAY + 1) throw new Error(`Incomplete rolling calendar for ${login}`);
  for (const [i, day] of days.entries()) {
    if (Date.parse(day.date) !== Date.parse(from) + i * DAY) throw new Error(`Missing rolling day for ${login}`);
    Object.assign(day, { col: Math.floor(i / 7), row: i % 7 });
  }
  return { cols: days.at(-1).col + 1, days, total: days.reduce((sum, day) => sum + day.count, 0), from, to };
}
