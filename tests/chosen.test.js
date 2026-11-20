(function (SM) {
  'use strict';

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

  const P = SM.planner;
  const TODAY = '2026-11-20';          // 금요일, 2026-W47(11/16~11/22)
  const WK = '2026-W47';
  const NEXT = '2026-W48';

  function plan() {
    return {
      strategies: { 수학: ['retrieval', 'interleave', 'workedExample'], 영어: ['spacing', 'retrieval', 'keyword'] },
      habits: [], confirmed: false
    };
  }
  function planner() {
    const store = SM.createStore(() => fakeStorage());
    return SM.createPlanner({ store, sid: () => 'DEMO-1-1-5' });
  }
  const way = (subject, id) => `way:${id}`;

  // ---------- 과목마다 하나 ----------

  test('chosen: 과목마다 하나만 고르고, 추천 3개 목록은 그대로', () => {
    const p = plan();
    const before = JSON.stringify(p.strategies);
    let r = P.chooseStrategy(p, '수학', 'interleave', TODAY);
    assert.deepEqual([r.ok, r.prev, r.changed], [true, null, true]);
    r = P.chooseStrategy(p, '수학', 'workedExample', '2026-11-21');
    assert.deepEqual([r.ok, r.prev, r.changed], [true, 'interleave', true], '다른 카드를 누르면 선택이 옮겨짐');
    P.chooseStrategy(p, '영어', 'spacing', TODAY);
    assert.deepEqual(p.chosen, { 수학: 'workedExample', 영어: 'spacing' }, '과목당 하나');
    assert.deepEqual(p.chosenAt, { 수학: '2026-11-21', 영어: TODAY });
    assert.equal(JSON.stringify(p.strategies), before);
  });

  test('chosen: 같은 것을 다시 누르면 그대로, 추천 3개 밖의 전략은 고를 수 없음', () => {
    const p = plan();
    P.chooseStrategy(p, '수학', 'interleave', TODAY);
    assert.deepEqual(P.chooseStrategy(p, '수학', 'interleave', '2026-11-22'), { ok: true, prev: 'interleave', changed: false });
    assert.equal(p.chosenAt.수학, TODAY, '날짜도 그대로');
    assert.equal(P.chooseStrategy(p, '수학', 'loci', TODAY).ok, false);
    assert.equal(P.chooseStrategy(p, '과학', 'retrieval', TODAY).ok, false, '추천이 없는 과목');
    assert.equal(p.chosen.수학, 'interleave');
  });

  test('chosen: 예전 데이터(chosen 없음)는 빈 상태로 시작하고 자동으로 고르지 않음', () => {
    assert.deepEqual(P.chosenOf(plan()), {});
    assert.deepEqual(P.chosenOf(null), {});
    assert.deepEqual(P.chosenOf({ chosen: { 수학: 'interleave', 영어: '없는전략' } }), { 수학: 'interleave' });
  });

  // ---------- 플래너에 보이기 ----------

  test('chosen: 주간 적용 전략에 고른 전략이 맨 앞에, 학생이 빼면 다시 넣지 않음', () => {
    const week = P.normalizeWeek({ strategies: { 수학: ['retrieval'] } });
    assert.equal(P.seedChosenIntoWeek(week, { 수학: 'interleave', 영어: 'spacing' }), true);
    assert.deepEqual(week.strategies, { 수학: ['interleave', 'retrieval'], 영어: ['spacing'] });
    week.strategies.수학 = ['retrieval'];            // 학생이 뺐다
    assert.equal(P.seedChosenIntoWeek(week, { 수학: 'interleave', 영어: 'spacing' }), false);
    assert.deepEqual(week.strategies.수학, ['retrieval']);
    // 가득 차 있으면 2개를 넘지 않음
    const full = P.normalizeWeek({ strategies: { 수학: ['retrieval', 'errorLog'] } });
    P.seedChosenIntoWeek(full, { 수학: 'interleave' });
    assert.deepEqual(full.strategies.수학, ['interleave', 'retrieval']);
  });

  test('chosen: 월간 집중 전략 기본값은 고른 전략(비었을 때 한 번만)', () => {
    const m = P.normalize(null).month;
    assert.equal(P.seedMonthFocus(m, {}), false);
    assert.equal(P.seedMonthFocus(m, { 수학: 'interleave', 영어: 'spacing', 국어: 'interleave' }), true);
    assert.deepEqual(m.focusStrategies, ['interleave', 'spacing']);
    m.focusStrategies = [];                          // 학생이 다 지움
    assert.equal(P.seedMonthFocus(m, { 수학: 'interleave' }), false, '다시 채우지 않음');
    const mine = P.normalize({ month: { focusStrategies: ['metacog'] } }).month;
    assert.equal(P.seedMonthFocus(mine, { 수학: 'interleave' }), false, '학생이 고른 집중 전략은 그대로');
  });

  test('chosen: applyChosen은 이번 주·이번 달에 넣고, 두 번 해도 같음', () => {
    const pl = planner();
    const r = pl.applyChosen({ 수학: 'interleave' }, TODAY);
    assert.deepEqual(r, { week: WK, month: true });
    assert.deepEqual(P.normalizeWeek(pl.getWeek(WK)).strategies.수학, ['interleave']);
    assert.deepEqual(pl.load('2026-11').month.focusStrategies, ['interleave']);
    assert.deepEqual(pl.applyChosen({ 수학: 'interleave' }, TODAY), { week: null, month: false });
  });

  // ---------- 일간 블록 자동 채움 ----------

  test('chosen: 일간 블록에서 과목을 고르면 그 과목의 고른 전략과 실행 방식이 채워짐', () => {
    const chosen = { 수학: 'interleave', 영어: 'spacing' };
    const b = P.newBlock();
    b.subject = '수학';
    assert.equal(P.autoFillStrategy(b, '', chosen, way), true);
    assert.deepEqual([b.strategy, b.method], ['interleave', 'way:interleave']);
    // 과목을 바꾸면 자동으로 들어간 전략·실행 방식도 바뀜
    b.subject = '영어';
    assert.equal(P.autoFillStrategy(b, '수학', chosen, way), true);
    assert.deepEqual([b.strategy, b.method], ['spacing', 'way:spacing']);
    // 고른 전략이 없는 과목이면 비움
    b.subject = '국어';
    P.autoFillStrategy(b, '영어', chosen, way);
    assert.deepEqual([b.strategy, b.method], [null, '']);
    // 점검 질문은 블록 전략에서 나온다 → 고른 전략의 질문 2개
    b.subject = '수학';
    P.autoFillStrategy(b, '국어', chosen, way);
    const s = SM.data.strategies.find((x) => x.id === b.strategy);
    assert.equal(s.checkQuestions.length, 2);
  });

  test('chosen: 학생이 직접 고른 전략·고쳐 쓴 실행 방식·기록한 블록은 그대로', () => {
    const chosen = { 수학: 'interleave', 영어: 'spacing' };
    const manual = Object.assign(P.newBlock(), { subject: '영어', strategy: 'errorLog', method: '내가 쓴 방식' });
    assert.equal(P.autoFillStrategy(manual, '수학', chosen, way), false);
    assert.equal(manual.strategy, 'errorLog');
    const edited = Object.assign(P.newBlock(), { subject: '영어', strategy: 'interleave', method: '내가 고친 방식' });
    P.autoFillStrategy(edited, '수학', chosen, way);
    assert.deepEqual([edited.strategy, edited.method], ['spacing', '내가 고친 방식']);
    const done = Object.assign(P.newBlock(), { subject: '영어', strategy: null, done: { applied: 'yes' } });
    assert.equal(P.autoFillStrategy(done, '수학', chosen, way), false);
    assert.equal(done.strategy, null);
  });

  // ---------- 선택을 바꿀 때 ----------

  function seedPlanner() {
    const pl = planner();
    const blk = (over) => Object.assign(P.newBlock(), { subject: '수학', strategy: 'interleave', method: 'way:interleave' }, over);
    pl.saveDay('2026-11-18', [blk({ id: 'past' })]);                                   // 지나간 날
    pl.saveDay(TODAY, [blk({ id: 'todayDone', done: { applied: 'yes' } }), blk({ id: 'today' }),
      blk({ id: 'eng', subject: '영어' }), blk({ id: 'custom', method: '내 방식' })]);
    pl.saveDay('2026-11-24', [blk({ id: 'nextWeek' })]);
    pl.saveWeek(WK, P.normalizeWeek({
      strategies: { 수학: ['interleave', 'retrieval'] },
      grid: { wed: ['수학:interleave'], fri: ['수학:interleave'], sat: ['수학:interleave', '영어:spacing'] }
    }));
    pl.saveWeek(NEXT, P.normalizeWeek({ strategies: { 수학: ['interleave'] }, grid: { mon: ['수학:interleave'] } }));
    return pl;
  }
  const blockOf = (pl, iso, id) => pl.getDay(iso).find((b) => b.id === id);

  test('chosen: 선택을 바꾸면 오늘 이후 블록만 바꾸고, 지나간 날·기록한 블록은 유지', () => {
    const pl = seedPlanner();
    const n = pl.replaceChosen('수학', 'interleave', 'workedExample', { today: TODAY, dryRun: true });
    assert.deepEqual(n, { blocks: 3, weeks: 2 }, '오늘 2개 + 다음 주 1개, 이번 주·다음 주 계획');
    assert.equal(blockOf(pl, TODAY, 'today').strategy, 'interleave', 'dryRun은 세기만');

    pl.replaceChosen('수학', 'interleave', 'workedExample', { today: TODAY, wayFor: way });
    assert.equal(blockOf(pl, '2026-11-18', 'past').strategy, 'interleave', '지나간 날 그대로');
    assert.equal(blockOf(pl, TODAY, 'todayDone').strategy, 'interleave', '기록한 블록 그대로');
    assert.deepEqual([blockOf(pl, TODAY, 'today').strategy, blockOf(pl, TODAY, 'today').method], ['workedExample', 'way:workedExample']);
    assert.deepEqual([blockOf(pl, TODAY, 'custom').strategy, blockOf(pl, TODAY, 'custom').method], ['workedExample', '내 방식']);
    assert.equal(blockOf(pl, TODAY, 'eng').strategy, 'interleave', '다른 과목 그대로');
    assert.equal(blockOf(pl, '2026-11-24', 'nextWeek').strategy, 'workedExample');
  });

  test('chosen: 선택을 바꾸면 이번 주 계획은 오늘 이후 칸만, 다음 주는 전부 바뀜', () => {
    const pl = seedPlanner();
    pl.replaceChosen('수학', 'interleave', 'workedExample', { today: TODAY, wayFor: way });
    const w = P.normalizeWeek(pl.getWeek(WK));
    assert.deepEqual(w.strategies.수학, ['workedExample', 'retrieval']);
    assert.deepEqual(w.grid.wed, ['수학:interleave'], '지나간 수요일 칸 그대로');
    assert.deepEqual(w.grid.fri, ['수학:workedExample']);
    assert.deepEqual(w.grid.sat, ['수학:workedExample', '영어:spacing']);
    const n = P.normalizeWeek(pl.getWeek(NEXT));
    assert.deepEqual([n.strategies.수학, n.grid.mon], [['workedExample'], ['수학:workedExample']]);
    // 이미 새 전략이 있으면 옛 것만 빠짐(중복 없음)
    const pl2 = planner();
    pl2.saveWeek(WK, P.normalizeWeek({ strategies: { 수학: ['interleave', 'workedExample'] } }));
    pl2.replaceChosen('수학', 'interleave', 'workedExample', { today: TODAY });
    assert.deepEqual(P.normalizeWeek(pl2.getWeek(WK)).strategies.수학, ['workedExample']);
  });

  test('chosen: 바꿀 계획이 없으면 0(확인 창을 띄우지 않음), 이달 집중 전략도 새 전략으로', () => {
    const pl = planner();
    assert.deepEqual(pl.replaceChosen('수학', 'interleave', 'workedExample', { today: TODAY, dryRun: true }), { blocks: 0, weeks: 0 });
    pl.applyChosen({ 수학: 'interleave' }, TODAY);
    pl.replaceChosen('수학', 'interleave', 'workedExample', { today: TODAY });
    assert.deepEqual(pl.load('2026-11').month.focusStrategies, ['workedExample']);
    assert.deepEqual(P.normalizeWeek(pl.getWeek(WK)).autoChosen, { 수학: 'workedExample' }, '다시 넣지 않도록 기억도 바꿈');
  });
})(window.SM = window.SM || {});
