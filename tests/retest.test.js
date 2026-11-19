(function (SM) {
  'use strict';
  const R = SM.recommend;

  // 로컬 날짜 기준 now
  const at = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); };
  const res = (takenAt) => [{ takenAt: '2026-09-01' }, { takenAt }];
  const types = (list) => list.map((x) => x.type + (x.subject ? ':' + x.subject : ''));

  test('retest: 마지막 검사 후 27일은 아님, 28일부터 제안', () => {
    assert.deepEqual(R.shouldRetest(res('2026-10-22'), [], at('2026-11-18')), [], '27일');
    const r = R.shouldRetest(res('2026-10-22'), [], at('2026-11-19'));
    assert.deepEqual(types(r), ['retest'], '28일');
    assert.equal(r[0].go, '#/test');
    assert.equal(r[0].text, '내 스타일을 다시 확인해 볼까?');
    assert.equal(r[0].days, 28);
    assert.deepEqual(types(R.shouldRetest(res('2026-10-01'), [], at('2026-11-19'))), ['retest']);
    assert.deepEqual(R.shouldRetest([], [], at('2026-11-19')), [], '검사 기록 없음');
    // 밀리초 now도 받음
    assert.deepEqual(types(R.shouldRetest(res('2026-10-22'), [], at('2026-11-19').getTime())), ['retest']);
  });

  const recent = res('2026-11-10');

  test('retest: 과목 적용률 1주만 낮으면 아님, 2주 연속 30% 미만이면 제안', () => {
    const one = [
      { isoWeek: '2026-W45', subjectRates: { 수학: 0.6 } },
      { isoWeek: '2026-W46', subjectRates: { 수학: 0.2 } }
    ];
    assert.deepEqual(R.shouldRetest(recent, one, at('2026-11-19')), [], '1주만 낮음');
    const two = [
      { isoWeek: '2026-W45', subjectRates: { 수학: 0.29, 영어: 0.8 } },
      { isoWeek: '2026-W46', subjectRates: { 수학: 0.1, 영어: 0.2 } }
    ];
    const r = R.shouldRetest(recent, two, at('2026-11-19'));
    assert.deepEqual(types(r), ['strategy:수학']);
    assert.equal(r[0].go, '#/strategy?s=' + encodeURIComponent('수학'));
    // 정확히 30%는 낮은 게 아님
    const edge = [{ isoWeek: '2026-W45', subjectRates: { 수학: 0.3 } }, { isoWeek: '2026-W46', subjectRates: { 수학: 0.1 } }];
    assert.deepEqual(R.shouldRetest(recent, edge, at('2026-11-19')), []);
  });

  test('retest: 연속된 주가 아니면 아님, 해를 넘는 연속 주는 인정, 기록 없는 주(null)는 건너뜀', () => {
    const gap = [{ isoWeek: '2026-W44', subjectRates: { 수학: 0.1 } }, { isoWeek: '2026-W46', subjectRates: { 수학: 0.1 } }];
    assert.deepEqual(R.shouldRetest(recent, gap, at('2026-11-19')), [], '한 주 건너뜀');
    const yearEnd = [{ isoWeek: '2026-W53', subjectRates: { 수학: 0.1 } }, { isoWeek: '2027-W01', subjectRates: { 수학: 0 } }];
    assert.deepEqual(types(R.shouldRetest([{ takenAt: '2026-12-20' }], yearEnd, at('2027-01-05'))), ['strategy:수학']);
    // 최근 두 주 기준: 예전에 연속으로 낮았어도 지금 좋아졌으면 제안 안 함
    const better = [
      { isoWeek: '2026-W44', subjectRates: { 수학: 0.1 } },
      { isoWeek: '2026-W45', subjectRates: { 수학: 0.1 } },
      { isoWeek: '2026-W46', subjectRates: { 수학: 0.9 } }
    ];
    assert.deepEqual(R.shouldRetest(recent, better, at('2026-11-19')), []);
    // 순서가 섞여 들어와도 주차 순으로 본다, subjectRates 없는 점검표는 무시
    const mixed = [{ isoWeek: '2026-W46', subjectRates: { 수학: 0.1 } }, { isoWeek: '2026-W47' }, { isoWeek: '2026-W45', subjectRates: { 수학: 0.2 } }];
    assert.deepEqual(types(R.shouldRetest(recent, mixed, at('2026-11-19'))), ['strategy:수학']);
  });

  test('retest: 둘 다면 둘 다', () => {
    const two = [{ isoWeek: '2026-W45', subjectRates: { 영어: 0 } }, { isoWeek: '2026-W46', subjectRates: { 영어: 0.25 } }];
    assert.deepEqual(types(R.shouldRetest(res('2026-10-01'), two, at('2026-11-19'))), ['retest', 'strategy:영어']);
  });

  test('retest: subjectRates — 추천 전략만, 블록 수로 가중 평균', () => {
    const mw = { bySubjectStrategy: {
      수학: { interleave: { rate: 1, n: 1 }, retrieval: { rate: 0, n: 3 }, teach: { rate: 1, n: 5 } },
      영어: { spacing: { rate: 0.5, n: 2 } }
    } };
    const plan = { strategies: { 수학: ['interleave', 'retrieval', 'spacing'], 영어: ['retrieval'], 국어: ['teach'] } };
    const r = R.subjectRates(mw, plan);
    assert.ok(Math.abs(r['수학'] - 0.25) < 1e-9, String(r['수학']));
    assert.equal(r['영어'], null);
    assert.equal(r['국어'], null);
    assert.deepEqual(R.subjectRates(mw, null), {});
  });

  test('metrics: week.bySubjectStrategy', () => {
    const blk = (subject, strategy, applied) => ({ subject, strategy, start: '', end: '', target: { n: null }, done: { applied } });
    const w = SM.metrics.week('2026-W46', (iso) => (iso === '2026-11-10'
      ? [blk('수학', 'interleave', 'yes'), blk('수학', 'interleave', 'partial'), blk('영어', 'interleave', 'no'), blk('수학', null, 'yes')]
      : []));
    assert.deepEqual(w.bySubjectStrategy, { 수학: { interleave: { rate: 0.75, n: 2 } }, 영어: { interleave: { rate: 0, n: 1 } } });
  });

  test('report: 선 끊기 구간', () => {
    const S = SM.checkin.segments;
    assert.deepEqual(S([0.5, null, 0.7, 0.8]), [[0], [2, 3]]);
    assert.deepEqual(S([null, null]), []);
    assert.deepEqual(S([0, 0.1, undefined, 1]), [[0, 1], [3]]);
    assert.deepEqual(S([]), []);
  });
})(window.SM);
