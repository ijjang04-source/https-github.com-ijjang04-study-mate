(function (SM) {
  'use strict';

  // 마지막 검사 결과: 진단 시작 화면·전략 화면에서 계속 보이고, '결과' 탭이 진단과 전략 사이에 있다.

  function result(id, takenAt, styles) {
    return {
      id, kind: 'basic', takenAt, subjects: ['수학'], weakness: [], anxiety: false,
      styles: Object.assign({ fieldDep: 0, tempo: 0, perception: 0, reasoning: 0, processing: 0, input: 0, order: 0, kolbPerceive: 0, kolbProcess: 0 }, styles || {}),
      vark: { counts: { V: 0, A: 0, R: 0, K: 0 }, preferred: [] }, kolb: { perceive: 0, process: 0, type: 'balanced' }
    };
  }

  test('last-result: 결과가 없으면 null', () => {
    assert.equal(SM.test.lastResultInfo([]), null);
    assert.equal(SM.test.lastResultInfo(null), null);
    assert.equal(SM.test.lastResultInfo([null, {}]), null);
  });

  test('last-result: 여러 번 검사해도 마지막 결과를 날짜·요약과 함께 돌려줌', () => {
    const a = result('r1', '2026-11-03T09:00:00.000Z', { input: -60 });
    const b = result('r2', '2026-11-20T09:00:00.000Z', { input: 60 });
    const info = SM.test.lastResultInfo([a, b]);
    assert.equal(info.id, 'r2');
    assert.equal(info.date, '11월 20일');
    assert.equal(info.line, SM.test.summary(b));
    assert.ok(info.line.length > 0, '요약 한 줄이 비어 있음');
  });

  test('last-result: 결과·결과 기록 화면은 "결과" 탭에 묶임', () => {
    assert.equal(SM.routes['/result'].tab, 'result');
    assert.equal(SM.routes['/result/history'].tab, 'result');
  });

  if (typeof SMTestFS !== 'undefined') {
    test('last-result: 하단 탭 순서 진단 → 결과 → 전략, 탭 칸 수도 맞춤', () => {
      const html = SMTestFS.read('index.html');
      const routes = Array.from(html.matchAll(/data-route="([^"]+)"/g), (m) => m[1]);
      assert.deepEqual(routes, ['chat', 'test', 'result', 'strategy', 'planner', 'check', 'class']);
      const css = SMTestFS.read('css/style.css');
      assert.ok(css.includes(`repeat(${routes.length}, minmax(0, 1fr))`), '탭 칸 수가 탭 개수와 다름');
    });
  }
})(window.SM = window.SM || {});
