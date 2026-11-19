(function (SM) {
  'use strict';

  const SALT = 'sm-v1';
  const MAX_FAILS = 5;
  const LOCK_MS = 60 * 1000;
  const TOUCH_WRITE_MS = 30 * 1000; // lastActive는 30초에 한 번만 기록한다.
  const FAIL_KEY = 'sm:v1:login-fail'; // sessionStorage

  // ---------- 해시 ----------

  function utf8(text) { return new TextEncoder().encode(String(text)); }

  /** FNV-1a 64bit → 16자리 hex. 16bit 조각 4개로 계산한다(BigInt 없이). */
  function fnv1a64(text) {
    const h = [0x2325, 0x8422, 0x9ce4, 0xcbf2];       // 0xcbf29ce484222325 (낮은 자리부터)
    const p = [0x01b3, 0x0000, 0x0100, 0x0000];       // 0x00000100000001b3
    utf8(text).forEach((byte) => {
      h[0] ^= byte;
      const r = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; i + j < 4; j++) r[i + j] += h[i] * p[j];
      }
      for (let k = 0; k < 4; k++) {
        const carry = Math.floor(r[k] / 65536);
        r[k] %= 65536;
        if (k < 3) r[k + 1] += carry;
        h[k] = r[k];
      }
    });
    return h.slice().reverse().map((x) => x.toString(16).padStart(4, '0')).join('');
  }

  /** crypto.subtle을 쓸 수 없을 때의 결정적 대체 해시. 'fb:' 접두사로 구분한다. */
  function fallbackHash(text) {
    return 'fb:' + fnv1a64(SALT + ':' + text) + fnv1a64(text + ':' + SALT);
  }

  function hasSubtle() {
    return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.digest === 'function';
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', utf8(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** SHA-256이 되면 SHA-256 hex, 안 되면 대체 해시 */
  async function hash(text) {
    return hasSubtle() ? sha256Hex(text) : fallbackHash(text);
  }

  /**
   * codeHash(문자열 또는 배열) 중 하나라도 맞으면 ok.
   * SHA-256 항목만 있는데 이 환경에서 SHA-256을 못 쓰면 unsupported.
   */
  async function verifyCode(code, codeHash) {
    const list = [].concat(codeHash || []);
    let unsupported = false;
    for (const h of list) {
      if (typeof h !== 'string') continue;
      if (h.startsWith('fb:')) {
        if (fallbackHash(code) === h) return { ok: true };
      } else if (hasSubtle()) {
        if ((await sha256Hex(code)) === h.toLowerCase()) return { ok: true };
      } else {
        unsupported = true;
      }
    }
    return { ok: false, unsupported };
  }

  // ---------- 세션용 보조 ----------

  function memorySession() {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); }
    };
  }

  function safeSession() {
    try {
      const s = window.sessionStorage;
      s.setItem('sm:v1:__probe__', '1');
      s.removeItem('sm:v1:__probe__');
      return s;
    } catch (e) {
      return memorySession();
    }
  }

  function toInt(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    return /^\d{1,3}$/.test(s) ? parseInt(s, 10) : NaN;
  }

  const LOGOUT_CHOICES = [15, 30, 60];

  function norm(nickname) {
    return String(nickname || '').trim().toLowerCase();
  }

  // ---------- 인증 인스턴스 ----------

  function createAuth(deps = {}) {
    const store = deps.store || SM.store;
    const now = deps.now || (() => Date.now());
    const session = deps.session || safeSession();
    const config = () => deps.config || SM.config;
    // 기기 설정(#/settings)에서 고른 값이 있으면 그것을, 없으면 config 값을 쓴다.
    const autoLogoutMinutes = () => {
      const d = store.get(SM.keys.device(), null);
      const m = d && LOGOUT_CHOICES.indexOf(d.autoLogoutMinutes) !== -1 ? d.autoLogoutMinutes : null;
      return m || config().autoLogoutMinutes || 30;
    };
    const timeoutMs = () => autoLogoutMinutes() * 60 * 1000;

    // --- 실패 횟수·잠금(sessionStorage) ---
    function readFails() {
      try { return JSON.parse(session.getItem(FAIL_KEY)) || { count: 0, lockUntil: 0 }; } catch (e) { return { count: 0, lockUntil: 0 }; }
    }
    function writeFails(rec) {
      try { session.setItem(FAIL_KEY, JSON.stringify(rec)); } catch (e) { /* 무시 */ }
    }
    /** 잠금 남은 초(0이면 잠금 아님) */
    function lockStatus() {
      const rec = readFails();
      const left = rec.lockUntil - now();
      return left > 0 ? Math.ceil(left / 1000) : 0;
    }
    function recordFailure() {
      const rec = readFails();
      if (rec.lockUntil && rec.lockUntil <= now()) { rec.count = 0; rec.lockUntil = 0; }
      rec.count += 1;
      if (rec.count >= MAX_FAILS) {
        writeFails({ count: 0, lockUntil: now() + LOCK_MS });
        return { locked: true, left: 0 };
      }
      writeFails(rec);
      return { locked: false, left: MAX_FAILS - rec.count };
    }
    function resetFailures() {
      try { session.removeItem(FAIL_KEY); } catch (e) { /* 무시 */ }
    }

    // --- 반 명단 ---
    function roster(classId) {
      return store.keys('profile:')
        .map((k) => store.get(k, null))
        .filter((p) => p && p.classId === classId)
        .sort((a, b) => a.number - b.number);
    }

    function checkNickname(raw) {
      const value = String(raw || '').trim();
      const len = Array.from(value).length;
      if (len < 2 || len > 10) return { error: '닉네임은 2~10자로 정해 줘.' };
      if (/[\u0000-\u001f\u007f]/.test(value)) return { error: '닉네임에 쓸 수 없는 글자가 있어.' };
      const flat = value.toLowerCase().replace(/\s+/g, '');
      const banned = (config().bannedWords || []).some((w) => w && flat.includes(String(w).toLowerCase()));
      if (banned) return { error: '그 닉네임은 쓸 수 없어. 다른 걸로 정해 줘.' };
      return { value };
    }

    function fail(field, error, extra) {
      return Object.assign({ ok: false, field, error }, extra || {});
    }

    /**
     * 입장. 반환: { ok:true, sid, classId, isNew, profile }
     *   | { ok:false, field, error, locked?, lockedSeconds? }
     *   | { ok:false, needConfirm:true, existingNickname }
     */
    async function login(input, opts = {}) {
      const locked = lockStatus();
      if (locked > 0) return fail('code', `잠깐! ${locked}초 뒤에 다시 해 줘.`, { locked: true, lockedSeconds: locked });

      const cfg = config();
      const school = String(input.school || '').trim();
      if (!cfg.schools.some((s) => s.id === school)) return fail('school', '학교를 골라 줘.');

      const grade = toInt(input.grade);
      if (!(grade >= 1 && grade <= 3)) return fail('grade', '학년은 1~3 중에서 골라 줘.');

      const cls = toInt(input.cls);
      if (!(cls >= 1 && cls <= 20)) return fail('cls', '반은 1~20 사이 숫자로 적어 줘.');

      const entry = cfg.classes.find((c) => c.school === school && +c.grade === grade && +c.cls === cls);
      if (!entry) return fail('cls', '아직 등록되지 않은 반이야. 선생님께 확인해 줘.');

      const code = String(input.code || '').trim();
      if (!/^\d{4,6}$/.test(code)) return fail('code', '입장 코드는 숫자 4~6자리야.');

      const number = toInt(input.number);
      if (!(number >= 1 && number <= 40)) return fail('number', '번호는 1~40 사이 숫자로 적어 줘.');

      const nick = checkNickname(input.nickname);
      if (nick.error) return fail('nickname', nick.error);

      const v = await verifyCode(code, entry.codeHash);
      if (!v.ok) {
        if (v.unsupported) return fail('code', '이 브라우저에서는 코드를 확인할 수 없어. 선생님께 알려 줘.');
        const f = recordFailure();
        return f.locked
          ? fail('code', `코드를 ${MAX_FAILS}번 틀려서 60초 동안 잠겼어.`, { locked: true, lockedSeconds: LOCK_MS / 1000 })
          : fail('code', `입장 코드가 맞지 않아. (남은 기회 ${f.left}번)`);
      }
      resetFailures();

      const classId = `${school}-${grade}-${cls}`;
      const sid = `${classId}-${number}`;
      const existing = store.get(SM.keys.profile(sid), null);
      let profile = existing;
      let isNew = false;

      if (existing && norm(existing.nickname) !== norm(nick.value)) {
        // 같은 번호에 다른 닉네임: 본인 확인 후 기존 프로필로 입장한다.
        if (!opts.confirmed) return { ok: false, needConfirm: true, existingNickname: existing.nickname };
      } else {
        const taken = roster(classId).some((p) => p.sid !== sid && norm(p.nickname) === norm(nick.value));
        if (taken) return fail('nickname', '이미 다른 친구가 쓰는 닉네임이야.');
      }

      if (!existing) {
        profile = {
          sid, classId, school, grade, cls, number,
          nickname: nick.value,
          greeted: false, // 챗봇 첫 인사를 아직 안 했음
          createdAt: new Date(now()).toISOString()
        };
        if (!store.set(SM.keys.profile(sid), profile)) return fail(null, '저장에 실패했어. 잠시 뒤 다시 해 줘.');
        isNew = true;
      }

      store.set(SM.keys.session(), { sid, lastActive: now() });
      return { ok: true, sid, classId, isNew, profile };
    }

    function logout() {
      store.remove(SM.keys.session());
    }

    function isExpired(s) {
      return now() - (s.lastActive || 0) > timeoutMs();
    }

    /** 현재 입장한 학생의 profile 또는 null. 시간이 지났으면 로그아웃한다. */
    function current() {
      const s = store.get(SM.keys.session(), null);
      if (!s || !s.sid) return null;
      if (isExpired(s)) { logout(); return null; }
      const profile = store.get(SM.keys.profile(s.sid), null);
      if (!profile) { logout(); return null; }
      return profile;
    }

    function restore() {
      const me = current();
      if (me) touch(true);
      return me;
    }

    /** 활동 기록. 세션이 살아 있으면 true, 없거나 만료됐으면 false. */
    function touch(force) {
      const s = store.get(SM.keys.session(), null);
      if (!s || !s.sid) return false;
      if (isExpired(s)) { logout(); return false; }
      if (force || now() - s.lastActive >= TOUCH_WRITE_MS) {
        store.set(SM.keys.session(), { sid: s.sid, lastActive: now() });
      }
      return true;
    }

    /** 입력·클릭마다 touch, 30초마다 만료 검사. 만료되면 onExpire(). 해제 함수 반환. */
    function watch(onExpire) {
      if (typeof document === 'undefined') return () => {};
      const check = () => {
        const s = store.get(SM.keys.session(), null);
        if (s && s.sid && !touch()) onExpire();
      };
      const events = ['pointerdown', 'keydown', 'input'];
      events.forEach((ev) => document.addEventListener(ev, check, true));
      const timer = setInterval(() => {
        const s = store.get(SM.keys.session(), null);
        if (s && s.sid && isExpired(s)) { logout(); onExpire(); }
      }, 30 * 1000);
      return () => {
        events.forEach((ev) => document.removeEventListener(ev, check, true));
        clearInterval(timer);
      };
    }

    return {
      login, logout, current, restore, touch, watch, roster, lockStatus,
      checkNickname, autoLogoutMinutes, LOGOUT_CHOICES,
      hash, sha256Hex, fallbackHash, fnv1a64, hasSubtle, verifyCode
    };
  }

  SM.createAuth = createAuth;
  SM.auth = createAuth();

  // ---------- 화면: #/login ----------

  function loginScreen() {
    const el = SM.ui.el;
    const auth = SM.auth;
    if (auth.current()) {
      location.replace('#/chat');
      return el('div');
    }
    const cfg = SM.config;
    const errs = {};
    const inputs = {};

    function errorEl(name) {
      errs[name] = el('p', { class: 'field-error', id: 'err-' + name, 'aria-live': 'polite' });
      return errs[name];
    }
    function field(name, label, input, hint) {
      input.id = 'f-' + name;
      input.setAttribute('aria-describedby', 'err-' + name);
      inputs[name] = input;
      return el('div', { class: 'field' },
        el('label', { for: 'f-' + name, text: label }),
        hint ? el('span', { class: 'muted hint', text: hint }) : null,
        input,
        errorEl(name)
      );
    }
    function clearErrors() {
      Object.keys(errs).forEach((k) => { errs[k].textContent = ''; });
      Object.keys(inputs).forEach((k) => inputs[k].removeAttribute('aria-invalid'));
      status.textContent = '';
    }
    function showError(name, message) {
      if (name && errs[name]) {
        errs[name].textContent = message;
        if (inputs[name]) {
          inputs[name].setAttribute('aria-invalid', 'true');
          inputs[name].focus();
        }
      } else {
        status.textContent = message;
      }
    }

    const school = el('select', { name: 'school' },
      el('option', { value: '', text: '학교를 골라 줘' }),
      cfg.schools.map((s) => el('option', { value: s.id, text: s.name }))
    );
    if (cfg.schools.length === 1) school.value = cfg.schools[0].id;

    let grade = null;
    const gradeBtns = [1, 2, 3].map((g) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': 'false', text: g + '학년',
      onClick() {
        grade = g;
        gradeBtns.forEach((b, i) => {
          const on = i + 1 === g;
          b.classList.toggle('chip-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        errs.grade.textContent = '';
      }
    }));
    const gradeGroup = el('div', { class: 'row', role: 'group', 'aria-labelledby': 'lbl-grade', 'aria-describedby': 'err-grade' }, gradeBtns);
    inputs.grade = gradeBtns[0];

    const cls = el('input', { type: 'number', inputmode: 'numeric', min: 1, max: 20, name: 'cls', autocomplete: 'off' });
    const code = el('input', { type: 'password', inputmode: 'numeric', maxlength: 6, name: 'code', autocomplete: 'off' });
    const number = el('input', { type: 'number', inputmode: 'numeric', min: 1, max: 40, name: 'number', autocomplete: 'off' });
    const nickname = el('input', { type: 'text', maxlength: 10, name: 'nickname', autocomplete: 'off' });

    const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: '입장하기' });
    const status = el('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });

    let countdown = null;
    function updateLock() {
      const s = auth.lockStatus();
      submit.disabled = s > 0;
      if (s > 0) {
        status.textContent = `코드를 여러 번 틀렸어. ${s}초 뒤에 다시 해 줘.`;
      } else {
        if (countdown) { clearInterval(countdown); countdown = null; }
        status.textContent = '';
      }
    }
    function startCountdown() {
      if (countdown) clearInterval(countdown);
      countdown = setInterval(updateLock, 1000);
      updateLock();
    }

    async function doLogin(confirmed) {
      clearErrors();
      submit.disabled = true;
      let res;
      try {
        res = await auth.login({
          school: school.value, grade, cls: cls.value, code: code.value,
          number: number.value, nickname: nickname.value
        }, { confirmed });
      } finally {
        submit.disabled = false;
      }
      if (res.ok) {
        SM.ui.toast(res.isNew ? `반가워, ${res.profile.nickname}!` : `다시 왔구나, ${res.profile.nickname}!`);
        location.hash = '#/chat';
        return;
      }
      if (res.needConfirm) {
        const yes = await SM.ui.confirmDialog(
          `이미 ${res.existingNickname}(으)로 등록된 번호예요. 본인이 맞나요?`,
          { okText: '네, 본인이에요', cancelText: '아니요' }
        );
        if (yes) return doLogin(true);
        showError('number', '번호를 다시 확인해 줘.');
        return;
      }
      if (res.field === 'code') code.value = '';
      showError(res.field, res.error);
      if (res.locked) {
        startCountdown();
        status.textContent = res.error;
      }
    }

    const form = el('form', {
      class: 'card stack', novalidate: true,
      onSubmit(e) { e.preventDefault(); doLogin(false); }
    },
      el('h2', { text: '입장하기' }),
      el('p', { class: 'muted', text: '실명은 적지 마. 번호와 닉네임만 있으면 돼.' }),
      field('school', '학교', school),
      el('div', { class: 'field' },
        el('span', { class: 'label', id: 'lbl-grade', text: '학년' }),
        gradeGroup,
        errorEl('grade')
      ),
      field('cls', '반', cls),
      field('code', '입장 코드', code, '선생님께 받은 숫자 4~6자리'),
      field('number', '번호', number),
      field('nickname', '닉네임', nickname, '2~10자, 반 친구들에게 보여'),
      status,
      submit
    );

    if (auth.lockStatus() > 0) startCountdown();

    const node = el('div', { class: 'stack' },
      form,
      el('p', { class: 'center' }, el('a', { href: '#/teacher', class: 'link-small', text: '선생님이신가요?' }))
    );
    return { node, cleanup: () => { if (countdown) clearInterval(countdown); } };
  }

  // ---------- 화면: #/teacher ----------

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = SM.ui.el('textarea', { class: 'visually-hidden', readonly: true });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* 무시 */ }
      ta.remove();
    }
    SM.ui.toast('복사했어요');
  }

  function teacherScreen() {
    const el = SM.ui.el;
    const auth = SM.auth;
    const cfg = SM.config;

    const school = el('select', { id: 't-school' }, cfg.schools.map((s) => el('option', { value: s.id, text: `${s.name} (${s.id})` })));
    const grade = el('select', { id: 't-grade' }, [1, 2, 3].map((g) => el('option', { value: g, text: g + '학년' })));
    const cls = el('input', { id: 't-cls', type: 'number', inputmode: 'numeric', min: 1, max: 20, value: 1 });
    const code = el('input', { id: 't-code', type: 'text', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', 'aria-describedby': 't-err' });
    const err = el('p', { id: 't-err', class: 'field-error', 'aria-live': 'polite' });
    const out = el('div', { class: 'stack', 'aria-live': 'polite' });

    function hashRow(label, value) {
      return el('div', { class: 'stack hash-row' },
        el('strong', { text: label }),
        el('code', { class: 'hash-box', text: value }),
        el('button', { type: 'button', class: 'btn', text: '복사', onClick: () => copyText(value) })
      );
    }

    async function generate(e) {
      e.preventDefault();
      SM.ui.clear(out);
      err.textContent = '';
      const c = code.value.trim();
      const clsNum = parseInt(cls.value, 10);
      if (!/^\d{4,6}$/.test(c)) { err.textContent = '입장 코드는 숫자 4~6자리로 정해 주세요.'; code.focus(); return; }
      if (!(clsNum >= 1 && clsNum <= 20)) { err.textContent = '반은 1~20 사이 숫자로 적어 주세요.'; cls.focus(); return; }

      const fb = auth.fallbackHash(c);
      const sha = auth.hasSubtle() ? await auth.sha256Hex(c) : null;
      const line = (h) => `{ school: '${school.value}', grade: ${parseInt(grade.value, 10)}, cls: ${clsNum}, codeHash: '${h}' },`;
      const both = `{ school: '${school.value}', grade: ${parseInt(grade.value, 10)}, cls: ${clsNum}, codeHash: [${sha ? `'${sha}', ` : ''}'${fb}'] },`;

      [
        sha ? hashRow('SHA-256 해시', sha) : el('p', { class: 'muted', text: '이 브라우저에서는 SHA-256을 만들 수 없어요. 대체 해시를 쓰세요.' }),
        hashRow('대체 해시 (file:// 환경용)', fb),
        el('h3', { text: 'config.js의 classes에 붙여 넣을 줄' }),
        sha ? hashRow('SHA-256만', line(sha)) : null,
        hashRow('두 해시 모두 (권장: 어떤 기기에서든 입장 가능)', both)
      ].forEach((n) => { if (n) out.appendChild(n); });
    }

    const form = el('form', { class: 'card stack', novalidate: true, onSubmit: generate },
      el('h2', { text: '선생님용: 입장 코드 해시 만들기' }),
      el('p', { class: 'muted', text: '반마다 하나의 공용 입장 코드를 정하고, 아래에서 만든 해시를 js/config.js에 붙여 넣으세요.' }),
      el('div', { class: 'field' }, el('label', { for: 't-school', text: '학교' }), school),
      el('div', { class: 'row' },
        el('div', { class: 'field grow' }, el('label', { for: 't-grade', text: '학년' }), grade),
        el('div', { class: 'field grow' }, el('label', { for: 't-cls', text: '반' }), cls)
      ),
      el('div', { class: 'field' }, el('label', { for: 't-code', text: '입장 코드 (숫자 4~6자리)' }), code, err),
      el('button', { type: 'submit', class: 'btn btn-primary', text: '해시 만들기' }),
      el('p', { class: 'muted', text: '이 화면은 코드를 저장하지 않아요.' }),
      el('p', { class: 'muted', text: '숫자 코드는 자리 수가 적어서 config.js를 본 사람은 알아낼 수 있어요. 반 안에서만 쓰는 코드로 정해 주세요.' })
    );

    return el('div', { class: 'stack' },
      form,
      out,
      el('p', { class: 'center' }, el('a', { href: '#/login', class: 'link-small', text: '학생 입장 화면으로' }))
    );
  }

  if (typeof SM.route === 'function') {
    SM.route('#/login', { title: '입장', auth: false, render: loginScreen });
    SM.route('#/teacher', { title: '선생님용', auth: false, render: teacherScreen });
  }
})(window.SM = window.SM || {});
