(function (SM) {
  'use strict';
  const F = SM.feedback;
  const C = SM.checkin;

  // metrics.week 결과 모양만 흉내 낸다
  function mw(o) {
    o = o || {};
    return {
      total: Object.assign({ planned: 10, recorded: 6, executionRate: 0.6, amountRate: 0.6, strategyRate: 0.6 }, o.total || {}),
      byStrategy: o.byStrategy || {},
      blockersTop: o.blockersTop || [],
      focusByPlace: o.focusByPlace || {},
      clumpBySubject: o.clumpBySubject || {}
    };
  }
  const ck = (scores, nextChange) => ({ scores: scores || {}, reflect: { nextChange: nextChange || '' } });
  const rules = (c, m) => F.evaluate(c, m).map((r) => r.rule);

  // 판정 말투가 섞이지 않았는지
  const BANNED = /못했|못 했|실패|부족|잘못|게으/;

  test('feedback: 계획 벅참 — 이행률 < 50% 이고 B1 ≤ 2일 때만', () => {
    assert.deepEqual(rules(ck({ b1: 2 }), mw({ total: { executionRate: 0.4 } })), ['plan']);
    assert.deepEqual(rules(ck({ b1: 3 }), mw({ total: { executionRate: 0.4 } })), []);
    assert.deepEqual(rules(ck({ b1: 1 }), mw({ total: { executionRate: 0.5 } })), []);
    assert.deepEqual(rules(ck({}), mw({ total: { executionRate: 0.1 } })), [], 'B1 미응답이면 안 함');
    assert.equal(F.evaluate(ck({ b1: 2 }), mw({ total: { executionRate: 0.4 } }))[0].text, '계획이 조금 벅찼던 것 같아. 다음 주는 블록을 하나 줄여 볼까?');
  });

  test('feedback: 적용률 < 40% 전략 → 가장 낮은 전략 카드', () => {
    const r = F.evaluate(ck(), mw({ byStrategy: { interleave: 0.3, retrieval: 0.1, spacing: 0.9 } }));
    assert.equal(r.length, 1);
    assert.equal(r[0].rule, 'strategy');
    assert.equal(r[0].strategyId, 'retrieval');
    assert.ok(/하는 법을 더 작게 쪼개 볼까\?$/.test(r[0].text), r[0].text);
    assert.deepEqual(rules(ck(), mw({ byStrategy: { interleave: 0.4 } })), []);
  });

  test('feedback: 분산 학습 — B4 ≤ 2 또는 몰림 ≥ 0.7', () => {
    assert.deepEqual(rules(ck({ b4: 2 }), mw()), ['spacing']);
    const r = F.evaluate(ck({ b4: 5 }), mw({ clumpBySubject: { 수학: 0.75, 영어: 0.5 } }));
    assert.equal(r[0].rule, 'spacing');
    assert.ok(r[0].text.indexOf('수학을 하루에 몰아서') === 0, r[0].text);
    assert.ok(/월·수·금/.test(r[0].text), '요일 배치 예시');
    assert.deepEqual(rules(ck({ b4: 3 }), mw({ clumpBySubject: { 수학: 0.69 } })), []);
  });

  test('feedback: 같은 방해 요인 3회 이상 → 요인별 팁', () => {
    const tip = (id) => F.evaluate(ck(), mw({ blockersTop: [{ id, count: 3 }] }))[0];
    assert.ok(/다른 방/.test(tip('phone').text));
    assert.ok(/시간대/.test(tip('sleepy').text));
    assert.ok(/장소/.test(tip('noise').text));
    assert.ok(/풀이 예제/.test(tip('hard').text) && /묻/.test(tip('hard').text));
    assert.deepEqual(rules(ck(), mw({ blockersTop: [{ id: 'phone', count: 2 }] })), []);
  });

  test('feedback: 다른 장소보다 1점 이상 높은 곳', () => {
    const r = F.evaluate(ck(), mw({ focusByPlace: { home: 4.5, cafe: 2, library: 3.5 } }));
    assert.equal(r[0].rule, 'place');
    assert.equal(r[0].text, '집 책상에서 집중이 제일 잘됐어. 어려운 과목을 거기서 해 보자.');
    assert.deepEqual(rules(ck(), mw({ focusByPlace: { home: 4.5, library: 3.6 } })), []);
    assert.deepEqual(rules(ck(), mw({ focusByPlace: { home: 5 } })), [], '장소가 하나면 비교 안 함');
  });

  test('feedback: 모든 지표 70% 이상 → 칭찬 + 사전 시험', () => {
    const r = F.evaluate(ck(), mw({ total: { executionRate: 0.7, amountRate: 0.9, strategyRate: 0.8 } }));
    assert.equal(r[0].rule, 'allGood');
    assert.equal(r[0].strategyId, 'pretest');
    assert.ok(/사전 시험/.test(r[0].text));
    assert.deepEqual(rules(ck(), mw({ total: { executionRate: 0.7, amountRate: null, strategyRate: 0.8 } })), []);
  });

  test('feedback: 위에서부터 최대 2개', () => {
    const many = mw({
      total: { executionRate: 0.3 },
      byStrategy: { interleave: 0.2 },
      clumpBySubject: { 수학: 1 },
      blockersTop: [{ id: 'phone', count: 5 }]
    });
    assert.deepEqual(rules(ck({ b1: 1 }), many), ['plan', 'strategy']);
    assert.deepEqual(rules(ck({ b1: 4 }), many), ['strategy', 'spacing']);
  });

  test('feedback: 첫 문장은 항상 긍정, 2~3문장, 판정 말투 없음', () => {
    const cases = [
      [ck(), mw()],
      [ck({ b1: 1, b4: 1 }), mw({ total: { executionRate: 0.1, amountRate: 0.05, strategyRate: 0 }, byStrategy: { interleave: 0 }, blockersTop: [{ id: 'sleepy', count: 4 }] })],
      [ck({ b3: 5 }), mw({ total: { executionRate: 0.2, amountRate: null, strategyRate: null } })],
      [ck({}), mw({ total: { planned: 0, recorded: 0, executionRate: null, amountRate: null, strategyRate: null } })],
      [ck({}, '목요일엔 블록 하나만'), mw({ total: { executionRate: 0.9, amountRate: 0.95, strategyRate: 1 } })]
    ];
    cases.forEach(([c, m], i) => {
      const lines = F.weekly(c, m);
      assert.ok(lines.length >= 2 && lines.length <= 3, `case ${i}: ${lines.length}`);
      assert.ok(/(잘했어|좋았어|멋져|보여!)/.test(lines[0]), `case ${i} 첫 문장: ${lines[0]}`);
      lines.forEach((l) => assert.ok(!BANNED.test(l), `case ${i}: ${l}`));
      // 말풍선 하나에 2문장 이내
      lines.forEach((l) => assert.ok((l.match(/[.?!](\s|$)/g) || []).length <= 2, `case ${i} 문장 수: ${l}`));
    });
  });

  test('feedback: 첫 문장은 가장 높은 지표·점수 기준', () => {
    assert.equal(F.opening(ck({ b3: 5 }), mw({ total: { executionRate: 0.8, amountRate: 0.6, strategyRate: 0.5 } })), '책을 덮고 떠올리는 시간을 많이 가진 게 좋았어.');
    assert.equal(F.opening(ck({ b3: 3 }), mw({ total: { executionRate: 0.8, amountRate: 0.6, strategyRate: 0.5 } })), '계획한 블록의 80%를 실행했어. 꾸준히 한 게 보여!');
    assert.equal(F.opening(ck(), mw({ total: { executionRate: 0.2, amountRate: 0.1, strategyRate: null } })), '이번 주 점검표를 끝까지 쓴 것부터 잘했어.');
  });

  test('checkin: 다음 주 실행 의도 맨 위, 중복 없음, 3개까지', () => {
    assert.deepEqual(C.applyNextChange([], '목요일엔 하나만'), [{ text: '목요일엔 하나만', from: 'lastWeek' }]);
    const two = [{ text: 'a', from: null }, { text: 'b', from: 'seven' }, { text: 'c', from: null }];
    assert.deepEqual(C.applyNextChange(two, 'x').map((x) => x.text), ['x', 'a', 'b']);
    // 이미 있으면 글만 바꿈
    const had = [{ text: '옛것', from: 'lastWeek' }, { text: 'a', from: null }];
    assert.deepEqual(C.applyNextChange(had, '새것'), [{ text: '새것', from: 'lastWeek' }, { text: 'a', from: null }]);
    // 같은 문장이 이미 있으면 그대로
    assert.deepEqual(C.applyNextChange([{ text: 'x', from: 'seven' }], ' x '), [{ text: 'x', from: 'seven' }]);
    // 빈 칸은 밀어내지 않음
    assert.deepEqual(C.applyNextChange([{ text: '', from: null }], 'x'), [{ text: 'x', from: 'lastWeek' }]);
    assert.deepEqual(C.applyNextChange(two, '  '), two);
  });

  test('checkin: upsert는 주차별 한 개, 주차 순', () => {
    let list = C.upsert([], { isoWeek: '2026-W47', a: 1 });
    list = C.upsert(list, { isoWeek: '2026-W46', a: 2 });
    list = C.upsert(list, { isoWeek: '2026-W47', a: 3 });
    assert.deepEqual(list.map((x) => [x.isoWeek, x.a]), [['2026-W46', 2], ['2026-W47', 3]]);
    assert.equal(C.find(list, '2026-W47').a, 3);
    assert.equal(C.find(list, '2026-W40'), null);
    assert.equal(C.nextWeek('2026-W53'), '2027-W01');
  });

  test('checkin: 작성할 차례 — 일요일이거나 마지막 기록일 이후, 제출 전', () => {
    const W = '2026-W46'; // 11/09 ~ 11/15
    assert.equal(C.isDue('2026-11-15', W, [], false), true, '일요일');
    assert.equal(C.isDue('2026-11-15', W, [], true), false, '제출함');
    assert.equal(C.isDue('2026-11-12', W, ['2026-11-09', '2026-11-11'], false), true, '마지막 기록일(수) 이후');
    assert.equal(C.isDue('2026-11-11', W, ['2026-11-09', '2026-11-11'], false), false, '기록일 당일');
    assert.equal(C.isDue('2026-11-12', W, [], false), false, '블록 없음');
    assert.equal(C.isDue('2026-11-17', W, ['2026-11-10'], false), true, '지난주');
    assert.equal(C.isDue('2026-11-08', W, ['2026-11-10'], false), false, '주 시작 전');
  });
})(window.SM);

test('checkin: 점검표를 다시 제출해도 지운 문장은 다시 넣지 않음', () => {
  const C = window.SM.checkin;
  const list = [{ text: 'a', from: null }];
  assert.deepEqual(C.applyNextChange(list, '목요일엔 하나만', '목요일엔 하나만'), list);
  assert.deepEqual(C.applyNextChange(list, '목요일엔 하나만', ' 목요일엔 하나만 '), list);
  assert.deepEqual(C.applyNextChange(list, '수요일엔 30분', '목요일엔 하나만').map((x) => x.text), ['수요일엔 30분', 'a']);
});
