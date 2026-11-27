(function (SM) {
  'use strict';
  const C = SM.chat;

  // 2026-11-19(목) 기준. 모든 조건이 '해당 없음'인 기본 상태 → 7번(평소)
  function st(over) {
    return Object.assign({
      today: '2026-11-19',
      hasResult: true, testInProgress: false, hasPlanStrategies: true,
      weekSubmitted: false, yesterdayUnrecorded: 0, todayBlocks: 2, todayGridEntries: 2,
      unread: { count: 0, names: [] }, dday: null, todayStrategy: null, retest: [],
      unchosenSubjects: [], myRule: '나는 저녁 9시가 되면 영단어 20개를 떠올려 본다.', todayRuleDone: null, hour: 10, compareReady: false
    }, over || {});
  }
  const id = (o) => C.pickGreeting(st(o)).id;

  test('chat.pickGreeting: 1 진단 전 / 진행 중', () => {
    const g = C.pickGreeting(st({ hasResult: false }));
    assert.equal(g.id, 'test');
    assert.equal(g.lines[0], '반가워! 먼저 너의 공부 스타일부터 알아볼까?');
    assert.deepEqual(g.choices.map((c) => c.label), ['시작하기']);
    const g2 = C.pickGreeting(st({ testInProgress: true }));
    assert.equal(g2.id, 'test');
    assert.deepEqual(g2.choices.map((c) => c.label), ['이어서 하기']);
    // 다른 조건이 모두 맞아도 1번이 먼저, 재진단 제안도 붙이지 않음
    const g3 = C.pickGreeting(st({ hasResult: false, hasPlanStrategies: false, todayBlocks: 0, retest: [{ type: 'retest', go: '#/test', text: 'x' }] }));
    assert.equal(g3.id, 'test');
    assert.equal(g3.lines.length, 1);
  });

  test('chat.pickGreeting: 2 과목별 전략을 아직 안 고름 → 고르지 않은 과목 탭으로', () => {
    const g = C.pickGreeting(st({ unchosenSubjects: ['영어', '과학'], todayBlocks: 0 }));
    assert.equal(g.id, 'strategy');
    assert.equal(g.lines[0], '과목별 전략을 아직 고르지 않았어. 3개 중 하나를 골라 볼까?');
    assert.deepEqual(g.choices[0], { label: '영어 전략 고르기', go: '#/strategy?s=' + encodeURIComponent('영어') });
    const g2 = C.pickGreeting(st({ hasPlanStrategies: false }));
    assert.deepEqual([g2.id, g2.choices[0].go], ['strategy', '#/strategy'], '추천을 아직 저장 안 했으면 전략 탭으로');
  });

  test('chat.pickGreeting: 2-1 전략은 골랐는데 나만의 한 가지 전략이 없음', () => {
    const g = C.pickGreeting(st({ myRule: '', yesterdayUnrecorded: 2 }));
    assert.equal(g.id, 'myRule');
    assert.equal(g.lines[0], '고른 전략으로 나만의 한 가지 전략을 만들어 볼까? 한 문장이면 돼.');
    assert.equal(g.choices[0].go, '#/strategy/seven');
    assert.equal(id({ myRule: '', unchosenSubjects: ['수학'] }), 'strategy', '고르지 않은 과목이 있으면 그게 먼저');
  });

  test('chat.pickGreeting: 2-2 저녁 8시 이후 + 오늘 체크 안 함 → "오늘 (문장) 지켰어?" 예/아니오', () => {
    const g = C.pickGreeting(st({ hour: 20, yesterdayUnrecorded: 1 }));
    assert.equal(g.id, 'ruleCheck');
    assert.equal(g.lines[0], "오늘 '나는 저녁 9시가 되면 영단어 20개를 떠올려 본다.' 지켰어?");
    assert.deepEqual(g.choices, [
      { label: '예', action: 'ruleDone', value: true, date: '2026-11-19' },
      { label: '아니오', action: 'ruleDone', value: false, date: '2026-11-19' }
    ]);
    assert.equal(id({ hour: 19 }), 'daily', '8시 전에는 묻지 않음');
    assert.equal(id({ hour: 21, todayRuleDone: false }), 'daily', '이미 체크했으면(아니오도) 묻지 않음');
    assert.equal(id({ hour: 23, todayRuleDone: true }), 'daily');
    assert.equal(id({ hour: 22, myRule: '' }), 'myRule', '문장이 없으면 만들기부터');
  });

  test('chat.pickGreeting: 2-3 재검사로 결과가 2개 이상이 된 직후 → 비교 권하기', () => {
    const g = C.pickGreeting(st({ compareReady: true, unchosenSubjects: ['수학'], myRule: '' }));
    assert.equal(g.id, 'compare');
    assert.equal(g.lines[0], '지난번 결과랑 비교해 볼래?');
    assert.equal(g.choices[0].go, '#/result/history?compare=1');
    assert.equal(id({ compareReady: true, hasResult: false }), 'test', '진단 중이면 진단이 먼저');
    // compareReady 계산: 결과 2개 이상 + 가장 최근 결과로 아직 안 권함
    const two = [{ id: 'a', takenAt: '2026-10-01' }, { id: 'b', takenAt: '2026-11-01' }];
    assert.equal(C.compareReady(two, undefined), true);
    assert.equal(C.compareReady(two, 'b'), false, '같은 결과로 두 번 권하지 않음');
    assert.equal(C.compareReady(two, 'a'), true, '새 결과가 생기면 다시');
    assert.equal(C.compareReady(two.slice(0, 1), undefined), false, '결과 1개면 비교할 게 없음');
  });

  test('chat.unchosenSubjects: 추천은 있는데 고르지 않은 과목만', () => {
    const plan = { strategies: { 수학: ['retrieval', 'interleave', 'spacing'], 영어: ['retrieval', 'spacing', 'chunking'], 국어: [] }, chosen: { 수학: 'interleave', 과학: 'nope' } };
    assert.deepEqual(C.unchosenSubjects(plan), ['영어']);
    assert.deepEqual(C.unchosenSubjects(null), []);
  });

  test('chat.pickGreeting: 3 일요일 + 점검표 미제출', () => {
    const g = C.pickGreeting(st({ today: '2026-11-22', yesterdayUnrecorded: 3 }));
    assert.equal(g.id, 'checkin');
    assert.equal(g.lines[0], '이번 주 돌아보기 할 시간이야. 3분이면 돼.');
    assert.deepEqual(g.choices.map((c) => c.label), ['점검하기', '나중에']);
    assert.ok(id({ today: '2026-11-22', weekSubmitted: true }) !== 'checkin', '제출했으면 아님');
    assert.ok(id({ today: '2026-11-21' }) !== 'checkin', '토요일은 아님');
  });

  test('chat.pickGreeting: 4 어제 기록 없는 블록', () => {
    const g = C.pickGreeting(st({ yesterdayUnrecorded: 1, todayBlocks: 0 }));
    assert.equal(g.id, 'record');
    assert.equal(g.choices[0].go, '#/planner/day?d=2026-11-18');
  });

  test('chat.pickGreeting: 5 오늘 블록 0개', () => {
    const g = C.pickGreeting(st({ todayBlocks: 0, unread: { count: 2, names: ['바람'] } }));
    assert.equal(g.id, 'today');
    assert.equal(g.lines[0], '오늘 계획을 아직 안 세웠어. 주간 배치표에서 불러올까?');
    assert.deepEqual(g.choices.map((c) => c.label), ['불러오기', '직접 쓰기']);
    assert.equal(g.choices[0].go, '#/planner/day');
    assert.equal(C.pickGreeting(st({ todayBlocks: 0, todayGridEntries: 0 })).choices[0].go, '#/planner/week', '배치표가 비었으면 주간으로');
  });

  test('chat.pickGreeting: 6 새 댓글(이/가)', () => {
    assert.equal(C.pickGreeting(st({ unread: { count: 1, names: ['바람'] } })).lines[0], '바람이 네 계획에 댓글을 남겼어!');
    assert.equal(C.pickGreeting(st({ unread: { count: 1, names: ['하늘이'] } })).lines[0], '하늘이가 네 계획에 댓글을 남겼어!');
    assert.equal(C.pickGreeting(st({ unread: { count: 3, names: ['해', '달'] } })).lines[0], '해 외 1명이 네 계획에 댓글을 남겼어!');
    assert.equal(C.pickGreeting(st({ unread: { count: 1, names: ['바람'] } })).choices[0].go, '#/class');
  });

  test('chat.pickGreeting: 7 평소 — D-day + 오늘의 핵심 전략', () => {
    const g = C.pickGreeting(st({ dday: { label: 'D-12 기말고사' }, todayStrategy: '교차 연습' }));
    assert.equal(g.id, 'daily');
    assert.equal(g.lines[0], 'D-12 기말고사까지 같이 가 보자. 오늘의 핵심 전략은 교차 연습!');
    assert.deepEqual(g.choices.map((c) => c.label), ['오늘 계획', '우리 반 보기']);
    assert.equal(C.pickGreeting(st()).lines[0], '오늘도 한 블록씩 해 보자!');
  });

  test('chat.pickGreeting: 재진단 제안은 인사 뒤에 덧붙임', () => {
    const g = C.pickGreeting(st({ retest: [{ type: 'retest', days: 30, go: '#/test', text: '내 스타일을 다시 확인해 볼까?' }] }));
    assert.equal(g.id, 'daily');
    assert.equal(g.lines[g.lines.length - 1], '내 스타일을 다시 확인해 볼까?');
    assert.deepEqual(g.choices[g.choices.length - 1], { label: '다시 진단하기', go: '#/test' });
    const g2 = C.pickGreeting(st({ hasPlanStrategies: false, retest: [{ type: 'strategy', subject: '수학', go: '#/strategy?s=수학', text: 't' }] }));
    assert.equal(g2.id, 'strategy');
    assert.equal(g2.choices[1].label, '전략 바꿔 보기');
  });

  test('chat.matchIntent: 위기 표현이 가장 먼저', () => {
    ['죽고 싶어', '나 그냥 사라지고 싶다', '자해 했어', '수학 망했어 진짜 죽고싶다', '오늘 계획 짜기 싫고 살기 싫어'].forEach((t) => {
      assert.equal(C.matchIntent(t).intent, 'crisis', t);
    });
    // 응답은 config 문구 + 1388·109
    const steps = C.replyFor('죽고 싶어', null);
    const text = steps.filter((s) => s.say).map((s) => s.say).join(' ');
    assert.ok(/담임 선생님이나 상담 선생님께 꼭 이야기해 줘/.test(text), text);
    assert.ok(/1388/.test(text) && /109/.test(text), text);
    const chips = steps.find((s) => s.choices).choices;
    assert.deepEqual(chips.map((c) => c.href), ['tel:1388', 'tel:109']);
    // 문구를 config에서 바꾸면 그대로 따른다
    const saved = SM.config.crisis;
    SM.config.crisis = { lines: ['바꾼 문구'], choices: [] };
    try {
      assert.deepEqual(C.replyFor('죽고 싶어', null), [{ say: '바꾼 문구' }]);
    } finally { SM.config.crisis = saved; }
  });

  test('chat.matchIntent: 표 순서와 공백·대소문자', () => {
    assert.equal(C.matchIntent('너무 힘들어').intent, 'distress');
    assert.equal(C.matchIntent('오늘 하기 싫어').intent, 'distress', '힘듦이 플래너보다 먼저');
    assert.equal(C.matchIntent('시험 불안해').anxious, true);
    assert.equal(C.matchIntent('지쳐').anxious, false);
    assert.equal(C.matchIntent('내 스타일 뭐였지').intent, 'test');
    assert.equal(C.matchIntent('전략 알려줘').intent, 'strategy');
    assert.equal(C.matchIntent('어 떻 게 공 부 해').intent, 'strategy', '공백 무시');
    assert.equal(C.matchIntent('이번 주 계획').view, 'week');
    assert.equal(C.matchIntent('이번 달').view, 'month');
    assert.equal(C.matchIntent('플래너').view, 'day');
    assert.equal(C.matchIntent('리포트 보여줘').intent, 'check');
    assert.equal(C.matchIntent('친구들 뭐해').intent, 'class');
    assert.equal(C.matchIntent('반').intent, 'class');
    assert.equal(C.matchIntent('WOOP').intent, 'strategyName');
    assert.equal(C.matchIntent('WOOP').strategyId, 'woop');
    assert.equal(C.matchIntent('우프가 뭐야').strategyId, 'woop');
    assert.equal(C.matchIntent('인출').strategyId, 'retrieval');
    assert.equal(C.matchIntent('교차 연습').strategyId, 'interleave');
    assert.equal(C.matchIntent('오답 노트').strategyId, 'errorLog');
    assert.equal(C.matchIntent('개념도').strategyId, 'conceptMap');
  });

  test('chat.findSubject: 과목명·별칭 추출', () => {
    assert.equal(C.findSubject('수학 전략 알려줘'), '수학');
    assert.equal(C.findSubject('영 어 는 어떻게 공부해'), '영어');
    assert.equal(C.findSubject('미적분 공부법'), '수학');
    assert.equal(C.findSubject('한국사 외우는 방법'), '사회');
    assert.equal(C.findSubject('물리랑 국어'), '과학', '앞에 나온 과목');
    assert.equal(C.findSubject('전략 알려줘'), null);
    const m = C.matchIntent('과학 전략 뭐가 좋아');
    assert.equal(m.intent, 'strategy');
    assert.equal(m.subject, '과학');
  });

  test('chat.matchIntent: 인식 실패 → 메뉴 칩 5개', () => {
    ['ㅋㅋㅋ', '배고파', '', '반복', 'asdf'].forEach((t) => assert.equal(C.matchIntent(t).intent, 'unknown', t));
    const steps = C.replyFor('배고파', null);
    assert.equal(steps[0].say, '잘 못 알아들었어. 이 중에 골라 줄래?');
    assert.equal(steps[1].choices.length, 5);
  });

  test('chat.josa / settings.checkBotName', () => {
    assert.equal(C.josa('바람', '이', '가'), '바람이');
    assert.equal(C.josa('하늘이', '이', '가'), '하늘이가');
    assert.equal(C.josa('Sky', '이', '가'), 'Sky가');
    assert.deepEqual(SM.settings.checkBotName('  '), { ok: true, value: '' });
    assert.deepEqual(SM.settings.checkBotName(' 메이트 '), { ok: true, value: '메이트' });
    assert.equal(SM.settings.checkBotName('가'.repeat(13)).ok, false);
    assert.equal(SM.settings.checkBotName('바 보').ok, false);
  });
})(window.SM);
