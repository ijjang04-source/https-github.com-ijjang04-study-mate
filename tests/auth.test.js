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

  const SHA_5678 = 'f8638b979b2f4f793ddb6dbd197e0ee25a7a6ea32b0ae22f5e3c5d119d839e75';

  // 시계·저장소·설정을 주입한 독립 인스턴스
  function setup() {
    const clock = { t: Date.UTC(2026, 10, 19, 9, 0) };
    const store = SM.createStore(() => fakeStorage());
    const config = {
      schools: [{ id: 'DEMO', name: '체험' }, { id: 'SM01', name: '숙명' }],
      classes: [
        { school: 'DEMO', grade: 1, cls: 1, codeHash: SM.auth.fallbackHash('1234') },
        { school: 'SM01', grade: 2, cls: 3, codeHash: SHA_5678 }
      ],
      bannedWords: ['바보'],
      autoLogoutMinutes: 30
    };
    const auth = SM.createAuth({ store, config, now: () => clock.t, session: fakeStorage() });
    return { auth, store, clock };
  }

  const base = { school: 'DEMO', grade: 1, cls: '1', code: '1234', number: '15', nickname: '민트' };
  const withVal = (patch) => Object.assign({}, base, patch);

  // ---------- 해시 ----------

  test('auth: FNV-1a 64 표준 벡터', () => {
    assert.equal(SM.auth.fnv1a64(''), 'cbf29ce484222325');
    assert.equal(SM.auth.fnv1a64('a'), 'af63dc4c8601ec8c');
    assert.equal(SM.auth.fnv1a64('foobar'), '85944171f73967e8');
  });

  test('auth: 대체 해시는 결정적이고 fb: 접두사', () => {
    const h = SM.auth.fallbackHash('1234');
    assert.equal(h, SM.auth.fallbackHash('1234'));
    assert.equal(h, 'fb:8a7bf4ee8c9762990847fd1905d3c8f9');
    assert.ok(h !== SM.auth.fallbackHash('1235'));
    assert.equal(h.length, 35);
  });

  test('auth: SHA-256 hex, hash()는 결정적', async () => {
    assert.equal(await SM.auth.sha256Hex('1234'),
      '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
    assert.equal(await SM.auth.hash('5678'), await SM.auth.hash('5678'));
  });

  test('auth: verifyCode는 fb:/SHA-256/배열 모두 비교', async () => {
    assert.equal((await SM.auth.verifyCode('1234', SM.auth.fallbackHash('1234'))).ok, true);
    assert.equal((await SM.auth.verifyCode('5678', SHA_5678)).ok, true);
    assert.equal((await SM.auth.verifyCode('5678', ['fb:00', SHA_5678])).ok, true);
    assert.equal((await SM.auth.verifyCode('0000', SHA_5678)).ok, false);
  });

  test('auth: config의 DEMO 1-1 코드 1234가 맞다', async () => {
    const entry = SM.config.classes.find((c) => c.school === 'DEMO' && c.grade === 1 && c.cls === 1);
    assert.equal((await SM.auth.verifyCode('1234', entry.codeHash)).ok, true);
  });

  // ---------- 검증 실패 ----------

  test('auth: 각 입력 검증 실패', async () => {
    const { auth } = setup();
    const cases = [
      [{ school: 'NOPE' }, 'school'],
      [{ grade: 0 }, 'grade'],
      [{ grade: 4 }, 'grade'],
      [{ grade: null }, 'grade'],
      [{ cls: '0' }, 'cls'],
      [{ cls: '21' }, 'cls'],
      [{ cls: '2' }, 'cls'],          // 등록 안 된 반
      [{ cls: '1.5' }, 'cls'],
      [{ code: '12' }, 'code'],       // 형식
      [{ code: 'abcd' }, 'code'],
      [{ number: '0' }, 'number'],
      [{ number: '41' }, 'number'],
      [{ number: '' }, 'number'],
      [{ nickname: '민' }, 'nickname'],
      [{ nickname: '   민   ' }, 'nickname'],
      [{ nickname: '열한글자닉네임입니다요' }, 'nickname'],
      [{ nickname: '나는 바 보' }, 'nickname'] // 금칙어(공백 무시)
    ];
    for (const [patch, field] of cases) {
      const r = await auth.login(withVal(patch));
      assert.equal(r.ok, false, JSON.stringify(patch));
      assert.equal(r.field, field, JSON.stringify(patch));
      assert.ok(typeof r.error === 'string' && r.error.length > 0);
    }
    assert.equal(auth.current(), null);
  });

  test('auth: 틀린 코드는 남은 기회를 알려 줌', async () => {
    const { auth } = setup();
    const r = await auth.login(withVal({ code: '9999' }));
    assert.equal(r.field, 'code');
    assert.ok(r.error.includes('4번'));
  });

  // ---------- 성공·세션 ----------

  test('auth: 성공하면 sid·profile·세션 생성, 닉네임 앞뒤 공백 제거', async () => {
    const { auth, store } = setup();
    const r = await auth.login(withVal({ nickname: '  민트  ' }));
    assert.equal(r.ok, true);
    assert.equal(r.sid, 'DEMO-1-1-15');
    assert.equal(r.classId, 'DEMO-1-1');
    assert.equal(r.isNew, true);
    const p = store.get('profile:DEMO-1-1-15');
    assert.equal(p.nickname, '민트');
    assert.equal(p.number, 15);
    assert.equal(p.greeted, false);
    assert.equal(store.get('session').sid, 'DEMO-1-1-15');
    assert.equal(auth.current().sid, 'DEMO-1-1-15');
  });

  test('auth: SHA-256으로 등록된 반도 입장', async () => {
    const { auth } = setup();
    const r = await auth.login({ school: 'SM01', grade: 2, cls: 3, code: '5678', number: 1, nickname: '하늘' });
    assert.equal(r.ok, true);
    assert.equal(r.sid, 'SM01-2-3-1');
  });

  test('auth: 같은 번호·같은 닉네임 재입장은 확인 없이 성공', async () => {
    const { auth } = setup();
    await auth.login(base);
    auth.logout();
    const r = await auth.login(base);
    assert.equal(r.ok, true);
    assert.equal(r.isNew, false);
  });

  test('auth: 같은 반 다른 번호가 쓰는 닉네임은 거절(대소문자 무시)', async () => {
    const { auth } = setup();
    await auth.login(withVal({ nickname: 'Mint' }));
    auth.logout();
    const r = await auth.login(withVal({ number: '16', nickname: 'mint' }));
    assert.equal(r.ok, false);
    assert.equal(r.field, 'nickname');
    assert.equal(r.error, '이미 다른 친구가 쓰는 닉네임이야.');
  });

  test('auth: 다른 반이면 같은 닉네임 가능', async () => {
    const { auth } = setup();
    await auth.login(base);
    auth.logout();
    const r = await auth.login({ school: 'SM01', grade: 2, cls: 3, code: '5678', number: 15, nickname: '민트' });
    assert.equal(r.ok, true);
  });

  test('auth: 같은 번호에 다른 닉네임 → 확인 요청 → 확인하면 기존 프로필로 입장', async () => {
    const { auth, store } = setup();
    await auth.login(base);
    auth.logout();
    const r1 = await auth.login(withVal({ nickname: '초코' }));
    assert.equal(r1.ok, false);
    assert.equal(r1.needConfirm, true);
    assert.equal(r1.existingNickname, '민트');
    assert.equal(auth.current(), null);

    const r2 = await auth.login(withVal({ nickname: '초코' }), { confirmed: true });
    assert.equal(r2.ok, true);
    assert.equal(r2.isNew, false);
    assert.equal(store.get('profile:DEMO-1-1-15').nickname, '민트');
  });

  // ---------- 잠금 ----------

  test('auth: 5회 연속 실패 → 60초 잠금 → 시간이 지나면 풀림', async () => {
    const { auth, clock } = setup();
    for (let i = 0; i < 4; i++) {
      const r = await auth.login(withVal({ code: '0000' }));
      assert.equal(!!r.locked, false);
    }
    const r5 = await auth.login(withVal({ code: '0000' }));
    assert.equal(r5.locked, true);
    assert.equal(auth.lockStatus(), 60);

    const during = await auth.login(base); // 맞는 코드여도 잠금 중
    assert.equal(during.ok, false);
    assert.equal(during.locked, true);

    clock.t += 30 * 1000;
    assert.equal(auth.lockStatus(), 30);
    clock.t += 30 * 1000;
    assert.equal(auth.lockStatus(), 0);
    assert.equal((await auth.login(base)).ok, true);
  });

  test('auth: 성공하면 실패 횟수 초기화(연속 실패만 셈)', async () => {
    const { auth } = setup();
    for (let i = 0; i < 4; i++) await auth.login(withVal({ code: '0000' }));
    assert.equal((await auth.login(base)).ok, true);
    auth.logout();
    for (let i = 0; i < 4; i++) await auth.login(withVal({ code: '0000' }));
    assert.equal(auth.lockStatus(), 0);
  });

  test('auth: 형식 오류는 실패 횟수에 넣지 않음', async () => {
    const { auth } = setup();
    for (let i = 0; i < 6; i++) await auth.login(withVal({ nickname: '민' }));
    assert.equal(auth.lockStatus(), 0);
  });

  // ---------- 자동 로그아웃 ----------

  test('auth: 30분 넘게 활동이 없으면 자동 로그아웃', async () => {
    const { auth, store, clock } = setup();
    await auth.login(base);
    clock.t += 29 * 60 * 1000;
    assert.ok(auth.current());
    clock.t += 2 * 60 * 1000;
    assert.equal(auth.current(), null);
    assert.equal(store.get('session', null), null);
    assert.ok(store.get('profile:DEMO-1-1-15')); // 프로필은 남는다
  });

  test('auth: touch로 활동하면 세션 유지, 만료 뒤 touch는 false', async () => {
    const { auth, clock } = setup();
    await auth.login(base);
    clock.t += 20 * 60 * 1000;
    assert.equal(auth.touch(), true);
    clock.t += 20 * 60 * 1000;
    assert.ok(auth.current());
    clock.t += 31 * 60 * 1000;
    assert.equal(auth.touch(), false);
    assert.equal(auth.current(), null);
  });

  test('auth: logout, restore', async () => {
    const { auth } = setup();
    await auth.login(base);
    assert.equal(auth.restore().sid, 'DEMO-1-1-15');
    auth.logout();
    assert.equal(auth.current(), null);
    assert.equal(auth.restore(), null);
  });

  // ---------- 명단 ----------

  test('auth: roster는 그 반 학생만 번호순', async () => {
    const { auth, store } = setup();
    await auth.login(withVal({ number: '20', nickname: '초코' })); auth.logout();
    await auth.login(withVal({ number: '3', nickname: '민트' })); auth.logout();
    store.set('profile:DEMO-1-10-3', { sid: 'DEMO-1-10-3', classId: 'DEMO-1-10', number: 3, nickname: '딴반' });
    const list = auth.roster('DEMO-1-1');
    assert.deepEqual(list.map((p) => p.number), [3, 20]);
    assert.deepEqual(list.map((p) => p.nickname), ['민트', '초코']);
  });
})(window.SM);
