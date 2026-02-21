const API_URL = "/api/jobs";

let isModalOpen = false;

// =====================
// Storage Keys
// =====================
const BOOKMARK_KEY = "jobs-app:bookmarks:v2"; // v2: meta 포함
const UI_STATE_KEY = "jobs-app:ui-state:v2";
const RECENT_SEARCH_KEY = "jobs-app:recent-searches:v1";
const SNAPSHOT_KEY = "jobs-app:last-snapshot:v1"; // NEW 배지용

// =====================
// Helpers (Storage)
// =====================
function safeJsonParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function loadRecentSearches() {
  const arr = safeJsonParse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]", []);
  return Array.isArray(arr) ? arr.slice(0, 10) : [];
}
function saveRecentSearch(q) {
  const s = String(q || "").trim();
  if (!s) return;
  const arr = loadRecentSearches().filter(x => x !== s);
  arr.unshift(s);
  localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(arr.slice(0, 10)));
}

function loadBookmarks() {
  // v2: { [key]: { savedAt:number, tags:string[], note:string } }
  const obj = safeJsonParse(localStorage.getItem(BOOKMARK_KEY) || "{}", {});
  return obj && typeof obj === "object" ? obj : {};
}
function saveBookmarks(obj) {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(obj));
}

// =====================
// App State
// =====================
let __allJobs = [];
let __currentFiltered = [];
let __currentQuery = "";
let __view = "all"; // all | bookmarks
let __bookmarks = loadBookmarks();

// windowed paging (60 DOM)
const PAGE_SIZE = 20;
const WINDOW_PAGES = 3;
const WINDOW_SIZE = PAGE_SIZE * WINDOW_PAGES;

let __windowStart = 0;
let __windowEnd = 0;

let __io = null;
let __isPaging = false;

// modal
let __modalJob = null;

// =====================
// Utils
// =====================
function getJobKey(job) {
  const title = job.recrutPbancTtl || "";
  const company = job.instNm || "";
  const url = job.srcUrl || "";
  const region = Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(", ") : (job.workRgnNmLst || "");
  const hireType = Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(", ") : (job.hireTypeNmLst || "");
  return url || `${company}__${title}__${region}__${hireType}`;
}

function parseYmd(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  return new Date(y, m - 1, d).getTime();
}

function formatYmd(v) {
  const t = parseYmd(v);
  if (t == null) return "";
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysUntil(ymd) {
  const t = parseYmd(ymd);
  if (t == null) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.floor((t - today) / (24 * 3600 * 1000));
  return diff;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseQueryTokens(raw) {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const includeTokens = [];
  const excludeTokens = [];
  for (const t of tokens) {
    if (t.startsWith("-") && t.length > 1) excludeTokens.push(t.slice(1).toLowerCase());
    else includeTokens.push(t.toLowerCase());
  }
  return { includeTokens, excludeTokens };
}

function highlight(text, q) {
  const s = String(text ?? "");
  const raw = String(q ?? "").trim();
  if (!raw) return escapeHtml(s);

  const { includeTokens } = parseQueryTokens(raw.toLowerCase());
  let out = escapeHtml(s);

  for (const token of includeTokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(${escaped})`, "ig"), "<mark>$1</mark>");
  }
  return out;
}

function updateCount(showing, total) {
  const el = document.getElementById("showing-line");
  if (!el) return;

  const bmCount = Object.keys(__bookmarks).length;
  el.innerHTML =
    `<b>Showing:</b> ${showing} / <b>Total:</b> ${total}` +
    ` <span style="margin-left:10px;color:#666;">북마크: <b>${bmCount}</b></span>`;
}

function outerHeight(el) {
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  const mt = parseFloat(cs.marginTop) || 0;
  const mb = parseFloat(cs.marginBottom) || 0;
  return rect.height + mt + mb;
}

// =====================
// Search Scoring
// =====================
function scoreJob(job, includeTokens, excludeTokens) {
  if (excludeTokens.length) {
    const blob = job.__searchText || "";
    for (const x of excludeTokens) {
      if (x && blob.includes(x)) return -999999;
    }
  }
  if (!includeTokens.length) return 0;

  const title = (job.recrutPbancTtl || "").toLowerCase();
  const inst = (job.instNm || "").toLowerCase();
  const region = (Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(" ") : String(job.workRgnNmLst || "")).toLowerCase();
  const type = (Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(" ") : String(job.hireTypeNmLst || "")).toLowerCase();
  const blob = job.__searchText || "";

  let score = 0;
  for (const t of includeTokens) {
    if (!t) continue;
    if (!blob.includes(t)) return -999999;

    if (title.includes(t)) score += 50;
    else if (inst.includes(t)) score += 25;
    else if (region.includes(t)) score += 12;
    else if (type.includes(t)) score += 10;
    else score += 4;
  }
  return score;
}

// =====================
// Dedup
// =====================
function dedupeJobs(jobs) {
  const map = new Map();
  for (const j of jobs) {
    const key = getJobKey(j);
    if (!map.has(key)) map.set(key, j);
  }
  return Array.from(map.values());
}

// =====================
// UI: Recent searches datalist
// =====================
function renderRecentSearches() {
  const el = document.getElementById("recentSearches");
  if (!el) return;
  const arr = loadRecentSearches();
  el.innerHTML = arr.map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
}

// =====================
// UI: Tabs
// =====================
function setView(view) {
  __view = view;
  const tabAll = document.getElementById("tabAll");
  const tabBm = document.getElementById("tabBookmarks");
  if (tabAll && tabBm) {
    tabAll.classList.toggle("is-active", view === "all");
    tabBm.classList.toggle("is-active", view === "bookmarks");
  }
  applyFilters(true);
}

// =====================
// UI: Checkbox helpers
// =====================
function getCheckedValues(name) {
  const nodes = document.querySelectorAll(`input[type="checkbox"][name="${name}"]`);
  return Array.from(nodes).filter(n => n.checked).map(n => n.value);
}
function setCheckbox(name, value, checked) {
  const nodes = document.querySelectorAll(`input[type="checkbox"][name="${name}"]`);
  for (const n of nodes) if (n.value === value) n.checked = checked;
}
function setSearch(v) {
  const el = document.getElementById("search");
  if (el) el.value = v;
}

// =====================
// UI: Active filter chips
// =====================
function renderActiveChips(state) {
  const chips = document.getElementById("activeChips");
  if (!chips) return;

  const items = [];

  if (state.q) items.push({ label: `검색: ${state.q}`, clear: () => { setSearch(""); } });

  for (const r of state.regions) items.push({ label: `지역: ${r}`, clear: () => { setCheckbox("region", r, false); } });
  for (const t of state.types) items.push({ label: `고용: ${t}`, clear: () => { setCheckbox("type", t, false); } });

  if (state.onlyOpen) items.push({ label: "마감 제외", clear: () => { document.getElementById("onlyOpen").checked = false; } });
  if (state.due7) items.push({ label: "7일 이내", clear: () => { document.getElementById("due7").checked = false; } });
  if (state.onlyToday) items.push({ label: "오늘만", clear: () => { document.getElementById("onlyToday").checked = false; } });

  if (state.view === "bookmarks") items.push({ label: "북마크 보기", clear: () => setView("all") });

  chips.innerHTML = items.map((it, idx) => `
    <span class="chip">
      ${escapeHtml(it.label)}
      <button type="button" aria-label="필터 제거" data-chip="${idx}">✕</button>
    </span>
  `).join("");

  chips.onclick = (e) => {
    const btn = e.target.closest("button[data-chip]");
    if (!btn) return;
    const idx = Number(btn.dataset.chip);
    if (!Number.isFinite(idx)) return;
    items[idx]?.clear?.();
    applyFilters(true);
  };
}

// =====================
// Card Builder
// =====================
function makeCard(job, q) {
  const key = getJobKey(job);
  const bm = __bookmarks[key];
  const isBm = !!bm;

  const title = job.recrutPbancTtl || "제목 없음";
  const company = job.instNm || "";
  const url = job.srcUrl || "";
  const region = Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(", ") : (job.workRgnNmLst || "");
  const hireType = Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(", ") : (job.hireTypeNmLst || "");
  const recruitType = job.recrutSeNm || "";
  const dday = daysUntil(job.pbancEndYmd);
  const dText = (dday == null) ? "" : (dday < 0 ? "마감" : (dday === 0 ? "D-day" : `D-${dday}`));

  const tags = (bm?.tags || []).slice(0, 3);

  const card = document.createElement("div");
  card.className = "job-card";
  card.dataset.key = key;
  card.tabIndex = 0;
  card.setAttribute("role", "article");
  card.setAttribute("aria-label", `${title} 상세보기`);

  const star = isBm ? "★" : "☆";
  const aria = isBm ? "북마크 해제" : "북마크 추가";

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
      <div style="flex:1;min-width:0;">
        <h3 style="margin:0;line-height:1.3;">${highlight(title, q)}</h3>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;">
          ${recruitType ? `<span class="pill">${escapeHtml(recruitType)}</span>` : ""}
          ${hireType ? `<span class="pill">${escapeHtml(hireType)}</span>` : ""}
          ${region ? `<span class="pill">${escapeHtml(region)}</span>` : ""}
          ${dText ? `<span class="pill">${escapeHtml(dText)}</span>` : ""}
        </div>
      </div>

      <button
        class="bm-btn"
        data-bm="${escapeHtml(key)}"
        aria-pressed="${isBm ? "true" : "false"}"
        aria-label="${escapeHtml(aria)}"
        title="${escapeHtml(aria)}"
      >${star}</button>
    </div>

    <p style="margin:10px 0 0 0;"><b>${highlight(company, q)}</b></p>
    <p>${escapeHtml(formatYmd(job.pbancBgngYmd))}${job.pbancEndYmd ? ` ~ ${escapeHtml(formatYmd(job.pbancEndYmd))}` : ""}</p>

    ${tags.length ? `
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;">
        ${tags.map(t => `<span class="badge">${escapeHtml(t)}</span>`).join("")}
      </div>` : ""}

    ${url ? `<p style="margin-top:10px;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">공고 링크</a></p>` : ""}
  `;

  return card;
}

// =====================
// Skeleton
// =====================
function showSkeleton(n = 6) {
  const grid = document.getElementById("jobs-grid");
  if (!grid) return;
  grid.innerHTML = Array.from({ length: n }).map(() => `
    <div class="skel">
      <div class="skel-line" style="width:70%"></div>
      <div class="skel-line" style="width:45%"></div>
      <div class="skel-line" style="width:90%"></div>
      <div class="skel-line" style="width:55%"></div>
    </div>
  `).join("");
  updateCount(n, n);
}

// =====================
// Windowed Render + Paging
// =====================
function renderWindow({ reset = false, scrollAdjust = 0 } = {}) {
  const grid = document.getElementById("jobs-grid");
  const wrapper = document.getElementById("list-wrapper");
  if (!grid || !wrapper) return;

  const total = __currentFiltered.length;

  const frag = document.createDocumentFragment();
  for (let i = __windowStart; i < __windowEnd; i++) {
    frag.appendChild(makeCard(__currentFiltered[i], __currentQuery));
  }
  grid.innerHTML = "";
  grid.appendChild(frag);

  if (reset) wrapper.scrollTop = 0;
  if (scrollAdjust) wrapper.scrollTop += scrollAdjust;

  updateCount(grid.children.length, total);

  saveUiState();
}

function sumTopHeights(n) {
  const grid = document.getElementById("jobs-grid");
  if (!grid) return 0;
  let sum = 0;
  for (let i = 0; i < n && i < grid.children.length; i++) sum += outerHeight(grid.children[i]);
  return sum;
}

function canShiftForward() { return __windowEnd < __currentFiltered.length; }
function canShiftBackward() { return __windowStart > 0; }

function shiftForward() {
  if (!canShiftForward()) return;

  const oldStart = __windowStart;
  const oldEnd = __windowEnd;

  const total = __currentFiltered.length;
  const newEnd = Math.min(total, oldEnd + PAGE_SIZE);
  const newStart = Math.max(0, newEnd - WINDOW_SIZE);

  const removedCount = Math.max(0, newStart - oldStart);
  const removedHeight = sumTopHeights(removedCount);

  __windowStart = newStart;
  __windowEnd = newEnd;

  renderWindow({ reset: false, scrollAdjust: -removedHeight });
}

function shiftBackward() {
  if (!canShiftBackward()) return;

  const oldStart = __windowStart;
  const oldEnd = __windowEnd;
  const total = __currentFiltered.length;

  const newEnd = Math.max(PAGE_SIZE, oldEnd - PAGE_SIZE);
  const newStart = Math.max(0, newEnd - WINDOW_SIZE);
  const addedCount = Math.max(0, oldStart - newStart);

  __windowStart = newStart;
  __windowEnd = Math.min(total, newEnd);

  renderWindow({ reset: false, scrollAdjust: 0 });

  // 새로 위에 추가된 만큼 scroll 유지
  const addedHeight = sumTopHeights(addedCount);
  const wrapper = document.getElementById("list-wrapper");
  if (wrapper) wrapper.scrollTop += addedHeight;
}

function setupIntersectionPaging() {
  const wrapper = document.getElementById("list-wrapper");
  const topSentinel = document.getElementById("sentinel-top");
  const bottomSentinel = document.getElementById("sentinel-bottom");
  if (!wrapper || !topSentinel || !bottomSentinel) return;

  if (__io) __io.disconnect();

  __io = new IntersectionObserver((entries) => {
    if (__isPaging) return;

    const topHit = entries.some(e => e.target === topSentinel && e.isIntersecting);
    const bottomHit = entries.some(e => e.target === bottomSentinel && e.isIntersecting);

    if (bottomHit && canShiftForward()) {
      __isPaging = true;
      shiftForward();
      __isPaging = false;
      return;
    }

    if (topHit && canShiftBackward()) {
      __isPaging = true;
      shiftBackward();
      __isPaging = false;
    }
  }, {
    root: wrapper,
    rootMargin: "260px 0px",
    threshold: 0
  });

  __io.observe(topSentinel);
  __io.observe(bottomSentinel);
}

// =====================
// Bookmarks
// =====================
function toggleBookmark(job) {
  const key = getJobKey(job);
  const exists = !!__bookmarks[key];

  if (exists) delete __bookmarks[key];
  else __bookmarks[key] = { savedAt: Date.now(), tags: [], note: "" };

  saveBookmarks(__bookmarks);

  renderWindow({ reset: false, scrollAdjust: 0 });

  // 모달 열려있으면 버튼/입력 상태 갱신
  if (__modalJob) openModal(__modalJob);
}

function updateBookmarkMeta(job, { tags, note }) {
  const key = getJobKey(job);
  if (!__bookmarks[key]) __bookmarks[key] = { savedAt: Date.now(), tags: [], note: "" };
  __bookmarks[key].tags = tags;
  __bookmarks[key].note = note;
  saveBookmarks(__bookmarks);
  renderWindow({ reset: false, scrollAdjust: 0 });
  if (__modalJob) openModal(__modalJob);
}

// =====================
// Modal (✅ 닫힘 버그 해결 포함)
// =====================
function openModal(job) {
  if (isModalOpen) return;
  isModalOpen = true;

  __modalJob = job;

  const backdrop = document.getElementById("modalBackdrop");
  const modal = document.getElementById("jobModal");
  const body = document.getElementById("modalBody");
  const titleEl = document.getElementById("modalTitle");

  if (!backdrop || !modal || !body || !titleEl) return;

  const key = getJobKey(job);
  const bm = __bookmarks[key];
  const isBm = !!bm;

  const title = job.recrutPbancTtl || "제목 없음";
  const company = job.instNm || "";
  const url = job.srcUrl || "";
  const region = Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(", ") : (job.workRgnNmLst || "");
  const hireType = Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(", ") : (job.hireTypeNmLst || "");
  const recruitType = job.recrutSeNm || "";
  const start = formatYmd(job.pbancBgngYmd);
  const end = formatYmd(job.pbancEndYmd);
  const dday = daysUntil(job.pbancEndYmd);
  const dText = (dday == null) ? "" : (dday < 0 ? "마감" : (dday === 0 ? "D-day" : `D-${dday}`));

  titleEl.textContent = title;

  body.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
      ${recruitType ? `<span class="pill">${escapeHtml(recruitType)}</span>` : ""}
      ${hireType ? `<span class="pill">${escapeHtml(hireType)}</span>` : ""}
      ${region ? `<span class="pill">${escapeHtml(region)}</span>` : ""}
      ${dText ? `<span class="pill">${escapeHtml(dText)}</span>` : ""}
    </div>

    <div style="display:grid;gap:8px;">
      <div><b>기관</b>: ${escapeHtml(company)}</div>
      <div><b>기간</b>: ${escapeHtml(start)}${end ? ` ~ ${escapeHtml(end)}` : ""}</div>
      ${url ? `<div><b>링크</b>: <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></div>` : `<div><b>링크</b>: 없음</div>`}
    </div>

    ${bm?.note ? `<div style="margin-top:14px;"><b>메모</b><div style="margin-top:6px;color:#64748b">${escapeHtml(bm.note).replaceAll("\n","<br>")}</div></div>` : ""}
  `;

  const tagsInput = document.getElementById("bmTagsInput");
  const noteInput = document.getElementById("bmNote");
  if (tagsInput) tagsInput.value = (bm?.tags || []).join(",");
  if (noteInput) noteInput.value = bm?.note || "";

  const btnToggle = document.getElementById("btnToggleBookmark");
  if (btnToggle) btnToggle.textContent = isBm ? "북마크 해제" : "북마크 추가";

  backdrop.hidden = false;
  modal.hidden = false;

  // focus
  document.getElementById("btnCloseModal")?.focus();
}

function closeModal() {
  const backdrop = document.getElementById("modalBackdrop");
  const modal = document.getElementById("jobModal");
  if (backdrop) backdrop.hidden = true;
  if (modal) modal.hidden = true;
  __modalJob = null;
  setTimeout(() => { isModalOpen = false; }, 0);
}

// =====================
// Filters + Sort + View
// =====================
function getUiSnapshot() {
  const q = (document.getElementById("search")?.value || "").trim();
  const sort = document.getElementById("sortFilter")?.value || "default";
  const regions = getCheckedValues("region");
  const types = getCheckedValues("type");
  const onlyOpen = !!document.getElementById("onlyOpen")?.checked;
  const due7 = !!document.getElementById("due7")?.checked;
  const onlyToday = !!document.getElementById("onlyToday")?.checked;
  const view = __view;
  return { q, sort, regions, types, onlyOpen, due7, onlyToday, view };
}

function applyFilters(reset = true) {
  const state = getUiSnapshot();

  const rawQ = state.q.toLowerCase();
  const { includeTokens, excludeTokens } = parseQueryTokens(rawQ);

  let list = __allJobs;

  if (state.view === "bookmarks") {
    const keys = new Set(Object.keys(__bookmarks));
    list = list.filter(j => keys.has(getJobKey(j)));
  }

  if (state.regions.length) {
    const needles = state.regions.map(x => x.toLowerCase());
    list = list.filter(job => {
      const regionText = (Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(" ") : String(job.workRgnNmLst || "")).toLowerCase();
      return needles.some(n => regionText.includes(n));
    });
  }

  if (state.types.length) {
    const needles = state.types.map(x => x.toLowerCase());
    list = list.filter(job => {
      const typeText = (Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(" ") : String(job.hireTypeNmLst || "")).toLowerCase();
      return needles.some(n => typeText.includes(n));
    });
  }

  if (state.onlyOpen) {
    list = list.filter(job => {
      const d = daysUntil(job.pbancEndYmd);
      return d == null ? true : d >= 0;
    });
  }

  if (state.due7) {
    list = list.filter(job => {
      const d = daysUntil(job.pbancEndYmd);
      return d != null && d >= 0 && d <= 7;
    });
  }

  if (state.onlyToday) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    list = list.filter(job => parseYmd(job.pbancBgngYmd) === today);
  }

  if (rawQ) {
    const scored = [];
    for (const job of list) {
      const s = scoreJob(job, includeTokens, excludeTokens);
      if (s > -999000) scored.push({ job, s });
    }
    scored.sort((a, b) => b.s - a.s);
    list = scored.map(x => x.job);
  }

  if (state.sort === "deadline") {
    list.sort((a, b) => {
      const ta = parseYmd(a.pbancEndYmd);
      const tb = parseYmd(b.pbancEndYmd);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    });
  } else if (state.sort === "latest") {
    list.sort((a, b) => {
      const ta = parseYmd(a.pbancBgngYmd);
      const tb = parseYmd(b.pbancBgngYmd);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return tb - ta;
    });
  }

  __currentFiltered = list;
  __currentQuery = state.q;

  renderActiveChips(state);

  if (reset) {
    __windowStart = 0;
    __windowEnd = Math.min(WINDOW_SIZE, __currentFiltered.length);
  } else {
    __windowStart = Math.max(0, Math.min(__windowStart, Math.max(0, __currentFiltered.length - 1)));
    __windowEnd = Math.max(__windowStart, Math.min(__windowStart + WINDOW_SIZE, __currentFiltered.length));
  }

  renderWindow({ reset: reset, scrollAdjust: 0 });
  setupIntersectionPaging();

  if (state.q) saveRecentSearch(state.q);
  renderRecentSearches();
}

// =====================
// UI State save/restore
// =====================
function saveUiState() {
  const wrapper = document.getElementById("list-wrapper");
  const state = getUiSnapshot();
  const payload = {
    ...state,
    windowStart: __windowStart,
    windowEnd: __windowEnd,
    scrollTop: wrapper ? wrapper.scrollTop : 0
  };
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload));
}

function restoreUiState() {
  const raw = localStorage.getItem(UI_STATE_KEY);
  if (!raw) return false;

  const st = safeJsonParse(raw, null);
  if (!st || typeof st !== "object") return false;

  setView(st.view === "bookmarks" ? "bookmarks" : "all");

  setSearch(st.q || "");
  const sortEl = document.getElementById("sortFilter");
  if (sortEl && st.sort) sortEl.value = st.sort;

  document.querySelectorAll(`input[type="checkbox"][name="region"]`).forEach(n => n.checked = (st.regions || []).includes(n.value));
  document.querySelectorAll(`input[type="checkbox"][name="type"]`).forEach(n => n.checked = (st.types || []).includes(n.value));

  const onlyOpen = document.getElementById("onlyOpen");
  const due7 = document.getElementById("due7");
  const onlyToday = document.getElementById("onlyToday");
  if (onlyOpen) onlyOpen.checked = !!st.onlyOpen;
  if (due7) due7.checked = !!st.due7;
  if (onlyToday) onlyToday.checked = !!st.onlyToday;

  applyFilters(true);

  if (Number.isFinite(st.windowStart) && Number.isFinite(st.windowEnd)) {
    __windowStart = Math.max(0, Math.min(st.windowStart, __currentFiltered.length));
    __windowEnd = Math.max(__windowStart, Math.min(st.windowEnd, __currentFiltered.length));
    renderWindow({ reset: true, scrollAdjust: 0 });
  }

  const wrapper = document.getElementById("list-wrapper");
  if (wrapper && Number.isFinite(st.scrollTop)) wrapper.scrollTop = st.scrollTop;

  return true;
}

function resetAll() {
  localStorage.removeItem(UI_STATE_KEY);
  setView("all");

  setSearch("");
  document.getElementById("sortFilter").value = "default";

  document.querySelectorAll(`input[type="checkbox"][name="region"]`).forEach(n => n.checked = false);
  document.querySelectorAll(`input[type="checkbox"][name="type"]`).forEach(n => n.checked = false);
  document.getElementById("onlyOpen").checked = false;
  document.getElementById("due7").checked = false;
  document.getElementById("onlyToday").checked = false;

  applyFilters(true);
}

// =====================
// NEW badge
// =====================
function updateNewBadge(currentJobs) {
  const badge = document.getElementById("newBadge");
  if (!badge) return;

  const prev = safeJsonParse(localStorage.getItem(SNAPSHOT_KEY) || "null", null);
  const keys = currentJobs.map(getJobKey);

  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ keys: keys.slice(0, 200), at: Date.now() }));

  if (!prev?.keys?.length) {
    badge.hidden = true;
    return;
  }

  const prevSet = new Set(prev.keys);
  const newCount = keys.slice(0, 200).filter(k => !prevSet.has(k)).length;
  badge.hidden = newCount === 0;
  if (!badge.hidden) badge.textContent = `NEW ${newCount}`;
}

// =====================
// Service Worker
// =====================
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (e) {
    console.warn("SW register failed:", e);
  }
}

// =====================
// Wire UI (✅ 모달 닫힘 버그 수정 핵심 포함)
// =====================
function wireUI() {
  // tabs
  document.getElementById("tabAll")?.addEventListener("click", () => setView("all"));
  document.getElementById("tabBookmarks")?.addEventListener("click", () => setView("bookmarks"));

  // reset
  document.getElementById("btnReset")?.addEventListener("click", () => resetAll());

  // filters
  let t = null;
  const search = document.getElementById("search");
  if (search) {
    search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => applyFilters(true), 250);
    });
    search.addEventListener("search", () => applyFilters(true));
  }

  document.getElementById("sortFilter")?.addEventListener("change", () => applyFilters(true));
  document.querySelectorAll(`input[type="checkbox"][name="region"]`).forEach(n => n.addEventListener("change", () => applyFilters(true)));
  document.querySelectorAll(`input[type="checkbox"][name="type"]`).forEach(n => n.addEventListener("change", () => applyFilters(true)));
  document.getElementById("onlyOpen")?.addEventListener("change", () => applyFilters(true));
  document.getElementById("due7")?.addEventListener("change", () => applyFilters(true));
  document.getElementById("onlyToday")?.addEventListener("change", () => applyFilters(true));

  // cards: open modal on click/enter
  const grid = document.getElementById("jobs-grid");
  grid?.addEventListener("click", (e) => {
    // ✅ 모달이 열려있으면 grid 클릭 무시 (뒤로 전파되는 케이스 방지)
    if (__modalJob) return;

    const bmBtn = e.target.closest(".bm-btn");
    if (bmBtn) {
      const key = bmBtn.dataset.bm;
      const job = __currentFiltered.find(j => getJobKey(j) === key);
      if (job) toggleBookmark(job);
      e.stopPropagation();
      return;
    }

    const card = e.target.closest(".job-card");
    if (!card) return;
    const key = card.dataset.key;
    const job = __currentFiltered.find(j => getJobKey(j) === key);
    if (job) openModal(job);
  });

  grid?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (__modalJob) return;
    const card = e.target.closest(".job-card");
    if (!card) return;
    const key = card.dataset.key;
    const job = __currentFiltered.find(j => getJobKey(j) === key);
    if (job) openModal(job);
  });

  // ✅ 모달 자체 클릭은 아래로 전파 차단 (핵심)
  document.getElementById("jobModal")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // modal controls
  document.getElementById("btnCloseModal")?.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeModal();
    },
    true
  );

  document.getElementById("modalBackdrop")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  document.getElementById("btnToggleBookmark")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!__modalJob) return;
    toggleBookmark(__modalJob);
  });

  document.getElementById("btnSaveBmMeta")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!__modalJob) return;
    const tagsRaw = (document.getElementById("bmTagsInput")?.value || "").trim();
    const note = (document.getElementById("bmNote")?.value || "").trim();
    const tags = tagsRaw
      ? tagsRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20)
      : [];
    updateBookmarkMeta(__modalJob, { tags, note });
  });

  document.getElementById("btnCopy")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!__modalJob) return;
    const url = __modalJob.srcUrl || "";
    if (!url) return alert("복사할 링크가 없어요.");
    try {
      await navigator.clipboard.writeText(url);
      alert("링크 복사 완료!");
    } catch {
      prompt("복사:", url);
    }
  });

  document.getElementById("btnShare")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!__modalJob) return;
    const title = __modalJob.recrutPbancTtl || "채용 공고";
    const url = __modalJob.srcUrl || "";
    try {
      if (navigator.share) {
        await navigator.share({ title, text: title, url });
      } else {
        alert("공유 API를 지원하지 않아 링크 복사로 대체해요.");
      }
    } catch {}
  });

  // save state on scroll
  const wrapper = document.getElementById("list-wrapper");
  wrapper?.addEventListener("scroll", () => {
    window.clearTimeout(wireUI.__st);
    wireUI.__st = window.setTimeout(() => saveUiState(), 150);
  }, { passive: true });
}

// =====================
// Load Jobs
// =====================
async function loadJobs() {
  showSkeleton(6);

  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    const payload = await res.json();

    if (!payload.ok) {
      document.body.innerHTML = "<h2>API ok:false</h2>";
      return;
    }

    let jobs = payload.data?.result || [];
    jobs = dedupeJobs(jobs);

    __allJobs = jobs.map(j => ({
      ...j,
      __searchText: JSON.stringify(j).toLowerCase()
    }));

    updateNewBadge(__allJobs);
  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

// =====================
// Boot
// =====================
(async function boot() {
  renderRecentSearches();
  await registerSW();
  wireUI();
  await loadJobs();

  const restored = restoreUiState();
  if (!restored) applyFilters(true);
})();