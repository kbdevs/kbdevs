import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendar, parseCalendar, rollingWindow } from './calendar.mjs';

function fixture(year, counts = {}) {
  const days = [];
  for (let time = Date.UTC(year, 0, 1); new Date(time).getUTCFullYear() === year; time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    const count = counts[date] ?? 0;
    days.push({ date, count });
  }
  return `<h2>${days.reduce((sum, day) => sum + day.count, 0).toLocaleString('en-US')} contributions in ${year}</h2>` +
    days.map(({ date, count }, i) => `<td id="day-${i}" data-date="${date}" data-level="${count === 0 ? 0 : 1}"></td><tool-tip for="day-${i}">${count === 0 ? 'No contributions' : `${count.toLocaleString('en-US')} contribution${count === 1 ? '' : 's'}`} on ${date}.</tool-tip>`).join('');
}

test('rolling range follows the profile local day through New Year and leap day', () => {
  assert.deepEqual(rollingWindow(new Date('2026-10-20T05:00:00Z')), { from: '2025-10-19', to: '2026-10-19' });
  assert.deepEqual(rollingWindow(new Date('2027-01-01T07:00:00Z')), { from: '2025-12-28', to: '2026-12-31' });
  assert.deepEqual(rollingWindow(new Date('2027-01-01T08:00:00Z')), { from: '2025-12-28', to: '2027-01-01' });
  assert.deepEqual(rollingWindow(new Date('2016-02-29T20:00:00Z')), { from: '2015-02-22', to: '2016-02-29' });
});

test('website counts include singular, zero and comma-separated values; malformed sources fail', () => {
  const html = fixture(2026, { '2026-01-01': 1, '2026-01-02': 1234 });
  const parsed = parseCalendar(html);
  assert.equal(parsed.total, 1235);
  assert.equal(parsed.days.length, 365);
  assert.deepEqual(parsed.days.slice(0, 3).map((day) => day.count), [1, 1234, 0]);
  assert.throws(() => parseCalendar(html.replace('1,235 contributions', '1,236 contributions')), /total does not match/);
  assert.throws(() => parseCalendar(html.replace('for="day-0"', 'for="unknown"')), /tooltip/);
  assert.throws(() => parseCalendar(html.replace('data-date="2026-01-02"', 'data-date="2026-01-01"')), /duplicated/);
  assert.throws(() => parseCalendar('<html>Rate limited</html>'), /heading/);
});

test('renderer uses previous-year days and excludes tomorrow even when GitHub serves it in UTC', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(url);
    const year = Number(new URL(url).searchParams.get('from').slice(0, 4));
    return new Response(fixture(year, { '2025-10-18': 99, '2025-10-19': 2, '2026-01-01': 3, '2026-10-19': 4, '2026-10-20': 100 }));
  };
  try {
    const cal = await calendar('kbdevs', new Date('2026-10-20T05:00:00Z'));
    assert.equal(cal.total, 9);
    assert.equal(cal.days.length, 366);
    assert.equal(cal.cols, 53);
    assert.equal(cal.days[0].date, '2025-10-19');
    assert.equal(cal.days.at(-1).date, '2026-10-19');
    assert.equal(requested.length, 2);
    assert.deepEqual([cal.days[0].col, cal.days[0].row], [0, 0]);
    assert.deepEqual([cal.days.at(-1).col, cal.days.at(-1).row], [52, 1]);
    requested.length = 0;
    const newYear = await calendar('kbdevs', new Date('2027-01-01T08:00:00Z'));
    assert.equal(newYear.days[0].date, '2025-12-28');
    assert.equal(newYear.days.at(-1).date, '2027-01-01');
    assert.equal(newYear.total, 107);
    assert.equal(requested.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
