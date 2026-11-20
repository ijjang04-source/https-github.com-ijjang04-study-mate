/**
 * 공부 메이트 — 반 서버 (Google Apps Script 웹 앱)
 *
 * 이 파일은 웹 앱에서 불러오지 않는다. 선생님이 구글 시트의 Apps Script 편집기에 붙여 넣어 쓴다.
 * 설정 방법: docs/remote-setup.md
 *
 * 시트
 *   classes : A 반ID(예: SM01-2-3) | B 입장 코드(숫자, 서식은 '일반 텍스트')
 *   items   : A classId | B kind(feed|comments) | C id | D json | E updatedAt | F deleted
 *
 * 요청(POST, 본문은 JSON 문자열): { op: get|list|put|delete, path: 'classes/<반ID>/<feed|comments>[/<id>]', key, since?, item? }
 * 응답: { ok: true, ... } 또는 { ok: false, status, error }
 *   key = SHA-256('study-mate:' + 반ID + ':' + 입장 코드)  — 앱이 입장할 때 만든다.
 */

var SHEET_CLASSES = 'classes';
var SHEET_ITEMS = 'items';
var PATH_RE = /^classes\/([A-Za-z0-9]+-\d+-\d+)\/(feed|comments)(?:\/(.+))?$/;
var MAX_TEXT = 200;
var MAX_JSON = 10000;                 // 항목 하나의 최대 크기(글자)
var MAX_FAILS = 30;                   // 반 키가 10분에 30번 넘게 틀리면 잠시 막는다
var REACTIONS = ['cheer', 'try', 'question'];
// 저장해도 되는 필드만 받는다(일간 기록·점검표·진단 결과가 실수로 올라오지 않게)
var FEED_FIELDS = ['planKey', 'sid', 'nickname', 'week', 'goals', 'strategies', 'weekFocus', 'rate', 'monthGoals', 'updatedAt'];
var COMMENT_FIELDS = ['id', 'planKey', 'author', 'nickname', 'text', 'reaction', 'hidden', 'createdAt', 'editedAt'];

/** 처음 한 번 편집기에서 실행: 시트와 머리글을 만든다. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var c = ss.getSheetByName(SHEET_CLASSES) || ss.insertSheet(SHEET_CLASSES);
  if (c.getLastRow() === 0) c.appendRow(['반ID (예: SM01-2-3)', '입장 코드']);
  c.getRange('B:B').setNumberFormat('@'); // 0으로 시작하는 코드가 숫자로 바뀌지 않게
  var it = ss.getSheetByName(SHEET_ITEMS) || ss.insertSheet(SHEET_ITEMS);
  if (it.getLastRow() === 0) it.appendRow(['classId', 'kind', 'id', 'json', 'updatedAt', 'deleted']);
  it.getRange('A:E').setNumberFormat('@'); // 시각·id가 날짜·숫자로 바뀌지 않게(문자열로 비교한다)
}

function doGet() {
  return ContentService.createTextOutput('공부 메이트 반 서버가 동작 중이에요.');
}

function doPost(e) {
  var out;
  try {
    out = handle(JSON.parse(e.postData.contents));
  } catch (err) {
    out = { ok: false, status: err.status || 400, error: err.status ? err.message : '요청을 읽을 수 없어' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function fail(status, message) {
  var e = new Error(message);
  e.status = status;
  throw e;
}

function handle(req) {
  var m = PATH_RE.exec(String(req.path || ''));
  if (!m) fail(400, '잘못된 경로');
  var classId = m[1], kind = m[2], id = m[3] || null;
  checkKey(classId, req.key);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (req.op === 'list') return list(classId, kind, req.since);
    if (!id) fail(400, '항목 id가 없어');
    var row = findRow(classId, kind, id);
    if (req.op === 'get') return { ok: true, item: row && !row.deleted ? JSON.parse(row.json) : null };
    if (req.op === 'put') return put(classId, kind, id, req.item, row);
    if (req.op === 'delete') return del(classId, kind, id, row);
    fail(400, '알 수 없는 요청');
  } finally {
    lock.releaseLock();
  }
}

// ---------- 반 키 ----------

function sha256Hex(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function checkKey(classId, key) {
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + classId;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILS) fail(429, '잠시 뒤에 다시 해 줘');
  var expected = cache.get('key:' + classId);
  if (!expected) {
    var rows = sheet(SHEET_CLASSES).getDataRange().getDisplayValues();
    var code = null;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === classId) { code = String(rows[i][1]).trim(); break; }
    }
    if (!code) fail(403, '반 서버에 등록되지 않은 반이야');
    expected = sha256Hex('study-mate:' + classId + ':' + code);
    cache.put('key:' + classId, expected, 600); // 코드를 바꾸면 10분 안에 반영
  }
  if (key !== expected) {
    cache.put(failKey, String(fails + 1), 600);
    fail(403, '반 키가 맞지 않아. 선생님께 알려 줘.');
  }
}

// ---------- 항목 ----------

function sheet(name) {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!s) fail(500, '시트가 없어요. 편집기에서 setup을 실행해 주세요.');
  return s;
}

function findRow(classId, kind, id) {
  var s = sheet(SHEET_ITEMS);
  var values = s.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    if (v[0] === classId && v[1] === kind && String(v[2]) === id) {
      return { index: i + 1, json: v[3], updatedAt: v[4], deleted: v[5] === true || v[5] === 'TRUE' };
    }
  }
  return null;
}

function list(classId, kind, since) {
  var values = sheet(SHEET_ITEMS).getDataRange().getValues();
  var from = String(since || '');
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    var at = v[4] instanceof Date ? v[4].toISOString() : String(v[4]);
    if (v[0] !== classId || v[1] !== kind || at <= from) continue;
    var deleted = v[5] === true || v[5] === 'TRUE';
    items.push({ id: String(v[2]), data: deleted ? null : JSON.parse(v[3]), deleted: deleted, updatedAt: at });
  }
  items.sort(function (a, b) { return a.updatedAt < b.updatedAt ? -1 : 1; });
  // 같은 1초 안에 쓰인 항목을 놓치지 않게 1초 앞을 돌려준다(다시 받아도 앱이 같은 내용이면 무시)
  return { ok: true, items: items, serverTime: new Date(Date.now() - 1000).toISOString() };
}

function ownerOf(planKey) {
  var s = String(planKey || '');
  var i = s.lastIndexOf(':');
  return i === -1 ? '' : s.slice(0, i);
}
function classOf(sid) {
  var m = /^(.+)-\d+$/.exec(String(sid || ''));
  return m ? m[1] : '';
}

function validate(classId, kind, id, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, '내용이 없어');
  var allowed = kind === 'feed' ? FEED_FIELDS : COMMENT_FIELDS;
  Object.keys(item).forEach(function (k) { if (allowed.indexOf(k) === -1) fail(400, '받을 수 없는 항목: ' + k); });
  if (kind === 'feed') {
    if (item.planKey !== id || ownerOf(item.planKey) !== item.sid) fail(400, '계획 id가 맞지 않아');
    if (classOf(item.sid) !== classId) fail(403, '다른 반 항목이야');
  } else {
    if (item.id !== id) fail(400, '댓글 id가 맞지 않아');
    if (classOf(ownerOf(item.planKey)) !== classId || classOf(item.author) !== classId) fail(403, '다른 반 항목이야');
    if (item.reaction !== null && REACTIONS.indexOf(item.reaction) === -1) fail(400, '알 수 없는 반응이야');
    var len = Array.from ? Array.from(String(item.text || '')).length : String(item.text || '').length;
    if (len > MAX_TEXT) fail(400, MAX_TEXT + '자까지 쓸 수 있어');
  }
  var json = JSON.stringify(item);
  if (json.length > MAX_JSON) fail(400, '내용이 너무 길어');
  return json;
}

function put(classId, kind, id, item, row) {
  var json = validate(classId, kind, id, item);
  var at = new Date().toISOString();
  var s = sheet(SHEET_ITEMS);
  if (row) {
    s.getRange(row.index, 4, 1, 3).setValues([[json, at, false]]);
  } else {
    s.appendRow([classId, kind, id, json, at, false]);
  }
  return { ok: true, created: !row || row.deleted, updatedAt: at };
}

/** 지우지 않고 삭제 표시만 남긴다(다른 기기가 지워진 걸 알 수 있게). 정리는 cleanup으로. */
function del(classId, kind, id, row) {
  var at = new Date().toISOString();
  var s = sheet(SHEET_ITEMS);
  if (row) s.getRange(row.index, 4, 1, 3).setValues([['', at, true]]);
  else s.appendRow([classId, kind, id, '', at, true]);
  return { ok: true, existed: !!row && !row.deleted };
}

/** 선생님용: 30일 지난 삭제 표시 행을 정리한다(편집기에서 실행). */
function cleanup() {
  var s = sheet(SHEET_ITEMS);
  var values = s.getDataRange().getValues();
  var limit = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  for (var i = values.length - 1; i >= 1; i--) {
    var deleted = values[i][5] === true || values[i][5] === 'TRUE';
    var at = values[i][4] instanceof Date ? values[i][4].toISOString() : String(values[i][4]);
    if (deleted && at < limit) s.deleteRow(i + 1);
  }
}
