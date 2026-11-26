(function (SM) {
  'use strict';
  const S = SM.settings;

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

  const A = 'DEMO-1-1-5';
  const B = 'DEMO-1-1-6';
  const OTHER = 'DEMO-1-2-5'; // 다른 반
  const CLASS = 'DEMO-1-1';

  // 한 기기에 두 학생(+ 다른 반 한 명)의 기록이 있는 상태
  function world() {
    const backend = fakeStorage();
    const store = SM.createStore(() => backend);
    let current = null;
    const profile = () => (current ? store.get(SM.keys.profile(current), null) : null);
    const feed = SM.createFeed({ store, profile });
    const auth = SM.createAuth({ store, session: fakeStorage(), config: { schools: [], classes: [], bannedWords: ['바보'], autoLogoutMinutes: 30 } });
    const deps = { store, feed, auth };

    function student(sid, nickname) {
      const classId = sid.replace(/-\d+$/, '');
      store.set(SM.keys.profile(sid), { sid, classId, school: 'DEMO', grade: 1, cls: +classId.split('-')[2], number: +sid.split('-')[3], nickname, createdAt: '2026-11-01' });
      store.set(SM.keys.results(sid), [{ takenAt: '2026-11-02', styles: { a: 1 } }]);
      store.set(SM.keys.plan(sid), { strategies: { 수학: ['interleave'] }, confirmed: true });
      store.set(SM.keys.planner(sid, '2026-11'), { month: { goals: [nickname + ' 목표'] }, weeks: {}, days: { '2026-11-19': { blocks: [{ id: 'b1', subject: '수학' }] } } });
      store.set(SM.keys.checkin(sid), [{ isoWeek: '2026-W46', scores: { b1: 3 } }]);
      store.set(SM.keys.chat(sid), [{ from: 'bot', type: 'text', text: '안녕 ' + nickname }]);
    }
    student(A, '하늘');
    student(B, '바람');
    student(OTHER, '구름');
    store.set(SM.keys.feed(CLASS), [
      { planKey: A + ':2026-W47', sid: A, nickname: '하늘', week: '2026-W47', goals: [], strategies: {}, updatedAt: '2026-11-18T00:00:00Z' },
      { planKey: B + ':2026-W47', sid: B, nickname: '바람', week: '2026-W47', goals: [], strategies: {}, updatedAt: '2026-11-18T01:00:00Z' }
    ]);
    store.set(SM.keys.comments(CLASS), [
      { id: 'c1', planKey: B + ':2026-W47', author: A, nickname: '하늘', text: '화이팅', reaction: null, hidden: false, createdAt: '2026-11-18T02:00:00Z' },
      { id: 'c2', planKey: A + ':2026-W47', author: B, nickname: '바람', text: '나도!', reaction: null, hidden: false, createdAt: '2026-11-18T03:00:00Z' },
      { id: 'r1', planKey: B + ':2026-W47', author: A, nickname: '하늘', text: '', reaction: 'cheer', hidden: false, createdAt: '2026-11-18T04:00:00Z' }
    ]);
    store.set(SM.keys.feed('DEMO-1-2'), [{ planKey: OTHER + ':2026-W47', sid: OTHER, nickname: '구름', week: '2026-W47' }]);
    store.set(SM.keys.session(), { sid: A, lastActive: 1 });
    current = A;
    return { store, feed, auth, deps, backend, as(sid) { current = sid; } };
  }

  // 한 학생에게 보이는 상태: 개인 키 전부 + 반 공유 키에서 그 학생 것(순서 무관)
  function stateOf(store, sid) {
    const out = {};
    store.ownKeys(sid).sort().forEach((k) => { out[k] = store.get(k, null); });
    const sort = (list) => list.map((x) => JSON.stringify(x)).sort();
    out.feed = sort(SM.feed.ownItems(store.get(SM.keys.feed(CLASS), []), sid));
    out.comments = sort(SM.feed.ownItems(store.get(SM.keys.comments(CLASS), []), sid));
    return JSON.stringify(out);
  }
  // 기기 전체 원문(그 학생 것 빼고)
  function othersRaw(backend, sid) {
    const out = [];
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i);
      if (k.split(':')[2] !== sid && k.indexOf(':' + sid) === -1) out.push(k + '=' + backend.getItem(k));
    }
    return out.sort().join('\n');
  }

  test('settings: 내보내기 → 전체 삭제 → 불러오기 하면 처음과 같다', () => {
    const w = world();
    const before = stateOf(w.store, A);
    const backup = S.buildBackup(w.deps, A);
    assert.equal(backup.sid, A);
    // 반 공유 키에는 내 것만 담긴다(친구 댓글·스냅샷은 백업 파일에 없음)
    assert.deepEqual(backup.data['feed:' + CLASS].map((x) => x.sid), [A]);
    assert.deepEqual(backup.data['comments:' + CLASS].map((x) => x.id), ['c1', 'r1']);
    assert.ok(!backup.data['feed:DEMO-1-2'], '다른 반 키 없음');

    const json = JSON.stringify(backup);
    const del = S.deleteMyData(w.deps, A);
    assert.equal(del.keys, 6);
    assert.equal(del.snapshots, 1);
    assert.equal(del.comments, 2);
    assert.deepEqual(w.store.ownKeys(A), []);
    assert.equal(w.store.get(SM.keys.session(), null), null, '지운 학생은 나가기');

    const pv = S.previewBackup(json, A);
    assert.ok(pv.ok);
    assert.equal(pv.count, Object.keys(backup.data).length);
    const r = S.restoreBackup(w.deps, pv.obj, A, false);
    assert.equal(r.overwritten, 0);
    assert.equal(stateOf(w.store, A), before);
  });

  test('settings: 전체 삭제는 다른 학생·다른 반 데이터를 건드리지 않는다', () => {
    const w = world();
    const bBefore = stateOf(w.store, B);
    const othersBefore = othersRaw(w.backend, A);
    S.deleteMyData(w.deps, A);
    assert.equal(stateOf(w.store, B), bBefore);
    // 친구가 내 계획에 단 댓글(c2)은 남는다(친구 것이므로)
    assert.deepEqual(w.store.get(SM.keys.comments(CLASS), []).map((c) => c.id), ['c2']);
    assert.deepEqual(w.store.get(SM.keys.feed(CLASS), []).map((x) => x.sid), [B]);
    // A와 무관한 원문은 한 글자도 안 바뀜(반 공유 키는 A 항목만 빠짐)
    const strip = (s) => s.split('\n').filter((l) => l.indexOf('feed:' + CLASS) === -1 && l.indexOf('comments:' + CLASS) === -1 && l.indexOf('session') === -1).join('\n');
    assert.equal(strip(othersRaw(w.backend, A)), strip(othersBefore));
    assert.ok(w.store.get(SM.keys.profile(OTHER), null), '다른 반 학생 그대로');
  });

  test('settings: 불러오기 — 없는 것만 추가 vs 덮어쓰기', () => {
    const w = world();
    const backup = S.buildBackup(w.deps, A);
    // 백업 뒤에 바뀐 것: 계획 수정, 점검 기록 삭제, 댓글 수정
    w.store.set(SM.keys.plan(A), { strategies: { 수학: ['retrieval'] }, confirmed: true });
    w.store.remove(SM.keys.checkin(A));
    w.store.set(SM.keys.comments(CLASS), w.store.get(SM.keys.comments(CLASS), []).map((c) => (c.id === 'c1' ? Object.assign({}, c, { text: '고친 댓글' }) : c)));

    const add = S.restoreBackup(w.deps, backup, A, false);
    assert.ok(add.added >= 1 && add.skipped >= 1 && add.overwritten === 0, JSON.stringify(add));
    assert.deepEqual(w.store.get(SM.keys.plan(A)).strategies.수학, ['retrieval'], '추가 모드: 지금 값 유지');
    assert.deepEqual(w.store.get(SM.keys.checkin(A)).length, 1, '추가 모드: 빠진 것은 채움');
    assert.equal(w.store.get(SM.keys.comments(CLASS)).find((c) => c.id === 'c1').text, '고친 댓글');

    const over = S.restoreBackup(w.deps, backup, A, true);
    assert.ok(over.overwritten >= 1 && over.added === 0, JSON.stringify(over));
    assert.deepEqual(w.store.get(SM.keys.plan(A)).strategies.수학, ['interleave'], '덮어쓰기: 백업 값');
    assert.equal(w.store.get(SM.keys.comments(CLASS)).find((c) => c.id === 'c1').text, '화이팅');
    // 친구 댓글은 어느 모드에서도 그대로
    assert.equal(w.store.get(SM.keys.comments(CLASS)).find((c) => c.id === 'c2').text, '나도!');
  });

  test('settings: 백업 파일 검사', () => {
    const w = world();
    const json = JSON.stringify(S.buildBackup(w.deps, A));
    assert.equal(S.previewBackup('{oops', A).ok, false);
    assert.equal(S.previewBackup('{"a":1}', A).ok, false);
    assert.equal(S.previewBackup(json, B).error, '지금 입장한 학생의 백업이 아니에요.');
    assert.ok(/버전/.test(S.previewBackup(json.replace('"version":2', '"version":9'), A).error));
    // 백업에 다른 학생 키를 억지로 넣어도 되돌릴 때 건너뛴다
    const obj = JSON.parse(json);
    obj.data[SM.keys.plan(B)] = { hacked: true };
    obj.data['comments:' + CLASS].push({ id: 'evil', planKey: B + ':2026-W47', author: B, text: '가짜' });
    S.restoreBackup(w.deps, obj, A, true);
    assert.ok(!w.store.get(SM.keys.plan(B)).hacked);
    assert.ok(!w.store.get(SM.keys.comments(CLASS)).some((c) => c.id === 'evil'));
  });

  test('settings: 닉네임 변경 — 규칙·중복 검사, 피드 닉네임도 갱신', () => {
    const w = world();
    assert.equal(S.changeNickname(w.deps, A, '하').ok, false, '2자 미만');
    assert.equal(S.changeNickname(w.deps, A, '바보야').ok, false, '금칙어');
    assert.equal(S.changeNickname(w.deps, A, ' 바람 ').error, '이미 다른 친구가 쓰는 닉네임이야.');
    assert.ok(S.changeNickname(w.deps, A, '구름').ok, '다른 반 닉네임과는 겹쳐도 됨');
    const r = S.changeNickname(w.deps, A, '새벽');
    assert.ok(r.ok);
    assert.equal(w.store.get(SM.keys.profile(A)).nickname, '새벽');
    assert.equal(w.store.get(SM.keys.feed(CLASS)).find((x) => x.sid === A).nickname, '새벽');
    assert.ok(w.store.get(SM.keys.comments(CLASS)).filter((c) => c.author === A).every((c) => c.nickname === '새벽'));
    assert.equal(w.store.get(SM.keys.comments(CLASS)).find((c) => c.id === 'c2').nickname, '바람');
  });

  test('settings: 표시용 계산(파일 이름, 사용량, 백업 경과일)', () => {
    assert.equal(S.backupFileName('하늘', '2026-11-13'), 'study-mate-하늘-2026-11-13.json');
    assert.equal(S.backupFileName('a/b c', '2026-11-13'), 'study-mate-a_b_c-2026-11-13.json');
    assert.equal(S.formatUsage(0), '0 KB / 약 5MB');
    assert.equal(S.formatUsage(1500), '2 KB / 약 5MB');
    assert.equal(S.usageWarn(4 * 1024 * 1024), false);
    assert.equal(S.usageWarn(4 * 1024 * 1024 + 1), true);
    assert.equal(S.backupAgeDays(null, '2026-11-19'), null);
    assert.equal(S.backupAgeDays('2026-10-20T09:00:00Z', '2026-11-19'), 30);
    assert.equal(S.backupAgeDays('2026-10-19', '2026-11-19'), 31);
  });

  test('store.migrate: 가짜 v0 → v1 예시(패턴)', () => {
    const backend = fakeStorage();
    // v0: meta 없음, 진단 결과의 날짜 필드가 date
    backend.setItem('sm:v1:results:' + A, JSON.stringify([{ date: '2026-09-01', styles: {} }, { takenAt: '2026-10-01', styles: {} }]));
    backend.setItem('sm:v1:profile:' + A, JSON.stringify({ sid: A, nickname: '하늘' }));
    const migrations = {
      // v0 → v1: results[].date → takenAt (이미 바뀐 항목은 그대로 = 여러 번 돌려도 안전)
      1: (api) => {
        api.keys('results:').forEach((k) => {
          api.set(k, api.get(k, []).map((r) => {
            if (!r || r.takenAt || !r.date) return r;
            const out = Object.assign({}, r, { takenAt: r.date });
            delete out.date;
            return out;
          }));
        });
      }
    };
    const store = SM.createStore(() => backend, { schema: 1, migrations });
    assert.equal(store.migrate(), 1);
    assert.deepEqual(store.get('meta'), { schema: 1 });
    assert.deepEqual(store.get('results:' + A).map((r) => r.takenAt), ['2026-09-01', '2026-10-01']);
    assert.ok(!('date' in store.get('results:' + A)[0]));
    assert.equal(store.get('profile:' + A).nickname, '하늘', '다른 키는 그대로');
    // 다시 돌려도 바뀌지 않음
    const raw = backend.getItem('sm:v1:results:' + A);
    assert.equal(store.migrate(), 1);
    assert.equal(backend.getItem('sm:v1:results:' + A), raw);
  });

  test('store.migrate: 중간 단계가 실패하면 거기서 멈추고 데이터는 그대로', () => {
    const backend = fakeStorage();
    backend.setItem('sm:v1:meta', JSON.stringify({ schema: 1 }));
    backend.setItem('sm:v1:plan:' + A, JSON.stringify({ x: 1 }));
    const store = SM.createStore(() => backend, {
      schema: 3,
      migrations: {
        2: (api) => api.set('plan:' + A, Object.assign(api.get('plan:' + A), { v2: true })),
        3: () => { throw new Error('고장'); }
      }
    });
    const quiet = console.error; console.error = () => {};
    try { assert.equal(store.migrate(), 2); } finally { console.error = quiet; }
    assert.deepEqual(store.get('meta'), { schema: 2 });
    assert.deepEqual(store.get('plan:' + A), { x: 1, v2: true });
  });

  test('store: 다른 창이 바꾼 뒤 저장하면 필드 단위로 병합(이 창의 수정이 마지막)', () => {
    const backend = fakeStorage();
    const tab1 = SM.createStore(() => backend);
    const tab2 = SM.createStore(() => backend);
    tab1.set('plan:' + A, { goal: '처음', memo: '메모', nested: { a: 1, b: 1 }, list: [1] });
    const mine = tab1.get('plan:' + A);
    // 다른 창: memo와 nested.b, list를 바꾸고 새 필드 추가
    const other = tab2.get('plan:' + A);
    tab2.set('plan:' + A, Object.assign({}, other, { memo: '다른 창 메모', nested: { a: 1, b: 2 }, list: [1, 2], extra: true }));
    // 이 창: goal과 nested.a만 고쳐서 저장
    mine.goal = '이 창 목표';
    mine.nested.a = 9;
    tab1.set('plan:' + A, mine);
    assert.deepEqual(tab1.get('plan:' + A), { goal: '이 창 목표', memo: '다른 창 메모', nested: { a: 9, b: 2 }, list: [1, 2], extra: true });
    assert.deepEqual(mine, tab1.get('plan:' + A), '화면이 쥔 객체도 병합 결과로 맞춘다');
    // 같은 필드를 둘 다 고치면 나중에 저장한 이 창이 이긴다
    tab2.set('plan:' + A, Object.assign({}, tab2.get('plan:' + A), { goal: '다른 창 목표' }));
    mine.goal = '마지막';
    tab1.set('plan:' + A, mine);
    assert.equal(tab1.get('plan:' + A).goal, '마지막');
    // forget 뒤에는 새 값을 기준으로 삼는다
    tab2.set('plan:' + A, Object.assign({}, tab2.get('plan:' + A), { memo: '또 바뀜' }));
    tab1.forget('plan:' + A);
    const fresh = tab1.get('plan:' + A);
    fresh.goal = '새로';
    tab1.set('plan:' + A, fresh);
    assert.equal(tab1.get('plan:' + A).memo, '또 바뀜');
  });

  test('router.needsRefresh: 지금 화면이 읽은 키만', () => {
    const keys = new Set(['plan:' + A, 'device']);
    assert.equal(SM.router.needsRefresh('plan:' + A, keys), true);
    assert.equal(SM.router.needsRefresh('chat:' + A, keys), false);
    assert.equal(SM.router.needsRefresh('device', keys), false);
    assert.equal(SM.router.needsRefresh(null, keys), false);
  });
})(window.SM);
