'use strict';
/* Test đầu-cuối (E2E) cho Chat MVP trên server Go ĐANG CHẠY SẴN ở máy: không tự bật server, không đọc .env, không đụng
   database. Hợp đồng: chat-mvp-spec.md mục 4 (REST), 5 (quy tắc), 6 (WebSocket) + backend/CHAT.md mục 5-11.

   1) Bật server (từ backend/, database tạm có chữ "test", KHÔNG dùng .env thật):
        DOTENV=0 DATABASE_URL=postgresql://qspro:<mật khẩu>@localhost:5434/qspro_chattest REPORT_JOB=0 \
        PURCHASE_WEBHOOK=http://127.0.0.1:9/x REPORT_WEBHOOK=http://127.0.0.1:9/x AUTH_SECRET=test-secret PORT=3998 \
        CHAT_OTP_DEV=1 TRUSTED_PROXIES=127.0.0.1,::1 go run ./cmd/api
      - CHAT_OTP_DEV=1 BẮT BUỘC: otp/request phải trả dev_code (thiếu thì script dừng, mã thoát 2).
      - TRUSTED_PROXIES=127.0.0.1,::1 nên có: OTP giới hạn 20 lần / giờ / IP, mỗi lượt chạy xin 8 mã; script gửi
        X-Forwarded-For giả (10.x.x.x, đổi mỗi lượt) nên chạy lại nhiều lần trong 1 giờ không bị OTP_RATE_LIMIT.
      - Giữ mặc định CHAT_ACCESS_TTL_MIN (15 -> expires_in 900); không đặt RATE_LIMIT_RPS.
      - Mục 16 (tệp đính kèm) cần MinIO: thêm CHAT_S3_ENDPOINT=http://127.0.0.1:9000 (hoặc http://qspro-minio:9000 trong
        mạng Docker) CHAT_S3_ACCESS_KEY=<user> CHAT_S3_SECRET_KEY=<mật khẩu>; CHAT_S3_PUBLIC_URL phải là địa chỉ máy chạy
        test GỌI ĐƯỢC (script PUT / GET thẳng presigned URL). Bucket (CHAT_S3_BUCKET, mặc định chat-media) server tự tạo.
        Thiếu CHAT_S3_* -> /media/config trả enabled false, mục 16 BỎ QUA (không tính lỗi). Không lùi giờ / chạy janitor
        (không đụng database): bước "tệp đã bị janitor xoá" dùng media_id không tồn tại.
   2) Chạy (Node 22+, không cần npm install):
        BASE_URL=http://localhost:3998 node backend/tests/chat-e2e/chat-e2e.js
        PowerShell: $env:BASE_URL='http://localhost:3998'; node backend/tests/chat-e2e/chat-e2e.js
      SKIP_SLOW=1      bỏ các bước phải chờ lâu (offline sau OfflineGrace 30 giây, dùng lại refresh token sau 31 giây,
                       đăng nhập lại sau 60 giây, đóng 4408 khi không auth trong 10 giây, mã QR hết hạn sau 120 giây ở
                       mục 27); đủ cả thì mất thêm ~40 giây + phần chờ QR còn lại (~1-2 phút).
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
const zlib = require('node:zlib');

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

// ───────────── 16. Tệp đính kèm (MinIO) ─────────────

// pngBytes: ảnh PNG RGB w x h hợp lệ, tự dựng bằng zlib (không cần thư viện ngoài); mỗi lượt khác byte.
function pngBytes(w, h) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4);
    cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bit / kênh
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 3);
    for (let x = 0; x < w; x++) {
      raw[o + 1 + x * 3] = (x * 4 + crypto.randomInt(4)) & 0xff;
      raw[o + 2 + x * 3] = (y * 8) & 0xff;
      raw[o + 3 + x * 3] = 128;
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const sha256buf = (b) => crypto.createHash('sha256').update(b).digest('hex');

// putObject: tải byte lên presigned URL (không kèm Bearer). Trả {status, text}; lỗi mạng -> status 0.
async function putObject(up, body) {
  try {
    const res = await fetch(up.url, { method: up.method || 'PUT', headers: up.headers || {}, body, signal: AbortSignal.timeout(20000) });
    return { status: res.status, text: (await res.text()).slice(0, 200) };
  } catch (e) {
    return { status: 0, text: 'lỗi mạng: ' + ((e.cause && e.cause.message) || e.message) };
  }
}

// getObject: GET presigned URL -> {status, ctype, body Buffer}; lỗi mạng -> status 0, ctype là lỗi.
async function getObject(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return { status: res.status, ctype: res.headers.get('content-type') || '', body: Buffer.from(await res.arrayBuffer()) };
  } catch (e) {
    return { status: 0, ctype: 'lỗi mạng: ' + ((e.cause && e.cause.message) || e.message), body: Buffer.alloc(0) };
  }
}

// uploadMedia: upload-url (thử lại khi kho tệp còn khởi động) -> PUT -> complete. Trả {id, media} hoặc null.
async function uploadMedia(u, label, body, bytes) {
  let r;
  for (let i = 0; i < 40; i++) {
    r = await call(u, 'POST', '/media/upload-url', body);
    if (!(r.status === 503 && r.code === 'UNAVAILABLE')) break;
    await sleep(250);
  }
  const out = expectOk(`${label}: upload-url -> media_id, dedup false, upload PUT tới khoá tạm chat/in/, Content-Type ${body.mime}, expires_at`, r,
    (x) => Number.isInteger(x.media_id) && x.dedup === false && x.upload && x.upload.method === 'PUT' &&
      /\/chat\/in\//.test(x.upload.url) && x.upload.headers['Content-Type'] === body.mime && isIso(x.upload.expires_at));
  if (!out || !out.upload) return null;
  const p = await putObject(out.upload, bytes);
  check(p.status === 200, `${label}: PUT ${bytes.length} byte lên URL tạm -> 200`, () => `HTTP ${p.status} ${p.text}`);
  r = await call(u, 'POST', `/media/${out.media_id}/complete`);
  const done = expectOk(`${label}: complete -> media ready (id, size ${bytes.length}, url)`, r,
    (x) => x.media && x.media.id === out.media_id && x.media.status === 'ready' && x.media.size === bytes.length &&
      typeof x.media.url === 'string' && x.media.url.length > 0);
  return { id: out.media_id, media: (done && done.media) || {} };
}

const sendMedia = (c, conv, msgType, ids, o = {}) => reqPkt(c, 'message.send',
  Object.assign({ conversation_id: conv, client_msg_id: uuid(), msg_type: msgType, content: '', attachments: ids }, o));

async function s16() {
  const { A, B, C } = U;
  const dc = ctx.direct;
  let r = await call(A, 'GET', '/media/config');
  const cfg = expectOk('A: GET /media/config -> có enabled', r, (x) => typeof x.enabled === 'boolean');
  if (!cfg || cfg.enabled !== true) {
    skip('16. tệp đính kèm', 'máy chủ chưa bật tệp (enabled false): bật server với CHAT_S3_* trỏ tới MinIO');
    return;
  }
  check(cfg.max_bytes && cfg.max_bytes.image > 0 && cfg.max_bytes.voice > 0 && cfg.max_voice_ms > 0 && cfg.mimes &&
    Array.isArray(cfg.mimes.image) && cfg.mimes.image.includes('image/png') && Array.isArray(cfg.denied_ext),
  'config: max_bytes, max_voice_ms, mimes (image có image/png), denied_ext', () => js(cfg));
  if (!A.ws || A.ws.closed) A.ws = await openWs('A#tệp', A);
  if (!B.ws || B.ws.closed) B.ws = await openWs('B#tệp', B);

  // 1-3. ảnh PNG 64x32: upload-url -> PUT -> complete (width / height, ảnh nhỏ, blurhash)
  const png = pngBytes(64, 32);
  const imgReq = { type: 'image', mime: 'image/png', size: png.length, sha256: sha256buf(png) };
  const img = await uploadMedia(A, 'ảnh 64x32', imgReq, png);
  if (!img) throw new Error('không tải được ảnh lên');
  const md = img.media;
  check(md.type === 'image' && md.mime === 'image/png' && md.width === 64 && md.height === 32 && typeof md.thumb_url === 'string' &&
    md.thumb_url.length > 0 && typeof md.blurhash === 'string' && md.blurhash.length > 0 && isIso(md.expires_at),
  'complete ảnh: type image, mime image/png, width 64, height 32, thumb_url, blurhash, expires_at', () => js(md));
  r = await call(A, 'POST', `/media/${img.id}/complete`);
  expectOk('complete lần 2 -> vẫn ready (idempotent)', r, (x) => x.media && x.media.id === img.id && x.media.status === 'ready');
  r = await call(A, 'GET', `/media/${img.id}`);
  expectOk('A (người tải, chưa gửi): GET /media/:id -> có url', r, (x) => x.media && x.media.id === img.id && !!x.media.url);

  // 4. gửi ảnh cho B (chú thích rỗng); B nhận message.new kèm attachments, tải url ra đúng byte
  const cmImg = uuid();
  const sendImg = { conversation_id: dc, client_msg_id: cmImg, msg_type: 'image', content: '', attachments: [img.id] };
  const ack = await reqPkt(A.ws, 'message.send', sendImg);
  check(ack.type === 'ack' && ack.data.duplicate === false && Array.isArray(ack.data.attachments) && ack.data.attachments.length === 1 &&
    ack.data.attachments[0].id === img.id && !!ack.data.attachments[0].url,
  'A gửi tin image (chú thích rỗng) -> ack kèm attachments[0] {id, url}', () => pktDetail(ack));
  const mn = await waitPkt(B.ws, 'message.new', (x) => x.client_msg_id === cmImg);
  const att = mn.data && Array.isArray(mn.data.attachments) ? mn.data.attachments[0] : null;
  check(mn.type === 'message.new' && mn.data.msg_type === 'image' && mn.data.content === '' && att && att.id === img.id &&
    att.width === 64 && att.height === 32 && !!att.url && !!att.thumb_url,
  'B nhận message.new msg_type image, attachments[0] {id, width 64, height 32, url, thumb_url}', () => pktDetail(mn));
  if (att && att.url) {
    const g = await getObject(att.url);
    check(g.status === 200 && g.body.equals(png) && /^image\/png/.test(g.ctype),
      'B tải attachments[0].url -> 200, image/png, đúng byte đã gửi', () => `HTTP ${g.status} ${g.ctype} ${g.body.length} byte`);
  }
  if (att && att.thumb_url) {
    const g = await getObject(att.thumb_url);
    check(g.status === 200 && /^image\/jpeg/.test(g.ctype) && g.body.length > 0, 'B tải thumb_url -> 200 image/jpeg',
      () => `HTTP ${g.status} ${g.ctype}`);
  }
  r = await call(B, 'GET', `/media/${img.id}`);
  expectOk('B (thành viên, tin đã gửi): GET /media/:id -> có url', r, (x) => x.media && x.media.id === img.id && !!x.media.url);
  const dup = await reqPkt(A.ws, 'message.send', sendImg);
  check(dup.type === 'ack' && dup.data.duplicate === true && dup.data.seq === ack.data.seq &&
    Array.isArray(dup.data.attachments) && dup.data.attachments[0] && dup.data.attachments[0].id === img.id,
  'A gửi lại cùng client_msg_id -> ack duplicate true, cùng seq, vẫn có attachments', () => pktDetail(dup));
  r = await call(B, 'GET', `/conversations/${dc}/messages`, undefined, { limit: 5 });
  expectOk('B: lịch sử có tin ảnh kèm attachments[0].id', r, (x) => x.messages.some((mm) => mm.client_msg_id === cmImg &&
    mm.msg_type === 'image' && mm.attachments && mm.attachments[0].id === img.id));

  // 5. C (không phải thành viên) không đọc được tệp
  r = await call(C, 'GET', `/media/${img.id}`);
  expectErr('C (không thuộc hội thoại): GET /media/:id -> 404 MEDIA_NOT_FOUND', r, 404, 'MEDIA_NOT_FOUND');

  // 6. xin lại upload-url cùng nội dung -> dedup, không phải tải lên
  r = await call(A, 'POST', '/media/upload-url', imgReq);
  expectOk('A xin upload-url lại cùng sha256 -> dedup true, cùng media_id, không có upload, media ready', r,
    (x) => x.dedup === true && x.media_id === img.id && !x.upload && x.media && x.media.status === 'ready');

  // 7. tin thoại có waveform -> danh sách hội thoại của B: last_message voice (client hiện "[Tin nhắn thoại] 0:12")
  const ogg = Buffer.concat([Buffer.from('OggS\0', 'binary'), crypto.randomBytes(2000)]);
  const wave = Array.from({ length: 32 }, (_, i) => (i * 8) % 256);
  const voice = await uploadMedia(A, 'tin thoại 12 giây', { type: 'voice', mime: 'audio/ogg', size: ogg.length, sha256: sha256buf(ogg),
    duration_ms: 12000, waveform: wave }, ogg);
  if (voice) {
    const cmV = uuid();
    const va = await sendMedia(A.ws, dc, 'voice', [voice.id], { client_msg_id: cmV });
    check(va.type === 'ack' && va.data.attachments && va.data.attachments[0] && va.data.attachments[0].id === voice.id,
      'A gửi tin voice -> ack kèm attachments', () => pktDetail(va));
    await waitPkt(B.ws, 'message.new', (x) => x.client_msg_id === cmV);
    r = await call(B, 'GET', '/conversations');
    expectOk('B: GET /conversations -> last_message voice, attachments[0] duration_ms 12000, waveform 32 số (preview "[Tin nhắn thoại] 0:12")', r,
      (x) => {
        const c = findConv(x.conversations, dc);
        const lm = c && c.last_message;
        const a0 = lm && lm.attachments && lm.attachments[0];
        return lm.msg_type === 'voice' && lm.content === '' && a0 && a0.type === 'voice' && a0.duration_ms === 12000 &&
          Array.isArray(a0.waveform) && a0.waveform.length === 32 && a0.waveform[3] === wave[3];
      });
    const vb = await sendMedia(A.ws, dc, 'voice', [voice.id], { content: 'có chữ' });
    expectWsErr('tin voice có content -> error BAD_REQUEST', vb, 'BAD_REQUEST');
  }

  // 8. PUT sai kích thước -> MinIO từ chối (Content-Length đã ký); complete khi chưa có object -> MEDIA_NOT_UPLOADED
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n', 'ascii'), crypto.randomBytes(1000)]);
  r = await call(A, 'POST', '/media/upload-url',
    { type: 'file', mime: 'application/pdf', size: pdf.length, sha256: sha256buf(pdf), file_name: `e2e-${RUN}.pdf` });
  const fo = expectOk('A: upload-url tệp pdf -> có upload PUT', r, (x) => Number.isInteger(x.media_id) && x.upload && x.upload.method === 'PUT');
  if (fo && fo.upload) {
    const p = await putObject(fo.upload, pdf.subarray(0, pdf.length - 1));
    r = await call(A, 'POST', `/media/${fo.media_id}/complete`);
    if (p.status >= 400) {
      check(true, `PUT thiếu 1 byte -> MinIO từ chối (HTTP ${p.status})`);
      expectErr('complete khi chưa có object -> 409 MEDIA_NOT_UPLOADED', r, 409, 'MEDIA_NOT_UPLOADED');
    } else {
      note(`PUT thiếu 1 byte được MinIO nhận (HTTP ${p.status}): kiểm complete -> MEDIA_MISMATCH thay thế`);
      expectErr('PUT sai kích thước -> complete 422 MEDIA_MISMATCH', r, 422, 'MEDIA_MISMATCH');
    }
    const np = await sendMedia(A.ws, dc, 'file', [fo.media_id]);
    expectWsErr('gửi tin file với tệp chưa ready -> error MEDIA_NOT_READY', np, 'MEDIA_NOT_READY');
  }

  // 9. tệp không còn / không phải của mình. Test không đụng database nên không lùi giờ + chạy janitor được; media_id không
  //    tồn tại đi đúng nhánh lockSendMedia của dòng đã bị janitor xoá (không tìm thấy -> MEDIA_NOT_FOUND).
  let x = await sendMedia(A.ws, dc, 'image', [9e15]);
  expectWsErr('gửi tin image với media_id không tồn tại (như đã bị janitor xoá) -> error MEDIA_NOT_FOUND', x, 'MEDIA_NOT_FOUND');
  x = await sendMedia(B.ws, dc, 'image', [img.id]);
  expectWsErr('B gửi lại tệp của A (B không phải người tải) -> error MEDIA_NOT_FOUND', x, 'MEDIA_NOT_FOUND');
  x = await sendMedia(A.ws, dc, 'video', [img.id]);
  expectWsErr('msg_type video với tệp image -> error BAD_REQUEST', x, 'BAD_REQUEST');
  x = await sendMedia(A.ws, dc, 'text', [img.id], { content: 'chữ kèm tệp' });
  expectWsErr('tin text kèm attachments -> error BAD_REQUEST', x, 'BAD_REQUEST');
  x = await sendMedia(A.ws, dc, 'image', [img.id, img.id]);
  expectWsErr('tin image 2 attachments -> error BAD_REQUEST', x, 'BAD_REQUEST');
}

// ───────────── 17-20. Quản trị nhóm (migration 0022, API.md mục "Quản trị nhóm") ─────────────

async function ensureWs(u, label) {
  if (!u.ws || u.ws.closed) u.ws = await openWs(label, u);
  return u.ws;
}

// mentionOf: phần tử mentions cho đoạn sub trong text (offset / length theo đơn vị UTF-16 = chỉ số chuỗi JavaScript).
const mentionOf = (text, sub, uid) => ({ user_id: uid, offset: text.indexOf(sub), length: sub.length });
const sendMention = (c, conv, text, mentions, cmid = uuid()) =>
  reqPkt(c, 'message.send', { conversation_id: conv, client_msg_id: cmid, msg_type: 'text', content: text, mentions });
const sameMentions = (got, want) => Array.isArray(got) && got.length === want.length &&
  got.every((m, i) => m.user_id === want[i].user_id && m.offset === want[i].offset && m.length === want[i].length);
const hasKey = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const hasPin = (x, mid) => Array.isArray(x.pins) && x.pins.some((p) => p.message_id === mid);

// expectErrMsg / expectWsErrMsg: như expectErr / expectWsErr, thêm đúng thông báo tiếng Việt của hợp đồng.
function expectErrMsg(name, r, status, code, msg) {
  return check(r.status === status && r.code === code && r.error === msg, name, () => `mong HTTP ${status} ${code} "${msg}", nhận ${brief(r)}`);
}

function expectWsErrMsg(name, p, code, msg) {
  return check(p.type === 'error' && p.data.code === code && p.data.message === msg, name,
    () => `mong error ${code} "${msg}", nhận ${pktDetail(p)}`);
}

// convOf: dòng hội thoại id trong GET /conversations của u (undefined nếu không có / lỗi).
async function convOf(u, id) {
  const r = await call(u, 'GET', '/conversations');
  return { r, c: r.ok && r.result ? findConv(r.result.conversations, id) : undefined };
}

async function expectConv(name, u, id, pred) {
  const { r, c } = await convOf(u, id);
  if (!r.ok) return check(false, name, brief(r));
  let v = false;
  try {
    v = !!c && pred(c);
  } catch (e) {
    v = false;
  }
  return check(v, name, () => 'dòng hội thoại: ' + js(c, 900));
}

const sysIn = (gid, s) => (y) => y.conversation_id === gid && y.msg_type === 'system' && String(y.content || '').includes(s);

async function s17() {
  const { A, B, C, E } = U;
  await ensureWs(A, 'A#nhóm');
  await ensureWs(B, 'B#nhóm');
  await ensureWs(C, 'C#nhóm');
  const name = 'Nhóm quản trị ' + RUN;
  let r = await call(A, 'POST', '/conversations', { type: 'group', name, member_ids: [B.id, C.id] });
  const g = expectOk('A tạo nhóm mới với B, C -> description null, avatar null, settings mặc định {send false, edit_info true, ' +
    'add_members false}, disbanded false, pending_join_requests 0, last_mention_seq 0, unread_mention false', r,
  (x) => x.type === 'group' && x.member_count === 3 && x.description === null && x.avatar === null && x.settings &&
      x.settings.admins_only_send === false && x.settings.admins_only_edit_info === true && x.settings.admins_only_add_members === false &&
      x.disbanded === false && x.pending_join_requests === 0 && x.last_mention_seq === 0 && x.unread_mention === false);
  if (!g || !g.id) throw new Error('không tạo được nhóm quản trị');
  const gid = (ctx.g2 = g.id);
  ctx.g2Name = name;
  r = await call(A, 'PATCH', `/conversations/${gid}/members/${B.id}`, { role: 'admin' });
  expectOk('A đặt B làm phó nhóm', r, (x) => member(x, B.id).role === 'admin');
  r = await call(A, 'GET', `/conversations/${ctx.direct}`);
  expectOk('chat 1-1: description / avatar / settings null, disbanded false, last_mention_seq 0', r,
    (x) => x.type === 'direct' && x.description === null && x.avatar === null && x.settings === null && x.disbanded === false &&
      x.last_mention_seq === 0 && x.unread_mention === false);

  // C (member) nhắc B
  const t1 = `@${B.name} xem giúp ${RUN}`;
  const m1 = [mentionOf(t1, '@' + B.name, B.id)];
  const cm1 = uuid();
  let a = await sendMention(C.ws, gid, t1, m1, cm1);
  check(a.type === 'ack' && sameMentions(a.data.mentions, m1), 'C nhắc B (@Tên ở đầu tin) -> ack kèm mentions như đã gửi', () => pktDetail(a));
  const seq1 = a.data.seq;
  ctx.g2MentionMsg = a.data.message_id;
  let mn = await waitPkt(B.ws, 'message.new', (x) => x.client_msg_id === cm1);
  check(mn.type === 'message.new' && sameMentions(mn.data.mentions, m1), 'B nhận message.new kèm mentions', () => pktDetail(mn));
  await expectConv('B: danh sách -> nhóm có unread_mention true, last_mention_seq = seq tin nhắc', B, gid,
    (c) => c.unread_mention === true && c.last_mention_seq === seq1);
  await expectConv('A (không được nhắc): unread_mention false, last_mention_seq 0', A, gid,
    (c) => c.unread_mention === false && c.last_mention_seq === 0);
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { after_seq: seq1 - 1 });
  expectOk('lịch sử: tin nhắc có mentions', r, (x) => x.messages.some((mm) => mm.client_msg_id === cm1 && sameMentions(mm.mentions, m1)));
  a = await sendMention(C.ws, gid, t1, m1, cm1);
  check(a.type === 'ack' && a.data.duplicate === true && a.data.seq === seq1 && sameMentions(a.data.mentions, m1),
    'C gửi lại cùng client_msg_id -> ack duplicate, mentions của tin gốc', () => pktDetail(a));
  const rr = await reqPkt(B.ws, 'message.read', { conversation_id: gid, seq: seq1 });
  check(rr.type === 'ack', 'B đọc tới tin nhắc -> ack', () => pktDetail(rr));
  await expectConv('B: đọc xong -> unread_mention false, last_mention_seq giữ nguyên', B, gid,
    (c) => c.unread_mention === false && c.last_mention_seq === seq1);

  // offset UTF-16 + khoảng trắng đầu bị cắt
  const t2 = `  😀 @${B.name} ${RUN}`;
  a = await sendMention(C.ws, gid, t2, [mentionOf(t2, '@' + B.name, B.id)]);
  const want2 = [mentionOf(t2.trim(), '@' + B.name, B.id)];
  check(a.type === 'ack' && want2[0].offset === 3 && sameMentions(a.data.mentions, want2),
    'offset theo UTF-16 (emoji = 2 đơn vị) + content có khoảng trắng đầu -> server trừ phần đã cắt (offset 3)', () => pktDetail(a));

  // phần tử bị bỏ: người ngoài nhóm (E) + chính người gửi
  const t3 = `@${E.name} @${C.name} chỉ là chữ ${RUN}`;
  const cm3 = uuid();
  a = await sendMention(C.ws, gid, t3, [mentionOf(t3, '@' + E.name, E.id), mentionOf(t3, '@' + C.name, C.id)], cm3);
  check(a.type === 'ack' && !hasKey(a.data, 'mentions'), 'nhắc người ngoài nhóm + chính mình -> phần tử bị bỏ, ack không có mentions',
    () => pktDetail(a));
  mn = await waitPkt(A.ws, 'message.new', (x) => x.client_msg_id === cm3);
  check(mn.type === 'message.new' && !hasKey(mn.data, 'mentions') && mn.data.content === t3,
    'A nhận tin đó: không có khoá mentions, chữ giữ nguyên', () => pktDetail(mn));

  // lỗi kiểm
  const tb = `@${B.name} hi`;
  const L = ('@' + B.name).length;
  const bad = [
    ['ký tự tại offset không phải @', [{ user_id: B.id, offset: 1, length: 3 }]],
    ['length 1', [{ user_id: B.id, offset: 0, length: 1 }]],
    ['vượt độ dài content', [{ user_id: B.id, offset: 0, length: tb.length + 1 }]],
    ['offset âm', [{ user_id: B.id, offset: -1, length: L }]],
    ['user_id âm', [{ user_id: -5, offset: 0, length: L }]],
    ['hai đoạn chồng nhau', [{ user_id: B.id, offset: 0, length: L }, { user_id: A.id, offset: 0, length: 2 }]],
  ];
  for (const [why, ms] of bad) {
    const x = await sendMention(C.ws, gid, tb, ms);
    expectWsErr(`mentions ${why} -> error BAD_REQUEST`, x, 'BAD_REQUEST');
  }
  const many = '@a '.repeat(51).trim();
  const ms51 = Array.from({ length: 51 }, (_, i) => ({ user_id: B.id, offset: i * 3, length: 2 }));
  let x = await sendMention(A.ws, gid, many, ms51);
  expectWsErrMsg('51 lượt nhắc tên -> error BAD_REQUEST "Tối đa 50 lượt nhắc tên mỗi tin"', x, 'BAD_REQUEST', 'Tối đa 50 lượt nhắc tên mỗi tin');
  const td = `@${B.name} 1-1`;
  x = await sendMention(A.ws, ctx.direct, td, [mentionOf(td, '@' + B.name, B.id)]);
  expectWsErrMsg('nhắc tên trong chat 1-1 -> error BAD_REQUEST "Chỉ nhắc tên được trong nhóm"', x, 'BAD_REQUEST', 'Chỉ nhắc tên được trong nhóm');

  // @Tất cả: member bị cấm, trưởng nhóm được
  const t4 = `@Tất cả họp lúc 9h ${RUN}`;
  const m4 = [mentionOf(t4, '@Tất cả', 0)];
  x = await sendMention(C.ws, gid, t4, m4);
  expectWsErrMsg('C (member) nhắc @Tất cả -> error FORBIDDEN "Chỉ trưởng / phó nhóm được nhắc cả nhóm"', x, 'FORBIDDEN',
    'Chỉ trưởng / phó nhóm được nhắc cả nhóm');
  a = await sendMention(A.ws, gid, t4, m4);
  check(a.type === 'ack' && sameMentions(a.data.mentions, m4), 'A (trưởng nhóm) nhắc @Tất cả -> ack mentions [{user_id 0}]', () => pktDetail(a));
  const seq4 = a.data.seq;
  for (const u of [B, C]) {
    await expectConv(`${u.label}: @Tất cả -> unread_mention true, last_mention_seq = seq tin @Tất cả`, u, gid,
      (c) => c.unread_mention === true && c.last_mention_seq === seq4);
  }
  await expectConv('A (người gửi @Tất cả) không tự được nhắc: last_mention_seq 0', A, gid, (c) => c.last_mention_seq === 0 && c.unread_mention === false);

  // ghim tin nhắc (mục 20 kiểm đọc ghim sau khi giải tán)
  r = await call(A, 'POST', `/conversations/${gid}/pins`, { message_id: ctx.g2MentionMsg });
  expectOk('A ghim tin nhắc tên', r, (y) => hasPin(y, ctx.g2MentionMsg));
}

async function s18() {
  const { A, B, C, D } = U;
  const gid = ctx.g2;
  if (!gid) throw new Error('chưa có nhóm từ mục 17');
  await ensureWs(A, 'A#nhóm');
  await ensureWs(B, 'B#nhóm');
  await ensureWs(C, 'C#nhóm');
  const sys = (s) => sysIn(gid, s);
  const upd = (pred) => (y) => y.conversation_id === gid && pred(y);

  // mô tả
  let r = await call(C, 'PATCH', `/conversations/${gid}`, { description: 'C muốn đổi' });
  expectErrMsg('C (member, admins_only_edit_info mặc định true) đổi mô tả -> 403 FORBIDDEN', r, 403, 'FORBIDDEN',
    'Chỉ trưởng / phó nhóm được đổi thông tin nhóm');
  r = await call(A, 'PATCH', `/conversations/${gid}`, {});
  expectErrMsg('PATCH thông tin nhóm thân rỗng -> 400 "Không có gì để cập nhật"', r, 400, 'BAD_REQUEST', 'Không có gì để cập nhật');
  r = await call(A, 'PATCH', `/conversations/${gid}`, { description: 'm'.repeat(501) });
  expectErrMsg('mô tả 501 ký tự -> 400 "Mô tả nhóm tối đa 500 ký tự"', r, 400, 'BAD_REQUEST', 'Mô tả nhóm tối đa 500 ký tự');
  const desc1 = `  Mô tả nhóm ${RUN}  `;
  r = await call(A, 'PATCH', `/conversations/${gid}`, { description: desc1 });
  expectOk('A đặt mô tả -> description đã cắt khoảng trắng', r, (x) => x.description === desc1.trim());
  let m = await waitPkt(C.ws, 'message.new', sys('đã cập nhật mô tả nhóm'));
  check(m.data.sender_id === A.id, 'C nhận tin hệ thống "A đã cập nhật mô tả nhóm"', () => pktDetail(m));
  let u = await waitPkt(C.ws, 'conversation.updated', upd((y) => y.description === desc1.trim()));
  check(u.type === 'conversation.updated' && u.data.name === ctx.g2Name && u.data.disbanded === false && !!u.data.settings &&
    isIso(u.data.updated_at), 'C nhận conversation.updated {description mới, name, settings, disbanded false, updated_at}', () => pktDetail(u));
  r = await call(A, 'PATCH', `/conversations/${gid}`, { description: null });
  expectOk('A xoá mô tả (null) -> description null', r, (x) => x.description === null);
  m = await waitPkt(C.ws, 'message.new', sys('đã xoá mô tả nhóm'));
  check(m.type === 'message.new', 'C nhận tin hệ thống "đã xoá mô tả nhóm"', () => pktDetail(m));
  const markC = C.ws.mark();
  r = await call(A, 'PATCH', `/conversations/${gid}`, { name: ctx.g2Name });
  expectOk('A PATCH tên như cũ -> ok', r, (x) => x.name === ctx.g2Name);
  await sleep(QUIET_MS);
  check(C.ws.since(markC, 'message.new', (y) => y.conversation_id === gid).length === 0, 'giá trị như cũ -> không có tin hệ thống');

  // ảnh nhóm qua luồng tệp
  r = await call(A, 'GET', '/media/config');
  const mediaOn = r.ok && r.result && r.result.enabled === true;
  ctx.g2Avatar = null;
  if (!mediaOn) {
    skip('ảnh nhóm (mục 18)', 'máy chủ chưa bật tệp');
  } else {
    const png = pngBytes(48, 48);
    const av = await uploadMedia(A, 'ảnh nhóm 48x48', { type: 'image', mime: 'image/png', size: png.length, sha256: sha256buf(png) }, png);
    if (av) {
      r = await call(B, 'PATCH', `/conversations/${gid}`, { avatar_media_id: av.id });
      expectErr('B (phó nhóm) đặt ảnh nhóm bằng tệp của A -> 404 MEDIA_NOT_FOUND', r, 404, 'MEDIA_NOT_FOUND');
      r = await call(A, 'PATCH', `/conversations/${gid}`, { avatar_media_id: 9e15 });
      expectErr('ảnh nhóm media_id không tồn tại -> 404 MEDIA_NOT_FOUND', r, 404, 'MEDIA_NOT_FOUND');
      r = await call(A, 'PATCH', `/conversations/${gid}`, { avatar_media_id: 'abc' });
      expectErr('avatar_media_id sai kiểu -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
      r = await call(A, 'PATCH', `/conversations/${gid}`, { avatar_media_id: av.id });
      expectOk('A đặt ảnh nhóm -> avatar {id, type image, status ready, url}', r,
        (x) => x.avatar && x.avatar.id === av.id && x.avatar.type === 'image' && x.avatar.status === 'ready' && !!x.avatar.url);
      m = await waitPkt(C.ws, 'message.new', sys('đã đổi ảnh đại diện nhóm'));
      check(m.data.sender_id === A.id, 'C nhận tin hệ thống "A đã đổi ảnh đại diện nhóm"', () => pktDetail(m));
      u = await waitPkt(C.ws, 'conversation.updated', upd((y) => y.avatar && y.avatar.id === av.id));
      check(u.type === 'conversation.updated' && !!u.data.avatar.url, 'C nhận conversation.updated kèm avatar có url', () => pktDetail(u));
      const { c } = await convOf(C, gid);
      check(c && c.avatar && c.avatar.id === av.id && !!c.avatar.url, 'C: danh sách hội thoại -> avatar của nhóm có url', () => js(c));
      if (c && c.avatar && c.avatar.url) {
        const o = await getObject(c.avatar.url);
        check(o.status === 200 && o.body.equals(png), 'C tải avatar.url -> đúng byte ảnh A đã tải', () => `HTTP ${o.status} ${o.ctype}`);
      }
      r = await call(C, 'GET', `/media/${av.id}`);
      expectOk('C (thành viên, không phải người tải): GET /media/:id của ảnh nhóm -> có url', r, (y) => y.media && y.media.id === av.id && !!y.media.url);
      r = await call(A, 'PATCH', `/conversations/${gid}`, { avatar_media_id: null });
      expectOk('A xoá ảnh nhóm (null) -> avatar null', r, (y) => y.avatar === null);
      m = await waitPkt(C.ws, 'message.new', sys('đã xoá ảnh đại diện nhóm'));
      check(m.type === 'message.new', 'C nhận tin hệ thống "đã xoá ảnh đại diện nhóm"', () => pktDetail(m));
      r = await call(A, 'PATCH', `/conversations/${gid}`, { avatar_media_id: av.id });
      expectOk('A đặt lại ảnh nhóm', r, (y) => y.avatar && y.avatar.id === av.id);
      if (r.ok) ctx.g2Avatar = av.id;
    }
  }

  // cài đặt: chỉ trưởng / phó nhóm gửi tin
  r = await call(C, 'PATCH', `/conversations/${gid}/settings`, { admins_only_send: true });
  expectErrMsg('C (member) đổi cài đặt -> 403 FORBIDDEN', r, 403, 'FORBIDDEN', 'Chỉ trưởng / phó nhóm được đổi cài đặt nhóm');
  r = await call(A, 'PATCH', `/conversations/${gid}/settings`, {});
  expectErrMsg('PATCH cài đặt thân rỗng -> 400 "Không có gì để cập nhật"', r, 400, 'BAD_REQUEST', 'Không có gì để cập nhật');
  r = await call(A, 'PATCH', `/conversations/${gid}/settings`, { admins_only_send: 'có' });
  expectErr('PATCH cài đặt giá trị không phải boolean -> 400 BAD_REQUEST', r, 400, 'BAD_REQUEST');
  r = await call(A, 'PATCH', `/conversations/${gid}/settings`, { admins_only_send: true });
  expectOk('A bật admins_only_send -> settings {send true, edit_info true, add_members false}', r,
    (y) => y.settings.admins_only_send === true && y.settings.admins_only_edit_info === true && y.settings.admins_only_add_members === false);
  m = await waitPkt(C.ws, 'message.new', sys('đã bật chế độ chỉ trưởng / phó nhóm được gửi tin'));
  check(m.type === 'message.new', 'C nhận tin hệ thống "đã bật chế độ chỉ trưởng / phó nhóm được gửi tin"', () => pktDetail(m));
  u = await waitPkt(C.ws, 'conversation.updated', upd((y) => y.settings && y.settings.admins_only_send === true));
  check(u.type === 'conversation.updated', 'C nhận conversation.updated settings.admins_only_send true', () => pktDetail(u));
  await expectConv('C: danh sách -> settings.admins_only_send true', C, gid, (c) => c.settings.admins_only_send === true);
  let x = await sendText(C.ws, gid, 'C (member) còn gửi được không? ' + RUN);
  expectWsErrMsg('C (member) gửi tin khi admins_only_send -> error FORBIDDEN qua WebSocket', x, 'FORBIDDEN',
    'Chỉ trưởng / phó nhóm được gửi tin trong nhóm này');
  x = await sendText(B.ws, gid, 'B (phó nhóm) vẫn gửi được ' + RUN);
  check(x.type === 'ack', 'B (phó nhóm) gửi tin khi admins_only_send -> ack', () => pktDetail(x));
  const markA = A.ws.mark();
  x = await reqPkt(C.ws, 'typing.start', { conversation_id: gid });
  check(x.type === 'ack', 'C (member) typing.start khi admins_only_send -> ack {} (không báo lỗi)', () => pktDetail(x));
  x = await reqPkt(B.ws, 'typing.start', { conversation_id: gid });
  const tp = await waitPkt(A.ws, 'typing', (y) => y.conversation_id === gid && y.user_id === B.id && y.is_typing === true);
  check(x.type === 'ack' && tp.type === 'typing', 'B (phó nhóm) typing.start -> A nhận typing', () => pktDetail(tp));
  await sleep(QUIET_MS);
  check(A.ws.since(markA, 'typing', (y) => y.conversation_id === gid && y.user_id === C.id).length === 0,
    'typing của C (member) không được chuyển cho ai');
  B.ws.send('typing.stop', { conversation_id: gid });

  // tắt admins_only_send + admins_only_edit_info: member gửi tin, đổi tên / mô tả được
  r = await call(A, 'PATCH', `/conversations/${gid}/settings`, { admins_only_send: false, admins_only_edit_info: false });
  expectOk('A tắt admins_only_send + admins_only_edit_info', r,
    (y) => y.settings.admins_only_send === false && y.settings.admins_only_edit_info === false);
  m = await waitPkt(C.ws, 'message.new', sys('đã tắt chế độ chỉ trưởng / phó nhóm được đổi thông tin nhóm'));
  check(m.type === 'message.new', 'C nhận tin hệ thống "đã tắt chế độ chỉ trưởng / phó nhóm được đổi thông tin nhóm"', () => pktDetail(m));
  x = await sendText(C.ws, gid, 'C gửi lại được ' + RUN);
  check(x.type === 'ack', 'C (member) gửi tin sau khi tắt admins_only_send -> ack', () => pktDetail(x));
  const name2 = ctx.g2Name + ' (C đổi)';
  const desc2 = 'Mô tả của C ' + RUN;
  r = await call(C, 'PATCH', `/conversations/${gid}`, { name: name2, description: desc2 });
  expectOk('C (member) đổi tên + mô tả khi admins_only_edit_info false', r, (y) => y.name === name2 && y.description === desc2);
  if (r.ok) ctx.g2Name = name2;
  ctx.g2Desc = desc2;
  m = await waitPkt(A.ws, 'message.new', sys('đã đổi tên nhóm thành'));
  check(m.data.sender_id === C.id && content(m).includes(name2), 'A nhận tin hệ thống C đổi tên nhóm', () => pktDetail(m));

  // chỉ trưởng / phó nhóm thêm thành viên / tạo link mời
  r = await call(A, 'PATCH', `/conversations/${gid}/settings`, { admins_only_add_members: true });
  expectOk('A bật admins_only_add_members', r, (y) => y.settings.admins_only_add_members === true);
  r = await call(C, 'POST', `/conversations/${gid}/members`, { user_ids: [D.id] });
  expectErrMsg('C (member) thêm thành viên khi admins_only_add_members -> 403', r, 403, 'FORBIDDEN', 'Chỉ trưởng / phó nhóm được thêm thành viên');
  r = await call(C, 'POST', `/conversations/${gid}/invite-link`, {});
  expectErrMsg('C (member) tạo link mời khi admins_only_add_members -> 403', r, 403, 'FORBIDDEN', 'Chỉ trưởng / phó nhóm được tạo link mời');
  r = await call(A, 'PATCH', `/conversations/${gid}/settings`, { admins_only_add_members: false, admins_only_edit_info: true });
  expectOk('A tắt admins_only_add_members, bật lại admins_only_edit_info', r,
    (y) => y.settings.admins_only_add_members === false && y.settings.admins_only_edit_info === true && y.settings.admins_only_send === false);
}

async function s19() {
  const { A, B, C } = U;
  const gid = ctx.g2;
  if (!gid) throw new Error('chưa có nhóm từ mục 17');
  await ensureWs(A, 'A#nhóm');
  await ensureWs(B, 'B#nhóm');
  await ensureWs(C, 'C#nhóm');
  const F = (U.F = await signUp('F', { name: 'Phúc E2E' }));
  const G = (U.G = await signUp('G', { name: 'Giang E2E' }));
  F.ws = await openWs('F#1', F);
  G.ws = await openWs('G#1', G);
  const sys = (s) => sysIn(gid, s);
  const inv = (tok) => '/invites/' + tok;

  let r = await call(A, 'GET', `/conversations/${gid}/invite-link`);
  expectOk('nhóm chưa có link -> {invite_link: null}', r, (x) => hasKey(x, 'invite_link') && x.invite_link === null);
  r = await call(A, 'POST', `/conversations/${gid}/invite-link`, { expires_in: 60 });
  expectErrMsg('expires_in 60 -> 400', r, 400, 'BAD_REQUEST', 'expires_in phải từ 3600 đến 2592000 giây');
  r = await call(A, 'POST', `/conversations/${gid}/invite-link`, {});
  const l1 = expectOk('A tạo link mời -> token 43 ký tự base64url, url_path /chat/join/<token>, không cần duyệt, không hết hạn, use_count 0', r,
    (x) => x.invite_link && /^[A-Za-z0-9_-]{43}$/.test(x.invite_link.token) && x.invite_link.url_path === '/chat/join/' + x.invite_link.token &&
      x.invite_link.requires_approval === false && x.invite_link.expires_at === null && x.invite_link.expired === false &&
      x.invite_link.use_count === 0 && x.invite_link.created_by === A.id && x.invite_link.created_by_name === A.name &&
      x.invite_link.conversation_id === gid && isIso(x.invite_link.created_at));
  const tok1 = l1 && l1.invite_link ? l1.invite_link.token : null;
  if (!tok1) throw new Error('không tạo được link mời');
  r = await call(C, 'GET', `/conversations/${gid}/invite-link`);
  expectOk('C (member) xem link hiện hành -> có link, KHÔNG có token / url_path', r,
    (x) => x.invite_link && x.invite_link.id === l1.invite_link.id && !hasKey(x.invite_link, 'token') && !hasKey(x.invite_link, 'url_path'));

  r = await call(F, 'GET', inv('abc'));
  expectErr('token sai dạng -> 404 INVITE_INVALID', r, 404, 'INVITE_INVALID');
  r = await call(F, 'GET', inv(crypto.randomBytes(32).toString('base64url')));
  expectErrMsg('token đúng dạng nhưng không có -> 404 INVITE_INVALID', r, 404, 'INVITE_INVALID', 'Link mời không tồn tại hoặc đã bị thu hồi');
  r = await rest('GET', inv(tok1));
  expectErr('xem trước không đăng nhập -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');
  r = await call(F, 'GET', inv(tok1));
  expectOk('F (người ngoài) xem trước -> group {name, description, avatar, member_count 3}, membership none, conversation_id null, ' +
    'không lộ thành viên', r,
  (x) => x.group && x.group.name === ctx.g2Name && x.group.description === ctx.g2Desc && x.group.member_count === 3 &&
      (ctx.g2Avatar ? x.group.avatar && x.group.avatar.id === ctx.g2Avatar && !!x.group.avatar.url : x.group.avatar === null) &&
      x.requires_approval === false && x.expires_at === null && x.membership === 'none' && x.conversation_id === null &&
      !hasKey(x.group, 'members') && !hasKey(x.group, 'id') && !JSON.stringify(x).includes('"user_id"'));
  if (ctx.g2Avatar) {
    r = await call(F, 'GET', `/media/${ctx.g2Avatar}`);
    expectErr('F (chưa vào nhóm): GET /media/:id ảnh nhóm -> 404 MEDIA_NOT_FOUND', r, 404, 'MEDIA_NOT_FOUND');
  }

  // chặn trưởng nhóm -> không vào được
  r = await call(F, 'POST', '/blocks', { user_id: A.id });
  expectOk('F chặn A (trưởng nhóm)', r);
  r = await call(F, 'POST', inv(tok1) + '/join', {});
  expectErrMsg('F (đang chặn trưởng nhóm) vào qua link -> 403 BLOCKED', r, 403, 'BLOCKED', 'Bạn không thể tham gia nhóm này');
  r = await call(F, 'DELETE', `/blocks/${A.id}`);
  expectOk('F bỏ chặn A', r);

  // vào thẳng
  A.ws.clear();
  r = await call(F, 'POST', inv(tok1) + '/join', {});
  expectOk('F vào qua link (không cần duyệt, không là bạn ai) -> {status joined, conversation_id, request_id null}', r,
    (x) => x.status === 'joined' && x.conversation_id === gid && x.request_id === null);
  let m = await waitPkt(A.ws, 'message.new', sys('đã tham gia nhóm qua link mời'));
  check(m.data.sender_id === F.id && content(m).includes(F.name), 'A nhận tin hệ thống "F đã tham gia nhóm qua link mời" (người gửi = F)',
    () => pktDetail(m));
  let mu = await waitPkt(A.ws, 'members.updated', (y) => y.conversation_id === gid && y.member_count === 4);
  check(mu.type === 'members.updated', 'A nhận members.updated {member_count 4}', () => pktDetail(mu));
  m = await waitPkt(F.ws, 'message.new', sys('đã tham gia nhóm qua link mời'));
  check(m.type === 'message.new', 'F (thành viên mới) cũng nhận tin hệ thống', () => pktDetail(m));
  await expectConv('F: danh sách có nhóm, role member, left false, member_count 4', F, gid,
    (c) => c.role === 'member' && c.left === false && c.member_count === 4);
  if (ctx.g2Avatar) {
    r = await call(F, 'GET', `/media/${ctx.g2Avatar}`);
    expectOk('F (đã vào nhóm): GET /media/:id ảnh nhóm -> có url', r, (y) => y.media && !!y.media.url);
  }
  r = await call(F, 'POST', inv(tok1) + '/join', {});
  expectOk('F vào lại -> already_member, conversation_id', r, (x) => x.status === 'already_member' && x.conversation_id === gid && x.request_id === null);
  r = await call(F, 'GET', inv(tok1));
  expectOk('F xem trước khi đã là thành viên -> membership member, conversation_id', r, (x) => x.membership === 'member' && x.conversation_id === gid);
  r = await call(A, 'GET', `/conversations/${gid}/invite-link`);
  expectOk('link sau 1 lượt vào -> use_count 1', r, (x) => x.invite_link && x.invite_link.use_count === 1);

  // tạo lại link cần duyệt (link cũ bị thu hồi)
  r = await call(A, 'POST', `/conversations/${gid}/invite-link`, { requires_approval: true, expires_in: 3600 });
  const l2 = expectOk('A tạo lại link cần duyệt, hết hạn sau 1 giờ -> token mới, requires_approval true, expires_at ~ +1 giờ', r,
    (x) => x.invite_link && x.invite_link.token !== tok1 && x.invite_link.requires_approval === true && isIso(x.invite_link.expires_at) &&
      Math.abs(Date.parse(x.invite_link.expires_at) - Date.now() - 3600000) < 60000 + CLOCK_SLACK_MS && x.invite_link.use_count === 0);
  const tok2 = l2 && l2.invite_link ? l2.invite_link.token : null;
  if (!tok2) throw new Error('không tạo lại được link mời');
  r = await call(G, 'GET', inv(tok1));
  expectErr('link cũ sau khi tạo lại -> 404 INVITE_INVALID', r, 404, 'INVITE_INVALID');
  r = await call(G, 'GET', inv(tok2));
  expectOk('G xem trước link mới -> requires_approval true, expires_at, membership none, member_count 4', r,
    (x) => x.requires_approval === true && isIso(x.expires_at) && x.membership === 'none' && x.group.member_count === 4);

  // xin vào -> chờ duyệt
  A.ws.clear();
  const markC = C.ws.mark();
  r = await call(G, 'POST', inv(tok2) + '/join', {});
  const jq = expectOk('G vào qua link cần duyệt -> {status pending, request_id, conversation_id null}', r,
    (x) => x.status === 'pending' && Number.isInteger(x.request_id) && x.conversation_id === null);
  const reqG = (ctx.g2ReqG = jq && jq.request_id);
  r = await call(G, 'POST', inv(tok2) + '/join', {});
  expectOk('G xin lại -> pending, cùng request_id (không tạo mới)', r, (x) => x.status === 'pending' && x.request_id === reqG);
  r = await call(G, 'GET', inv(tok2));
  expectOk('G xem trước khi đang chờ -> membership pending', r, (x) => x.membership === 'pending' && x.conversation_id === null);
  for (const u of [A, B]) {
    const p = await waitPkt(u.ws, 'join_requests.updated', (y) => y.conversation_id === gid && y.pending_count === 1);
    check(p.type === 'join_requests.updated', `${u.label} (trưởng / phó nhóm) nhận join_requests.updated {pending_count 1}`, () => pktDetail(p));
  }
  await sleep(QUIET_MS);
  check(C.ws.since(markC, 'join_requests.updated').length === 0, 'C (member) không nhận join_requests.updated');
  r = await call(A, 'GET', `/conversations/${gid}`);
  expectOk('A: chi tiết nhóm -> pending_join_requests 1', r, (x) => x.pending_join_requests === 1);
  r = await call(C, 'GET', `/conversations/${gid}`);
  expectOk('C (member): chi tiết nhóm -> pending_join_requests 0', r, (x) => x.pending_join_requests === 0);
  r = await call(C, 'GET', `/conversations/${gid}/join-requests`);
  expectErrMsg('C (member) xem yêu cầu vào nhóm -> 403', r, 403, 'FORBIDDEN', 'Chỉ trưởng / phó nhóm được duyệt thành viên');
  r = await call(G, 'GET', `/conversations/${gid}`);
  expectErr('G (đang chờ duyệt) chưa đọc được nhóm -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  r = await call(B, 'GET', `/conversations/${gid}/join-requests`);
  expectOk('B (phó nhóm) xem yêu cầu -> 1 yêu cầu của G {id, conversation_id, user, created_at}', r,
    (x) => x.requests.length === 1 && x.requests[0].id === reqG && x.requests[0].conversation_id === gid &&
      x.requests[0].user.id === G.id && x.requests[0].user.display_name === G.name && isIso(x.requests[0].created_at));
  r = await call(C, 'POST', `/conversations/${gid}/join-requests/${reqG}/approve`, {});
  expectErr('C (member) duyệt -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  r = await call(A, 'POST', `/conversations/${gid}/join-requests/${reqG}/approve`, {});
  expectOk('A duyệt G -> {status approved}', r, (x) => x.status === 'approved');
  m = await waitPkt(G.ws, 'message.new', sys('đã duyệt'));
  check(m.data.sender_id === A.id && content(m).includes(G.name), 'G nhận tin hệ thống "A đã duyệt G vào nhóm"', () => pktDetail(m));
  mu = await waitPkt(A.ws, 'members.updated', (y) => y.conversation_id === gid && y.member_count === 5);
  check(mu.type === 'members.updated', 'A nhận members.updated {member_count 5}', () => pktDetail(mu));
  const jr = await waitPkt(A.ws, 'join_requests.updated', (y) => y.conversation_id === gid && y.pending_count === 0);
  check(jr.type === 'join_requests.updated', 'A nhận join_requests.updated {pending_count 0} sau khi duyệt', () => pktDetail(jr));
  await expectConv('G: danh sách có nhóm, role member', G, gid, (c) => c.role === 'member' && c.left === false);
  r = await call(A, 'POST', `/conversations/${gid}/join-requests/${reqG}/approve`, {});
  expectErrMsg('duyệt lại yêu cầu đã xử lý -> 404 NOT_FOUND', r, 404, 'NOT_FOUND', 'Yêu cầu không còn chờ duyệt');
  r = await call(A, 'GET', `/conversations/${gid}/invite-link`);
  expectOk('link cần duyệt sau khi duyệt G -> use_count 1', r,
    (x) => x.invite_link && x.invite_link.use_count === 1 && x.invite_link.requires_approval === true);

  // từ chối: F rời nhóm rồi xin lại
  r = await call(F, 'DELETE', `/conversations/${gid}/members/${F.id}`);
  expectOk('F rời nhóm', r);
  r = await call(F, 'POST', inv(tok2) + '/join', {});
  const jf = expectOk('F (đã rời) xin vào lại qua link cần duyệt -> pending', r, (x) => x.status === 'pending' && Number.isInteger(x.request_id));
  const reqF = jf && jf.request_id;
  const markF = F.ws.mark();
  r = await call(B, 'POST', `/conversations/${gid}/join-requests/${reqF}/reject`, {});
  expectOk('B (phó nhóm) từ chối F -> {status rejected}', r, (x) => x.status === 'rejected');
  r = await call(F, 'GET', inv(tok2));
  expectOk('F sau khi bị từ chối -> membership none', r, (x) => x.membership === 'none');
  r = await call(A, 'GET', `/conversations/${gid}/join-requests`);
  expectOk('hàng chờ trống', r, (x) => Array.isArray(x.requests) && x.requests.length === 0);
  r = await call(B, 'POST', `/conversations/${gid}/join-requests/${reqF}/reject`, {});
  expectErr('từ chối lại -> 404 NOT_FOUND', r, 404, 'NOT_FOUND');
  await sleep(QUIET_MS);
  check(F.ws.since(markF, 'message.new', (y) => y.conversation_id === gid).length === 0, 'từ chối: không có tin hệ thống, F không được báo');

  // thu hồi
  r = await call(C, 'DELETE', `/conversations/${gid}/invite-link`);
  expectErrMsg('C (member) thu hồi link do A tạo -> 403', r, 403, 'FORBIDDEN', 'Bạn không có quyền thu hồi link này');
  r = await call(C, 'POST', `/conversations/${gid}/invite-link`, {});
  expectErrMsg('C (member) tạo lại đè link do A tạo -> 403', r, 403, 'FORBIDDEN', 'Bạn không có quyền thu hồi link này');
  r = await call(A, 'DELETE', `/conversations/${gid}/invite-link`);
  expectOk('A thu hồi link -> {}', r);
  r = await call(A, 'DELETE', `/conversations/${gid}/invite-link`);
  expectOk('thu hồi lần nữa (không còn link) -> {} (idempotent)', r);
  r = await call(G, 'GET', inv(tok2));
  expectErr('xem trước link đã thu hồi -> 404 INVITE_INVALID', r, 404, 'INVITE_INVALID');
  r = await call(F, 'POST', inv(tok2) + '/join', {});
  expectErr('vào bằng link đã thu hồi -> 404 INVITE_INVALID', r, 404, 'INVITE_INVALID');
  r = await call(A, 'GET', `/conversations/${gid}/invite-link`);
  expectOk('sau khi thu hồi -> invite_link null', r, (x) => x.invite_link === null);
  r = await call(C, 'POST', `/conversations/${gid}/invite-link`, {});
  expectOk('C (member, admins_only_add_members false) tạo link -> có token', r,
    (x) => x.invite_link && x.invite_link.created_by === C.id && !!x.invite_link.token);
  r = await call(C, 'DELETE', `/conversations/${gid}/invite-link`);
  expectOk('C thu hồi link do chính mình tạo -> {}', r);
  r = await call(A, 'GET', `/conversations/${gid}/invite-link`);
  expectOk('sau khi C thu hồi -> invite_link null', r, (x) => x.invite_link === null);
}

async function s20() {
  const { A, B, C, E, G } = U;
  const gid = ctx.g2;
  if (!gid || !G) throw new Error('chưa có nhóm / G từ mục 17-19');
  await ensureWs(A, 'A#nhóm');
  await ensureWs(B, 'B#nhóm');
  await ensureWs(C, 'C#nhóm');
  await ensureWs(G, 'G#2');
  const sys = (s) => sysIn(gid, s);

  // chuyển trưởng nhóm
  let r = await call(B, 'POST', `/conversations/${gid}/owner`, { user_id: C.id });
  expectErrMsg('B (phó nhóm) chuyển trưởng nhóm -> 403', r, 403, 'FORBIDDEN', 'Chỉ trưởng nhóm được chuyển quyền trưởng nhóm');
  r = await call(A, 'POST', `/conversations/${gid}/owner`, {});
  expectErrMsg('chuyển trưởng nhóm thiếu user_id -> 400', r, 400, 'BAD_REQUEST', 'Thiếu user_id');
  r = await call(A, 'POST', `/conversations/${gid}/owner`, { user_id: A.id });
  expectErrMsg('chuyển cho chính mình -> 400 "Bạn đã là trưởng nhóm"', r, 400, 'BAD_REQUEST', 'Bạn đã là trưởng nhóm');
  r = await call(A, 'POST', `/conversations/${gid}/owner`, { user_id: E.id });
  expectErrMsg('chuyển cho người ngoài nhóm -> 404 NOT_FOUND', r, 404, 'NOT_FOUND', 'Người này không còn trong nhóm');
  C.ws.clear();
  r = await call(A, 'POST', `/conversations/${gid}/owner`, { user_id: C.id });
  expectOk('A chuyển trưởng nhóm cho C -> C owner, A thành admin, B vẫn admin', r,
    (x) => member(x, C.id).role === 'owner' && member(x, A.id).role === 'admin' && member(x, B.id).role === 'admin' && x.role === 'admin');
  let m = await waitPkt(G.ws, 'message.new', sys('đã chuyển quyền trưởng nhóm cho'));
  check(m.data.sender_id === A.id && content(m).includes(C.name), 'G nhận tin hệ thống "A đã chuyển quyền trưởng nhóm cho C"', () => pktDetail(m));
  const mu = await waitPkt(C.ws, 'members.updated', (y) => y.conversation_id === gid);
  check(mu.type === 'members.updated', 'C nhận members.updated sau khi chuyển trưởng nhóm', () => pktDetail(mu));
  r = await call(C, 'GET', `/conversations/${gid}`);
  expectOk('C: chi tiết -> role owner', r, (x) => x.role === 'owner');

  // giải tán
  r = await call(A, 'POST', `/conversations/${gid}/disband`, {});
  expectErrMsg('A (giờ là phó nhóm) giải tán -> 403', r, 403, 'FORBIDDEN', 'Chỉ trưởng nhóm được giải tán nhóm');
  r = await call(C, 'POST', `/conversations/${gid}/disband`);
  expectOk('C (trưởng nhóm) giải tán nhóm (không có thân) -> {}', r);
  let dseq = 0;
  for (const u of [A, B, C, G]) {
    m = await waitPkt(u.ws, 'message.new', sys('đã giải tán nhóm'));
    check(m.data.sender_id === C.id, `${u.label} nhận tin hệ thống "C đã giải tán nhóm"`, () => pktDetail(m));
    if (m.data.seq) dseq = m.data.seq;
    const cu = await waitPkt(u.ws, 'conversation.updated', (y) => y.conversation_id === gid && y.disbanded === true);
    check(cu.type === 'conversation.updated', `${u.label} nhận conversation.updated {disbanded true}`, () => pktDetail(cu));
  }

  // đọc được
  for (const u of [A, B]) {
    await expectConv(`${u.label}: danh sách -> nhóm vẫn hiện, disbanded true, left false, member_count 0, unread 0, unread_mention false`,
      u, gid, (c) => c.disbanded === true && c.left === false && c.member_count === 0 && c.unread === 0 && c.unread_mention === false &&
        c.name === ctx.g2Name && !!c.settings && c.last_message && c.last_message.msg_type === 'system');
  }
  r = await call(A, 'GET', '/sync', undefined, { cursor: String(Date.now() - 60000) });
  expectOk('A: /sync -> dòng nhóm disbanded true, left false', r, (x) => {
    const c = findConv(x.conversations, gid);
    return c && c.disbanded === true && c.left === false;
  });
  r = await call(A, 'GET', `/conversations/${gid}`);
  expectOk('A: chi tiết nhóm đã giải tán -> disbanded true, members [], pending_join_requests 0', r,
    (x) => x.disbanded === true && Array.isArray(x.members) && x.members.length === 0 && x.pending_join_requests === 0);
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { limit: 5 });
  expectOk('B: đọc lịch sử nhóm đã giải tán -> có tin "đã giải tán nhóm"', r,
    (x) => x.messages.some((mm) => mm.msg_type === 'system' && mm.content.includes('đã giải tán nhóm')));
  r = await call(G, 'GET', `/conversations/${gid}/pins`);
  expectOk('G: đọc ghim của nhóm đã giải tán -> còn tin đã ghim', r, (x) => hasPin(x, ctx.g2MentionMsg));
  r = await call(C, 'GET', `/conversations/${gid}/invite-link`);
  expectOk('GET invite-link sau giải tán -> null', r, (x) => x.invite_link === null);
  if (ctx.g2Avatar) {
    r = await call(B, 'GET', `/media/${ctx.g2Avatar}`);
    expectOk('B: ảnh nhóm vẫn đọc được sau giải tán', r, (x) => x.media && !!x.media.url);
  }

  // ghi -> 410 GROUP_DISBANDED
  let x = await sendText(A.ws, gid, 'gửi vào nhóm đã giải tán');
  expectWsErrMsg('WS message.send vào nhóm đã giải tán -> error GROUP_DISBANDED', x, 'GROUP_DISBANDED', 'Nhóm đã bị giải tán');
  x = await reqPkt(B.ws, 'message.read', { conversation_id: gid, seq: dseq || 1 });
  expectWsErr('WS message.read trên nhóm đã giải tán -> error GROUP_DISBANDED', x, 'GROUP_DISBANDED');
  x = await reqPkt(C.ws, 'typing.start', { conversation_id: gid });
  check(x.type === 'ack', 'typing.start trên nhóm đã giải tán -> ack {} (bỏ qua im lặng)', () => pktDetail(x));
  const writes = [
    ['PATCH thông tin nhóm', C, 'PATCH', `/conversations/${gid}`, { name: 'Tên mới' }],
    ['PATCH cài đặt', C, 'PATCH', `/conversations/${gid}/settings`, { admins_only_send: true }],
    ['thêm thành viên', C, 'POST', `/conversations/${gid}/members`, { user_ids: [A.id] }],
    ['xoá người khác', C, 'DELETE', `/conversations/${gid}/members/${B.id}`],
    ['đổi vai trò', C, 'PATCH', `/conversations/${gid}/members/${B.id}`, { role: 'member' }],
    ['chuyển trưởng nhóm', C, 'POST', `/conversations/${gid}/owner`, { user_id: B.id }],
    ['giải tán lần nữa', C, 'POST', `/conversations/${gid}/disband`, {}],
    ['tạo link mời', C, 'POST', `/conversations/${gid}/invite-link`, {}],
    ['thu hồi link mời', C, 'DELETE', `/conversations/${gid}/invite-link`],
    ['duyệt yêu cầu', C, 'POST', `/conversations/${gid}/join-requests/${ctx.g2ReqG || 1}/approve`, {}],
    ['từ chối yêu cầu', C, 'POST', `/conversations/${gid}/join-requests/${ctx.g2ReqG || 1}/reject`, {}],
    ['ghim tin', C, 'POST', `/conversations/${gid}/pins`, { message_id: ctx.g2MentionMsg }],
    ['bỏ ghim', C, 'DELETE', `/conversations/${gid}/pins/${ctx.g2MentionMsg}`],
    ['tắt thông báo', A, 'PUT', `/conversations/${gid}/mute`, { until: 'forever' }],
  ];
  for (const [what, u, method, path, body] of writes) {
    r = await call(u, method, path, body);
    expectErrMsg(`${what} trên nhóm đã giải tán -> 410 GROUP_DISBANDED`, r, 410, 'GROUP_DISBANDED', 'Nhóm đã bị giải tán');
  }

  // gỡ khỏi danh sách
  const markB = B.ws.mark();
  r = await call(A, 'DELETE', `/conversations/${gid}/members/${A.id}`);
  expectOk('A gỡ nhóm đã giải tán khỏi danh sách (xoá chính mình) -> {}', r);
  const { r: lr, c: gone } = await convOf(A, gid);
  check(lr.ok && !gone, 'A: GET /conversations không còn nhóm', () => brief(lr));
  r = await call(A, 'GET', `/conversations/${gid}`);
  expectErr('A: chi tiết nhóm sau khi gỡ -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  await expectConv('B: nhóm vẫn còn (chỉ đọc)', B, gid, (c) => c.disbanded === true && c.left === false);
  await sleep(QUIET_MS);
  check(B.ws.since(markB, 'message.new', (y) => y.conversation_id === gid).length === 0, 'gỡ khỏi danh sách không sinh tin hệ thống');
}

// ───────────── 21-23. Giai đoạn 2 (migration 0023, API.md mục "Giai đoạn 2") ─────────────

const findMsg = (x, id) => (x && Array.isArray(x.messages) ? x.messages.find((m) => m && m.id === id) : undefined);
const sendReply = (c, conv, text, replyTo, cmid = uuid()) =>
  reqPkt(c, 'message.send', { conversation_id: conv, client_msg_id: cmid, msg_type: 'text', content: text, reply_to_message_id: replyTo });
const NO_ID = 999999999999;

// 21. Trả lời, sửa, reaction, nhảy tới tin, thu hồi, đồng bộ thay đổi, chuyển tiếp.
async function s21() {
  const { A, B, C, F } = U;
  await ensureWs(A, 'A#gđ2');
  await ensureWs(B, 'B#gđ2');
  await ensureWs(C, 'C#gđ2');
  const gName = 'Nhóm giai đoạn 2 ' + RUN;
  let r = await call(A, 'POST', '/conversations', { type: 'group', name: gName, member_ids: [B.id, C.id] });
  const g = expectOk('A tạo nhóm giai đoạn 2 với B, C', r, (x) => x.type === 'group' && x.member_count === 3);
  if (!g || !g.id) throw new Error('không tạo được nhóm giai đoạn 2');
  const gid = (ctx.g3 = g.id);
  ctx.g3Name = gName;
  r = await call(A, 'PATCH', `/conversations/${gid}/members/${B.id}`, { role: 'admin' });
  expectOk('A đặt B làm phó nhóm', r, (x) => member(x, B.id).role === 'admin');
  r = await call(A, 'GET', `/conversations/${gid}/messages`);
  const sysMsg = r.ok ? r.result.messages.find((m) => m.msg_type === 'system') : undefined;
  check(!!sysMsg, 'nhóm mới có tin hệ thống (dùng cho các bước "không với tin hệ thống")', () => brief(r));
  const outsider = F && F.access ? F : null;

  // B1. trả lời
  const t0 = `Tin gốc ${RUN}`;
  let a = await sendText(A.ws, gid, t0);
  check(a.type === 'ack' && !hasKey(a.data, 'reply_to'), 'A gửi tin gốc -> ack không có reply_to', () => pktDetail(a));
  const m0 = a.data.message_id;
  const seq0 = a.data.seq;
  const cmR = uuid();
  a = await sendReply(B.ws, gid, 'Trả lời ' + RUN, m0, cmR);
  const rp = a.data && a.data.reply_to;
  check(a.type === 'ack' && rp && rp.message_id === m0 && rp.seq === seq0 && rp.sender_id === A.id && rp.sender_name === A.name &&
    rp.msg_type === 'text' && rp.content === t0 && rp.recalled === false && !hasKey(rp, 'file_name'),
  'B trả lời tin của A -> ack.reply_to {message_id, seq, sender_id, sender_name, msg_type text, content, recalled false}', () => pktDetail(a));
  const mR = a.data.message_id;
  let mn = await waitPkt(C.ws, 'message.new', (x) => x.client_msg_id === cmR);
  check(mn.type === 'message.new' && mn.data.reply_to && mn.data.reply_to.message_id === m0 && mn.data.reply_to.content === t0,
    'C nhận message.new kèm reply_to', () => pktDetail(mn));
  a = await sendReply(B.ws, gid, 'Trả lời ' + RUN, m0, cmR);
  check(a.type === 'ack' && a.data.duplicate === true && a.data.message_id === mR && a.data.reply_to && a.data.reply_to.message_id === m0,
    'B gửi lại cùng client_msg_id -> ack duplicate kèm reply_to của tin cũ', () => pktDetail(a));
  a = await sendReply(B.ws, gid, 'trả lời tin không có', NO_ID);
  expectWsErrMsg('trả lời tin không tồn tại -> error NOT_FOUND "Không tìm thấy tin nhắn"', a, 'NOT_FOUND', 'Không tìm thấy tin nhắn');
  a = await sendReply(A.ws, ctx.direct, 'trả lời tin của nhóm khác', m0);
  expectWsErrMsg('trả lời tin của hội thoại khác -> error NOT_FOUND', a, 'NOT_FOUND', 'Không tìm thấy tin nhắn');
  if (sysMsg) {
    a = await sendReply(B.ws, gid, 'trả lời tin hệ thống', sysMsg.id);
    expectWsErrMsg('trả lời tin hệ thống -> error BAD_REQUEST "Không trả lời được tin hệ thống"', a, 'BAD_REQUEST', 'Không trả lời được tin hệ thống');
  }

  // B4. sửa
  const syncAt = Date.now();
  const t0e = `Tin gốc đã sửa ${RUN}`;
  r = await call(A, 'PATCH', `/messages/${m0}`, { content: '  ' + t0e + '  ' });
  expectOk('A sửa tin của mình -> content mới (cắt khoảng trắng), edited_at, cùng seq', r,
    (x) => x.id === m0 && x.seq === seq0 && x.content === t0e && isIso(x.edited_at) && x.conversation_id === gid);
  for (const u of [B, C, A]) {
    const p = await waitPkt(u.ws, 'message.updated', (y) => y.conversation_id === gid && y.action === 'edit' && y.message && y.message.id === m0);
    check(p.type === 'message.updated' && p.data.message.content === t0e && isIso(p.data.message.edited_at) && !hasKey(p.data.message, 'reactions'),
      `${u.label} nhận message.updated {action edit, tin mới, không có reactions}${u === A ? ' (cả kết nối của người sửa)' : ''}`, () => pktDetail(p));
  }
  let mk = C.ws.mark();
  r = await call(A, 'PATCH', `/messages/${m0}`, { content: t0e });
  expectOk('sửa lại đúng nội dung đang có -> trả tin, không đổi gì', r, (x) => x.id === m0 && x.content === t0e);
  await sleep(QUIET_MS);
  check(C.ws.since(mk, 'message.updated', (y) => y.message && y.message.id === m0).length === 0, 'sửa không đổi gì -> không gửi message.updated');
  r = await call(B, 'PATCH', `/messages/${m0}`, { content: 'B sửa tin của A' });
  expectErrMsg('B sửa tin của A -> 403 "Bạn chỉ sửa được tin nhắn của mình"', r, 403, 'FORBIDDEN', 'Bạn chỉ sửa được tin nhắn của mình');
  r = await call(A, 'PATCH', `/messages/${m0}`, { content: '   ' });
  expectErrMsg('sửa thành rỗng -> 400 "Tin nhắn trống"', r, 400, 'BAD_REQUEST', 'Tin nhắn trống');
  r = await call(A, 'PATCH', `/messages/${NO_ID}`, { content: 'x' });
  expectErrMsg('sửa tin không tồn tại -> 404 "Không tìm thấy tin nhắn"', r, 404, 'NOT_FOUND', 'Không tìm thấy tin nhắn');
  if (outsider) {
    r = await call(outsider, 'PATCH', `/messages/${m0}`, { content: 'x' });
    expectErrMsg('người ngoài nhóm sửa -> 404 (không lộ tin tồn tại)', r, 404, 'NOT_FOUND', 'Không tìm thấy tin nhắn');
  }
  if (sysMsg) {
    r = await call(A, 'PATCH', `/messages/${sysMsg.id}`, { content: 'x' });
    expectErrMsg('sửa tin hệ thống -> 400 "Chỉ sửa được tin nhắn văn bản"', r, 400, 'BAD_REQUEST', 'Chỉ sửa được tin nhắn văn bản');
  }
  const t0m = `@${B.name} xem lại ${RUN}`;
  const mm0 = [mentionOf(t0m, '@' + B.name, B.id)];
  r = await call(A, 'PATCH', `/messages/${m0}`, { content: t0m, mentions: mm0 });
  expectOk('A sửa thêm nhắc B -> mentions mới', r, (x) => x.content === t0m && sameMentions(x.mentions, mm0));
  await expectConv('B: được nhắc qua sửa tin -> last_mention_seq = seq tin được sửa', B, gid, (c) => c.last_mention_seq === seq0);
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { after_seq: seq0 - 1 });
  expectOk('lịch sử: tin gốc có edited_at, tin trả lời có reply_to theo bản đã sửa (không mentions)', r, (x) => {
    const o = findMsg(x, m0);
    const rr = findMsg(x, mR);
    return o && isIso(o.edited_at) && o.content === t0m && rr && rr.reply_to && rr.reply_to.content === t0m && !hasKey(rr.reply_to, 'mentions');
  });
  r = await call(B, 'GET', '/sync', undefined, { cursor: String(syncAt) });
  expectOk('/sync sau khi sửa tin -> có nhóm (updated_at của hội thoại được đẩy)', r, (x) => !!findConv(x.conversations, gid));

  // C. reaction
  r = await call(B, 'PUT', `/messages/${m0}/reaction`, { reaction: 'like' });
  expectOk('B thả like -> {counts {like 1}, total 1, mine like}', r,
    (x) => x.total === 1 && x.counts.like === 1 && Object.keys(x.counts).length === 1 && x.mine === 'like');
  let ru = await waitPkt(A.ws, 'reactions.updated', (y) => y.message_id === m0 && y.user_id === B.id && y.reaction === 'like');
  check(ru.type === 'reactions.updated' && ru.data.conversation_id === gid && ru.data.seq === seq0 && ru.data.total === 1 && ru.data.counts.like === 1,
    'A nhận reactions.updated {conversation_id, message_id, seq, counts, total, user_id B, reaction like}', () => pktDetail(ru));
  ru = await waitPkt(B.ws, 'reactions.updated', (y) => y.message_id === m0 && y.user_id === B.id && y.reaction === 'like');
  check(ru.type === 'reactions.updated', 'B (người thả) cũng nhận reactions.updated trên kết nối của mình', () => pktDetail(ru));
  r = await call(C, 'PUT', `/messages/${m0}/reaction`, { reaction: 'love' });
  expectOk('C thả love -> counts {like 1, love 1}, total 2, mine love', r, (x) => x.total === 2 && x.counts.like === 1 && x.counts.love === 1 && x.mine === 'love');
  r = await call(B, 'PUT', `/messages/${m0}/reaction`, { reaction: 'love' });
  expectOk('B đổi sang love -> counts {love 2} (like biến mất), mine love', r,
    (x) => x.total === 2 && x.counts.love === 2 && !hasKey(x.counts, 'like') && x.mine === 'love');
  ru = await waitPkt(C.ws, 'reactions.updated', (y) => y.message_id === m0 && y.user_id === B.id && y.reaction === 'love');
  check(ru.type === 'reactions.updated' && ru.data.total === 2 && ru.data.counts.love === 2, 'C nhận reactions.updated khi B đổi cảm xúc', () => pktDetail(ru));
  mk = C.ws.mark();
  r = await call(B, 'PUT', `/messages/${m0}/reaction`, { reaction: 'love' });
  expectOk('B thả lại đúng love -> giữ nguyên', r, (x) => x.total === 2 && x.mine === 'love');
  await sleep(QUIET_MS);
  check(C.ws.since(mk, 'reactions.updated', (y) => y.message_id === m0).length === 0, 'thả lại cảm xúc cũ -> không gửi reactions.updated');
  r = await call(B, 'PUT', `/messages/${m0}/reaction`, { reaction: 'cười' });
  expectErrMsg('cảm xúc lạ -> 400 "Cảm xúc không hợp lệ"', r, 400, 'BAD_REQUEST', 'Cảm xúc không hợp lệ');
  r = await call(B, 'PUT', `/messages/${m0}/reaction`, { reaction: 'LIKE' });
  expectErrMsg('code viết hoa -> 400 (phân biệt hoa thường)', r, 400, 'BAD_REQUEST', 'Cảm xúc không hợp lệ');
  if (sysMsg) {
    r = await call(B, 'PUT', `/messages/${sysMsg.id}/reaction`, { reaction: 'like' });
    expectErrMsg('thả cảm xúc cho tin hệ thống -> 400', r, 400, 'BAD_REQUEST', 'Không thả cảm xúc cho tin hệ thống');
  }
  if (outsider) {
    r = await call(outsider, 'PUT', `/messages/${m0}/reaction`, { reaction: 'like' });
    expectErrMsg('người ngoài nhóm thả cảm xúc -> 404', r, 404, 'NOT_FOUND', 'Không tìm thấy tin nhắn');
  }
  r = await call(A, 'GET', `/messages/${m0}/reactions`);
  expectOk('A: GET reactions -> 2 người, mỗi dòng {user_id, display_name, reaction, created_at}', r,
    (x) => x.message_id === m0 && x.reactions.length === 2 && x.reactions.every((y) => y.reaction === 'love' && typeof y.display_name === 'string' &&
      isIso(y.created_at)) && x.reactions.some((y) => y.user_id === B.id) && x.reactions.some((y) => y.user_id === C.id));
  r = await call(C, 'DELETE', `/messages/${m0}/reaction`);
  expectOk('C bỏ cảm xúc -> counts {love 1}, total 1, mine null', r, (x) => x.total === 1 && x.counts.love === 1 && x.mine === null);
  ru = await waitPkt(B.ws, 'reactions.updated', (y) => y.message_id === m0 && y.user_id === C.id && y.reaction === null);
  check(ru.type === 'reactions.updated' && ru.data.total === 1, 'B nhận reactions.updated {user_id C, reaction null}', () => pktDetail(ru));
  r = await call(C, 'DELETE', `/messages/${m0}/reaction`);
  expectOk('C bỏ lần nữa -> giữ nguyên (idempotent)', r, (x) => x.total === 1 && x.mine === null);
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { after_seq: seq0 - 1 });
  expectOk('B: lịch sử -> tin có reactions {counts {love 1}, total 1, mine love}; tin không có reaction thì không có khoá', r, (x) => {
    const o = findMsg(x, m0);
    const rr = findMsg(x, mR);
    return o && o.reactions && o.reactions.total === 1 && o.reactions.counts.love === 1 && o.reactions.mine === 'love' && rr && !hasKey(rr, 'reactions');
  });
  r = await call(A, 'GET', `/conversations/${gid}/messages`, undefined, { after_seq: seq0 - 1 });
  expectOk('A: cùng tin -> mine null', r, (x) => findMsg(x, m0).reactions.mine === null);

  // nhảy tới tin (around_seq)
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { around_seq: seq0, limit: 2 });
  expectOk('around_seq = seq tin gốc, limit 2 -> [seq-1, seq], has_more true, has_newer true (còn tin trả lời phía sau)', r,
    (x) => js(x.messages.map((m) => m.seq)) === js([seq0 - 1, seq0]) && x.has_more === true && x.has_newer === true);
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { around_seq: 1e9, limit: 4 });
  expectOk('around_seq lớn hơn last_seq -> kẹp về tin cuối, has_newer false', r,
    (x) => x.messages.length > 0 && x.has_newer === false && ascContiguous(x.messages));
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { around_seq: seq0, before_seq: seq0 });
  expectErrMsg('around_seq cùng before_seq -> 400', r, 400, 'BAD_REQUEST', 'Chỉ dùng một trong before_seq / after_seq / around_seq');
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { around_seq: 0 });
  expectErrMsg('around_seq 0 -> 400', r, 400, 'BAD_REQUEST', 'around_seq phải lớn hơn 0');
  r = await call(B, 'GET', `/conversations/${gid}/messages`);
  check(r.ok && !hasKey(r.result, 'has_newer'), 'chế độ thường không có khoá has_newer', () => brief(r));

  // B3. thu hồi
  a = await sendText(A.ws, gid, `Tin sẽ thu hồi ${RUN}`);
  const m1 = (ctx.g3Recalled = a.data.message_id);
  r = await call(A, 'POST', `/conversations/${gid}/pins`, { message_id: m1 });
  expectOk('A ghim tin sắp thu hồi', r, (x) => hasPin(x, m1));
  r = await call(B, 'POST', `/messages/${m1}/recall`);
  expectErrMsg('B (phó nhóm) thu hồi tin của trưởng nhóm -> 403', r, 403, 'FORBIDDEN', 'Bạn không có quyền thu hồi tin này');
  r = await call(C, 'POST', `/messages/${m1}/recall`);
  expectErr('C (thành viên) thu hồi tin của người khác -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  if (outsider) {
    r = await call(outsider, 'POST', `/messages/${m1}/recall`);
    expectErrMsg('người ngoài nhóm thu hồi -> 404', r, 404, 'NOT_FOUND', 'Không tìm thấy tin nhắn');
  }
  if (sysMsg) {
    r = await call(A, 'POST', `/messages/${sysMsg.id}/recall`);
    expectErrMsg('thu hồi tin hệ thống -> 400', r, 400, 'BAD_REQUEST', 'Không thu hồi được tin hệ thống');
  }
  r = await call(A, 'POST', `/messages/${m1}/recall`);
  expectOk('A thu hồi tin của mình -> recalled true, content "", recalled_by A, không attachments / mentions / edited_at / reply_to', r,
    (x) => x.id === m1 && x.recalled === true && x.content === '' && x.recalled_by === A.id && !hasKey(x, 'attachments') &&
      !hasKey(x, 'mentions') && !hasKey(x, 'edited_at') && !hasKey(x, 'reply_to'));
  const upd = await waitPkt(C.ws, 'message.updated', (y) => y.action === 'recall' && y.message && y.message.id === m1);
  check(upd.type === 'message.updated' && upd.data.conversation_id === gid && upd.data.message.recalled === true && upd.data.message.content === '',
    'C nhận message.updated {action recall, recalled true, content ""}', () => pktDetail(upd));
  const pu = await waitPkt(B.ws, 'pins.updated', (y) => y.conversation_id === gid && Array.isArray(y.pins) && !y.pins.some((p) => p.message_id === m1));
  check(pu.type === 'pins.updated', 'B nhận pins.updated (tin bị thu hồi được bỏ ghim)', () => pktDetail(pu));
  r = await call(B, 'GET', `/conversations/${gid}/pins`);
  expectOk('GET pins -> không còn tin đã thu hồi', r, (x) => Array.isArray(x.pins) && !hasPin(x, m1));
  r = await call(A, 'POST', `/messages/${m1}/recall`);
  expectOk('thu hồi lần nữa -> trả lại tin đã thu hồi (idempotent)', r, (x) => x.recalled === true && x.content === '');
  for (const [what, u, method, path, body] of [
    ['sửa', A, 'PATCH', `/messages/${m1}`, { content: 'sửa tin đã thu hồi' }],
    ['thả cảm xúc', B, 'PUT', `/messages/${m1}/reaction`, { reaction: 'like' }],
    ['ghim', A, 'POST', `/conversations/${gid}/pins`, { message_id: m1 }],
    ['chuyển tiếp', A, 'POST', `/messages/${m1}/forward`, { targets: [{ conversation_id: ctx.direct, client_msg_id: uuid() }] }],
  ]) {
    r = await call(u, method, path, body);
    expectErr(`${what} tin đã thu hồi -> 410 MESSAGE_RECALLED`, r, 410, 'MESSAGE_RECALLED');
  }
  a = await sendReply(B.ws, gid, 'trả lời tin đã thu hồi', m1);
  expectWsErr('trả lời tin đã thu hồi -> error MESSAGE_RECALLED', a, 'MESSAGE_RECALLED');
  a = await sendText(C.ws, gid, `Tin của C ${RUN}`);
  const mC = a.data.message_id;
  r = await call(B, 'POST', `/messages/${mC}/recall`);
  expectOk('B (phó nhóm) thu hồi tin của thành viên C -> recalled_by B (kiểm duyệt)', r, (x) => x.recalled === true && x.recalled_by === B.id);
  r = await call(A, 'POST', `/messages/${m0}/recall`);
  expectOk('A thu hồi tin gốc đang được trả lời + có reaction', r, (x) => x.recalled === true && !hasKey(x, 'reactions'));
  r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { after_seq: seq0 - 1 });
  expectOk('lịch sử: tin gốc recalled (không reactions / mentions), reply_to của tin trả lời -> recalled true, content ""', r, (x) => {
    const o = findMsg(x, m0);
    const rr = findMsg(x, mR);
    return o && o.recalled === true && o.content === '' && !hasKey(o, 'reactions') && !hasKey(o, 'mentions') &&
      rr && rr.reply_to && rr.reply_to.recalled === true && rr.reply_to.content === '';
  });
  r = await call(B, 'GET', `/messages/${m0}/reactions`);
  expectOk('reaction của tin đã thu hồi bị xoá -> danh sách rỗng', r, (x) => Array.isArray(x.reactions) && x.reactions.length === 0);
  a = await sendText(A.ws, ctx.direct, `1-1 ${RUN}`);
  r = await call(B, 'POST', `/messages/${a.data.message_id}/recall`);
  expectErrMsg('chat 1-1: B thu hồi tin của A -> 403 "Bạn chỉ thu hồi được tin của mình"', r, 403, 'FORBIDDEN', 'Bạn chỉ thu hồi được tin của mình');

  // đồng bộ thay đổi (changes)
  r = await call(A, 'GET', `/conversations/${gid}/messages/changes`, undefined, { since: String(syncAt) });
  expectOk('changes since mốc trước khi sửa -> có các tin đã sửa / thu hồi, next_cursor null', r,
    (x) => [m0, m1, mC].every((id) => !!findMsg(x, id)) && findMsg(x, m1).recalled === true && x.next_cursor === null);
  r = await call(A, 'GET', `/conversations/${gid}/messages/changes`, undefined, { since: String(syncAt), limit: 1 });
  const ch1 = expectOk('changes limit 1 -> 1 tin + next_cursor', r, (x) => x.messages.length === 1 && typeof x.next_cursor === 'string');
  if (ch1 && ch1.next_cursor) {
    r = await call(A, 'GET', `/conversations/${gid}/messages/changes`, undefined, { cursor: ch1.next_cursor, limit: 200 });
    expectOk('changes theo next_cursor -> phần còn lại, không lặp tin trang trước', r,
      (x) => x.messages.length >= 2 && !findMsg(x, ch1.messages[0].id) && x.next_cursor === null);
  }
  r = await call(A, 'GET', `/conversations/${gid}/messages/changes`);
  expectErrMsg('changes thiếu since / cursor -> 400', r, 400, 'BAD_REQUEST', 'Thiếu since hoặc cursor');
  r = await call(A, 'GET', `/conversations/${gid}/messages/changes`, undefined, { cursor: 'hỏng' });
  expectErr('changes cursor sai dạng -> 400', r, 400, 'BAD_REQUEST');
  if (outsider) {
    r = await call(outsider, 'GET', `/conversations/${gid}/messages/changes`, undefined, { since: String(syncAt) });
    expectErr('người ngoài nhóm gọi changes -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
  }

  // B2. chuyển tiếp
  const t2 = `Tin chuyển tiếp ${RUN}`;
  a = await sendText(A.ws, gid, t2);
  const m2 = a.data.message_id;
  const tg = [{ conversation_id: ctx.direct, client_msg_id: uuid() }, { conversation_id: gid, client_msg_id: uuid() }];
  r = await call(A, 'POST', `/messages/${m2}/forward`, { targets: tg });
  const fw = expectOk('A chuyển tiếp tới chat 1-1 với B + chính nhóm -> results đúng thứ tự, ok, ack', r,
    (x) => x.results.length === 2 && x.results.every((it, i) => it.conversation_id === tg[i].conversation_id && it.ok === true &&
      it.ack && it.ack.duplicate === false && it.ack.client_msg_id === tg[i].client_msg_id && !hasKey(it, 'error')));
  mn = await waitPkt(B.ws, 'message.new', (y) => y.client_msg_id === tg[0].client_msg_id);
  check(mn.type === 'message.new' && mn.data.conversation_id === ctx.direct && mn.data.forwarded === true && mn.data.content === t2 &&
    !hasKey(mn.data, 'reply_to') && mn.data.sender_id === A.id, 'B nhận message.new trong chat 1-1: forwarded true, cùng nội dung', () => pktDetail(mn));
  r = await call(A, 'POST', `/messages/${m2}/forward`, { targets: tg });
  expectOk('gửi lại cùng client_msg_id -> ack duplicate, cùng message_id', r,
    (x) => fw && x.results.every((it, i) => it.ok && it.ack.duplicate === true && it.ack.message_id === fw.results[i].ack.message_id));
  for (const [why, targets, msg] of [
    ['targets rỗng', [], 'Chọn từ 1 đến 20 cuộc trò chuyện'],
    ['21 đích', Array.from({ length: 21 }, (_, i) => ({ conversation_id: i + 1, client_msg_id: uuid() })), 'Chọn từ 1 đến 20 cuộc trò chuyện'],
    ['trùng hội thoại', [{ conversation_id: gid, client_msg_id: uuid() }, { conversation_id: gid, client_msg_id: uuid() }], 'Mỗi cuộc trò chuyện chỉ chọn một lần'],
    ['client_msg_id không phải UUID', [{ conversation_id: gid, client_msg_id: 'abc' }], 'client_msg_id phải là UUID'],
  ]) {
    r = await call(A, 'POST', `/messages/${m2}/forward`, { targets });
    expectErrMsg(`chuyển tiếp ${why} -> 400 "${msg}"`, r, 400, 'BAD_REQUEST', msg);
  }
  if (ctx.g2) {
    const tg2 = [{ conversation_id: ctx.g2, client_msg_id: uuid() }, { conversation_id: ctx.direct, client_msg_id: uuid() }];
    r = await call(B, 'POST', `/messages/${m2}/forward`, { targets: tg2 });
    expectOk('B chuyển tiếp tới nhóm đã giải tán + chat 1-1 -> đích 1 lỗi GROUP_DISBANDED, đích 2 vẫn ok', r,
      (x) => x.results[0].ok === false && x.results[0].error.code === 'GROUP_DISBANDED' && !hasKey(x.results[0], 'ack') &&
        x.results[1].ok === true && !!x.results[1].ack);
  }
  if (sysMsg) {
    r = await call(A, 'POST', `/messages/${sysMsg.id}/forward`, { targets: [{ conversation_id: ctx.direct, client_msg_id: uuid() }] });
    expectErrMsg('chuyển tiếp tin hệ thống -> 400', r, 400, 'BAD_REQUEST', 'Không chuyển tiếp được tin hệ thống');
  }
  if (outsider) {
    r = await call(outsider, 'POST', `/messages/${m2}/forward`, { targets: [{ conversation_id: gid, client_msg_id: uuid() }] });
    expectErrMsg('người ngoài nhóm chuyển tiếp tin của nhóm -> 404', r, 404, 'NOT_FOUND', 'Không tìm thấy tin nhắn');
  }

  // chuyển tiếp ảnh: dùng lại tệp, người nhận đọc được
  r = await call(B, 'GET', '/media/config');
  if (!r.ok || !r.result || r.result.enabled !== true) {
    skip('21. chuyển tiếp ảnh', 'máy chủ chưa bật tệp');
    return;
  }
  const png = pngBytes(20, 12);
  const img = await uploadMedia(B, 'B: ảnh để chuyển tiếp', { type: 'image', mime: 'image/png', size: png.length, sha256: sha256buf(png) }, png);
  if (!img) return;
  a = await sendMedia(B.ws, ctx.direct, 'image', [img.id], { content: 'ảnh ' + RUN });
  check(a.type === 'ack', 'B gửi ảnh cho A trong chat 1-1', () => pktDetail(a));
  const cmF = uuid();
  r = await call(A, 'POST', `/messages/${a.data.message_id}/forward`, { targets: [{ conversation_id: gid, client_msg_id: cmF }] });
  expectOk('A (không phải người tải) chuyển tiếp ảnh sang nhóm -> ok, ack.attachments cùng media_id', r,
    (x) => x.results[0].ok && x.results[0].ack.attachments && x.results[0].ack.attachments[0].id === img.id);
  mn = await waitPkt(C.ws, 'message.new', (y) => y.client_msg_id === cmF);
  check(mn.type === 'message.new' && mn.data.msg_type === 'image' && mn.data.forwarded === true && mn.data.content === 'ảnh ' + RUN &&
    mn.data.attachments && mn.data.attachments[0].id === img.id, 'C nhận ảnh chuyển tiếp: msg_type image, forwarded, chú thích, cùng tệp', () => pktDetail(mn));
  r = await call(C, 'GET', `/media/${img.id}`);
  expectOk('C (chỉ ở nhóm nhận) đọc được tệp chuyển tiếp -> có url', r, (x) => x.media && x.media.id === img.id && !!x.media.url);
}

// 22. Tìm tin nhắn: không dấu, tiền tố, phân trang, phạm vi, nhảy tới tin.
async function s22() {
  const { A, B, C, F } = U;
  const gid = ctx.g3;
  if (!gid) throw new Error('chưa có nhóm từ mục 21');
  await ensureWs(A, 'A#gđ2');
  await ensureWs(B, 'B#gđ2');
  await ensureWs(C, 'C#gđ2');
  const tok = 'zq' + RUN;
  let a = await sendText(A.ws, gid, `Báo giá NGUYỄN văn ${tok}`);
  const s1 = a.data.message_id;
  a = await sendText(B.ws, gid, `báo giá đợt 2 ${tok}`);
  const s2 = a.data.message_id;
  a = await sendText(C.ws, gid, `chuyện khác ${tok}`);
  const s3 = a.data.message_id;
  a = await sendText(A.ws, ctx.direct, `hẹn gặp ${tok}`);
  const s4 = a.data.message_id;
  const ids = (x) => x.hits.map((h) => h.message_id);
  let r = await call(B, 'GET', '/search/messages', undefined, { q: `bao gia ${tok}` });
  expectOk('B tìm "bao gia <mã>" mọi hội thoại -> 2 tin khớp (không dấu), mới trước', r, (x) => js(ids(x)) === js([s2, s1]) && x.next_cursor === null);
  const hit = r.ok ? r.result.hits.find((h) => h.message_id === s1) : null;
  check(!!hit && hit.conversation_id === gid && hit.conversation_type === 'group' && hit.conversation_name === ctx.g3Name &&
    hit.sender_id === A.id && hit.sender_name === A.name && hit.msg_type === 'text' && hit.content === `Báo giá NGUYỄN văn ${tok}` &&
    Number.isInteger(hit.seq) && isIso(hit.created_at) && !hasKey(hit, 'attachments'),
  'SearchHit: conversation_id / type / name, message_id, seq, sender, msg_type, content đầy đủ, created_at', () => js(hit));
  r = await call(B, 'GET', '/search/messages', undefined, { q: `nguyen ${tok}` });
  expectOk('"nguyen" khớp "NGUYỄN" (không phân biệt dấu / hoa thường)', r, (x) => js(ids(x)) === js([s1]));
  r = await call(B, 'GET', '/search/messages', undefined, { q: `${tok} GIÁ`.normalize('NFD') });
  expectOk('từ khoá NFD, thứ tự tuỳ ý -> vẫn khớp 2 tin', r, (x) => js(ids(x)) === js([s2, s1]));
  r = await call(B, 'GET', '/search/messages', undefined, { q: `hen ${tok}` });
  expectOk('tìm cả chat 1-1: conversation_type direct, conversation_name = tên người kia', r,
    (x) => x.hits.length === 1 && x.hits[0].message_id === s4 && x.hits[0].conversation_type === 'direct' && x.hits[0].conversation_name === A.name);
  r = await call(B, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: tok, limit: 2 });
  const p1 = expectOk('tìm trong nhóm, limit 2 -> 2 tin mới nhất + next_cursor', r,
    (x) => js(ids(x)) === js([s3, s2]) && typeof x.next_cursor === 'string');
  if (p1 && p1.next_cursor) {
    r = await call(B, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: tok, limit: 2, cursor: p1.next_cursor });
    expectOk('trang 2 theo next_cursor -> tin còn lại, next_cursor null', r, (x) => js(ids(x)) === js([s1]) && x.next_cursor === null);
  }
  if (ctx.g3Recalled) {
    r = await call(B, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: `thu hoi ${RUN}` });
    expectOk('tin đã thu hồi không ra trong kết quả', r, (x) => !ids(x).includes(ctx.g3Recalled));
  }
  r = await call(B, 'GET', '/search/messages', undefined, { q: 'a' });
  expectErrMsg('q 1 ký tự -> 400 "Nhập ít nhất 2 ký tự để tìm"', r, 400, 'BAD_REQUEST', 'Nhập ít nhất 2 ký tự để tìm');
  r = await call(B, 'GET', '/search/messages', undefined, { q: 'x'.repeat(101) });
  expectErrMsg('q 101 ký tự -> 400 "Từ khoá tối đa 100 ký tự"', r, 400, 'BAD_REQUEST', 'Từ khoá tối đa 100 ký tự');
  r = await call(B, 'GET', '/search/messages', undefined, { q: tok, cursor: 'hỏng' });
  expectErr('cursor sai dạng -> 400', r, 400, 'BAD_REQUEST');
  if (F && F.access) {
    r = await call(F, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: tok });
    expectErr('người ngoài nhóm tìm trong nhóm -> 403 FORBIDDEN', r, 403, 'FORBIDDEN');
    r = await call(F, 'GET', '/search/messages', undefined, { q: tok });
    expectOk('người ngoài tìm mọi hội thoại -> không thấy tin của nhóm', r, (x) => Array.isArray(x.hits) && x.hits.length === 0);
  }
  if (hit) {
    r = await call(B, 'GET', `/conversations/${gid}/messages`, undefined, { around_seq: hit.seq, limit: 5 });
    expectOk('bấm kết quả -> around_seq = seq của kết quả trả đúng tin', r, (x) => !!findMsg(x, s1));
  }
}

// 23. Đa thiết bị: danh sách thiết bị, đăng nhập bằng QR, đăng xuất từ xa.
async function s23() {
  const { A, B } = U;
  await ensureWs(A, 'A#thiết bị');
  const UA = 'chat-e2e QR ' + RUN;
  const qrStart = (name, platform = 'web') => rest('POST', '/auth/qr/start',
    { body: { device: { platform, name } }, headers: { 'X-Forwarded-For': FAKE_IP, 'User-Agent': UA } });
  const qrPoll = (q, token) => rest('POST', '/auth/qr/poll', { body: { qr_id: q.qr_id, poll_token: token || q.poll_token } });
  const QR_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
  const POLL_GAP = 1100; // poll tối đa 3 lần / 3 giây / qr_id

  let r = await call(A, 'GET', '/devices');
  expectOk('A: GET /devices -> thiết bị hiện tại đứng đầu (current, online, login_method otp, user_agent, last_ip, push, created_at)', r,
    (x) => x.devices.length >= 1 && x.devices[0].id === A.deviceId && x.devices[0].current === true && x.devices[0].online === true &&
      x.devices[0].login_method === 'otp' && x.devices[0].platform === 'web' && typeof x.devices[0].user_agent === 'string' &&
      typeof x.devices[0].last_ip === 'string' && typeof x.devices[0].push === 'boolean' && isIso(x.devices[0].created_at) &&
      x.devices.filter((d) => d.current).length === 1);
  r = await call(A, 'DELETE', `/devices/${A.deviceId}`);
  expectErrMsg('đăng xuất từ xa chính thiết bị hiện tại -> 400', r, 400, 'BAD_REQUEST', 'Dùng Đăng xuất để thoát thiết bị này');
  r = await call(A, 'DELETE', `/devices/${NO_ID}`);
  expectErrMsg('thiết bị không có -> 404 "Không tìm thấy thiết bị"', r, 404, 'NOT_FOUND', 'Không tìm thấy thiết bị');
  r = await call(B, 'DELETE', `/devices/${A.deviceId}`);
  expectErrMsg('B đăng xuất thiết bị của A -> 404 (không lộ)', r, 404, 'NOT_FOUND', 'Không tìm thấy thiết bị');

  // QR: bắt đầu + poll
  r = await qrStart('chat-e2e QR 1');
  const q1 = expectOk('qr/start -> qr_id, code 10 ký tự Crockford base32, poll_token, expires_in 120, poll_interval 2', r,
    (x) => Number.isInteger(x.qr_id) && QR_RE.test(x.code) && typeof x.poll_token === 'string' && x.poll_token.length >= 32 &&
      x.expires_in === 120 && x.poll_interval === 2);
  if (!q1 || !q1.code) throw new Error('không bắt đầu được phiên QR');
  r = await qrStart('máy lạ', 'tv');
  expectErr('qr/start platform lạ -> 400', r, 400, 'BAD_REQUEST');
  r = await qrPoll(q1);
  expectOk('poll lần đầu -> pending, expires_in, chưa có auth', r, (x) => x.status === 'pending' && x.expires_in > 0 && x.expires_in <= 120 && !hasKey(x, 'auth'));
  r = await qrPoll(q1, 'sai-' + q1.poll_token);
  expectErr('poll_token sai -> 404 QR_INVALID', r, 404, 'QR_INVALID');
  r = await rest('POST', '/auth/qr/poll', { body: {} });
  expectErr('poll thiếu qr_id / poll_token -> 400', r, 400, 'BAD_REQUEST');

  // quét (máy đã đăng nhập)
  r = await rest('POST', '/auth/qr/scan', { body: { code: q1.code } });
  expectErr('qr/scan không có token chat -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');
  r = await call(A, 'POST', '/auth/qr/scan', { code: 'abc' });
  expectErr('mã sai dạng -> 404 QR_INVALID', r, 404, 'QR_INVALID');
  const typed = (q1.code.slice(0, 5) + '-' + q1.code.slice(5)).toLowerCase();
  r = await call(A, 'POST', '/auth/qr/scan', { code: ' ' + typed + ' ' });
  expectOk('A quét mã gõ tay (chữ thường, gạch nối) -> QRSession {scanned, platform, device_name, user_agent, request_ip, thời điểm}', r,
    (x) => x.qr_id === q1.qr_id && x.status === 'scanned' && x.platform === 'web' && x.device_name === 'chat-e2e QR 1' &&
      x.user_agent === UA && x.request_ip === FAKE_IP && isIso(x.created_at) && isIso(x.expires_at) && x.expires_in > 0);
  r = await call(A, 'POST', '/auth/qr/scan', { code: `http://localhost/chat/qr#${q1.code}` });
  expectOk('A quét lại bằng cả URL -> idempotent', r, (x) => x.qr_id === q1.qr_id && x.status === 'scanned');
  r = await call(B, 'POST', '/auth/qr/scan', { code: q1.code });
  expectErr('B quét mã A đã quét -> 409 QR_USED', r, 409, 'QR_USED');
  r = await call(B, 'POST', '/auth/qr/approve', { code: q1.code });
  expectErr('B duyệt phiên A đã quét -> 409 QR_USED', r, 409, 'QR_USED');
  await sleep(POLL_GAP);
  r = await qrPoll(q1);
  expectOk('poll sau khi quét -> scanned, KHÔNG lộ tên người quét (approver chỉ khi approved)', r,
    (x) => x.status === 'scanned' && !hasKey(x, 'approver') && !hasKey(x, 'auth'));
  r = await call(A, 'POST', '/auth/qr/approve', { code: q1.code });
  expectOk('A xác nhận -> {status approved}', r, (x) => x.status === 'approved');
  r = await call(A, 'POST', '/auth/qr/approve', { code: q1.code });
  expectOk('xác nhận lại -> approved (idempotent)', r, (x) => x.status === 'approved');
  r = await call(A, 'POST', '/auth/qr/reject', { code: q1.code });
  expectErr('từ chối sau khi đã duyệt -> 409 QR_USED', r, 409, 'QR_USED');
  await sleep(POLL_GAP);
  r = await qrPoll(q1);
  const got = expectOk('poll sau khi duyệt -> approved + auth (cặp token, device_id mới, user A, không is_new)', r,
    (x) => x.status === 'approved' && x.approver && x.approver.display_name === A.name && x.auth && typeof x.auth.access_token === 'string' && typeof x.auth.refresh_token === 'string' &&
      x.auth.expires_in === 900 && x.auth.user && x.auth.user.id === A.id && Number.isInteger(x.auth.device_id) &&
      x.auth.device_id !== A.deviceId && !hasKey(x.auth, 'is_new'));
  if (!got || !got.auth) throw new Error('không nhận được phiên qua QR');
  const N = { label: 'A-QR', id: A.id, name: A.name, access: got.auth.access_token, refresh: got.auth.refresh_token, deviceId: got.auth.device_id };
  let du = await waitPkt(A.ws, 'devices.updated', (y) => y.reason === 'login' && y.device_id === N.deviceId);
  check(du.type === 'devices.updated', 'thiết bị cũ của A nhận devices.updated {reason login, device_id mới}', () => pktDetail(du));
  await sleep(POLL_GAP);
  r = await qrPoll(q1);
  expectOk('poll lần nữa -> consumed, không trao token lần hai', r, (x) => x.status === 'consumed' && !hasKey(x, 'auth'));
  r = await call(A, 'POST', '/auth/qr/scan', { code: q1.code });
  expectErr('quét lại mã đã dùng -> 409 QR_USED', r, 409, 'QR_USED');
  r = await call(N, 'GET', '/devices');
  expectOk('máy mới: GET /devices -> thiết bị của nó đứng đầu, login_method qr, tên / nền tảng / user_agent của phiên QR', r,
    (x) => x.devices[0].id === N.deviceId && x.devices[0].current === true && x.devices[0].login_method === 'qr' &&
      x.devices[0].name === 'chat-e2e QR 1' && x.devices[0].platform === 'web' && x.devices[0].user_agent === UA);
  N.ws = await openWs('A#QR', N);
  r = await call(A, 'GET', '/devices');
  expectOk('A: danh sách có máy QR (online true, current false)', r,
    (x) => x.devices[0].id === A.deviceId && x.devices.some((d) => d.id === N.deviceId && d.online === true && d.current === false && d.login_method === 'qr'));

  // từ chối
  r = await qrStart('chat-e2e QR 2');
  const q2 = expectOk('phiên QR thứ hai', r, (x) => QR_RE.test(x.code));
  if (q2) {
    r = await call(A, 'POST', '/auth/qr/approve', { code: q2.code });
    expectErrMsg('duyệt khi chưa quét -> 400 "Hãy quét mã trước"', r, 400, 'BAD_REQUEST', 'Hãy quét mã trước');
    r = await call(A, 'POST', '/auth/qr/scan', { code: q2.code });
    expectOk('A quét phiên 2', r, (x) => x.status === 'scanned');
    r = await call(A, 'POST', '/auth/qr/reject', { code: q2.code });
    expectOk('A từ chối -> {status rejected}', r, (x) => x.status === 'rejected');
    r = await call(A, 'POST', '/auth/qr/reject', { code: q2.code });
    expectOk('từ chối lại -> rejected (idempotent)', r, (x) => x.status === 'rejected');
    r = await call(A, 'POST', '/auth/qr/approve', { code: q2.code });
    expectErr('duyệt sau khi đã từ chối -> 409 QR_USED', r, 409, 'QR_USED');
    r = await qrPoll(q2);
    expectOk('máy chờ poll -> rejected, không có auth', r, (x) => x.status === 'rejected' && !hasKey(x, 'auth'));
  }

  // đăng xuất từ xa một thiết bị
  r = await call(A, 'DELETE', `/devices/${N.deviceId}`);
  expectOk('A đăng xuất từ xa máy QR -> {}', r);
  const fl = await waitPkt(N.ws, 'force_logout');
  check(fl.type === 'force_logout', 'máy QR nhận force_logout', () => pktDetail(fl));
  const cl = await settle(N.ws.waitClose());
  check(cl.ok && cl.value.code === 4403, 'máy QR bị đóng kết nối mã 4403', () => (cl.ok ? js(cl.value) : cl.error.message));
  du = await waitPkt(A.ws, 'devices.updated', (y) => y.reason === 'revoked' && y.device_id === N.deviceId);
  check(du.type === 'devices.updated', 'A nhận devices.updated {reason revoked, device_id}', () => pktDetail(du));
  r = await call(N, 'GET', '/me');
  expectErr('access token của máy bị đăng xuất -> 401 CHAT_NOAUTH ngay', r, 401, 'CHAT_NOAUTH');
  r = await rest('POST', '/auth/refresh', { body: { refresh_token: N.refresh } });
  expectErr('refresh của máy bị đăng xuất -> 401 REFRESH_INVALID', r, 401, 'REFRESH_INVALID');
  r = await call(A, 'GET', '/devices');
  expectOk('A: danh sách không còn máy QR', r, (x) => !x.devices.some((d) => d.id === N.deviceId));

  // đăng xuất mọi thiết bị khác
  r = await qrStart('chat-e2e QR 3', 'desktop');
  const q3 = expectOk('phiên QR thứ ba (desktop)', r, (x) => QR_RE.test(x.code));
  let N2 = null;
  if (q3) {
    r = await call(A, 'POST', '/auth/qr/scan', { code: q3.code });
    expectOk('A quét phiên 3', r, (x) => x.status === 'scanned' && x.platform === 'desktop');
    r = await call(A, 'POST', '/auth/qr/approve', { code: q3.code });
    expectOk('A duyệt phiên 3', r, (x) => x.status === 'approved');
    r = await qrPoll(q3);
    const g3 = expectOk('máy 3 nhận token', r, (x) => x.status === 'approved' && x.auth && Number.isInteger(x.auth.device_id));
    if (g3 && g3.auth) N2 = { label: 'A-QR3', id: A.id, access: g3.auth.access_token, deviceId: g3.auth.device_id };
  }
  r = await call(A, 'POST', '/devices/logout-others');
  expectOk('A: POST /devices/logout-others -> {revoked >= 1}', r, (x) => Number.isInteger(x.revoked) && x.revoked >= (N2 ? 1 : 0));
  if (N2) {
    r = await call(N2, 'GET', '/me');
    expectErr('máy 3 sau logout-others -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');
  }
  r = await call(A, 'GET', '/devices');
  expectOk('A: chỉ còn thiết bị hiện tại', r, (x) => x.devices.length === 1 && x.devices[0].id === A.deviceId && x.devices[0].current === true);
  r = await call(A, 'GET', '/me');
  expectOk('thiết bị hiện tại vẫn đăng nhập', r, (x) => x.id === A.id);
}

// ───────────── 24-27. Giai đoạn 2: phần bổ sung ─────────────

// IP giả riêng cho từng việc (khác FAKE_IP): OTP đăng nhập lại (không tốn hạn mức 20 OTP / giờ của FAKE_IP), phiên QR,
// kiểm giới hạn 20 phiên QR / 10 phút / IP.
const usedIps = new Set([FAKE_IP]);
function newIp() {
  let ip;
  do ip = `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${1 + crypto.randomInt(254)}`; while (usedIps.has(ip));
  usedIps.add(ip);
  return ip;
}
const OTP_IP = newIp();
const QR_IP = newIp();
const QR_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const qrStartAt = (ip, name, platform = 'web', ua = 'chat-e2e QR+ ' + RUN) => rest('POST', '/auth/qr/start',
  { body: { device: { platform, name } }, headers: { 'X-Forwarded-For': ip, 'User-Agent': ua } });
const qrPollOf = (q, token) => rest('POST', '/auth/qr/poll', { body: { qr_id: q.qr_id, poll_token: token || q.poll_token } });
const hitIds = (x) => (x && Array.isArray(x.hits) ? x.hits.map((h) => h.message_id) : []);
const runes = (s) => [...String(s)];

// otpLogin: đăng nhập lại tài khoản đã có bằng OTP (thiết bị mới) từ IP / User-Agent cho trước -> {access, refresh, deviceId} | null.
async function otpLogin(u, label, o) {
  const wait = (u.otpAt || 0) + 61000 - Date.now();
  if (wait > 0) await sleep(wait);
  const r1 = await retryEarly(`${label}: xin mã`, () => rest('POST', '/auth/otp/request', { body: { phone: u.local }, headers: { 'X-Forwarded-For': o.ip } }),
    (x) => {
      const m = x.status === 429 && x.code === 'OTP_RATE_LIMIT' && /đợi (\d+) giây/.exec(String(x.error || ''));
      return m ? Number(m[1]) * 1000 + 300 : 0;
    });
  const x1 = expectOk(`${label}: otp/request -> dev_code`, r1, (y) => y.phone === u.e164 && /^\d{6}$/.test(String(y.dev_code)));
  if (!x1 || !x1.dev_code) return null;
  u.otpAt = Date.now();
  const r2 = await rest('POST', '/auth/otp/verify', {
    body: { phone: u.e164, otp: String(x1.dev_code), device: { platform: o.platform || 'web', name: o.name } },
    headers: { 'X-Forwarded-For': o.ip, 'User-Agent': o.ua },
  });
  const x2 = expectOk(`${label}: otp/verify -> cùng tài khoản, is_new false, thiết bị mới`, r2,
    (y) => y.is_new === false && y.user && y.user.id === u.id && Number.isInteger(y.device_id) && typeof y.refresh_token === 'string');
  if (!x2 || !x2.access_token) return null;
  return { access: x2.access_token, refresh: x2.refresh_token, deviceId: x2.device_id };
}

// qrExpirySetup (mục 24, khi không SKIP_SLOW): tạo sớm 3 phiên QR để mục 27 kiểm hết hạn mà không phải chờ trọn 120 giây:
// pend (chưa quét), scan (B đã quét), appr (B đã duyệt, máy mới chưa poll).
async function qrExpirySetup() {
  const { B } = U;
  const mk = async (name) => expectOk(`[chậm] tạo phiên QR "${name}" (mục 27 kiểm hết hạn)`, await qrStartAt(QR_IP, name),
    (x) => QR_CODE_RE.test(x.code) && x.expires_in === 120);
  const pend = await mk('chat-e2e QR hết hạn 1');
  const scan = await mk('chat-e2e QR hết hạn 2');
  const appr = await mk('chat-e2e QR hết hạn 3');
  if (scan) expectOk('[chậm] B quét phiên "hết hạn 2"', await call(B, 'POST', '/auth/qr/scan', { code: scan.code }), (x) => x.status === 'scanned');
  if (appr) {
    expectOk('[chậm] B quét phiên "hết hạn 3"', await call(B, 'POST', '/auth/qr/scan', { code: appr.code }), (x) => x.status === 'scanned');
    expectOk('[chậm] B duyệt phiên "hết hạn 3" (máy mới không poll)', await call(B, 'POST', '/auth/qr/approve', { code: appr.code }),
      (x) => x.status === 'approved');
  }
  ctx.qrExp = { pend, scan, appr };
}

// 24. Quyền theo vai trò / cài đặt / chặn / rời nhóm / giải tán, trích dẫn tệp, danh sách hội thoại, tìm tên tệp.
async function s24() {
  const { A, B, C, D } = U;
  if (!SKIP_SLOW) await qrExpirySetup();
  await ensureWs(A, 'A#gđ2');
  await ensureWs(B, 'B#gđ2');
  await ensureWs(C, 'C#gđ2');

  // D đã đăng xuất ở mục 14: đăng nhập lại bằng OTP (thiết bị mới ghi User-Agent, IP, login_method otp)
  const UA_D = 'chat-e2e D UA ' + RUN;
  const dn = await otpLogin(D, 'D đăng nhập lại', { ip: OTP_IP, ua: UA_D, name: 'chat-e2e D máy 2', platform: 'desktop' });
  if (!dn) throw new Error('D không đăng nhập lại được');
  Object.assign(D, dn);
  let r = await call(D, 'GET', '/devices');
  expectOk('D: thiết bị OTP mới -> đầu danh sách, current, login_method otp, user_agent = header User-Agent, last_ip = IP request', r,
    (x) => x.devices[0].id === D.deviceId && x.devices[0].current === true && x.devices[0].login_method === 'otp' &&
      x.devices[0].user_agent === UA_D && x.devices[0].last_ip === OTP_IP && x.devices[0].platform === 'desktop' &&
      x.devices[0].name === 'chat-e2e D máy 2');
  const ip2 = newIp();
  r = await rest('POST', '/auth/refresh', { body: { refresh_token: D.refresh }, headers: { 'X-Forwarded-For': ip2 } });
  const rf = expectOk('D refresh từ IP khác -> cặp token mới, cùng device_id', r, (x) => x.device_id === D.deviceId);
  if (rf && rf.access_token) Object.assign(D, { access: rf.access_token, refresh: rf.refresh_token });
  r = await call(D, 'GET', '/devices');
  expectOk('refresh ghi last_ip = IP mới', r, (x) => x.devices[0].id === D.deviceId && x.devices[0].last_ip === ip2);
  D.ws = await openWs('D#gđ2', D);

  const gName = 'Nhóm kiểm duyệt ' + RUN;
  r = await call(A, 'POST', '/conversations', { type: 'group', name: gName, member_ids: [B.id, C.id, D.id] });
  const g = expectOk('A tạo nhóm kiểm duyệt với B, C, D', r, (x) => x.type === 'group' && x.member_count === 4);
  if (!g || !g.id) throw new Error('không tạo được nhóm kiểm duyệt');
  const gid = (ctx.g4 = g.id);
  for (const u of [B, D]) {
    r = await call(A, 'PATCH', `/conversations/${gid}/members/${u.id}`, { role: 'admin' });
    expectOk(`A đặt ${u.label} làm phó nhóm`, r, (x) => member(x, u.id).role === 'admin');
  }
  const tokD = 'kd' + RUN;
  const tokC = 'kc' + RUN;
  const tokI = 'ki' + RUN;
  const tokF = 'kf' + RUN;

  // kiểm duyệt: phó nhóm không thu hồi tin của phó nhóm khác; trưởng nhóm thu hồi được
  let a = await sendText(B.ws, gid, `Tin của phó nhóm B ${RUN}`);
  const mB = a.data.message_id;
  const { c: c0 } = await convOf(C, gid);
  r = await call(D, 'POST', `/messages/${mB}/recall`);
  expectErrMsg('D (phó nhóm) thu hồi tin của phó nhóm B -> 403', r, 403, 'FORBIDDEN', 'Bạn không có quyền thu hồi tin này');
  r = await call(A, 'POST', `/messages/${mB}/recall`);
  expectOk('A (trưởng nhóm) thu hồi tin của phó nhóm B -> recalled_by A, sender_id vẫn B', r,
    (x) => x.recalled === true && x.recalled_by === A.id && x.sender_id === B.id && x.content === '');
  let p = await waitPkt(B.ws, 'message.updated', (y) => y.action === 'recall' && y.message && y.message.id === mB);
  check(p.type === 'message.updated' && p.data.message.recalled_by === A.id, 'B (người gửi) nhận message.updated recall, recalled_by A', () => pktDetail(p));
  await expectConv('C: last_message = tin vừa thu hồi {recalled true, recalled_by A, content ""}, không attachments / edited_at; ' +
    'unread và last_seq không đổi', C, gid, (c) => c.last_message && c.last_message.id === mB && c.last_message.recalled === true &&
    c.last_message.recalled_by === A.id && c.last_message.content === '' && !hasKey(c.last_message, 'attachments') &&
    !hasKey(c.last_message, 'edited_at') && !!c0 && c.unread === c0.unread && c.last_seq === c0.last_seq);

  // phó nhóm thu hồi tin của người đã rời nhóm; người đã rời không thao tác được nữa
  a = await sendText(D.ws, gid, `Tin D sẽ bị thu hồi ${RUN}`);
  const mD1 = a.data.message_id;
  a = await sendText(D.ws, gid, `Tin D còn lại ${tokD}`);
  const mD2 = a.data.message_id;
  r = await call(D, 'PUT', `/messages/${mD2}/reaction`, { reaction: 'wow' });
  expectOk('D thả wow cho tin của mình', r, (x) => x.mine === 'wow');
  r = await call(C, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: tokD });
  expectOk('C tìm tin của D trước khi D rời', r, (x) => js(hitIds(x)) === js([mD2]));
  r = await call(D, 'DELETE', `/conversations/${gid}/members/${D.id}`);
  expectOk('D rời nhóm', r);
  r = await call(B, 'POST', `/messages/${mD1}/recall`);
  expectOk('B (phó nhóm) thu hồi tin của D (đã rời nhóm) -> ok, recalled_by B', r, (x) => x.recalled === true && x.recalled_by === B.id);
  const LEFT = 'Bạn không còn trong cuộc trò chuyện này';
  for (const [what, method, path, body, query] of [
    ['sửa tin của mình', 'PATCH', `/messages/${mD2}`, { content: 'sửa sau khi rời' }],
    ['thu hồi tin của mình', 'POST', `/messages/${mD2}/recall`],
    ['thả cảm xúc', 'PUT', `/messages/${mD2}/reaction`, { reaction: 'like' }],
    ['bỏ cảm xúc', 'DELETE', `/messages/${mD2}/reaction`],
    ['xem reaction', 'GET', `/messages/${mD2}/reactions`],
    ['chuyển tiếp', 'POST', `/messages/${mD2}/forward`, { targets: [{ conversation_id: gid, client_msg_id: uuid() }] }],
    ['changes', 'GET', `/conversations/${gid}/messages/changes`, undefined, { since: String(Date.now() - 60000) }],
    ['tìm trong nhóm', 'GET', `/conversations/${gid}/messages/search`, undefined, { q: tokD }],
    ['nhảy tới tin', 'GET', `/conversations/${gid}/messages`, undefined, { around_seq: 1 }],
  ]) {
    r = await call(D, method, path, body, query);
    expectErrMsg(`D (đã rời nhóm) ${what} -> 403 "${LEFT}"`, r, 403, 'FORBIDDEN', LEFT);
  }
  r = await call(D, 'GET', '/search/messages', undefined, { q: tokD });
  expectOk('D (đã rời) tìm mọi hội thoại -> không thấy tin cũ của nhóm, kể cả tin của chính mình', r, (x) => !hitIds(x).includes(mD2));
  r = await call(C, 'GET', '/search/messages', undefined, { q: tokD });
  expectOk('C (còn trong nhóm) vẫn tìm thấy tin của D', r, (x) => hitIds(x).includes(mD2));
  ctx.g4LeftMsg = mD2;

  // admins_only_send: member không sửa / trả lời được, vẫn thả cảm xúc + thu hồi tin của mình; chuyển tiếp lỗi ở đích đó
  a = await sendText(C.ws, gid, `Tin của C ${tokC}`);
  const mC = a.data.message_id;
  a = await sendText(B.ws, gid, `Tin B sẽ sửa ${RUN}`);
  const mB2 = a.data.message_id;
  const seqB2 = a.data.seq;
  r = await call(C, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: tokC });
  expectOk('trước khi thu hồi: tìm thấy tin của C', r, (x) => js(hitIds(x)) === js([mC]));
  r = await call(A, 'PATCH', `/conversations/${gid}/settings`, { admins_only_send: true });
  expectOk('A bật admins_only_send', r, (x) => x.settings.admins_only_send === true);
  const ONLY = 'Chỉ trưởng / phó nhóm được gửi tin trong nhóm này';
  r = await call(C, 'PATCH', `/messages/${mC}`, { content: 'C sửa khi chỉ trưởng / phó nhóm được gửi' });
  expectErrMsg('C (member) sửa tin của mình khi admins_only_send -> 403 như gửi tin', r, 403, 'FORBIDDEN', ONLY);
  a = await sendReply(C.ws, gid, 'C trả lời khi admins_only_send', mB2);
  expectWsErrMsg('C (member) trả lời khi admins_only_send -> error FORBIDDEN', a, 'FORBIDDEN', ONLY);
  r = await call(C, 'PUT', `/messages/${mB2}/reaction`, { reaction: 'haha' });
  expectOk('C (member) vẫn thả cảm xúc được khi admins_only_send', r, (x) => x.mine === 'haha' && x.counts.haha === 1 && x.total === 1);
  const tB2 = `B sửa khi chỉ trưởng / phó nhóm được gửi ${RUN}`;
  r = await call(B, 'PATCH', `/messages/${mB2}`, { content: tB2 });
  expectOk('B (phó nhóm) sửa khi admins_only_send -> ok, kết quả giữ reactions', r,
    (x) => x.content === tB2 && isIso(x.edited_at) && x.reactions && x.reactions.counts.haha === 1 && x.reactions.mine === null);
  if (ctx.g3) {
    a = await sendText(C.ws, ctx.g3, `Tin C ở nhóm 3 ${RUN}`);
    const tg = [{ conversation_id: gid, client_msg_id: uuid() }, { conversation_id: ctx.g3, client_msg_id: uuid() }];
    r = await call(C, 'POST', `/messages/${a.data.message_id}/forward`, { targets: tg });
    expectOk('C (member) chuyển tiếp tới nhóm admins_only_send + nhóm 3 -> đích 1 FORBIDDEN (câu như gửi tin), đích 2 ok', r,
      (x) => x.results[0].ok === false && x.results[0].error.code === 'FORBIDDEN' && x.results[0].error.message === ONLY &&
        x.results[1].ok === true && x.results[1].ack.client_msg_id === tg[1].client_msg_id);
  }
  r = await call(C, 'POST', `/messages/${mC}/recall`);
  expectOk('C (member) thu hồi tin của mình khi admins_only_send -> ok', r, (x) => x.recalled === true && x.recalled_by === C.id);
  r = await call(C, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: tokC });
  expectOk('sau khi thu hồi: tin không còn trong kết quả tìm', r, (x) => Array.isArray(x.hits) && x.hits.length === 0);
  r = await call(A, 'PATCH', `/conversations/${gid}/settings`, { admins_only_send: false });
  expectOk('A tắt admins_only_send', r, (x) => x.settings.admins_only_send === false);

  // sửa: lỗi + kiểm lại mentions
  const long = `Đoạn dài ${RUN} ` + 'ạ'.repeat(300);
  a = await sendText(A.ws, gid, long);
  const mL = a.data.message_id;
  a = await sendReply(B.ws, gid, 'trả lời tin dài', mL);
  check(a.type === 'ack' && a.data.reply_to && runes(a.data.reply_to.content).length === 200 &&
    a.data.reply_to.content === runes(long).slice(0, 200).join(''), 'trích dẫn tin dài -> content cắt còn 200 ký tự', () => pktDetail(a));
  r = await call(A, 'PATCH', `/messages/${mL}`, { content: 'x'.repeat(4001) });
  expectErrMsg('sửa thành 4001 ký tự -> 400', r, 400, 'BAD_REQUEST', 'Tin nhắn tối đa 4000 ký tự');
  a = await sendText(C.ws, gid, `C sẽ sửa ${RUN}`);
  const mC2 = a.data.message_id;
  const tAll = `@Tất cả ${RUN}`;
  r = await call(C, 'PATCH', `/messages/${mC2}`, { content: tAll, mentions: [mentionOf(tAll, '@Tất cả', 0)] });
  expectErrMsg('C (member) sửa thêm @Tất cả -> 403', r, 403, 'FORBIDDEN', 'Chỉ trưởng / phó nhóm được nhắc cả nhóm');
  const tBad = `@${B.name} hi`;
  r = await call(C, 'PATCH', `/messages/${mC2}`, { content: tBad, mentions: [{ user_id: B.id, offset: 1, length: 3 }] });
  expectErr('sửa với mentions sai offset -> 400', r, 400, 'BAD_REQUEST');
  a = await sendText(A.ws, ctx.direct, `1-1 sẽ sửa ${RUN}`);
  const tDir = `@${B.name} 1-1`;
  r = await call(A, 'PATCH', `/messages/${a.data.message_id}`, { content: tDir, mentions: [mentionOf(tDir, '@' + B.name, B.id)] });
  expectErrMsg('sửa tin chat 1-1 thêm nhắc tên -> 400', r, 400, 'BAD_REQUEST', 'Chỉ nhắc tên được trong nhóm');
  const tD = `@${D.name} @${C.name} ${RUN}`;
  r = await call(B, 'PATCH', `/messages/${mB2}`, { content: tD, mentions: [mentionOf(tD, '@' + D.name, D.id), mentionOf(tD, '@' + C.name, C.id)] });
  expectOk('B sửa nhắc D (đã rời) + C -> chỉ giữ nhắc C', r,
    (x) => x.content === tD && sameMentions(x.mentions, [mentionOf(tD, '@' + C.name, C.id)]));
  // C đã gửi tin sau tin được sửa (gửi = đã đọc tới đó) nên unread_mention false; chỉ kiểm last_mention_seq
  await expectConv('C được nhắc qua sửa -> last_mention_seq = seq tin được sửa', C, gid, (c) => c.last_mention_seq === seqB2);
  const tNo = `bỏ nhắc ${RUN}`;
  r = await call(B, 'PATCH', `/messages/${mB2}`, { content: tNo, mentions: [] });
  expectOk('B sửa bỏ nhắc -> không còn mentions', r, (x) => x.content === tNo && !hasKey(x, 'mentions'));
  await expectConv('bỏ nhắc -> last_mention_seq của C không hạ', C, gid, (c) => c.last_mention_seq === seqB2);

  // sửa tin đang ghim -> pins.updated nội dung mới
  r = await call(A, 'POST', `/conversations/${gid}/pins`, { message_id: mB2 });
  expectOk('A ghim tin của B', r, (x) => hasPin(x, mB2));
  const tP = `Tin ghim đã sửa ${RUN}`;
  r = await call(B, 'PATCH', `/messages/${mB2}`, { content: tP });
  expectOk('B sửa tin đang ghim', r, (x) => x.content === tP);
  p = await waitPkt(C.ws, 'pins.updated', (y) => y.conversation_id === gid && y.pins.some((q) => q.message_id === mB2 && q.content === tP));
  check(p.type === 'pins.updated', 'C nhận pins.updated với nội dung mới của tin ghim', () => pktDetail(p));
  r = await call(C, 'GET', `/conversations/${gid}/pins`);
  expectOk('GET pins -> nội dung mới', r, (x) => x.pins.some((q) => q.message_id === mB2 && q.content === tP));

  // sửa tin cuối -> last_message có nội dung mới + edited_at
  a = await sendText(A.ws, gid, `Tin cuối ${RUN}`);
  const mLast = a.data.message_id;
  const tLast = `Tin cuối đã sửa ${RUN}`;
  r = await call(A, 'PATCH', `/messages/${mLast}`, { content: tLast });
  expectOk('A sửa tin cuối', r, (x) => x.content === tLast);
  await expectConv('C: last_message = tin vừa sửa (nội dung mới, edited_at), không reactions / reply_to', C, gid,
    (c) => c.last_message.id === mLast && c.last_message.content === tLast && isIso(c.last_message.edited_at) &&
      !hasKey(c.last_message, 'reactions') && !hasKey(c.last_message, 'reply_to') && !hasKey(c.last_message, 'recalled'));

  // tệp: sửa ảnh, trích dẫn ảnh / tệp, tin ảnh trả lời tin khác, tìm theo tên tệp / chú thích, thu hồi ảnh -> mất quyền đọc tệp
  r = await call(A, 'GET', '/media/config');
  if (!r.ok || !r.result || r.result.enabled !== true) {
    skip('24. tệp', 'máy chủ chưa bật tệp');
  } else {
    const png = pngBytes(23, 9);
    const img = await uploadMedia(A, 'A: ảnh nhóm kiểm duyệt', { type: 'image', mime: 'image/png', size: png.length, sha256: sha256buf(png) }, png);
    if (img) {
      a = await sendMedia(A.ws, gid, 'image', [img.id], { content: 'chú thích ' + tokI });
      const mImg = a.data.message_id;
      r = await call(A, 'PATCH', `/messages/${mImg}`, { content: 'sửa chú thích' });
      expectErrMsg('sửa tin ảnh -> 400 "Chỉ sửa được tin nhắn văn bản"', r, 400, 'BAD_REQUEST', 'Chỉ sửa được tin nhắn văn bản');
      a = await sendReply(B.ws, gid, 'trả lời ảnh', mImg);
      check(a.type === 'ack' && a.data.reply_to && a.data.reply_to.msg_type === 'image' && a.data.reply_to.content === 'chú thích ' + tokI &&
        !hasKey(a.data.reply_to, 'file_name'), 'trích dẫn ảnh -> msg_type image, content = chú thích, không file_name', () => pktDetail(a));
      r = await call(C, 'GET', '/search/messages', undefined, { q: 'chu thich ' + tokI });
      expectOk('tìm theo chú thích ảnh (không dấu) -> có tin ảnh, msg_type image, không attachments', r,
        (x) => x.hits.length === 1 && x.hits[0].message_id === mImg && x.hits[0].msg_type === 'image' && !hasKey(x.hits[0], 'attachments'));
      r = await call(C, 'GET', `/media/${img.id}`);
      expectOk('C đọc được ảnh trước khi thu hồi', r, (x) => x.media && x.media.id === img.id);
      r = await call(A, 'POST', `/messages/${mImg}/recall`);
      expectOk('A thu hồi tin ảnh -> không attachments, content ""', r, (x) => x.recalled === true && !hasKey(x, 'attachments') && x.content === '');
      r = await call(C, 'GET', `/media/${img.id}`);
      expectErr('C không còn đọc được tệp của tin đã thu hồi -> 404 MEDIA_NOT_FOUND', r, 404, 'MEDIA_NOT_FOUND');
      r = await call(C, 'GET', '/search/messages', undefined, { q: 'chu thich ' + tokI });
      expectOk('chú thích của ảnh đã thu hồi không còn tìm được', r, (x) => x.hits.length === 0);
    }
    const png2 = pngBytes(9, 23);
    const img2 = await uploadMedia(B, 'B: ảnh trả lời', { type: 'image', mime: 'image/png', size: png2.length, sha256: sha256buf(png2) }, png2);
    if (img2) {
      a = await sendMedia(B.ws, gid, 'image', [img2.id], { reply_to_message_id: mLast });
      check(a.type === 'ack' && a.data.reply_to && a.data.reply_to.message_id === mLast && a.data.reply_to.content === tLast &&
        a.data.attachments && a.data.attachments[0].id === img2.id, 'tin ảnh trả lời tin khác -> ack có reply_to + attachments', () => pktDetail(a));
    }
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n', 'ascii'), crypto.randomBytes(800)]);
    const fname = `Bao_gia_${tokF}.pdf`;
    const fil = await uploadMedia(A, 'A: tệp pdf', { type: 'file', mime: 'application/pdf', size: pdf.length, sha256: sha256buf(pdf), file_name: fname }, pdf);
    if (fil) {
      a = await sendMedia(A.ws, gid, 'file', [fil.id]);
      check(a.type === 'ack', 'A gửi tệp pdf vào nhóm', () => pktDetail(a));
      const mFile = a.data.message_id;
      a = await sendReply(C.ws, gid, 'trả lời tệp', mFile);
      check(a.type === 'ack' && a.data.reply_to && a.data.reply_to.msg_type === 'file' && a.data.reply_to.file_name === fname &&
        a.data.reply_to.content === '', 'trích dẫn tệp -> msg_type file, file_name, content ""', () => pktDetail(a));
      r = await call(C, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: `pdf ${tokF}` });
      expectOk('tìm theo tên tệp ("pdf <mã>") -> tin tệp kèm file_name', r,
        (x) => x.hits.length === 1 && x.hits[0].message_id === mFile && x.hits[0].msg_type === 'file' && x.hits[0].file_name === fname);
      r = await call(C, 'GET', `/conversations/${gid}/messages/search`, undefined, { q: `bao gia ${tokF}` });
      expectOk('tìm "bao gia <mã>" khớp tên tệp Bao_gia_<mã>.pdf (dấu _ tách từ)', r, (x) => js(hitIds(x)) === js([mFile]));
      const cmF = uuid();
      r = await call(B, 'POST', `/messages/${mFile}/forward`, { targets: [{ conversation_id: ctx.direct, client_msg_id: cmF }] });
      expectOk('B (không phải người tải) chuyển tiếp tệp sang chat 1-1 -> ok', r, (x) => x.results[0].ok === true);
      const mn = await waitPkt(A.ws, 'message.new', (y) => y.client_msg_id === cmF);
      check(mn.type === 'message.new' && mn.data.msg_type === 'file' && mn.data.forwarded === true && mn.data.attachments &&
        mn.data.attachments[0].id === fil.id && mn.data.attachments[0].file_name === fname,
      'A nhận tệp chuyển tiếp: msg_type file, forwarded, cùng media_id, giữ file_name', () => pktDetail(mn));
    }
  }

  // nhóm đã giải tán (mục 20): dòng chỉ đọc -> ghi 410, đọc / tìm / chuyển tiếp đi được
  if (ctx.g2 && ctx.g2MentionMsg) {
    const g2 = ctx.g2;
    const m2 = ctx.g2MentionMsg;
    const DIS = 'Nhóm đã bị giải tán';
    for (const [what, u, method, path, body] of [
      ['sửa', C, 'PATCH', `/messages/${m2}`, { content: 'sửa trong nhóm đã giải tán' }],
      ['thu hồi', C, 'POST', `/messages/${m2}/recall`],
      ['thả cảm xúc', B, 'PUT', `/messages/${m2}/reaction`, { reaction: 'like' }],
      ['bỏ cảm xúc', B, 'DELETE', `/messages/${m2}/reaction`],
    ]) {
      r = await call(u, method, path, body);
      expectErrMsg(`${what} tin của nhóm đã giải tán -> 410 GROUP_DISBANDED`, r, 410, 'GROUP_DISBANDED', DIS);
    }
    r = await call(B, 'GET', `/messages/${m2}/reactions`);
    expectOk('B: xem reaction của tin trong nhóm đã giải tán -> được', r, (x) => x.message_id === m2 && Array.isArray(x.reactions));
    r = await call(B, 'GET', `/conversations/${g2}/messages/changes`, undefined, { since: String(Date.now() - 3600000) });
    expectOk('B: changes của nhóm đã giải tán -> được', r, (x) => Array.isArray(x.messages));
    r = await call(B, 'GET', `/conversations/${g2}/messages/search`, undefined, { q: `xem giup ${RUN}` });
    expectOk('B: tìm trong nhóm đã giải tán -> thấy tin cũ', r, (x) => hitIds(x).includes(m2));
    r = await call(B, 'GET', `/conversations/${g2}/messages`, undefined, { around_seq: 2, limit: 3 });
    expectOk('B: nhảy tới tin trong nhóm đã giải tán -> được', r, (x) => Array.isArray(x.messages) && hasKey(x, 'has_newer'));
    const cmG = uuid();
    r = await call(B, 'POST', `/messages/${m2}/forward`, { targets: [{ conversation_id: ctx.direct, client_msg_id: cmG }] });
    const fw = expectOk('B chuyển tiếp tin từ nhóm đã giải tán (dòng chỉ đọc) sang chat 1-1 -> ok', r, (x) => x.results[0].ok === true);
    const mn = await waitPkt(A.ws, 'message.new', (y) => y.client_msg_id === cmG);
    check(mn.type === 'message.new' && mn.data.forwarded === true && !hasKey(mn.data, 'mentions') && content(mn).includes(RUN),
      'A nhận tin chuyển tiếp: forwarded, bỏ mentions của tin nguồn', () => pktDetail(mn));
    if (fw && fw.results[0].ack) {
      await expectConv('A: last_message của chat 1-1 = tin chuyển tiếp (forwarded true)', A, ctx.direct,
        (c) => c.last_message.id === fw.results[0].ack.message_id && c.last_message.forwarded === true);
    }
  }

  // chặn trong chat 1-1: sửa / thả cảm xúc / trả lời -> BLOCKED, thu hồi tin của mình vẫn được, chuyển tiếp lỗi ở đích bị chặn
  a = await sendText(B.ws, ctx.direct, `B gửi trước khi bị chặn ${RUN}`);
  const mBd = a.data.message_id;
  a = await sendText(A.ws, ctx.direct, `A gửi trước khi chặn ${RUN}`);
  const mAd = a.data.message_id;
  r = await call(A, 'POST', '/blocks', { user_id: B.id });
  expectOk('A chặn B', r);
  r = await call(B, 'PATCH', `/messages/${mBd}`, { content: 'B sửa khi bị chặn' });
  expectErr('B (bị chặn) sửa tin trong chat 1-1 -> 403 BLOCKED', r, 403, 'BLOCKED');
  r = await call(A, 'PATCH', `/messages/${mAd}`, { content: 'A sửa khi đang chặn' });
  expectErr('A (người chặn) sửa tin trong chat 1-1 -> 403 BLOCKED', r, 403, 'BLOCKED');
  r = await call(B, 'PUT', `/messages/${mAd}/reaction`, { reaction: 'like' });
  expectErr('B thả cảm xúc trong chat 1-1 đang chặn -> 403 BLOCKED', r, 403, 'BLOCKED');
  a = await sendReply(B.ws, ctx.direct, 'B trả lời khi bị chặn', mAd);
  expectWsErr('B trả lời trong chat 1-1 đang chặn -> error BLOCKED', a, 'BLOCKED');
  if (ctx.g3) {
    const tg = [{ conversation_id: ctx.direct, client_msg_id: uuid() }, { conversation_id: ctx.g3, client_msg_id: uuid() }];
    r = await call(A, 'POST', `/messages/${mLast}/forward`, { targets: tg });
    expectOk('A chuyển tiếp tới chat 1-1 đang chặn + nhóm 3 -> đích 1 BLOCKED, đích 2 ok', r,
      (x) => x.results[0].ok === false && x.results[0].error.code === 'BLOCKED' && x.results[1].ok === true);
  }
  r = await call(B, 'POST', `/messages/${mBd}/recall`);
  expectOk('B (bị chặn) vẫn thu hồi được tin của mình', r, (x) => x.recalled === true);
  r = await call(A, 'DELETE', `/blocks/${B.id}`);
  expectOk('A bỏ chặn B', r);
  r = await call(A, 'PATCH', `/messages/${mAd}`, { content: `A sửa sau khi bỏ chặn ${RUN}` });
  expectOk('bỏ chặn: A sửa tin được', r, (x) => isIso(x.edited_at));
  r = await call(B, 'POST', '/friend-requests', { user_id: A.id });
  expectOk('B mời kết bạn lại A', r, (x) => x.status === 'pending');
  r = await call(A, 'POST', `/friend-requests/${B.id}/accept`);
  expectOk('A chấp nhận lại B', r, (x) => x.status === 'accepted');
}

// 25. Đồng bộ giữa các thiết bị của cùng tài khoản + bù khi offline; devices.updated khi đăng nhập / đăng xuất.
async function s25() {
  const { A, B, C } = U;
  const gid = ctx.g4;
  if (!gid) throw new Error('chưa có nhóm từ mục 24');
  await ensureWs(A, 'A#gđ2');
  await ensureWs(B, 'B#gđ2');
  await ensureWs(C, 'C#gđ2');

  // B: máy thứ hai qua QR (B tự duyệt bằng máy 1)
  let r = await qrStartAt(QR_IP, 'chat-e2e B máy 2', 'desktop');
  const q = expectOk('B máy 2: qr/start', r, (x) => QR_CODE_RE.test(x.code));
  if (!q) throw new Error('không bắt đầu được phiên QR cho B máy 2');
  expectOk('B máy 1 quét', await call(B, 'POST', '/auth/qr/scan', { code: q.code }), (x) => x.status === 'scanned' && x.platform === 'desktop');
  expectOk('B máy 1 duyệt', await call(B, 'POST', '/auth/qr/approve', { code: q.code }), (x) => x.status === 'approved');
  r = await qrPollOf(q);
  const got = expectOk('B máy 2 poll -> approved + auth', r, (x) => x.status === 'approved' && x.auth && x.auth.user.id === B.id);
  if (!got || !got.auth) throw new Error('B máy 2 không nhận được phiên');
  const B2 = { label: 'B2', id: B.id, name: B.name, access: got.auth.access_token, refresh: got.auth.refresh_token, deviceId: got.auth.device_id };
  let p = await waitPkt(B.ws, 'devices.updated', (y) => y.reason === 'login' && y.device_id === B2.deviceId);
  check(p.type === 'devices.updated', 'B máy 1 nhận devices.updated {login, device_id máy 2}', () => pktDetail(p));
  r = await rest('POST', '/auth/refresh', { body: { refresh_token: B2.refresh } });
  const rf = expectOk('refresh token nhận qua QR dùng được (đổi cặp mới, cùng device_id)', r, (x) => x.device_id === B2.deviceId && x.user.id === B.id);
  if (rf && rf.access_token) Object.assign(B2, { access: rf.access_token, refresh: rf.refresh_token });
  B2.ws = await openWs('B#máy 2', B2);

  // tin / sửa / reaction / đã xem từ máy 1 tới máy 2
  const cmS = uuid();
  let a = await sendText(B.ws, gid, `B gửi từ máy 1 ${RUN}`, cmS);
  const mS = a.data.message_id;
  let mn = await waitPkt(B2.ws, 'message.new', (y) => y.client_msg_id === cmS);
  check(mn.type === 'message.new' && mn.data.sender_id === B.id, 'máy 2 của B nhận message.new của tin B gửi từ máy 1', () => pktDetail(mn));
  const tS = `B sửa từ máy 1 ${RUN}`;
  r = await call(B, 'PATCH', `/messages/${mS}`, { content: tS });
  expectOk('B sửa từ máy 1', r, (x) => x.content === tS);
  p = await waitPkt(B2.ws, 'message.updated', (y) => y.action === 'edit' && y.message && y.message.id === mS);
  check(p.type === 'message.updated' && p.data.message.content === tS, 'máy 2 nhận message.updated (edit)', () => pktDetail(p));
  r = await call(B, 'PUT', `/messages/${mS}/reaction`, { reaction: 'like' });
  expectOk('B thả like từ máy 1', r, (x) => x.mine === 'like');
  p = await waitPkt(B2.ws, 'reactions.updated', (y) => y.message_id === mS && y.user_id === B.id && y.reaction === 'like');
  check(p.type === 'reactions.updated', 'máy 2 nhận reactions.updated {user_id B, reaction like} (đồng bộ "mine")', () => pktDetail(p));
  r = await call(B2, 'GET', `/conversations/${gid}/messages`, undefined, { around_seq: a.data.seq, limit: 3 });
  expectOk('máy 2 tải lịch sử -> reactions.mine = like', r, (x) => findMsg(x, mS) && findMsg(x, mS).reactions.mine === 'like');
  const cmA = uuid();
  a = await sendText(A.ws, gid, `A gửi để B đọc ${RUN}`, cmA);
  const seqA = a.data.seq;
  await waitPkt(B2.ws, 'message.new', (y) => y.client_msg_id === cmA);
  const rr = await reqPkt(B.ws, 'message.read', { conversation_id: gid, seq: seqA });
  check(rr.type === 'ack', 'B đọc tới tin của A từ máy 1 -> ack', () => pktDetail(rr));
  p = await waitPkt(B2.ws, 'receipt.update', (y) => y.conversation_id === gid && y.user_id === B.id && y.read_seq === seqA);
  check(p.type === 'receipt.update', 'máy 2 nhận receipt.update {user_id B, read_seq} (đồng bộ chưa đọc)', () => pktDetail(p));

  // máy 2 offline: bỏ lỡ sửa / thu hồi / reaction -> /sync + changes bù lại
  const mk = async (t) => (await sendText(A.ws, gid, `${t} ${RUN}`)).data.message_id;
  const mE = await mk('sẽ sửa khi máy 2 offline');
  const mR = await mk('sẽ thu hồi khi máy 2 offline');
  const mX = await mk('sẽ có reaction khi máy 2 offline');
  const mN = await mk('không đổi');
  r = await call(B2, 'GET', '/conversations');
  const lst = expectOk('máy 2: GET /conversations -> sync_cursor', r, (x) => /^\d+$/.test(x.sync_cursor));
  const cur = lst && lst.sync_cursor ? lst.sync_cursor : String(Date.now() - 5000);
  B2.ws.close();
  await settle(B2.ws.waitClose());
  const tE = `đã sửa khi máy 2 offline ${RUN}`;
  expectOk('A sửa tin (máy 2 offline)', await call(A, 'PATCH', `/messages/${mE}`, { content: tE }), (x) => x.content === tE);
  expectOk('A thu hồi tin (máy 2 offline)', await call(A, 'POST', `/messages/${mR}/recall`), (x) => x.recalled === true);
  expectOk('C thả sad (máy 2 offline)', await call(C, 'PUT', `/messages/${mX}/reaction`, { reaction: 'sad' }), (x) => x.counts.sad === 1);
  r = await call(B2, 'GET', '/sync', undefined, { cursor: cur });
  expectOk('máy 2: /sync?cursor -> có nhóm (sửa / thu hồi / reaction đẩy updated_at của hội thoại)', r, (x) => !!findConv(x.conversations, gid));
  r = await call(B2, 'GET', `/conversations/${gid}/messages/changes`, undefined, { since: cur });
  expectOk('máy 2: changes since sync_cursor -> tin đã sửa (nội dung mới), đã thu hồi, có reaction (mine null); không có tin chưa từng đổi', r, (x) => {
    const e = findMsg(x, mE);
    const rc = findMsg(x, mR);
    const xr = findMsg(x, mX);
    return e && e.content === tE && isIso(e.edited_at) && rc && rc.recalled === true && rc.content === '' &&
      xr && xr.reactions && xr.reactions.counts.sad === 1 && xr.reactions.mine === null && !findMsg(x, mN) && x.next_cursor === null;
  });

  // máy 2 đăng xuất -> máy 1 nhận devices.updated {logout}
  r = await call(B2, 'POST', '/auth/logout');
  expectOk('máy 2 của B đăng xuất', r);
  p = await waitPkt(B.ws, 'devices.updated', (y) => y.reason === 'logout' && y.device_id === B2.deviceId);
  check(p.type === 'devices.updated', 'B máy 1 nhận devices.updated {logout, device_id máy 2}', () => pktDetail(p));
  r = await call(B, 'GET', '/devices');
  expectOk('B: danh sách không còn máy 2', r, (x) => !x.devices.some((d) => d.id === B2.deviceId));

  // C: đăng nhập OTP trên máy thứ hai -> máy 1 nhận devices.updated {login}
  const UA_C = 'chat-e2e C UA ' + RUN;
  const c2 = await otpLogin(C, 'C máy 2', { ip: OTP_IP, ua: UA_C, name: 'chat-e2e C máy 2', platform: 'web' });
  if (c2) {
    p = await waitPkt(C.ws, 'devices.updated', (y) => y.reason === 'login' && y.device_id === c2.deviceId);
    check(p.type === 'devices.updated', 'C máy 1 nhận devices.updated {login, device_id mới} khi đăng nhập OTP', () => pktDetail(p));
    r = await call(C, 'GET', '/devices');
    expectOk('C: danh sách có máy 2 {current false, online false, login_method otp, user_agent, last_ip}', r,
      (x) => x.devices[0].id === C.deviceId && x.devices.some((d) => d.id === c2.deviceId && d.current === false && d.online === false &&
        d.login_method === 'otp' && d.user_agent === UA_C && d.last_ip === OTP_IP));
    r = await call(C, 'POST', '/devices/logout-others');
    expectOk('C: đăng xuất mọi thiết bị khác -> revoked >= 1', r, (x) => x.revoked >= 1);
    p = await waitPkt(C.ws, 'devices.updated', (y) => y.reason === 'revoked' && y.device_id === c2.deviceId);
    check(p.type === 'devices.updated', 'C máy 1 nhận devices.updated {revoked, device_id máy 2}', () => pktDetail(p));
    r = await rest('GET', '/me', { token: c2.access });
    expectErr('access token của máy 2 -> 401 CHAT_NOAUTH', r, 401, 'CHAT_NOAUTH');
  }
}

// 26. QR: poll_token chéo, poll quá nhanh, mã gõ tay kiểu O / I / L, giới hạn phiên / IP; hạn mức sửa / reaction / tìm.
async function s26() {
  const { C, D } = U;
  let r = await qrStartAt(QR_IP, 'chat-e2e QR+ a');
  const qa = expectOk('phiên QR a', r, (x) => QR_CODE_RE.test(x.code));
  r = await qrStartAt(QR_IP, 'chat-e2e QR+ b');
  const qb = expectOk('phiên QR b', r, (x) => QR_CODE_RE.test(x.code));
  if (!qa || !qb) throw new Error('không tạo được phiên QR');
  r = await qrPollOf(qb, qa.poll_token);
  expectErr('poll qr_id của phiên b bằng poll_token của phiên a -> 404 QR_INVALID', r, 404, 'QR_INVALID');
  const polls = [];
  for (let i = 0; i < 4; i++) polls.push(await qrPollOf(qa));
  check(polls.slice(0, 3).every((x) => x.ok && x.result.status === 'pending'), '3 lần poll liền -> pending', () => polls.map(brief).join(' | '));
  expectErrMsg('lần poll thứ 4 trong 3 giây -> 429 RATE_LIMIT', polls[3], 429, 'RATE_LIMIT', 'Bạn thao tác quá nhanh, thử lại sau');
  r = await rest('POST', '/auth/qr/start', { body: {}, headers: { 'X-Forwarded-For': QR_IP } });
  const q0 = expectOk('qr/start không có device -> vẫn tạo phiên (platform mặc định như otp/verify)', r, (x) => QR_CODE_RE.test(x.code));
  if (q0) {
    r = await call(C, 'POST', '/auth/qr/scan', { code: q0.code });
    expectOk('quét phiên không khai device -> platform web, device_name ""', r, (x) => x.platform === 'web' && x.device_name === '');
  }

  // mã gõ tay: O -> 0, I / L -> 1 (mã thật chỉ có 0 / 1, bỏ I L O U)
  let q01 = [qa, qb].find((x) => /[01]/.test(x.code));
  for (let i = 0; i < 4 && !q01; i++) {
    r = await qrStartAt(QR_IP, 'chat-e2e QR+ 01');
    if (r.ok && /[01]/.test(r.result.code)) q01 = r.result;
  }
  if (q01) {
    const typed = q01.code.replace(/0/g, 'o').replace(/1/g, (_, i) => (i % 2 ? 'I' : 'l'));
    r = await call(C, 'POST', '/auth/qr/scan', { code: typed });
    expectOk(`quét mã gõ "${typed}" (o -> 0, I / l -> 1) -> đúng phiên`, r, (x) => x.qr_id === q01.qr_id && x.status === 'scanned');
  } else {
    note('không sinh được mã QR có 0 / 1 sau 6 lần: bỏ bước gõ O / I / L');
  }

  // giới hạn 20 phiên / 10 phút / IP
  const rlIp = newIp();
  let okN = 0;
  let last = null;
  for (let i = 0; i < 20; i++) {
    last = await qrStartAt(rlIp, 'chat-e2e QR giới hạn ' + i);
    if (!last.ok) break;
    okN++;
  }
  check(okN === 20, '20 phiên QR đầu từ cùng một IP -> được', () => `${okN} phiên, lần cuối ${last ? brief(last) : ''}`);
  r = await qrStartAt(rlIp, 'chat-e2e QR giới hạn 21');
  expectErr('phiên thứ 21 trong 10 phút từ cùng IP -> 429 RATE_LIMIT', r, 429, 'RATE_LIMIT');
  r = await qrStartAt(newIp(), 'chat-e2e QR IP khác');
  expectOk('IP khác vẫn tạo được phiên', r, (x) => QR_CODE_RE.test(x.code));

  // hạn mức (dùng D: đã rời nhóm ở mục 24, không còn dùng ở bước sau). Hạn mức kiểm trước quyền -> 403 cho tới khi hết lượt.
  const mD2 = ctx.g4LeftMsg;
  if (!mD2 || !D.access) {
    skip('26. hạn mức', 'không có tin của D từ mục 24');
    return;
  }
  const until429 = async (max, fn) => {
    const seen = [];
    for (let i = 0; i < max; i++) {
      const x = await fn(i);
      seen.push(x);
      if (x.status === 429) break;
    }
    return seen;
  };
  const okUntil = (name, seen, max, msg) => {
    const lastR = seen[seen.length - 1];
    const before = seen.slice(0, -1);
    check(lastR.status === 429 && lastR.code === 'RATE_LIMIT' && lastR.error === msg && seen.length <= max &&
      before.every((x) => x.status === 403), name, () => `${seen.length} lần, cuối ${brief(lastR)}; trước đó ${[...new Set(before.map((x) => x.status))]}`);
  };
  let seen = await until429(45, (i) => call(D, 'PATCH', `/messages/${mD2}`, { content: 'sửa ' + i }));
  okUntil('sửa / thu hồi quá 30 lần / phút -> 429 "Bạn thao tác quá nhanh, thử lại sau"', seen, 45, 'Bạn thao tác quá nhanh, thử lại sau');
  seen = await until429(80, () => call(D, 'PUT', `/messages/${mD2}/reaction`, { reaction: 'like' }));
  okUntil('reaction quá 60 lần / phút -> 429', seen, 80, 'Bạn thao tác quá nhanh, thử lại sau');
  seen = await until429(45, () => call(D, 'GET', `/conversations/${ctx.g4}/messages/search`, undefined, { q: 'ab' + RUN }));
  okUntil('tìm quá 30 lần / phút -> 429 "Bạn tìm kiếm quá nhanh, thử lại sau"', seen, 45, 'Bạn tìm kiếm quá nhanh, thử lại sau');
}

// 27. [chậm] Phiên QR hết hạn (tạo ở đầu mục 24): poll -> expired, quét / duyệt / từ chối -> 410, đã duyệt mà máy mới chưa
// nhận token thì hết hạn là mất (không trao token).
async function s27() {
  const { B } = U;
  const e = ctx.qrExp;
  if (!e || !e.pend || !e.scan || !e.appr) throw new Error('chưa tạo đủ phiên QR ở đầu mục 24');
  // chờ theo đồng hồ server (expires_in của poll), tối đa ~3 phút
  const waitExpired = async (label, q) => {
    let r = null;
    for (let i = 0; i < 6; i++) {
      r = await qrPollOf(q);
      if (!r.ok || r.result.status === 'expired') break;
      const ms = Math.max(1, Number(r.result.expires_in) || 1) * 1000 + 1200;
      if (i === 0) note(`[chậm] ${label}: chờ ${Math.round(ms / 1000)} giây cho phiên hết hạn`);
      await sleep(ms);
    }
    return r;
  };
  let r = await waitExpired('phiên chưa quét', e.pend);
  expectOk('[chậm] phiên chưa quét quá hạn -> poll expired, expires_in 0, không auth', r,
    (x) => x.status === 'expired' && x.expires_in === 0 && !hasKey(x, 'auth'));
  r = await call(B, 'POST', '/auth/qr/scan', { code: e.pend.code });
  expectErr('[chậm] quét mã đã hết hạn -> 410 QR_EXPIRED', r, 410, 'QR_EXPIRED');
  r = await call(B, 'POST', '/auth/qr/approve', { code: e.pend.code });
  expectErr('[chậm] duyệt mã chưa quét đã hết hạn -> 410 QR_EXPIRED', r, 410, 'QR_EXPIRED');
  r = await waitExpired('phiên đã quét', e.scan);
  expectOk('[chậm] phiên đã quét quá hạn -> poll expired', r, (x) => x.status === 'expired' && !hasKey(x, 'auth'));
  r = await call(B, 'POST', '/auth/qr/approve', { code: e.scan.code });
  expectErr('[chậm] người đã quét duyệt sau khi hết hạn -> 410 QR_EXPIRED', r, 410, 'QR_EXPIRED');
  r = await call(B, 'POST', '/auth/qr/reject', { code: e.scan.code });
  expectErr('[chậm] từ chối sau khi hết hạn -> 410 QR_EXPIRED', r, 410, 'QR_EXPIRED');
  r = await waitExpired('phiên đã duyệt', e.appr);
  expectOk('[chậm] phiên đã duyệt nhưng máy mới chưa poll, quá hạn -> expired, KHÔNG trao auth', r,
    (x) => x.status === 'expired' && !hasKey(x, 'auth'));
  r = await call(B, 'GET', '/devices');
  expectOk('[chậm] không có thiết bị "chat-e2e QR hết hạn 3" nào được tạo', r, (x) => !x.devices.some((d) => d.name === 'chat-e2e QR hết hạn 3'));
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
  await scenario(16, 'Tệp đính kèm: ảnh, tin thoại, dedup, quyền đọc, lỗi (MinIO)', s16);
  await scenario(17, 'Nhắc tên: mentions, @Tất cả, unread_mention', s17);
  await scenario(18, 'Thông tin nhóm: mô tả, ảnh nhóm (luồng tệp), cài đặt quyền', s18);
  await scenario(19, 'Link mời: tạo, xem trước, vào thẳng, chờ duyệt, từ chối, thu hồi', s19);
  await scenario(20, 'Chuyển trưởng nhóm + giải tán (chỉ đọc, 410 GROUP_DISBANDED)', s20);
  await scenario(21, 'Trả lời, sửa, reaction, nhảy tới tin, thu hồi, changes, chuyển tiếp', s21);
  await scenario(22, 'Tìm tin nhắn (không dấu, tiền tố, phân trang, phạm vi)', s22);
  await scenario(23, 'Đa thiết bị: danh sách, đăng nhập QR, đăng xuất từ xa', s23);
  await scenario(24, 'Giai đoạn 2: kiểm duyệt, admins_only_send, rời nhóm, chặn, giải tán, trích dẫn / tìm tệp, last_message', s24);
  await scenario(25, 'Đồng bộ nhiều thiết bị của một tài khoản, bù khi offline, devices.updated login / logout', s25);
  await scenario(26, 'QR: poll_token chéo, poll quá nhanh, mã O / I / L, giới hạn phiên / IP; hạn mức sửa / reaction / tìm', s26);
  if (SKIP_SLOW) skip('27. QR hết hạn', 'SKIP_SLOW=1');
  else await scenario(27, '[chậm] Phiên QR hết hạn', s27);
  finish();
})().catch((e) => finish('lỗi ngoài dự kiến: ' + ((e && e.stack) || String(e))));
