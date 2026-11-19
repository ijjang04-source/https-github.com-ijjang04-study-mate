(function (SM) {
  'use strict';
  const R = SM.router;
  const noop = () => null;

  // 실제 등록된 경로와 섞이지 않도록 테스트용 표를 따로 만든다.
  function table() {
    const t = {};
    const add = (path, def) => { t[path] = Object.assign({ auth: true, render: noop, path }, def); };
    add('/login', { auth: false });
    add('/chat', {});
    add('/planner/:view(month|week|day)', {});
    add('/feed/:classId/:postId', {});
    add('/planner/today', {});
    return t;
  }

  test('router: 고정 경로 매칭', () => {
    const m = R.match('#/chat', table());
    assert.equal(m.route.path, '/chat');
    assert.deepEqual(m.params, {});
  });

  test('router: :param 추출(허용 값 목록)', () => {
    const t = table();
    assert.deepEqual(R.match('#/planner/week', t).params, { view: 'week' });
    assert.deepEqual(R.match('#/planner/day', t).params, { view: 'day' });
    assert.equal(R.match('#/planner/year', t), null);
  });

  test('router: :param 여러 개, URL 디코딩', () => {
    const m = R.match('#/feed/SM01-2-3/%EA%B8%80%201', table());
    assert.deepEqual(m.params, { classId: 'SM01-2-3', postId: '글 1' });
  });

  test('router: 고정 경로가 :param보다 우선', () => {
    const t = table();
    t['/planner/:view'] = { auth: true, render: noop, path: '/planner/:view' };
    assert.equal(R.match('#/planner/today', t).route.path, '/planner/today');
  });

  test('router: 끝 슬래시·쿼리 무시, 길이가 다르면 불일치', () => {
    const t = table();
    assert.equal(R.match('#/chat/', t).route.path, '/chat');
    assert.equal(R.match('#/chat?from=tab', t).route.path, '/chat');
    assert.equal(R.match('#/planner', t), null);
    assert.equal(R.match('#/chat/extra', t), null);
  });

  test('router: 없는 경로·빈 hash는 #/chat으로', () => {
    const t = table();
    assert.deepEqual(R.decide('#/nope', true, t), { type: 'redirect', to: '#/chat' });
    assert.deepEqual(R.decide('', true, t), { type: 'redirect', to: '#/chat' });
    assert.deepEqual(R.decide('#/', true, t), { type: 'redirect', to: '#/chat' });
  });

  test('router: auth 화면은 세션 없으면 #/login으로', () => {
    const t = table();
    assert.deepEqual(R.decide('#/chat', false, t), { type: 'redirect', to: '#/login' });
    assert.equal(R.decide('#/login', false, t).type, 'render');
    const d = R.decide('#/planner/month', true, t);
    assert.equal(d.type, 'render');
    assert.deepEqual(d.params, { view: 'month' });
  });

  test('router: 임시 화면 10개 등록, 탭 매핑', () => {
    ['/login', '/teacher', '/chat', '/test', '/result', '/strategy',
      '/planner/:view(month|week|day)', '/check', '/class', '/settings']
      .forEach((p) => assert.ok(SM.routes[p], '등록 안 됨: ' + p));
    assert.equal(SM.routes['/login'].auth, false);
    assert.equal(SM.routes['/chat'].auth, true);
    assert.equal(SM.routes['/result'].tab, 'test');
    assert.equal(R.match('#/planner/day').route.title, '플래너');
  });

  test('router: SM.route는 render 없으면 예외', () => {
    assert.throws(() => SM.route('#/x', { title: 'x' }));
  });
})(window.SM);
