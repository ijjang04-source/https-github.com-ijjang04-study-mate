(function (SM) {
  'use strict';
  const P = SM.planner;
  const M = SM.metrics;

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

  test('day: 전략 적용 자동 제안 — 예 2개 yes, 1개 partial, 0개 no', () => {
    assert.equal(P.suggestApplied([true, true]), 'yes');
    assert.equal(P.suggestApplied([true, false]), 'partial');
    assert.equal(P.suggestApplied([null, true]), 'partial');
    assert.equal(P.suggestApplied([false, false]), 'no');
    assert.equal(P.suggestApplied([null, null]), 'no');
    assert.equal(P.suggestApplied(undefined), 'no');
  });

  test('day: 달성률 — 목표 대비 %, 100 넘어도 실제 값, 계산 불가면 null', () => {
    const b = (t, n) => ({ target: { n: t, unit: '문제' }, done: { n } });
    assert.equal(M.achievement(b(40, 32)), 80);
    assert.equal(M.achievement(b(40, 50)), 125);
    assert.equal(M.achievement(b(3, 1)), 33);
    assert.equal(M.achievement(b(40, 0)), 0);
    assert.equal(M.achievement(b(0, 10)), null);
    assert.equal(M.achievement(b(null, 10)), null);
    assert.equal(M.achievement(b(40, null)), null);
    assert.equal(M.achievement({ target: { n: 40 } }), null);
  });

  test('day: 블록은 하루 12개까지', () => {
    let blocks = [];
    for (let i = 0; i < 12; i++) {
      const r = P.addBlock(blocks);
      assert.ok(r.added, 'add ' + i);
      blocks = r.blocks;
    }
    const r = P.addBlock(blocks);
    assert.equal(r.added, false);
    assert.equal(r.blocks.length, 12);
    assert.equal(new Set(blocks.map((b) => b.id)).size, 12, 'id 중복 없음');
  });

  test('day: 미리 만들기는 한 번만, 칸이 없으면 플래그를 세우지 않음', () => {
    const entries = ['수학:interleave', '영어:retrieval'];
    const first = P.prefillDay({ blocks: [] }, entries, (s, id) => `${s}-${id}`);
    assert.equal(first.created, 2);
    assert.equal(first.day.prefilled, true);
    assert.deepEqual(first.day.blocks.map((b) => [b.subject, b.strategy, b.method, b.start, b.end]),
      [['수학', 'interleave', '수학-interleave', '', ''], ['영어', 'retrieval', '영어-retrieval', '', '']]);
    // 학생이 하나 지운 뒤 다시 들어와도 다시 만들지 않음
    const again = P.prefillDay({ blocks: first.day.blocks.slice(1), prefilled: true }, entries);
    assert.equal(again.created, 0);
    assert.equal(again.day.blocks.length, 1);
    // 배치표가 비어 있으면 플래그 없음 → 나중에 배치하면 만든다
    const empty = P.prefillDay({ blocks: [] }, []);
    assert.equal(empty.created, 0);
    assert.ok(!empty.day.prefilled);
    // 이미 11개면 1개만
    const many = { blocks: Array.from({ length: 11 }, () => P.newBlock()) };
    assert.equal(P.prefillDay(many, entries).created, 1);
  });

  test('day: 미리 만들기 1회 — 저장소 왕복', () => {
    const store = SM.createStore(() => fakeStorage());
    const planner = SM.createPlanner({ store, sid: 'SM01-2-3-15' });
    const r = P.prefillDay(planner.getDayData('2026-11-30'), ['수학:interleave']);
    planner.saveDayData('2026-11-30', r.day);
    const back = planner.getDayData('2026-11-30');
    assert.equal(back.prefilled, true);
    assert.equal(back.blocks.length, 1);
    // saveDay로 블록만 바꿔도 플래그 유지
    planner.saveDay('2026-11-30', []);
    assert.equal(planner.getDayData('2026-11-30').prefilled, true);
    assert.equal(P.prefillDay(planner.getDayData('2026-11-30'), ['수학:interleave']).created, 0);
  });

  test('day: 위아래 이동, 범위 밖은 그대로', () => {
    const list = ['a', 'b', 'c'].map((id) => ({ id }));
    assert.deepEqual(P.moveBlock(list, 0, 1).map((x) => x.id), ['b', 'a', 'c']);
    assert.deepEqual(P.moveBlock(list, 2, -1).map((x) => x.id), ['a', 'c', 'b']);
    assert.deepEqual(P.moveBlock(list, 0, -1).map((x) => x.id), ['a', 'b', 'c']);
    assert.deepEqual(P.moveBlock(list, 2, 1).map((x) => x.id), ['a', 'b', 'c']);
    assert.deepEqual(list.map((x) => x.id), ['a', 'b', 'c'], '원본 유지');
  });

  test('day: 어제 블록 복사는 계획 부분만, 새 id', () => {
    const y = [{
      id: 'x1', start: '19:00', end: '20:00', subject: '수학', topic: '3절', target: { n: 40, unit: '문제' },
      strategy: 'interleave', method: 'm', place: 'home', placeText: '', with: 'alone', modes: ['solve'], done: { n: 30 }
    }];
    const c = P.copyPlan(y);
    assert.equal(c.length, 1);
    assert.ok(c[0].id !== 'x1');
    assert.equal(c[0].done, undefined);
    assert.deepEqual([c[0].start, c[0].subject, c[0].target.n, c[0].strategy, c[0].place, c[0].with], ['19:00', '수학', 40, 'interleave', 'home', 'alone']);
    c[0].modes.push('read');
    assert.deepEqual(y[0].modes, ['solve']);
  });

  test('day: 기록 기본값은 계획 시간·장소', () => {
    const d = P.newDone({ start: '19:00', end: '20:10', place: 'library', with: 'friend' });
    assert.deepEqual([d.start, d.end, d.place, d.with, d.applied], ['19:00', '20:10', 'library', 'friend', null]);
    assert.deepEqual(d.checks, [null, null]);
  });

  test('day: 환경 안내 — 추천과 다를 때만', () => {
    const quiet = { place: '조용한 자습실이나 집 책상', with: '혼자' };
    assert.deepEqual(P.envHints(quiet, { place: 'home', with: 'alone' }), []);
    assert.deepEqual(P.envHints(quiet, { place: 'cafe', with: 'friend' }),
      ['너는 혼자 조용한 곳에서 집중이 잘 되는 편이야.', '너는 조용한 자습실이나 집 책상에서 집중이 잘 되는 편이야.']);
    assert.deepEqual(P.envHints(quiet, { place: null, with: null }), []);
    assert.deepEqual(P.envHints({ place: null, with: null }, { place: 'cafe', with: 'friend' }), []);
    const social = { place: '교실이나 스터디 공간', with: '함께' };
    assert.equal(P.envHints(social, { place: 'home', with: 'alone' }).length, 2);
    assert.deepEqual(P.envHints(null, { place: 'cafe' }), []);
  });

  test('day: 접힌 블록 요약 문구', () => {
    assert.equal(P.doneSummary({ strategy: 'interleave', target: { n: 40 }, done: { n: 32, applied: 'partial' } }), '완료 · 80% · 전략 부분 적용');
    assert.equal(P.doneSummary({ strategy: null, target: { n: null }, done: { start: '19:00', end: '20:15' } }), '완료 · 1시간 15분');
    assert.equal(P.doneSummary({}), '');
  });
})(window.SM);
