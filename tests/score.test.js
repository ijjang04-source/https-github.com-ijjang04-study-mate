(function (SM) {
  'use strict';
  const S = SM.score;
  const Q = SM.data.styleQuestions;
  const basic = Q.filter((q) => q.set === 'basic');
  const likertDims = SM.data.styleDims.filter((d) => d.set === 'basic' && d.format === 'likert').map((d) => d.id);
  const forcedDims = SM.data.styleDims.filter((d) => d.set === 'basic' && d.format === 'forced').map((d) => d.id);

  /** 기본형 응답 만들기. likert(q) → 1~5, forced(q, i) → 'a'|'b', multi(q) → 배열 */
  function build(opts) {
    const answers = {};
    const counter = {};
    basic.forEach((q) => {
      counter[q.dim] = (counter[q.dim] || 0) + 1;
      const i = counter[q.dim] - 1;
      if (q.format === 'likert') answers[q.id] = opts.likert(q, i);
      else if (q.format === 'forced') answers[q.id] = opts.forced(q, i);
      else answers[q.id] = opts.multi ? opts.multi(q, i) : ['V', 'A', 'R', 'K'];
    });
    return answers;
  }

  const neutral = build({ likert: () => 3, forced: (q, i) => (i % 2 ? 'b' : 'a') });

  test('score: 모든 응답 3(강제 선택은 A/B 반반) → 모든 차원 0, balanced, kolb balanced', () => {
    const r = S.basic(neutral, ['수학'], new Date(2026, 10, 13));
    Object.keys(r.styles).forEach((id) => {
      assert.equal(r.styles[id], 0, id);
      assert.equal(S.band(r.styles[id]), 'balanced', id);
    });
    assert.equal(r.kolb.type, 'balanced');
    assert.equal(r.takenAt, '2026-11-13');
    assert.equal(S.summary(r), '여러 방식을 고르게 쓰는 편이야.');
  });

  test('score: 모든 응답 5 → reverse 반영해 likert 차원 정확히 0', () => {
    const a = build({ likert: () => 5, forced: () => 'a' });
    likertDims.forEach((id) => assert.equal(S.likert(id, a), 0, id));
  });

  test('score: 비reverse 5, reverse 1 → +100 / 반대면 −100', () => {
    const plus = build({ likert: (q) => (q.reverse ? 1 : 5), forced: () => 'a' });
    const minus = build({ likert: (q) => (q.reverse ? 5 : 1), forced: () => 'a' });
    likertDims.forEach((id) => {
      assert.equal(S.likert(id, plus), 100, id);
      assert.equal(S.likert(id, minus), -100, id);
    });
  });

  test('score: likert 계산 예(4문항 중 +1,+1,+2,0 → 50)', () => {
    // fieldDep: fd1(정), fd2(역), fd3(정), fd4(역)
    const a = { fd1: 4, fd2: 2, fd3: 5, fd4: 3 };
    assert.equal(S.likert('fieldDep', a), 50);
    assert.equal(S.likert('fieldDep', {}), null);
  });

  test('score: forced 전부 B → +100, 전부 A → −100, 3:1 → +50', () => {
    const allB = build({ likert: () => 3, forced: () => 'b' });
    const allA = build({ likert: () => 3, forced: () => 'a' });
    const threeB = build({ likert: () => 3, forced: (q, i) => (i === 0 ? 'a' : 'b') });
    forcedDims.forEach((id) => {
      assert.equal(S.forced(id, allB), 100, id);
      assert.equal(S.forced(id, allA), -100, id);
      assert.equal(S.forced(id, threeB), 50, id);
    });
  });

  test('score: band 경계', () => {
    assert.equal(S.band(19), 'balanced');
    assert.equal(S.band(-19), 'balanced');
    assert.equal(S.band(20), 'mild');
    assert.equal(S.band(-59), 'mild');
    assert.equal(S.band(60), 'strong');
    assert.equal(S.band(null), null);
    assert.equal(S.bandText('order', 100), '경향');
    assert.equal(S.bandText('order', 30), '경향');
    assert.equal(S.bandText('tempo', 100), '뚜렷한 경향');
    assert.equal(S.bandText('tempo', -25), '약한 경향');
    assert.equal(S.bandText('tempo', 0), '균형');
  });

  test('score: vark 최댓값 80% 이상 모두 선호(동률 포함)', () => {
    const ids = Q.filter((q) => q.dim === 'vark').map((q) => q.id);
    const a = {};
    a[ids[0]] = ['V', 'K']; a[ids[1]] = ['V', 'K']; a[ids[2]] = ['V', 'K', 'A']; a[ids[3]] = ['V', 'R'];
    const r = S.vark(a); // V4, K3, A1, R1 → 기준 4×0.8=3.2 → V만
    assert.deepEqual(r.counts, { V: 4, A: 1, R: 1, K: 3 });
    assert.deepEqual(r.preferred, ['V']);

    a[ids[3]] = ['V', 'K', 'R']; // V4, K4 동률 → 둘 다
    assert.deepEqual(S.vark(a).preferred, ['V', 'K']);

    // A3, R3 동률 → 둘 다, K2 → 2 < 3×0.8(2.4)이라 제외
    const b = {}; b[ids[0]] = ['A', 'R', 'K']; b[ids[1]] = ['A', 'R', 'K']; b[ids[2]] = ['A', 'R']; b[ids[3]] = [];
    assert.deepEqual(S.vark(b).counts, { V: 0, A: 3, R: 3, K: 2 });
    assert.deepEqual(S.vark(b).preferred, ['A', 'R']);
  });

  test('score: vark 응답 없음 → 선호 없음', () => {
    assert.deepEqual(S.vark({}), { counts: { V: 0, A: 0, R: 0, K: 0 }, preferred: [] });
  });

  test('score: kolb 4분면과 balanced', () => {
    assert.equal(S.kolbType(-50, -50), 'diverging');
    assert.equal(S.kolbType(50, -50), 'assimilating');
    assert.equal(S.kolbType(50, 50), 'converging');
    assert.equal(S.kolbType(-50, 50), 'accommodating');
    assert.equal(S.kolbType(10, -19), 'balanced');
    assert.equal(S.kolbType(10, -40), 'assimilating'); // 한 축만 뚜렷해도 부호로
    assert.equal(S.kolbType(null, 10), null);
  });

  test('score: weakness 4점 이상, 점수 높은 순, 동점은 문항 순서, 최대 2개', () => {
    const a = { wm1: 4, wm2: 5, wm3: 4, wm4: 3, we1: 2, we2: 3, wa1: 4 };
    const w = S.weakness(a, ['수학', '영어']);
    assert.deepEqual(w, [
      { subject: '수학', codes: ['MATH_PROCESS', 'MATH_SELECT'] },
      { subject: '영어', codes: [] }
    ]);
    assert.equal(S.anxiety(a), true);
    assert.equal(S.anxiety({ wa1: 3 }), false);
  });

  test('score: 결과 객체 형식', () => {
    const a = Object.assign({ wm1: 5, wa1: 2 }, build({ likert: (q) => (q.reverse ? 2 : 4), forced: () => 'b' }));
    const r = S.basic(a, ['수학']);
    ['takenAt', 'subjects', 'weakness', 'anxiety', 'styles', 'vark', 'kolb'].forEach((k) => assert.ok(k in r, k));
    assert.deepEqual(Object.keys(r.styles).sort(), likertDims.concat(forcedDims).sort());
    assert.equal(r.styles.fieldDep, 50);
    assert.equal(r.kolb.type, 'converging');
    assert.equal(r.anxiety, false);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.takenAt));
  });

  test('score: 심화형 approach 0~100, goal 1~5, chrono', () => {
    const a = { ap1: 5, ap2: 5, ap3: 1, ap4: 1, ap5: 3, ap6: 4, gl1: 5, gl2: 2, gl3: 3, gl4: 1, ch1: 'a', ch2: 'a' };
    const e = S.extended(a);
    assert.deepEqual(e.approach, { deep: 100, surface: 0, achieving: 63 });
    assert.deepEqual(e.goal, { masteryApproach: 5, masteryAvoid: 2, performanceApproach: 3, performanceAvoid: 1 });
    assert.equal(e.chrono, 'morning');
    assert.equal(S.extended({ ch1: 'b', ch2: 'b' }).chrono, 'evening');
    assert.equal(S.extended({ ch1: 'a', ch2: 'b' }).chrono, 'balanced');
    assert.equal(S.extended({}).chrono, null);
  });

  test('score: 요약 문장은 상위 3개 경향을 "~하는 편"으로, 단일 라벨 없음', () => {
    const r = { styles: { fieldDep: 80, input: -70, tempo: 30, perception: 25, reasoning: 0, processing: 10, order: -5 } };
    const s = S.summary(r);
    assert.equal(s, '너는 혼자 조용히, 그림으로 정리하며, 천천히 꼼꼼하게 따지며 공부할 때 편한 편이야.');
    assert.ok(s.indexOf('형이') === -1 && s.indexOf('형이다') === -1 && s.indexOf('형이야') === -1);
  });

  test('score: 모든 방향 조합의 요약 문장에 "형"이 없음', () => {
    const dims = S.SPECTRUM_DIMS;
    for (let mask = 0; mask < (1 << dims.length); mask++) {
      const styles = {};
      dims.forEach((id, i) => { styles[id] = (mask >> i) & 1 ? 70 - i : -(70 - i); });
      const s = S.summary({ styles });
      assert.ok(s.indexOf('형') === -1, s);
      assert.ok(/편이야\.$/.test(s), s);
    }
  });

  test('score: 결과 고지 문구', () => {
    assert.equal(SM.test.DISCLAIMER,
      '스타일은 능력이 아니라 선호야. 연구에 따르면 스타일에만 맞추는 것보다, 효과가 확인된 전략을 내 방식으로 쓰는 게 중요해.');
  });

  test('score: 심화형 순서는 ④→⑤, 12문항', () => {
    const order = SM.test.buildDeepOrder();
    assert.equal(order.length, 12);
    const areas = order.map((id) => SM.test.itemById(id).area);
    assert.deepEqual(areas.slice(0, 10).concat(areas.slice(10)), [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5]);
  });
})(window.SM);
