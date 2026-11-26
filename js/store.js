(function (SM) {
  'use strict';

  // localStorage는 이 파일에서만 다룬다. 다른 파일은 항상 SM.store를 쓴다.

  // 접두사의 v1은 키 이름 규칙이고, 데이터 모양 버전은 SCHEMA(meta.schema)다.
  const PREFIX = 'sm:v1:';
  const SCHEMA = 3;
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

  // ---------- 스키마 2: 여러 문장 전략(sevenRules) → 나만의 한 가지 전략(myRule) ----------

  /** "나는 [상황] [행동]." → { situation, action } (상황은 '~면'·'~전에'로 끝남). 못 나누면 빈 문자열 */
  function splitRuleText(text) {
    const t = String(text || '').trim().replace(/^나는\s+/, '').replace(/[.。]+$/, '').trim();
    const m = /^(.*?(?:면|전에))\s+(.+)$/.exec(t);
    return m ? { situation: m[1].trim(), action: m[2].trim() } : { situation: '', action: '' };
  }

  function ruleFromOld(r, updatedAt) {
    const text = String((r && r.text) || '').trim();
    const parts = splitRuleText(text);
    return {
      text, situation: parts.situation, action: parts.action, subject: null,
      strategyId: (r && r.strategyId) || null, updatedAt: updatedAt || null
    };
  }

  /** plan 하나를 바꾼 새 객체. sevenRules가 없으면 같은 객체를 그대로 돌려준다(여러 번 해도 같음). */
  function planToV2(plan) {
    if (!isPlain(plan) || !Object.prototype.hasOwnProperty.call(plan, 'sevenRules')) return plan;
    const out = Object.assign({}, plan);
    const at = plan.updatedAt || null;
    const rules = (Array.isArray(plan.sevenRules) ? plan.sevenRules : [])
      .filter((r) => r && String(r.text || '').trim())
      .map((r) => ruleFromOld(r, at));
    const history = Array.isArray(plan.myRuleHistory) ? plan.myRuleHistory.slice() : [];
    if (rules.length) {
      // 이미 한 가지 전략이 있으면(새 데이터 위에 옛 백업) 옛 문장은 모두 기록으로
      if (isPlain(plan.myRule) && plan.myRule.text) history.push(...rules);
      else { out.myRule = rules[0]; history.push(...rules.slice(1)); }
    }
    out.myRuleHistory = history;
    delete out.sevenRules;
    return out;
  }

  /** 주간 점검표 한 주: seven [{text,status}] → myRule { text, status } */
  function checkinToV2(entry) {
    if (!isPlain(entry) || !Object.prototype.hasOwnProperty.call(entry, 'seven')) return entry;
    const out = Object.assign({}, entry);
    const first = (Array.isArray(entry.seven) ? entry.seven : []).find((s) => isPlain(s) && String(s.text || '').trim());
    if (first && !isPlain(out.myRule)) out.myRule = { text: String(first.text).trim(), status: first.status || null };
    delete out.seven;
    return out;
  }

  /** 플래너 한 달: 주간 실행 의도 from 'seven' → 'myRule' */
  function plannerToV2(data) {
    if (!isPlain(data) || !isPlain(data.weeks)) return data;
    let changed = false;
    const weeks = {};
    Object.keys(data.weeks).forEach((wk) => {
      const w = data.weeks[wk];
      if (isPlain(w) && Array.isArray(w.intentions) && w.intentions.some((x) => x && x.from === 'seven')) {
        changed = true;
        weeks[wk] = Object.assign({}, w, { intentions: w.intentions.map((x) => (x && x.from === 'seven' ? Object.assign({}, x, { from: 'myRule' }) : x)) });
      } else weeks[wk] = w;
    });
    return changed ? Object.assign({}, data, { weeks }) : data;
  }

  /** api = { get, set, keys }. 바뀐 키 수를 돌려준다. */
  function migrateV2(api) {
    let n = 0;
    const apply = (prefix, fn) => api.keys(prefix).forEach((k) => {
      const before = api.get(k, null);
      const after = fn(before);
      if (after !== before) { api.set(k, after); n++; }
    });
    apply('plan:', planToV2);
    apply('checkin:', (list) => {
      if (!Array.isArray(list) || !list.some((e) => isPlain(e) && 'seven' in e)) return list;
      return list.map(checkinToV2);
    });
    apply('planner:', plannerToV2);
    return n;
  }

  SM.schema2 = { splitRuleText, planToV2, checkinToV2, plannerToV2, migrateV2 };

  // ---------- 스키마 3: 진단 결과마다 id·kind ----------
  // kind: 'basic'(기본) | 'deep'(기본 + 심화 포함). 심화는 따로 쌓지 않고 가장 최근 기본 결과에 붙는다.

  const RESULT_ID_RE = /^(\d{4}-\d{2}-\d{2}|unknown)-(\d+)$/;

  /** 새 결과 id 'YYYY-MM-DD-n': 그날 쓰인 가장 큰 n + 1(중간 것을 지워도 겹치지 않음) */
  function nextResultId(list, takenAt) {
    const day = /^\d{4}-\d{2}-\d{2}/.test(String(takenAt || '')) ? String(takenAt).slice(0, 10) : 'unknown';
    let max = 0;
    (Array.isArray(list) ? list : []).forEach((r) => {
      const m = r && typeof r.id === 'string' ? RESULT_ID_RE.exec(r.id) : null;
      if (m && m[1] === day) max = Math.max(max, +m[2]);
    });
    return `${day}-${max + 1}`;
  }

  function kindOf(r) { return r && r.extended ? 'deep' : 'basic'; }

  /** 결과 배열 → id·kind가 붙은 새 배열. 하나만 저장된 예전 결과는 배열 첫 항목으로. 바꿀 게 없으면 같은 값. */
  function resultsToV3(value) {
    const list = isPlain(value) ? [value] : value;
    if (!Array.isArray(list)) return value;
    let changed = list !== value;
    const out = list.filter((r) => isPlain(r));
    if (out.length !== list.length) changed = true;
    const done = out.filter((r) => typeof r.id === 'string' && r.id);
    const next = out.map((r) => {
      let c = r;
      if (typeof r.id !== 'string' || !r.id) {
        c = Object.assign({}, c, { id: nextResultId(done, r.takenAt) });
        done.push(c);
      }
      if (c.kind !== kindOf(c)) c = Object.assign({}, c, { kind: kindOf(c) });
      if (c !== r) changed = true;
      return c;
    });
    return changed ? next : value;
  }

  /** 전략 화면이 '추천을 만든 결과'를 알아보는 열쇠. id가 있으면 id로(기록을 지워도 그대로). */
  function resultKey(list) {
    const r = list[list.length - 1];
    if (r && r.id) return `${r.id}:${r.extended ? 1 : 0}`;
    return `${list.length}:${r.takenAt}:${r.extended ? 1 : 0}`;
  }

  function migrateV3(api) {
    let n = 0;
    api.keys('results:').forEach((k) => {
      const before = api.get(k, null);
      const after = resultsToV3(before);
      if (after === before) return;
      api.set(k, after);
      n++;
      // 예전 열쇠(개수:날짜:심화)로 기억한 plan은 새 열쇠로(추천이 바뀌었다고 잘못 묻지 않게)
      const sid = k.slice('results:'.length);
      const plan = api.get('plan:' + sid, null);
      const oldList = isPlain(before) ? [before] : before;
      if (!isPlain(plan) || !Array.isArray(oldList) || !oldList.length || !after.length) return;
      const oldKey = `${oldList.length}:${oldList[oldList.length - 1].takenAt}:${oldList[oldList.length - 1].extended ? 1 : 0}`;
      const newKey = resultKey(after);
      const p = Object.assign({}, plan);
      let touched = false;
      if (p.basedOn === oldKey) { p.basedOn = newKey; touched = true; }
      if (p.announced === oldKey) { p.announced = newKey; touched = true; }
      if (touched) api.set('plan:' + sid, p);
    });
    return n;
  }

  SM.schema3 = { nextResultId, resultsToV3, resultKey, migrateV3 };
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
      // 예전 버전 백업은 받아서 지금 모양으로 바꾼다. 앱보다 새 버전은 거절.
      if (typeof obj.version !== 'number' || obj.version < 1 || obj.version > SCHEMA) {
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
      for (let v = obj.version + 1; v <= target; v++) {
        if (MIGRATIONS[v]) MIGRATIONS[v]({ get, set, remove, keys });
      }
      return result;
    }

    // 같은 탭 안에서 바뀐 것(원격 저장소에서 받아 온 것 등)을 알리는 구독자
    const localListeners = new Set();

    /** 같은 탭에서 키가 바뀌었다고 알린다. info: { source: 'remote' } 등 */
    function emit(key, info) {
      localListeners.forEach((fn) => { try { fn(key, info || {}); } catch (e) { console.warn('[SM.store] 변경 알림 실패', e); } });
    }

    /** 다른 탭에서 sm:v1: 키가 바뀌면 fn(key, { source: 'tab' }) 호출. 전체 삭제는 fn(null).
     *  같은 탭의 emit(key, info)도 받는다. 해제 함수를 반환한다. */
    function onChange(fn) {
      localListeners.add(fn);
      if (typeof window.addEventListener !== 'function') return () => localListeners.delete(fn);
      const handler = (e) => {
        if (e.key === null) fn(null, { source: 'tab' });
        else if (e.key.startsWith(PREFIX)) fn(e.key.slice(PREFIX.length), { source: 'tab' });
      };
      window.addEventListener('storage', handler);
      return () => { localListeners.delete(fn); window.removeEventListener('storage', handler); };
    }

    // 스키마 버전 n으로 올리는 함수. 새 버전을 만들 때 여기에 추가한다.
    //   n: (api) => { ... }   api = { get, set, remove, keys } — 버전 n-1 데이터를 n 모양으로 바꾼다.
    // 예시(가짜 v0 → v1)는 tests/settings.test.js에 있다.
    const target = typeof options.schema === 'number' ? options.schema : SCHEMA;
    const MIGRATIONS = options.migrations || {
      1: () => { /* 최초 버전: 할 일 없음 */ },
      2: (api) => { migrateV2(api); },  // 여러 문장 전략 → 나만의 한 가지 전략
      3: (api) => { migrateV3(api); }   // 진단 결과마다 id·kind
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
      exportAll, importAll, onChange, emit, migrate, init,
      isPersistent: persistent,
      PREFIX, SCHEMA
    };
  }

  SM.createStore = createStore;
  SM.storeUtil = { merge3, assignDeep, classIdOf };
  SM.store = createStore(() => window.localStorage);
})(window.SM = window.SM || {});
