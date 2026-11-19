(function (SM) {
  'use strict';
  const R = SM.recommend;

  // 가상 결과 만들기
  function makeResult(opts) {
    const styles = Object.assign({
      fieldDep: 0, tempo: 0, perception: 0, reasoning: 0, processing: 0, input: 0, order: 0,
      kolbPerceive: 0, kolbProcess: 0
    }, opts.styles || {});
    return {
      takenAt: '2026-11-13',
      subjects: opts.subjects || ['수학'],
      weakness: opts.weakness || [{ subject: '수학', codes: [] }],
      anxiety: !!opts.anxiety,
      styles,
      vark: { counts: { V: 0, A: 0, R: 0, K: 0 }, preferred: opts.vark || [] },
      kolb: {
        perceive: styles.kolbPerceive, process: styles.kolbProcess,
        type: SM.score.kolbType(styles.kolbPerceive, styles.kolbProcess)
      },
      extended: opts.extended
    };
  }

  const STYLE_SETS = [
    {},
    { fieldDep: 80, input: -70, tempo: 30 },
    { fieldDep: -80, processing: -70 },
    { perception: 70, reasoning: 60, order: 40 },
    { input: 70, processing: 30 },
    { tempo: -90, order: -60, kolbPerceive: -70, kolbProcess: -60 }
  ];

  // 약점·스타일 조합(과목, 약점 code 목록, 스타일, 불안)
  const CASES = [];
  [
    ['수학', ['MATH_SELECT']], ['수학', ['MATH_PROCESS', 'MATH_CARELESS']], ['수학', []],
    ['영어', ['ENG_GRAMMAR']], ['영어', ['ENG_READING', 'ENG_VOCAB']],
    ['국어', ['KOR_STRUCTURE', 'KOR_APPLY']], ['국어', ['KOR_ILLUSION']],
    ['과학', ['SCI_MISCONCEPT']], ['과학', ['SCI_APPLY', 'SCI_RELATION']],
    ['사회', ['SOC_ORDER', 'SOC_CAUSAL']], ['사회', ['SOC_RECALL']]
  ].forEach(([subject, codes]) => {
    STYLE_SETS.forEach((styles, k) => {
      CASES.push({ subject, codes, styles, anxiety: k % 2 === 1, vark: k === 2 ? ['V'] : k === 3 ? ['A', 'K'] : [] });
    });
  });

  function resultFor(c) {
    return makeResult({
      subjects: [c.subject],
      weakness: [{ subject: c.subject, codes: c.codes }],
      styles: c.styles, anxiety: c.anxiety, vark: c.vark
    });
  }

  test('recommend: 조합 ' + CASES.length + '개 모두 상위 3개에 retrieval 또는 spacing 포함', () => {
    assert.ok(CASES.length >= 10);
    CASES.forEach((c) => {
      const top = R.forSubject(resultFor(c), c.subject);
      assert.equal(top.length, 3, JSON.stringify(c));
      assert.ok(top.some((x) => x.id === 'retrieval' || x.id === 'spacing'), JSON.stringify(c) + ' → ' + top.map((x) => x.id));
      assert.equal(new Set(top.map((x) => x.id)).size, 3);
    });
  });

  test('recommend: MATH_SELECT 1순위면 interleave가 1위(스타일과 무관)', () => {
    STYLE_SETS.forEach((styles) => {
      const r = makeResult({ weakness: [{ subject: '수학', codes: ['MATH_SELECT', 'MATH_BASIC'] }], styles });
      assert.equal(R.forSubject(r, '수학')[0].id, 'interleave', JSON.stringify(styles));
    });
  });

  test('recommend: SCI_MISCONCEPT 1순위면 refutation이 상위 3개 안', () => {
    STYLE_SETS.forEach((styles) => {
      const r = makeResult({ subjects: ['과학'], weakness: [{ subject: '과학', codes: ['SCI_MISCONCEPT'] }], styles });
      assert.ok(R.forSubject(r, '과학').some((x) => x.id === 'refutation'), JSON.stringify(styles));
    });
  });

  test('recommend: 같은 입력 두 번 → 같은 출력', () => {
    CASES.forEach((c) => {
      assert.deepEqual(R.forSubject(resultFor(c), c.subject), R.forSubject(resultFor(c), c.subject));
    });
  });

  test('recommend: 점수 = evidence + weakness + style, style은 0·0.5·1', () => {
    CASES.forEach((c) => {
      R.rank(resultFor(c), c.subject).forEach((x) => {
        assert.ok([0, 0.5, 1].indexOf(x.parts.style) !== -1, x.id);
        assert.ok(x.parts.weakness >= 0 && x.parts.weakness <= 3, x.id);
        assert.equal(x.score, x.parts.evidence + x.parts.weakness + x.parts.style, x.id);
      });
    });
  });

  test('recommend: 약점이 같고 스타일만 다르면 전략 점수 차이는 1 이하', () => {
    const codes = ['MATH_PROCESS', 'MATH_CARELESS'];
    const ranks = STYLE_SETS.map((styles) => {
      const m = {};
      R.rank(makeResult({ weakness: [{ subject: '수학', codes }], styles }), '수학').forEach((x) => { m[x.id] = x.score; });
      return m;
    });
    Object.keys(ranks[0]).forEach((id) => {
      const scores = ranks.map((m) => m[id]);
      assert.ok(Math.max.apply(null, scores) - Math.min.apply(null, scores) <= 1, id + ' ' + scores);
    });
    // 1위 전략은 스타일과 상관없이 같은 약점 전략군(selfExplain/workedExample/errorLog/teach) 안에 있다
    STYLE_SETS.forEach((styles) => {
      const top = R.forSubject(makeResult({ weakness: [{ subject: '수학', codes }], styles }), '수학')[0].id;
      assert.ok(['selfExplain', 'workedExample', 'helpSeek', 'errorLog', 'teach'].indexOf(top) !== -1, top);
    });
  });

  test('recommend: weaknessMatch 규칙(1순위 3, 2순위 2, 같은 과목 1, 불안 +1 최대 3)', () => {
    const r = makeResult({ weakness: [{ subject: '수학', codes: ['MATH_SELECT', 'MATH_CARELESS'] }], anxiety: true });
    const s = (id) => SM.data.strategies.find((x) => x.id === id);
    assert.equal(R.weaknessMatch(s('interleave'), r, '수학'), 3);
    assert.equal(R.weaknessMatch(s('errorLog'), r, '수학'), 2);
    assert.equal(R.weaknessMatch(s('workedExample'), r, '수학'), 1); // MATH_PROCESS
    assert.equal(R.weaknessMatch(s('chunking'), r, '수학'), 0);
    assert.equal(R.weaknessMatch(s('woop'), r, '수학'), 1);          // 불안 +1
    const noAnx = makeResult({ weakness: [{ subject: '수학', codes: [] }] });
    assert.equal(R.weaknessMatch(s('woop'), noAnx, '수학'), 0);
  });

  test('recommend: 과목 전용 전략은 그 과목에서만 후보', () => {
    assert.ok(R.candidates('국어').some((x) => x.s.id === 'reciprocal'));
    assert.ok(!R.candidates('수학').some((x) => x.s.id === 'reciprocal'));
    const r = makeResult({ subjects: ['영어'], weakness: [{ subject: '영어', codes: ['ENG_READING'] }] });
    assert.equal(R.forSubject(r, '영어')[0].id, 'reciprocal');
  });

  test('recommend: 이유 문장(약점·스타일)', () => {
    const r = makeResult({ weakness: [{ subject: '수학', codes: ['MATH_SELECT'] }], styles: { fieldDep: 80 } });
    const top = R.forSubject(r, '수학');
    assert.equal(top[0].reasons[0], '풀이법을 고르는 게 어려운 너에게 딱 맞는 연습이야.');
    const retrieval = R.explain(r, '수학', 'retrieval');
    assert.ok(retrieval.reasons.indexOf('혼자 핵심을 골라내는 편인 너에게 잘 맞는 방식이야.') !== -1, retrieval.reasons.join('/'));
    top.forEach((x) => x.reasons.forEach((t) => assert.ok(t.indexOf('형') === -1, t)));
  });

  test('recommend: 다른 전략 보기는 4~6위에서, 강제 규칙 유지', () => {
    // retrieval·spacing 중 하나만 상위 3개에 들어 있는 조합을 고른다.
    const c = CASES.find((x) => {
      const ids = R.forSubject(resultFor(x), x.subject).map((y) => y.id);
      return ids.filter((id) => R.CORE.indexOf(id) !== -1).length === 1;
    });
    assert.ok(c, '조건에 맞는 조합이 있어야 함');
    const r = resultFor(c);
    const subject = c.subject;
    const top = R.forSubject(r, subject).map((x) => x.id);
    const ranked = R.rank(r, subject).map((x) => x.id).filter((id) => top.indexOf(id) === -1);
    const coreIdx = top.findIndex((id) => R.CORE.indexOf(id) !== -1);
    const otherIdx = coreIdx === 0 ? 1 : 0;

    const alt = R.alternative(r, subject, top, otherIdx);
    assert.ok(ranked.slice(0, 3).indexOf(alt) !== -1, alt);

    // 유일한 retrieval/spacing 자리를 바꾸면 남은 하나로만
    const altCore = R.alternative(r, subject, top, coreIdx);
    assert.ok(R.CORE.indexOf(altCore) !== -1 && altCore !== top[coreIdx], altCore);

    // 둘 다 이미 보이면 그중 한 자리를 바꿔도 아무거나 가능
    const both = top.slice(); both[otherIdx] = R.CORE.find((id) => id !== top[coreIdx]);
    const free = R.alternative(r, subject, both, coreIdx);
    assert.ok(free && both.indexOf(free) === -1);
  });

  test('recommend: habits는 strong 극 우선 최대 2개, 없으면 빈 목록', () => {
    const r = makeResult({ styles: { tempo: -90, order: 30, input: 70 } });
    assert.deepEqual(R.habits(r).map((h) => h.id), ['reviewRoutine', 'chartRead']);
    const mildOnly = makeResult({ styles: { order: 30 } });
    assert.deepEqual(R.habits(mildOnly).map((h) => h.id), ['detailQuiz']);
    assert.deepEqual(R.habits(makeResult({})), []);
  });

  test('recommend: environment(장소·혼자/함께·시간대, balanced 문구)', () => {
    const e1 = R.environment(makeResult({
      styles: { fieldDep: 80, processing: -40 },
      extended: { approach: {}, goal: {}, chrono: 'evening', chronoScore: 100 }
    }));
    assert.equal(e1.place, '조용한 자습실이나 집 책상');
    assert.equal(e1.with, '함께');
    assert.equal(e1.time, '저녁');
    const e2 = R.environment(makeResult({}));
    assert.equal(e2.lines[0], '편한 곳 아무 데나 괜찮아.');
    assert.equal(e2.place, null);
  });
})(window.SM);
