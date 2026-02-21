const API_URL = "/api/jobs";

const BOOKMARK_KEY = "jobs-app:bookmarks:v4";
const UI_STATE_KEY = "jobs-app:ui-state:v4";
const RECENT_SEARCH_KEY = "jobs-app:recent-searches:v1";
const SNAPSHOT_KEY = "jobs-app:last-snapshot:v3";

let jobsAll = [];
let jobsView = [];
let viewMode = "all"; // all | bookmarks
let modalJob = null;
let bookmarks = loadBookmarks();

let swReg = null;
let swUpdateReady = false;

// ------------------ storage helpers ------------------
function safeJsonParse(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }
function loadBookmarks() {
  const obj = safeJsonParse(localStorage.getItem(BOOKMARK_KEY) || "{}", {});
  return obj && typeof obj === "object" ? obj : {};
}
function saveBookmarks(obj) { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(obj)); }

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

// ------------------ utils ------------------
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getJobKey(job) {
  const title = job.recrutPbancTtl || "";
  const company = job.instNm || "";
  const url = job.srcUrl || "";
  const region = Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(", ") : (job.workRgnNmLst || "");
  const hireType = Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(", ") : (job.hireTypeNmLst || "");
  return url || `${company}__${title}__${region}__${hireType}`;
}

function parseYmd(v) {
  const digits = String(v ?? "").trim().replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  return new Date(y, m - 1, d).getTime();
}
function formatYmd(v) {
  const t = parseYmd(v);
  if (t == null) return "";
  const dt = new Date(t);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function daysUntil(ymd) {
  const t = parseYmd(ymd);
  if (t == null) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor((t - today) / (24 * 3600 * 1000));
}

function parseQueryTokens(raw) {
  const tokens = String(raw || "").trim().split(/\s+/).filter(Boolean);
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

function dedupeJobs(list) {
  const map = new Map();
  for (const j of list) {
    const key = getJobKey(j);
    if (!map.has(key)) map.set(key, j);
  }
  return Array.from(map.values());
}

function setLastUpdated(ts = Date.now()) {
  const el = document.getElementById("lastUpdated");
  if (!el) return;
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  el.textContent = `업데이트: ${hh}:${mm}`;
}

// ------------------ toast ------------------
function toast(message, { actionText = null, onAction = null, duration = 2200 } = {}) {
  const host = document.getElementById("toastHost");
  if (!host) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;

  let timer = null;

  if (actionText && typeof onAction === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = actionText;
    btn.addEventListener("click", () => {
      clearTimeout(timer);
      el.remove();
      onAction();
    });
    el.appendChild(btn);
  }

  host.appendChild(el);

  timer = setTimeout(() => {
    el.remove();
  }, duration);
}

// ------------------ UI helpers ------------------
function renderRecentSearches() {
  const el = document.getElementById("recentSearches");
  if (!el) return;
  const arr = loadRecentSearches();
  el.innerHTML = arr.map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
}

function setView(v) {
  viewMode = v;
  const tabAll = document.getElementById("tabAll");
  const tabBm = document.getElementById("tabBookmarks");
  tabAll?.classList.toggle("is-active", v === "all");
  tabBm?.classList.toggle("is-active", v === "bookmarks");
}

function getUiSnapshot() {
  const q = (document.getElementById("search")?.value || "").trim();
  const sort = document.getElementById("sortFilter")?.value || "default";
  const regions = Array.from(document.querySelectorAll(`input[type="checkbox"][name="region"]:checked`)).map(n => n.value);
  const types = Array.from(document.querySelectorAll(`input[type="checkbox"][name="type"]:checked`)).map(n => n.value);
  const onlyOpen = !!document.getElementById("onlyOpen")?.checked;
  const due7 = !!document.getElementById("due7")?.checked;
  const onlyToday = !!document.getElementById("onlyToday")?.checked;
  return { q, sort, regions, types, onlyOpen, due7, onlyToday, view: viewMode };
}

function updateCount(showing, total) {
  const el = document.getElementById("showing-line");
  if (!el) return;
  const bmCount = Object.keys(bookmarks).length;
  el.innerHTML = `<b>Showing:</b> ${showing} / <b>Total:</b> ${total} <span style="margin-left:10px;color:#666;">북마크: <b>${bmCount}</b></span>`;
}

function renderActiveChips(state) {
  const chips = document.getElementById("activeChips");
  if (!chips) return;

  const items = [];
  const setSearch = (v) => { const el = document.getElementById("search"); if (el) el.value = v; };
  const setCheckbox = (name, value, checked) => {
    document.querySelectorAll(`input[type="checkbox"][name="${name}"]`).forEach(n => {
      if (n.value === value) n.checked = checked;
    });
  };

  if (state.q) items.push({ label: `검색: ${state.q}`, clear: () => setSearch("") });
  for (const r of state.regions) items.push({ label: `지역: ${r}`, clear: () => setCheckbox("region", r, false) });
  for (const t of state.types) items.push({ label: `고용: ${t}`, clear: () => setCheckbox("type", t, false) });
  if (state.onlyOpen) items.push({ label: "마감 제외", clear: () => (document.getElementById("onlyOpen").checked = false) });
  if (state.due7) items.push({ label: "7일 이내", clear: () => (document.getElementById("due7").checked = false) });
  if (state.onlyToday) items.push({ label: "오늘만", clear: () => (document.getElementById("onlyToday").checked = false) });
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
    applyFiltersAndRender();
  };
}

// ------------------ rendering ------------------
function makeCard(job, q) {
  const key = getJobKey(job);
  const bm = bookmarks[key];
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
  const star = isBm ? "★" : "☆";
  const aria = isBm ? "북마크 해제" : "북마크 추가";

  const el = document.createElement("div");
  el.className = "job-card";
  el.dataset.key = key;
  el.tabIndex = 0;
  el.setAttribute("role", "article");

  el.innerHTML = `
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
        type="button"
        data-action="toggle-bookmark"
        data-key="${escapeHtml(key)}"
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
  return el;
}

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

function renderList(list, q) {
  const grid = document.getElementById("jobs-grid");
  if (!grid) return;
  const frag = document.createDocumentFragment();
  for (const job of list) frag.appendChild(makeCard(job, q));
  grid.innerHTML = "";
  grid.appendChild(frag);
  updateCount(list.length, list.length);
}

// ------------------ filtering ------------------
function scoreJob(job, includeTokens, excludeTokens) {
  const blob = job.__searchText || "";
  for (const x of excludeTokens) if (x && blob.includes(x)) return -999999;
  if (!includeTokens.length) return 0;

  const title = (job.recrutPbancTtl || "").toLowerCase();
  const inst = (job.instNm || "").toLowerCase();
  const region = (Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(" ") : String(job.workRgnNmLst || "")).toLowerCase();
  const type = (Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(" ") : String(job.hireTypeNmLst || "")).toLowerCase();

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

function applyFiltersAndRender() {
  const state = getUiSnapshot();
  const rawQ = state.q.toLowerCase();

  let list = jobsAll.slice();

  if (state.view === "bookmarks") {
    const keys = new Set(Object.keys(bookmarks));
    list = list.filter(j => keys.has(getJobKey(j)));
  }

  if (state.regions.length) {
    const needles = state.regions.map(x => x.toLowerCase());
    list = list.filter(job => {
      const text = (Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(" ") : String(job.workRgnNmLst || "")).toLowerCase();
      return needles.some(n => text.includes(n));
    });
  }

  if (state.types.length) {
    const needles = state.types.map(x => x.toLowerCase());
    list = list.filter(job => {
      const text = (Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(" ") : String(job.hireTypeNmLst || "")).toLowerCase();
      return needles.some(n => text.includes(n));
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
    const { includeTokens, excludeTokens } = parseQueryTokens(rawQ);
    const scored = [];
    for (const job of list) {
      const s = scoreJob(job, includeTokens, excludeTokens);
      if (s > -999000) scored.push({ job, s });
    }
    scored.sort((a, b) => b.s - a.s);
    list = scored.map(x => x.job);
    saveRecentSearch(state.q);
  }

  if (state.sort === "deadline") {
    list.sort((a, b) => (parseYmd(a.pbancEndYmd) ?? 9e15) - (parseYmd(b.pbancEndYmd) ?? 9e15));
  } else if (state.sort === "latest") {
    list.sort((a, b) => (parseYmd(b.pbancBgngYmd) ?? 0) - (parseYmd(a.pbancBgngYmd) ?? 0));
  }

  jobsView = list;

  renderActiveChips(state);
  renderRecentSearches();
  renderList(jobsView, state.q);
  saveUiState();
}

// ------------------ bookmarks ------------------
function toggleBookmark(job) {
  const key = getJobKey(job);
  const existed = !!bookmarks[key];

  if (existed) delete bookmarks[key];
  else bookmarks[key] = { savedAt: Date.now(), tags: [], note: "" };

  saveBookmarks(bookmarks);
  applyFiltersAndRender();

  toast(existed ? "북마크 해제됨" : "북마크 추가됨");
  if (modalJob && getJobKey(modalJob) === key) openModal(modalJob);
}

function saveBookmarkMeta(job, tags, note) {
  const key = getJobKey(job);
  if (!bookmarks[key]) bookmarks[key] = { savedAt: Date.now(), tags: [], note: "" };
  bookmarks[key].tags = tags;
  bookmarks[key].note = note;
  saveBookmarks(bookmarks);
  applyFiltersAndRender();
  toast("저장됨 ✅");
  if (modalJob && getJobKey(modalJob) === key) openModal(modalJob);
}

// ------------------ modal ------------------
function openModal(job) {
  modalJob = job;

  const backdrop = document.getElementById("modalBackdrop");
  const modal = document.getElementById("jobModal");
  const body = document.getElementById("modalBody");
  const titleEl = document.getElementById("modalTitle");
  if (!backdrop || !modal || !body || !titleEl) return;

  const key = getJobKey(job);
  const bm = bookmarks[key];
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
  document.getElementById("btnCloseModal")?.focus();
}

function closeModal() {
  document.getElementById("modalBackdrop")?.setAttribute("hidden", "");
  document.getElementById("jobModal")?.setAttribute("hidden", "");
  modalJob = null;
}

// ------------------ UI state ------------------
function saveUiState() {
  const wrapper = document.getElementById("list-wrapper");
  const payload = { ...getUiSnapshot(), scrollTop: wrapper ? wrapper.scrollTop : 0 };
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload));
}

function restoreUiState() {
  const raw = localStorage.getItem(UI_STATE_KEY);
  if (!raw) return false;
  const st = safeJsonParse(raw, null);
  if (!st || typeof st !== "object") return false;

  setView(st.view === "bookmarks" ? "bookmarks" : "all");

  const search = document.getElementById("search");
  if (search) search.value = st.q || "";

  const sortEl = document.getElementById("sortFilter");
  if (sortEl) sortEl.value = st.sort || "default";

  document.querySelectorAll(`input[type="checkbox"][name="region"]`).forEach(n => n.checked = (st.regions || []).includes(n.value));
  document.querySelectorAll(`input[type="checkbox"][name="type"]`).forEach(n => n.checked = (st.types || []).includes(n.value));

  document.getElementById("onlyOpen").checked = !!st.onlyOpen;
  document.getElementById("due7").checked = !!st.due7;
  document.getElementById("onlyToday").checked = !!st.onlyToday;

  applyFiltersAndRender();

  const wrapper = document.getElementById("list-wrapper");
  if (wrapper && Number.isFinite(st.scrollTop)) wrapper.scrollTop = st.scrollTop;

  return true;
}

// ------------------ NEW badge ------------------
function updateNewBadge(list) {
  const badge = document.getElementById("newBadge");
  if (!badge) return;

  const prev = safeJsonParse(localStorage.getItem(SNAPSHOT_KEY) || "null", null);
  const keys = list.map(getJobKey);

  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ keys: keys.slice(0, 200), at: Date.now() }));

  if (!prev?.keys?.length) { badge.hidden = true; return; }

  const prevSet = new Set(prev.keys);
  const newCount = keys.slice(0, 200).filter(k => !prevSet.has(k)).length;

  badge.hidden = newCount === 0;
  if (!badge.hidden) badge.textContent = `NEW ${newCount}`;
}

// ------------------ SW update banner ------------------
function showUpdateBanner() {
  const banner = document.getElementById("updateBanner");
  if (!banner) return;
  banner.hidden = false;
}
function hideUpdateBanner() {
  const banner = document.getElementById("updateBanner");
  if (!banner) return;
  banner.hidden = true;
}

// ------------------ Service Worker (사용) ------------------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;

  try {
    swReg = await navigator.serviceWorker.register("./sw.js");

    // 업데이트 체크(브라우저에 따라 필요)
    swReg.update?.();

    // 이미 waiting 있으면 즉시 배너
    if (swReg.waiting) {
      swUpdateReady = true;
      showUpdateBanner();
    }

    swReg.addEventListener("updatefound", () => {
      const sw = swReg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          swUpdateReady = true;
          showUpdateBanner();
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  } catch (e) {
    console.warn("SW register failed:", e);
  }
}

// ------------------ fetch jobs ------------------
async function loadJobs({ silent = false } = {}) {
  if (!silent) showSkeleton(6);

  const res = await fetch(API_URL, { cache: "no-store" });
  const payload = await res.json();
  if (!payload?.ok) throw new Error("API ok:false");

  const raw = payload?.data?.result ?? [];
  const jobs = dedupeJobs(Array.isArray(raw) ? raw : []);

  jobsAll = jobs.map(j => ({ ...j, __searchText: JSON.stringify(j).toLowerCase() }));
  updateNewBadge(jobsAll);
  setLastUpdated(Date.now());
}

// ------------------ wire UI ------------------
function wireUI() {
  // ✅ Filter toggle (PC/모바일 공통, 기본: 모바일 닫힘)
  const btnToggleFilters = document.getElementById("btnToggleFilters");
  const filtersSection = document.querySelector(".filters");

  function setFiltersOpen(open) {
    if (!filtersSection || !btnToggleFilters) return;
    filtersSection.classList.toggle("is-open", open);
    btnToggleFilters.setAttribute("aria-expanded", open ? "true" : "false");
    btnToggleFilters.textContent = open ? "필터 접기" : "필터 펼치기";
  }

  function syncFiltersDefault() {
    const isMobile = window.matchMedia("(max-width: 700px)").matches;
    setFiltersOpen(!isMobile);
  }

  btnToggleFilters?.addEventListener("click", () => {
    const isOpen = filtersSection?.classList.contains("is-open");
    setFiltersOpen(!isOpen);
  });

  window.addEventListener("resize", () => {
    clearTimeout(syncFiltersDefault.__t);
    syncFiltersDefault.__t = setTimeout(syncFiltersDefault, 120);
  });

  syncFiltersDefault();

  // bottom tabs
  document.getElementById("tabAll")?.addEventListener("click", () => { setView("all"); applyFiltersAndRender(); });
  document.getElementById("tabBookmarks")?.addEventListener("click", () => { setView("bookmarks"); applyFiltersAndRender(); });

  // ✅ Reset (capture delegation)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#btnReset");
    if (!btn) return;
    e.preventDefault();

    try {
      localStorage.removeItem(UI_STATE_KEY);
      setView("all");

      const search = document.getElementById("search");
      if (search) { search.value = ""; search.blur(); }

      const sort = document.getElementById("sortFilter");
      if (sort) sort.value = "default";

      document.querySelectorAll(`input[type="checkbox"][name="region"]`).forEach(n => (n.checked = false));
      document.querySelectorAll(`input[type="checkbox"][name="type"]`).forEach(n => (n.checked = false));

      const onlyOpen = document.getElementById("onlyOpen");
      const due7 = document.getElementById("due7");
      const onlyToday = document.getElementById("onlyToday");
      if (onlyOpen) onlyOpen.checked = false;
      if (due7) due7.checked = false;
      if (onlyToday) onlyToday.checked = false;

      closeModal();
      const wrapper = document.getElementById("list-wrapper");
      if (wrapper) wrapper.scrollTop = 0;

      applyFiltersAndRender();
      toast("초기화 완료 ✅");
    } catch (err) {
      console.error("[UI] reset failed:", err);
      toast("초기화 실패");
    }
  }, true);

  // refresh button
  document.getElementById("btnRefresh")?.addEventListener("click", async () => {
    try {
      await loadJobs({ silent: true });
      applyFiltersAndRender();
      toast("업데이트 완료 ✅");
    } catch (e) {
      console.error(e);
      toast("업데이트 실패");
    }
  });

  // filters (debounce)
  let debounce = null;
  const search = document.getElementById("search");
  if (search) {
    search.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => applyFiltersAndRender(), 200);
    });
    search.addEventListener("search", () => applyFiltersAndRender());
  }

  document.getElementById("sortFilter")?.addEventListener("change", () => applyFiltersAndRender());
  document.querySelectorAll(`input[type="checkbox"][name="region"]`).forEach(n => n.addEventListener("change", () => applyFiltersAndRender()));
  document.querySelectorAll(`input[type="checkbox"][name="type"]`).forEach(n => n.addEventListener("change", () => applyFiltersAndRender()));
  document.getElementById("onlyOpen")?.addEventListener("change", () => applyFiltersAndRender());
  document.getElementById("due7")?.addEventListener("change", () => applyFiltersAndRender());
  document.getElementById("onlyToday")?.addEventListener("change", () => applyFiltersAndRender());

  // cards (event delegation 1개)
  const grid = document.getElementById("jobs-grid");
  grid?.addEventListener("click", (e) => {
    const bmBtn = e.target.closest('button[data-action="toggle-bookmark"]');
    if (bmBtn) {
      e.preventDefault();
      e.stopPropagation();
      const key = bmBtn.dataset.key;
      const job = jobsView.find(j => getJobKey(j) === key);
      if (job) toggleBookmark(job);
      return;
    }

    const card = e.target.closest(".job-card");
    if (!card) return;
    const key = card.dataset.key;
    const job = jobsView.find(j => getJobKey(j) === key);
    if (job) openModal(job);
  });

  grid?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest(".job-card");
    if (!card) return;
    const key = card.dataset.key;
    const job = jobsView.find(j => getJobKey(j) === key);
    if (job) openModal(job);
  });

  // modal close
  document.getElementById("btnCloseModal")?.addEventListener("click", (e) => { e.preventDefault(); closeModal(); });
  document.getElementById("modalBackdrop")?.addEventListener("click", () => closeModal());
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // modal actions
  document.getElementById("btnToggleBookmark")?.addEventListener("click", () => {
    if (!modalJob) return;
    toggleBookmark(modalJob);
  });

  document.getElementById("btnSaveBmMeta")?.addEventListener("click", () => {
    if (!modalJob) return;
    const tagsRaw = (document.getElementById("bmTagsInput")?.value || "").trim();
    const note = (document.getElementById("bmNote")?.value || "").trim();
    const tags = tagsRaw ? tagsRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20) : [];
    saveBookmarkMeta(modalJob, tags, note);
  });

  document.getElementById("btnCopy")?.addEventListener("click", async () => {
    if (!modalJob) return;
    const url = modalJob.srcUrl || "";
    if (!url) return toast("복사할 링크가 없어요.");
    try {
      await navigator.clipboard.writeText(url);
      toast("링크 복사됨 ✅");
    } catch {
      toast("복사 실패");
    }
  });

  document.getElementById("btnShare")?.addEventListener("click", async () => {
    if (!modalJob) return;
    const title = modalJob.recrutPbancTtl || "채용 공고";
    const url = modalJob.srcUrl || "";
    try {
      if (navigator.share) await navigator.share({ title, text: title, url });
      else toast("공유 미지원: 복사로 해줘");
    } catch {}
  });

  // update banner buttons
  document.getElementById("btnUpdateNow")?.addEventListener("click", () => {
    if (!swReg) return;
    const waiting = swReg.waiting;
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
      toast("업데이트 적용 중...", { duration: 1600 });
    }
  });

  document.getElementById("btnUpdateDismiss")?.addEventListener("click", () => {
    hideUpdateBanner();
    toast("나중에 업데이트", { duration: 1400 });
  });

  // scroll state
  const wrapper = document.getElementById("list-wrapper");
  let st = null;
  wrapper?.addEventListener("scroll", () => {
    clearTimeout(st);
    st = setTimeout(saveUiState, 150);
  }, { passive: true });

  closeModal();
}

// ------------------ boot ------------------
(async function boot() {
  try {
    renderRecentSearches();
    wireUI();
    await registerSW();

    await loadJobs({ silent: false });

    const restored = restoreUiState();
    if (!restored) applyFiltersAndRender();

    setLastUpdated(Date.now());
    toast("앱 준비 완료 ✅", { duration: 1200 });
  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2><p>콘솔을 확인해줘.</p>";
  }
})();