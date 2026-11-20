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
  const CLASS = 'DEMO-1-1';

  /** 기기 하나: 자기 저장소 + 같은 가짜 서버에 붙은 클라이언트 */
  function device(server, opts) {
    const o = opts || {};
    const store = SM.createStore(() => fakeStorage());
    let current = null;
    const clock = { t: Date.parse('2026-11-20T10:00:00Z') };
    const now = () => (clock.t += 1000);
    const client = server ? server.client({ key: o.key }) : null;
    const box = { remote: o.remoteOff ? null : client };
    const errors = [];
    const notices = [];
    const planner = SM.createPlanner({ store, sid: () => (current ? current.sid : null) });
    const P = Object.assign({}, SM.planner, planner);
    const metrics = { week: (w) => SM.metrics.week(w, (iso) => planner.getDay(iso)) };
    const feed = SM.createFeed({
      store, profile: () => current, planner: P, metrics, now, bannedWords: () => [],
      remote: () => box.remote,
      onSendError: (m) => errors.push(m),
      notify: (c, sid) => notices.push({ sid, author: c.author })
    });
    const d = {
      store, feed, planner: P, client, box, errors, notices, clock,
      as(sid, nickname) { current = { sid, classId: sid.replace(/-\d+$/, ''), nickname }; return d; },
      publish(sid, nick) {
        d.as(sid, nick);
        P.saveWeek(W, { goals: [{ subject: '수학', text: '이차함수 40개' }], strategies: { 수학: ['interleave'] }, grid: {}, intentions: [], obstacle: '', public: true, publicRate: false });
        return feed.syncWeek(W);
      },
      outbox: () => store.get('remote:outbox', [])
    };
    return d;
  }

  const planOf = (sid) => `${sid}:${W}`;

  // ---------- 원격이 꺼져 있으면 지금과 같다 ----------

  test('remote: 원격 설정이 없으면 보낼 목록을 만들지 않고 sync는 enabled:false', async () => {
    const a = device(null);
    a.publish('DEMO-1-1-5', '하늘');
    a.as('DEMO-1-1-6', '바다');
    assert.equal(a.feed.addComment(planOf('DEMO-1-1-5'), '좋다').ok, true);
    assert.equal(a.store.get('remote:outbox', null), null);
    assert.equal(a.feed.pendingCount(), 0);
    assert.deepEqual(await a.feed.sync(), { enabled: false });
  });

  // ---------- 두 기기 ----------

  test('remote: 기기 A의 공개 계획·댓글·반응이 기기 B에 보인다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    const b = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    a.as('DEMO-1-1-6', '바다');
    a.feed.addComment(planOf('DEMO-1-1-5'), '나도 해볼래');
    a.feed.react(planOf('DEMO-1-1-5'), 'cheer');
    assert.equal(a.feed.pendingCount(), 3);
    const r = await a.feed.sync();
    assert.equal(r.sent, 3);
    assert.equal(a.feed.pendingCount(), 0);

    b.as('DEMO-1-1-9', '별');
    assert.equal(b.feed.list().length, 0);
    const rb = await b.feed.sync();
    assert.equal(rb.received, 3);
    assert.deepEqual(b.feed.list().map((x) => x.nickname), ['하늘']);
    assert.deepEqual(b.feed.comments(planOf('DEMO-1-1-5')).map((c) => c.text), ['나도 해볼래']);
    assert.equal(b.feed.counts(planOf('DEMO-1-1-5')).reactions.cheer, 1);
  });

  test('remote: 받아 온 변경은 store.emit(source: remote)으로 알린다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    const b = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    await a.feed.sync();
    const heard = [];
    b.store.onChange((key, info) => heard.push([key, info && info.source]));
    b.as('DEMO-1-1-9', '별');
    await b.feed.sync();
    assert.deepEqual(heard, [[SM.keys.feed(CLASS), 'remote']]);
  });

  // ---------- 오프라인 대기열 ----------

  test('remote: 오프라인에서 댓글 3개 → 대기 3개 → 온라인이 되면 순서대로 보낸다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    await a.feed.sync();
    a.client.setOffline(true);
    a.as('DEMO-1-1-6', '바다');
    ['하나', '둘', '셋'].forEach((t) => a.feed.addComment(planOf('DEMO-1-1-5'), t));
    assert.equal(a.feed.pendingCount(), 3);
    const off = await a.feed.sync();
    assert.equal(off.offline, true);
    assert.equal(off.pending, 3);
    // 오프라인에서도 내 화면에는 바로 보이고 '보내는 중' 표시
    const mine = a.feed.comments(planOf('DEMO-1-1-5'));
    assert.deepEqual(mine.map((c) => c.text), ['하나', '둘', '셋']);
    assert.ok(mine.every((c) => c.pending));

    a.client.setOffline(false);
    const on = await a.feed.sync({ force: true });
    assert.equal(on.sent, 3);
    assert.equal(on.pending, 0);
    const puts = a.client.calls.filter((c) => c.op === 'put' && c.path.indexOf('/comments/') !== -1).map((c) => c.path);
    assert.equal(puts.length, 4, '오프라인 시도 1번 + 다시 보낸 3번');
    const b = device(server).as('DEMO-1-1-9', '별');
    await b.feed.sync();
    assert.deepEqual(b.feed.comments(planOf('DEMO-1-1-5')).map((c) => c.text), ['하나', '둘', '셋']);
    assert.ok(b.feed.comments(planOf('DEMO-1-1-5')).every((c) => !c.pending));
  });

  test('remote: 연결 실패는 2·4·8초… 최대 5분 간격으로 다시 보낸다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    a.client.setOffline(true);
    const gaps = [];
    for (let i = 0; i < 10; i++) {
      a.clock.t += 10 * 60 * 1000; // 대기 시간이 지난 뒤
      const before = a.clock.t;
      await a.feed.flush();
      gaps.push(a.outbox()[0].nextAt - before);
    }
    // 가짜 시계는 now()를 부를 때마다 1초 간다(flush 안에서 대기 시간 계산 전 2번) → 2초를 빼고 비교
    assert.deepEqual(gaps.map((g) => Math.round(g / 1000) - 2), [2, 4, 8, 16, 32, 64, 128, 256, 300, 300]);
    // 대기 시간 전에는 보내지 않는다
    const n = a.client.calls.length;
    await a.feed.flush();
    assert.equal(a.client.calls.length, n);
  });

  test('remote: 같은 항목의 연속 작업은 하나로 합친다(반응 켜기·끄기·켜기 → put 1개)', () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    a.as('DEMO-1-1-6', '바다');
    a.feed.react(planOf('DEMO-1-1-5'), 'try');
    a.feed.react(planOf('DEMO-1-1-5'), 'try');
    a.feed.react(planOf('DEMO-1-1-5'), 'try');
    const ops = a.outbox().filter((o) => o.kind === 'comments');
    assert.equal(ops.length, 1);
    assert.equal(ops[0].op, 'put');
    assert.equal(ops[0].id, `r:${planOf('DEMO-1-1-5')}:DEMO-1-1-6:try`);
  });

  test('remote: 두 기기에서 같은 반응을 눌러도 서버에는 하나', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    const b = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    await a.feed.sync();
    b.as('DEMO-1-1-6', '바다');
    await b.feed.sync();
    a.as('DEMO-1-1-6', '바다');
    a.feed.react(planOf('DEMO-1-1-5'), 'cheer');
    b.feed.react(planOf('DEMO-1-1-5'), 'cheer');
    await a.feed.sync();
    await b.feed.sync();
    await a.feed.sync();
    assert.equal(a.feed.counts(planOf('DEMO-1-1-5')).reactions.cheer, 1);
    assert.equal(b.feed.counts(planOf('DEMO-1-1-5')).reactions.cheer, 1);
  });

  // ---------- 거부 ----------

  test('remote: 서버가 거부(4xx)하면 사본을 되돌리고 알린다. 다시 보내지 않는다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    await a.feed.sync();
    a.as('DEMO-1-1-6', '바다');
    a.feed.addComment(planOf('DEMO-1-1-5'), '원래 글');
    await a.feed.sync();
    const id = a.feed.comments(planOf('DEMO-1-1-5'))[0].id;
    a.feed.editComment(id, '고친 글');
    a.feed.addComment(planOf('DEMO-1-1-5'), '새 글');
    a.client.failNext(403, 2);
    const r = await a.feed.sync();
    assert.equal(r.rejected, 2);
    assert.equal(a.feed.pendingCount(), 0);
    assert.deepEqual(a.feed.comments(planOf('DEMO-1-1-5')).map((c) => c.text), ['원래 글'], '고친 글은 되돌리고 새 글은 지움');
    assert.equal(a.errors.length, 2);
    assert.ok(a.errors[0].indexOf('보내지 못했어') === 0);
  });

  test('remote: 반 키가 틀리면 서버가 거부한다(가짜 서버 규칙)', async () => {
    const server = SM.remote.fakeServer({ keys: { [CLASS]: 'right' } });
    const good = device(server, { key: () => 'right' });
    const bad = device(server, { key: () => 'wrong' });
    good.publish('DEMO-1-1-5', '하늘');
    assert.equal((await good.feed.sync()).sent, 1);
    bad.publish('DEMO-1-1-6', '바다');
    const r = await bad.feed.sync();
    assert.equal(r.rejected, 1);
    assert.equal(bad.feed.list().length, 0, '거부된 공개 계획은 사본에서도 빠짐');
  });

  // ---------- 삭제·숨김·다른 반 ----------

  test('remote: 기기 A의 비공개 전환·댓글 삭제·숨김이 기기 B에 반영된다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    const b = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    a.publish('DEMO-1-1-7', '구름');
    a.as('DEMO-1-1-6', '바다');
    a.feed.addComment(planOf('DEMO-1-1-5'), '지울 댓글');
    a.feed.addComment(planOf('DEMO-1-1-5'), '숨길 댓글');
    await a.feed.sync();
    b.as('DEMO-1-1-9', '별');
    await b.feed.sync();
    assert.equal(b.feed.list().length, 2);
    assert.equal(b.feed.comments(planOf('DEMO-1-1-5')).length, 2);

    const cs = a.feed.comments(planOf('DEMO-1-1-5'));
    a.feed.deleteComment(cs[0].id);
    a.as('DEMO-1-1-5', '하늘');
    a.feed.setHidden(cs[1].id, true);
    a.as('DEMO-1-1-7', '구름');
    a.planner.saveWeek(W, Object.assign(a.planner.getWeek(W), { public: false }));
    a.feed.syncWeek(W);
    await a.feed.sync();

    await b.feed.sync();
    assert.deepEqual(b.feed.list().map((x) => x.nickname), ['하늘']);
    assert.equal(b.feed.comments(planOf('DEMO-1-1-5')).length, 0, '지운 댓글은 없고 숨긴 댓글은 남에게 안 보임');
    assert.equal(b.feed.counts(planOf('DEMO-1-1-5')).comments, 0);
  });

  test('remote: 서버에 다른 반 항목이 섞여 있어도 받지 않는다', async () => {
    const server = SM.remote.fakeServer();
    const b = device(server).as('DEMO-1-1-9', '별');
    server.rows.set(`classes/${CLASS}/feed/DEMO-1-2-7:${W}`, {
      data: { planKey: `DEMO-1-2-7:${W}`, sid: 'DEMO-1-2-7', nickname: '침입', week: W, goals: [], strategies: {}, updatedAt: '2099' },
      deleted: false, updatedAt: 'T9999999999'
    });
    await b.feed.sync();
    assert.equal(b.feed.list().length, 0);
    assert.deepEqual(b.store.get(SM.keys.feed(CLASS), []), []);
  });

  test('remote: 아직 보내지 않은 내 변경이 있는 항목은 받아 온 값으로 덮지 않는다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    const a2 = device(server); // 같은 학생의 다른 기기
    a.publish('DEMO-1-1-5', '하늘');
    a.as('DEMO-1-1-6', '바다');
    a.feed.addComment(planOf('DEMO-1-1-5'), '처음');
    await a.feed.sync();
    a2.as('DEMO-1-1-6', '바다');
    await a2.feed.sync();
    const id = a2.feed.comments(planOf('DEMO-1-1-5'))[0].id;
    a2.feed.editComment(id, '다른 기기에서 고침');
    await a2.feed.sync();

    a.client.setOffline(true);
    a.feed.editComment(id, '이 기기에서 고침(아직 못 보냄)');
    a.client.setOffline(false);
    await a.feed.pull();
    assert.equal(a.feed.comments(planOf('DEMO-1-1-5'))[0].text, '이 기기에서 고침(아직 못 보냄)');
  });

  test('remote: 다른 기기에서 내 계획에 달린 새 댓글은 알림(첫 동기화 때 옛 댓글은 알리지 않음)', async () => {
    const server = SM.remote.fakeServer();
    const mine = device(server);
    const friend = device(server);
    mine.publish('DEMO-1-1-5', '하늘');
    await mine.feed.sync();
    friend.as('DEMO-1-1-6', '바다');
    await friend.feed.sync();
    friend.feed.addComment(planOf('DEMO-1-1-5'), '옛 댓글');
    await friend.feed.sync();

    const fresh = device(server).as('DEMO-1-1-5', '하늘');
    await fresh.feed.sync();
    assert.equal(fresh.notices.length, 0, '처음 받을 때는 알리지 않음');
    friend.feed.addComment(planOf('DEMO-1-1-5'), '새 댓글');
    friend.feed.react(planOf('DEMO-1-1-5'), 'cheer');
    await friend.feed.sync();
    await fresh.feed.sync();
    assert.deepEqual(fresh.notices, [{ sid: 'DEMO-1-1-5', author: 'DEMO-1-1-6' }], '반응은 알리지 않음');
  });

  // ---------- 마이그레이션 ----------

  test('remote: 마이그레이션은 내 것만 올리고, 두 번 해도 중복이 없다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server, { remoteOff: true }); // 원격을 켜기 전에 쓰던 기기
    a.publish('DEMO-1-1-6', '친구');
    a.publish('DEMO-1-1-5', '하늘');
    a.as('DEMO-1-1-6', '친구');
    a.feed.addComment(planOf('DEMO-1-1-5'), '친구 댓글');
    a.as('DEMO-1-1-5', '하늘');
    a.feed.addComment(planOf('DEMO-1-1-6'), '내 댓글');
    a.feed.react(planOf('DEMO-1-1-6'), 'cheer');
    assert.equal(a.feed.pendingCount(), 0, '원격을 켜기 전 쓰기는 대기열에 없음');

    a.box.remote = a.client; // 반 서버 켬
    assert.equal(a.feed.migratedAt(), null);
    const r1 = await a.feed.migrateToRemote();
    assert.deepEqual([r1.ok, r1.total, r1.created, r1.existing], [true, 3, 3, 0]);
    assert.equal(server.count(), 3);
    const r2 = await a.feed.migrateToRemote();
    assert.deepEqual([r2.created, r2.existing], [0, 3]);
    assert.equal(server.count(), 3);
    assert.ok(a.feed.migratedAt());
    assert.ok(Array.from(server.rows.values()).every((row) => (row.data.sid || row.data.author) === 'DEMO-1-1-5'));
  });

  test('remote: 마이그레이션 중 연결이 끊기면 다시 하라고 알린다', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    a.box.remote = null;
    a.publish('DEMO-1-1-5', '하늘');
    a.box.remote = a.client;
    a.client.setOffline(true);
    const r = await a.feed.migrateToRemote();
    assert.equal(r.ok, false);
    assert.equal(r.offline, true);
    assert.equal(a.feed.migratedAt(), null);
  });

  // ---------- 전체 삭제 ----------

  test('remote: 내 데이터 전체 삭제는 서버의 내 항목에도 삭제를 보낸다(친구 것은 그대로)', async () => {
    const server = SM.remote.fakeServer();
    const a = device(server);
    a.publish('DEMO-1-1-5', '하늘');
    a.publish('DEMO-1-1-6', '친구');
    a.as('DEMO-1-1-5', '하늘');
    a.feed.addComment(planOf('DEMO-1-1-6'), '내 댓글');
    await a.feed.sync();
    a.feed.removeAllOf('DEMO-1-1-5');
    await a.feed.flush();
    const alive = Array.from(server.rows.entries()).filter(([, r]) => !r.deleted).map(([k]) => k);
    assert.deepEqual(alive, [`classes/${CLASS}/feed/${planOf('DEMO-1-1-6')}`]);
  });

  // ---------- Apps Script 어댑터 ----------

  function fakeFetch(reply) {
    const calls = [];
    const fn = (url, opts) => {
      calls.push({ url, opts, body: JSON.parse(opts.body) });
      return reply(calls[calls.length - 1]);
    };
    fn.calls = calls;
    return fn;
  }
  const okJson = (obj) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });

  test('remote: Apps Script 어댑터는 text/plain POST로 op·path·반 키를 보낸다', async () => {
    const f = fakeFetch(() => okJson({ ok: true, items: [{ id: 'x' }], serverTime: 'S1' }));
    const api = SM.remote.appsScript({ url: 'https://example.test/exec', keyOf: (c) => 'key-' + c, fetch: f });
    const r = await api.list(`classes/${CLASS}/comments`, { since: 'S0' });
    assert.deepEqual(r, { items: [{ id: 'x' }], serverTime: 'S1' });
    const c = f.calls[0];
    assert.equal(c.url, 'https://example.test/exec');
    assert.equal(c.opts.method, 'POST');
    assert.equal(c.opts.headers['Content-Type'], 'text/plain;charset=utf-8', '사전 요청(preflight)이 없는 형식');
    assert.deepEqual(c.body, { op: 'list', path: `classes/${CLASS}/comments`, key: 'key-' + CLASS, since: 'S0' });
  });

  test('remote: Apps Script 어댑터 오류 구분 — 거부(4xx)·서버(5xx)·연결 안 됨(0)', async () => {
    const errOf = async (reply) => {
      const api = SM.remote.appsScript({ url: 'u', keyOf: () => 'k', fetch: fakeFetch(reply) });
      try { await api.put(`classes/${CLASS}/feed/a`, {}); } catch (e) { return [e.status, e.permanent, e.offline]; }
      return 'no error';
    };
    assert.deepEqual(await errOf(() => okJson({ ok: false, status: 403, error: '반 키가 맞지 않아' })), [403, true, false]);
    assert.deepEqual(await errOf(() => Promise.resolve({ ok: false, status: 503 })), [503, false, false]);
    assert.deepEqual(await errOf(() => Promise.reject(new TypeError('Failed to fetch'))), [0, false, true]);
    assert.deepEqual(await errOf(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('html')) })), [502, false, false]);
    // 잘못된 경로는 보내지도 않는다
    const f = fakeFetch(() => okJson({ ok: true }));
    const api = SM.remote.appsScript({ url: 'u', fetch: f });
    let status = null;
    try { await api.get('classes/../x'); } catch (e) { status = e.status; }
    assert.equal(status, 400);
    assert.equal(f.calls.length, 0);
  });

  test('remote: 반 키는 반 ID와 코드로 만들고, config의 공개 해시와 다르다', async () => {
    const k1 = await SM.remote.classKey(CLASS, '1234');
    const k2 = await SM.remote.classKey('DEMO-1-2', '1234');
    assert.equal(k1, await SM.remote.classKey(CLASS, '1234'));
    assert.ok(k1 !== k2, '반이 다르면 키도 다름');
    assert.ok(k1 !== await SM.auth.sha256Hex('1234'), '공개된 코드 해시로는 반 키를 알 수 없음');
    assert.equal(k1.length, 64);
  });

  test('remote: config.remote가 없으면 어댑터를 만들지 않는다', () => {
    const saved = SM.config.remote;
    SM.config.remote = null;
    assert.equal(SM.remote.enabled(), false);
    assert.equal(SM.remote.adapter(), null);
    SM.config.remote = { type: 'apps-script', url: 'https://example.test/exec' };
    assert.equal(SM.remote.enabled(), true);
    assert.ok(SM.remote.adapter());
    SM.config.remote = saved;
  });
})(window.SM = window.SM || {});
