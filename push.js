'use strict';
/* 온트랙 클라이언트 푸시 모듈 — window.Push 로 노출.
   구독/예약/취소/공지발송. 데이터 저장은 app.js(localStorage), 푸시 배관만 담당. */
(function () {
  const CFG = window.ONTRACK_CONFIG || {};
  const fnUrl = (name) => `${(CFG.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/${name}`;

  function urlB64ToUint8(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function callFn(name, body, extraHeaders) {
    const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
    if (CFG.SUPABASE_ANON) { headers['apikey'] = CFG.SUPABASE_ANON; headers['Authorization'] = 'Bearer ' + CFG.SUPABASE_ANON; }
    const res = await fetch(fnUrl(name), { method: 'POST', headers, body: JSON.stringify(body || {}) });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  const Push = {
    configured() { return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON && CFG.VAPID_PUBLIC); },
    supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
    permission() { return (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported'; },
    standalone() {
      return window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    },
    isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent); },

    deviceId() {
      let id = localStorage.getItem('ontrack.deviceId');
      if (!id) { id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem('ontrack.deviceId', id); }
      return id;
    },

    async subscription() {
      const reg = await navigator.serviceWorker.ready;
      return reg.pushManager.getSubscription();
    },
    async isOn() {
      if (!this.supported() || this.permission() !== 'granted') return false;
      return !!(await this.subscription());
    },

    // 알림 켜기: 권한요청 → 구독 → 서버 등록
    async enable() {
      if (!this.configured()) return { ok: false, reason: 'not_configured' };
      if (!this.supported()) return { ok: false, reason: 'unsupported' };
      if (this.isIOS() && !this.standalone()) return { ok: false, reason: 'need_install' };
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return { ok: false, reason: 'denied' };
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(CFG.VAPID_PUBLIC),
        });
      }
      await callFn('subscribe', { deviceId: this.deviceId(), subscription: sub.toJSON(), ua: navigator.userAgent });
      return { ok: true };
    },

    // 예약 리마인더 등록/수정 → id 반환
    async schedule({ id, title, body, url, fireAt }) {
      const data = await callFn('schedule', { deviceId: this.deviceId(), action: 'set', reminder: { id, title, body, url, fireAt } });
      return data.id;
    },
    async cancel(id) {
      if (!id) return;
      await callFn('schedule', { deviceId: this.deviceId(), action: 'cancel', id });
    },

    // 관리자 공지 발송 (관리자 시크릿 필요)
    async broadcast({ title, body, url, secret }) {
      return callFn('broadcast', { title, body, url }, { 'x-admin-secret': secret });
    },

    // 테스트: 즉시 로컬 알림 + 20초 뒤 서버 푸시(잠금화면 확인용)
    async test() {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('온트랙 알림 켜짐 ✅', { body: '이렇게 알림이 표시됩니다. 20초 뒤 서버 테스트 푸시가 한 번 더 옵니다 — 화면을 잠가보세요.', tag: 'test-local' });
      const fireAt = new Date(Date.now() + 20000).toISOString();
      await this.schedule({ title: '온트랙 서버 푸시 테스트 📩', body: '앱이 꺼져 있어도 도착했습니다.', url: '/', fireAt });
    },
  };

  window.Push = Push;
})();
