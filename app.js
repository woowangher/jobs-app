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
// Infinite Scroll State
// =====================
const PAGE_SIZE = 20;
const WINDOW_PAGES = 3; // 최대 60개 유지
let currentPage = 1;

let __currentFiltered = [];
let __currentQuery = "";

let __renderStartIndex = 0;
let __renderEndIndex = 0;

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

// =====================
// Card Builder
// =====================
function makeCard(job, q) {
  const card = document.createElement("div");
  card.style.border = "1px solid #ccc";
  card.style.padding = "12px";
  card.style.margin = "10px 0";
  card.style.borderRadius = "8px";

  const title = job.recrutPbancTtl || "제목 없음";
  const company = job.instNm || "";
  const url = job.srcUrl || "";
  const region = Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(", ") : (job.workRgnNmLst || "");
  const hireType = Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(", ") : (job.hireTypeNmLst || "");
  const recruitType = job.recrutSeNm || "";
  const period = `${job.pbancBgngYmd || ""} ~ ${job.pbancEndYmd || ""}`.trim();

  const key = getJobKey(job);
  const star = bookmarks.has(key) ? "★" : "☆";

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h3 style="margin:0;">${highlight(title, q)}</h3>
      <button class="bm-btn" data-bm="${key}" style="border:0;background:none;font-size:18px;cursor:pointer;">
        ${star}
      </button>
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
// Windowed Render (DOM 최대 60개 유지)
// =====================
function renderWindow(reset = false) {
  const container = document.getElementById("jobs-grid");
  const wrapper = document.getElementById("list-wrapper");
  if (!container) return;

  const total = __currentFiltered.length;
  const loadedCount = Math.min(currentPage * PAGE_SIZE, total);

  const windowSize = PAGE_SIZE * WINDOW_PAGES; // 60개
  const end = loadedCount;
  const start = Math.max(0, end - windowSize);

  if (reset) {
    container.innerHTML = "";
    __renderStartIndex = start;
    __renderEndIndex = start;
  }

  // ✅ 앞쪽 제거 (윈도우 유지) + 스크롤 점프 방지 보정
  while (__renderStartIndex < start && container.firstChild) {
    if (wrapper) {
      const h = container.firstElementChild?.getBoundingClientRect().height ?? 0;
      container.removeChild(container.firstChild);
      wrapper.scrollTop -= h; // ✅ 제거한 만큼 스크롤 보정
    } else {
      container.removeChild(container.firstChild);
    }
    __renderStartIndex++;
  }

  // 뒤쪽 추가
  for (let i = __renderEndIndex; i < end; i++) {
    container.appendChild(makeCard(__currentFiltered[i], __currentQuery));
    __renderEndIndex++;
  }

  // ✅ Showing은 "실제 DOM" 기준 (60 유지면 60으로 보임)
  updateCount(container.children.length, total);
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

    // 북마크만 보기 상태에서 "해제"하면 리스트에서 사라져야 하니까 필터 재적용
    if (onlyBm && !bookmarks.has(key)) {
      applyFilters(true);
      return;
    }

    // 일반 상태는 버튼만 즉시 반영
    btn.textContent = bookmarks.has(key) ? "★" : "☆";

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
function applyFilters(resetPage = true) {
  const input = document.getElementById("search");
  const regionEl = document.getElementById("regionFilter");
  const typeEl = document.getElementById("typeFilter");
  const sortEl = document.getElementById("sortFilter");
  const bmEl = document.getElementById("onlyBookmarked");
  const wrapper = document.getElementById("list-wrapper");

  const q = input?.value.trim().toLowerCase() || "";
  const onlyBm = bmEl?.checked;

  const regionMap = { all: "", seoul: "서울", gyeonggi: "경기" };
  const typeMap = { all: "", regular: "정규", intern: "인턴" };

  const regionNeedle = (regionMap[regionEl?.value ?? "all"] ?? "").toLowerCase();
  const typeNeedle = (typeMap[typeEl?.value ?? "all"] ?? "").toLowerCase();

  let filtered = __allJobs.filter(job => {
    // 검색
    if (q && !JSON.stringify(job).toLowerCase().includes(q)) return false;

    // 지역
    if (regionNeedle) {
      const regionText = Array.isArray(job.workRgnNmLst)
        ? job.workRgnNmLst.join(" ").toLowerCase()
        : String(job.workRgnNmLst ?? "").toLowerCase();
      if (!regionText.includes(regionNeedle)) return false;
    }

    // 고용형태
    if (typeNeedle) {
      const typeText = Array.isArray(job.hireTypeNmLst)
        ? job.hireTypeNmLst.join(" ").toLowerCase()
        : String(job.hireTypeNmLst ?? "").toLowerCase();
      if (!typeText.includes(typeNeedle)) return false;
    }

    return true;
  });

  // 북마크만
  if (onlyBm) {
    filtered = filtered.filter(job => bookmarks.has(getJobKey(job)));
  }

  // 정렬
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

  if (resetPage) currentPage = 1;

  // 필터 바꾸면 리스트 스크롤을 맨 위로
  if (wrapper && resetPage) wrapper.scrollTop = 0;

  renderWindow(true);
}

// =====================
// Wire UI (검색 디바운스 포함)
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
// Infinite Scroll (컨테이너 스크롤 기반)
// =====================
function wireInfiniteScroll() {
  const wrapper = document.getElementById("list-wrapper");
  if (!wrapper) return;

  wrapper.addEventListener("scroll", () => {
    const total = __currentFiltered.length;
    if (!total) return;

    const nearBottom =
      wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight - 150;

    if (!nearBottom) return;
    if (currentPage * PAGE_SIZE >= total) return;

    currentPage++;
    renderWindow(false);
  }, { passive: true });
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
    __allJobs = jobs;

    wireBookmarkClicks();
    wireUI();
    wireInfiniteScroll();

    applyFilters(true);
  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

loadJobs();