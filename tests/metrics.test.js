(function (SM) {
  'use strict';
  const M = SM.metrics;
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} 기대 ${b}, 실제 ${a}`);

  // 블록 만들기 도우미
  function blk(o) {
    const b = {
      subject: o.subject || '수학', start: o.start || '', end: o.end || '',
      target: { n: o.t === undefined ? null : o.t, unit: o.unit || '문제' },
      strategy: o.strategy === undefined ? 'interleave' : o.strategy, place: o.place || null
    };
    if (o.done) {
      b.done = Object.assign({ start: o.start || '', end: o.end || '', n: null, applied: null, focus: null, blockers: [] }, o.done);
    }
    return b;
  }

  test('metrics: 블록 0개면 모든 비율 null(0이 아님)', () => {
    const m = M.day([]);
    assert.deepEqual(m, {
      planned: 0, recorded: 0, executionRate: null, amountRate: null, strategyRate: null,
      plannedMin: 0, actualMin: 0, avgFocus: null
    });
    assert.deepEqual(M.day(undefined), m);
    // 계획만 있고 기록이 없으면 이행률 0, 나머지는 null
    const p = M.day([blk({ t: 10 })]);
    assert.equal(p.executionRate, 0);
    assert.equal(p.amountRate, null);
    assert.equal(p.strategyRate, null);
    assert.equal(M.pct(null), '기록 없음');
    assert.equal(M.pct(0.734), '73%');
  });

  test('metrics: 전략 적용률 — yes 1, partial 0.5, no 0 / 기록 블록', () => {
    const m = M.day([
      blk({ done: { applied: 'yes' } }),
      blk({ done: { applied: 'partial' } }),
      blk({ done: { applied: 'no' } }),
      blk({ done: { applied: 'partial' } }),
      blk({})                                   // 기록 전: 분모에 안 들어감
    ]);
    near(m.strategyRate, (1 + 0.5 + 0 + 0.5) / 4);
    assert.equal(m.planned, 5);
    assert.equal(m.recorded, 4);
    near(m.executionRate, 0.8);
    near(M.day([blk({ done: { applied: 'partial' } })]).strategyRate, 0.5);
    // 전략 없는 기록 블록은 적용률 분모에서 뺀다
    near(M.day([blk({ done: { applied: 'yes' } }), blk({ strategy: null, done: {} })]).strategyRate, 1);
    assert.equal(M.day([blk({ strategy: null, done: {} })]).strategyRate, null);
  });

  test('metrics: 달성률 — 같은 단위는 Σn/Σtarget, 섞이면 블록별 평균', () => {
    // 같은 단위: (30 + 10) / (40 + 10) = 0.8
    near(M.day([blk({ t: 40, done: { n: 30 } }), blk({ t: 10, done: { n: 10 } })]).amountRate, 0.8);
    // 단위 섞임: (30/40 + 5/10) / 2 = 0.625
    near(M.day([blk({ t: 40, unit: '문제', done: { n: 30 } }), blk({ t: 10, unit: '쪽', done: { n: 5 } })]).amountRate, 0.625);
    // 100% 넘을 수 있음
    near(M.day([blk({ t: 20, done: { n: 30 } })]).amountRate, 1.5);
    // 목표 없는 블록은 빠짐
    near(M.day([blk({ t: null, done: { n: 30 } }), blk({ t: 10, done: { n: 5 } })]).amountRate, 0.5);
    assert.equal(M.day([blk({ t: null, done: { n: 30 } })]).amountRate, null);
    assert.equal(M.achievement(blk({ t: 40, done: { n: 32 } })), 80);
  });

  test('metrics: 시간·집중도', () => {
    const m = M.day([
      blk({ start: '19:00', end: '20:00', done: { start: '19:10', end: '20:00', focus: 4 } }),
      blk({ start: '23:30', end: '00:15', done: { focus: 2 } }),     // 자정 넘김, 실제 시간 = 계획 시간
      blk({ start: '', end: '' })
    ]);
    assert.equal(m.plannedMin, 60 + 45);
    assert.equal(m.actualMin, 50 + 45);
    near(m.avgFocus, 3);
    assert.equal(M.minutes('25:00', '26:00'), 0);
  });

  // 2026-W46: 11/09(월) ~ 11/15(일)
  function weekData() {
    const d = {};
    d['2026-11-09'] = [
      blk({ subject: '수학', start: '19:00', end: '21:00', place: 'home', done: { applied: 'yes', focus: 4, blockers: ['phone', 'sleepy'] } }),
      blk({ subject: '영어', strategy: 'retrieval', start: '21:00', end: '21:30', done: { applied: 'partial', focus: 3, blockers: ['phone'] } })
    ];
    d['2026-11-11'] = [
      blk({ subject: '수학', start: '19:00', end: '19:30', place: 'cafe', done: { applied: 'no', focus: 2, blockers: ['noise', 'phone'] } }),
      blk({ subject: '영어', strategy: 'retrieval', start: '20:00', end: '20:30', done: { applied: 'yes', place: 'library', focus: 5, blockers: ['sleepy', 'hard'] } })
    ];
    d['2026-11-13'] = [
      blk({ subject: '수학', start: '19:00', end: '19:30', place: 'home', done: { applied: 'yes', focus: 5, blockers: ['hard'] } }),
      blk({ subject: '국어', start: '20:00', end: '21:00' })     // 기록 전
    ];
    return (iso) => d[iso] || [];
  }

  test('metrics: week — 요일 7개, 합계, 전략별 적용률', () => {
    const w = M.week('2026-W46', weekData());
    assert.equal(w.days.length, 7);
    assert.deepEqual(w.days.map((x) => x.day), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    assert.equal(w.days[0].date, '2026-11-09');
    assert.equal(w.days[1].executionRate, null);
    assert.equal(w.total.planned, 6);
    assert.equal(w.total.recorded, 5);
    assert.equal(w.total.actualMin, 120 + 30 + 30 + 30 + 30);
    near(w.byStrategy.interleave, (1 + 0 + 1) / 3);
    near(w.byStrategy.retrieval, (0.5 + 1) / 2);
  });

  test('metrics: week — 방해 요인 상위 3(같으면 정해진 순서)', () => {
    const w = M.week('2026-W46', weekData());
    // phone 3, sleepy 2, hard 2, noise 1 → sleepy가 hard보다 앞
    assert.deepEqual(w.blockersTop, [{ id: 'phone', count: 3 }, { id: 'sleepy', count: 2 }, { id: 'hard', count: 2 }]);
    assert.deepEqual(M.week('2026-W46', () => []).blockersTop, []);
  });

  test('metrics: week — 같은 과목 하루 몰림 비율, 과목별 시간, 장소별 집중도', () => {
    const w = M.week('2026-W46', weekData());
    assert.deepEqual(w.minutesBySubject, { 수학: 180, 영어: 60 });
    near(w.clumpBySubject['수학'], 120 / 180);
    near(w.clumpBySubject['영어'], 0.5);
    assert.equal(w.clumpBySubject['국어'], undefined, '기록 없는 과목은 없음');
    // 한 날에만 했으면 1
    const one = M.week('2026-W46', (iso) => (iso === '2026-11-10' ? [blk({ start: '19:00', end: '20:00', done: {} }), blk({ start: '21:00', end: '21:30', done: {} })] : []));
    near(one.clumpBySubject['수학'], 1);
    // 장소: 실제 장소가 있으면 그것, 없으면 계획 장소
    near(w.focusByPlace.home, 4.5);
    near(w.focusByPlace.cafe, 2);
    near(w.focusByPlace.library, 5);
  });

  test('metrics: month — 그 달에 걸친 주차별 week()', () => {
    const list = M.month('2026-11', weekData());
    assert.deepEqual(list.map((w) => w.isoWeek), ['2026-W44', '2026-W45', '2026-W46', '2026-W47', '2026-W48', '2026-W49']);
    assert.equal(list[2].total.recorded, 5);
    assert.equal(list[0].total.executionRate, null);
  });

  test('metrics: 달력 단계(색 + 숫자)', () => {
    const L = (rate, recorded) => M.level({ recorded: recorded === undefined ? 1 : recorded, strategyRate: rate });
    assert.equal(L(0.7), 'high');
    assert.equal(L(0.69), 'mid');
    assert.equal(L(0.4), 'mid');
    assert.equal(L(0.39), 'low');
    assert.equal(L(0.01), 'low');
    assert.equal(L(0), 'zero');
    assert.equal(L(null), 'nostrategy');
    assert.equal(L(null, 0), 'none');
    assert.equal(M.level(null), 'none');
  });
})(window.SM);
