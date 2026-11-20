(function (SM) {
  'use strict';

  const KB = 1024;
  const LIMIT_BYTES = 5 * KB * KB;   // 브라우저 localStorage는 보통 약 5MB
  const WARN_BYTES = 4 * KB * KB;
  const BACKUP_STALE_DAYS = 30;

  // ---------- 순수 함수(테스트 대상) ----------

  /** 챗봇 이름 검사 → { ok, value } | { ok:false, error }. 빈 값이면 기본 이름으로 돌아간다. */
  function checkBotName(text) {
    const v = String(text || '').trim();
    if (!v) return { ok: true, value: '' };
    const max = (SM.chat && SM.chat.BOT_NAME_MAX) || 12;
    if (v.length > max) return { ok: false, error: `${max}자까지 쓸 수 있어.` };
    if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, error: '쓸 수 없는 글자가 있어.' };
    const norm = v.replace(/\s+/g, '').toLowerCase();
    if (((SM.config && SM.config.bannedWords) || []).some((w) => norm.indexOf(String(w).toLowerCase()) !== -1)) {
      return { ok: false, error: '쓸 수 없는 말이 들어 있어.' };
    }
    return { ok: true, value: v };
  }

  /** 'study-mate-하늘-2026-11-13.json' (파일 이름에 못 쓰는 글자는 '_') */
  function backupFileName(nickname, today) {
    const safe = String(nickname || '나').replace(/[\\/:*?"<>|\s\u0000-\u001f]+/g, '_');
    return `study-mate-${safe}-${today}.json`;
  }

  /** 12345 → '13 KB / 약 5MB' */
  function formatUsage(bytes) {
    const kb = Math.ceil((bytes || 0) / KB);
    return `${kb.toLocaleString('ko-KR')} KB / 약 5MB`;
  }

  function usageWarn(bytes) { return (bytes || 0) > WARN_BYTES; }

  /** 마지막 백업 뒤 지난 날 수(백업한 적 없으면 null) */
  function backupAgeDays(lastIso, today) {
    if (!lastIso) return null;
    return SM.date.daysBetween(String(lastIso).slice(0, 10), today);
  }

  function ownerOf(key) { return String(key).split(':')[1]; }

  /**
   * 백업 만들기. 개인 키는 전부, 반 공유 키(피드·댓글)는 내 것만 담는다.
   * deps: { store }
   */
  function buildBackup(deps, sid) {
    const out = deps.store.exportAll(sid);
    const classId = SM.storeUtil.classIdOf(sid);
    Object.keys(out.data).forEach((k) => {
      if (ownerOf(k) === classId) out.data[k] = SM.feed.ownItems(out.data[k], sid);
    });
    return out;
  }

  /** 백업 파일 읽기 → { ok, obj, count, exportedAt } | { ok:false, error } */
  function previewBackup(json, sid, schema) {
    let obj = json;
    if (typeof json === 'string') {
      try { obj = JSON.parse(json); } catch (e) { return { ok: false, error: '백업 파일을 읽을 수 없어요.' }; }
    }
    if (!obj || typeof obj !== 'object' || !obj.data || typeof obj.data !== 'object') {
      return { ok: false, error: '공부 메이트 백업 파일이 아니에요.' };
    }
    if (obj.version !== (schema || SM.store.SCHEMA)) return { ok: false, error: '지원하지 않는 백업 버전이에요: ' + obj.version };
    if (obj.sid !== sid) return { ok: false, error: '지금 입장한 학생의 백업이 아니에요.' };
    return { ok: true, obj, count: Object.keys(obj.data).length, exportedAt: obj.exportedAt || null };
  }

  /**
   * 백업 되돌리기. overwrite=false면 없는 것만 더한다.
   * deps: { store, feed } → { added, overwritten, skipped, failed }
   */
  function restoreBackup(deps, obj, sid, overwrite) {
    const classId = SM.storeUtil.classIdOf(sid);
    const personal = {};
    const shared = {};
    Object.keys(obj.data).forEach((k) => {
      const owner = ownerOf(k);
      if (owner === sid) personal[k] = obj.data[k];
      else if (owner === classId) shared[k.split(':')[0]] = obj.data[k];
    });
    const r = deps.store.importAll({ version: obj.version, sid, data: personal }, { overwrite: !!overwrite });
    const s = deps.feed.importOwn(sid, { feed: shared.feed, comments: shared.comments }, !!overwrite);
    return { added: r.added + s.added, overwritten: r.overwritten + s.overwritten, skipped: r.skipped + s.skipped, failed: r.failed };
  }

  /**
   * 내 데이터 전체 삭제: 내 개인 키 전부 + 반 공유 데이터 중 내 스냅샷·내 댓글.
   * 다른 학생 데이터는 건드리지 않는다. deps: { store, feed } → { keys, snapshots, comments }
   */
  function deleteMyData(deps, sid) {
    const keys = deps.store.ownKeys(sid);
    keys.forEach((k) => deps.store.remove(k));
    const s = deps.feed.removeAllOf(sid);
    const session = deps.store.get(SM.keys.session(), null);
    if (session && session.sid === sid) deps.store.remove(SM.keys.session());
    return { keys: keys.length, snapshots: s.snapshots, comments: s.comments };
  }

  /**
   * 닉네임 바꾸기(입장 때와 같은 규칙 + 반에서 겹치지 않게). 피드 스냅샷·댓글 닉네임도 바꾼다.
   * deps: { store, auth, feed } → { ok, value } | { ok:false, error }
   */
  function changeNickname(deps, sid, raw) {
    const chk = deps.auth.checkNickname(raw);
    if (chk.error) return { ok: false, error: chk.error };
    const profile = deps.store.get(SM.keys.profile(sid), null);
    if (!profile) return { ok: false, error: '먼저 입장해 줘.' };
    if (profile.nickname === chk.value) return { ok: true, value: chk.value, same: true };
    const norm = (s) => String(s || '').trim().toLowerCase();
    const taken = deps.auth.roster(profile.classId).some((p) => p.sid !== sid && norm(p.nickname) === norm(chk.value));
    if (taken) return { ok: false, error: '이미 다른 친구가 쓰는 닉네임이야.' };
    if (!deps.store.set(SM.keys.profile(sid), Object.assign({}, profile, { nickname: chk.value }))) {
      return { ok: false, error: '저장에 실패했어.' };
    }
    deps.feed.renameAuthor(sid, chk.value);
    return { ok: true, value: chk.value };
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = String(iso).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  }

  // ---------- 화면: #/settings ----------

  function deps() { return { store: SM.store, auth: SM.auth, feed: SM.feed }; }

  function settingsScreen() {
    const el = SM.ui.el;
    const me = SM.auth.current();
    if (!me) return el('p', { text: '먼저 입장해 줘.' });
    const sid = me.sid;
    const profile = () => SM.store.get(SM.keys.profile(sid), me) || me;
    const today = SM.date.today();
    const debouncers = [];

    // --- 닉네임·챗봇 이름 ---
    function textSetting(id, label, hint, value, max, placeholder, apply) {
      const status = SM.ui.savedIndicator();
      const err = el('p', { class: 'field-error', role: 'alert' });
      const input = el('input', { id, type: 'text', maxlength: max, autocomplete: 'off', value: value || '', placeholder: placeholder || '' });
      const save = SM.ui.debounce(() => {
        const r = apply(input.value);
        if (!r.ok) { err.textContent = r.error; status.set('idle'); return; }
        err.textContent = '';
        status.set('saved');
      }, 500);
      debouncers.push(save);
      input.addEventListener('input', () => { status.set('saving'); save(); });
      return el('div', { class: 'field stack' },
        el('label', { for: id, text: label }),
        hint ? el('p', { class: 'muted hint', text: hint }) : null,
        input, err, status.node);
    }

    const nickField = textSetting('nick-name', '닉네임', '2~10자. 우리 반 피드에 보이는 이름도 같이 바뀌어.', profile().nickname, 10, '', (v) => {
      const r = changeNickname(deps(), sid, v);
      if (r.ok && !r.same) {
        const n = document.getElementById('nickname');
        if (n) n.textContent = r.value;
      }
      return r;
    });
    const botMax = SM.chat.BOT_NAME_MAX;
    const botField = textSetting('bot-name', '챗봇 이름', `${botMax}자까지. 비우면 '${SM.chat.DEFAULT_BOT_NAME}'로 돌아가.`, profile().botName, botMax, SM.chat.DEFAULT_BOT_NAME, (v) => {
      const chk = checkBotName(v);
      if (!chk.ok) return chk;
      const ok = SM.store.set(SM.keys.profile(sid), Object.assign({}, profile(), { botName: chk.value }));
      return ok ? { ok: true } : { ok: false, error: '저장에 실패했어.' };
    });

    // --- 백업 ---
    const backupInfo = el('p', { class: 'backup-info' });
    function paintBackupInfo() {
      const last = profile().lastBackupAt;
      const days = backupAgeDays(last, today);
      SM.ui.clear(backupInfo);
      backupInfo.className = 'backup-info' + (days === null || days > BACKUP_STALE_DAYS ? ' warn' : '');
      if (days === null) backupInfo.textContent = '⚠ 아직 백업한 적이 없어요.';
      else if (days > BACKUP_STALE_DAYS) backupInfo.textContent = `⚠ 마지막 백업: ${formatDate(last)} (${days}일 전) · 백업한 지 오래됐어요.`;
      else backupInfo.textContent = `마지막 백업: ${formatDate(last)}${days === 0 ? ' (오늘)' : ` (${days}일 전)`}`;
    }

    function doExport() {
      const p = profile();
      SM.store.set(SM.keys.profile(sid), Object.assign({}, p, { lastBackupAt: new Date().toISOString() }));
      const backup = buildBackup(deps(), sid);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: backupFileName(p.nickname, today) });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      paintBackupInfo();
      SM.ui.toast('내 데이터를 파일로 저장했어.');
    }

    const preview = el('div', { class: 'import-preview stack', hidden: true });
    const fileErr = el('p', { class: 'field-error', role: 'alert' });
    const fileInput = el('input', { id: 'import-file', type: 'file', accept: '.json,application/json' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      fileErr.textContent = '';
      preview.hidden = true;
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => showPreview(previewBackup(String(reader.result || ''), sid));
      reader.onerror = () => { fileErr.textContent = '파일을 읽지 못했어요.'; };
      reader.readAsText(f);
    });

    function showPreview(pv) {
      SM.ui.clear(preview);
      if (!pv.ok) { fileErr.textContent = pv.error; return; }
      const mode = (v, label, desc, checked) => el('label', { class: 'radio-row' },
        el('input', { type: 'radio', name: 'import-mode', value: v, checked: checked || null }),
        el('span', null, el('strong', { text: label }), el('span', { class: 'muted', text: ' · ' + desc })));
      preview.append(
        el('p', { text: `항목 ${pv.count}개 · 내보낸 날짜 ${formatDate(pv.exportedAt) || '알 수 없음'}` }),
        el('fieldset', { class: 'stack' },
          el('legend', { text: '불러오는 방법' }),
          mode('add', '없는 것만 추가', '지금 기록은 그대로 두고 빠진 것만 채워요.', true),
          mode('overwrite', '덮어쓰기', '같은 항목은 백업 내용으로 바꿔요.')),
        el('button', {
          type: 'button', class: 'btn btn-primary', text: '불러오기',
          async onClick() {
            const picked = preview.querySelector('input[name="import-mode"]:checked');
            const overwrite = !!picked && picked.value === 'overwrite';
            const yes = await SM.ui.confirmDialog(overwrite
              ? '같은 항목은 백업 내용으로 바뀌어. 정말 덮어쓸까?'
              : '빠진 것만 백업에서 채울게. 진행할까?', { okText: overwrite ? '덮어쓰기' : '추가하기' });
            if (!yes) return;
            const r = restoreBackup(deps(), pv.obj, sid, overwrite);
            SM.ui.toast(`불러왔어: 추가 ${r.added} · 바꿈 ${r.overwritten} · 건너뜀 ${r.skipped}${r.failed ? ` · 실패 ${r.failed}` : ''}`, 3500);
            SM.router.render();
          }
        })
      );
      preview.hidden = false;
    }

    // --- 반 서버(원격 저장소가 설정됐을 때만) ---
    const remoteOn = !!(SM.remote && SM.remote.enabled());
    let remoteBox = null;
    if (remoteOn) {
      const status = el('p', { 'aria-live': 'polite' });
      const paintRemote = () => {
        const n = SM.feed.pendingCount();
        const at = SM.feed.migratedAt();
        status.textContent = (n ? `아직 보내지 못한 변경 ${n}개(인터넷에 연결되면 보내요)` : '보낼 변경 없음') +
          (at ? ` · 올린 날짜 ${formatDate(at)}` : '');
      };
      const upload = el('button', {
        type: 'button', class: 'btn', text: '우리 반 기록을 반 서버로 올리기',
        async onClick() {
          const own = (key) => SM.feed.ownItems(SM.store.get(key, []), sid).length;
          const classId = SM.storeUtil.classIdOf(sid);
          const yes = await SM.ui.confirmDialog(
            `이 기기에 있는 내 공개 계획 ${own(SM.keys.feed(classId))}개, 댓글·반응 ${own(SM.keys.comments(classId))}개를 반 서버로 올릴게. 진행할까?`,
            { okText: '올리기' });
          if (!yes) return;
          upload.disabled = true;
          const r = await SM.feed.migrateToRemote();
          upload.disabled = false;
          SM.ui.toast(r.ok ? `올렸어: 새로 ${r.created}개 · 이미 있음 ${r.existing}개` : r.error, 3500);
          paintRemote();
        }
      });
      remoteBox = el('div', { class: 'stack' },
        el('p', { class: 'muted', text: '우리 반 피드(공개한 계획·댓글·반응)는 반 서버로 모여요. 플래너·점검표·진단 결과는 이 기기에만 있어요.' }),
        status,
        el('p', { class: 'muted', text: '반 서버를 켜기 전에 이 기기에서 쓴 내 계획과 댓글을 한 번 올려 주세요. 여러 번 눌러도 겹치지 않아요.' }),
        upload);
      paintRemote();
    }

    // --- 저장 공간 ---
    const bytes = SM.store.usageBytes();
    const pct = Math.min(100, Math.round(bytes / LIMIT_BYTES * 100));
    const usage = el('div', { class: 'stack' },
      el('p', { text: `사용량 ${formatUsage(bytes)} (${pct}%)` }),
      el('div', { class: 'usage-bar', role: 'presentation' }, el('span', { style: `width:${pct}%` })),
      usageWarn(bytes) ? el('p', { class: 'warn', text: '⚠ 저장 공간이 4MB를 넘었어요. 백업한 뒤 지난 기록을 정리해 주세요.' }) : null,
      SM.store.isPersistent ? null : el('p', { class: 'warn', text: '⚠ 지금 창에서는 기록이 저장되지 않아요(창을 닫으면 사라져요).' })
    );

    // --- 자동 로그아웃 ---
    const current = SM.auth.autoLogoutMinutes();
    const logoutStatus = SM.ui.savedIndicator();
    const logoutBox = el('fieldset', { class: 'stack' },
      el('legend', { text: '자동으로 나가기' }),
      el('p', { class: 'muted', text: '이 시간 동안 아무것도 안 하면 자동으로 나가요. 이 기기 전체에 적용돼요.' }),
      SM.auth.LOGOUT_CHOICES.map((m) => el('label', { class: 'radio-row' },
        el('input', {
          type: 'radio', name: 'logout-min', value: String(m), checked: m === current ? true : null,
          onChange() {
            const ok = SM.store.update(SM.keys.device(), (d) => Object.assign({}, d || {}, { autoLogoutMinutes: m }), {});
            logoutStatus.set(ok ? 'saved' : 'error');
          }
        }),
        el('span', { text: `${m}분${m === 30 ? ' (공용 기기 권장)' : ''}` }))),
      logoutStatus.node
    );

    // --- 전체 삭제 ---
    async function doDeleteAll() {
      const p = profile();
      const first = await SM.ui.confirmDialog('내 진단·전략·플래너·점검·대화 기록과 반 피드의 내 계획·댓글이 모두 지워져. 되돌릴 수 없어. 계속할까?', { okText: '계속', cancelText: '취소' });
      if (!first) return;
      const typed = await SM.ui.promptDialog(`정말 지우려면 닉네임 '${p.nickname}'을(를) 그대로 입력해 줘.`, { label: '닉네임', okText: '전부 지우기', maxlength: 10 });
      if (typed === null) return;
      if (typed.trim() !== p.nickname) { SM.ui.toast('닉네임이 달라서 지우지 않았어.', 3000); return; }
      const r = deleteMyData(deps(), sid);
      SM.ui.toast(`지웠어: 내 항목 ${r.keys}개 · 피드 ${r.snapshots}개 · 댓글 ${r.comments}개`, 3500);
      SM.router.navigate(SM.router.LOGIN_PATH);
    }

    const card = (title, ...children) => el('section', { class: 'card stack' }, el('h3', { text: title }), ...children);

    const node = el('div', { class: 'settings stack' },
      el('h2', { text: '설정' }),
      card('내 이름', nickField, botField),
      card('백업',
        backupInfo,
        el('p', { class: 'muted', text: '기록은 이 기기에만 있어요. 기기를 바꾸거나 브라우저를 정리하기 전에 파일로 저장해 두세요.' }),
        el('button', { type: 'button', class: 'btn', text: '내 데이터 내보내기', onClick: doExport }),
        el('label', { for: 'import-file', text: '백업 파일 불러오기' }),
        fileInput, fileErr, preview),
      remoteBox ? card('반 서버', remoteBox) : null,
      card('저장 공간', usage),
      card('보안', logoutBox),
      card('앱 정보',
        el('p', { text: `공부 메이트 ${SM.config.version || ''}` }),
        el('p', { class: 'muted', text: remoteOn
          ? '공개한 계획·댓글·반응만 반 서버로 보내요. 나머지 기록은 이 기기 브라우저에만 저장해요.'
          : '이 앱은 데이터를 이 기기 브라우저에만 저장해요. 서버로 보내지 않아요.' })),
      card('내 데이터 지우기',
        el('p', { class: 'muted', text: '다른 친구의 기록은 지워지지 않아요.' }),
        el('button', { type: 'button', class: 'btn btn-danger', text: '내 데이터 전체 삭제', onClick: doDeleteAll }))
    );
    paintBackupInfo();

    return { node, cleanup() { debouncers.forEach((d) => d.cancel()); } };
  }

  SM.settings = {
    checkBotName, backupFileName, formatUsage, usageWarn, backupAgeDays,
    buildBackup, previewBackup, restoreBackup, deleteMyData, changeNickname,
    LIMIT_BYTES, WARN_BYTES, BACKUP_STALE_DAYS
  };

  if (typeof SM.route === 'function') {
    SM.route('#/settings', { title: '설정', render: settingsScreen });
  }
})(window.SM = window.SM || {});
