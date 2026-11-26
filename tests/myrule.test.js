(function (SM) {
  'use strict';

  // 나만의 한 가지 전략: 스키마 2 마이그레이션, 문장 만들기, 저장 기록, 주간 지킨 날

  const R = SM.recommend;
  const S2 = SM.schema2;
  const SID = 'SM01-2-3-15';

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

  const SEVEN_OLD = [
    { text: '나는 저녁 9시가 되면 수학 기초 문제 세트를 시간을 재며 푼다.', strategyId: 'automation', habitId: null },
    { text: '나는 공부를 마치면 오늘 배운 내용을 내 말로 바꿔 한 줄 적는다.', strategyId: 'elaboration', habitId: null },
    { text: '', strategyId: null, habitId: null },
    { text: '나는 틀린 문제가 나오면 오답 노트에 옮긴다.', strategyId: 'errorLog', habitId: null },
    { text: '나는 시험 3일 전이 되면 머리글자로 단서를 만든다.', strategyId: 'acronym', habitId: null },
    { text: '나는 주말이 되면 지난주 내용을 섞어 푼다.', strategyId: 'interleave', habitId: null },
    { text: '나는 문제를 풀기 전에 1분 동안 개념을 적는다.', strategyId: null, habitId: 'conceptCheck' },
    { text: '나는 밤 11시가 되면 잠자리에 든다.', strategyId: null, habitId: 'sleepGuard' }
  ];

  /** v1 데이터를 넣은 저장소(meta.schema 1) */
  function v1Backend() {
    const b = fakeStorage();
    b.setItem('sm:v1:meta', JSON.stringify({ schema: 1 }));
    b.setItem('sm:v1:plan:' + SID, JSON.stringify({
      strategies: { 수학: ['retrieval', 'interleave', 'automation'] }, chosen: { 수학: 'interleave' },
      sevenRules: SEVEN_OLD, updatedAt: '2026-11-15T10:00:00.000Z'
    }));
    b.setItem('sm:v1:checkin:' + SID, JSON.stringify([
      { isoWeek: '2026-W46', scores: { b1: 3 }, seven: [{ text: '', status: null }, { text: SEVEN_OLD[1].text, status: 'kept' }] },
      { isoWeek: '2026-W47', scores: {}, seven: [] }
    ]));
    b.setItem('sm:v1:planner:' + SID + ':2026-11', JSON.stringify({
      month: {}, days: {},
      weeks: { '2026-W47': { intentions: [{ text: '만약 9시가 되면 푼다', from: 'seven' }, { text: '지난주 것', from: 'lastWeek' }] } }
    }));
    return b;
  }

  // ---------- 마이그레이션 ----------

  test('myRule 마이그레이션: sevenRules 7개 → myRule 1개 + history 6개, sevenRules 삭제', () => {
    const store = SM.createStore(() => v1Backend());
    assert.equal(store.migrate(), 2);
    assert.deepEqual(store.get('meta'), { schema: 2 });
    const plan = store.get('plan:' + SID);
    assert.equal('sevenRules' in plan, false);
    assert.equal(plan.myRule.text, SEVEN_OLD[0].text, '비어 있지 않은 첫 문장');
    assert.deepEqual([plan.myRule.situation, plan.myRule.action], ['저녁 9시가 되면', '수학 기초 문제 세트를 시간을 재며 푼다']);
    assert.deepEqual([plan.myRule.strategyId, plan.myRule.updatedAt], ['automation', '2026-11-15T10:00:00.000Z']);
    assert.equal(plan.myRuleHistory.length, 6, '빈 칸은 빼고 나머지 6개');
    assert.deepEqual(plan.myRuleHistory.map((r) => r.text), SEVEN_OLD.slice(1).filter((r) => r.text).map((r) => r.text));
    assert.deepEqual(plan.chosen, { 수학: 'interleave' }, '다른 필드는 그대로');
  });

  test('myRule 마이그레이션: 두 번 실행해도 결과가 같음(meta를 지워 강제로 다시 돌려도)', () => {
    const backend = v1Backend();
    const store = SM.createStore(() => backend);
    store.migrate();
    const snap = () => ['plan:', 'checkin:', 'planner:'].map((p) => JSON.stringify(store.keys(p).map((k) => store.get(k))));
    const once = snap();
    assert.equal(store.migrate(), 2, 'meta가 2면 다시 돌지 않음');
    assert.deepEqual(snap(), once);
    backend.removeItem('sm:v1:meta');
    const again = SM.createStore(() => backend);
    assert.equal(again.migrate(), 2);
    assert.deepEqual(['plan:', 'checkin:', 'planner:'].map((p) => JSON.stringify(again.keys(p).map((k) => again.get(k)))), once);
    assert.equal(S2.migrateV2(again), 0, '바꿀 것이 없음');
  });

  test('myRule 마이그레이션: 주간 점검표 seven → myRule, 실행 의도 from seven → myRule', () => {
    const store = SM.createStore(() => v1Backend());
    store.migrate();
    const list = store.get('checkin:' + SID);
    assert.deepEqual(list[0], { isoWeek: '2026-W46', scores: { b1: 3 }, myRule: { text: SEVEN_OLD[1].text, status: 'kept' } });
    assert.deepEqual(list[1], { isoWeek: '2026-W47', scores: {} }, '문장이 없던 주');
    const pl = store.get('planner:' + SID + ':2026-11');
    assert.deepEqual(pl.weeks['2026-W47'].intentions.map((x) => x.from), ['myRule', 'lastWeek']);
  });

  test('myRule 마이그레이션: 빈 sevenRules, 이미 myRule이 있는 plan, 이상한 값', () => {
    assert.deepEqual(S2.planToV2({ sevenRules: [{ text: ' ' }], a: 1 }), { a: 1, myRuleHistory: [] });
    const cur = { text: '나는 새 단원을 시작하면 개념도를 그린다.', updatedAt: 'x' };
    const both = S2.planToV2({ myRule: cur, sevenRules: [{ text: '옛 문장' }] });
    assert.deepEqual([both.myRule, both.myRuleHistory.map((r) => r.text)], [cur, ['옛 문장']], '지금 문장은 두고 옛 것은 기록으로');
    const plain = { myRule: cur };
    assert.equal(S2.planToV2(plain), plain, 'sevenRules가 없으면 그대로');
    assert.equal(S2.planToV2(null), null);
    assert.deepEqual(S2.splitRuleText('나는 그냥 열심히 한다.'), { situation: '', action: '' });
    assert.deepEqual(S2.splitRuleText('나는 문제를 풀기 전에 조건에 밑줄을 긋는다.'), { situation: '문제를 풀기 전에', action: '조건에 밑줄을 긋는다' });
  });

  test('myRule: v1 백업도 가져오고 가져온 뒤 바로 한 가지 전략으로 바뀜, 새 버전 백업은 거절', () => {
    const store = SM.createStore(() => fakeStorage());
    store.init();
    const r = store.importAll({ version: 1, sid: SID, data: { ['plan:' + SID]: { sevenRules: SEVEN_OLD.slice(0, 2) } } });
    assert.equal(r.added, 1);
    const plan = store.get('plan:' + SID);
    assert.deepEqual([plan.myRule.text, plan.myRuleHistory.length, 'sevenRules' in plan], [SEVEN_OLD[0].text, 1, false]);
    assert.throws(() => store.importAll({ version: 3, sid: SID, data: {} }));
    assert.throws(() => store.importAll({ version: 0, sid: SID, data: {} }));
  });

  // ---------- 문장 만들기 ----------

  function result(extended) {
    return {
      takenAt: '2026-11-13', subjects: ['수학'], weakness: [{ subject: '수학', codes: [] }], anxiety: false,
      styles: { fieldDep: 0, tempo: 0, perception: 0, reasoning: 0, processing: 0, input: 0, order: 0, kolbPerceive: 0, kolbProcess: 0 },
      vark: { counts: { V: 0, A: 0, R: 0, K: 0 }, preferred: [] }, kolb: { perceive: 0, process: 0, type: 'balanced' }, extended
    };
  }
  const ext = (chrono, score) => ({ approach: { deep: 50, surface: 30, achieving: 50 }, goal: {}, chrono, chronoScore: score });

  test('myRule: 상황 칩 6개, 저녁형·아침형이면 그 시간대 칩이 맨 앞', () => {
    const base = R.ruleSituations(result()).map((x) => x.text);
    assert.deepEqual(base, ['학교에서 돌아와 책상에 앉으면', '새 단원을 시작하면', '문제를 풀기 전에', '틀린 문제가 나오면', '공부를 마치면', '시험 3일 전이 되면']);
    assert.equal(R.ruleSituations(result(ext('evening', 100)))[0].text, '저녁 9시가 되면');
    assert.equal(R.ruleSituations(result(ext('morning', -100)))[0].text, '아침 7시가 되면');
    assert.equal(R.ruleSituations(result(ext('evening', 100))).length, 7);
    R.ruleSituations(result()).forEach((s) => assert.ok(/(면|전에)$/.test(s.text), s.text));
  });

  test('myRule: 행동 초안은 하는 법 첫 단계를 "~다" 꼴로, 모든 전략에서', () => {
    assert.equal(R.ruleActionDraft('chunking'), '외울 항목을 쭉 적어 본다');
    assert.equal(R.ruleActionDraft('interleave'), '서로 다른 단원이나 유형 문제를 몇 개씩 고른다');
    assert.equal(R.ruleActionDraft('imagery'), '읽은 내용을 한 장면으로 상상한다');
    assert.equal(R.ruleActionDraft('없는전략'), '');
    SM.data.strategies.forEach((s) => {
      const a = R.ruleActionDraft(s.id);
      assert.ok(/다$/.test(a), `${s.id}: ${a}`);
      assert.ok(a.indexOf(s.howTo[0].split(' ')[0]) === 0, `${s.id}: 첫 단계에서 시작`);
    });
  });

  test('myRule: 미리보기 문장 — "~다" 행동은 그대로, 명사형은 "을/를 한다", 빈 칸이면 빈 문자열', () => {
    assert.equal(R.ruleText('저녁 9시가 되면', '영단어 카드를 떠올려 본다.'), '나는 저녁 9시가 되면 영단어 카드를 떠올려 본다.');
    assert.equal(R.ruleText('공부를 마치면', '백지 복습'), '나는 공부를 마치면 백지 복습을 한다.');
    assert.equal(R.ruleText('공부를 마치면', '오답 정리'), '나는 공부를 마치면 오답 정리를 한다.');
    assert.equal(R.ruleText('', '푼다'), '');
    assert.equal(R.ruleText('공부를 마치면', '  '), '');
    assert.equal(R.checkRule(R.ruleText('새 단원을 시작하면', R.ruleActionDraft('conceptMap'))).ok, true);
  });

  test('myRule: 전략 고르기 — 전략 탭에서 고른 과목별 전략만(과목 순서대로)', () => {
    const plan = { strategies: { 수학: ['retrieval', 'interleave', 'x'], 영어: ['spacing'] }, chosen: { 영어: 'spacing', 수학: 'interleave' } };
    assert.deepEqual(R.ruleStrategyOptions(plan), [{ subject: '수학', strategyId: 'interleave' }, { subject: '영어', strategyId: 'spacing' }]);
    assert.deepEqual(R.ruleStrategyOptions({ strategies: { 수학: ['retrieval'] } }), [], '고른 게 없으면 빈 목록');
    assert.deepEqual(R.ruleStrategyOptions(null), []);
  });

  test('myRule: 저장 — 바꾸면 이전 문장은 기록으로 한 번만, 되돌리면 기록에서 뺌', () => {
    const first = R.saveMyRule({}, { text: '나는 A면 B한다.', situation: 'A면', action: 'B한다', subject: '수학', strategyId: 'retrieval' }, null, 't1');
    assert.deepEqual(first.myRule, { text: '나는 A면 B한다.', situation: 'A면', action: 'B한다', subject: '수학', strategyId: 'retrieval', updatedAt: 't1' });
    assert.deepEqual(first.myRuleHistory, []);
    const base = first.myRule;
    // 같은 화면에서 자동 저장이 여러 번 일어나도 기록은 하나
    let p = R.saveMyRule(first, { text: '나는 A면 C', situation: 'A면', action: 'C' }, base, 't2');
    p = R.saveMyRule(p, { text: '나는 A면 C한다.', situation: 'A면', action: 'C한다' }, base, 't3');
    assert.deepEqual([p.myRule.text, p.myRule.updatedAt], ['나는 A면 C한다.', 't3']);
    assert.deepEqual(p.myRuleHistory, [base]);
    // 원래 문장으로 되돌리면 기록에서 빠지고 정한 날짜도 그대로
    p = R.saveMyRule(p, { text: '나는 A면 B한다.', situation: 'A면', action: 'B한다', subject: '수학', strategyId: 'retrieval' }, base, 't4');
    assert.deepEqual([p.myRuleHistory, p.myRule.updatedAt], [[], 't1']);
    assert.deepEqual(first.myRuleHistory, [], 'plan을 바꾸지 않음');
  });

  // ---------- 주간 지킨 날 ----------

  function planner() {
    const store = SM.createStore(() => fakeStorage());
    return SM.createPlanner({ store, sid: () => SID });
  }

  test('myRule: 주간 지킨 날 = 그 주 일간 체크에서 "예"인 날 수(두 달에 걸친 주 포함)', () => {
    const pl = planner();
    // 2026-W49: 11/30(월) ~ 12/6(일) → 11월·12월 데이터에 나뉘어 저장됨
    pl.setMyRuleDone('2026-11-30', true);
    pl.setMyRuleDone('2026-12-01', true);
    pl.setMyRuleDone('2026-12-02', false);
    pl.setMyRuleDone('2026-12-03', true);
    pl.setMyRuleDone('2026-12-07', true);            // 다음 주
    pl.setMyRuleDone('2026-11-29', true);            // 지난주
    assert.equal(pl.myRuleKeptDays('2026-W49'), 3);
    pl.setMyRuleDone('2026-12-03', null);            // 체크 지움
    assert.equal(pl.myRuleKeptDays('2026-W49'), 2);
    assert.equal(pl.myRuleKeptDays('2026-W51'), 0);
    assert.equal(SM.planner.countKeptDays([{ myRuleDone: true }, null, { myRuleDone: 'yes' }, {}]), 1);
  });

  test('myRule: 지킴 체크는 그날 블록을 건드리지 않음', () => {
    const pl = planner();
    pl.saveDay('2026-11-20', [{ id: 'b1', subject: '수학' }]);
    pl.setMyRuleDone('2026-11-20', true);
    assert.deepEqual(pl.getDay('2026-11-20'), [{ id: 'b1', subject: '수학' }]);
    pl.saveDay('2026-11-20', [{ id: 'b2', subject: '영어' }]);
    assert.equal(pl.getDayData('2026-11-20').myRuleDone, true, '블록을 저장해도 체크는 남음');
  });

  test('myRule: 주간 점검표 C항목 — 지금 문장, 같은 문장이면 상태 이어 받기, 제출한 주는 그때 문장', () => {
    const C = SM.checkin;
    assert.equal(C.weekRule(null, '', 3, false), null);
    assert.deepEqual(C.weekRule(null, '나는 A면 B한다.', 4, false), { text: '나는 A면 B한다.', status: null, keptDays: 4 });
    assert.deepEqual(C.weekRule({ text: '나는 A면 B한다.', status: 'kept', keptDays: 1 }, '나는 A면 B한다.', 5, false),
      { text: '나는 A면 B한다.', status: 'kept', keptDays: 5 }, '지킨 날은 다시 셈');
    assert.deepEqual(C.weekRule({ text: '옛 문장', status: 'kept' }, '새 문장', 2, false), { text: '새 문장', status: null, keptDays: 2 });
    assert.deepEqual(C.weekRule({ text: '옛 문장', status: 'missed' }, '새 문장', 2, true), { text: '옛 문장', status: 'missed', keptDays: 2 });
  });

  test('myRule: 주간 피드백 — 5일 이상 칭찬, 2일 이하 상황 바꾸기 제안, 3·4일은 없음', () => {
    const F = SM.feedback;
    const mw = { total: {} };
    const entry = (n) => ({ scores: {}, myRule: { text: '나는 A면 B한다.', status: null, keptDays: n } });
    assert.equal(F.evaluate(entry(5), mw)[0].rule, 'myRuleGood');
    assert.ok(F.evaluate(entry(7), mw)[0].text.indexOf('7일이나 지켰어') !== -1);
    assert.equal(F.evaluate(entry(2), mw)[0].rule, 'myRuleLow');
    assert.ok(F.evaluate(entry(0), mw)[0].text.indexOf('상황을 더 자주 생기는 때로 바꿔 볼까?') !== -1);
    assert.deepEqual(F.evaluate(entry(3), mw).map((r) => r.rule), []);
    assert.deepEqual(F.evaluate(entry(4), mw).map((r) => r.rule), []);
    assert.deepEqual(F.evaluate({ scores: {} }, mw), [], '문장이 없으면 없음');
    assert.ok(F.weekly(entry(6), mw).some((l) => /6일이나 지켰어/.test(l)), '피드백 문장에 들어감');
  });
})(window.SM = window.SM || {});
