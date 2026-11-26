(function (SM) {
  'use strict';

  // 진단 결과 기록: 변화 계산, 약점 변화, 결과 id·kind(스키마 3), 삭제, 챗봇 안내

  const H = SM.resultHistory;
  const S3 = SM.schema3;
  const SID = 'SM01-2-3-15';
  const dims = {};
  SM.data.styleDims.forEach((d) => { dims[d.id] = d; });

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

  function result(id, takenAt, styles, weakness, extra) {
    return Object.assign({
      id, kind: 'basic', takenAt, subjects: (weakness || []).map((w) => w.subject),
      weakness: weakness || [], anxiety: false,
      styles: Object.assign({ fieldDep: 0, tempo: 0, perception: 0, reasoning: 0, processing: 0, input: 0, order: 0, kolbPerceive: 0, kolbProcess: 0 }, styles || {}),
      vark: { counts: { V: 0, A: 0, R: 0, K: 0 }, preferred: [] }, kolb: { perceive: 0, process: 0, type: 'balanced' }
    }, extra || {});
  }

  // ---------- 변화 계산 ----------

  test('history: 변화 방향 — 오른쪽(+)이면 오른쪽 극, 왼쪽(−)이면 왼쪽 극 이름으로', () => {
    assert.deepEqual(H.compareDim(dims.input, -10, -25), { kind: 'left', delta: -15, size: 15, text: '시각형 쪽으로 15 이동' });
    assert.deepEqual(H.compareDim(dims.input, -10, 30), { kind: 'right', delta: 40, size: 40, text: '언어형 쪽으로 40 이동' });
    assert.equal(H.compareDim(dims.tempo, 50, -50).text, '충동형 쪽으로 100 이동');
  });

  test('history: 10 미만으로 움직이면 "거의 같아", 10부터는 방향을 말함', () => {
    assert.equal(H.compareDim(dims.order, 20, 29).text, '거의 같아');
    assert.equal(H.compareDim(dims.order, 20, 11).text, '거의 같아');
    assert.equal(H.compareDim(dims.order, 0, 0).kind, 'same');
    assert.equal(H.compareDim(dims.order, 20, 30).text, '총체형 쪽으로 10 이동');
    assert.equal(H.compareDim(dims.order, 20, 10).text, '순차형 쪽으로 10 이동');
  });

  test('history: 응답이 없는 차원은 비교하지 않음, 문장에 좋다·나쁘다 평가 없음', () => {
    assert.equal(H.compareDim(dims.input, null, 20).kind, 'none');
    assert.equal(H.compareDim(dims.input, 20, undefined).kind, 'none');
    const rows = H.compareResults(result('a', '2026-11-13', { input: -10, tempo: 40 }), result('b', '2026-12-11', { input: -25, tempo: 45, order: null }));
    assert.deepEqual(rows.map((r) => r.dimId), SM.score.SPECTRUM_DIMS);
    const by = (id) => rows.find((r) => r.dimId === id);
    assert.deepEqual([by('input').text, by('tempo').text, by('order').kind], ['시각형 쪽으로 15 이동', '거의 같아', 'none']);
    rows.forEach((r) => assert.ok(!/좋아졌|나빠졌|좋은|나쁜|발전|퇴보|성장/.test(r.text), r.text));
  });

  test('history: 결과가 1개면 비교·흐름 없음, 다음 검사 날짜는 28일 뒤', () => {
    const one = [result('2026-11-13-1', '2026-11-13')];
    const info = H.historyInfo(one, '2026-11-20');
    assert.deepEqual(info, { count: 1, canCompare: false, canTrend: false, nextRetest: '2026-12-11', daysLeft: 21 });
    assert.equal(H.defaultPair(one), null);
    assert.equal(H.historyInfo(one, '2026-12-20').daysLeft < 0, true, '지나면 음수(지금 다시 해도 됨)');
    assert.deepEqual(H.historyInfo([], '2026-11-20'), { count: 0, canCompare: false, canTrend: false, nextRetest: null, daysLeft: null });
  });

  test('history: 비교 기본값은 가장 최근과 그 직전, 3개부터 흐름', () => {
    const list = [result('r1', '2026-10-01'), result('r2', '2026-11-01'), result('r3', '2026-12-01')];
    assert.deepEqual(H.defaultPair(list), { before: 'r2', after: 'r3' });
    assert.equal(H.historyInfo(list.slice(0, 2), '2026-12-01').canTrend, false);
    assert.equal(H.historyInfo(list, '2026-12-01').canTrend, true);
    list[1].styles.input = null;
    const s = H.trendSeries(list).find((x) => x.dimId === 'input');
    assert.deepEqual(s.points.map((p) => p.value), [0, null, 0], '응답 없는 검사는 null(선을 끊음)');
  });

  // ---------- 약점 변화 ----------

  test('history: 약점 변화 — 과목별로 검사마다 나란히, 그 과목을 안 본 검사 표시', () => {
    const list = [
      result('r1', '2026-11-13', null, [{ subject: '수학', codes: ['MATH_SELECT'] }, { subject: '영어', codes: [] }]),
      result('r2', '2026-12-11', null, [{ subject: '수학', codes: ['MATH_CARELESS'] }])
    ];
    const rows = H.weaknessTimeline(list);
    assert.deepEqual(rows.map((r) => r.subject), ['수학', '영어']);
    assert.equal(H.timelineText(rows[0]), '수학 — 11/13 풀이법 선택 → 12/11 실수');
    assert.equal(H.timelineText(rows[1]), '영어 — 11/13 고른 약점 없음 → 12/11 (이 과목은 검사 안 함)');
    assert.deepEqual(H.weakSubjects(list[0]), ['수학']);
    assert.equal(H.weakLine({ codes: ['MATH_SELECT', 'MATH_CARELESS'] }), '풀이법 선택·실수');
    Object.keys(SM.data.weaknessLabels).forEach((c) => assert.ok(SM.data.weaknessShort[c], '짧은 이름표 ' + c));
  });

  // ---------- 삭제 ----------

  test('history: 삭제 — 마지막 하나는 지울 수 없고, 없는 id는 그대로', () => {
    const list = [result('r1', '2026-11-13'), result('r2', '2026-12-11')];
    const r = H.removeResult(list, 'r1');
    assert.deepEqual([r.ok, r.list.map((x) => x.id)], [true, ['r2']]);
    assert.equal(list.length, 2, '원래 배열은 그대로');
    assert.deepEqual(H.removeResult(r.list, 'r2'), { list: r.list, ok: false, reason: 'last' });
    assert.equal(H.removeResult(list, 'nope').reason, 'missing');
  });

  // ---------- 결과 id·kind(스키마 3) ----------

  test('history: 새 결과 id는 날짜-번호, 지운 뒤에도 겹치지 않음', () => {
    assert.equal(S3.nextResultId([], '2026-11-13'), '2026-11-13-1');
    const list = [{ id: '2026-11-13-1' }, { id: '2026-11-13-2' }, { id: '2026-11-20-1' }];
    assert.equal(S3.nextResultId(list, '2026-11-13'), '2026-11-13-3');
    assert.equal(S3.nextResultId([list[1]], '2026-11-13'), '2026-11-13-3', '1번을 지워도 3번');
    assert.equal(S3.nextResultId(list, '2026-11-21T09:00:00Z'), '2026-11-21-1');
    assert.equal(S3.nextResultId(list, undefined), 'unknown-1');
  });

  test('history: 스키마 3 — 하나만 저장된 예전 결과는 배열 첫 항목, id·kind 붙이고 두 번 해도 같음', () => {
    const single = { takenAt: '2026-11-13', styles: { input: 10 } };
    const a = S3.resultsToV3(single);
    assert.deepEqual(a, [{ takenAt: '2026-11-13', styles: { input: 10 }, id: '2026-11-13-1', kind: 'basic' }]);
    assert.equal(S3.resultsToV3(a), a, '이미 바뀐 것은 그대로');
    const two = S3.resultsToV3([{ takenAt: '2026-11-13' }, null, { id: '2026-11-13-1', takenAt: '2026-11-13', extended: { chrono: 'evening' } }]);
    assert.deepEqual(two.map((r) => [r.id, r.kind]), [['2026-11-13-2', 'basic'], ['2026-11-13-1', 'deep']], '있던 id는 두고 겹치지 않게, 심화 붙은 것은 deep');
    assert.equal(S3.resultsToV3('이상한 값'), '이상한 값');
  });

  test('history: 스키마 3 마이그레이션 — 전략 화면의 결과 열쇠도 새 id로 바꿔 "추천이 바뀌었어"를 잘못 묻지 않음', () => {
    const b = fakeStorage();
    b.setItem('sm:v1:meta', JSON.stringify({ schema: 2 }));
    b.setItem('sm:v1:results:' + SID, JSON.stringify([{ takenAt: '2026-10-16' }, { takenAt: '2026-11-13', extended: { chrono: 'morning' } }]));
    b.setItem('sm:v1:plan:' + SID, JSON.stringify({ basedOn: '2:2026-11-13:1', announced: '2:2026-11-13:1', strategies: {} }));
    const store = SM.createStore(() => b);
    assert.equal(store.migrate(), store.SCHEMA);
    const list = store.get('results:' + SID);
    assert.deepEqual(list.map((r) => [r.id, r.kind]), [['2026-10-16-1', 'basic'], ['2026-11-13-1', 'deep']]);
    const plan = store.get('plan:' + SID);
    assert.deepEqual([plan.basedOn, plan.announced], ['2026-11-13-1:1', '2026-11-13-1:1']);
    assert.equal(S3.resultKey(list), plan.basedOn);
    // 지난 기록을 지워도 열쇠는 그대로
    assert.equal(S3.resultKey(list.slice(1)), plan.basedOn);
    assert.equal(S3.migrateV3(store), 0, '두 번째는 바꿀 것이 없음');
  });

  // ---------- 챗봇 ----------

  test('history: 챗봇 — 결과 기록·지난 결과·비교 → 결과 기록 안내, 비교표·검사는 그대로', () => {
    const C = SM.chat;
    ['결과 기록 보여줘', '지난 결과 볼래', '비교', '지난번이랑 비교해 줘', '이전 결과'].forEach((t) => assert.equal(C.matchIntent(t).intent, 'history', t));
    assert.equal(C.matchIntent('비교표 전략').intent, 'strategy');
    assert.equal(C.matchIntent('검사 다시 할래').intent, 'test');
    const steps = C.replyFor('결과 기록', null);
    assert.equal(steps[0].say.indexOf('아직 진단 결과가 없어') !== -1, true, '결과가 없으면 진단 안내');
  });
})(window.SM = window.SM || {});
