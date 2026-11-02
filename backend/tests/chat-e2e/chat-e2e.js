'use strict';
/* Test đầu-cuối (E2E) cho Chat MVP trên server Go ĐANG CHẠY SẴN ở máy: không tự bật server, không đọc .env, không đụng
   database. Hợp đồng: chat-mvp-spec.md mục 4 (REST), 5 (quy tắc), 6 (WebSocket) + backend/CHAT.md mục 5-11.

   1) Bật server (từ backend/, database tạm có chữ "test", KHÔNG dùng .env thật):
        DOTENV=0 DATABASE_URL=postgresql://qspro:<mật khẩu>@localhost:5434/qspro_chattest REPORT_JOB=0 \
        PURCHASE_WEBHOOK=http://127.0.0.1:9/x REPORT_WEBHOOK=http://127.0.0.1:9/x AUTH_SECRET=test-secret PORT=3998 \
        CHAT_OTP_DEV=1 TRUSTED_PROXIES=127.0.0.1,::1 go run ./cmd/api
      - CHAT_OTP_DEV=1 BẮT BUỘC: otp/request phải trả dev_code (thiếu thì script dừng, mã thoát 2).
      - TRUSTED_PROXIES=127.0.0.1,::1 nên có: OTP giới hạn 20 lần / giờ / IP, mỗi lượt chạy xin 6 mã; script gửi
        X-Forwarded-For giả (10.x.x.x, đổi mỗi lượt) nên chạy lại nhiều lần trong 1 giờ không bị OTP_RATE_LIMIT.
      - Giữ mặc định CHAT_ACCESS_TTL_MIN (15 -> expires_in 900); không đặt RATE_LIMIT_RPS.
   2) Chạy (Node 22+, không cần npm install):
        BASE_URL=http://localhost:3998 node backend/tests/chat-e2e/chat-e2e.js
        PowerShell: $env:BASE_URL='http://localhost:3998'; node backend/tests/chat-e2e/chat-e2e.js
      SKIP_SLOW=1      bỏ các bước phải chờ lâu (offline sau OfflineGrace 30 giây, dùng lại refresh token sau 31 giây,
                       đăng nhập lại sau 60 giây, đóng 4408 khi không auth trong 10 giây); đủ cả thì mất thêm ~40 giây.
      OFFLINE_WAIT_MS  chờ presence offline tối đa (mặc định 35000). WAIT_MS: chờ 1 gói / trả lời WS (mặc định 5000).
      QUIET_MS         cửa sổ kiểm "không nhận thêm gì" (mặc định 1000).
      CLOCK_SLACK_MS   độ lệch đồng hồ chấp nhận cho 2 bước chậm so với cửa sổ server tính bằng giờ PostgreSQL (mặc định
                       10000): xin lại OTP sau 60 giây và dùng lại refresh token sau 30 giây. Máy chạy test và database có
                       thể không cùng đồng hồ (Docker Desktop: đồng hồ VM chạy chậm ~10% rồi được chỉnh nhảy ~3 giây mỗi
                       ~30 giây), nên server có thể còn báo "đợi N giây" / REFRESH_RACE dù máy test đã chờ đủ; bước đó
                       chờ thêm theo lời server rồi thử lại, tối đa CLOCK_SLACK_MS (in GHI CHÚ khi phải chờ thêm).
   Chỉ chạy với BASE_URL localhost / 127.0.0.1. Mỗi lượt dùng số ngẫu nhiên mới (09 + 8 số) nên các lượt không đụng nhau;
   test ĐỂ LẠI tài khoản / tin nhắn thử trong database tạm. Mỗi bước in "OK <tên>" hoặc "LỖI <tên>: <chi tiết>", dòng cuối
   "KẾT QUẢ chat-e2e (<BASE_URL>): N đạt, M lỗi". Mã thoát: 0 đạt hết, 1 có lỗi, 2 từ chối / không chạy được. */

const crypto = require('node:crypto');

// ───────────── cấu hình + chốt an toàn ─────────────

const BASE = (process.env.BASE_URL || 'http://localhost:3998').replace(/\/+$/, '');

function refuse(msg) {
  console.error('DỪNG: ' + msg);
  process.exit(2);
}

let baseHost = '';
try {
  const u = new URL(BASE);
  if (!/^https?:$/.test(u.protocol)) throw new Error('scheme');
  baseHost = u.hostname;
} catch (e) {
  refuse('BASE_URL không hợp lệ: ' + BASE);
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(baseHost)) {
  refuse(`chỉ chạy với server ở máy (localhost / 127.0.0.1), từ chối ${BASE}`);
}
if (typeof fetch !== 'function' || typeof WebSocket !== 'function') {
  refuse('cần Node 22+ (có fetch và WebSocket toàn cục), đang chạy ' + process.version);
}

const API = BASE + '/api/v1/chat';
const WS_URL = BASE.replace(/^http/i, 'ws') + '/api/v1/chat/ws';
const posInt = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};
const SKIP_SLOW = process.env.SKIP_SLOW === '1';
const OFFLINE_WAIT_MS = posInt(process.env.OFFLINE_WAIT_MS, 35000);
const WAIT_MS = posInt(process.env.WAIT_MS, 5000);
const QUIET_MS = posInt(process.env.QUIET_MS, 1000);
const CLOCK_SLACK_MS = posInt(process.env.CLOCK_SLACK_MS, 10000);
const RUN = crypto.randomBytes(3).toString('hex'); // mã lượt chạy, gắn vào tên nhóm / nội dung tin
const FAKE_IP = `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${1 + crypto.randomInt(254)}`;
const NOAUTH_MSG = 'Phiên chat đã hết, mời đăng nhập lại';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/; // RFC3339 UTC có mili giây

// ───────────── kết quả ─────────────

let pass = 0;
let fails = 0;
let finished = false;
const perScenario = [];
let curScenario = null;

function js(v, n = 400) {
  let s;
  try {
    s = JSON.stringify(v);
  } catch (e) {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > n ? s.slice(0, n) + '...' : s;
}

// check: một bước kiểm. detail (chuỗi / giá trị / hàm dựng chuỗi) chỉ in khi lỗi.
function check(cond, name, detail) {
  const good = !!cond;
  if (curScenario) curScenario[good ? 'pass' : 'fail']++;
  if (good) {
    pass++;
    console.log('OK ' + name);
    return true;
  }
  fails++;
  let d = detail;
  if (typeof d === 'function') {
    try {
      d = d();
    } catch (e) {
      d = 'không dựng được chi tiết: ' + e.message;
    }
  }
  if (d !== undefined && typeof d !== 'string') d = js(d);
  console.log('LỖI ' + name + ': ' + (d ? d : 'không đạt'));
  return false;
}

const skip = (name, why) => console.log(`BỎ QUA ${name} (${why})`);
const note = (msg) => console.log('GHI CHÚ ' + msg);

process.on('unhandledRejection', (e) => {
  if (!finished) check(false, 'promise bị từ chối mà không ai xử lý', (e && e.message) || String(e));
});

// ───────────── tiện ích ─────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = (p) => p.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
const uuid = () => crypto.randomUUID();
const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const isIso = (s) => typeof s === 'string' && ISO_RE.test(s);
const findConv = (list, id) => (Array.isArray(list) ? list : []).find((c) => c && c.id === id);
const member = (detail, uid) => ((detail && detail.members) || []).find((m) => m && m.user_id === uid);
const ascContiguous = (msgs) => Array.isArray(msgs) && msgs.every((m, i) => i === 0 || m.seq === msgs[i - 1].seq + 1);
const pktDetail = (p) => (p && p.why) || js(p);
const content = (p) => String((p && p.data && p.data.content) || '');

async function waitUntil(fn, timeoutMs, stepMs = 50) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try {
      v = fn();
    } catch (e) {
      v = false;
    }
    if (v) return true;
    if (Date.now() - t0 >= timeoutMs) return false;
    await sleep(stepMs);
  }
}

// retryEarly: gọi doReq; khi server trả lời "cửa sổ chưa hết" theo đồng hồ của nó (early(r) trả số ms nên chờ, 0 = không
// phải trường hợp này) thì chờ rồi gọi lại, tổng thời gian chờ thêm tối đa CLOCK_SLACK_MS (xem CLOCK_SLACK_MS ở đầu file).
async function retryEarly(label, doReq, early) {
  let r = await doReq();
  let extra = 0;
  for (;;) {
    let ms = 0;
    try {
      ms = early(r) || 0;
    } catch (e) {
      ms = 0;
    }
    if (!ms || extra + ms > CLOCK_SLACK_MS) break;
    note(`${label}: server còn báo ${brief(r)} (đồng hồ database lệch với máy chạy test), chờ thêm ${ms} ms rồi thử lại`);
    await sleep(ms);
    extra += ms;
    r = await doReq();
  }
  return r;
}

// Số điện thoại di động Việt Nam ngẫu nhiên, không trùng trong lượt chạy, kèm các cách viết khác nhau.
const usedPhones = new Set();
function newPhone() {
  let local;
  do {
    local = '09' + String(crypto.randomInt(0, 100000000)).padStart(8, '0');
  } while (usedPhones.has(local));
  usedPhones.add(local);
  const nine = local.slice(1);
  return {
    local, // 0901234567
    e164: '+84' + nine, // +84901234567
    cc: '84' + nine, // 84901234567
    spaced: `+84 ${nine.slice(0, 3)} ${nine.slice(3, 6)} ${nine.slice(6)}`,
    dotted: `(+84) ${nine.slice(0, 3)}.${nine.slice(3, 6)}-${nine.slice(6)}`,
  };
}
const FORMAT_NAME = { local: '0xxxxxxxxx', e164: '+84xxxxxxxxx', cc: '84xxxxxxxxx', spaced: '+84 xxx xxx xxx', dotted: '(+84) xxx.xxx-xxx' };

// ───────────── REST ─────────────

async function rest(method, path, o = {}) {
  let url = API + path;
  if (o.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(o.query)) if (v !== undefined && v !== null) qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += '?' + s;
  }
  const headers = { Accept: 'application/json' };
  if (o.token) headers.Authorization = 'Bearer ' + o.token;
  let body;
  if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers['Content-Type'] = 'application/json';
  }
  Object.assign(headers, o.headers || {});
  const shown = method + ' /chat' + path + (url.includes('?') ? url.slice(url.indexOf('?')) : '');
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { status: 0, ok: false, code: 'NETWORK', error: 'lỗi mạng: ' + ((e.cause && e.cause.message) || e.message), text: '', shown };
  }
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch (e) {
    j = null;
  }
  const obj = j && typeof j === 'object';
  return {
    status: res.status,
    ok: res.status === 200 && !!obj && j.ok === true,
    result: obj ? j.result : undefined,
    error: obj ? j.error : undefined,
    code: obj ? j.code : undefined,
    text,
    shown,
  };
}

function brief(r) {
  let s = `${r.shown} -> HTTP ${r.status}`;
  if (r.code) s += ' ' + r.code;
  if (r.error) s += ` "${r.error}"`;
  if (r.ok) s += ' ' + js(r.result, 300);
  else if (!r.error) s += ' ' + String(r.text || '').slice(0, 200);
  return s;
}

const call = (u, method, path, body, query) => rest(method, path, { token: u.access, body, query });
const otpRequest = (phone) => rest('POST', '/auth/otp/request', { body: { phone }, headers: { 'X-Forwarded-For': FAKE_IP } });

// expectOk: HTTP 200 {"ok":true} và pred(result) đúng. Trả result (kể cả khi pred sai) để bước sau dùng tiếp.
function expectOk(name, r, pred) {
  if (!r.ok) {
    check(false, name, brief(r));
    return undefined;
  }
  if (pred) {
    let v;
    try {
      v = pred(r.result);
    } catch (e) {
      v = false;
    }
    check(v, name, () => 'kết quả không như mong đợi: ' + js(r.result, 700));
  } else {
    check(true, name);
  }
  return r.result;
}

function expectErr(name, r, status, code) {
  return check(r.status === status && r.code === code, name, () => `mong HTTP ${status} ${code}, nhận ${brief(r)}`);
}

// expectReject: spec không định mã lỗi cụ thể -> chỉ đòi 4xx có "code" (mã nhận được in kèm tên bước).
function expectReject(name, r) {
  const good = r.status >= 400 && r.status < 500 && typeof r.code === 'string';
  return check(good, `${name}${good ? ` [${r.status} ${r.code}]` : ''}`, () => brief(r));
}

function guardOtp(r, label) {
  if (r.ok && r.result && /^\d{6}$/.test(String(r.result.dev_code || ''))) return;
  if (r.status === 0) refuse(`không gọi được ${API} (${r.error}). Server Go đã chạy ở ${BASE} chưa?`);
  if (r.status === 404) refuse(`POST /api/v1/chat/auth/otp/request trả 404: server chưa nối module chat.`);
  if (r.status === 429 && r.code === 'OTP_RATE_LIMIT') {
    refuse(`otp/request của ${label} bị giới hạn: "${r.error}". OTP giới hạn 20 lần / giờ / IP: bật server với ` +
      `TRUSTED_PROXIES=127.0.0.1,::1 (script gửi X-Forwarded-For giả ${FAKE_IP} mỗi lượt) hoặc đợi 1 giờ.`);
  }
  if (r.ok) refuse('otp/request không trả dev_code: bật server với CHAT_OTP_DEV=1 (chỉ dùng ở máy) rồi chạy lại.');
  refuse(`otp/request của ${label} lỗi: ${brief(r)}`);
}

// ───────────── WebSocket ─────────────

const sockets = [];

function matches(type, pred, p) {
  if (p.type !== type) return false;
  if (!pred) return true;
  try {
    return !!pred(p.data, p);
  } catch (e) {
    return false;
  }
}

async function probeWs() {
  try {
    const r = await fetch(API + '/ws', { signal: AbortSignal.timeout(5000) });
    const t = await r.text();
    return `GET /chat/ws không nâng cấp -> HTTP ${r.status} ${t.slice(0, 160)}`;
  } catch (e) {
    return 'không gọi được server: ' + ((e.cause && e.cause.message) || e.message);
  }
}

// WsClient: một kết nối WebSocket. request() khớp trả lời theo req_id; waitFor() chờ gói theo loại + điều kiện
// (xét cả gói đã tới trước mà chưa ai lấy); all = mọi gói đã nhận (để kiểm "không nhận thêm gì" bằng mark/since).
class WsClient {
  constructor(label, user) {
    this.label = label;
    this.user = user || null;
    this.all = [];
    this.inbox = [];
    this.waiters = [];
    this.pending = new Map();
    this.closeWaiters = [];
    this.closed = false;
    this.closeInfo = null;
    this.n = 0;
    this.ws = null;
    sockets.push(this);
  }

  connect(timeoutMs = WAIT_MS) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let probing = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(this);
      };
      const failed = (why) => {
        if (settled || probing) return;
        probing = true;
        probeWs().then((p) => done(new Error(`${this.label}: không mở được WebSocket ${WS_URL} (${why}; ${p})`)));
      };
      const timer = setTimeout(() => {
        failed(`quá ${timeoutMs} ms`);
        try {
          this.ws.close();
        } catch (e) {
          /* bỏ qua */
        }
      }, timeoutMs);
      try {
        this.ws = new WebSocket(WS_URL);
      } catch (e) {
        done(e);
        return;
      }
      this.ws.binaryType = 'arraybuffer';
      this.ws.addEventListener('open', () => done());
      this.ws.addEventListener('error', (ev) => failed('lỗi ' + ((ev && ev.message) || 'không rõ')));
      this.ws.addEventListener('message', (ev) => this._onMessage(ev));
      this.ws.addEventListener('close', (ev) => {
        this._onClose(ev);
        failed('đóng mã ' + ev.code);
      });
    });
  }

  _onMessage(ev) {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
    let p = null;
    try {
      p = JSON.parse(raw);
    } catch (e) {
      p = null;
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) p = { type: '<gói không phải JSON object>', data: raw };
    if (p.data === undefined || p.data === null) p.data = {};
    p.at = Date.now();
    this.all.push(p);
    const rid = p.req_id === undefined || p.req_id === null ? null : String(p.req_id);
    if (rid !== null && this.pending.has(rid)) {
      const w = this.pending.get(rid);
      this.pending.delete(rid);
      clearTimeout(w.timer);
      w.resolve(p);
      return;
    }
    const i = this.waiters.findIndex((w) => matches(w.type, w.pred, p));
    if (i >= 0) {
      const w = this.waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(p);
      return;
    }
    this.inbox.push(p);
  }

  _onClose(ev) {
    if (this.closed) return;
    this.closed = true;
    this.closeInfo = { code: ev.code, reason: ev.reason || '' };
    const err = (what) => new Error(`${this.label}: kết nối đã đóng (mã ${ev.code}) khi đang chờ ${what}`);
    for (const w of this.pending.values()) {
      clearTimeout(w.timer);
      w.reject(err('trả lời ' + w.type));
    }
    this.pending.clear();
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(err('gói ' + w.type));
    }
    this.waiters = [];
    for (const f of this.closeWaiters) f(this.closeInfo);
    this.closeWaiters = [];
  }

  sendRaw(text) {
    if (this.closed) throw new Error(`${this.label}: kết nối đã đóng`);
    this.ws.send(text);
  }

  send(type, data) {
    this.sendRaw(JSON.stringify(data === undefined ? { type } : { type, data }));
  }

  // request gửi gói kèm req_id; resolve với gói trả lời cùng req_id (ack / error / auth.ok...).
  request(type, data, timeoutMs = WAIT_MS) {
    const reqId = `c-${this.label}-${++this.n}`;
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error(`${this.label}: kết nối đã đóng, không gửi được ${type}`));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`${this.label}: quá ${timeoutMs} ms không có trả lời cho ${type} (req_id ${reqId})`));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer, type });
      try {
        this.ws.send(JSON.stringify({ type, req_id: reqId, data }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(e);
      }
    });
  }

  waitFor(type, pred, timeoutMs = WAIT_MS) {
    const i = this.inbox.findIndex((p) => matches(type, pred, p));
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    if (this.closed) {
      return Promise.reject(new Error(`${this.label}: kết nối đã đóng (mã ${this.closeInfo.code}), không còn nhận gói ${type}`));
    }
    return new Promise((resolve, reject) => {
      const w = { type, pred, resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`${this.label}: quá ${timeoutMs} ms chưa nhận gói ${type}`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  mark() {
    return this.all.length;
  }

  since(mark, type, pred) {
    return this.all.slice(mark).filter((p) => matches(type, pred, p));
  }

  clear() {
    this.inbox = [];
  }

  waitClose(timeoutMs = WAIT_MS) {
    if (this.closed) return Promise.resolve(this.closeInfo);
    return new Promise((resolve, reject) => {
      const fn = (info) => {
        clearTimeout(t);
        resolve(info);
      };
      const t = setTimeout(() => {
        this.closeWaiters = this.closeWaiters.filter((f) => f !== fn);
        reject(new Error(`${this.label}: quá ${timeoutMs} ms kết nối chưa đóng`));
      }, timeoutMs);
      this.closeWaiters.push(fn);
    });
  }

  close() {
    if (!this.closed && this.ws) {
      try {
        this.ws.close(1000, 'chat-e2e');
      } catch (e) {
        /* bỏ qua */
      }
    }
  }
}

// waitPkt / reqPkt: như waitFor / request nhưng không ném lỗi - trả gói giả {type:'<...>', why} để bước kiểm báo LỖI
// rồi chạy tiếp.
async function waitPkt(c, type, pred, ms = WAIT_MS) {
  try {
    return await c.waitFor(type, pred, ms);
  } catch (e) {
    return { type: '<không nhận được>', data: {}, why: e.message };
  }
}

async function reqPkt(c, type, data, ms = WAIT_MS) {
  try {
    return await c.request(type, data, ms);
  } catch (e) {
    return { type: '<không có trả lời>', data: {}, why: e.message };
  }
}

const sendText = (c, conv, text, cmid = uuid(), ms = WAIT_MS) =>
  reqPkt(c, 'message.send', { conversation_id: conv, client_msg_id: cmid, msg_type: 'text', content: text }, ms);

function expectWsErr(name, p, code) {
  return check(p.type === 'error' && p.data.code === code, name, () => `mong error ${code}, nhận ${pktDetail(p)}`);
}

// openWs: kết nối + gói auth đầu tiên; lỗi xác thực -> ném (bước sau không có kết nối để dùng).
async function openWs(label, user) {
  const c = new WsClient(label, user);
  await c.connect();
  const r = await reqPkt(c, 'auth', { access_token: user.access, device_id: user.deviceId }, 10000);
  check(r.type === 'auth.ok' && r.data.user_id === user.id && isIso(r.data.server_time),
    `${label}: gói auth -> auth.ok {user_id ${user.label}, server_time}`, () => pktDetail(r));
  if (r.type !== 'auth.ok') throw new Error(`${label}: xác thực WebSocket thất bại: ${pktDetail(r)}`);
  return c;
}

// ───────────── tài khoản ─────────────

const U = {}; // A, B, C, D, E: {label, local, e164, cc, spaced, dotted, name, id, access, refresh, deviceId, otpAt, ws...}
const ctx = {};

async function signUp(label, o = {}) {
  const u = Object.assign({ label }, newPhone());
  u.name = o.name || 'Người dùng ' + u.local.slice(-4);
  const reqAs = o.requestAs || 'local';
  const r1 = await otpRequest(u[reqAs]);
  guardOtp(r1, label);
  u.otpAt = Date.now();
  expectOk(`${label}: otp/request (số dạng ${FORMAT_NAME[reqAs]}) -> phone ${u.e164}, expires_in 300, resend_after 60, dev_code 6 số`,
    r1, (x) => x.phone === u.e164 && x.expires_in === 300 && x.resend_after === 60);
  const otp = String(r1.result.dev_code);
  const device = { platform: 'web', name: 'chat-e2e ' + label };
  if (o.wrongFirst) {
    const wrong = otp.slice(0, 5) + String((Number(otp[5]) + 1) % 10);
    const rw = await rest('POST', '/auth/otp/verify', { body: { phone: u.e164, otp: wrong, device } });
    expectErr(`${label}: otp/verify sai mã -> 400 OTP_INVALID`, rw, 400, 'OTP_INVALID');
  }
  const verAs = o.verifyAs || 'local';
  const body = { phone: u[verAs], otp, device };
  if (o.name) body.display_name = o.name;
  const r2 = await rest('POST', '/auth/otp/verify', { body });
  if (!r2.ok || !r2.result || !r2.result.user) {
    check(false, `${label}: otp/verify (số dạng ${FORMAT_NAME[verAs]})`, brief(r2));
    throw new Error(`không tạo được tài khoản ${label}`);
  }
  const x = r2.result;
  check(x.is_new === true, `${label}: otp/verify (số dạng ${FORMAT_NAME[verAs]}) -> tài khoản mới, is_new true`, js(x.is_new));
  check(x.user.display_name === u.name,
    `${label}: display_name = "${u.name}"${o.name ? '' : ' (mặc định "Người dùng " + 4 số cuối)'}`, js(x.user));
  check(Number.isInteger(x.user.id) && x.user.phone === u.e164 && x.user.relation === 'self' && x.user.show_read_receipts === true &&
    isIso(x.user.created_at), `${label}: user là Me (id, phone E.164, relation self, show_read_receipts true, created_at)`, js(x.user));
  check(typeof x.access_token === 'string' && x.access_token.split('.').length === 3 && typeof x.refresh_token === 'string' &&
    x.refresh_token.length >= 32 && x.expires_in === 900 && Number.isInteger(x.device_id) && x.device_id > 0,
  `${label}: access_token (JWT), refresh_token, expires_in 900, device_id`, () => js(Object.assign({}, x, { user: undefined })));
  Object.assign(u, { id: x.user.id, access: x.access_token, refresh: x.refresh_token, deviceId: x.device_id });
  return u;
}

async function relation(viewer, target) {
  const r = await call(viewer, 'GET', '/users/search', undefined, { phone: target.local });
  return r.ok && r.result && r.result.user ? r.result.user.relation : `<${brief(r)}>`;
}

async function expectRel(viewer, target, want, why = '') {
  const got = await relation(viewer, target);
  check(got === want, `${viewer.label} nhìn ${target.label}: relation = ${want}${why}`, 'nhận ' + got);
}

async function expectFriends(a, b, yes = true) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const r = await call(x, 'GET', '/friends');
    if (yes) {
      expectOk(`${x.label}: GET /friends có ${y.label} (relation friend, có phone)`, r,
        (res) => res.friends.some((u) => u.id === y.id && u.relation === 'friend' && u.phone === y.e164));
    } else {
      expectOk(`${x.label}: GET /friends không còn ${y.label}`, r, (res) => Array.isArray(res.friends) && !res.friends.some((u) => u.id === y.id));
    }
  }
}

// ───────────── 1. OTP ─────────────

async function s1() {
  let r = await rest('GET', '/me');
  check(r.status === 401 && r.code === 'CHAT_NOAUTH' && r.error === NOAUTH_MSG,
    `REST không có token -> 401 CHAT_NOAUTH "${NOAUTH_MSG}"`, brief(r));
  r = await rest('GET', '/conversations', { token: 'abc.def.ghi' });
  expectErr('REST token rác dạng JWT -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');
  r = await rest('GET', '/friends', { token: 'eyJ1IjoxfQ.c2ln' });
  expectErr('REST token kiểu QS (body.sig) -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');

  for (const bad of ['12345', '0123456789', '0901234', '+84 1234', 'abc0901234567', '']) {
    r = await otpRequest(bad);
    if (r.status === 0 || r.status === 404) guardOtp(r, 'kiểm tra');
    expectErr(`otp/request số sai "${bad}" -> 400 PHONE_INVALID`, r, 400, 'PHONE_INVALID');
  }

  U.A = await signUp('A', { name: 'An E2E', requestAs: 'local', verifyAs: 'e164' });
  r = await otpRequest(U.A.cc);
  expectErr('A xin mã lần 2 ngay, dạng 84xxxxxxxxx -> 429 OTP_RATE_LIMIT (cùng một số sau chuẩn hoá, phải đợi 60 giây)',
    r, 429, 'OTP_RATE_LIMIT');
  U.B = await signUp('B', { name: 'Bình E2E', requestAs: 'spaced', verifyAs: 'cc', wrongFirst: true });
  U.C = await signUp('C', { requestAs: 'cc', verifyAs: 'local' });
  U.D = await signUp('D', { name: 'Dũng E2E', requestAs: 'dotted', verifyAs: 'local' });
  U.E = await signUp('E', { name: 'Em E2E' });

  const { A, B } = U;
  for (const f of ['local', 'cc', 'e164', 'dotted']) {
    r = await call(A, 'GET', '/users/search', undefined, { phone: B[f] });
    expectOk(`A tra số của B dạng ${FORMAT_NAME[f]} -> cùng tài khoản B`, r, (x) => x.user && x.user.id === B.id);
  }
  r = await call(A, 'GET', '/users/search', undefined, { phone: A.local });
  expectOk('A tra số của chính mình -> relation self', r, (x) => x.user && x.user.id === A.id && x.user.relation === 'self');
  r = await call(A, 'GET', '/users/search', undefined, { phone: 'abc' });
  expectErr('tra số sai -> 400 PHONE_INVALID', r, 400, 'PHONE_INVALID');
}

// ───────────── 2. Me ─────────────

async function s2() {
  const { A, B, C } = U;
  let r = await call(A, 'GET', '/me');
  expectOk('A: GET /me -> Me (id, display_name, phone, relation self, online false, show_read_receipts true, created_at)', r,
    (x) => x.id === A.id && x.display_name === A.name && x.phone === A.e164 && x.relation === 'self' && x.online === false &&
      x.show_read_receipts === true && isIso(x.created_at));

  r = await call(C, 'PATCH', '/me', { display_name: 'Châu E2E' });
  expectOk('C: PATCH /me display_name -> "Châu E2E"', r, (x) => x.id === C.id && x.display_name === 'Châu E2E');
  if (r.ok && r.result.display_name === 'Châu E2E') C.name = 'Châu E2E';
  r = await call(C, 'GET', '/me');
  expectOk('C: GET /me thấy tên mới', r, (x) => x.display_name === 'Châu E2E');

  r = await call(A, 'PATCH', '/me', { show_read_receipts: false });
  expectOk('A: PATCH /me show_read_receipts false (tên giữ nguyên)', r, (x) => x.show_read_receipts === false && x.display_name === A.name);
  r = await call(A, 'GET', '/me');
  expectOk('A: GET /me -> show_read_receipts false', r, (x) => x.show_read_receipts === false);
  r = await call(A, 'PATCH', '/me', { show_read_receipts: true });
  expectOk('A: PATCH /me show_read_receipts true', r, (x) => x.show_read_receipts === true);
  r = await call(A, 'PATCH', '/me', {});
  expectOk('A: PATCH /me thân rỗng -> giữ nguyên', r, (x) => x.display_name === A.name && x.show_read_receipts === true);
  r = await call(A, 'PATCH', '/me', { display_name: '   ' });
  expectErr('PATCH /me display_name toàn khoảng trắng -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await call(A, 'PATCH', '/me', { display_name: 'x'.repeat(101) });
  expectErr('PATCH /me display_name 101 ký tự -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');

  // access token: HS256, payload {sub, did, typ, iat, exp}; alg khác / sửa payload -> 401
  const [h, p, sig] = A.access.split('.');
  let head = null;
  let claims = null;
  try {
    head = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch (e) {
    /* kiểm bên dưới báo lỗi */
  }
  check(head && head.alg === 'HS256', 'access token: header alg HS256', js(head));
  check(claims && claims.typ === 'chat' && claims.sub === String(A.id) && claims.did === A.deviceId &&
    Number.isInteger(claims.iat) && claims.exp - claims.iat === 900, 'access token: payload {sub "<id>", did, typ "chat", iat, exp = iat + 900}', js(claims));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  r = await rest('GET', '/me', { token: b64({ alg: 'none', typ: 'JWT' }) + '.' + p + '.' });
  expectErr('token alg "none" -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');
  if (claims) {
    r = await rest('GET', '/me', { token: h + '.' + b64(Object.assign({}, claims, { sub: String(B.id) })) + '.' + sig });
    expectErr('token sửa sub (giữ chữ ký cũ) -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');
  }
}

// ───────────── 3. Danh bạ / bạn bè ─────────────

async function s3() {
  const { A, B, C, D, E } = U;
  let r = await call(A, 'GET', '/users/search', undefined, { phone: B.local });
  expectOk('A tra số B -> User B (relation none, có phone vì tra đúng số)', r,
    (x) => x.user && x.user.id === B.id && x.user.display_name === B.name && x.user.relation === 'none' &&
      x.user.phone === B.e164 && typeof x.user.online === 'boolean');
  const ghost = newPhone();
  r = await call(A, 'GET', '/users/search', undefined, { phone: ghost.local });
  expectOk('A tra số chưa đăng ký -> user null', r, (x) => x.user === null);

  r = await call(A, 'POST', '/contacts/match', { phones: [B.local, C.spaced, ghost.local, 'không phải số', A.e164] });
  expectOk('contacts/match theo số -> B và C, matched = đúng chuỗi đã gửi, không có số lạ', r, (x) => {
    const us = x.users.filter((u) => u.id !== A.id);
    const b = us.find((u) => u.id === B.id);
    const c = us.find((u) => u.id === C.id);
    return us.length === 2 && b && b.matched === B.local && b.phone === B.e164 && c && c.matched === C.spaced;
  });
  const hB = sha256hex(B.e164);
  const hD = sha256hex(D.e164);
  r = await call(A, 'POST', '/contacts/match', { phone_hashes: [hB, hD, sha256hex(ghost.e164), 'khong-phai-hash'] });
  expectOk('contacts/match theo sha256(E.164) -> B và D, matched = hash đã gửi', r, (x) => {
    const us = x.users.filter((u) => u.id !== A.id);
    const b = us.find((u) => u.id === B.id);
    const d = us.find((u) => u.id === D.id);
    return us.length === 2 && b && b.matched === hB && d && d.matched === hD;
  });
  r = await call(A, 'POST', '/contacts/match', { phones: [B.cc], phone_hashes: [hD] });
  expectOk('contacts/match gửi cả số lẫn hash -> B (matched số) và D (matched hash)', r, (x) => {
    const b = x.users.find((u) => u.id === B.id);
    const d = x.users.find((u) => u.id === D.id);
    return b && b.matched === B.cc && d && d.matched === hD;
  });
  r = await call(A, 'POST', '/contacts/match', { phones: Array.from({ length: 1001 }, () => ghost.local) });
  expectErr('contacts/match quá 1000 số -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');

  // A -> B, B chấp nhận
  r = await call(A, 'POST', '/friend-requests', { user_id: B.id });
  expectOk('A gửi lời mời kết bạn tới B -> status pending', r, (x) => x.status === 'pending');
  await expectRel(A, B, 'outgoing');
  await expectRel(B, A, 'incoming');
  r = await call(B, 'GET', '/friend-requests');
  expectOk('B: GET /friend-requests -> incoming có A (relation incoming, requested_at)', r,
    (x) => x.incoming.some((u) => u.id === A.id && u.relation === 'incoming' && isIso(u.requested_at)) && Array.isArray(x.outgoing));
  r = await call(A, 'GET', '/friend-requests');
  expectOk('A: GET /friend-requests -> outgoing có B', r,
    (x) => x.outgoing.some((u) => u.id === B.id && u.relation === 'outgoing' && isIso(u.requested_at)));
  r = await call(B, 'POST', `/friend-requests/${A.id}/accept`);
  expectOk('B chấp nhận lời mời của A -> status accepted', r, (x) => x.status === 'accepted');
  await expectFriends(A, B);
  await expectRel(A, B, 'friend');
  await expectRel(B, A, 'friend');
  r = await call(B, 'GET', '/friend-requests');
  expectOk('sau khi chấp nhận: B hết lời mời từ A', r, (x) => !x.incoming.some((u) => u.id === A.id));
  r = await call(A, 'POST', '/friend-requests', { user_id: B.id });
  expectOk('A mời B khi đã là bạn -> status accepted', r, (x) => x.status === 'accepted');

  // B -> C, rồi C -> B: tự thành bạn
  r = await call(B, 'POST', '/friend-requests', { user_id: C.id });
  expectOk('B mời C -> pending', r, (x) => x.status === 'pending');
  r = await call(C, 'POST', '/friend-requests', { user_id: B.id });
  expectOk('C mời lại B (B đã mời C trước) -> tự thành bạn, status accepted', r, (x) => x.status === 'accepted');
  await expectFriends(B, C);

  // từ chối
  r = await call(A, 'POST', '/friend-requests', { user_id: C.id });
  expectOk('A mời C -> pending', r, (x) => x.status === 'pending');
  r = await call(C, 'POST', `/friend-requests/${A.id}/reject`);
  expectOk('C từ chối lời mời của A -> {}', r);
  r = await call(C, 'GET', '/friend-requests');
  expectOk('sau khi từ chối: C hết lời mời từ A', r, (x) => !x.incoming.some((u) => u.id === A.id));
  r = await call(A, 'GET', '/friend-requests');
  expectOk('sau khi bị từ chối: outgoing của A không còn C', r, (x) => !x.outgoing.some((u) => u.id === C.id));
  await expectRel(A, C, 'none');

  // rút lời mời
  r = await call(A, 'POST', '/friend-requests', { user_id: C.id });
  expectOk('A mời C lần nữa -> pending', r, (x) => x.status === 'pending');
  await expectRel(C, A, 'incoming');
  r = await call(A, 'DELETE', `/friend-requests/${C.id}`);
  expectOk('A rút lời mời gửi C -> {}', r);
  r = await call(C, 'GET', '/friend-requests');
  expectOk('sau khi rút: C không còn lời mời từ A', r, (x) => !x.incoming.some((u) => u.id === A.id));
  await expectRel(C, A, 'none');

  // chấp nhận: A-C, A-D
  r = await call(A, 'POST', '/friend-requests', { user_id: C.id });
  expectOk('A mời C lần ba -> pending', r, (x) => x.status === 'pending');
  r = await call(C, 'POST', `/friend-requests/${A.id}/accept`);
  expectOk('C chấp nhận A -> accepted', r, (x) => x.status === 'accepted');
  await expectFriends(A, C);
  r = await call(A, 'POST', '/friend-requests', { user_id: D.id });
  expectOk('A mời D -> pending', r, (x) => x.status === 'pending');
  r = await call(D, 'POST', `/friend-requests/${A.id}/accept`);
  expectOk('D chấp nhận A -> accepted', r, (x) => x.status === 'accepted');
  await expectFriends(A, D);

  r = await call(E, 'POST', `/friend-requests/${A.id}/accept`);
  expectReject('E chấp nhận khi A chưa mời -> bị từ chối', r);
  await expectRel(A, E, 'none');

  // huỷ kết bạn B-C
  r = await call(B, 'DELETE', `/friends/${C.id}`);
  expectOk('B huỷ kết bạn với C -> {}', r);
  await expectFriends(B, C, false);
  await expectRel(B, C, 'none');

  r = await call(A, 'GET', '/friends');
  expectOk('A: GET /friends -> đúng B, C, D, sắp theo tên', r,
    (x) => x.friends.map((u) => u.id).join() === [B.id, C.id, D.id].join());
}

// ───────────── 4. Chat 1-1 + giao thức WebSocket ─────────────

async function s4() {
  const { A, B } = U;
  let r = await call(A, 'POST', '/conversations', { type: 'direct', user_id: B.id });
  const d = expectOk('A tạo chat 1-1 với B -> ConversationDetail (direct, peer B, 2 thành viên, last_seq 0)', r,
    (x) => x.type === 'direct' && x.name === null && x.peer && x.peer.id === B.id && x.peer.relation === 'friend' &&
      x.member_count === 2 && x.role === 'member' && x.last_seq === 0 && x.unread === 0 && x.left === false &&
      x.last_message === null && x.muted_until === null && isIso(x.created_at) && isIso(x.updated_at) &&
      x.members.length === 2 && member(x, A.id) && member(x, B.id));
  if (!d || !d.id) throw new Error('không tạo được hội thoại 1-1 A-B');
  const dc = (ctx.direct = d.id);
  r = await call(A, 'POST', '/conversations', { type: 'direct', user_id: B.id });
  expectOk('A tạo lại chat 1-1 với B -> cùng id', r, (x) => x.id === dc);
  r = await call(B, 'POST', '/conversations', { type: 'direct', user_id: A.id });
  expectOk('B tạo chat 1-1 với A -> cùng id (direct_pairs)', r, (x) => x.id === dc && x.peer && x.peer.id === A.id);

  A.ws = await openWs('A#1', A);
  B.ws = await openWs('B#1', B);
  A.ws.send('ping');
  const pong = await waitPkt(A.ws, 'pong');
  check(pong.type === 'pong', 'WS: ping -> pong', () => pktDetail(pong));

  // giao thức: trước auth / token sai / JSON hỏng / loại lạ / khung quá lớn
  const w1 = new WsClient('X#trước-auth');
  await w1.connect();
  w1.send('ping');
  let e = await waitPkt(w1, 'error');
  check(e.data.code === 'UNAUTHENTICATED', 'WS: gói khác "auth" khi chưa xác thực -> error UNAUTHENTICATED', () => pktDetail(e));
  let cl = await settle(w1.waitClose());
  check(cl.ok && cl.value.code === 4401, 'WS: gói khác "auth" khi chưa xác thực -> server đóng mã 4401', () => (cl.ok ? js(cl.value) : cl.error.message));

  const w2 = new WsClient('X#token-sai');
  await w2.connect();
  e = await reqPkt(w2, 'auth', { access_token: 'abc.def.ghi', device_id: A.deviceId });
  check(e.type === 'error' && ['AUTH_FAILED', 'CHAT_NOAUTH'].includes(e.data.code), 'WS: auth bằng token sai -> error AUTH_FAILED', () => pktDetail(e));
  cl = await settle(w2.waitClose());
  check(cl.ok && cl.value.code === 4401, 'WS: auth bằng token sai -> server đóng mã 4401', () => (cl.ok ? js(cl.value) : cl.error.message));

  A.ws.sendRaw('{không phải json');
  e = await waitPkt(A.ws, 'error', (x) => x.code === 'BAD_REQUEST');
  check(e.type === 'error', 'WS: JSON hỏng -> error BAD_REQUEST', () => pktDetail(e));
  e = await reqPkt(A.ws, 'khong.co.loai.nay', {});
  check(e.type === 'error' && e.data.code === 'UNKNOWN_TYPE', 'WS: loại gói lạ -> error UNKNOWN_TYPE (khớp req_id)', () => pktDetail(e));
  check(!A.ws.closed, 'WS: gói lỗi không làm đóng kết nối', () => js(A.ws.closeInfo));

  const wBig = await openWs('A#khung-lớn', A);
  wBig.sendRaw(JSON.stringify({ type: 'message.send', data: { conversation_id: dc, client_msg_id: uuid(), msg_type: 'text', content: 'x'.repeat(40 * 1024) } }));
  cl = await settle(wBig.waitClose());
  check(cl.ok, `WS: khung > 32 KiB -> server đóng kết nối${cl.ok ? ' (mã ' + cl.value.code + ')' : ''}`, () => (cl.ok ? '' : cl.error.message));

  // gửi tin đầu tiên
  const cm1 = uuid();
  const text1 = 'Xin chào Bình, tin đầu tiên ' + RUN;
  const ack = await sendText(A.ws, dc, text1, cm1);
  check(ack.type === 'ack' && ack.data.conversation_id === dc && ack.data.seq === 1 && ack.data.client_msg_id === cm1 &&
    ack.data.duplicate === false && ack.data.message_id > 0 && isIso(ack.data.created_at),
  'A message.send -> ack {conversation_id, client_msg_id, message_id, seq 1, created_at, duplicate false}', () => pktDetail(ack));
  let m = await waitPkt(B.ws, 'message.new', (x) => x.client_msg_id === cm1);
  check(m.data.id === ack.data.message_id && m.data.conversation_id === dc && m.data.seq === 1 && m.data.sender_id === A.id &&
    m.data.sender_name === A.name && m.data.msg_type === 'text' && m.data.content === text1 && isIso(m.data.created_at),
  'B nhận message.new (Message đủ trường, seq 1)', () => pktDetail(m));

  r = await call(B, 'GET', '/conversations');
  expectOk('B: GET /conversations trước khi đọc -> unread 1, last_read_seq 0, last_message seq 1, peer A online', r, (x) => {
    const c = findConv(x.conversations, dc);
    return c && c.unread === 1 && c.last_seq === 1 && c.last_read_seq === 0 && c.last_message && c.last_message.seq === 1 &&
      c.last_message.content === text1 && c.peer && c.peer.id === A.id && c.peer.online === true &&
      isIso(c.last_message_at) && /^\d+$/.test(x.sync_cursor) && x.next_cursor === null;
  });
  r = await call(A, 'GET', '/conversations');
  expectOk('A: GET /conversations -> tin của mình không tính chưa đọc (unread 0, last_read_seq 1)', r, (x) => {
    const c = findConv(x.conversations, dc);
    return c && c.unread === 0 && c.last_read_seq === 1 && c.last_seq === 1;
  });

  // gửi trùng
  const mark = B.ws.mark();
  const dup = await sendText(A.ws, dc, text1, cm1);
  check(dup.type === 'ack' && dup.data.duplicate === true && dup.data.seq === 1 && dup.data.message_id === ack.data.message_id,
    'gửi lại cùng client_msg_id -> ack duplicate true, cùng seq và message_id', () => pktDetail(dup));
  await sleep(QUIET_MS);
  const extra = B.ws.since(mark, 'message.new', (x) => x.conversation_id === dc);
  check(extra.length === 0, 'B không nhận thêm message.new khi A gửi trùng', js(extra));

  // đã nhận / đã xem
  A.ws.clear();
  B.ws.clear();
  let rr = await reqPkt(B.ws, 'message.delivered', { conversation_id: dc, seq: 1 });
  check(rr.type === 'ack', 'B message.delivered seq 1 -> ack', () => pktDetail(rr));
  let ru = await waitPkt(A.ws, 'receipt.update', (x) => x.conversation_id === dc && x.user_id === B.id && x.delivered_seq === 1);
  check(ru.data.read_seq === 0, 'A nhận receipt.update {conversation_id, user_id B, delivered_seq 1, read_seq 0}', () => pktDetail(ru));
  rr = await reqPkt(B.ws, 'message.read', { conversation_id: dc, seq: 1 });
  check(rr.type === 'ack', 'B message.read seq 1 -> ack', () => pktDetail(rr));
  ru = await waitPkt(A.ws, 'receipt.update', (x) => x.conversation_id === dc && x.user_id === B.id && x.read_seq === 1);
  check(ru.data.delivered_seq === 1, 'A nhận receipt.update {delivered_seq 1, read_seq 1}', () => pktDetail(ru));
  const own = await waitPkt(B.ws, 'receipt.update', (x) => x.conversation_id === dc && x.user_id === B.id && x.read_seq === 1);
  check(own.type === 'receipt.update', 'kết nối của chính B cũng nhận receipt.update', () => pktDetail(own));
  r = await call(B, 'GET', '/conversations');
  expectOk('B: GET /conversations sau khi đọc -> unread 0, last_read_seq 1, last_delivered_seq 1', r, (x) => {
    const c = findConv(x.conversations, dc);
    return c && c.unread === 0 && c.last_read_seq === 1 && c.last_delivered_seq === 1;
  });
  rr = await reqPkt(B.ws, 'message.read', { conversation_id: dc, seq: 999 });
  check(rr.type === 'ack', 'B message.read seq 999 -> ack', () => pktDetail(rr));
  r = await call(B, 'GET', '/conversations');
  expectOk('message.read seq 999 bị kẹp về last_seq (last_read_seq vẫn 1)', r, (x) => {
    const c = findConv(x.conversations, dc);
    return c && c.last_read_seq === 1 && c.last_delivered_seq === 1;
  });

  // kiểm tra nội dung
  const bad = async (name, patch, code) => {
    const x = await reqPkt(A.ws, 'message.send', Object.assign({ conversation_id: dc, client_msg_id: uuid(), msg_type: 'text', content: 'ok' }, patch));
    expectWsErr(name, x, code);
  };
  await bad('nội dung 4001 ký tự -> error BAD_REQUEST', { content: 'a'.repeat(4001) }, 'BAD_REQUEST');
  await bad('nội dung rỗng -> error BAD_REQUEST', { content: '' }, 'BAD_REQUEST');
  await bad('nội dung toàn khoảng trắng -> error BAD_REQUEST', { content: '   \n\t ' }, 'BAD_REQUEST');
  await bad('msg_type khác "text" -> error BAD_REQUEST', { msg_type: 'image' }, 'BAD_REQUEST');
  await bad('client_msg_id không phải UUID -> error BAD_REQUEST', { client_msg_id: 'khong-phai-uuid' }, 'BAD_REQUEST');
  await bad('gửi vào hội thoại không phải thành viên -> error FORBIDDEN', { conversation_id: 999999999999 }, 'FORBIDDEN');
  const cmBig = uuid();
  const big = 'ạ'.repeat(4000);
  const ackBig = await sendText(A.ws, dc, big, cmBig);
  check(ackBig.type === 'ack' && ackBig.data.seq === 2, 'nội dung đúng 4000 ký tự có dấu -> ack seq 2', () => pktDetail(ackBig));
  m = await waitPkt(B.ws, 'message.new', (x) => x.client_msg_id === cmBig);
  check(m.data.content === big, 'B nhận đủ 4000 ký tự', () => m.why || 'độ dài ' + content(m).length);
}

// ───────────── 5. Đang soạn tin ─────────────

async function s5() {
  const { A, B } = U;
  const dc = ctx.direct;
  A.ws2 = await openWs('A#2', A);
  B.ws.clear();
  const mA1 = A.ws.mark();
  const mA2 = A.ws2.mark();
  A.ws.send('typing.start', { conversation_id: dc });
  let t = await waitPkt(B.ws, 'typing', (x) => x.conversation_id === dc && x.user_id === A.id && x.is_typing === true);
  check(t.type === 'typing', 'A typing.start -> B nhận typing {conversation_id, user_id A, is_typing true}', () => pktDetail(t));
  A.ws.send('typing.stop', { conversation_id: dc });
  t = await waitPkt(B.ws, 'typing', (x) => x.conversation_id === dc && x.user_id === A.id && x.is_typing === false);
  check(t.type === 'typing', 'A typing.stop -> B nhận typing is_typing false', () => pktDetail(t));
  await sleep(QUIET_MS);
  const self = A.ws2.since(mA2, 'typing').concat(A.ws.since(mA1, 'typing'));
  check(self.length === 0, 'các kết nối của chính A (kể cả kết nối thứ 2) không nhận typing của A', js(self));

  await sleep(1100);
  const mB = B.ws.mark();
  A.ws.send('typing.start', { conversation_id: dc });
  A.ws.send('typing.start', { conversation_id: dc });
  await sleep(QUIET_MS);
  const n = B.ws.since(mB, 'typing', (x) => x.user_id === A.id && x.is_typing === true).length;
  check(n === 1, 'typing.start lặp lại trong 1 giây -> chỉ chuyển 1 lần', `B nhận ${n} gói typing`);
  A.ws.send('typing.stop', { conversation_id: dc });
  await waitPkt(B.ws, 'typing', (x) => x.user_id === A.id && x.is_typing === false);

  A.ws.clear();
  A.ws2.clear();
  B.ws.send('typing.start', { conversation_id: dc });
  const [t1, t2] = await Promise.all([
    waitPkt(A.ws, 'typing', (x) => x.user_id === B.id && x.is_typing === true),
    waitPkt(A.ws2, 'typing', (x) => x.user_id === B.id && x.is_typing === true),
  ]);
  check(t1.type === 'typing' && t2.type === 'typing', 'B typing.start -> cả 2 kết nối của A nhận', () => pktDetail(t1.why ? t1 : t2));
  B.ws.send('typing.stop', { conversation_id: dc });
}

// ───────────── 6. Online (phần nhanh) ─────────────

async function s6() {
  const { A, B, E } = U;
  B.ws.clear();
  const mB = B.ws.mark();
  B.ws.send('presence.subscribe', { user_ids: [A.id, E.id] });
  const p = await waitPkt(B.ws, 'presence.update', (x) => x.user_id === A.id);
  check(p.data.online === true && p.data.last_seen === null,
    'B presence.subscribe [A, E] -> ngay presence.update {user_id A, online true, last_seen null}', () => pktDetail(p));
  await sleep(QUIET_MS);
  const ofE = B.ws.since(mB, 'presence.update', (x) => x.user_id === E.id);
  check(ofE.length === 0, 'không nhận presence của E (không là bạn, không chung hội thoại)', js(ofE));
  let r = await call(B, 'GET', '/friends');
  expectOk('B: GET /friends -> A online true (A đang có kết nối)', r, (x) => x.friends.some((u) => u.id === A.id && u.online === true));
  r = await call(A, 'GET', '/me');
  expectOk('A: GET /me khi đang kết nối -> online true', r, (x) => x.online === true);
  if (SKIP_SLOW) skip('presence offline sau OfflineGrace', 'SKIP_SLOW=1');
  else note('phần offline sau OfflineGrace chạy ở mục 15 (phần chậm)');
}

// ───────────── 7. Nhiều kết nối ─────────────

async function s7() {
  const { A, B } = U;
  const dc = ctx.direct;
  const cm = uuid();
  const ack = await sendText(B.ws, dc, 'Bình gửi tới mọi kết nối của An ' + RUN, cm);
  check(ack.type === 'ack', 'B gửi tin -> ack', () => pktDetail(ack));
  const [m1, m2] = await Promise.all([
    waitPkt(A.ws, 'message.new', (x) => x.client_msg_id === cm),
    waitPkt(A.ws2, 'message.new', (x) => x.client_msg_id === cm),
  ]);
  check(m1.type === 'message.new' && m1.data.seq === ack.data.seq, 'kết nối 1 của A nhận tin của B', () => pktDetail(m1));
  check(m2.type === 'message.new' && m2.data.seq === ack.data.seq, 'kết nối 2 của A nhận tin của B', () => pktDetail(m2));
  const cm2 = uuid();
  const ack2 = await sendText(A.ws, dc, 'An gửi từ kết nối 1 ' + RUN, cm2);
  check(ack2.type === 'ack' && ack2.data.seq === ack.data.seq + 1, 'A gửi từ kết nối 1 -> ack seq kế tiếp', () => pktDetail(ack2));
  const m3 = await waitPkt(A.ws2, 'message.new', (x) => x.client_msg_id === cm2);
  check(m3.data.sender_id === A.id && m3.data.seq === ack2.data.seq, 'tin A gửi từ kết nối 1 hiện trên kết nối 2 của A', () => pktDetail(m3));
  const m4 = await waitPkt(B.ws, 'message.new', (x) => x.client_msg_id === cm2);
  check(m4.type === 'message.new', 'B nhận tin A gửi', () => pktDetail(m4));
  const r = await call(A, 'GET', '/conversations');
  expectOk('A gửi tin -> con trỏ đã xem của A = seq đó (unread 0 dù chưa đọc tin trước của B)', r, (x) => {
    const c = findConv(x.conversations, dc);
    return c && c.unread === 0 && c.last_read_seq === ack2.data.seq;
  });
}

// ───────────── 8. Thứ tự ─────────────

async function s8() {
  const { A, B } = U;
  const dc = ctx.direct;
  const N = 30;
  await sleep(1100); // hồi lượt gửi (20 tin / giây / người)
  const ids = Array.from({ length: N }, () => uuid());
  const texts = ids.map((_, i) => `Thứ tự ${i + 1}/${N} ${RUN}`);
  const acks = new Map();
  const markB = B.ws.mark();
  const classify = (list, idx) => {
    const limited = [];
    const others = [];
    list.forEach((x, k) => {
      const i = idx[k];
      if (x.type === 'ack') acks.set(ids[i], x.data);
      else if (x.type === 'error' && x.data.code === 'RATE_LIMIT') limited.push(i);
      else others.push({ tin: i + 1, nhan: x.why || x });
    });
    return { limited, others };
  };
  const all = ids.map((_, i) => i);
  // gửi liền 30 gói, không chờ ack giữa các lần gửi
  const first = await Promise.all(all.map((i) => sendText(A.ws, dc, texts[i], ids[i], 20000)));
  let { limited, others } = classify(first, all);
  check(others.length === 0, `gửi liền ${N} tin không chờ ack -> mỗi tin có ack hoặc RATE_LIMIT (${acks.size} ack, ${limited.length} RATE_LIMIT)`,
    js(others.slice(0, 3)));
  check(acks.size >= Math.min(N, 20), 'ít nhất 20 tin được nhận ngay (giới hạn 20 tin / giây / người)', `chỉ ${acks.size} ack`);
  const firstSeqs = all.filter((i) => acks.has(ids[i])).map((i) => acks.get(ids[i]).seq);
  check(firstSeqs.every((s, k) => k === 0 || s > firstSeqs[k - 1]), 'seq trong ack tăng đúng thứ tự gửi', firstSeqs.join(','));
  if (limited.length) note(`${limited.length} tin bị RATE_LIMIT (20 tin / giây) - gửi lại cùng client_msg_id sau 1,1 giây như outbox`);
  for (let round = 1; limited.length && round <= 5; round++) {
    await sleep(1100);
    const idx = limited;
    const res = await Promise.all(idx.map((i) => sendText(A.ws, dc, texts[i], ids[i], 20000)));
    ({ limited, others } = classify(res, idx));
    if (others.length) check(false, `gửi lại lượt ${round}`, js(others.slice(0, 3)));
  }
  const seqs = ids.map((id) => (acks.get(id) || {}).seq).filter((s) => Number.isInteger(s));
  const sorted = [...seqs].sort((a, b) => a - b);
  check(seqs.length === N, `đủ ${N} ack (kể cả tin gửi lại)`, `có ${seqs.length}`);
  check(new Set(seqs).size === seqs.length && seqs.length > 0 && sorted[sorted.length - 1] - sorted[0] === seqs.length - 1,
    `${N} seq không trùng, liên tiếp (${sorted[0]}..${sorted[sorted.length - 1]})`, sorted.join(','));
  check([...acks.values()].every((a) => a.duplicate === false), 'mọi ack duplicate false', js([...acks.values()].filter((a) => a.duplicate !== false)));
  const idSet = new Set(ids);
  const getB = () => B.ws.since(markB, 'message.new', (x) => x.conversation_id === dc && idSet.has(x.client_msg_id));
  await waitUntil(() => getB().length >= N, 10000);
  const got = getB().map((p) => p.data.seq);
  check(got.length === N, `B nhận đủ ${N} message.new`, `nhận ${got.length}`);
  check(got.every((s, k) => k === 0 || s > got[k - 1]), 'B nhận message.new đúng thứ tự seq tăng dần', got.join(','));
  check(got.join() === sorted.join(), 'seq B nhận khớp seq trong ack', `B: ${got.join(',')} | ack: ${sorted.join(',')}`);
  await sleep(1100);
}

// ───────────── 9. Nhóm ─────────────

async function s9() {
  const { A, B, C, D, E } = U;
  C.ws = await openWs('C#1', C);
  D.ws = await openWs('D#1', D);
  let r = await call(C, 'GET', '/conversations');
  const lc = expectOk('C: GET /conversations -> sync_cursor (mili giây)', r, (x) => Array.isArray(x.conversations) && /^\d+$/.test(x.sync_cursor));
  C.syncCursor = lc && lc.sync_cursor ? lc.sync_cursor : String(Date.now() - 60000);

  r = await call(A, 'POST', '/conversations', { type: 'group', name: 'Nhóm lỗi ' + RUN, member_ids: [B.id, E.id] });
  expectReject('tạo nhóm có người không phải bạn của A (E) -> bị từ chối', r);
  r = await call(A, 'POST', '/conversations', { type: 'group', name: 'Nhóm trống ' + RUN, member_ids: [] });
  expectErr('tạo nhóm không có thành viên khác -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await call(A, 'POST', '/conversations', { type: 'group', name: '   ', member_ids: [B.id] });
  expectErr('tạo nhóm tên trống -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await call(A, 'POST', '/conversations', { type: 'group', name: 'n'.repeat(101), member_ids: [B.id] });
  expectErr('tạo nhóm tên 101 ký tự -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');

  const name1 = 'Nhóm E2E ' + RUN;
  r = await call(A, 'POST', '/conversations', { type: 'group', name: name1, member_ids: [B.id, C.id] });
  const g = expectOk('A tạo nhóm với B, C -> ConversationDetail (group, owner, 3 thành viên, tin hệ thống seq 1)', r,
    (x) => x.type === 'group' && x.name === name1 && x.peer === null && x.role === 'owner' && x.member_count === 3 &&
      x.last_seq === 1 && x.last_message && x.last_message.msg_type === 'system' && x.last_message.content.includes('đã tạo nhóm') &&
      x.members.length === 3 && member(x, A.id).role === 'owner' && member(x, B.id).role === 'member' && member(x, C.id).role === 'member');
  if (!g || !g.id) throw new Error('không tạo được nhóm');
  const gid = (ctx.group = g.id);
  const sys = (x, s) => x.conversation_id === gid && x.msg_type === 'system' && String(x.content || '').includes(s);
  for (const u of [B, C]) {
    const m = await waitPkt(u.ws, 'message.new', (x) => x.conversation_id === gid && x.seq === 1);
    check(m.data.msg_type === 'system' && content(m).includes('đã tạo nhóm') && content(m).includes(name1) &&
      m.data.client_msg_id === null && m.data.sender_id === A.id, `${u.label} nhận tin hệ thống "đã tạo nhóm" seq 1`, () => pktDetail(m));
  }

  // đổi tên
  const name2 = name1 + ' (đổi tên)';
  r = await call(A, 'PATCH', `/conversations/${gid}`, { name: name2 });
  expectOk('A (trưởng nhóm) đổi tên nhóm -> ConversationDetail tên mới', r, (x) => x.id === gid && x.name === name2);
  for (const u of [B, C]) {
    const m = await waitPkt(u.ws, 'message.new', (x) => sys(x, 'đã đổi tên nhóm'));
    check(content(m).includes(name2) && m.data.seq === 2, `${u.label} nhận tin hệ thống đổi tên nhóm (seq 2)`, () => pktDetail(m));
  }
  r = await call(B, 'GET', '/conversations');
  expectOk('B: danh sách hội thoại có nhóm với tên mới', r, (x) => {
    const c = findConv(x.conversations, gid);
    return c && c.name === name2 && c.type === 'group' && c.peer === null;
  });
  r = await call(B, 'PATCH', `/conversations/${gid}`, { name: 'B đổi tên' });
  expectErr('B (thành viên thường) đổi tên nhóm -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');

  // thêm thành viên
  r = await call(A, 'POST', `/conversations/${gid}/members`, { user_ids: [E.id] });
  expectReject('A thêm E (không phải bạn) vào nhóm -> bị từ chối', r);
  r = await call(A, 'POST', `/conversations/${gid}/members`, { user_ids: [D.id] });
  expectOk('A thêm D (bạn) vào nhóm -> 4 thành viên, D là member', r, (x) => x.member_count === 4 && member(x, D.id).role === 'member');
  for (const u of [C, D]) {
    const m = await waitPkt(u.ws, 'message.new', (x) => sys(x, 'đã thêm'));
    check(content(m).includes(D.name), `${u.label} nhận tin hệ thống "đã thêm ${D.name} vào nhóm"`, () => pktDetail(m));
  }
  r = await call(D, 'GET', '/conversations');
  expectOk('D thấy nhóm: role member, chưa đọc tối đa 1 (con trỏ đặt ở tin lúc vào nhóm)', r, (x) => {
    const c = findConv(x.conversations, gid);
    return c && c.role === 'member' && c.unread <= 1 && c.left === false;
  });

  // quyền
  r = await call(B, 'DELETE', `/conversations/${gid}/members/${C.id}`);
  expectErr('B (thành viên thường) xoá C -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  r = await call(A, 'PATCH', `/conversations/${gid}/members/${B.id}`, { role: 'admin' });
  expectOk('A (trưởng nhóm) đặt B làm phó nhóm -> role admin', r, (x) => member(x, B.id).role === 'admin');
  let m = await waitPkt(C.ws, 'message.new', (x) => sys(x, 'quản trị viên'));
  check(content(m).includes(B.name), 'C nhận tin hệ thống "đã đặt B làm quản trị viên"', () => pktDetail(m));
  r = await call(B, 'PATCH', `/conversations/${gid}/members/${C.id}`, { role: 'admin' });
  expectErr('B (phó nhóm) đổi quyền C -> 403 FORBIDDEN (chỉ trưởng nhóm)', r, 403, 'FORBIDDEN');
  r = await call(B, 'DELETE', `/conversations/${gid}/members/${A.id}`);
  expectErr('B (phó nhóm) xoá trưởng nhóm A -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');

  // phó nhóm xoá thành viên
  r = await call(B, 'DELETE', `/conversations/${gid}/members/${C.id}`);
  expectOk('B (phó nhóm) xoá C (thành viên) -> {}', r);
  m = await waitPkt(C.ws, 'message.new', (x) => sys(x, 'đã xoá'));
  check(content(m).includes(C.name) && m.data.sender_id === B.id, 'C (bị xoá) vẫn nhận tin hệ thống "B đã xoá C khỏi nhóm"', () => pktDetail(m));
  m = await waitPkt(D.ws, 'message.new', (x) => sys(x, 'đã xoá'));
  check(m.type === 'message.new', 'D (còn trong nhóm) nhận tin hệ thống xoá C', () => pktDetail(m));
  r = await call(C, 'GET', `/conversations/${gid}`);
  expectErr('C GET /conversations/:id sau khi bị xoá -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  r = await call(C, 'GET', `/conversations/${gid}/messages`);
  expectErr('C đọc lịch sử nhóm sau khi bị xoá -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  const cs = await sendText(C.ws, gid, 'C còn gửi được không?');
  expectWsErr('C gửi tin vào nhóm sau khi bị xoá -> error FORBIDDEN', cs, 'FORBIDDEN');
  r = await call(C, 'GET', '/conversations');
  expectOk('C: GET /conversations không còn nhóm', r, (x) => !findConv(x.conversations, gid));
  r = await call(C, 'GET', '/sync', undefined, { cursor: C.syncCursor });
  expectOk('C: /sync?cursor=<trước khi vào nhóm> -> nhóm có left: true', r, (x) => {
    const c = findConv(x.conversations, gid);
    return c && c.left === true;
  });

  // đã xem trong nhóm
  const markC = C.ws.mark();
  const cmg = uuid();
  const ag = await sendText(A.ws, gid, 'Chào cả nhóm ' + RUN, cmg);
  check(ag.type === 'ack', 'A gửi tin vào nhóm -> ack', () => pktDetail(ag));
  const gs = ag.data.seq;
  for (const u of [B, D]) {
    const x = await waitPkt(u.ws, 'message.new', (y) => y.client_msg_id === cmg);
    check(x.data.seq === gs && x.data.msg_type === 'text', `${u.label} nhận tin nhóm của A (seq ${gs})`, () => pktDetail(x));
  }
  await sleep(QUIET_MS);
  check(C.ws.since(markC, 'message.new', (x) => x.conversation_id === gid).length === 0, 'C (đã bị xoá) không nhận tin mới của nhóm');
  A.ws.clear();
  let rr = await reqPkt(B.ws, 'message.read', { conversation_id: gid, seq: gs });
  check(rr.type === 'ack', `B message.read seq ${gs} trong nhóm -> ack`, () => pktDetail(rr));
  let ru = await waitPkt(A.ws, 'receipt.update', (x) => x.conversation_id === gid && x.user_id === B.id && x.read_seq === gs);
  check(ru.data.delivered_seq === gs, 'A nhận receipt.update của B trong nhóm (delivered_seq = read_seq)', () => pktDetail(ru));
  r = await call(A, 'GET', `/conversations/${gid}`);
  expectOk('A: chi tiết nhóm -> members[B].last_read_seq = seq B vừa đọc', r, (x) => member(x, B.id).last_read_seq === gs);

  r = await call(D, 'PATCH', '/me', { show_read_receipts: false });
  expectOk('D tắt "cho người khác biết tôi đã xem" (show_read_receipts false)', r, (x) => x.show_read_receipts === false);
  A.ws.clear();
  D.ws.clear();
  rr = await reqPkt(D.ws, 'message.read', { conversation_id: gid, seq: gs });
  check(rr.type === 'ack', 'D message.read -> ack', () => pktDetail(rr));
  ru = await waitPkt(A.ws, 'receipt.update', (x) => x.conversation_id === gid && x.user_id === D.id);
  check(ru.type === 'receipt.update' && ru.data.read_seq === null && ru.data.delivered_seq === gs,
    'A nhận receipt.update của D: read_seq null (bị che), delivered_seq vẫn có', () => pktDetail(ru));
  const ownD = await waitPkt(D.ws, 'receipt.update', (x) => x.conversation_id === gid && x.user_id === D.id);
  check(ownD.data.read_seq === gs, 'kết nối của chính D vẫn nhận read_seq thật', () => pktDetail(ownD));
  r = await call(A, 'GET', `/conversations/${gid}`);
  expectOk('A: chi tiết nhóm -> members[D].last_read_seq null, last_delivered_seq có', r,
    (x) => member(x, D.id).last_read_seq === null && member(x, D.id).last_delivered_seq === gs);
  r = await call(D, 'GET', `/conversations/${gid}`);
  expectOk('D: chi tiết nhóm -> last_read_seq của chính D không bị che', r, (x) => member(x, D.id).last_read_seq === gs);

  // trưởng nhóm rời
  A.ws.clear();
  r = await call(A, 'DELETE', `/conversations/${gid}/members/${A.id}`);
  expectOk('A (trưởng nhóm) rời nhóm -> {}', r);
  for (const u of [A, D]) {
    m = await waitPkt(u.ws, 'message.new', (x) => sys(x, 'đã rời nhóm'));
    check(m.data.sender_id === A.id && content(m).includes(A.name),
      `${u.label} nhận tin hệ thống "${A.name} đã rời nhóm"${u === A ? ' (người rời cũng nhận)' : ''}`, () => pktDetail(m));
  }
  r = await call(B, 'GET', `/conversations/${gid}`);
  expectOk('trưởng nhóm rời -> B (phó nhóm vào sớm nhất) thành trưởng nhóm', r,
    (x) => x.role === 'owner' && member(x, B.id).role === 'owner' && !member(x, A.id) && x.member_count === 2);
  r = await call(A, 'GET', `/conversations/${gid}`);
  expectErr('A GET nhóm sau khi rời -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  r = await call(B, 'POST', `/conversations/${gid}/members`, { user_ids: [A.id] });
  expectOk('B (trưởng nhóm mới) thêm lại A -> A là member, 3 thành viên', r, (x) => member(x, A.id).role === 'member' && x.member_count === 3);
  r = await call(A, 'GET', '/conversations');
  expectOk('A thấy lại nhóm: left false, role member, chưa đọc tối đa 1', r, (x) => {
    const c = findConv(x.conversations, gid);
    return c && c.left === false && c.role === 'member' && c.unread <= 1;
  });
}

// ───────────── 10. Lịch sử + đồng bộ ─────────────

async function s10() {
  const { A, B } = U;
  const dc = ctx.direct;
  let r = await call(B, 'GET', `/conversations/${dc}`);
  const det = expectOk('B: chi tiết chat 1-1 (lấy last_seq, > 10 tin)', r, (x) => x.id === dc && x.last_seq > 10);
  const L = det ? det.last_seq : 0;
  if (!L) throw new Error('không đọc được last_seq của chat 1-1');
  const q = (o) => call(B, 'GET', `/conversations/${dc}/messages`, undefined, o);

  r = await q({ limit: 10 });
  const p1 = expectOk(`lịch sử mới nhất limit 10 -> 10 tin tăng dần, tin cuối seq ${L}, has_more true`, r,
    (x) => x.messages.length === 10 && ascContiguous(x.messages) && x.messages[9].seq === L && x.has_more === true);
  const first = p1 && p1.messages && p1.messages[0] ? p1.messages[0].seq : L - 9;
  const want = Math.min(10, first - 1);
  r = await q({ before_seq: first, limit: 10 });
  expectOk(`before_seq ${first} limit 10 -> ${want} tin ngay trước, tăng dần, has_more ${first - 1 > 10}`, r,
    (x) => x.messages.length === want && ascContiguous(x.messages) && x.messages[want - 1].seq === first - 1 && x.has_more === first - 1 > 10);
  r = await q({ after_seq: 0, limit: 5 });
  expectOk('after_seq 0 limit 5 -> seq 1..5, has_more true', r, (x) => x.messages.map((mm) => mm.seq).join() === '1,2,3,4,5' && x.has_more === true);
  r = await q({ after_seq: L });
  expectOk(`after_seq ${L} (= last_seq) -> rỗng, has_more false`, r, (x) => Array.isArray(x.messages) && x.messages.length === 0 && x.has_more === false);
  r = await q({ before_seq: 2 });
  expectOk('before_seq 2 -> chỉ tin seq 1, has_more false', r, (x) => x.messages.length === 1 && x.messages[0].seq === 1 && x.has_more === false);
  r = await q({});
  expectOk('không before_seq / after_seq -> tối đa 50 tin mới nhất, tin cuối = last_seq', r,
    (x) => x.messages.length === Math.min(50, L) && x.messages[x.messages.length - 1].seq === L && x.has_more === L > 50);
  r = await q({ limit: 1000 });
  expectOk('limit 1000 -> tối đa 100 tin', r, (x) => x.messages.length === Math.min(100, L));

  r = await call(B, 'GET', '/sync');
  expectErr('/sync thiếu cursor -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await call(B, 'GET', '/conversations');
  const lst = expectOk('B: GET /conversations -> sync_cursor', r, (x) => /^\d+$/.test(x.sync_cursor));
  r = await call(B, 'GET', '/sync', undefined, { cursor: lst ? lst.sync_cursor : String(Date.now()) });
  const s0 = expectOk('B: /sync?cursor=<sync_cursor của danh sách> -> conversations, sync_cursor, truncated false', r,
    (x) => Array.isArray(x.conversations) && /^\d+$/.test(x.sync_cursor) && x.truncated === false);
  const S1 = s0 && s0.sync_cursor ? s0.sync_cursor : String(Date.now());

  // B ngắt hết kết nối, A gửi 3 tin
  for (const s of sockets.filter((x) => x.user === B && !x.closed)) {
    s.close();
    await settle(s.waitClose());
  }
  const sent = [];
  for (let i = 1; i <= 3; i++) {
    const text = `Tin lúc B offline ${i}/3 ${RUN}`;
    const a = await sendText(A.ws, dc, text);
    sent.push(text);
    check(a.type === 'ack' && a.data.seq === L + i, `B offline: A gửi tin ${i}/3 -> ack seq ${L + i}`, () => pktDetail(a));
  }
  r = await call(B, 'GET', '/sync', undefined, { cursor: S1 });
  expectOk(`B: /sync?cursor=<lần trước> -> chat 1-1 có last_seq ${L + 3} (tăng 3), unread >= 3, last_message mới`, r, (x) => {
    const c = findConv(x.conversations, dc);
    return c && c.last_seq === L + 3 && c.unread >= 3 && c.last_message && c.last_message.seq === L + 3 &&
      x.truncated === false && Number(x.sync_cursor) >= Number(S1);
  });
  r = await q({ after_seq: L });
  expectOk(`B: after_seq ${L} -> đúng 3 tin lúc offline, đúng thứ tự, has_more false`, r,
    (x) => x.messages.length === 3 && x.has_more === false &&
      x.messages.every((mm, i) => mm.seq === L + 1 + i && mm.content === sent[i] && mm.sender_id === A.id));
  B.ws = await openWs('B#2', B);
}

// ───────────── 11. Chặn ─────────────

async function s11() {
  const { A, B } = U;
  const dc = ctx.direct;
  let r = await call(A, 'POST', '/blocks', { user_id: B.id });
  expectOk('A chặn B -> {}', r);
  r = await call(A, 'GET', '/blocks');
  expectOk('A: GET /blocks có B (relation blocked)', r, (x) => x.users.some((u) => u.id === B.id && u.relation === 'blocked'));
  await expectRel(A, B, 'blocked');
  await expectRel(B, A, 'none', ' (không lộ việc bị chặn)');
  let x = await sendText(B.ws, dc, 'B bị chặn còn gửi được không?');
  expectWsErr('B (bị chặn) gửi tin trong chat 1-1 -> error BLOCKED', x, 'BLOCKED');
  x = await sendText(A.ws, dc, 'A đã chặn B còn gửi được không?');
  expectWsErr('A (người chặn) gửi tin cho B -> error BLOCKED', x, 'BLOCKED');
  r = await call(B, 'POST', '/conversations', { type: 'direct', user_id: A.id });
  expectErr('B mở chat 1-1 với A khi bị chặn -> 403 BLOCKED', r, 403, 'BLOCKED');
  r = await call(B, 'POST', '/friend-requests', { user_id: A.id });
  expectErr('B mời kết bạn A (A đã chặn B) -> 403 FORBIDDEN (không lộ việc bị chặn)', r, 403, 'FORBIDDEN');
  r = await call(A, 'POST', '/friend-requests', { user_id: B.id });
  expectErr('A mời người mình đã chặn -> 403 BLOCKED', r, 403, 'BLOCKED');
  await expectFriends(A, B, false);

  r = await call(A, 'DELETE', `/blocks/${B.id}`);
  expectOk('A bỏ chặn B -> {}', r);
  r = await call(A, 'GET', '/blocks');
  expectOk('A: GET /blocks không còn B', r, (y) => Array.isArray(y.users) && !y.users.some((u) => u.id === B.id));
  x = await sendText(B.ws, dc, 'Đã được bỏ chặn ' + RUN);
  check(x.type === 'ack', 'bỏ chặn: B gửi tin lại được (ack)', () => pktDetail(x));
  r = await call(B, 'POST', '/friend-requests', { user_id: A.id });
  expectOk('bỏ chặn: B gửi lời mời kết bạn tới A được -> pending', r, (y) => y.status === 'pending');
  r = await call(A, 'POST', `/friend-requests/${B.id}/accept`);
  expectOk('A chấp nhận lại -> accepted', r, (y) => y.status === 'accepted');
  await expectFriends(A, B);
}

// ───────────── 12. Tắt thông báo + phân trang danh sách ─────────────

async function s12() {
  const { A } = U;
  const dc = ctx.direct;
  const mute = (until) => call(A, 'PUT', `/conversations/${dc}/mute`, { until });
  let r = await mute('forever');
  expectOk('PUT mute "forever" -> Conversation muted_until "forever"', r, (x) => x.id === dc && x.type === 'direct' && x.muted_until === 'forever');
  r = await call(A, 'GET', '/conversations');
  expectOk('GET /conversations: chat 1-1 muted_until "forever"', r, (x) => {
    const c = findConv(x.conversations, dc);
    return c && c.muted_until === 'forever';
  });
  const until = new Date(Date.now() + 3600 * 1000).toISOString();
  r = await mute(until);
  expectOk('PUT mute tới 1 giờ sau -> muted_until là thời điểm đó (RFC3339)', r,
    (x) => isIso(x.muted_until) && Math.abs(Date.parse(x.muted_until) - Date.parse(until)) < 2000);
  r = await mute(null);
  expectOk('PUT mute null -> bật lại thông báo (muted_until null)', r, (x) => x.muted_until === null);
  r = await mute('forever');
  expectOk('PUT mute "forever" lần nữa', r, (x) => x.muted_until === 'forever');
  r = await mute(new Date(Date.now() - 60000).toISOString());
  expectOk('PUT mute thời điểm đã qua -> bật lại (muted_until null)', r, (x) => x.muted_until === null);
  r = await call(A, 'GET', `/conversations/${dc}`);
  expectOk('chi tiết hội thoại sau khi bật lại -> muted_until null', r, (x) => x.muted_until === null);

  // A có 2 hội thoại: chat 1-1 (tin mới nhất ở mục 11) rồi nhóm
  r = await call(A, 'GET', '/conversations', undefined, { limit: 1 });
  const p1 = expectOk('GET /conversations?limit=1 -> 1 dòng (tin mới nhất trước: chat 1-1), next_cursor có', r,
    (x) => x.conversations.length === 1 && x.conversations[0].id === dc && typeof x.next_cursor === 'string' && x.next_cursor !== '');
  if (p1 && p1.next_cursor) {
    r = await call(A, 'GET', '/conversations', undefined, { limit: 1, cursor: p1.next_cursor });
    expectOk('trang 2 (cursor = next_cursor) -> nhóm, next_cursor null', r,
      (x) => x.conversations.length === 1 && x.conversations[0].id === ctx.group && x.next_cursor === null);
  }
}

// ───────────── 13. Push ─────────────

async function s13() {
  const { E } = U;
  let r = await call(E, 'GET', '/push/config');
  const cfg = expectOk('GET /push/config -> enabled bool (+ vapid_public_key khi bật, null khi tắt)', r,
    (x) => typeof x.enabled === 'boolean' &&
      (x.enabled ? typeof x.vapid_public_key === 'string' && x.vapid_public_key.length >= 80 : x.vapid_public_key === null));
  if (cfg) note(`push đang ${cfg.enabled ? 'BẬT' : 'TẮT (chưa có CHAT_VAPID_*)'}`);
  r = await rest('GET', '/push/config');
  expectErr('GET /push/config không token -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');

  // subscription giả đúng dạng: khoá P-256 thật (65 byte), auth 16 byte, endpoint https của dịch vụ push có thật nhưng
  // đường dẫn bịa; E không có hội thoại nào nên server không bao giờ gửi push tới đó, và bị gỡ ngay sau đó.
  const p256dh = crypto.createECDH('prime256v1').generateKeys().toString('base64url');
  const auth = crypto.randomBytes(16).toString('base64url');
  const endpoint = `https://fcm.googleapis.com/fcm/send/chat-e2e-${RUN}-${crypto.randomBytes(8).toString('hex')}`;
  const put = (token) => call(E, 'POST', '/devices/push', { push_kind: 'webpush', push_token: token });
  r = await put('không phải JSON');
  expectErr('POST /devices/push: push_token không phải JSON -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await put(JSON.stringify({ endpoint: endpoint.replace('https:', 'http:'), keys: { p256dh, auth } }));
  expectErr('push_token endpoint http (không phải https) -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await put(JSON.stringify({ endpoint, keys: { p256dh } }));
  expectErr('push_token thiếu keys.auth -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await put(JSON.stringify({ endpoint }));
  expectErr('push_token thiếu keys -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await put(JSON.stringify({ endpoint, expirationTime: null, keys: { p256dh, auth } }));
  expectOk('POST /devices/push với PushSubscription giả đúng dạng -> {}', r);
  r = await call(E, 'DELETE', '/devices/push');
  expectOk('DELETE /devices/push -> {}', r);

  for (const [path, key] of [['/friends', 'friends'], ['/blocks', 'users'], ['/conversations', 'conversations']]) {
    r = await call(E, 'GET', path);
    expectOk(`E (chưa có gì): GET ${path} -> "${key}" là [] (không phải null)`, r, (x) => Array.isArray(x[key]) && x[key].length === 0);
  }
  r = await call(E, 'GET', '/friend-requests');
  expectOk('E: GET /friend-requests -> incoming [] / outgoing []', r,
    (x) => Array.isArray(x.incoming) && Array.isArray(x.outgoing) && x.incoming.length === 0 && x.outgoing.length === 0);
}

// ───────────── 14. Token + đăng xuất ─────────────

async function s14() {
  const { D, E } = U;
  const R0 = E.refresh;
  const A0 = E.access;
  let r = await rest('POST', '/auth/refresh', { body: { refresh_token: R0 } });
  const x = expectOk('E refresh -> cặp token mới (refresh khác cũ, cùng device_id, user, expires_in 900, không có is_new)', r,
    (y) => typeof y.access_token === 'string' && y.access_token.split('.').length === 3 && typeof y.refresh_token === 'string' &&
      y.refresh_token !== R0 && y.device_id === E.deviceId && y.expires_in === 900 && y.user && y.user.id === E.id &&
      !Object.prototype.hasOwnProperty.call(y, 'is_new'));
  ctx.rotatedAt = Date.now();
  ctx.R0 = R0;
  if (x && x.access_token && x.refresh_token) {
    E.access = x.access_token;
    E.refresh = x.refresh_token;
  }
  r = await call(E, 'GET', '/me');
  expectOk('access token mới dùng được (GET /me)', r, (y) => y.id === E.id);
  r = await rest('POST', '/auth/refresh', { body: { refresh_token: R0 } });
  expectErr('dùng lại refresh token cũ trong 30 giây -> 409 REFRESH_RACE', r, 409, 'REFRESH_RACE');
  r = await rest('GET', '/me', { token: A0 });
  expectOk('REFRESH_RACE không thu hồi thiết bị: access token cũ vẫn dùng được', r, (y) => y.id === E.id);
  r = await rest('POST', '/auth/refresh', { body: { refresh_token: crypto.randomBytes(32).toString('base64url') } });
  expectErr('refresh token không tồn tại -> 401 REFRESH_INVALID', r, 401, 'REFRESH_INVALID');

  if (!D.ws || D.ws.closed) D.ws = await openWs('D#2', D);
  r = await call(D, 'POST', '/auth/logout');
  expectOk('D đăng xuất (POST /auth/logout) -> {}', r);
  const fl = await waitPkt(D.ws, 'force_logout');
  check(fl.type === 'force_logout', 'WebSocket đang mở của thiết bị D nhận force_logout', () => pktDetail(fl));
  const cl = await settle(D.ws.waitClose());
  check(cl.ok, `sau force_logout kết nối của D bị đóng${cl.ok ? ' (mã ' + cl.value.code + ')' : ''}`, () => (cl.ok ? '' : cl.error.message));
  r = await call(D, 'GET', '/me');
  expectErr('access token của thiết bị đã đăng xuất -> 401 CHAT_NOAUTH ngay', r, 401, 'CHAT_NOAUTH');
  r = await rest('POST', '/auth/refresh', { body: { refresh_token: D.refresh } });
  check(r.status === 401, 'refresh bằng token của thiết bị đã đăng xuất -> 401', () => brief(r));
  const w = new WsClient('D#sau-đăng-xuất', D);
  await w.connect();
  const e = await reqPkt(w, 'auth', { access_token: D.access, device_id: D.deviceId });
  check(e.type === 'error', 'WS auth bằng access token đã đăng xuất -> error', () => pktDetail(e));
  const c2 = await settle(w.waitClose());
  check(c2.ok && c2.value.code === 4401, 'WS auth bằng access token đã đăng xuất -> đóng mã 4401', () => (c2.ok ? js(c2.value) : c2.error.message));
}

// ───────────── 15. Phần chậm (chạy song song) ─────────────

async function slowPresence() {
  const { A, B } = U;
  B.ws.clear();
  B.ws.send('presence.subscribe', { user_ids: [A.id] });
  let p = await waitPkt(B.ws, 'presence.update', (x) => x.user_id === A.id);
  check(p.data.online === true, '[chậm] B theo dõi A: online true trước khi A ngắt', () => pktDetail(p));
  const conns = sockets.filter((s) => s.user === A && !s.closed);
  for (const s of conns) s.close();
  for (const s of conns) await settle(s.waitClose());
  const mark = B.ws.mark();
  const offline = (x) => x.user_id === A.id && x.online === false;
  await sleep(2000);
  check(B.ws.since(mark, 'presence.update', offline).length === 0, '[chậm] A vừa ngắt hết kết nối: chưa báo offline ngay (chống nhấp nháy)');
  const a3 = await openWs('A#3', A);
  await sleep(1000);
  a3.close();
  await settle(a3.waitClose());
  check(B.ws.since(mark, 'presence.update', offline).length === 0, '[chậm] A kết nối lại trong thời gian chờ: không báo offline');
  const t0 = Date.now();
  p = await waitPkt(B.ws, 'presence.update', offline, OFFLINE_WAIT_MS);
  check(p.type === 'presence.update' && isIso(p.data.last_seen),
    `[chậm] B nhận presence.update {user_id A, online false, last_seen}${p.why ? '' : ' sau ' + ((Date.now() - t0) / 1000).toFixed(1) + ' giây'}`,
    () => pktDetail(p));
  let r = await call(B, 'GET', '/friends');
  expectOk('[chậm] B: GET /friends -> A online false', r, (x) => x.friends.some((u) => u.id === A.id && u.online === false));
  B.ws.clear();
  B.ws.send('presence.subscribe', { user_ids: [A.id] });
  p = await waitPkt(B.ws, 'presence.update', (x) => x.user_id === A.id);
  check(p.data.online === false && isIso(p.data.last_seen), '[chậm] đăng ký lại khi A offline -> ngay online false kèm last_seen', () => pktDetail(p));
}

async function slowRefreshReuse() {
  const { E } = U;
  if (!ctx.R0) throw new Error('chưa có refresh token cũ từ mục 14');
  const wait = ctx.rotatedAt + 31000 - Date.now();
  if (wait > 0) await sleep(wait);
  // REFRESH_RACE không thu hồi gì nên thử lại được; cửa sổ 30 giây tính bằng giờ database.
  let r = await retryEarly('[chậm] refresh dùng lại', () => rest('POST', '/auth/refresh', { body: { refresh_token: ctx.R0 } }),
    (x) => (x.status === 409 && x.code === 'REFRESH_RACE' ? 1000 : 0));
  expectErr('[chậm] dùng lại refresh token cũ sau 31 giây -> 401 REFRESH_REUSED', r, 401, 'REFRESH_REUSED');
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await call(E, 'GET', '/me');
    if (last.status === 401 || Date.now() - t0 > 35000) break;
    await sleep(1000);
  }
  check(last.status === 401 && last.code === 'CHAT_NOAUTH',
    `[chậm] thiết bị bị thu hồi: access token hiện tại -> 401 CHAT_NOAUTH (sau ${((Date.now() - t0) / 1000).toFixed(1)} giây, tối đa 35)`,
    () => brief(last));
  r = await rest('POST', '/auth/refresh', { body: { refresh_token: E.refresh } });
  check(r.status === 401, '[chậm] refresh token mới nhất của thiết bị bị thu hồi -> 401', () => brief(r));
}

async function slowRelogin() {
  const { A } = U;
  const wait = A.otpAt + 61000 - Date.now();
  if (wait > 0) await sleep(wait);
  // Còn "đợi N giây" (N nhỏ) = cửa sổ 60 giây theo giờ database chưa hết: chờ đúng N giây theo lời server. N lớn (cửa sổ
  // dài hơn 60 giây hẳn) thì vượt CLOCK_SLACK_MS, không chờ, bước kiểm báo LỖI.
  const r1 = await retryEarly('[chậm] xin mã lại', () => otpRequest(A.cc), (x) => {
    const m = x.status === 429 && x.code === 'OTP_RATE_LIMIT' && /đợi (\d+) giây/.exec(String(x.error || ''));
    return m ? Number(m[1]) * 1000 + 300 : 0;
  });
  const x1 = expectOk('[chậm] A xin mã lại sau 60 giây (dạng 84xxxxxxxxx) -> phone E.164 cũ, có dev_code', r1,
    (y) => y.phone === A.e164 && /^\d{6}$/.test(String(y.dev_code)));
  if (!x1 || !x1.dev_code) return;
  const r2 = await rest('POST', '/auth/otp/verify', {
    body: { phone: A.spaced, otp: String(x1.dev_code), device: { platform: 'desktop', name: 'chat-e2e A máy 2' }, display_name: 'Tên khác bị bỏ qua' },
  });
  expectOk('[chậm] A xác thực (dạng +84 có dấu cách) -> cùng tài khoản, is_new false, giữ tên cũ, thiết bị mới', r2,
    (y) => y.is_new === false && y.user && y.user.id === A.id && y.user.display_name === A.name && y.device_id !== A.deviceId);
}

async function slowAuthTimeout() {
  const w = new WsClient('X#không-auth');
  await w.connect();
  const t0 = Date.now();
  const c = await settle(w.waitClose(15000));
  check(c.ok && c.value.code === 4408,
    `[chậm] mở WebSocket không gửi auth -> server đóng mã 4408${c.ok ? ' sau ' + ((Date.now() - t0) / 1000).toFixed(1) + ' giây' : ''}`,
    () => (c.ok ? js(c.value) : c.error.message));
}

async function s15() {
  if (SKIP_SLOW) {
    for (const s of ['presence offline sau OfflineGrace (+ kết nối lại trong lúc chờ)',
      'dùng lại refresh token sau 31 giây -> REFRESH_REUSED, thiết bị bị thu hồi',
      'đăng nhập lại sau 60 giây -> is_new false', 'không gửi auth trong 10 giây -> đóng 4408']) skip(s, 'SKIP_SLOW=1');
    return;
  }
  note(`phần chậm chạy song song, khoảng ${Math.round((OFFLINE_WAIT_MS + 3000) / 1000)} giây`);
  const tasks = [['presence offline', slowPresence], ['refresh dùng lại', slowRefreshReuse], ['đăng nhập lại', slowRelogin], ['auth timeout', slowAuthTimeout]];
  await Promise.all(tasks.map(([n, f]) => f().catch((e) => check(false, `[chậm] ${n}: dừng giữa chừng`, (e && e.message) || String(e)))));
}

// ───────────── chạy ─────────────

async function scenario(no, title, fn) {
  console.log(`\n== ${no}. ${title}`);
  curScenario = { no, title, pass: 0, fail: 0 };
  perScenario.push(curScenario);
  try {
    await fn();
  } catch (e) {
    check(false, `${no}. ${title}: dừng giữa chừng`, (e && e.message) || String(e));
  }
}

function finish(msg) {
  if (finished) return;
  if (msg) check(false, 'DỪNG', msg);
  finished = true;
  for (const s of sockets) s.close();
  console.log('\nTóm tắt theo kịch bản:');
  for (const s of perScenario) console.log(`  ${s.no}. ${s.title}: ${s.pass} đạt, ${s.fail} lỗi`);
  console.log(`KẾT QUẢ chat-e2e (${BASE}): ${pass} đạt, ${fails} lỗi`);
  setTimeout(() => process.exit(fails > 0 ? 1 : 0), 300);
}

(async () => {
  console.log(`chat-e2e: ${BASE} (lượt ${RUN}, X-Forwarded-For ${FAKE_IP}${SKIP_SLOW ? ', SKIP_SLOW=1' : ''})`);
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    try {
      up = (await fetch(BASE + '/healthz', { signal: AbortSignal.timeout(2000) })).ok;
    } catch (e) {
      /* chưa lên */
    }
    if (!up) await sleep(250);
  }
  if (!up) refuse(`server chưa chạy ở ${BASE} (GET /healthz không trả 200)`);
  const pre = await rest('GET', '/me');
  if (pre.status === 404) refuse('GET /api/v1/chat/me trả 404: server chưa nối module chat');

  await scenario(1, 'OTP: đăng ký / đăng nhập, chuẩn hoá số, lỗi', s1);
  if (!['A', 'B', 'C', 'D', 'E'].every((k) => U[k] && U[k].access)) {
    finish('không tạo đủ 5 tài khoản thử A-E, không chạy tiếp được');
    return;
  }
  await scenario(2, 'Hồ sơ /chat/me + access token', s2);
  await scenario(3, 'Danh bạ, lời mời kết bạn, quan hệ', s3);
  await scenario(4, 'Chat 1-1 + giao thức WebSocket', s4);
  await scenario(5, 'Đang soạn tin', s5);
  await scenario(6, 'Online (phần nhanh)', s6);
  await scenario(7, 'Nhiều kết nối của một người', s7);
  await scenario(8, 'Thứ tự 30 tin gửi liền', s8);
  await scenario(9, 'Nhóm: tạo, đổi tên, thành viên, quyền, đã xem', s9);
  await scenario(10, 'Lịch sử + đồng bộ sau khi offline', s10);
  await scenario(11, 'Chặn / bỏ chặn', s11);
  await scenario(12, 'Tắt thông báo + phân trang danh sách', s12);
  await scenario(13, 'Push config + đăng ký Web Push', s13);
  await scenario(14, 'Refresh token + đăng xuất', s14);
  await scenario(15, 'Phần chậm (offline, refresh dùng lại, đăng nhập lại, auth timeout)', s15);
  finish();
})().catch((e) => finish('lỗi ngoài dự kiến: ' + ((e && e.stack) || String(e))));
