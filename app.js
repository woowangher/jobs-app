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
// Virtualized Scroll State
// =====================
const PAGE_SIZE = 20;             // 한 번에 더하는 단위
const WINDOW_PAGES = 3;           // 화면에 유지할 페이지 수 (3페이지=60개)
const EST_CARD_HEIGHT = 150;      // 카드 대략 높이(px) - UI 바꾸면 조정
let currentPage = 1;

let __currentFiltered = [];
let __currentQuery = "";

// DOM 윈도우 관리
let __renderStartIndex = 0;       // 현재 DOM에 남겨진 시작 인덱스
let __renderEndIndex = 0;         // 현재 DOM에 남겨진 끝 인덱스(미포함)

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
// Card HTML builder
// =====================
function makeCard(job, q) {
  const card = document.createElement("div");
  card.className = "job-card"; // (styles.css에서 손대기 쉬움)
  card.style.border = "1px solid #ccc";
  card.style.padding = "10px";
  card.style.margin = "10px 0";

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
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <h3 style="margin:0;">${highlight(title, q)}</h3>
      <button class="bm-btn" data-bm="${key}" style="border:0;background:none;font-size:18px;cursor:pointer;">${star}</button>
    </div>
    <p style="margin:6px 0 0 0;"><b>${highlight(company, q)}</b></p>
    <p style="margin:6px 0 0 0;color:#666;">${highlight(region, q)}</p>
    <p style="margin:6px 0 0 0;color:#666;">${highlight(recruitType, q)}${hireType ? " · " + highlight(hireType, q) : ""}</p>
    <p style="margin:6px 0 0 0;color:#666;">${highlight(period, q)}</p>
    ${url ? `<p style="margin:8px 0 0 0;"><a href="${url}" target="_blank" rel="noopener noreferrer">공고 링크</a></p>` : ""}
  `;

  return card;
}

// =====================
// Virtualized Render (keep only WINDOW_PAGES * PAGE_SIZE cards)
// =====================
function renderWindow(reset = false) {
  const container = document.getElementById("jobs-grid");
  if (!container) return;

  // 스페이서가 없으면 만들기
  let topSpacer = document.getElementById("top-spacer");
  let bottomSpacer = document.getElementById("bottom-spacer");
  if (!topSpacer) {
    topSpacer = document.createElement("div");
    topSpacer.id = "top-spacer";
    container.parentNode.insertBefore(topSpacer, container);
  }
  if (!bottomSpacer) {
    bottomSpacer = document.createElement("div");
    bottomSpacer.id = "bottom-spacer";
    container.parentNode.insertBefore(bottomSpacer, container.nextSibling);
  }

  const total = __currentFiltered.length;
  const loadedCount = Math.min(currentPage * PAGE_SIZE, total);

  // 이번에 보여줄 "윈도우" 범위 계산
  const windowSize = PAGE_SIZE * WINDOW_PAGES; // 60
  const end = loadedCount;                     // 지금까지 로드된 끝
  const start = Math.max(0, end - windowSize); // 끝에서 windowSize만 남김

  // reset이면 완전 초기화
  if (reset) {
    container.innerHTML = "";
    __renderStartIndex = start;
    __renderEndIndex = start;
  }

  // 스페이서 높이: 앞에 버린 만큼 + 뒤에 남은 만큼
  topSpacer.style.height = `${start * EST_CARD_HEIGHT}px`;
  bottomSpacer.style.height = `${Math.max(0, total - end) * EST_CARD_HEIGHT}px`;

  // 컨테이너에 남길 범위로 업데이트
  // (현재 DOM 범위: __renderStartIndex ~ __renderEndIndex)
  // 목표 범위: start ~ end

  // 1) 앞쪽이 더 크면(즉 start가 앞으로 당겨지면) -> 전체 리렌더가 더 안전
  // (검색/정렬 변경 때)
  if (start < __renderStartIndex) {
    container.innerHTML = "";
    __renderStartIndex = start;
    __renderEndIndex = start;
  }

  // 2) 필요 없는 앞쪽 제거
  while (__renderStartIndex < start && container.firstChild) {
    container.removeChild(container.firstChild);
    __renderStartIndex++;
  }

  // 3) 뒤쪽 추가
  for (let i = __renderEndIndex; i < end; i++) {
    const job = __currentFiltered[i];
    container.appendChild(makeCard(job, __currentQuery));
    __renderEndIndex++;
  }

  // 카운트 업데이트(Showing=로드된 개수 / Total=필터된 전체)
  updateCount(loadedCount, total);
}

// =====================
// Bookmark Click (event delegation)
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

    if (bookmarks.has(key)) bookmarks.delete(key);
    else bookmarks.add(key);

    saveBookmarks(bookmarks);
    btn.textContent = bookmarks.has(key) ? "★" : "☆";

    // 상단 북마크 숫자만 즉시 반영
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
// Filtering + Sorting
// =====================
function applyFilters(resetPage = true) {
  const input = document.getElementById("search");
  const regionEl = document.getElementById("regionFilter");
  const typeEl = document.getElementById("typeFilter");
  const sortEl = document.getElementById("sortFilter");
  const bmEl = document.getElementById("onlyBookmarked");

  const q = input?.value.trim().toLowerCase() || "";
  const regionKey = regionEl ? regionEl.value : "all";
  const typeKey = typeEl ? typeEl.value : "all";
  const sortKey = sortEl ? sortEl.value : "default";
  const onlyBm = bmEl ? bmEl.checked : false;

  const regionMap = { all: "", seoul: "서울", gyeonggi: "경기" };
  const typeMap = { all: "", regular: "정규", intern: "인턴" };

  const regionNeedle = (regionMap[regionKey] ?? "").toLowerCase();
  const typeNeedle = (typeMap[typeKey] ?? "").toLowerCase();

  let filtered = __allJobs.filter((job) => {
    if (q && !JSON.stringify(job ?? {}).toLowerCase().includes(q)) return false;

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

  if (sortKey !== "default") {
    filtered.sort((a, b) => {
      if (sortKey === "deadline") {
        const ta = parseYmd(a.pbancEndYmd);
        const tb = parseYmd(b.pbancEndYmd);
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1;
        if (tb == null) return -1;
        return ta - tb;
      }

      if (sortKey === "latest") {
        const ta = parseYmd(a.pbancBgngYmd);
        const tb = parseYmd(b.pbancBgngYmd);
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1;
        if (tb == null) return -1;
        return tb - ta;
      }

      return 0;
    });
  }

  __currentFiltered = filtered;
  __currentQuery = q;

  if (resetPage) currentPage = 1;

  // 가상 스크롤 윈도우 렌더 (reset이면 DOM 초기화)
  renderWindow(true);
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
// Infinite Scroll + Virtualization trigger
// =====================
function wireVirtualScroll() {
  let ticking = false;

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      ticking = false;

      const total = __currentFiltered.length;
      if (!total) return;

      const nearBottom =
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 300;

      if (!nearBottom) return;

      const canLoadMore = currentPage * PAGE_SIZE < total;
      if (!canLoadMore) return;

      currentPage += 1;

      // 윈도우 유지하면서 뒤쪽 추가/앞쪽 제거
      renderWindow(false);
    });
  });
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
    const root = document.getElementById("jobs");
    if (!root) return;

    root.innerHTML = `
      <p id="showing-line"></p>
      <div id="jobs-grid"></div>
    `;

    __allJobs = jobs;

    wireBookmarkClicks();
    wireUI();
    wireVirtualScroll();

    applyFilters(true);

  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

loadJobs();