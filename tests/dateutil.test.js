(function (SM) {
  'use strict';
  const D = SM.date;

  test('isoWeek: 예시 날짜 2026-11-13 → 2026-W46', () => {
    assert.equal(D.isoWeek('2026-11-13'), '2026-W46');
  });

  test('isoWeek: 2026-12-31(목)은 2026-W53', () => {
    assert.equal(D.isoWeek('2026-12-31'), '2026-W53');
  });

  test('isoWeek: 2027-01-01(금)은 전년도 2026-W53', () => {
    assert.equal(D.isoWeek('2027-01-01'), '2026-W53');
  });

  test('isoWeek: 2027-01-03(일)까지 2026-W53, 2027-01-04(월)부터 2027-W01', () => {
    assert.equal(D.isoWeek('2027-01-03'), '2026-W53');
    assert.equal(D.isoWeek('2027-01-04'), '2027-W01');
  });

  test('isoWeek: 2025-12-29(월)는 다음 해 2026-W01', () => {
    assert.equal(D.isoWeek('2025-12-29'), '2026-W01');
    assert.equal(D.isoWeek('2026-01-01'), '2026-W01');
  });

  test('isoWeek: 2024-12-30(월)은 2025-W01, 2021-01-03(일)은 2020-W53', () => {
    assert.equal(D.isoWeek('2024-12-30'), '2025-W01');
    assert.equal(D.isoWeek('2021-01-03'), '2020-W53');
  });

  test('isoWeek: 2027-12-31(금)은 2027-W52', () => {
    assert.equal(D.isoWeek('2027-12-31'), '2027-W52');
  });

  test('addDays: 월말·연말·윤년 넘김', () => {
    assert.equal(D.addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(D.addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(D.addDays('2026-01-31', 30), '2026-03-02');
  });

  test('weekDays: 길이 7, 월요일 시작', () => {
    const days = D.weekDays('2026-W46');
    assert.equal(days.length, 7);
    assert.equal(days[0], '2026-11-09');
    assert.equal(days[6], '2026-11-15');
    assert.equal(D.weekday(days[0]), 0);
  });

  test('weekDays: 연도 경계 주 2026-W53, 2026-W01', () => {
    assert.deepEqual(D.weekDays('2026-W53'), [
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
      '2027-01-01', '2027-01-02', '2027-01-03'
    ]);
    assert.equal(D.weekDays('2026-W01')[0], '2025-12-29');
  });

  test('weekDays: 없는 주차는 예외', () => {
    assert.throws(() => D.weekDays('2027-W53'));
    assert.throws(() => D.weekDays('2026-W00'));
  });

  test('monthKey / monthDays', () => {
    assert.equal(D.monthKey('2026-11-13'), '2026-11');
    assert.equal(D.monthDays('2026-11').length, 30);
    assert.equal(D.monthDays('2026-02').length, 28);
    assert.equal(D.monthDays('2028-02').length, 29);
    assert.equal(D.monthDays('2026-12')[30], '2026-12-31');
  });

  test('weekday: 0(월)~6(일)', () => {
    assert.equal(D.weekday('2026-11-09'), 0);
    assert.equal(D.weekday('2026-11-13'), 4);
    assert.equal(D.weekday('2026-11-15'), 6);
  });

  test('formatKorean', () => {
    assert.equal(D.formatKorean('2026-11-13'), '11월 13일 (금)');
    assert.equal(D.formatKorean('2027-01-03'), '1월 3일 (일)');
  });

  test('minutesBetween: 같은 날, 자정 넘김', () => {
    assert.equal(D.minutesBetween('20:00', '20:50'), 50);
    assert.equal(D.minutesBetween('09:15', '11:00'), 105);
    assert.equal(D.minutesBetween('23:30', '00:30'), 60);
    assert.equal(D.minutesBetween('10:00', '10:00'), 0);
  });

  test('today: 로컬 시간 기준 YYYY-MM-DD', () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(D.today()));
    assert.equal(D.today(new Date(2026, 10, 13, 23, 59)), '2026-11-13');
    assert.equal(D.today(new Date(2027, 0, 1, 0, 5)), '2027-01-01');
  });

  test('잘못된 입력은 예외', () => {
    assert.throws(() => D.addDays('2026-02-30', 1));
    assert.throws(() => D.isoWeek('2026/11/13'));
    assert.throws(() => D.minutesBetween('25:00', '10:00'));
  });
})(window.SM);
