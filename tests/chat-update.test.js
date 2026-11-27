(function (SM) {
  'use strict';

  // 챗봇: 나만의 한 가지 전략·결과 기록·용어 풀이 흐름과 문구 원칙

  const C = SM.chat;
  const SID = 'SM01-2-3-27';
  const RULE = '나는 저녁 9시가 되면 영단어 20개를 떠올려 본다.';

  /** 입장한 학생 한 명을 만들고 fn이 끝나면 그 학생 키를 모두 지운다 */
  function asStudent(fn) {
    const S = SM.store;
    S.set(SM.keys.profile(SID), { sid: SID, nickname: '바람', greeted: true });
    S.set(SM.keys.session(), { sid: SID, lastActive: Date.now() });
    const done = () => {
      S.keys('').filter((k) => k.indexOf(SID) !== -1).forEach((k) => S.remove(k));
      S.remove(SM.keys.session());
    };
    try { const r = fn(S); done(); return r; } catch (e) { done(); throw e; }
  }

  function result(id, takenAt) {
    return { id, kind: 'basic', takenAt, subjects: ['수학'], weakness: [{ subject: '수학', codes: [] }], anxiety: false,
      styles: { fieldDep: 0, tempo: 0, perception: 0, reasoning: 0, processing: 0, input: 0, order: 0, kolbPerceive: 0, kolbProcess: 0 },
      vark: { counts: { V: 0, A: 0, R: 0, K: 0 }, preferred: [] }, kolb: { perceive: 0, process: 0, type: 'balanced' } };
  }

  // ---------- 키워드 ----------

  test('chat 키워드: 한 가지 전략·내 전략 → myRule, 결과 기록·지난 결과·비교 → history, 뜻 묻기 → term', () => {
    const it = (t) => C.matchIntent(t).intent;
    ['한 가지 전략 보여줘', '내 전략 뭐였지', '나만의 전략'].forEach((t) => assert.equal(it(t), 'myRule', t));
    ['결과 기록', '지난 결과 보여줘', '비교'].forEach((t) => assert.equal(it(t), 'history', t));
    ['교차 연습 뜻이 뭐야', '메타인지가 무슨 뜻이야', '시각형 뜻이 뭐야?', '무슨 뜻이야'].forEach((t) => assert.equal(it(t), 'term', t));
    assert.equal(it('교차 연습 알려줘'), 'strategyName', '뜻을 묻지 않으면 전략 카드');
    assert.equal(it('전략 추천해 줘'), 'strategy', '"전략"만 있으면 그대로 전략');
  });

  test('chat 용어: "○○ 뜻이 뭐야" → 사전의 쉬운 말 + 예시, 긴 용어가 우선', () => {
    assert.equal(C.findTerm('정교화 질문 뜻이 뭐야'), '정교화 질문');
    assert.equal(C.findTerm('정교화뜻이뭐야'), '정교화');
    assert.equal(C.findTerm('woop 뜻'), 'WOOP', '소문자로 써도 찾음');
    const G = SM.data.glossary;
    const steps = C.replyFor('자동화 뜻이 뭐야', null);
    assert.equal(steps[0].say, `자동화는 쉽게 말해 ${G['자동화'].easy}이야.`);
    assert.equal(steps[1].say, `예) ${G['자동화'].example}`);
    assert.equal(steps[2].choices[0].go, '#/strategy/terms');
    assert.equal(C.replyFor('인출 연습 무슨 뜻이야', null)[0].say, `인출 연습은 쉽게 말해 ${G['인출 연습'].easy}야.`, '받침 없으면 "야"');
    const none = C.replyFor('무슨 뜻이야', null);
    assert.ok(/어떤 말이 궁금해/.test(none[0].say) && none[1].choices[0].go === '#/strategy/terms', '용어가 없으면 되묻기');
  });

  test('chat 내 전략: 문장이 있으면 카드, 없으면 만들기 권함', () => asStudent((S) => {
    S.set(SM.keys.results(SID), [result('r1', '2026-11-01')]);
    let steps = C.replyFor('내 전략', SM.auth.current());
    assert.equal(steps[0].say, '고른 전략으로 나만의 한 가지 전략을 만들어 볼까? 한 문장이면 돼.');
    assert.equal(steps[1].choices[0].go, '#/strategy/seven');
    S.set(SM.keys.plan(SID), { strategies: { 수학: ['retrieval'] }, chosen: { 수학: 'retrieval' }, myRule: { text: RULE } });
    steps = C.replyFor('한 가지 전략', SM.auth.current());
    assert.equal(steps[0].card.title, '나만의 한 가지 전략');
    assert.equal(steps[0].card.lines[0], RULE);
  }));

  // ---------- 상태 모으기 ----------

  test('chat.collectState: 고르지 않은 과목·문장·오늘 체크·저녁 시각·비교 준비', () => asStudent((S) => {
    const today = '2026-11-19';
    S.set(SM.keys.results(SID), [result('r1', '2026-10-20'), result('r2', today)]);
    S.set(SM.keys.plan(SID), { strategies: { 수학: ['retrieval', 'spacing', 'interleave'], 영어: ['retrieval', 'spacing', 'chunking'] }, chosen: { 수학: 'spacing' }, myRule: { text: RULE } });
    const at20 = new Date(2026, 10, 19, 20, 30);
    let s = C.collectState(SM.auth.current(), at20);
    assert.deepEqual([s.unchosenSubjects, s.myRule, s.todayRuleDone, s.hour, s.compareReady], [['영어'], RULE, null, 20, true]);
    assert.equal(C.pickGreeting(s).id, 'compare', '재검사 직후가 먼저');
    // 비교를 권한 뒤에는 고르지 않은 과목
    S.set(SM.keys.chatMeta(SID), { compareOfferedFor: 'r2' });
    s = C.collectState(SM.auth.current(), at20);
    const g = C.pickGreeting(s);
    assert.deepEqual([g.id, g.choices[0].go], ['strategy', '#/strategy?s=' + encodeURIComponent('영어')]);
    // 다 고르면 저녁 체크
    S.update(SM.keys.plan(SID), (p) => Object.assign({}, p, { chosen: { 수학: 'spacing', 영어: 'chunking' } }));
    assert.equal(C.pickGreeting(C.collectState(SM.auth.current(), at20)).id, 'ruleCheck');
    SM.planner.setMyRuleDone(today, false);
    assert.equal(C.collectState(SM.auth.current(), at20).todayRuleDone, false);
    assert.ok(C.pickGreeting(C.collectState(SM.auth.current(), at20)).id !== 'ruleCheck', '체크했으면 다시 묻지 않음');
  }));

  test('chat 예/아니오: 누르면 그날 일간 기록(myRuleDone)에 바로 저장', () => asStudent(() => {
    const iso = '2026-11-19';
    C.actions.ruleDone({ label: '예', action: 'ruleDone', value: true, date: iso });
    assert.equal(SM.planner.getDayData(iso).myRuleDone, true);
    C.actions.ruleDone({ label: '아니오', action: 'ruleDone', value: false, date: iso });
    assert.equal(SM.planner.getDayData(iso).myRuleDone, false);
    assert.deepEqual(SM.planner.getDayData(iso).blocks, [], '블록은 건드리지 않음');
  }));

  test('chat 재검사 직후: 결과가 2개 이상이 되면 한 번만 비교를 권함', () => asStudent((S) => {
    S.set(SM.keys.results(SID), [result('r1', '2026-10-20')]);
    assert.equal(C.offerCompare(SID), false, '결과 1개면 권하지 않음');
    S.set(SM.keys.results(SID), [result('r1', '2026-10-20'), result('r2', '2026-11-19')]);
    assert.equal(C.offerCompare(SID), true);
    assert.equal(S.get(SM.keys.chatMeta(SID)).compareOfferedFor, 'r2');
    const log = S.get(SM.keys.chat(SID), []);
    const card = (Array.isArray(log) ? log : (log && log.messages) || []).filter((m) => m.type === 'card').pop();
    assert.ok(card, '챗봇 기록에 비교 카드가 남음');
    assert.equal(card.card.lines[0], '지난번 결과랑 비교해 볼래?');
    assert.equal(card.card.actions[0].go, '#/result/history?compare=1');
    assert.equal(C.offerCompare(SID), false, '같은 결과로 두 번 권하지 않음');
  }));

  // ---------- 문구 원칙 ----------

  /**
   * 챗봇이 말하는 한 메시지 안에서 사전 용어가 처음 나올 때는 괄호 안("쉬운 말(용어)")이어야 한다.
   * → 어긴 용어 목록
   */
  function bareTerms(text) {
    const G = SM.data.glossary;
    const terms = Object.keys(G).sort((a, b) => b.length - a.length);
    const seen = new Set();
    const bad = [];
    terms.forEach((t) => {
      const at = text.indexOf(t);
      if (at === -1 || seen.has(t)) return;
      // 더 긴 용어 안에 든 것은 그 용어로 본다
      if (terms.some((u) => u.length > t.length && u.indexOf(t) !== -1 && text.indexOf(u) !== -1)) return;
      seen.add(t);
      const open = text.lastIndexOf('(', at);
      const close = text.lastIndexOf(')', at);
      if (!(open !== -1 && open > close)) bad.push(t);
    });
    return bad;
  }

  function messageTexts(steps) {
    const out = [];
    (steps || []).forEach((st) => {
      if (st.say) out.push(st.say);
      if (st.card) out.push([st.card.title].concat(st.card.lines || []).join(' '));
      if (st.choices) st.choices.forEach((c) => out.push(c.label));
    });
    return out;
  }

  test("chat 문구: '일곱'이라는 말이 없고, 전문 용어는 쉬운 말 뒤 괄호로만(뜻 풀이 답은 제외)", () => {
    const texts = [];
    Object.keys(SM.flows).forEach((k) => texts.push(...messageTexts(SM.flows[k])));
    const base = { today: '2026-11-19', hasResult: true, hasPlanStrategies: true, todayBlocks: 2, todayGridEntries: 2,
      unread: { count: 0, names: [] }, unchosenSubjects: [], myRule: RULE, hour: 10, retest: [] };
    [{ hasResult: false }, { testInProgress: true }, { compareReady: true }, { unchosenSubjects: ['수학'] }, { hasPlanStrategies: false },
      { myRule: '' }, { hour: 21 }, { today: '2026-11-22' }, { yesterdayUnrecorded: 1 }, { todayBlocks: 0 },
      { unread: { count: 1, names: ['해'] } }, { dday: { label: 'D-3 기말' }, todayStrategy: SM.data.strategies.find((s) => s.id === 'retrieval').name },
      { retest: [{ type: 'retest', go: '#/test', text: '내 스타일을 다시 확인해 볼까?' }] },
      { retest: [{ type: 'strategy', go: '#/strategy', text: '수학 전략이 2주 동안 잘 안 붙었어. 다른 전략으로 바꿔 볼까?' }] }]
      .forEach((o) => { const g = C.pickGreeting(Object.assign({}, base, o)); texts.push(...g.lines, ...g.choices.map((c) => c.label)); });
    ['안녕', '진단', '전략', '오늘 계획', '점검', '우리 반', '설정', '힘들어', '불안해', '결과 기록', '내 전략', '모르겠어']
      .forEach((t) => texts.push(...messageTexts(C.replyFor(t, null))));
    SM.data.strategies.forEach((s) => texts.push(...messageTexts(C.replyFor(s.term || s.name, null))));
    // 점검 뒤 챗봇이 그대로 말하는 피드백 문구
    texts.push('모든 지표가 70%를 넘었어! 다음엔 배우기 전에 먼저 풀어 보기(사전 시험)에 도전해 볼까?');
    const bad = [];
    texts.forEach((t) => {
      if (/일곱/.test(t)) bad.push('일곱: ' + t);
      bareTerms(t).forEach((x) => bad.push(`${x}: ${t}`));
    });
    assert.deepEqual(bad, []);
    assert.deepEqual(bareTerms('인출 연습을 해 봐.'), ['인출 연습'], '검사 함수가 맨 용어를 잡아냄');
    assert.deepEqual(bareTerms('기억에서 꺼내 보기(인출 연습)를 해.'), []);
  });
})(window.SM = window.SM || {});
