(function (SM) {
  'use strict';

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

  const W = '2026-W47';

  // 한 저장소를 여러 학생이 같이 쓰는 기기 흉내
  function world() {
    const store = SM.createStore(() => fakeStorage());
    let current = null;
    let t = Date.parse('2026-11-19T10:00:00Z');
    const now = () => (t += 1000);
    const profiles = {};
    const as = (sid, nickname) => {
      profiles[sid] = profiles[sid] || { sid, classId: sid.replace(/-\d+$/, ''), nickname };
      current = profiles[sid];
      return api;
    };
    const planner = SM.createPlanner({ store, sid: () => (current ? current.sid : null) });
    // SM.planner의 순수 함수 + 이 저장소의 planner 인스턴스
    const P = Object.assign({}, SM.planner, planner);
    const metrics = { week: (w) => SM.metrics.week(w, (iso) => planner.getDay(iso)) };
    const feed = SM.createFeed({ store, profile: () => current, planner: P, metrics, now, bannedWords: () => ['바보', 'stupid'] });
    const api = { store, planner: P, feed, as, now };
    return api;
  }

  function writeWeek(w, sid, nick, week) {
    w.as(sid, nick);
    w.planner.saveWeek(W, Object.assign({
      goals: [{ subject: '수학', text: '이차함수 40개' }],
      strategies: { 수학: ['interleave'] },
      grid: {}, intentions: [{ text: '만약 9시면 시작', from: null }], obstacle: '목요일 보강',
      public: true, publicRate: false
    }, week || {}));
    return w.feed.syncWeek(W);
  }

  test('feed: 다른 반 스냅샷은 보이지 않음', () => {
    const w = world();
    writeWeek(w, 'DEMO-1-1-5', '하늘');
    writeWeek(w, 'DEMO-1-2-7', '바다');           // 다른 반
    writeWeek(w, 'SM01-1-1-3', '구름');           // 다른 학교 같은 학년·반 번호
    w.as('DEMO-1-1-9', '별');
    assert.deepEqual(w.feed.list().map((x) => x.nickname), ['하늘']);
    w.as('DEMO-1-2-1', '달');
    assert.deepEqual(w.feed.list().map((x) => x.nickname), ['바다']);
    // 누가 다른 반 스냅샷을 우리 반 키에 억지로 넣어도 보이지 않음
    const list = w.store.get(SM.keys.feed('DEMO-1-1'), []);
    list.push({ planKey: `DEMO-1-2-7:${W}`, sid: 'DEMO-1-2-7', nickname: '침입', week: W, goals: [], strategies: {}, updatedAt: '2099-01-01' });
    w.store.set(SM.keys.feed('DEMO-1-1'), list);
    w.as('DEMO-1-1-9', '별');
    assert.deepEqual(w.feed.list().map((x) => x.nickname), ['하늘']);
    // 다른 반 계획에는 댓글·반응도 못 단다
    assert.equal(w.feed.addComment(`DEMO-1-2-7:${W}`, '안녕').ok, false);
    assert.equal(w.feed.react(`DEMO-1-2-7:${W}`, 'cheer').ok, false);
  });

  test('feed: 비공개 계획은 스냅샷이 없고, 공개를 끄면 지워짐', () => {
    const w = world();
    assert.equal(writeWeek(w, 'DEMO-1-1-5', '하늘', { public: false }), null);
    w.as('DEMO-1-1-9', '별');
    assert.equal(w.feed.list().length, 0);
    writeWeek(w, 'DEMO-1-1-5', '하늘', { public: true });
    w.as('DEMO-1-1-9', '별');
    assert.equal(w.feed.list().length, 1);
    writeWeek(w, 'DEMO-1-1-5', '하늘', { public: false });
    w.as('DEMO-1-1-9', '별');
    assert.equal(w.feed.list().length, 0);
  });

  test('feed: 스냅샷에는 공개용 요약만(일간 기록·점검표·진단·장애물 없음)', () => {
    const w = world();
    w.as('DEMO-1-1-5', '하늘');
    w.planner.saveDay('2026-11-17', [{ id: 'b', subject: '수학', strategy: 'interleave', start: '19:00', end: '20:00', done: { applied: 'yes', note: '비밀 메모' } }]);
    const snap = writeWeek(w, 'DEMO-1-1-5', '하늘');
    assert.deepEqual(Object.keys(snap).sort(), ['goals', 'nickname', 'planKey', 'sid', 'strategies', 'updatedAt', 'week', 'weekFocus']);
    assert.equal(snap.planKey, `DEMO-1-1-5:${W}`);
    const raw = JSON.stringify(w.store.get(SM.keys.feed('DEMO-1-1')));
    ['비밀 메모', '목요일 보강', '만약 9시면', 'blocks', 'scores'].forEach((s) => assert.ok(raw.indexOf(s) === -1, s));
  });

  test('feed: 실천률은 공개 체크했을 때만 rate', () => {
    const w = world();
    w.as('DEMO-1-1-5', '하늘');
    w.planner.saveDay('2026-11-17', [{ id: 'b', subject: '수학', strategy: 'interleave', start: '19:00', end: '20:00', done: { applied: 'partial' } }]);
    const off = writeWeek(w, 'DEMO-1-1-5', '하늘', { publicRate: false });
    assert.equal('rate' in off, false);
    const on = writeWeek(w, 'DEMO-1-1-5', '하늘', { publicRate: true });
    assert.equal(on.rate, 0.5);
  });

  test('feed: 월간 목표는 월간 공개를 켰을 때만, 내용이 같으면 updatedAt 유지', () => {
    const w = world();
    const first = writeWeek(w, 'DEMO-1-1-5', '하늘');
    assert.equal('monthGoals' in first, false);
    const again = w.feed.syncWeek(W);
    assert.equal(again.updatedAt, first.updatedAt, '같은 내용이면 그대로');
    const m = w.planner.load('2026-11');
    m.month.goals = ['수학 완성', ''];
    m.month.public = true;
    w.planner.save('2026-11', m);
    assert.equal(w.feed.syncMonth('2026-11'), 1);
    const snap = w.feed.snapshotOf(`DEMO-1-1-5:${W}`);
    assert.deepEqual(snap.monthGoals, ['수학 완성']);
    assert.ok(snap.updatedAt > first.updatedAt);
  });

  test('feed: 최신순, 과목·전략 필터', () => {
    const w = world();
    writeWeek(w, 'DEMO-1-1-5', '하늘');
    writeWeek(w, 'DEMO-1-1-6', '바람', { goals: [{ subject: '영어', text: '단어' }], strategies: { 영어: ['retrieval'] } });
    w.as('DEMO-1-1-9', '별');
    assert.deepEqual(w.feed.list().map((x) => x.nickname), ['바람', '하늘']);
    assert.deepEqual(w.feed.list({ subject: '수학' }).map((x) => x.nickname), ['하늘']);
    assert.deepEqual(w.feed.list({ strategy: 'retrieval' }).map((x) => x.nickname), ['바람']);
  });

  test('feed: 빠른 반응 토글(같은 사람 같은 반응 다시 누르면 취소)', () => {
    const w = world();
    writeWeek(w, 'DEMO-1-1-5', '하늘');
    const key = `DEMO-1-1-5:${W}`;
    w.as('DEMO-1-1-9', '별');
    assert.deepEqual(w.feed.react(key, 'cheer'), { ok: true, on: true });
    w.feed.react(key, 'try');
    w.as('DEMO-1-1-8', '해');
    w.feed.react(key, 'cheer');
    let c = w.feed.counts(key);
    assert.deepEqual(c.reactions, { cheer: 2, try: 1, question: 0 });
    assert.deepEqual(c.mine, { cheer: true, try: false, question: false });
    assert.deepEqual(w.feed.react(key, 'cheer'), { ok: true, on: false });
    c = w.feed.counts(key);
    assert.deepEqual(c.reactions, { cheer: 1, try: 1, question: 0 });
    assert.equal(c.comments, 0, '반응은 댓글 수에 안 들어감');
    assert.equal(w.feed.react(key, 'love').ok, false);
  });

  test('feed: 숨김 권한 — 계획 작성자만, 숨긴 댓글은 작성자·계획 작성자에게만', () => {
    const w = world();
    writeWeek(w, 'DEMO-1-1-5', '하늘');
    const key = `DEMO-1-1-5:${W}`;
    w.as('DEMO-1-1-9', '별');
    const cm = w.feed.addComment(key, '나도 교차 연습 해 볼래').comment;
    assert.equal(w.feed.setHidden(cm.id, true).ok, false, '댓글 작성자는 숨기기 못 함');
    w.as('DEMO-1-1-8', '해');
    assert.equal(w.feed.setHidden(cm.id, true).ok, false, '제삼자는 숨기기 못 함');
    w.as('DEMO-1-1-5', '하늘');
    assert.equal(w.feed.setHidden(cm.id, true).ok, true);
    assert.equal(w.feed.comments(key)[0].hidden, true, '계획 작성자에게는 숨겨진 댓글로 보임');
    w.as('DEMO-1-1-9', '별');
    assert.equal(w.feed.comments(key).length, 1, '댓글 작성자 본인에게도 보임');
    w.as('DEMO-1-1-8', '해');
    assert.equal(w.feed.comments(key).length, 0, '다른 친구에게는 안 보임');
    assert.equal(w.feed.counts(key).comments, 0);
    // 본인 댓글만 수정·삭제
    assert.equal(w.feed.editComment(cm.id, '바꿈').ok, false);
    assert.equal(w.feed.deleteComment(cm.id).ok, false);
    w.as('DEMO-1-1-9', '별');
    assert.equal(w.feed.editComment(cm.id, '바꿈').comment.text, '바꿈');
    assert.ok(w.feed.editComment(cm.id, '바꿈2').comment.editedAt);
    assert.equal(w.feed.deleteComment(cm.id).ok, true);
  });

  test('feed: 금칙어·길이 차단', () => {
    const w = world();
    writeWeek(w, 'DEMO-1-1-5', '하늘');
    const key = `DEMO-1-1-5:${W}`;
    w.as('DEMO-1-1-9', '별');
    const r = w.feed.addComment(key, '너 바 보 같아');
    assert.equal(r.ok, false);
    assert.equal(r.banned, true);
    assert.equal(w.feed.addComment(key, 'STUPID plan').ok, false);
    assert.equal(w.feed.addComment(key, '   ').ok, false);
    assert.equal(w.feed.addComment(key, '가'.repeat(201)).ok, false);
    assert.equal(w.feed.addComment(key, '가'.repeat(200)).ok, true);
    assert.equal(w.feed.comments(key).length, 1);
    assert.equal(SM.feed.checkText('응원해!', ['바보']).ok, true);
  });

  test('feed: <script> 문자열은 그대로 저장되고 텍스트로만 표시', () => {
    const w = world();
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    writeWeek(w, 'DEMO-1-1-5', '하늘', { goals: [{ subject: '수학', text: evil }] });
    const key = `DEMO-1-1-5:${W}`;
    w.as('DEMO-1-1-9', '별');
    const c = w.feed.addComment(key, evil).comment;
    assert.equal(c.text, evil, '이스케이프하거나 지우지 않고 원문 그대로');
    assert.equal(w.feed.list()[0].goals[0].text, evil);
    if (typeof document !== 'undefined' && document.createElement) {
      const node = SM.ui.el('p', { class: 'comment-text', text: c.text });
      assert.equal(node.textContent, evil);
      assert.equal(node.children.length, 0, '요소가 만들어지지 않음');
    }
    // feed.js 화면 코드에는 innerHTML이 없다
    assert.throws(() => SM.ui.el('p', { innerHTML: evil }));
  });

  test('feed: unreadFor — 마지막으로 본 뒤 내 계획에 달린 남의 댓글만', () => {
    const w = world();
    writeWeek(w, 'DEMO-1-1-5', '하늘');
    const key = `DEMO-1-1-5:${W}`;
    w.as('DEMO-1-1-9', '별');
    w.feed.addComment(key, '화이팅');
    w.feed.react(key, 'cheer');
    assert.equal(w.feed.unreadFor('DEMO-1-1-5'), 1);
    w.as('DEMO-1-1-5', '하늘');
    w.feed.addComment(key, '고마워');            // 내 댓글은 안 셈
    w.feed.markSeen();
    assert.equal(w.feed.unreadFor('DEMO-1-1-5'), 0);
    w.as('DEMO-1-1-8', '해');
    const c2 = w.feed.addComment(key, '나도!').comment;
    assert.equal(w.feed.unreadFor('DEMO-1-1-5'), 1);
    w.as('DEMO-1-1-5', '하늘');
    w.feed.setHidden(c2.id, true);
    assert.equal(w.feed.unreadFor('DEMO-1-1-5'), 0, '숨긴 댓글은 안 셈');
    assert.equal(w.feed.unreadFor('DEMO-1-1-9'), 0);
  });

  test('feed: 주차 표시', () => {
    assert.equal(SM.feed.weekLabel('2026-W47'), '11월 3주');
    assert.equal(SM.feed.weekLabel('2026-W45'), '11월 1주');
    assert.equal(SM.feed.weekLabel('2026-W49'), '11월 5주');
    assert.equal(SM.feed.weekLabel('2026-W44'), '10월 4주');   // 10월 월요일: 5, 12, 19, 26
  });
})(window.SM);
