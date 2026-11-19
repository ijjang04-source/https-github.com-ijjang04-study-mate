(function (SM) {
  'use strict';

  // 실제 localStorage를 건드리지 않도록 테스트마다 가짜 저장소로 새 인스턴스를 만든다.
  function fakeStorage() {
    const map = new Map();
    return {
      map,
      get length() { return map.size; },
      key(i) { const k = Array.from(map.keys())[i]; return k === undefined ? null : k; },
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(String(k), String(v)); },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); }
    };
  }

  function newStore() {
    const backend = fakeStorage();
    return { store: SM.createStore(() => backend), backend };
  }

  function quiet(fn) {
    const warn = console.warn;
    console.warn = () => {};
    try { return fn(); } finally { console.warn = warn; }
  }

  const SID = 'SM01-2-3-15';
  const K = SM.keys;

  test('store: SM.store와 SM.keys가 있다', () => {
    assert.ok(SM.store && typeof SM.store.get === 'function');
    assert.equal(K.planner(SID, '2026-11'), 'planner:SM01-2-3-15:2026-11');
    assert.equal(K.feed('SM01-2-3'), 'feed:SM01-2-3');
  });

  test('store: get/set 왕복, 접두사 sm:v1:', () => {
    const { store, backend } = newStore();
    const value = { a: 1, list: [1, 2], text: '안녕 <b>' };
    assert.equal(store.set(K.profile(SID), value), true);
    assert.deepEqual(store.get(K.profile(SID)), value);
    assert.ok(backend.map.has('sm:v1:profile:SM01-2-3-15'));
    assert.equal(store.isPersistent, true);
  });

  test('store: 없는 키는 fallback', () => {
    const { store } = newStore();
    assert.equal(store.get('nope'), undefined);
    assert.deepEqual(store.get('nope', []), []);
  });

  test('store: 파싱 실패 시 fallback', () => {
    const { store, backend } = newStore();
    backend.setItem('sm:v1:broken', '{not json');
    assert.deepEqual(quiet(() => store.get('broken', { ok: true })), { ok: true });
  });

  test('store: update는 읽고-바꾸고-저장 후 반환', () => {
    const { store } = newStore();
    const r1 = store.update('count', (n) => n + 1, 0);
    const r2 = store.update('count', (n) => n + 1, 0);
    assert.equal(r1, 1);
    assert.equal(r2, 2);
    assert.equal(store.get('count'), 2);
  });

  test('store: remove, set(undefined)는 삭제', () => {
    const { store } = newStore();
    store.set('a', 1);
    store.remove('a');
    assert.equal(store.get('a', 'x'), 'x');
    store.set('b', 1);
    store.set('b', undefined);
    assert.equal(store.get('b', 'x'), 'x');
  });

  test('store: keys(prefix)는 sm:v1: 키만, 접두사 제외', () => {
    const { store, backend } = newStore();
    backend.setItem('other-app', '1');
    store.set(K.planner(SID, '2026-11'), {});
    store.set(K.planner(SID, '2026-12'), {});
    store.set(K.profile(SID), {});
    assert.deepEqual(store.keys('planner:').sort(), [
      'planner:SM01-2-3-15:2026-11', 'planner:SM01-2-3-15:2026-12'
    ]);
    assert.equal(store.keys().length, 3);
  });

  test('store: usageBytes는 문자열 길이 × 2', () => {
    const { store } = newStore();
    assert.equal(store.usageBytes(), 0);
    store.set('k', 'ab'); // 'sm:v1:k'(7) + '"ab"'(4) = 11자
    assert.equal(store.usageBytes(), 22);
  });

  test('store: QuotaExceededError면 false', () => {
    const backend = fakeStorage();
    const store = SM.createStore(() => backend);
    backend.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
    assert.equal(store.set('x', 1), false);
  });

  test('store: export → import 왕복(학생 개인 + 반 공유 키만)', () => {
    const a = newStore().store;
    a.set(K.profile(SID), { nick: '민트' });
    a.set(K.planner(SID, '2026-11'), { '2026-11-13': ['수학'] });
    a.set(K.feed('SM01-2-3'), [{ id: 1 }]);
    a.set(K.profile('SM01-2-3-1'), { nick: '다른 학생' }); // 다른 학생
    a.set(K.feed('SM01-2-4'), []);                       // 다른 반
    a.set(K.session(), { sid: SID });

    const dump = a.exportAll(SID);
    assert.equal(dump.version, 1);
    assert.equal(dump.sid, SID);
    assert.ok(typeof dump.exportedAt === 'string');
    assert.deepEqual(Object.keys(dump.data).sort(), [
      'feed:SM01-2-3', 'planner:SM01-2-3-15:2026-11', 'profile:SM01-2-3-15'
    ]);

    const b = newStore().store;
    const r = b.importAll(JSON.stringify(dump), { overwrite: false });
    assert.deepEqual(r, { added: 3, overwritten: 0, skipped: 0, failed: 0 });
    assert.deepEqual(b.get(K.profile(SID)), { nick: '민트' });
    assert.deepEqual(b.get(K.feed('SM01-2-3')), [{ id: 1 }]);
  });

  test('store: import overwrite=false면 기존 키 유지, true면 덮어씀', () => {
    const src = newStore().store;
    src.set(K.profile(SID), { nick: '백업' });
    src.set(K.plan(SID), { goal: 'A' });
    const dump = src.exportAll(SID);

    const dst = newStore().store;
    dst.set(K.profile(SID), { nick: '현재' });
    const r1 = dst.importAll(dump, { overwrite: false });
    assert.deepEqual(r1, { added: 1, overwritten: 0, skipped: 1, failed: 0 });
    assert.deepEqual(dst.get(K.profile(SID)), { nick: '현재' });
    assert.deepEqual(dst.get(K.plan(SID)), { goal: 'A' });

    const r2 = dst.importAll(dump, { overwrite: true });
    assert.equal(r2.overwritten, 2);
    assert.deepEqual(dst.get(K.profile(SID)), { nick: '백업' });
  });

  test('store: import는 버전·형식이 다르면 예외, 다른 학생 키는 건너뜀', () => {
    const { store } = newStore();
    assert.throws(() => store.importAll({ version: 99, sid: SID, data: {} }));
    assert.throws(() => store.importAll('{oops'));
    assert.throws(() => store.importAll({ version: 1, sid: 'bad', data: {} }));
    const r = store.importAll({ version: 1, sid: SID, data: { 'profile:SM01-9-9-9': {}, session: {} } });
    assert.equal(r.skipped, 2);
    assert.equal(store.keys().length, 0);
  });

  test('store: localStorage가 막히면 메모리 대체(isPersistent=false)', () => {
    const store = quiet(() => SM.createStore(() => { throw new Error('SecurityError'); }));
    assert.equal(store.isPersistent, false);
    assert.equal(store.set('a', { x: 1 }), true);
    assert.deepEqual(store.get('a'), { x: 1 });
    assert.deepEqual(store.keys(), ['a']);
  });

  test('store: 쓰기가 실패하는 저장소도 메모리 대체', () => {
    const blocked = fakeStorage();
    blocked.setItem = () => { throw new Error('blocked'); };
    const store = quiet(() => SM.createStore(() => blocked));
    assert.equal(store.isPersistent, false);
    assert.equal(store.set('a', 1), true);
  });

  test('store: init/migrate가 meta { schema: 1 }을 기록', () => {
    const { store } = newStore();
    assert.deepEqual(store.init(), { isPersistent: true });
    assert.deepEqual(store.get('meta'), { schema: 1 });
    assert.equal(store.migrate(), 1);
  });
})(window.SM);
