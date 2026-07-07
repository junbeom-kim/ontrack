'use strict';
/* 온트랙 — 로컬 우선 현장 상담 기록 PWA (슬라이스 1: 기록 → 오늘 성과 → 출장 보고서) */

// ─────────────────────────── 저장소 ───────────────────────────
const KEY = 'ontrack.v1';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const defaultState = () => {
  const ev = { id: uid(), name: '전시회', country: '', city: '', startDate: '', endDate: '', booth: '' };
  return {
    profile: { company: '우리 회사', traveler: '' },
    events: [ev],
    currentEventId: ev.id,
    consultations: [],
    narratives: {},
  };
};

let state;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? JSON.parse(raw) : defaultState();
    if (!state.events || !state.events.length) state = defaultState();
    if (!state.currentEventId || !state.events.some(e => e.id === state.currentEventId))
      state.currentEventId = state.events[0].id;
    if (!state.narratives) state.narratives = {};
  } catch (_) {
    state = defaultState();
  }
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

const $ = (id) => document.getElementById(id);
const currentEvent = () => state.events.find(e => e.id === state.currentEventId) || state.events[0];
const eventCons = (eid = state.currentEventId) =>
  state.consultations.filter(c => c.eventId === eid).sort((a, b) => b.createdAt - a.createdAt);

// ─────────────────────────── 집계 ───────────────────────────
const isToday = (ts) => {
  const d = new Date(ts), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
function agg(list) {
  return {
    count: list.length,
    leads: list.filter(c => c.grade === 'hot' || c.grade === 'warm').length,
    hot: list.filter(c => c.grade === 'hot').length,
    deals: list.filter(c => (c.types || []).includes('MOU·계약')).length,
    followups: list.filter(c => (c.nextActions || []).length > 0).length,
  };
}

// ─────────────────────────── 뷰 전환 ───────────────────────────
const VIEWS = ['viewHome', 'viewCapture', 'viewConfirm', 'viewReport'];
function show(view) {
  VIEWS.forEach(v => { $(v).hidden = v !== view; });
  $('footCapture').hidden = view !== 'viewCapture';
  $('footReport').hidden = view !== 'viewReport';
  window.scrollTo(0, 0);
}

// ─────────────────────────── 라벨 ───────────────────────────
const GRADE_LABEL = { hot: '🔥 유망', warm: '관심', cold: '참고' };
function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (isToday(ts)) return Math.floor(s / 3600) + '시간 전';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const fmtDate = (s) => s ? s.replace(/-/g, '.') : '';

// ─────────────────────────── 홈 렌더 ───────────────────────────
function renderTopbar() {
  const ev = currentEvent();
  $('tbCompany').textContent = state.profile.company || '우리 회사';
  const parts = [ev.name || '전시회'];
  if (ev.country) parts.push(ev.country);
  $('tbEvent').textContent = parts.join(' · ') + '  ⌄';
}
function renderHome() {
  renderTopbar();
  const list = eventCons();
  const today = agg(list.filter(c => isToday(c.createdAt)));
  $('heroCount').textContent = today.count;
  $('heroLeads').textContent = today.leads;
  $('heroDeals').textContent = today.deals;

  const box = $('leadList');
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="big">📇</div>아직 기록이 없습니다.<br>부스에서 바이어와 얘기한 직후, <b>＋상담 기록</b>을 누르세요.</div>`;
    return;
  }
  box.className = 'card';
  box.innerHTML = list.slice(0, 20).map(c => {
    const tags = [GRADE_LABEL[c.grade] || '', ...(c.types || [])].filter(Boolean).join(' · ');
    return `<button class="lead" data-id="${c.id}">
      <span class="dot ${c.grade}"></span>
      <span class="l-body">
        <span class="l-co">${esc(c.buyerCompany) || '바이어 미기재'}</span>
        <span class="l-tag">${esc(tags)}</span>
      </span>
      <span class="l-time">${relTime(c.createdAt)}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.lead').forEach(el =>
    el.addEventListener('click', () => openCapture(el.dataset.id)));
}
const esc = (s) => (s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// ─────────────────────────── 입력(캡처) ───────────────────────────
let editingId = null;
const draft = { grade: null, types: [], nextActions: [], scale: null };

function chipGroup(containerId, mode, getVal, setVal) {
  $(containerId).addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    const v = chip.dataset.v;
    if (mode === 'single') {
      const cur = getVal();
      setVal(cur === v ? null : v);
    } else {
      const arr = getVal();
      const i = arr.indexOf(v);
      i >= 0 ? arr.splice(i, 1) : arr.push(v);
      setVal(arr);
    }
    syncChips(containerId, mode, getVal());
  });
}
function syncChips(containerId, mode, val) {
  $(containerId).querySelectorAll('.chip').forEach(chip => {
    const on = mode === 'single' ? chip.dataset.v === val : (val || []).includes(chip.dataset.v);
    chip.classList.toggle('sel', on);
  });
}

function openCapture(id = null) {
  editingId = id;
  const c = id ? state.consultations.find(x => x.id === id) : null;
  draft.grade = c ? c.grade : null;
  draft.types = c ? [...(c.types || [])] : [];
  draft.nextActions = c ? [...(c.nextActions || [])] : [];
  draft.scale = c ? (c.scale || null) : null;
  $('fCompany').value = c ? (c.buyerCompany || '') : '';
  $('fName').value = c ? (c.buyerName || '') : '';
  $('fMemo').value = c ? (c.memo || '') : '';
  $('capTitle').textContent = c ? '상담 보강' : '새 상담';
  syncChips('fGrade', 'single', draft.grade);
  syncChips('fTypes', 'multi', draft.types);
  syncChips('fActions', 'multi', draft.nextActions);
  syncChips('fScale', 'single', draft.scale);
  show('viewCapture');
}

function saveConsultation() {
  if (!draft.grade && draft.types.length === 0) {
    toast('관심도나 유형을 하나 이상 선택하세요');
    return;
  }
  const base = {
    eventId: state.currentEventId,
    buyerCompany: $('fCompany').value.trim(),
    buyerName: $('fName').value.trim(),
    grade: draft.grade || 'warm',
    types: [...draft.types],
    nextActions: [...draft.nextActions],
    scale: draft.scale,
    memo: $('fMemo').value.trim(),
  };
  if (editingId) {
    const c = state.consultations.find(x => x.id === editingId);
    Object.assign(c, base);
    save(); toast('보강 저장됨'); renderHome(); show('viewHome'); return;
  }
  const c = { id: uid(), createdAt: Date.now(), ...base };
  state.consultations.push(c);
  save();
  // 확인 화면
  const today = agg(eventCons().filter(x => isToday(x.createdAt)));
  const n = eventCons().filter(x => isToday(x.createdAt)).length;
  $('cfTitle').textContent = `오늘 ${n}번째 상담 저장됨`;
  $('cfSub').textContent = (c.buyerCompany || '바이어') + ' · 이 기기에 안전하게 저장됨';
  $('cfCount').textContent = today.count;
  $('cfLeads').textContent = today.leads;
  $('cfDeals').textContent = today.deals;
  show('viewConfirm');
}

// ─────────────────────────── 보고서 ───────────────────────────
function renderReport() {
  $('rNarrative').value = state.narratives[currentEvent().id] || '';
  buildReportDoc();
}
function buildReportDoc() {
  const ev = currentEvent();
  const list = eventCons();
  const a = agg(list);

  const period = ev.startDate ? `${fmtDate(ev.startDate)}${ev.endDate ? ' – ' + fmtDate(ev.endDate) : ''}` : '';
  const rows = list.slice().sort((x, y) => x.createdAt - y.createdAt).map((c, i) => {
    const d = new Date(c.createdAt);
    const gcls = c.grade === 'hot' ? 'g-hot' : c.grade === 'warm' ? 'g-warm' : 'g-cold';
    return `<tr>
      <td>${i + 1}</td>
      <td><b>${esc(c.buyerCompany) || '-'}</b>${c.buyerName ? '<br><span style="color:#888">' + esc(c.buyerName) + '</span>' : ''}</td>
      <td class="${gcls}">${(GRADE_LABEL[c.grade] || '').replace('🔥 ', '')}</td>
      <td>${esc((c.types || []).join(', ')) || '-'}</td>
      <td>${esc((c.nextActions || []).join(', ')) || '-'}</td>
      <td>${c.scale || '-'}</td>
      <td style="color:#888">${d.getMonth() + 1}/${d.getDate()}</td>
    </tr>`;
  }).join('');

  const narr = state.narratives[ev.id] || '';
  const genDate = new Date();
  $('reportDoc').innerHTML = `<div class="report" id="reportPrintable">
    <div class="r-eyebrow">해외전시 출장 결과 보고서</div>
    <h1>${esc(ev.name) || '전시회'} 참가 결과</h1>
    <p class="r-sub">${esc(state.profile.company) || ''}${ev.country ? ' · ' + esc(ev.country) : ''}${ev.city ? ' ' + esc(ev.city) : ''}${period ? ' · ' + period : ''}${state.profile.traveler ? ' · 출장자 ' + esc(state.profile.traveler) : ''}</p>

    <h4>성과 요약</h4>
    <div class="r-kpi">
      <div class="cell"><div class="v">${a.count}</div><div class="k">총 상담</div></div>
      <div class="cell"><div class="v">${a.leads}</div><div class="k">유효 리드</div></div>
      <div class="cell"><div class="v">${a.deals}</div><div class="k">MOU·계약 논의</div></div>
      <div class="cell"><div class="v">${a.followups}</div><div class="k">후속조치 대상</div></div>
    </div>

    ${narr ? `<h4>총평 · 시사점</h4><div class="r-narr">${esc(narr)}</div>` : ''}

    <h4>상담 내역 (${a.count}건)</h4>
    ${list.length ? `<table class="r-tbl">
      <thead><tr><th>#</th><th>바이어</th><th>관심도</th><th>유형</th><th>다음 액션</th><th>규모</th><th>일자</th></tr></thead>
      <tbody>${rows}</tbody></table>` : '<p style="color:#888;font-size:13px">기록된 상담이 없습니다.</p>'}

    <div class="r-foot">생성 ${genDate.getFullYear()}.${genDate.getMonth() + 1}.${genDate.getDate()} · 온트랙 현장 기록에서 자동 조립 · 상담 데이터 기반</div>
  </div>`;
}

// ─────────────────────────── 모달(설정/이벤트) ───────────────────────────
function openModal(html) { $('modal').innerHTML = html; $('modalBg').hidden = false; }
function closeModal() { $('modalBg').hidden = true; }

function settingsModal() {
  const evs = state.events.map(e => {
    const meta = [e.country, e.startDate ? fmtDate(e.startDate) : ''].filter(Boolean).join(' · ');
    return `<button class="evrow ${e.id === state.currentEventId ? 'active' : ''}" data-ev="${e.id}">
      <span><span class="e-nm">${esc(e.name) || '전시회'}</span><span class="e-meta">${esc(meta) || '정보 없음'}</span></span>
      ${e.id === state.currentEventId ? '<span class="e-badge">현재 ✓</span>' : '<span class="e-badge" data-edit="' + e.id + '">편집</span>'}
    </button>`;
  }).join('');
  openModal(`
    <h3>설정</h3>
    <p class="m-sub">이 정보는 이 기기에만 저장됩니다.</p>
    <label>참가기업 (우리 회사)</label>
    <input class="input" id="sCompany" value="${esc(state.profile.company)}" placeholder="회사명">
    <label>출장자</label>
    <input class="input" id="sTraveler" value="${esc(state.profile.traveler)}" placeholder="담당자 이름">
    <label style="margin-top:20px">전시회</label>
    <div class="evlist">${evs}</div>
    <button class="btn ghost" id="sAddEvent" style="width:100%;margin-top:4px">＋ 전시회 추가</button>
    <div class="btn-row">
      <button class="btn ghost" id="sExport">데이터 내보내기</button>
      <button class="btn primary" id="sSave">저장</button>
    </div>
    <button class="icon-btn" id="sReset" style="display:block;width:100%;text-align:center;color:var(--hot);margin-top:14px;font-size:13px">전체 데이터 삭제</button>
  `);
  const persistProfile = () => {
    state.profile.company = $('sCompany').value.trim() || '우리 회사';
    state.profile.traveler = $('sTraveler').value.trim();
    save();
  };
  $('sSave').onclick = () => { persistProfile(); renderTopbar(); closeModal(); };
  $('sAddEvent').onclick = () => { persistProfile(); eventModal(null); };
  $('sExport').onclick = () => { persistProfile(); exportData(); };
  $('sReset').onclick = () => {
    if (confirm('모든 상담·전시회·설정을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) {
      localStorage.removeItem(KEY); load(); closeModal(); renderHome(); toast('초기화됨');
    }
  };
  $('modal').querySelectorAll('.evrow').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.dataset.edit) { persistProfile(); eventModal(e.target.dataset.edit); return; }
      persistProfile();
      state.currentEventId = el.dataset.ev; save(); closeModal(); renderHome();
    });
  });
}

function eventModal(id) {
  const e = id ? state.events.find(x => x.id === id) : { name: '', country: '', city: '', startDate: '', endDate: '', booth: '' };
  openModal(`
    <h3>${id ? '전시회 편집' : '전시회 추가'}</h3>
    <p class="m-sub">전시회 기준으로 상담과 보고서가 묶입니다.</p>
    <label>전시회명</label>
    <input class="input" id="eName" value="${esc(e.name)}" placeholder="예: BIO USA 2026">
    <div class="row">
      <div><label>국가</label><input class="input" id="eCountry" value="${esc(e.country)}" placeholder="미국"></div>
      <div><label>도시</label><input class="input" id="eCity" value="${esc(e.city)}" placeholder="Boston"></div>
    </div>
    <div class="row">
      <div><label>시작일</label><input class="input" id="eStart" type="date" value="${e.startDate || ''}"></div>
      <div><label>종료일</label><input class="input" id="eEnd" type="date" value="${e.endDate || ''}"></div>
    </div>
    <label>부스 (선택)</label>
    <input class="input" id="eBooth" value="${esc(e.booth)}" placeholder="Hall 2 · #A-12">
    <div class="btn-row">
      ${id && state.events.length > 1 ? '<button class="btn ghost" id="eDelete" style="color:var(--hot)">삭제</button>' : ''}
      <button class="btn primary" id="eSave">${id ? '저장' : '추가하고 전환'}</button>
    </div>
  `);
  $('eSave').onclick = () => {
    const data = {
      name: $('eName').value.trim() || '전시회',
      country: $('eCountry').value.trim(), city: $('eCity').value.trim(),
      startDate: $('eStart').value, endDate: $('eEnd').value, booth: $('eBooth').value.trim(),
    };
    if (id) { Object.assign(e, data); }
    else { const ne = { id: uid(), ...data }; state.events.push(ne); state.currentEventId = ne.id; }
    save(); closeModal(); renderHome(); toast(id ? '전시회 저장됨' : '전시회 추가됨');
  };
  const del = $('eDelete');
  if (del) del.onclick = () => {
    if (!confirm('이 전시회를 삭제할까요? 소속 상담 기록도 함께 삭제됩니다.')) return;
    state.consultations = state.consultations.filter(c => c.eventId !== id);
    delete state.narratives[id];
    state.events = state.events.filter(x => x.id !== id);
    state.currentEventId = state.events[0].id;
    save(); closeModal(); renderHome(); toast('삭제됨');
  };
}

// ─────────────────────────── 유틸 ───────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url; a.download = `온트랙_백업_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ─────────────────────────── 이벤트 바인딩 ───────────────────────────
function bind() {
  // 홈
  $('btnAdd').onclick = () => openCapture(null);
  $('openSettings').onclick = () => settingsModal();
  $('btnReportLink').onclick = () => { renderReport(); show('viewReport'); };

  // 입력
  chipGroup('fGrade', 'single', () => draft.grade, v => draft.grade = v);
  chipGroup('fTypes', 'multi', () => draft.types, v => draft.types = v);
  chipGroup('fActions', 'multi', () => draft.nextActions, v => draft.nextActions = v);
  chipGroup('fScale', 'single', () => draft.scale, v => draft.scale = v);
  $('capCancel').onclick = () => { renderHome(); show('viewHome'); };
  $('btnSave').onclick = saveConsultation;

  // 확인
  $('cfAgain').onclick = () => openCapture(null);
  $('cfHome').onclick = () => { renderHome(); show('viewHome'); };

  // 보고서
  $('repBack').onclick = () => { renderHome(); show('viewHome'); };
  $('rNarrative').addEventListener('input', (e) => {
    state.narratives[currentEvent().id] = e.target.value; save();
    buildReportDoc(); // 문서 미리보기만 갱신(textarea는 건드리지 않음 → 커서 유지)
  });
  $('btnExport').onclick = () => { renderReport(); setTimeout(() => window.print(), 60); };

  // 모달
  $('modalBg').addEventListener('click', (e) => { if (e.target === $('modalBg')) closeModal(); });

  // 온라인/오프라인 뱃지 (표시용 — 슬라이스1은 로컬 전용)
  const badge = () => {
    const b = $('syncBadge'), t = $('syncText');
    b.classList.toggle('local', !navigator.onLine);
    t.textContent = navigator.onLine ? '로컬 저장' : '오프라인';
  };
  window.addEventListener('online', badge); window.addEventListener('offline', badge); badge();
}

// ─────────────────────────── 시작 ───────────────────────────
load();
bind();
renderHome();
show('viewHome');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
