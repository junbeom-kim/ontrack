'use strict';
/* 온트랙 동기화 모듈 — window.Sync. 회사 코드 연결 + 상담/전시회 서버 업서트.
   로컬 저장(app.js)은 그대로, 온라인 시 백그라운드로 서버에 밀어넣기만 담당. */
(function () {
  const CFG = window.ONTRACK_CONFIG || {};
  const fnUrl = (n) => `${(CFG.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/${n}`;

  async function callFn(name, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (CFG.SUPABASE_ANON) { headers['apikey'] = CFG.SUPABASE_ANON; headers['Authorization'] = 'Bearer ' + CFG.SUPABASE_ANON; }
    const res = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify(body || {}) });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (!res.ok) { const e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
    return data;
  }

  window.Sync = {
    configured() { return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON); },
    // 참여 코드로 회사 연결 → { companyId, companyName } (실패 시 throw, 404=잘못된 코드)
    async join(code) {
      const deviceId = window.Push ? Push.deviceId() : undefined;
      return callFn('join', { code, deviceId });
    },
    // 전시회·상담을 서버로 업서트(멱등)
    async push({ companyId, deviceId, events, consultations }) {
      return callFn('sync', { companyId, deviceId, events, consultations });
    },
  };
})();
