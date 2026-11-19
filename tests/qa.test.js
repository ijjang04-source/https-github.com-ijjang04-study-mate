// 21단계 통합 점검: docs/QA.md의 자동 확인 기준 중 다른 테스트 파일에 없던 것.
(function (SM) {
  'use strict';

  function fakeStorage() {
    const map = new Map();
    return {
      get length() { return map.size; },
      key(i) { const k = Array.from(map.keys())[i]; return k === undefined ? null : k; },
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(String(k), String(v)); },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); }
    };
  }

  const config = {
    schools: [{ id: 'DEMO', name: '체험' }],
    classes: [{ school: 'DEMO', grade: 1, cls: 1, codeHash: SM.auth.fallbackHash('1234') }],
    bannedWords: ['바보'],
    autoLogoutMinutes: 30
  };
  const input = (code) => ({ school: 'DEMO', grade: 1, cls: 1, number: 5, nickname: '하늘', code });

  test('QA-01 틀린 입장 코드로는 입장할 수 없다(세션·프로필이 생기지 않음)', async () => {
    const store = SM.createStore(() => fakeStorage());
    const auth = SM.createAuth({ store, session: fakeStorage(), config });
    const r = await auth.login(input('9999'));
    assert.equal(r.ok, false);
    assert.equal(r.field, 'code');
    assert.equal(store.get(SM.keys.session(), null), null);
    assert.equal(store.get(SM.keys.profile('DEMO-1-1-5'), null), null);
    assert.equal(auth.current(), null);
  });

  test('QA-02 새로고침(새 인스턴스)해도 로그인·입력·진단 진행이 유지된다', async () => {
    const backend = fakeStorage();   // localStorage 흉내: 새로고침해도 남는다
    const session = fakeStorage();
    let store = SM.createStore(() => backend);
    let auth = SM.createAuth({ store, session, config });
    assert.ok((await auth.login(input('1234'))).ok);
    let planner = SM.createPlanner({ store, sid: () => 'DEMO-1-1-5' });
    const b = SM.planner.newBlock({ subject: '수학', strategy: 'interleave', place: 'library', modes: ['solve'] });
    planner.saveDayData('2026-11-19', { blocks: [b] });
    store.set(SM.keys.testProgress('DEMO-1-1-5'), { order: ['q1', 'q2'], answers: { q1: 3 } });

    // 새로고침: 모든 인스턴스를 같은 저장소로 다시 만든다
    store = SM.createStore(() => backend);
    auth = SM.createAuth({ store, session, config });
    planner = SM.createPlanner({ store, sid: () => 'DEMO-1-1-5' });
    assert.equal(auth.restore().nickname, '하늘');
    assert.equal(planner.getDay('2026-11-19')[0].subject, '수학');
    assert.deepEqual(store.get(SM.keys.testProgress('DEMO-1-1-5')).answers, { q1: 3 });
  });

  test('QA-05 진단 이어 하기: 저장된 진행에서 답하지 않은 첫 문항부터', () => {
    const order = SM.test.buildOrder(['수학'], (() => { let x = 7; return () => (x = (x * 9301 + 49297) % 233280) / 233280; })());
    const answers = {};
    order.slice(0, 10).forEach((id) => {
      const q = SM.test.itemById(id);
      answers[id] = q.format === 'forced' ? 'a' : q.format === 'multi' ? ['V'] : 3;
    });
    const saved = JSON.parse(JSON.stringify({ order, answers })); // 저장 → 다시 읽기
    assert.equal(SM.test.resumeIndex(saved), 10);
  });

  // 결과 화면·챗봇에 나가는 문구에 "○○형" 단일 라벨이 없어야 한다
  const LABEL = /너는\s*\S*형|형이야|형이다|형입니다|유형이야/;
  function strings(x, out) {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach((v) => strings(v, out));
    else if (x && typeof x === 'object') Object.keys(x).forEach((k) => strings(x[k], out));
    return out;
  }

  test('QA-07 단일 라벨 없음: 데이터 문구·결과 요약·차원 설명', () => {
    const all = strings(SM.data, []);
    assert.ok(all.length > 500, '데이터 문구 수 ' + all.length);
    all.forEach((s) => assert.ok(!LABEL.test(s), '데이터: ' + s));
    // 여러 응답 조합의 결과 요약
    const Q = SM.data.styleQuestions.filter((q) => q.set === 'basic');
    [1, 2, 3, 4, 5].forEach((v) => {
      const answers = {};
      Q.forEach((q, i) => { answers[q.id] = q.format === 'forced' ? (v + i) % 2 ? 'a' : 'b' : q.format === 'multi' ? ['V'] : v; });
      const r = SM.score.basic(answers, ['수학']);
      const text = [SM.score.summary(r)].concat(Object.keys(r.styles).map((id) => SM.score.bandText ? String(SM.score.bandText(r.styles[id])) : ''));
      text.forEach((s) => assert.ok(!LABEL.test(s), '요약: ' + s));
    });
  });

  test('QA-09 일간 블록에 장소·방식·적용 전략을 기록하고, 지표가 그것을 쓴다', () => {
    const store = SM.createStore(() => fakeStorage());
    const planner = SM.createPlanner({ store, sid: () => 'DEMO-1-1-5' });
    const iso = '2026-11-16'; // 월
    const b1 = SM.planner.newBlock({ start: '19:00', end: '19:50', subject: '수학', strategy: 'interleave', method: '유형 섞어 풀기', place: 'library', modes: ['solve'], target: { n: 20, unit: '문제' } });
    b1.done = Object.assign(SM.planner.newDone(b1), { n: 20, applied: 'yes', focus: 5 });
    const b2 = SM.planner.newBlock({ start: '20:00', end: '20:50', subject: '영어', strategy: 'retrieval', method: '백지 복습', place: 'home', modes: ['quiz'], target: { n: 10, unit: '쪽' } });
    b2.done = Object.assign(SM.planner.newDone(b2), { n: 5, applied: 'no', focus: 2 });
    planner.saveDayData(iso, { blocks: [b1, b2] });
    const back = SM.createPlanner({ store, sid: () => 'DEMO-1-1-5' }).getDay(iso);
    assert.equal(back[0].place, 'library');
    assert.equal(back[0].method, '유형 섞어 풀기');
    assert.deepEqual(back[0].modes, ['solve']);
    assert.equal(back[0].strategy, 'interleave');
    assert.equal(back[0].done.applied, 'yes');
    assert.equal(back[0].done.place, 'library', '기록 시 장소');
    const w = SM.metrics.week('2026-W47', (d) => (d === iso ? back : []));
    assert.equal(w.byStrategy.interleave, 1);
    assert.equal(w.byStrategy.retrieval, 0);
    assert.equal(w.focusByPlace.library, 5);
    assert.equal(w.focusByPlace.home, 2);
  });

  test('QA-11 점검표의 "다음 주에 바꿀 한 가지"가 다음 주 플래너 실행 의도 맨 위에 들어간다', () => {
    const store = SM.createStore(() => fakeStorage());
    const planner = SM.createPlanner({ store, sid: () => 'DEMO-1-1-5' });
    planner.saveWeek('2026-W48', SM.planner.normalizeWeek({ intentions: [{ text: '아침에 단어 20개', from: null }] }));
    const nw = SM.checkin.carryNextChange(planner, '2026-W47', ' 목요일엔 블록 하나만 ');
    assert.equal(nw, '2026-W48');
    assert.deepEqual(planner.getWeek('2026-W48').intentions, [{ text: '목요일엔 블록 하나만', from: 'lastWeek' }, { text: '아침에 단어 20개', from: null }]);
    assert.equal(planner.getWeek('2026-W47').review.nextChange, '목요일엔 블록 하나만');
    // 주간 화면을 열 때(carryInto) 중복으로 또 넣지 않는다
    const opened = SM.planner.carryInto(planner.getWeek('2026-W48').intentions, SM.planner.nextChangeOf(planner.getWeek('2026-W47')), null);
    assert.equal(opened.filter((x) => x.from === 'lastWeek').length, 1);
    // 해를 넘기는 주
    assert.equal(SM.checkin.carryNextChange(planner, '2026-W53', 'x'), '2027-W01');
  });

  test('QA-perf 1년치 데이터: 생성 규모와 월간 지표 계산 시간', () => {
    const quiet = console.warn; console.warn = () => {};
    let store;
    try { store = SM.createStore(() => { throw new Error('메모리 저장소 사용'); }); } finally { console.warn = quiet; }
    const info = SM.seed.year(store, {});
    assert.equal(info.blocks, 365 * 6);
    assert.equal(info.checkins, 52);
    assert.equal(info.snapshots, 30 * 20);
    const planner = SM.createPlanner({ store, sid: () => info.sid });
    const t0 = Date.now();
    const m = SM.metrics.month('2026-11', (d) => planner.getDay(d));
    const ms = Date.now() - t0;
    assert.ok(m.length >= 4);
    assert.ok(ms < 1000, '월간 지표 ' + ms + 'ms');
    const bytes = store.usageBytes();
    assert.ok(bytes < 5 * 1024 * 1024, '1년치 ' + Math.round(bytes / 1024) + 'KB는 5MB 안');
  });
})(window.SM);
