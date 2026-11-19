(function (SM) {
  'use strict';
  const D = SM.data;
  const list = D.strategies;
  const POLE_RE = /^((fieldDep|tempo|perception|reasoning|processing|input|order):(L|R)|vark:(V|A|R|K)|kolb:(diverging|assimilating|converging|accommodating)|approach:surface|goal:avoid|chrono:(morning|evening))$/;

  test('strategies: 32개, id 유일, category A~F, evidence 1|2|2.5|3', () => {
    assert.equal(list.length, 32);
    assert.equal(new Set(list.map((s) => s.id)).size, 32);
    list.forEach((s) => {
      assert.ok(['A', 'B', 'C', 'D', 'E', 'F'].indexOf(s.category) !== -1, s.id + ' category');
      assert.ok([1, 2, 2.5, 3].indexOf(s.evidence) !== -1, s.id + ' evidence');
      assert.ok(D.strategyCategories[s.category]);
    });
  });

  test('strategies: 범주별 개수(A5 B8 C4 D5 E7 F3, 상보적 독해는 B)', () => {
    const count = {};
    list.forEach((s) => { count[s.category] = (count[s.category] || 0) + 1; });
    assert.deepEqual(count, { A: 5, B: 8, C: 4, D: 5, E: 7, F: 3 });
  });

  test('strategies: 근거 수준 대표값', () => {
    const ev = {};
    list.forEach((s) => { ev[s.id] = s.evidence; });
    assert.equal(ev.retrieval, 3);
    assert.equal(ev.spacing, 3);
    assert.equal(ev.interleave, 2.5);
    assert.equal(ev.metacog, 2.5);
    assert.equal(ev.chunking, 1);
  });

  test('strategies: 모든 weakness code가 weaknessLabels에 있음', () => {
    list.forEach((s) => {
      assert.ok(Array.isArray(s.weakness), s.id);
      s.weakness.forEach((c) => assert.ok(D.weaknessLabels[c], s.id + ': ' + c));
    });
  });

  test('strategies: 모든 fitsStyle 키가 허용된 극 키 형식이고 poleKeys에 있음', () => {
    assert.equal(D.poleKeys.length, 26);
    D.poleKeys.forEach((k) => assert.ok(POLE_RE.test(k), k));
    list.forEach((s) => {
      assert.ok(Array.isArray(s.fitsStyle), s.id);
      s.fitsStyle.forEach((k) => {
        assert.ok(POLE_RE.test(k), s.id + ': ' + k);
        assert.ok(D.poleKeys.indexOf(k) !== -1, s.id + ': ' + k);
      });
    });
  });

  test('strategies: howTo 1~3개, checkQuestions 정확히 2개(물음표로 끝남)', () => {
    list.forEach((s) => {
      assert.ok(s.howTo.length >= 1 && s.howTo.length <= 3, s.id + ' howTo');
      assert.equal(s.checkQuestions.length, 2, s.id + ' checkQuestions');
      s.checkQuestions.forEach((q) => assert.ok(/\?$/.test(q), s.id + ': ' + q));
      ['name', 'why', 'source'].forEach((f) => assert.ok(s[f], s.id + ' ' + f));
    });
  });

  test('strategies: subjects는 all 또는 config 과목 배열, plannerDefaults 형식', () => {
    list.forEach((s) => {
      if (s.subjects !== 'all') {
        assert.ok(Array.isArray(s.subjects) && s.subjects.length > 0, s.id);
        s.subjects.forEach((x) => assert.ok(SM.config.subjects.indexOf(x) !== -1, s.id + ': ' + x));
      }
      assert.ok(Number.isInteger(s.plannerDefaults.minutes) && s.plannerDefaults.minutes > 0, s.id);
      s.plannerDefaults.modes.forEach((m) => assert.ok(D.plannerModes[m], s.id + ': ' + m));
    });
    assert.deepEqual(list.find((s) => s.id === 'reciprocal').subjects, ['국어', '영어']);
  });

  test('strategies: 6단계의 약점 code가 빠짐없이 최소 1개 전략에 있음', () => {
    const covered = new Set();
    list.forEach((s) => s.weakness.forEach((c) => covered.add(c)));
    const all = [];
    Object.keys(D.weaknessQuestions).forEach((sub) => D.weaknessQuestions[sub].forEach((w) => all.push(w.code)));
    assert.equal(all.length, 20);
    all.forEach((c) => assert.ok(covered.has(c), '전략 없음: ' + c));
  });

  test('strategies: 지정한 fitsStyle 기준 반영', () => {
    const fits = (id) => list.find((s) => s.id === id).fitsStyle;
    const has = (id, keys) => keys.forEach((k) => assert.ok(fits(id).indexOf(k) !== -1, id + ' ← ' + k));
    has('conceptMap', ['input:L', 'order:R', 'vark:V']);
    has('teach', ['input:R', 'processing:L', 'vark:A', 'fieldDep:L']);
    has('havruta', ['fieldDep:L', 'processing:L']);
    has('coop', ['fieldDep:L', 'processing:L']);
    has('retrieval', ['fieldDep:R', 'processing:R']);
    has('workedExample', ['reasoning:L', 'perception:L', 'order:L']);
    has('errorLog', ['tempo:L']);
    has('selfExplain', ['tempo:L']);
    has('elabQuestion', ['perception:R', 'approach:surface']);
    has('expressiveWriting', ['goal:avoid']);
    has('woop', ['goal:avoid']);
  });

  test('styleWays: 모든 극 키에 retrieval·understand·complement, vark:V = input:L', () => {
    D.poleKeys.forEach((k) => {
      const w = D.styleWays[k];
      assert.ok(w, '없음: ' + k);
      ['retrieval', 'understand', 'complement'].forEach((f) => assert.ok(w[f], k + '.' + f));
    });
    assert.deepEqual(D.styleWays['vark:V'], D.styleWays['input:L']);
    assert.equal(D.styleWays['fieldDep:L'].with, '함께');
    assert.equal(D.styleWays['processing:R'].with, '혼자');
    assert.equal(D.styleWays['chrono:evening'].place, undefined);
  });

  test('habits: 모든 극에 보완 습관이 하나 이상, 형식', () => {
    const ids = D.habits.map((h) => h.id);
    assert.equal(new Set(ids).size, ids.length);
    ['reviewRoutine', 'soloMock', 'timerPractice', 'bigPictureMap', 'detailQuiz', 'whyQuestion',
      'drillVolume', 'ruleSentence', 'exceptionCases', 'conceptCheck', 'timeLimit', 'lowStakes', 'sleepGuard']
      .forEach((id) => assert.ok(ids.indexOf(id) !== -1, id));
    const covered = new Set();
    D.habits.forEach((h) => {
      assert.equal(h.pole, h.poles[0]);
      h.poles.forEach((p) => { assert.ok(D.poleKeys.indexOf(p) !== -1, h.id + ': ' + p); covered.add(p); });
      assert.ok(h.name && h.howTo);
      assert.ok(/\?$/.test(h.checkQuestion), h.id);
    });
    D.poleKeys.forEach((k) => assert.ok(covered.has(k), '습관 없음: ' + k));
    assert.equal(D.habits.find((h) => h.id === 'reviewRoutine').pole, 'tempo:L');
    assert.equal(D.habits.find((h) => h.id === 'soloMock').pole, 'fieldDep:L');
  });

  test('score.poles: balanced 제외, 극 키와 band', () => {
    const r = {
      styles: { fieldDep: 70, tempo: -30, perception: 10, reasoning: -19, processing: 20, input: -100, order: 0 },
      vark: { counts: { V: 4, A: 1, R: 1, K: 4 }, preferred: ['V', 'K'] },
      kolb: { perceive: -70, process: 10, type: 'diverging' }
    };
    assert.deepEqual(SM.score.poles(r), [
      { key: 'fieldDep:R', band: 'strong' },
      { key: 'tempo:L', band: 'mild' },
      { key: 'processing:R', band: 'mild' },
      { key: 'input:L', band: 'strong' },
      { key: 'vark:V', band: 'mild' },
      { key: 'vark:K', band: 'mild' },
      { key: 'kolb:diverging', band: 'strong' }
    ]);
  });

  test('score.poles: 심화형(approach:surface, goal:avoid, chrono)', () => {
    const base = { styles: {}, vark: { preferred: ['A'] }, kolb: { type: 'balanced' } };
    const r = Object.assign({}, base, {
      extended: {
        approach: { deep: 25, surface: 75, achieving: 50 },
        goal: { masteryApproach: 3, masteryAvoid: 2, performanceApproach: 3, performanceAvoid: 4 },
        chrono: 'evening', chronoScore: 100
      }
    });
    assert.deepEqual(SM.score.poles(r), [
      { key: 'vark:A', band: 'strong' },
      { key: 'approach:surface', band: 'strong' },
      { key: 'goal:avoid', band: 'mild' },
      { key: 'chrono:evening', band: 'strong' }
    ]);
    // surface가 deep보다 낮거나 60 미만이면 제외, avoid 3 이하 제외, chrono balanced 제외
    const r2 = Object.assign({}, base, {
      extended: { approach: { deep: 80, surface: 70 }, goal: { masteryAvoid: 3, performanceAvoid: 3 }, chrono: 'balanced', chronoScore: 0 }
    });
    assert.deepEqual(SM.score.poles(r2).map((p) => p.key), ['vark:A']);
    // 나온 키는 모두 poleKeys 안
    SM.score.poles(r).forEach((p) => assert.ok(D.poleKeys.indexOf(p.key) !== -1, p.key));
  });

  test('score.poles: 결과 없음·모두 balanced면 빈 목록', () => {
    assert.deepEqual(SM.score.poles(null), []);
    assert.deepEqual(SM.score.poles({ styles: { fieldDep: 0 }, vark: { preferred: [] }, kolb: { type: 'balanced' } }), []);
  });
})(window.SM);
