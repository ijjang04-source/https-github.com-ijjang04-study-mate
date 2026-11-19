(function (SM) {
  'use strict';

  // localStorage는 이 파일에서만 다룬다. 다른 파일은 항상 SM.store를 쓴다.

  const PREFIX = 'sm:v1:';
  const SCHEMA = 1;
  const META_KEY = 'meta';

  /** 키 이름 헬퍼(접두사 제외) */
  SM.keys = {
    meta: () => META_KEY,
    session: () => 'session',
    profile: (sid) => `profile:${sid}`,
    testProgress: (sid) => `test-progress:${sid}`,
    testProgressDeep: (sid) => `test-progress:${sid}:deep`,
    results: (sid) => `results:${sid}`,
    plan: (sid) => `plan:${sid}`,
    planner: (sid, monthKey) => `planner:${sid}:${monthKey}`,
    checkin: (sid) => `checkin:${sid}`,
    chat: (sid) => `chat:${sid}`,
    feed: (classId) => `feed:${classId}`,
    comments: (classId) => `comments:${classId}`,
    feedSeen: (sid) => `feed-seen:${sid}`,
    chatMeta: (sid) => `chat-meta:${sid}`,
    // 기기 단위 설정(학생과 무관): { autoLogoutMinutes }
    device: () => 'device'
  };

  const SID_RE = /^[A-Za-z0-9]+-\d+-\d+-\d+$/;

  /** 'SM01-2-3-15' → 'SM01-2-3' */
  function classIdOf(sid) {
    if (!SID_RE.test(String(sid))) throw new Error('잘못된 학생 ID: ' + sid);
    return String(sid).split('-').slice(0, 3).join('-');
  }

  /** localStorage와 같은 모양의 메모리 저장소 */
  function memoryStorage() {
    const map = new Map();
    return {
      get length() { return map.size; },
      key(i) { const k = Array.from(map.keys())[i]; return k === undefined ? null : k; },
      getItem(k) { k = String(k); return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(String(k), String(v)); },
      removeItem(k) { map.delete(String(k)); },
      clear() { map.clear(); }
    };
  }

  function isQuotaError(e) {
    return !!e && (e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }

  function notifyQuota() {
    if (SM.ui && typeof SM.ui.toast === 'function' && typeof document !== 'undefined') {
      try { SM.ui.toast('저장 공간이 거의 찼어요. 설정에서 백업 후 정리해 주세요.', 4000); } catch (e) { /* 무시 */ }
    }
  }

  function isPlain(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /**
   * 3방향 병합(필드 단위, 이 창의 수정이 마지막 수정).
   * base: 이 창이 처음 읽은 값, mine: 이 창이 저장하려는 값, theirs: 지금 저장된 값(다른 창이 바꿈)
   * - 이 창이 바꾼 필드(mine ≠ base)는 mine
   * - 이 창이 안 바꾼 필드는 theirs
   * 객체는 안으로 들어가 비교하고, 배열·값은 통째로 비교한다.
   */
  function merge3(base, mine, theirs) {
    if (!isPlain(mine) || !isPlain(theirs)) return same(mine, base) ? theirs : mine;
    const b = isPlain(base) ? base : {};
    const out = {};
    const keys = {};
    Object.keys(b).concat(Object.keys(mine), Object.keys(theirs)).forEach((k) => { keys[k] = true; });
    Object.keys(keys).forEach((k) => {
      const inMine = Object.prototype.hasOwnProperty.call(mine, k);
      const inBase = Object.prototype.hasOwnProperty.call(b, k);
      const inTheirs = Object.prototype.hasOwnProperty.call(theirs, k);
      let v;
      if (!inMine && inBase) v = undefined;                    // 이 창이 지운 필드
      else if (!inMine) v = theirs[k];                         // 다른 창이 새로 만든 필드
      else if (!inTheirs && inBase && same(mine[k], b[k])) v = undefined; // 다른 창이 지움, 나는 안 바꿈
      else if (isPlain(mine[k]) && isPlain(theirs[k])) v = merge3(b[k], mine[k], theirs[k]);
      else v = same(mine[k], b[k]) ? theirs[k] : mine[k];
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  /** target을 src와 같게 바꾼다(같은 객체를 계속 쓰는 화면이 최신 값을 갖도록). */
  function assignDeep(target, src) {
    Object.keys(target).forEach((k) => { if (!(k in src)) delete target[k]; });
    Object.keys(src).forEach((k) => {
      if (isPlain(target[k]) && isPlain(src[k])) assignDeep(target[k], src[k]);
      else target[k] = src[k];
    });
    return target;
  }

  /**
   * 저장소 인스턴스를 만든다. getBackend()가 예외를 던지거나
   * 쓰기·지우기 검사에 실패하면 메모리 저장으로 대체한다.
   * options.schema / options.migrations: 테스트에서 가짜 버전·마이그레이션을 넣을 때
   */
  function createStore(getBackend, options = {}) {
    let backend;
    let persistent = true;
    try {
      backend = getBackend();
      const probe = PREFIX + '__probe__';
      backend.setItem(probe, '1');
      backend.removeItem(probe);
    } catch (e) {
      console.warn('[SM.store] localStorage를 쓸 수 없어 메모리 저장으로 대체합니다:', e && e.message);
      backend = memoryStorage();
      persistent = false;
    }

    function rawKeys() {
      const out = [];
      for (let i = 0; i < backend.length; i++) {
        const k = backend.key(i);
        if (k !== null && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
      }
      return out;
    }

    // 이 창이 처음 읽은(또는 마지막으로 쓴) 원문. 다른 창이 바꾼 뒤 저장하면 병합한다.
    const seen = new Map();
    // 읽은 키 기록(현재 화면이 어떤 키를 쓰는지 알려고)
    let tracker = null;

    function get(key, fallback) {
      const raw = backend.getItem(PREFIX + key);
      if (tracker) tracker.add(key);
      if (!seen.has(key)) seen.set(key, raw);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.warn('[SM.store] JSON 파싱 실패, 기본값 사용: ' + key);
        return fallback;
      }
    }

    /** 성공 true, 실패 false. value가 undefined면 키를 지운다. */
    function set(key, value) {
      if (value === undefined) { remove(key); return true; }
      try {
        let out = value;
        const now = backend.getItem(PREFIX + key);
        if (seen.has(key) && seen.get(key) !== now && isPlain(value)) {
          // 이 창이 읽은 뒤 다른 창이 바꿨다 → 필드 단위로 병합
          let base = null; let theirs = null;
          try { base = JSON.parse(seen.get(key)); } catch (e) { /* 무시 */ }
          try { theirs = JSON.parse(now); } catch (e) { /* 무시 */ }
          if (isPlain(theirs)) {
            out = merge3(base, value, theirs);
            assignDeep(value, out);
          }
        }
        const raw = JSON.stringify(out);
        backend.setItem(PREFIX + key, raw);
        seen.set(key, raw);
        return true;
      } catch (e) {
        if (isQuotaError(e)) notifyQuota();
        else console.warn('[SM.store] 저장 실패: ' + key, e && e.message);
        return false;
      }
    }

    function update(key, fn, fallback) {
      const next = fn(get(key, fallback));
      set(key, next);
      return next;
    }

    function remove(key) {
      backend.removeItem(PREFIX + key);
      seen.set(key, null);
    }

    /** 읽은 키 기록 시작. 반환된 Set에 이후 get한 키가 쌓인다. stopTracking()으로 끝. */
    function track() { tracker = new Set(); return tracker; }
    function stopTracking() { tracker = null; }
    /** 이 창이 기억한 '처음 읽은 값'을 잊는다(다음 get이 새 기준). */
    function forget(key) { seen.delete(key); }

    /** 그 학생 개인 키(두 번째 칸이 sid) */
    function ownKeys(sid) {
      return rawKeys().filter((k) => ownerOf(k) === String(sid));
    }

    function keys(prefix = '') {
      return rawKeys().filter((k) => k.startsWith(prefix));
    }

    function usageBytes() {
      return rawKeys().reduce((sum, k) => {
        const v = backend.getItem(PREFIX + k) || '';
        return sum + (PREFIX.length + k.length + v.length) * 2;
      }, 0);
    }

    /** 키의 두 번째 칸(':'로 나눈)이 sid나 classId와 정확히 같으면 그 학생/반의 키다. */
    function ownerOf(key) {
      return String(key).split(':')[1];
    }

    function exportAll(sid) {
      const classId = classIdOf(sid);
      const data = {};
      rawKeys().forEach((k) => {
        const owner = ownerOf(k);
        if (owner === sid || owner === classId) data[k] = get(k, null);
      });
      return { version: SCHEMA, exportedAt: new Date().toISOString(), sid, data };
    }

    /**
     * 백업 복원. json은 문자열이나 객체.
     * overwrite=false면 없는 키만 추가한다. 그 학생·반의 키가 아니면 건너뛴다.
     * 반환: { added, overwritten, skipped, failed }
     */
    function importAll(json, options = {}) {
      const overwrite = !!options.overwrite;
      let obj = json;
      if (typeof json === 'string') {
        try { obj = JSON.parse(json); } catch (e) { throw new Error('백업 파일을 읽을 수 없어요.'); }
      }
      if (!obj || typeof obj !== 'object' || !obj.data || typeof obj.data !== 'object') {
        throw new Error('백업 형식이 올바르지 않아요.');
      }
      if (obj.version !== SCHEMA) {
        throw new Error('지원하지 않는 백업 버전이에요: ' + obj.version);
      }
      const sid = obj.sid;
      const classId = classIdOf(sid);
      const result = { added: 0, overwritten: 0, skipped: 0, failed: 0 };
      Object.keys(obj.data).forEach((k) => {
        const owner = ownerOf(k);
        if (owner !== sid && owner !== classId) { result.skipped++; return; }
        const exists = backend.getItem(PREFIX + k) !== null;
        if (exists && !overwrite) { result.skipped++; return; }
        if (!set(k, obj.data[k])) { result.failed++; return; }
        if (exists) result.overwritten++; else result.added++;
      });
      return result;
    }

    /** 다른 탭에서 sm:v1: 키가 바뀌면 fn(key) 호출. 전체 삭제는 fn(null). 해제 함수를 반환한다. */
    function onChange(fn) {
      if (typeof window.addEventListener !== 'function') return () => {};
      const handler = (e) => {
        if (e.key === null) fn(null);
        else if (e.key.startsWith(PREFIX)) fn(e.key.slice(PREFIX.length));
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    }

    // 스키마 버전 n으로 올리는 함수. 새 버전을 만들 때 여기에 추가한다.
    //   n: (api) => { ... }   api = { get, set, remove, keys } — 버전 n-1 데이터를 n 모양으로 바꾼다.
    // 예시(가짜 v0 → v1)는 tests/settings.test.js에 있다.
    const target = typeof options.schema === 'number' ? options.schema : SCHEMA;
    const MIGRATIONS = options.migrations || {
      1: () => { /* 최초 버전: 할 일 없음 */ }
    };

    /**
     * meta.schema부터 target까지 차례로 올린다. 한 단계라도 실패하면 거기서 멈추고
     * meta는 성공한 단계까지만 기록한다(데이터는 지우지 않는다).
     */
    function migrate() {
      const meta = get(META_KEY, null);
      const from = (meta && typeof meta.schema === 'number') ? meta.schema : 0;
      if (from > target) {
        console.warn('[SM.store] 저장된 데이터가 앱보다 새 버전입니다(schema ' + from + ').');
        return from;
      }
      const api = { get, set, remove, keys };
      let at = from;
      for (let v = from + 1; v <= target; v++) {
        try {
          if (MIGRATIONS[v]) MIGRATIONS[v](api);
          at = v;
        } catch (e) {
          console.error('[SM.store] schema ' + v + ' 마이그레이션 실패', e);
          break;
        }
      }
      if (at !== from || !meta) set(META_KEY, { schema: at });
      return at;
    }

    /** 앱 시작 시 한 번 호출 */
    function init() {
      migrate();
      return { isPersistent: persistent };
    }

    return {
      get, set, update, remove, keys, usageBytes, ownKeys, track, stopTracking, forget,
      exportAll, importAll, onChange, migrate, init,
      isPersistent: persistent,
      PREFIX, SCHEMA
    };
  }

  SM.createStore = createStore;
  SM.storeUtil = { merge3, assignDeep, classIdOf };
  SM.store = createStore(() => window.localStorage);
})(window.SM = window.SM || {});
