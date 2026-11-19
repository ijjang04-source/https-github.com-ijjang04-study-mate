(function (SM) {
  'use strict';
  const R = SM.recommend;

  function makeResult(opts) {
    const styles = Object.assign({
      fieldDep: 0, tempo: 0, perception: 0, reasoning: 0, processing: 0, input: 0, order: 0,
      kolbPerceive: 0, kolbProcess: 0
    }, opts.styles || {});
    return {
      takenAt: '2026-11-13',
      subjects: opts.subjects || ['수학'],
      weakness: opts.weakness || (opts.subjects || ['수학']).map((s) => ({ subject: s, codes: [] })),
      anxiety: !!opts.anxiety,
      styles,
      vark: { counts: { V: 0, A: 0, R: 0, K: 0 }, preferred: opts.vark || [] },
      kolb: { perceive: 0, process: 0, type: 'balanced' },
      extended: opts.extended
    };
  }

  const evening = { approach: { deep: 50, surface: 30, achieving: 50 }, goal: {}, chrono: 'evening', chronoScore: 100 };
  const morning = { approach: { deep: 50, surface: 30, achieving: 50 }, goal: {}, chrono: 'morning', chronoScore: -100 };

  const CASES = [
    makeResult({}),
    makeResult({ subjects: ['수학', '영어'], weakness: [{ subject: '수학', codes: ['MATH_SELECT'] }, { subject: '영어', codes: ['ENG_VOCAB'] }] }),
    makeResult({ styles: { tempo: -90, input: 80, order: 70 } }),
    makeResult({ subjects: ['사회'], styles: { fieldDep: -70 }, extended: evening }),
    makeResult({ subjects: ['국어', '과학'], styles: { perception: 70 }, extended: morning, anxiety: true }),
    makeResult({ styles: { fieldDep: 30, tempo: 30, perception: -30, reasoning: 30, processing: -30, input: 30, order: 30 } })
  ];

  test('seven: 초안은 항상 7개 이하, 전략·습관·문장 중복 없음', () => {
    CASES.forEach((r, k) => {
      const d = R.sevenDrafts(r, null);
      assert.ok(d.length >= 1 && d.length <= 7, 'case ' + k + ': ' + d.length);
      const ids = d.map((x) => x.strategyId || ('h:' + x.habitId));
      assert.equal(new Set(ids).size, ids.length, 'case ' + k);
      assert.equal(new Set(d.map((x) => x.text)).size, d.length, 'case ' + k);
      assert.ok(d.filter((x) => x.habitId).length <= 2, 'case ' + k + ' 습관 2개 이하');
      assert.ok(d.filter((x) => x.strategyId).length <= 6, 'case ' + k + ' 전략 6개 이하');
    });
  });

  test('seven: 보완 습관이 있으면 7개를 채움', () => {
    const d = R.sevenDrafts(CASES[2], null);
    assert.equal(d.length, 7);
    assert.equal(d.filter((x) => x.habitId).length, 2);
  });

  test('seven: 모든 초안이 "나는 …면/전에 … ." 형식이고 형식 점검을 통과', () => {
    CASES.forEach((r) => R.sevenDrafts(r, null).forEach((x) => {
      assert.ok(/^나는 .+\.$/.test(x.text), x.text);
      assert.ok(R.checkRule(x.text).ok, x.text);
      assert.ok(x.text.indexOf('{subject}') === -1, x.text);
    }));
  });

  test('seven: chrono:evening이면 저녁 시간 표현, morning이면 아침', () => {
    const ev = R.sevenDrafts(CASES[3], null);
    assert.ok(ev.some((x) => x.text.indexOf('저녁') !== -1), ev.map((x) => x.text).join('\n'));
    assert.ok(ev.every((x) => x.text.indexOf('아침 7시') === -1));
    const mo = R.sevenDrafts(CASES[4], null);
    assert.ok(mo.some((x) => /아침/.test(x.text)), mo.map((x) => x.text).join('\n'));
    // chrono가 없으면 시간 표현 없음
    assert.ok(R.sevenDrafts(CASES[0], null).every((x) => !/저녁 \d+시|아침 \d+시/.test(x.text)));
  });

  test('seven: 과목 이름이 행동에 들어감, plan의 전략을 먼저 씀', () => {
    const r = makeResult({ weakness: [{ subject: '수학', codes: ['MATH_SELECT'] }] });
    const d = R.sevenDrafts(r, null);
    assert.equal(d[0].strategyId, 'interleave');
    assert.equal(d[0].text, '나는 문제를 풀기 전에 수학 유형을 섞어 고르고 풀 방법을 먼저 적는다.');
    const plan = { strategies: { 수학: ['teach', 'spacing', 'organize'] } };
    assert.deepEqual(R.sevenDrafts(r, plan).slice(0, 3).map((x) => x.strategyId), ['teach', 'spacing', 'organize']);
  });

  test('seven: 같은 입력이면 같은 초안', () => {
    CASES.forEach((r) => assert.deepEqual(R.sevenDrafts(r, null), R.sevenDrafts(r, null)));
  });

  test('seven: 다시 만들기는 다른 칸과 겹치지 않는 새 초안', () => {
    const r = CASES[2];
    const rules = R.sevenDrafts(r, null);
    const next = R.nextDraft(r, null, rules, 0);
    assert.ok(next);
    const key = (x) => x.strategyId || ('h:' + x.habitId);
    assert.ok(rules.map(key).indexOf(key(next)) === -1, key(next));
    // 빈 칸에서도 만들 수 있음
    const withEmpty = rules.slice(); withEmpty[3] = { text: '', strategyId: null, habitId: null };
    assert.ok(R.nextDraft(r, null, withEmpty, 3));
  });

  test('seven: checkRule 형식 점검(저장은 막지 않음)', () => {
    assert.deepEqual(R.checkRule('나는 저녁 9시가 되면 영단어 20개를 떠올린다.'), { ok: true, missing: null, empty: false });
    assert.equal(R.checkRule('나는 문제를 풀기 전에 방법을 적는다.').ok, true);
    assert.equal(R.checkRule('영단어 20개를 외운다.').missing, 'when');
    assert.equal(R.checkRule('나는 저녁 9시가 되면').missing, 'act');
    assert.equal(R.checkRule('나는 저녁 9시가 되면.').missing, 'act');
    assert.equal(R.checkRule('   ').empty, true);
    assert.equal(R.checkRule('').ok, true);
  });

  test('seven: 모든 전략·습관에 상황·행동 조각이 있음', () => {
    const P = SM.data.sevenRuleParts;
    SM.data.strategies.forEach((s) => {
      assert.ok(P.strategies[s.id], s.id);
      assert.ok(SM.data.ruleSituations[P.strategies[s.id].when], s.id + ' when');
      assert.ok(/다$/.test(P.strategies[s.id].act), s.id + ' act');
    });
    SM.data.habits.forEach((h) => {
      assert.ok(P.habits[h.id], h.id);
      assert.ok(SM.data.ruleSituations[P.habits[h.id].when], h.id + ' when');
    });
    Object.keys(SM.data.ruleSituations).forEach((k) => assert.ok(/(면|전에)$/.test(SM.data.ruleSituations[k]), k));
    ['evening', 'morning'].forEach((k) => SM.data.ruleTimes[k].forEach((t) => assert.ok(/면$/.test(t), t)));
  });
})(window.SM);
