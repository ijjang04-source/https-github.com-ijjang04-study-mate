// ---------- SM.feed: 반 피드·댓글 ----------
// 피드·댓글 읽기/쓰기는 모두 이 API 안에서만 한다(나중에 원격 저장소로 바꾸기 위해).
// 저장: SM.keys.feed(classId) = [스냅샷], SM.keys.comments(classId) = [댓글·반응], SM.keys.feedSeen(sid) = { seenAt, noticeClosed }
// 원격 저장소(SM.remote)가 설정되면: 위 두 키는 '로컬 사본'이 되고, 바뀐 항목은 'remote:outbox'(기기 단위 보낼 목록)에
// 쌓였다가 온라인일 때 하나씩 보낸다. 받아온 변경은 사본에 넣고 store.emit으로 화면에 알린다. 화면 API는 그대로 동기다.
// 스냅샷에는 공개한 주간 계획 요약만 넣는다. 일간 세부 기록·자기 점검표·진단 결과는 절대 넣지 않는다.
(function (SM) {
  'use strict';

  const MAX_TEXT = 200;
  const REACTIONS = [['cheer', '응원해'], ['try', '나도 해볼래'], ['question', '질문 있어']];
  const REACTION_IDS = REACTIONS.map((r) => r[0]);
  const OUTBOX_KEY = 'remote:outbox';            // 기기 단위(같은 기기의 다른 학생이 입장해 있어도 보낸다)
  const SYNC_KEY = (classId) => 'remote:sync:' + classId; // { since: { feed, comments }, migrated: { sid: ISO } }
  const MAX_RETRY_MS = 5 * 60 * 1000;
  const POLL_MS = 30 * 1000;

  function classIdOf(sid) {
    const m = /^(.+)-\d+$/.exec(String(sid || ''));
    return m ? m[1] : null;
  }

  function planOwner(planKey) {
    const i = String(planKey || '').lastIndexOf(':');
    return i === -1 ? null : planKey.slice(0, i);
  }

  /** 주차 표시: 그 주 월요일 기준 '11월 3주' */
  function weekLabel(isoWeek) {
    const mon = SM.date.weekDays(isoWeek)[0];
    return `${+mon.slice(5, 7)}월 ${Math.ceil(+mon.slice(8) / 7)}주`;
  }

  /** 댓글 글자 검사: 1~200자, 제어 문자·금칙어 차단 */
  function checkText(text, bannedWords) {
    const value = String(text === undefined || text === null ? '' : text).trim();
    const len = Array.from(value).length;
    if (len < 1) return { ok: false, error: '내용을 적어 줘.' };
    if (len > MAX_TEXT) return { ok: false, error: `${MAX_TEXT}자까지 쓸 수 있어.` };
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return { ok: false, error: '쓸 수 없는 글자가 있어.' };
    const flat = value.toLowerCase().replace(/\s+/g, '');
    const hit = (bannedWords || []).find((w) => w && flat.indexOf(String(w).toLowerCase().replace(/\s+/g, '')) !== -1);
    if (hit) return { ok: false, banned: true, error: '친구가 상처받을 수 있는 말이 들어 있어. 고쳐서 다시 써 줘.' };
    return { ok: true, value };
  }

  function sameContent(a, b) {
    const strip = (x) => { const o = Object.assign({}, x); delete o.updatedAt; return JSON.stringify(o); };
    return !!a && !!b && strip(a) === strip(b);
  }

  /**
   * deps: { store, profile: () => 프로필|null, planner, metrics, bannedWords: () => [], now: () => ms,
   *         remote?: 어댑터 | () => 어댑터|null, autoFlush?: 쓰기 직후 바로 보내기, onSendError?: (문구) => void }
   */
  function createFeed(deps) {
    const store = deps.store;
    const profile = deps.profile;
    const now = deps.now || (() => Date.now());
    const banned = deps.bannedWords || (() => (SM.config && SM.config.bannedWords) || []);
    const planner = () => deps.planner || SM.planner;
    const metrics = () => deps.metrics || SM.metrics;

    const iso = () => new Date(now()).toISOString();
    let seq = 0;
    const newId = () => 'c' + now().toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);

    function me() { return profile ? profile() : null; }
    function myClass() { const p = me(); return p ? p.classId || classIdOf(p.sid) : null; }

    function loadFeed(classId) {
      const list = store.get(SM.keys.feed(classId), []);
      return Array.isArray(list) ? list : [];
    }
    function loadComments(classId) {
      const list = store.get(SM.keys.comments(classId), []);
      return Array.isArray(list) ? list : [];
    }

    // ---------- 원격: 보낼 목록 ----------

    const remote = () => (typeof deps.remote === 'function' ? deps.remote() : deps.remote) || null;
    const listKey = (classId, kind) => (kind === 'feed' ? SM.keys.feed(classId) : SM.keys.comments(classId));
    const loadKind = (classId, kind) => (kind === 'feed' ? loadFeed(classId) : loadComments(classId));
    const idOf = (kind, x) => (kind === 'feed' ? x.planKey : x.id);
    const itemClass = (kind, x) => classIdOf(kind === 'feed' ? x.sid : planOwner(x.planKey));
    function emit(key) { if (typeof store.emit === 'function') store.emit(key, { source: 'remote' }); }
    function loadOutbox() { const l = store.get(OUTBOX_KEY, []); return Array.isArray(l) ? l : []; }

    /** 반 공유 목록 저장. 원격이 켜져 있으면 바뀐 항목을 보낼 목록에 넣는다. */
    function saveList(classId, kind, next) {
      const before = remote() ? loadKind(classId, kind) : null;   // store.get은 매번 새로 읽으므로 고치기 전 값
      const ok = store.set(listKey(classId, kind), next);
      if (ok && before) queueDiff(classId, kind, before, next);
      return ok;
    }

    function queueDiff(classId, kind, before, after) {
      const prev = new Map(before.map((x) => [idOf(kind, x), x]));
      const ops = [];
      const kept = new Set();
      after.forEach((x) => {
        const id = idOf(kind, x);
        kept.add(id);
        const p = prev.get(id);
        if (!p || JSON.stringify(p) !== JSON.stringify(x)) ops.push({ op: 'put', id, item: x, prev: p || null });
      });
      prev.forEach((p, id) => { if (!kept.has(id)) ops.push({ op: 'delete', id, item: null, prev: p }); });
      if (!ops.length) return;
      const box = loadOutbox();
      ops.forEach((o) => {
        // 같은 항목의 앞선 작업은 마지막 것으로 합친다. 되돌릴 값(prev)은 처음 것을 유지.
        const at = box.findIndex((b) => b.classId === classId && b.kind === kind && b.id === o.id);
        const first = at === -1 ? null : box.splice(at, 1)[0];
        box.push({ opId: newId(), classId, kind, id: o.id, op: o.op, item: o.item, prev: first ? first.prev : o.prev, tries: 0, nextAt: 0 });
      });
      store.set(OUTBOX_KEY, box);
      if (deps.autoFlush) setTimeout(() => { flush().catch(() => {}); }, 0);
    }

    function changeOp(opId, patch) {
      const box = loadOutbox();
      const at = box.findIndex((b) => b.opId === opId);
      if (at === -1) return;
      if (patch === null) box.splice(at, 1); else Object.assign(box[at], patch);
      store.set(OUTBOX_KEY, box);
    }

    /** 서버가 거부한 쓰기: 사본을 보내기 전 값으로 되돌린다 */
    function rollback(op) {
      const list = loadKind(op.classId, op.kind);
      const at = list.findIndex((x) => idOf(op.kind, x) === op.id);
      if (op.prev) { if (at === -1) list.push(op.prev); else list[at] = op.prev; }
      else if (at !== -1) list.splice(at, 1);
      else return;
      store.set(listKey(op.classId, op.kind), list);
      emit(listKey(op.classId, op.kind));
    }

    let flushing = null;
    /** 보낼 목록을 순서대로 보낸다. opts.force면 다시 보내기 대기 시간을 무시(온라인이 됐을 때). */
    function flush(opts) {
      if (flushing) return flushing;
      flushing = doFlush(opts || {}).then((r) => { flushing = null; return r; }, (e) => { flushing = null; throw e; });
      return flushing;
    }
    async function doFlush(opts) {
      const r = { sent: 0, rejected: 0, offline: false, waiting: 0 };
      const api = remote();
      if (!api) return r;
      for (;;) {
        const op = loadOutbox().find((b) => opts.force || (b.nextAt || 0) <= now());
        if (!op) break;
        const path = SM.remote.pathOf(op.classId, op.kind, op.id);
        try {
          if (op.op === 'put') await api.put(path, op.item); else await api.delete(path);
          changeOp(op.opId, null);
          r.sent++;
        } catch (e) {
          if (e && e.permanent) {
            changeOp(op.opId, null);
            rollback(op);
            r.rejected++;
            if (typeof deps.onSendError === 'function') deps.onSendError('보내지 못했어: ' + ((e && e.message) || '서버가 받지 않았어'));
            continue;
          }
          const tries = (op.tries || 0) + 1;
          changeOp(op.opId, { tries, nextAt: now() + Math.min(2000 * Math.pow(2, tries - 1), MAX_RETRY_MS) });
          r.offline = !!(e && e.offline);
          break; // 연결 문제면 뒤의 작업도 실패할 것이므로 다음 기회에
        }
      }
      r.waiting = loadOutbox().length;
      return r;
    }

    /** 내 반의 바뀐 항목을 받아 사본에 넣는다. 아직 보내지 않은 내 작업이 있는 항목은 내 쪽을 우선한다. */
    async function pull() {
      const r = { received: 0 };
      const api = remote();
      const p = me();
      if (!api || !p) return r;
      const classId = myClass();
      const state = store.get(SYNC_KEY(classId), null) || {};
      const since = Object.assign({}, state.since);
      const firstTime = !since.comments;
      const pending = new Set(loadOutbox().filter((b) => b.classId === classId).map((b) => b.kind + '|' + b.id));
      const arrived = [];
      for (const kind of SM.remote.KINDS) {
        const res = await api.list(SM.remote.pathOf(classId, kind), { since: since[kind] || null });
        const list = loadKind(classId, kind);
        let changed = false;
        (res.items || []).forEach((it) => {
          if (!it || pending.has(kind + '|' + it.id)) return;
          const at = list.findIndex((x) => idOf(kind, x) === it.id);
          if (it.deleted || !it.data) {
            if (at !== -1) { list.splice(at, 1); changed = true; r.received++; }
            return;
          }
          if (idOf(kind, it.data) !== it.id || itemClass(kind, it.data) !== classId) return; // 모양이 다르거나 다른 반
          if (at === -1) {
            list.push(it.data);
            if (kind === 'comments' && !firstTime) arrived.push(it.data);
          } else if (JSON.stringify(list[at]) !== JSON.stringify(it.data)) {
            list[at] = it.data;
          } else return;
          changed = true;
          r.received++;
        });
        if (changed) { store.set(listKey(classId, kind), list); emit(listKey(classId, kind)); }
        if (res.serverTime) since[kind] = res.serverTime;
      }
      store.set(SYNC_KEY(classId), Object.assign(store.get(SYNC_KEY(classId), null) || {}, { since }));
      // 다른 기기에서 내 계획에 달린 새 댓글 → 챗봇 알림
      arrived
        .filter((c) => !c.reaction && !c.hidden && c.author !== p.sid && planOwner(c.planKey) === p.sid)
        .forEach((c) => { if (typeof deps.notify === 'function') { try { deps.notify(c, p.sid); } catch (e) { /* 무시 */ } } });
      return r;
    }

    /** 보내기 → 받기. 연결이 안 되면 { offline: true }. 원격이 꺼져 있으면 { enabled: false } */
    async function sync(opts) {
      if (!remote()) return { enabled: false };
      const out = { enabled: true, sent: 0, rejected: 0, received: 0, offline: false };
      try {
        const f = await flush(opts);
        out.sent = f.sent; out.rejected = f.rejected; out.offline = f.offline;
        out.received = (await pull()).received;
      } catch (e) {
        if (e && e.permanent) out.error = e.message; else out.offline = true;
      }
      out.pending = loadOutbox().length;
      return out;
    }

    function pendingCount() { return loadOutbox().length; }

    /** 같은 기기에 있던 내 스냅샷·댓글·반응을 원격으로 한 번 올린다. 같은 id로 보내므로 여러 번 해도 중복이 없다. */
    async function migrateToRemote() {
      const api = remote();
      const p = me();
      if (!api || !p) return { ok: false, error: '반 서버가 설정되지 않았어.' };
      const classId = myClass();
      const items = ownItems(loadFeed(classId), p.sid).map((x) => ['feed', x])
        .concat(ownItems(loadComments(classId), p.sid).map((x) => ['comments', x]));
      const r = { ok: true, total: items.length, created: 0, existing: 0 };
      for (const pair of items) {
        try {
          const res = await api.put(SM.remote.pathOf(classId, pair[0], idOf(pair[0], pair[1])), pair[1]);
          if (res && res.created) r.created++; else r.existing++;
        } catch (e) {
          return Object.assign(r, { ok: false, offline: !!(e && e.offline), error: e && e.offline ? '인터넷에 연결되면 다시 해 줘.' : '보내지 못했어: ' + ((e && e.message) || '') });
        }
      }
      const state = store.get(SYNC_KEY(classId), null) || {};
      state.migrated = Object.assign({}, state.migrated, { [p.sid]: iso() });
      store.set(SYNC_KEY(classId), state);
      return r;
    }

    function migratedAt() {
      const p = me();
      if (!p) return null;
      const st = store.get(SYNC_KEY(myClass()), null);
      return (st && st.migrated && st.migrated[p.sid]) || null;
    }

    // ---------- 스냅샷 ----------

    /** 공개된 주간 계획 → 스냅샷(비공개면 null) */
    function buildSnapshot(isoWeek) {
      const p = me();
      if (!p) return null;
      const P = planner();
      const week = P.normalizeWeek(P.getWeek(isoWeek));
      if (!week.public) return null;
      const month = P.load(P.monthKeyForWeek(isoWeek)).month;

      const strategies = {};
      Object.keys(week.strategies).forEach((s) => {
        const ids = (week.strategies[s] || []).filter(Boolean);
        if (ids.length) strategies[s] = ids.slice();
      });
      const snap = {
        planKey: `${p.sid}:${isoWeek}`,
        sid: p.sid,
        nickname: p.nickname,
        week: isoWeek,
        goals: week.goals.filter((g) => g.text.trim()).map((g) => ({ subject: g.subject, text: g.text.trim() })),
        strategies,
        weekFocus: String((month.weekFocus && month.weekFocus[isoWeek]) || '').trim()
      };
      if (week.publicRate) {
        const r = metrics().week(isoWeek).total.strategyRate;
        if (r !== null && r !== undefined) snap.rate = r;
      }
      if (month.public) {
        const mg = (month.goals || []).map((g) => String(g || '').trim()).filter(Boolean);
        if (mg.length) snap.monthGoals = mg;
      }
      return snap;
    }

    /** 공개 스냅샷 추가/갱신. 내용이 같으면 updatedAt을 바꾸지 않는다. 비공개면 지운다. */
    function publishWeek(isoWeek) {
      const p = me();
      if (!p) return null;
      const snap = buildSnapshot(isoWeek);
      if (!snap) { unpublishWeek(isoWeek); return null; }
      const classId = myClass();
      const list = loadFeed(classId);
      const at = list.findIndex((x) => x.planKey === snap.planKey);
      if (at !== -1 && sameContent(list[at], snap)) return list[at];
      snap.updatedAt = iso();
      if (at !== -1) list[at] = snap; else list.push(snap);
      saveList(classId, 'feed', list);
      return snap;
    }

    /** 스냅샷 삭제. 댓글은 그대로 두고 다시 공개하면 다시 보인다. */
    function unpublishWeek(isoWeek) {
      const p = me();
      if (!p) return false;
      const classId = myClass();
      const key = `${p.sid}:${isoWeek}`;
      const list = loadFeed(classId);
      const next = list.filter((x) => x.planKey !== key);
      if (next.length === list.length) return false;
      saveList(classId, 'feed', next);
      return true;
    }

    /** 주간 저장 뒤 부르기: 공개면 갱신, 아니면 삭제 */
    function syncWeek(isoWeek) {
      return publishWeek(isoWeek);
    }

    /** 월간 저장 뒤 부르기: 그 달(월요일 기준)에 속한 내 공개 주를 갱신 */
    function syncMonth(monthKey) {
      const p = me();
      if (!p) return 0;
      const P = planner();
      const mine = loadFeed(myClass()).filter((x) => x.sid === p.sid && P.monthKeyForWeek(x.week) === monthKey);
      mine.forEach((x) => publishWeek(x.week));
      return mine.length;
    }

    /** 내 반 피드(최신순 고정). filter: { subject, strategy } */
    function list(filter) {
      const classId = myClass();
      if (!classId) return [];
      const f = filter || {};
      return loadFeed(classId)
        .filter((x) => x && classIdOf(x.sid) === classId)     // 다른 반 데이터가 섞여 들어와도 보이지 않게
        .filter((x) => !f.subject || (x.goals || []).some((g) => g.subject === f.subject) || Object.prototype.hasOwnProperty.call(x.strategies || {}, f.subject))
        .filter((x) => !f.strategy || Object.keys(x.strategies || {}).some((s) => (x.strategies[s] || []).indexOf(f.strategy) !== -1))
        .slice()
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : (a.planKey < b.planKey ? -1 : 1)));
    }

    function snapshotOf(planKey) {
      // 화면 목록과 같은 기준(같은 반)으로만 찾는다
      return list({}).find((x) => x.planKey === planKey) || null;
    }

    // ---------- 댓글·반응 ----------

    /**
     * 보는 사람 기준 댓글 목록(오래된 순). 숨긴 댓글은 작성자 본인과 계획 작성자에게만 { hidden: true }로 보인다.
     */
    function comments(planKey) {
      const p = me();
      if (!p) return [];
      const owner = planOwner(planKey);
      const pending = remote() ? new Set(loadOutbox().filter((b) => b.kind === 'comments').map((b) => b.id)) : null;
      return loadComments(myClass())
        .filter((c) => c.planKey === planKey && !c.reaction)
        .filter((c) => !c.hidden || c.author === p.sid || owner === p.sid)
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
        .map((c) => Object.assign({}, c, { mine: c.author === p.sid, canHide: owner === p.sid, pending: !!(pending && pending.has(c.id)) }));
    }

    /** 카드에 쓸 수: 숨기지 않은 댓글 수, 반응별 수, 내가 누른 반응 */
    function counts(planKey) {
      const p = me();
      const all = loadComments(myClass()).filter((c) => c.planKey === planKey);
      const reactions = {}; const mine = {};
      REACTION_IDS.forEach((r) => { reactions[r] = 0; mine[r] = false; });
      all.forEach((c) => {
        if (c.reaction && reactions[c.reaction] !== undefined) {
          reactions[c.reaction] += 1;
          if (p && c.author === p.sid) mine[c.reaction] = true;
        }
      });
      return { comments: all.filter((c) => !c.reaction && !c.hidden).length, reactions, mine };
    }

    function addComment(planKey, text) {
      const p = me();
      if (!p) return { ok: false, error: '먼저 입장해 줘.' };
      if (!snapshotOf(planKey)) return { ok: false, error: '이 계획은 지금 볼 수 없어.' };
      const chk = checkText(text, banned());
      if (!chk.ok) return chk;
      const c = { id: newId(), planKey, author: p.sid, nickname: p.nickname, text: chk.value, reaction: null, hidden: false, createdAt: iso(), editedAt: null };
      const listC = loadComments(myClass());
      listC.push(c);
      saveList(myClass(), 'comments', listC);
      // 계획 주인의 챗봇 기록에 짧게 남긴다
      const owner = planOwner(planKey);
      if (owner && owner !== p.sid && typeof deps.notify === 'function') {
        try { deps.notify(c, owner); } catch (e) { /* 알림 실패는 무시 */ }
      }
      return { ok: true, comment: c };
    }

    function editComment(id, text) {
      const p = me();
      const listC = loadComments(myClass());
      const c = listC.find((x) => x.id === id);
      if (!p || !c || c.reaction) return { ok: false, error: '댓글을 찾을 수 없어.' };
      if (c.author !== p.sid) return { ok: false, error: '내 댓글만 고칠 수 있어.' };
      const chk = checkText(text, banned());
      if (!chk.ok) return chk;
      c.text = chk.value;
      c.editedAt = iso();
      saveList(myClass(), 'comments', listC);
      return { ok: true, comment: c };
    }

    function deleteComment(id) {
      const p = me();
      const listC = loadComments(myClass());
      const c = listC.find((x) => x.id === id);
      if (!p || !c) return { ok: false, error: '댓글을 찾을 수 없어.' };
      if (c.author !== p.sid) return { ok: false, error: '내 댓글만 지울 수 있어.' };
      saveList(myClass(), 'comments', listC.filter((x) => x.id !== id));
      return { ok: true };
    }

    /** 계획 작성자만 자기 계획의 댓글을 숨기거나 다시 보이게 할 수 있다 */
    function setHidden(id, hidden) {
      const p = me();
      const listC = loadComments(myClass());
      const c = listC.find((x) => x.id === id);
      if (!p || !c) return { ok: false, error: '댓글을 찾을 수 없어.' };
      if (planOwner(c.planKey) !== p.sid) return { ok: false, error: '내 계획에 달린 댓글만 숨길 수 있어.' };
      c.hidden = !!hidden;
      saveList(myClass(), 'comments', listC);
      return { ok: true, comment: c };
    }

    /** 빠른 반응: 같은 사람이 같은 반응을 다시 누르면 취소 → { ok, on } */
    function react(planKey, type) {
      const p = me();
      if (!p) return { ok: false, error: '먼저 입장해 줘.' };
      if (REACTION_IDS.indexOf(type) === -1) return { ok: false, error: '알 수 없는 반응이야.' };
      if (!snapshotOf(planKey)) return { ok: false, error: '이 계획은 지금 볼 수 없어.' };
      const listC = loadComments(myClass());
      const at = listC.findIndex((c) => c.planKey === planKey && c.author === p.sid && c.reaction === type);
      if (at !== -1) {
        listC.splice(at, 1);
        saveList(myClass(), 'comments', listC);
        return { ok: true, on: false };
      }
      // 반응 id는 (계획·사람·반응)으로 고정 → 두 기기에서 눌러도 하나
      listC.push({ id: `r:${planKey}:${p.sid}:${type}`, planKey, author: p.sid, nickname: p.nickname, text: '', reaction: type, hidden: false, createdAt: iso(), editedAt: null });
      saveList(myClass(), 'comments', listC);
      return { ok: true, on: true };
    }

    // ---------- 읽음 ----------

    function seenOf(sid) {
      return Object.assign({ seenAt: null, noticeClosed: false }, store.get(SM.keys.feedSeen(sid), null) || {});
    }

    /** 내 계획에 마지막으로 피드를 본 뒤 달린 새 댓글 수(반응·내 댓글·숨긴 댓글 제외) */
    // ---------- 설정·백업용(학생 한 명의 반 공유 데이터) ----------

    /** 내 스냅샷·댓글의 닉네임 바꾸기 → 바꾼 개수 */
    function renameAuthor(sid, nickname) {
      const classId = classIdOf(sid);
      if (!classId) return 0;
      let n = 0;
      const f = loadFeed(classId).map((x) => (x.sid === sid && x.nickname !== nickname ? (n++, Object.assign({}, x, { nickname })) : x));
      const c = loadComments(classId).map((x) => (x.author === sid && x.nickname !== nickname ? (n++, Object.assign({}, x, { nickname })) : x));
      if (n) { saveList(classId, 'feed', f); saveList(classId, 'comments', c); }
      return n;
    }

    /** 내 스냅샷·내 댓글(반응 포함)만 지운다. 다른 친구 것은 그대로. → { snapshots, comments } */
    function removeAllOf(sid) {
      const classId = classIdOf(sid);
      if (!classId) return { snapshots: 0, comments: 0 };
      const f = loadFeed(classId);
      const c = loadComments(classId);
      const f2 = f.filter((x) => x.sid !== sid);
      const c2 = c.filter((x) => x.author !== sid);
      if (f2.length !== f.length) saveList(classId, 'feed', f2);
      if (c2.length !== c.length) saveList(classId, 'comments', c2);
      return { snapshots: f.length - f2.length, comments: c.length - c2.length };
    }

    /** 백업에서 내 것만 되돌린다. overwrite면 같은 항목을 바꾸고, 아니면 없는 것만 더한다. */
    function importOwn(sid, items, overwrite) {
      const classId = classIdOf(sid);
      const r = { added: 0, overwritten: 0, skipped: 0 };
      if (!classId) return r;
      const merge = (kind, list, incoming, idOf) => {
        let changed = false;
        ownItems(incoming, sid).forEach((item) => {
          const at = list.findIndex((x) => idOf(x) === idOf(item));
          if (at === -1) { list.push(item); r.added++; changed = true; }
          else if (overwrite) { list[at] = item; r.overwritten++; changed = true; }
          else r.skipped++;
        });
        if (changed) saveList(classId, kind, list);
      };
      merge('feed', loadFeed(classId), (items && items.feed) || [], (x) => x.planKey);
      merge('comments', loadComments(classId), (items && items.comments) || [], (x) => x.id);
      return r;
    }

    function unreadList(sid) {
      const classId = classIdOf(sid);
      if (!classId) return [];
      const seen = seenOf(sid).seenAt;
      return loadComments(classId).filter((c) =>
        planOwner(c.planKey) === sid && c.author !== sid && !c.reaction && !c.hidden && (!seen || c.createdAt > seen));
    }
    function unreadFor(sid) { return unreadList(sid).length; }

    /** 새 댓글을 단 친구 닉네임(최근 순, 중복 없이) */
    function unreadFrom(sid) {
      const out = [];
      unreadList(sid).slice().reverse().forEach((c) => { if (out.indexOf(c.nickname) === -1) out.push(c.nickname); });
      return out;
    }

    function markSeen() {
      const p = me();
      if (!p) return;
      store.set(SM.keys.feedSeen(p.sid), Object.assign(seenOf(p.sid), { seenAt: iso() }));
    }

    function noticeClosed() { const p = me(); return p ? seenOf(p.sid).noticeClosed : true; }
    function closeNotice() {
      const p = me();
      if (p) store.set(SM.keys.feedSeen(p.sid), Object.assign(seenOf(p.sid), { noticeClosed: true }));
    }

    return {
      publishWeek, unpublishWeek, syncWeek, syncMonth, buildSnapshot, list, snapshotOf,
      comments, counts, addComment, editComment, deleteComment, setHidden, react,
      unreadFor, unreadFrom, markSeen, noticeClosed, closeNotice,
      renameAuthor, removeAllOf, importOwn,
      sync, flush, pull, pendingCount, migrateToRemote, migratedAt
    };
  }

  /** 반 공유 목록에서 그 학생 것만(스냅샷 sid, 댓글 author) */
  function ownItems(list, sid) {
    return (Array.isArray(list) ? list : []).filter((x) => x && (x.author !== undefined ? x.author === sid : x.sid === sid));
  }

  SM.feed = Object.assign(createFeed({
    store: SM.store,
    profile: () => (SM.auth ? SM.auth.current() : null),
    // 계획 주인의 챗봇 기록에 '○○가 네 계획에 댓글을 남겼어.'
    notify: (comment, sid) => {
      if (SM.chat && typeof SM.chat.notify === 'function') SM.chat.notify(SM.chat.josa(comment.nickname, '이', '가') + ' 네 계획에 댓글을 남겼어.', { sid });
    },
    remote: () => (SM.remote ? SM.remote.adapter() : null),
    autoFlush: true,
    onSendError: (msg) => { if (SM.ui && SM.ui.toast) SM.ui.toast(msg, 4000); }
  }), { weekLabel, checkText, classIdOf, planOwner, ownItems, REACTIONS, MAX_TEXT, POLL_MS });
  SM.createFeed = createFeed;

  /** 원격이 켜져 있을 때: 시작·온라인 복귀·우리 반 화면 진입 때 동기화, 우리 반 화면에서는 30초마다 */
  function startAutoSync() {
    if (typeof document === 'undefined' || typeof window.addEventListener !== 'function' || window.SM_NO_AUTOSTART) return;
    const onClass = () => /^#\/class/.test(location.hash || '');
    const on = () => !!(SM.remote && SM.remote.enabled() && SM.auth && SM.auth.current());
    const run = (opts) => { if (on()) SM.feed.sync(opts).catch(() => {}); };
    window.addEventListener('online', () => run({ force: true }));
    window.addEventListener('load', () => run());
    window.addEventListener('hashchange', () => { if (on() && (onClass() || SM.feed.pendingCount())) run(); });
    setInterval(() => {
      if (document.visibilityState === 'hidden' || !on()) return;
      if (onClass()) run();
      else if (SM.feed.pendingCount()) SM.feed.flush().catch(() => {});
    }, POLL_MS);
  }
  startAutoSync();
})(window.SM = window.SM || {});

// ---------- #/class 우리 반 ----------
(function (SM) {
  'use strict';

  // 학생별로 따로 둔다(같은 기기를 여러 학생이 쓰므로 다른 친구에게 보이면 안 된다)
  const draftsBySid = {};  // sid → { planKey → 쓰던 댓글 }
  const openBySid = {};    // sid → { planKey → 댓글 펼침 }

  function strategyName(id) {
    const s = SM.data.strategies.find((x) => x.id === id);
    return s ? s.name : id;
  }
  const tagText = (id) => '#' + strategyName(id).replace(/[\s·]/g, '');

  function latestResult(sid) {
    const list = SM.store.get(SM.keys.results(sid), []) || [];
    return list.length ? list[list.length - 1] : null;
  }

  /** 전략 설명 시트(10단계 카드 재사용) + 내 플래너에 추가 */
  function openStrategySheet(subject, id) {
    const el = SM.ui.el;
    const p = SM.auth.current();
    const prevFocus = document.activeElement;
    const backdrop = el('div', { class: 'modal-backdrop' });
    function close() {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        const f = backdrop.querySelectorAll('button, a[href], summary');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    const card = SM.strategyView.card(latestResult(p.sid), subject, id, {
      actions: el('div', { class: 'row' },
        el('button', {
          type: 'button', class: 'btn btn-primary', text: `내 플래너에 추가 (${subject})`,
          onClick() {
            const r = SM.planner.addWeeklyStrategy(subject, id) || {};
            SM.ui.toast(r.exists ? '이미 이번 주 플래너에 있어.' : r.full ? `이번 주 ${subject} 전략이 벌써 2개야. 주간 플래너에서 바꿔 줘.` : '이번 주 플래너에 넣었어.');
            if (r.added || r.exists) close();
          }
        }),
        el('button', { type: 'button', class: 'btn', text: '닫기', onClick: close })
      )
    });
    const box = el('div', { class: 'modal sheet sheet-scroll', role: 'dialog', 'aria-modal': 'true', 'aria-label': strategyName(id) }, card);
    backdrop.appendChild(box);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    const first = box.querySelector('button');
    if (first) first.focus();
  }

  function classScreen() {
    const el = SM.ui.el;
    const p = SM.auth.current();
    const F = SM.feed;
    const drafts = draftsBySid[p.sid] = draftsBySid[p.sid] || {};
    const openComments = openBySid[p.sid] = openBySid[p.sid] || {};
    const filter = { subject: null, strategy: null };
    // 카드가 많으면(1년치 30명 × 20주 = 600장) 한 번에 다 그리지 않고 최신 PAGE장씩
    const PAGE = 20;
    let shown = PAGE;
    let filterSig = '';
    const root = el('section', { class: 'stack feed' }, el('h2', { text: '우리 반' }));
    const filterBox = el('div', { class: 'stack' });
    const listBox = el('div', { class: 'stack', 'aria-live': 'polite' });

    // 피드를 열면 읽음 처리(19단계 챗봇 알림 기준)
    const unreadBefore = F.unreadFor(p.sid);
    F.markSeen();

    if (!F.noticeClosed()) {
      const notice = el('div', { class: 'card row notice' },
        el('p', { class: 'grow', text: SM.remote && SM.remote.enabled()
          ? '우리 반 친구들의 계획이 반 서버로 모여요. 인터넷이 끊겨도 쓴 댓글은 연결되면 보내져요.'
          : '지금은 이 기기에서 입장한 친구들의 계획만 보여요.' }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: '닫기', 'aria-label': '안내 닫기', onClick() { F.closeNotice(); notice.remove(); } }));
      root.appendChild(notice);
    }
    if (unreadBefore) root.appendChild(el('p', { class: 'muted', text: `내 계획에 새 댓글 ${unreadBefore}개가 달렸어.` }));

    function renderFilters(all) {
      SM.ui.clear(filterBox);
      const subjects = [];
      const strategies = [];
      all.forEach((x) => {
        (x.goals || []).forEach((g) => { if (subjects.indexOf(g.subject) === -1) subjects.push(g.subject); });
        Object.keys(x.strategies || {}).forEach((s) => {
          if (subjects.indexOf(s) === -1) subjects.push(s);
          x.strategies[s].forEach((id) => { if (strategies.indexOf(id) === -1) strategies.push(id); });
        });
      });
      if (!subjects.length && !strategies.length) return;
      const chip = (label, on, onClick) => el('button', { type: 'button', class: 'chip' + (on ? ' chip-on' : ''), 'aria-pressed': String(on), text: label, onClick });
      filterBox.append(
        el('div', { class: 'chip-row', role: 'group', 'aria-label': '과목 필터' },
          chip('전체 과목', !filter.subject, () => { filter.subject = null; render(); }),
          subjects.map((s) => chip(s, filter.subject === s, () => { filter.subject = filter.subject === s ? null : s; render(); }))),
        el('div', { class: 'row' },
          el('label', { for: 'feed-strategy', text: '전략 태그' }),
          (() => {
            const sel = el('select', {
              id: 'feed-strategy',
              onChange(e) { filter.strategy = e.target.value || null; render(); }
            }, el('option', { value: '', text: '전체' }), strategies.map((id) => el('option', { value: id, text: tagText(id) })));
            sel.value = filter.strategy || '';
            return sel;
          })())
      );
    }

    function commentItem(c, snap) {
      if (c.hidden && !c.mine && !c.canHide) return null;
      const meta = el('span', { class: 'muted small-meta', text: `${c.nickname} · ${c.createdAt.slice(5, 10).replace('-', '/')}${c.editedAt ? ' · 수정됨' : ''}${c.pending ? ' · 보내는 중' : ''}` });
      const li = el('li', { class: 'comment' + (c.hidden ? ' comment-hidden' : '') });
      if (c.hidden) li.appendChild(el('p', { class: 'muted', text: '숨겨진 댓글' }));
      li.append(el('p', { class: 'comment-text', text: c.text }), meta);
      const tools = el('div', { class: 'row' });
      if (c.mine) {
        tools.append(
          el('button', {
            type: 'button', class: 'btn btn-ghost', text: '수정',
            onClick() {
              const ta = el('textarea', { rows: 2, maxlength: SM.feed.MAX_TEXT, 'aria-label': '댓글 고치기' });
              ta.value = c.text;
              const err = el('p', { class: 'field-error', role: 'alert' });
              const form = el('div', { class: 'stack' }, ta, err, el('div', { class: 'row' },
                el('button', {
                  type: 'button', class: 'btn btn-primary', text: '저장',
                  onClick() { const r = SM.feed.editComment(c.id, ta.value); if (!r.ok) { err.textContent = r.error; return; } render(); }
                }),
                el('button', { type: 'button', class: 'btn', text: '취소', onClick: render })));
              li.replaceWith(form);
              ta.focus();
            }
          }),
          el('button', {
            type: 'button', class: 'btn btn-ghost', text: '삭제',
            async onClick() {
              const ok = await SM.ui.confirmDialog('이 댓글을 지울까?', { okText: '지우기', cancelText: '그대로 두기' });
              if (!ok) return;
              SM.feed.deleteComment(c.id); render();
            }
          }));
      }
      if (c.canHide) {
        tools.appendChild(el('button', {
          type: 'button', class: 'btn btn-ghost', text: c.hidden ? '다시 보이기' : '숨기기',
          onClick() { SM.feed.setHidden(c.id, !c.hidden); render(); }
        }));
      }
      if (tools.childNodes.length) li.appendChild(tools);
      return li;
    }

    function card(x) {
      const counts = F.counts(x.planKey);
      const isMine = x.sid === p.sid;
      const cid = 'cm-' + x.planKey.replace(/[^A-Za-z0-9]/g, '_');
      const tags = [];
      Object.keys(x.strategies || {}).forEach((s) => x.strategies[s].forEach((id) => tags.push({ s, id })));

      const commentsBox = el('div', { class: 'stack', id: cid });
      if (openComments[x.planKey]) {
        const list = F.comments(x.planKey);
        const ta = el('textarea', {
          rows: 2, maxlength: SM.feed.MAX_TEXT, id: cid + '-ta', placeholder: '응원이나 질문을 남겨 줘',
          onInput(e) { drafts[x.planKey] = e.target.value; left.textContent = `${SM.feed.MAX_TEXT - Array.from(e.target.value).length}자 남음`; err.textContent = ''; }
        });
        ta.value = drafts[x.planKey] || '';
        const left = el('span', { class: 'muted', 'aria-live': 'polite', text: `${SM.feed.MAX_TEXT - Array.from(ta.value).length}자 남음` });
        const err = el('p', { class: 'field-error', role: 'alert' });
        commentsBox.append(
          list.length ? el('ul', { class: 'comment-list' }, list.map((c) => commentItem(c, x))) : el('p', { class: 'muted', text: '아직 댓글이 없어.' }),
          el('form', {
            class: 'stack',
            onSubmit(e) {
              e.preventDefault();
              const chk = SM.feed.checkText(ta.value, SM.config.bannedWords);
              if (!chk.ok) { err.textContent = chk.error; ta.focus(); return; }
              const r = F.addComment(x.planKey, ta.value);
              if (!r.ok) { err.textContent = r.error; return; }
              drafts[x.planKey] = '';
              render();
              const again = document.getElementById(cid + '-ta'); if (again) again.focus();
            }
          },
            el('label', { for: cid + '-ta', class: 'visually-hidden', text: '댓글' }),
            ta,
            el('div', { class: 'row' }, left, el('button', { type: 'submit', class: 'btn btn-primary', text: '댓글 달기' })),
            err)
        );
      }

      return el('article', { class: 'card stack feed-card' },
        el('div', { class: 'row' },
          el('strong', { class: 'grow', text: x.nickname }),
          isMine ? el('span', { class: 'tag', text: '내 계획' }) : null,
          el('span', { class: 'muted', text: SM.feed.weekLabel(x.week) })),
        x.weekFocus ? el('p', { text: `이번 주 초점: ${x.weekFocus}` }) : null,
        (x.goals || []).length ? el('ul', { class: 'feed-goals' }, x.goals.map((g) => el('li', null, el('strong', { text: g.subject + ' ' }), g.text))) : null,
        x.monthGoals ? el('p', { class: 'muted', text: `이달 목표: ${x.monthGoals.join(' / ')}` }) : null,
        tags.length ? el('div', { class: 'chip-row', 'aria-label': '전략 태그' }, tags.map((t) => el('button', {
          type: 'button', class: 'chip chip-tag', text: `${t.s} ${tagText(t.id)}`, 'aria-label': `${t.s} ${strategyName(t.id)} 설명 보기`,
          onClick: () => openStrategySheet(t.s, t.id)
        }))) : null,
        typeof x.rate === 'number' ? el('p', { text: `이번 주 전략 실천률 ${SM.metrics.pct(x.rate)}` }) : null,
        el('div', { class: 'chip-row', role: 'group', 'aria-label': '빠른 반응' }, SM.feed.REACTIONS.map(([id, label]) => el('button', {
          type: 'button', class: 'chip' + (counts.mine[id] ? ' chip-on' : ''), 'aria-pressed': String(counts.mine[id]),
          'data-react': x.planKey + '|' + id,
          text: `${label} ${counts.reactions[id]}`,
          onClick() {
            const r = F.react(x.planKey, id);
            if (!r.ok) { SM.ui.toast(r.error); return; }
            render();
            const b = listBox.querySelector(`[data-react="${CSS && CSS.escape ? CSS.escape(x.planKey + '|' + id) : x.planKey + '|' + id}"]`);
            if (b) b.focus();
          }
        }))),
        el('button', {
          type: 'button', class: 'btn btn-ghost', 'aria-expanded': String(!!openComments[x.planKey]), 'aria-controls': cid,
          text: `댓글 ${counts.comments}개 ${openComments[x.planKey] ? '접기' : '보기'}`,
          onClick() { openComments[x.planKey] = !openComments[x.planKey]; render(); }
        }),
        commentsBox
      );
    }

    function render() {
      const all = F.list({});
      renderFilters(all);
      const items = F.list(filter);
      SM.ui.clear(listBox);
      if (!all.length) {
        listBox.appendChild(el('div', { class: 'card stack' },
          el('p', { text: '아직 공개된 계획이 없어. 주간 플래너에서 공개를 켜면 여기에 보여.' }),
          el('a', { href: '#/planner/week', class: 'btn', text: '주간 플래너로 가기' })));
        return;
      }
      if (!items.length) { listBox.appendChild(el('p', { class: 'muted', text: '조건에 맞는 계획이 없어.' })); return; }
      const sig = JSON.stringify(filter);
      if (sig !== filterSig) { filterSig = sig; shown = PAGE; }
      items.slice(0, shown).forEach((x) => listBox.appendChild(card(x)));
      if (items.length > shown) {
        const rest = items.length - shown;
        listBox.appendChild(el('button', {
          type: 'button', class: 'btn', text: `더 보기 (${Math.min(PAGE, rest)}개 더 · 남은 ${rest}개)`,
          onClick() {
            const first = shown;
            shown += PAGE;
            render();
            // 새로 나온 첫 카드로 포커스(키보드 사용자)
            const next = listBox.children[first];
            if (next) { next.setAttribute('tabindex', '-1'); next.focus(); }
          }
        }));
      }
    }

    // 내 공개 계획의 실천률 등 최신 값으로(내용이 같으면 순서는 그대로)
    F.list({}).filter((x) => x.sid === p.sid).forEach((x) => F.syncWeek(x.week));

    render();
    root.append(
      el('p', { class: 'muted', text: '친구들이 공개한 주간 계획이야. 최신순으로 보여.' }),
      filterBox, listBox);

    // 다른 탭에서 피드·댓글이 바뀌면 다시 그린다(쓰던 댓글은 drafts에 남아 있다)
    const classId = p.classId || SM.feed.classIdOf(p.sid);
    const off = SM.store.onChange((key) => {
      if (key === null || key === SM.keys.feed(classId) || key === SM.keys.comments(classId)) render();
    });

    return { node: root, cleanup() { off(); } };
  }

  if (typeof SM.route === 'function') {
    SM.route('#/class', { title: '우리 반', tab: 'class', render: classScreen });
  }
})(window.SM = window.SM || {});
