// ---------- SM.remote: 반 공유 데이터 원격 저장소 어댑터 ----------
// 반 공유 데이터(피드 스냅샷·댓글·반응)만 원격으로 보낸다. 개인 데이터는 계속 localStorage(SM.store)에 둔다.
// 어댑터 모양(모두 Promise):
//   get(path)                → item | null
//   list(path, { since })    → { items: [{ id, data, deleted, updatedAt }], serverTime }
//   put(path, item)          → { created, updatedAt }
//   delete(path)             → { existed }       (서버는 지우지 않고 삭제 표시를 남긴다)
// path: 'classes/<classId>/<feed|comments>[/<id>]'
// 실패는 RemoteError: status 0 = 연결 안 됨(다시 보냄), 5xx = 서버 문제(다시 보냄), 4xx = 거부(다시 보내지 않음)
(function (SM) {
  'use strict';

  const KINDS = ['feed', 'comments'];
  const PATH_RE = /^classes\/([A-Za-z0-9]+-\d+-\d+)\/(feed|comments)(?:\/(.+))?$/;

  function parsePath(path) {
    const m = PATH_RE.exec(String(path || ''));
    return m ? { classId: m[1], kind: m[2], id: m[3] || null } : null;
  }
  function pathOf(classId, kind, id) {
    return `classes/${classId}/${kind}` + (id ? '/' + id : '');
  }

  function remoteError(status, message) {
    const e = new Error(message || (status ? '서버 오류 ' + status : '연결할 수 없어'));
    e.status = status;
    e.offline = status === 0;
    e.permanent = status >= 400 && status < 500;
    return e;
  }

  /** 반 키: 입장 코드와 반 ID로 만든다. config.js의 공개 해시(코드만 해시)와 입력이 달라 공개 파일로는 만들 수 없다. */
  function classKey(classId, code) {
    return SM.auth.sha256Hex(`study-mate:${classId}:${code}`);
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(remoteError(0, '응답이 없어')), ms);
      promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  // ---------- Google Apps Script 웹 앱 ----------

  /**
   * opts: { url, keyOf: (classId) => 반 키, fetch?, timeoutMs? }
   * Content-Type을 text/plain으로 보내 CORS 사전 요청(preflight) 없이 보낸다.
   */
  function appsScript(opts) {
    const fetchFn = opts.fetch || ((u, o) => fetch(u, o));
    const timeoutMs = opts.timeoutMs || 15000;

    async function call(op, path, extra) {
      const p = parsePath(path);
      if (!p) throw remoteError(400, '잘못된 경로');
      const body = Object.assign({ op, path, key: opts.keyOf ? opts.keyOf(p.classId) : null }, extra || {});
      let res;
      try {
        res = await withTimeout(fetchFn(opts.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          redirect: 'follow'
        }), timeoutMs);
      } catch (e) {
        throw e && e.status !== undefined ? e : remoteError(0);
      }
      if (!res.ok) throw remoteError(res.status);
      let data;
      try { data = await res.json(); } catch (e) { throw remoteError(502, '응답을 읽을 수 없어'); }
      if (!data || !data.ok) throw remoteError((data && data.status) || 400, data && data.error);
      return data;
    }

    return {
      get: (path) => call('get', path).then((d) => d.item || null),
      list: (path, o) => call('list', path, { since: (o && o.since) || null }).then((d) => ({ items: d.items || [], serverTime: d.serverTime || null })),
      put: (path, item) => call('put', path, { item }).then((d) => ({ created: !!d.created, updatedAt: d.updatedAt || null })),
      delete: (path) => call('delete', path).then((d) => ({ existed: !!d.existed }))
    };
  }

  // ---------- 테스트용 가짜 서버 ----------

  /**
   * 여러 '기기'(client)가 같은 가짜 서버를 함께 쓴다.
   * server = SM.remote.fakeServer({ keys: { classId: 반 키 } })
   * client = server.client({ key: (classId) => 반 키 })
   *   client.setOffline(true) · client.failNext(status, n) · client.calls(보낸 요청 기록)
   * 서버 규칙(Apps Script와 같게): 반 키 확인, 경로의 반과 항목의 반이 같아야 함, 댓글 200자.
   */
  function fakeServer(options) {
    const o = options || {};
    const rows = new Map();       // path → { data, deleted, updatedAt }
    let clock = 0;
    const stamp = () => 'T' + String(++clock).padStart(10, '0');
    const nowStamp = () => 'T' + String(clock).padStart(10, '0');

    function itemClass(kind, item) {
      const sid = kind === 'feed' ? item.sid : SM.feed.planOwner(item.planKey);
      return SM.feed.classIdOf(sid);
    }

    function handle(op, path, arg, key) {
      const p = parsePath(path);
      if (!p) throw remoteError(400, '잘못된 경로');
      if (o.keys && o.keys[p.classId] !== key) throw remoteError(403, '반 키가 맞지 않아');
      if (op === 'list') {
        const since = (arg && arg.since) || '';
        const prefix = pathOf(p.classId, p.kind) + '/';
        const items = [];
        rows.forEach((r, k) => {
          if (k.startsWith(prefix) && r.updatedAt > since) items.push({ id: k.slice(prefix.length), data: r.deleted ? null : JSON.parse(JSON.stringify(r.data)), deleted: r.deleted, updatedAt: r.updatedAt });
        });
        items.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
        return { items, serverTime: nowStamp() };
      }
      if (!p.id) throw remoteError(400, '항목 id가 없어');
      const row = rows.get(path);
      if (op === 'get') return row && !row.deleted ? JSON.parse(JSON.stringify(row.data)) : null;
      if (op === 'put') {
        if (!arg || typeof arg !== 'object') throw remoteError(400, '내용이 없어');
        if (itemClass(p.kind, arg) !== p.classId) throw remoteError(403, '다른 반 항목이야');
        if (p.kind === 'comments' && Array.from(String(arg.text || '')).length > 200) throw remoteError(400, '200자까지 쓸 수 있어');
        const created = !row || row.deleted;
        const updatedAt = stamp();
        rows.set(path, { data: JSON.parse(JSON.stringify(arg)), deleted: false, updatedAt });
        return { created, updatedAt };
      }
      if (op === 'delete') {
        const existed = !!row && !row.deleted;
        rows.set(path, { data: null, deleted: true, updatedAt: stamp() });
        return { existed };
      }
      throw remoteError(400, '알 수 없는 요청');
    }

    function client(copts) {
      const c = copts || {};
      let offline = false;
      const fails = [];
      const calls = [];
      function run(op, path, arg) {
        calls.push({ op, path });
        return new Promise((resolve, reject) => {
          const done = () => {
            if (offline) return reject(remoteError(0));
            if (fails.length) return reject(remoteError(fails.shift()));
            try {
              const p = parsePath(path);
              resolve(handle(op, path, arg, c.key && p ? c.key(p.classId) : null));
            } catch (e) { reject(e); }
          };
          if (c.latency) setTimeout(done, c.latency); else Promise.resolve().then(done);
        });
      }
      return {
        get: (path) => run('get', path),
        list: (path, lo) => run('list', path, lo || {}),
        put: (path, item) => run('put', path, item),
        delete: (path) => run('delete', path),
        setOffline(v) { offline = !!v; },
        failNext(status, n) { for (let i = 0; i < (n || 1); i++) fails.push(status); },
        calls
      };
    }

    return { client, rows, count: () => rows.size };
  }

  // ---------- 앱에서 쓰는 기본 어댑터 ----------

  const KEY_PREFIX = 'remote:key:';
  let cached = null;

  /** config.remote가 있고 SHA-256을 쓸 수 있으면 원격을 쓴다(file://·체험용은 로컬만). */
  function enabled() {
    const cfg = SM.config && SM.config.remote;
    return !!(cfg && cfg.url && SM.auth && SM.auth.hasSubtle && SM.auth.hasSubtle());
  }

  /** 입장에 성공했을 때 auth가 부른다. 이 기기에 반 키를 기억한다. */
  async function rememberClassKey(classId, code) {
    if (!enabled()) return false;
    try {
      SM.store.set(KEY_PREFIX + classId, await classKey(classId, code));
      return true;
    } catch (e) { return false; }
  }

  function adapter() {
    if (!enabled()) return null;
    const cfg = SM.config.remote;
    if (cached && cached.url === cfg.url) return cached.api;
    const api = appsScript({ url: cfg.url, keyOf: (classId) => SM.store.get(KEY_PREFIX + classId, null) });
    cached = { url: cfg.url, api };
    return api;
  }

  SM.remote = { appsScript, fakeServer, adapter, enabled, rememberClassKey, classKey, parsePath, pathOf, remoteError, KINDS };
})(window.SM = window.SM || {});
