(function (SM) {
  'use strict';
  const T = SM.test;

  // 시드 고정 난수(mulberry32)
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const basicIds = SM.data.styleQuestions.filter((q) => q.set === 'basic').map((q) => q.id);

  test('test-flow: 과목 1개(수학) → 4 + 공통 1 + 38 = 43', () => {
    const order = T.buildOrder(['수학'], seeded(1));
    assert.equal(order.length, 43);
    assert.deepEqual(order.slice(0, 5), ['wm1', 'wm2', 'wm3', 'wm4', 'wa1']);
  });

  test('test-flow: 과목 수·종류에 따라 약점 문항 수가 달라짐', () => {
    assert.equal(T.buildOrder(['수학', '영어'], seeded(1)).length, 4 + 4 + 1 + 38);
    assert.equal(T.buildOrder(['사회'], seeded(1)).length, 3 + 1 + 38);
    assert.equal(T.buildOrder(['국어', '사회'], seeded(1)).length, 4 + 3 + 1 + 38);
    // 고른 순서대로
    assert.deepEqual(T.buildOrder(['영어', '수학'], seeded(1)).slice(0, 2), ['we1', 'we2']);
  });

  test('test-flow: 공통 ANY_ANXIETY 문항은 과목 수와 관계없이 1번, 약점 문항 바로 뒤', () => {
    [['수학'], ['수학', '영어'], ['사회', '과학']].forEach((subjects) => {
      const order = T.buildOrder(subjects, seeded(2));
      assert.equal(order.filter((id) => id === 'wa1').length, 1);
      const lastWeakness = order.filter((id) => T.itemById(id).kind === 'weakness').length - 1;
      assert.equal(order[lastWeakness], 'wa1');
    });
  });

  test('test-flow: 기본형 38문항이 한 번씩, 심화형은 없음', () => {
    const order = T.buildOrder(['수학'], seeded(3));
    const style = order.filter((id) => T.itemById(id).kind === 'style');
    assert.equal(style.length, 38);
    assert.deepEqual(style.slice().sort(), basicIds.slice().sort());
  });

  test('test-flow: 영역 ①→②→③ 순서는 고정, 영역 안에서만 섞임', () => {
    const order = T.buildOrder(['수학'], seeded(4));
    const areas = order.map((id) => T.itemById(id)).filter((it) => it.kind === 'style').map((it) => it.area);
    for (let i = 1; i < areas.length; i++) assert.ok(areas[i] >= areas[i - 1], '영역 순서 깨짐 at ' + i);
    assert.deepEqual([areas[0], areas[areas.length - 1]], [1, 3]);
  });

  test('test-flow: 같은 시드면 같은 순서, 다른 시드면 대개 다름', () => {
    assert.deepEqual(T.buildOrder(['수학'], seeded(7)), T.buildOrder(['수학'], seeded(7)));
    assert.ok(T.buildOrder(['수학'], seeded(7)).join() !== T.buildOrder(['수학'], seeded(8)).join());
  });

  test('test-flow: 과목 0개·3개·중복·없는 과목은 예외', () => {
    assert.throws(() => T.buildOrder([]));
    assert.throws(() => T.buildOrder(['수학', '영어', '국어']));
    assert.throws(() => T.buildOrder(['수학', '수학']));
    assert.throws(() => T.buildOrder(['체육']));
    assert.throws(() => T.buildOrder(['공통']));
  });

  test('test-flow: 구간 연결 문장은 각 구간 첫 문항에서만', () => {
    const order = T.buildOrder(['수학'], seeded(5));
    const intros = order.map((_, i) => T.sectionIntro(order, i)).filter(Boolean);
    assert.deepEqual(intros, [
      T.AREA_INTRO.weakness, T.AREA_INTRO[1], T.AREA_INTRO[2], T.AREA_INTRO[3]
    ]);
  });

  test('test-flow: isAnswered 형식별 검사', () => {
    const likert = T.itemById('fd1'), forced = T.itemById('rs1'), multi = T.itemById('vk1');
    assert.ok(T.isAnswered(likert, 3));
    assert.ok(!T.isAnswered(likert, 6));
    assert.ok(!T.isAnswered(likert, '3'));
    assert.ok(T.isAnswered(forced, 'b'));
    assert.ok(!T.isAnswered(forced, 'c'));
    assert.ok(T.isAnswered(multi, ['V', 'K']));
    assert.ok(!T.isAnswered(multi, []));
    assert.ok(!T.isAnswered(multi, ['X']));
  });

  test('test-flow: 이어 하기 index = 답하지 않은 첫 문항', () => {
    const order = T.buildOrder(['수학'], seeded(6));
    const answerFor = (id) => {
      const it = T.itemById(id);
      return it.format === 'likert' ? 4 : it.format === 'forced' ? 'a' : ['V'];
    };
    const answers = {};
    order.slice(0, 23).forEach((id) => { answers[id] = answerFor(id); });
    assert.equal(T.resumeIndex({ order, answers, index: 22 }), 23);

    // 중간에 빈 문항이 있으면 거기부터
    delete answers[order[10]];
    assert.equal(T.resumeIndex({ order, answers }), 10);

    // 잘못된 값은 답하지 않은 것으로 본다
    answers[order[10]] = 9;
    assert.equal(T.resumeIndex({ order, answers }), 10);

    // 모두 답했으면 order.length
    order.forEach((id) => { answers[id] = answerFor(id); });
    assert.equal(T.resumeIndex({ order, answers }), order.length);

    assert.equal(T.resumeIndex(null), 0);
    assert.equal(T.resumeIndex({ order, answers: {} }), 0);
  });
})(window.SM);
