(function (SM) {
  'use strict';
  const P = SM.planner;

  function fakeStorage() {
    const map = new Map();
    return {
      get length() { return map.size; },
      key(i) { const k = Array.from(map.keys())[i]; return k === undefined ? null : k; },
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(String(k), String(v)); },
      removeItem(k) { map.delete(k); }
    };
  }
  function newPlanner() {
    const backend = fakeStorage();
    const store = SM.createStore(() => backend);
    return { store, planner: SM.createPlanner({ store, sid: 'SM01-2-3-15' }) };
  }

  test('planner: monthKeyForWeek — 11월 말~12월 초는 월요일이 속한 11월', () => {
    assert.deepEqual(SM.date.weekDays('2026-W49').slice(0, 1).concat(SM.date.weekDays('2026-W49').slice(6)), ['2026-11-30', '2026-12-06']);
    assert.equal(P.monthKeyForWeek('2026-W49'), '2026-11');
    assert.equal(P.monthKeyForWeek('2026-W50'), '2026-12');
    assert.equal(P.monthKeyForWeek('2026-W48'), '2026-11');
  });

  test('planner: monthKeyForWeek — 12월 말~1월 초', () => {
    // 2026-W53: 2026-12-28(월) ~ 2027-01-03(일)
    assert.equal(SM.date.weekDays('2026-W53')[0], '2026-12-28');
    assert.equal(P.monthKeyForWeek('2026-W53'), '2026-12');
    // 2027-W52: 2027-12-27(월) ~ 2028-01-02(일)
    assert.equal(P.monthKeyForWeek('2027-W52'), '2027-12');
    // 2025-W01: 2024-12-30(월) ~ 2025-01-05 → 월요일이 속한 2024-12
    assert.equal(P.monthKeyForWeek('2025-W01'), '2024-12');
    assert.equal(P.monthKeyForWeek('2027-W01'), '2027-01');
  });

  test('planner: saveWeek은 월요일 달 키에, getWeek으로 다시 읽음', () => {
    const { store, planner } = newPlanner();
    planner.saveWeek('2026-W49', { focus: '교차 연습' });
    assert.deepEqual(store.get('planner:SM01-2-3-15:2026-11').weeks['2026-W49'], { focus: '교차 연습' });
    assert.equal(store.get('planner:SM01-2-3-15:2026-12', null), null);
    assert.deepEqual(planner.getWeek('2026-W49'), { focus: '교차 연습' });
    assert.deepEqual(planner.getWeek('2026-W50'), {});
  });

  test('planner: saveDay/getDay는 그 날의 달 키, 기존 달 데이터 유지', () => {
    const { store, planner } = newPlanner();
    const d = planner.load('2026-12');
    d.month.goals = ['영어 단어'];
    planner.save('2026-12', d);
    planner.saveDay('2026-12-01', [{ id: 'b1', minutes: 30 }]);
    assert.deepEqual(planner.getDay('2026-12-01'), [{ id: 'b1', minutes: 30 }]);
    assert.deepEqual(store.get('planner:SM01-2-3-15:2026-12').month.goals, ['영어 단어']);
    assert.deepEqual(planner.getDay('2026-12-02'), []);
  });

  test('planner: load는 빈 달도 기본 형식', () => {
    const { planner } = newPlanner();
    const d = planner.load('2026-11');
    assert.deepEqual(d.month.goals, ['']);
    assert.deepEqual(d.month.events, []);
    assert.equal(d.month.public, false);
    assert.deepEqual(d.weeks, {});
    assert.deepEqual(d.days, {});
  });

  test('planner: ddayFrom — 가장 가까운 시험, 기타·지난 일정 제외', () => {
    const events = [
      { date: '2026-11-10', title: '국어', kind: '수행평가' },
      { date: '2026-11-20', title: '체육대회', kind: '기타' },
      { date: '2026-12-01', title: '', kind: '기말고사' },
      { date: '2026-11-28', title: '수학', kind: '수행평가' }
    ];
    const d = P.ddayFrom(events, '2026-11-13');
    assert.equal(d.days, 15);
    assert.equal(d.label, 'D-15 수학 수행평가');
    assert.equal(P.ddayFrom(events, '2026-11-29').label, 'D-2 기말고사');
    assert.equal(P.ddayFrom(events, '2026-12-01').label, 'D-DAY 기말고사');
    assert.equal(P.ddayFrom(events, '2026-12-02'), null);
    assert.equal(P.ddayFrom([], '2026-11-13'), null);
    assert.equal(P.ddayFrom([{ date: '2026-11-14', title: '수학 수행평가', kind: '수행평가' }], '2026-11-13').label, 'D-1 수학 수행평가');
  });

  test('planner: nextDday — 여러 달 키에서 찾고 해를 넘김', () => {
    const { planner } = newPlanner();
    const dec = planner.load('2026-12');
    dec.month.events = [{ id: 'a', date: '2026-12-20', title: '영어', kind: '모의고사' }];
    planner.save('2026-12', dec);
    const jan = planner.load('2027-01');
    jan.month.events = [{ id: 'b', date: '2027-01-05', title: '수학', kind: '수행평가' }];
    planner.save('2027-01', jan);
    assert.equal(planner.nextDday('2026-11-13').label, 'D-37 영어 모의고사');
    assert.equal(planner.nextDday('2026-12-21').label, 'D-15 수학 수행평가');
    assert.equal(planner.nextDday('2027-01-06'), null);
  });

  test('planner: shiftMonth, calendarRows(월요일 시작)', () => {
    assert.equal(P.shiftMonth('2026-12', 1), '2027-01');
    assert.equal(P.shiftMonth('2026-01', -1), '2025-12');
    const rows = P.calendarRows('2026-11'); // 2026-11-01은 일요일
    assert.equal(rows[0][6], '2026-11-01');
    assert.equal(rows[0][0], null);
    assert.equal(rows[rows.length - 1][0], '2026-11-30');
    assert.ok(rows.every((r) => r.length === 7));
  });
})(window.SM);
