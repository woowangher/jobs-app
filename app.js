const API_URL = "/api/jobs";

// =====================
// Bookmark Storage
// =====================
const BOOKMARK_KEY = "jobs-app:bookmarks:v1";

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveBookmarks(set) {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...set]));
}

let bookmarks = loadBookmarks();
let __allJobs = [];

// =====================
// Windowed Paging State
// =====================
const PAGE_SIZE = 20;
const WINDOW_PAGES = 3; // 60개
const WINDOW_SIZE = PAGE_SIZE * WINDOW_PAGES;

let __currentFiltered = [];
let __currentQuery = "";

// 현재 화면에 렌더링된 윈도우 [start, end)
let __windowStart = 0;
let __windowEnd = 0;

// IO + 중복 방지
let __io = null;
let __isPaging = false;

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

function highlight(text, q) {
  const s = String(text ?? "");
  const raw = String(q ?? "").trim();
  if (!raw) return s;

  const tokens = raw.split(/\s+/).filter(t => t.length > 0);
  let out = s;

  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(${escaped})`, "ig"), "<mark>$1</mark>");
  }
  return out;
}

function updateCount(showing, total) {
  const el = document.getElementById("showing-line");
  if (!el) return;
  el.innerHTML =
    `<b>Showing:</b> ${showing} / <b>Total:</b> ${total}` +
    ` <span style="margin-left:10px;color:#666;">북마크: <b>${bookmarks.size}</b></span>`;
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
// Card Builder (A11y 강화)
// =====================
function makeCard(job, q) {
  const card = document.createElement("div");
  card.className = "job-card";
  card.setAttribute("role", "article");

  const title = job.recrutPbancTtl || "제목 없음";
  const company = job.instNm || "";
  const url = job.srcUrl || "";
  const region = Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(", ") : (job.workRgnNmLst || "");
  const hireType = Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(", ") : (job.hireTypeNmLst || "");
  const recruitType = job.recrutSeNm || "";
  const period = `${job.pbancBgngYmd || ""} ~ ${job.pbancEndYmd || ""}`.trim();

  const key = getJobKey(job);
  const isBm = bookmarks.has(key);
  const star = isBm ? "★" : "☆";
  const aria = isBm ? "북마크 해제" : "북마크 추가";

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <h3 style="margin:0;flex:1;">${highlight(title, q)}</h3>
      <button
        class="bm-btn"
        data-bm="${key}"
        aria-pressed="${isBm ? "true" : "false"}"
        aria-label="${aria}"
        title="${aria}"
        style="border:0;background:none;font-size:18px;cursor:pointer;"
      >${star}</button>
    </div>
    <p style="margin:6px 0 0 0;"><b>${highlight(company, q)}</b></p>
    <p style="margin:6px 0 0 0;color:#666;">${highlight(region, q)}</p>
    <p style="margin:6px 0 0 0;color:#666;">
      ${highlight(recruitType, q)}${hireType ? " · " + highlight(hireType, q) : ""}
    </p>
    <p style="margin:6px 0 0 0;color:#666;">${highlight(period, q)}</p>
    ${url ? `<p style="margin-top:8px;"><a href="${url}" target="_blank" rel="noopener noreferrer">공고 링크</a></p>` : ""}
  `;

  return card;
}

// =====================
// Render Window (start/end 기반, 위/아래 이동 지원)
// =====================
function renderWindow({ reset = false, scrollAdjust = 0 } = {}) {
  const container = document.getElementById("jobs-grid");
  const wrapper = document.getElementById("list-wrapper");
  if (!container || !wrapper) return;

  const total = __currentFiltered.length;

  if (reset) {
    wrapper.scrollTop = 0;
  }

  // 렌더
  const frag = document.createDocumentFragment();
  for (let i = __windowStart; i < __windowEnd; i++) {
    frag.appendChild(makeCard(__currentFiltered[i], __currentQuery));
  }
  container.innerHTML = "";
  container.appendChild(frag);

  // 스크롤 보정 (앞에 붙이거나 앞을 제거했을 때 화면 점프 방지)
  if (scrollAdjust !== 0) {
    wrapper.scrollTop += scrollAdjust;
  }

  updateCount(container.children.length, total);
}

// 현재 DOM에서 맨 위에서 n개 높이 합
function sumTopHeights(n) {
  const container = document.getElementById("jobs-grid");
  if (!container) return 0;
  let sum = 0;
  for (let i = 0; i < n && i < container.children.length; i++) {
    sum += outerHeight(container.children[i]);
  }
  return sum;
}

// 새 DOM에서 맨 위에서 n개 높이 합 (render 후)
function sumNewTopHeights(n) {
  const container = document.getElementById("jobs-grid");
  if (!container) return 0;
  let sum = 0;
  for (let i = 0; i < n && i < container.children.length; i++) {
    sum += outerHeight(container.children[i]);
  }
  return sum;
}

function canShiftForward() {
  return __windowEnd < __currentFiltered.length;
}

function canShiftBackward() {
  return __windowStart > 0;
}

// 아래로: 윈도우를 PAGE_SIZE만큼 앞으로
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

// 위로: 윈도우를 PAGE_SIZE만큼 뒤로
function shiftBackward() {
  if (!canShiftBackward()) return;

  const oldStart = __windowStart;
  const oldEnd = __windowEnd;

  const total = __currentFiltered.length;

  // end를 PAGE_SIZE만큼 뒤로 당기되, 최소 0 이상
  const newEnd = Math.max(PAGE_SIZE, oldEnd - PAGE_SIZE);
  const newStart = Math.max(0, newEnd - WINDOW_SIZE);

  const addedCount = Math.max(0, oldStart - newStart);

  __windowStart = newStart;
  __windowEnd = Math.min(total, newEnd);

  // 먼저 렌더하고, 새로 추가된 상단 높이만큼 scrollTop 내려서 “현재 보던 위치 유지”
  renderWindow({ reset: false, scrollAdjust: 0 });
  const addedHeight = sumNewTopHeights(addedCount);

  const wrapper = document.getElementById("list-wrapper");
  if (wrapper) wrapper.scrollTop += addedHeight;
}

// =====================
// Bookmark Click
// =====================
function wireBookmarkClicks() {
  const container = document.getElementById("jobs-grid");
  if (!container) return;

  if (container.dataset.bmBound) return;
  container.dataset.bmBound = "1";

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".bm-btn");
    if (!btn) return;

    const key = btn.dataset.bm;
    if (!key) return;

    const bmEl = document.getElementById("onlyBookmarked");
    const onlyBm = bmEl?.checked;

    if (bookmarks.has(key)) bookmarks.delete(key);
    else bookmarks.add(key);

    saveBookmarks(bookmarks);

    // 북마크만 보기에서 해제하면 목록에서 사라져야 함
    if (onlyBm && !bookmarks.has(key)) {
      applyFilters(true);
      return;
    }

    const isBm = bookmarks.has(key);
    btn.textContent = isBm ? "★" : "☆";
    btn.setAttribute("aria-pressed", isBm ? "true" : "false");
    const aria = isBm ? "북마크 해제" : "북마크 추가";
    btn.setAttribute("aria-label", aria);
    btn.setAttribute("title", aria);

    // 상단 북마크 숫자만 갱신
    const line = document.getElementById("showing-line");
    if (line) {
      line.innerHTML = line.innerHTML.replace(
        /북마크:\s*<b>\d+<\/b>/,
        `북마크: <b>${bookmarks.size}</b>`
      );
    }
  });
}

// =====================
// Filters + Sort
// =====================
function applyFilters(reset = true) {
  const input = document.getElementById("search");
  const regionEl = document.getElementById("regionFilter");
  const typeEl = document.getElementById("typeFilter");
  const sortEl = document.getElementById("sortFilter");
  const bmEl = document.getElementById("onlyBookmarked");

  const q = input?.value.trim().toLowerCase() || "";
  const onlyBm = bmEl?.checked;

  const regionMap = { all: "", seoul: "서울", gyeonggi: "경기" };
  const typeMap = { all: "", regular: "정규", intern: "인턴" };

  const regionNeedle = (regionMap[regionEl?.value ?? "all"] ?? "").toLowerCase();
  const typeNeedle = (typeMap[typeEl?.value ?? "all"] ?? "").toLowerCase();

  let filtered = __allJobs.filter(job => {
    if (q && !job.__searchText?.includes(q)) return false;

    if (regionNeedle) {
      const regionText = Array.isArray(job.workRgnNmLst)
        ? job.workRgnNmLst.join(" ").toLowerCase()
        : String(job.workRgnNmLst ?? "").toLowerCase();
      if (!regionText.includes(regionNeedle)) return false;
    }

    if (typeNeedle) {
      const typeText = Array.isArray(job.hireTypeNmLst)
        ? job.hireTypeNmLst.join(" ").toLowerCase()
        : String(job.hireTypeNmLst ?? "").toLowerCase();
      if (!typeText.includes(typeNeedle)) return false;
    }

    return true;
  });

  if (onlyBm) {
    filtered = filtered.filter(job => bookmarks.has(getJobKey(job)));
  }

  if (sortEl?.value === "deadline") {
    filtered.sort((a, b) => {
      const ta = parseYmd(a.pbancEndYmd);
      const tb = parseYmd(b.pbancEndYmd);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    });
  } else if (sortEl?.value === "latest") {
    filtered.sort((a, b) => {
      const ta = parseYmd(a.pbancBgngYmd);
      const tb = parseYmd(b.pbancBgngYmd);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return tb - ta;
    });
  }

  __currentFiltered = filtered;
  __currentQuery = q;

  // reset 시: 윈도우를 맨 앞에서 최대 60개로
  if (reset) {
    __windowStart = 0;
    __windowEnd = Math.min(WINDOW_SIZE, __currentFiltered.length);
  }

  renderWindow({ reset: reset, scrollAdjust: 0 });

  // 필터 변경 후 IO 다시 세팅
  setupIntersectionPaging();
}

// =====================
// Wire UI
// =====================
function wireUI() {
  const input = document.getElementById("search");
  const regionEl = document.getElementById("regionFilter");
  const typeEl = document.getElementById("typeFilter");
  const sortEl = document.getElementById("sortFilter");
  const bmEl = document.getElementById("onlyBookmarked");

  let t = null;

  if (input) {
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => applyFilters(true), 250);
    });
    input.addEventListener("search", () => applyFilters(true));
  }

  if (regionEl) regionEl.addEventListener("change", () => applyFilters(true));
  if (typeEl) typeEl.addEventListener("change", () => applyFilters(true));
  if (sortEl) sortEl.addEventListener("change", () => applyFilters(true));
  if (bmEl) bmEl.addEventListener("change", () => applyFilters(true));
}

// =====================
// IntersectionObserver Paging (Top/Bottom)
// =====================
function setupIntersectionPaging() {
  const wrapper = document.getElementById("list-wrapper");
  const topSentinel = document.getElementById("sentinel-top");
  const bottomSentinel = document.getElementById("sentinel-bottom");
  if (!wrapper || !topSentinel || !bottomSentinel) return;

  if (__io) __io.disconnect();

  __io = new IntersectionObserver((entries) => {
    if (__isPaging) return;

    // entries는 순서 보장 X → id로 판단
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
      return;
    }
  }, {
    root: wrapper,
    rootMargin: "250px 0px", // 여유 있게 미리 트리거
    threshold: 0
  });

  __io.observe(topSentinel);
  __io.observe(bottomSentinel);
}

// =====================
// Load
// =====================
async function loadJobs() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    const payload = await res.json();

    if (!payload.ok) {
      document.body.innerHTML = "<h2>API ok:false</h2>";
      return;
    }

    const jobs = payload.data?.result || [];

    // ✅ 검색 성능 최적화: 미리 lower-case searchText 만들어둠
    __allJobs = jobs.map(j => ({
      ...j,
      __searchText: JSON.stringify(j).toLowerCase()
    }));

    wireBookmarkClicks();
    wireUI();

    applyFilters(true);
  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

loadJobs();