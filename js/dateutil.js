(function (SM) {
  'use strict';

  // 모든 계산은 UTC 자정 기준 Date로 해서 서머타임·시간대 영향을 없앤다.
  // 입력·출력은 항상 ISO 문자열('2026-11-13', '2026-W46', '2026-11')이다.

  const DAY_MS = 86400000;
  const WEEKDAY_KO = ['월', '화', '수', '목', '금', '토', '일'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function parse(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (!m) throw new Error('잘못된 날짜 형식: ' + iso);
    const y = +m[1], mo = +m[2], d = +m[3];
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
      throw new Error('존재하지 않는 날짜: ' + iso);
    }
    return date;
  }

  function format(date) {
    return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  }

  /** 로컬 시간 기준 오늘 */
  function today(now) {
    const d = now || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(iso, n) {
    return format(new Date(parse(iso).getTime() + n * DAY_MS));
  }

  /** 0(월) ~ 6(일) */
  function weekday(iso) {
    return (parse(iso).getUTCDay() + 6) % 7;
  }

  /** ISO 8601 주차: 그 주의 목요일이 속한 해가 주차의 해다. */
  function isoWeek(iso) {
    const d = parse(iso);
    const thursday = new Date(d.getTime() + (3 - weekday(iso)) * DAY_MS);
    const year = thursday.getUTCFullYear();
    const jan1 = Date.UTC(year, 0, 1);
    const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
    return year + '-W' + pad2(week);
  }

  /** '2026-W46' → 월~일 7개 날짜 */
  function weekDays(weekKey) {
    const m = /^(\d{4})-W(\d{2})$/.exec(String(weekKey));
    if (!m) throw new Error('잘못된 주차 형식: ' + weekKey);
    const year = +m[1], week = +m[2];
    // 1월 4일은 항상 1주차에 들어 있다.
    const jan4 = format(new Date(Date.UTC(year, 0, 4)));
    const week1Monday = addDays(jan4, -weekday(jan4));
    const monday = addDays(week1Monday, (week - 1) * 7);
    if (week < 1 || isoWeek(monday) !== weekKey) throw new Error('존재하지 않는 주차: ' + weekKey);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(monday, i));
    return days;
  }

  function monthKey(iso) {
    parse(iso);
    return String(iso).slice(0, 7);
  }

  /** '2026-11' → 그 달의 모든 날짜 */
  function monthDays(key) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(key));
    if (!m || +m[2] < 1 || +m[2] > 12) throw new Error('잘못된 월 형식: ' + key);
    const y = +m[1], mo = +m[2];
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const days = [];
    for (let d = 1; d <= last; d++) days.push(key + '-' + pad2(d));
    return days;
  }

  /** '2026-11-13' → '11월 13일 (금)' */
  function formatKorean(iso) {
    const d = parse(iso);
    return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 (' + WEEKDAY_KO[weekday(iso)] + ')';
  }

  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('잘못된 시각 형식: ' + hhmm);
    return +m[1] * 60 + +m[2];
  }

  /** '20:00' → '20:50' = 50. 끝이 시작보다 이르면 자정을 넘긴 것으로 본다('23:30' → '00:30' = 60). */
  function minutesBetween(start, end) {
    let diff = toMinutes(end) - toMinutes(start);
    if (diff < 0) diff += 24 * 60;
    return diff;
  }

  SM.date = {
    today, addDays, isoWeek, weekDays, monthKey, monthDays,
    weekday, formatKorean, minutesBetween, WEEKDAY_KO
  };
})(window.SM = window.SM || {});
