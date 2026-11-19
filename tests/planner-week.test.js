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
    const store = SM.createStore(() => fakeStorage());
    return { store, planner: SM.createPlanner({ store, sid: 'SM01-2-3-15' }) };
  }
  const emptyGrid = () => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

  test('week: 몰림 판정 — 목표 분량이 있고 배치가 하루뿐인 과목만', () => {
    const grid = emptyGrid();
    grid.tue = ['수학:interleave', '영어:retrieval'];
    grid.thu = ['영어:spacing'];
    const week = { goals: [{ subject: '수학', text: '이차함수 40개' }, { subject: '영어', text: '단어 150개' }], grid };
    assert.deepEqual(P.clumped(week), [{ subject: '수학', day: 'tue' }]);
    // 목표가 비어 있으면 안내하지 않음
    assert.deepEqual(P.clumped({ goals: [{ subject: '수학', text: '  ' }], grid }), []);
    // 배치가 없으면(0일) 몰림 아님
    assert.deepEqual(P.clumped({ goals: [{ subject: '국어', text: '지문 6개' }], grid }), []);
    // 이틀 이상이면 몰림 아님
    grid.fri = ['수학:retrieval'];
    assert.deepEqual(P.clumped({ goals: [{ subject: '수학', text: '40개' }], grid }), []);
  });

  test('week: 자동 나누기 제안은 원래 요일을 포함한 서로 다른 3일 이상, 이틀 간격', () => {
    P.DAY_KEYS.forEach((d) => {
      const s = P.spreadSuggestion(d);
      assert.ok(s.length >= 3, d);
      assert.equal(new Set(s).size, s.length, d);
      assert.ok(s.indexOf(d) !== -1, d);
      const idx = s.map((x) => P.DAY_KEYS.indexOf(x)).sort((a, b) => a - b);
      for (let i = 1; i < idx.length; i++) assert.ok(idx[i] - idx[i - 1] >= 2, d + ' 간격');
    });
    assert.deepEqual(P.spreadSuggestion('mon'), ['mon', 'wed', 'fri']);
  });

  test('week: applySpread는 몰린 전략을 3일로 옮기고 다른 과목은 그대로', () => {
    const grid = emptyGrid();
    grid.tue = ['영어:retrieval', '수학:interleave', '수학:retrieval'];
    grid.sun = ['영어:spacing'];
    const out = P.applySpread(grid, '수학');
    assert.deepEqual(P.subjectDays(out, '수학'), ['tue', 'thu', 'sat']);
    assert.deepEqual(P.cellEntries(out, 'sat', '수학'), ['interleave', 'retrieval']);
    assert.deepEqual(P.cellEntries(out, 'tue', '영어'), ['retrieval']);
    assert.deepEqual(out.sun, ['영어:spacing']);
    assert.equal(P.clumped({ goals: [{ subject: '수학', text: '40개' }], grid: out }).length, 0);
  });

  test('week: 과목당 전략 2개까지, addWeeklyStrategy는 이번 주(월요일의 달 키)에 저장', () => {
    const { store, planner } = newPlanner();
    assert.ok(planner.addWeeklyStrategy('수학', 'interleave', '2026-W49').added);
    assert.ok(planner.addWeeklyStrategy('수학', 'interleave', '2026-W49').exists);
    assert.ok(planner.addWeeklyStrategy('수학', 'retrieval', '2026-W49').added);
    assert.ok(planner.addWeeklyStrategy('수학', 'spacing', '2026-W49').full);
    assert.deepEqual(store.get('planner:SM01-2-3-15:2026-11').weeks['2026-W49'].strategies, { 수학: ['interleave', 'retrieval'] });
  });

  test('week: plannerQueue를 이번 주로 옮기고 비움', () => {
    const { store, planner } = newPlanner();
    store.set('plan:SM01-2-3-15', { plannerQueue: [{ subject: '영어', id: 'retrieval' }, { subject: '영어', id: 'spacing' }, { subject: '영어', id: 'retrieval' }] });
    assert.equal(planner.drainQueue('plan:SM01-2-3-15', '2026-W46'), 2);
    assert.deepEqual(planner.getWeek('2026-W46').strategies, { 영어: ['retrieval', 'spacing'] });
    assert.deepEqual(store.get('plan:SM01-2-3-15').plannerQueue, []);
    assert.equal(planner.drainQueue('plan:SM01-2-3-15', '2026-W46'), 0);
  });

  test('week: 지난주 복사 — 전략·배치표·실행 의도만, 목표는 비움', () => {
    const grid = emptyGrid(); grid.mon = ['수학:interleave'];
    const last = {
      goals: [{ subject: '수학', text: '40개' }], strategies: { 수학: ['interleave'] }, grid,
      intentions: [{ text: '지난주 바꾼 것', from: 'lastWeek' }, { text: '만약 9시가 되면 푼다', from: 'seven' }], obstacle: '목요일 보강'
    };
    const cur = { goals: [{ subject: '수학', text: '새 목표' }], obstacle: '이번 주 장애물' };
    const out = P.copyFromLastWeek(cur, last);
    assert.deepEqual(out.goals, [{ subject: '수학', text: '' }]);
    assert.deepEqual(out.strategies, { 수학: ['interleave'] });
    assert.deepEqual(out.grid.mon, ['수학:interleave']);
    assert.deepEqual(out.intentions, [{ text: '만약 9시가 되면 푼다', from: 'seven' }]);
    assert.equal(out.obstacle, '이번 주 장애물');
    out.grid.mon.push('x'); assert.deepEqual(last.grid.mon, ['수학:interleave']);
  });

  test('week: 블록 요약, 지난주 키, 다음 주에 바꿀 한 가지, 일곱 전략 → 실행 의도', () => {
    const days = { '2026-11-09': [{ done: true }, { done: false }], '2026-11-11': [{ status: 'done' }] };
    const s = P.blockSummary('2026-W46', (iso) => days[iso] || []);
    assert.equal(s.length, 7);
    assert.deepEqual(s[0], { day: 'mon', date: '2026-11-09', planned: 2, done: 1 });
    assert.deepEqual(s[2], { day: 'wed', date: '2026-11-11', planned: 1, done: 1 });
    assert.equal(s[1].planned, 0);
    assert.equal(P.prevWeek('2026-W01'), '2025-W52');
    assert.equal(P.prevWeek('2026-W46'), '2026-W45');
    assert.equal(P.nextChangeOf({ review: { nextChange: ' 수요일엔 30분만 ' } }), '수요일엔 30분만');
    assert.equal(P.nextChangeOf({}), '');
    assert.equal(P.ruleToIntention('나는 저녁 9시가 되면 영단어를 떠올린다.'), '만약 저녁 9시가 되면 영단어를 떠올린다');
    assert.equal(P.ruleToIntention('  '), '');
  });

  test('week: 전략 선택지 — 이달 집중 → plan 과목 → plan 전체', () => {
    const plan = { strategies: { 수학: ['interleave', 'retrieval'], 영어: ['spacing'] } };
    assert.deepEqual(P.strategyChoices(['teach'], plan, '수학'), ['teach']);
    assert.deepEqual(P.strategyChoices([], plan, '수학'), ['interleave', 'retrieval']);
    assert.deepEqual(P.strategyChoices([], plan, '국어'), ['interleave', 'retrieval', 'spacing']);
    assert.deepEqual(P.strategyChoices([], null, '국어'), []);
    const ab = SM.data.strategies.map((x) => P.abbr(x.id));
    ab.forEach((a) => assert.ok(a.length >= 1 && a.length <= 5, a));
    assert.equal(new Set(ab).size, ab.length, '약칭 중복');
  });
})(window.SM);

test('week: 몰림 안내 조사 을/를', () => {
  assert.equal(window.SM.planner.objectJosa('수학'), '수학을');
  assert.equal(window.SM.planner.objectJosa('국어'), '국어를');
  assert.equal(window.SM.planner.objectJosa('과학'), '과학을');
});
