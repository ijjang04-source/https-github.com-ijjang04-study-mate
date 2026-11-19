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
    chatMeta: (sid) => `chat-meta:${sid}`
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

  /**
   * 저장소 인스턴스를 만든다. getBackend()가 예외를 던지거나
   * 쓰기·지우기 검사에 실패하면 메모리 저장으로 대체한다.
   */
  function createStore(getBackend) {
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

    function get(key, fallback) {
      const raw = backend.getItem(PREFIX + key);
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
        backend.setItem(PREFIX + key, JSON.stringify(value));
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
    const MIGRATIONS = {
      1: () => { /* 최초 버전: 할 일 없음 */ }
    };

    function migrate() {
      const meta = get(META_KEY, null);
      const from = (meta && typeof meta.schema === 'number') ? meta.schema : 0;
      if (from > SCHEMA) {
        console.warn('[SM.store] 저장된 데이터가 앱보다 새 버전입니다(schema ' + from + ').');
        return from;
      }
      for (let v = from + 1; v <= SCHEMA; v++) {
        if (MIGRATIONS[v]) MIGRATIONS[v]();
      }
      if (from !== SCHEMA) set(META_KEY, { schema: SCHEMA });
      return SCHEMA;
    }

    /** 앱 시작 시 한 번 호출 */
    function init() {
      migrate();
      return { isPersistent: persistent };
    }

    return {
      get, set, update, remove, keys, usageBytes,
      exportAll, importAll, onChange, migrate, init,
      isPersistent: persistent,
      PREFIX, SCHEMA
    };
  }

  SM.createStore = createStore;
  SM.store = createStore(() => window.localStorage);
})(window.SM = window.SM || {});
