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
let currentPage = 1;
let __currentFiltered = [];
let __currentQuery = "";

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
// Render (append mode)
// =====================
function renderJobsAppend(jobs, q, totalFiltered) {
  const container = document.getElementById("jobs-grid");
  if (!container) return;

  // page 1이면 초기화
  if (currentPage === 1) container.innerHTML = "";

  const start = (currentPage - 1) * PAGE_SIZE;
  const paged = jobs.slice(start, start + PAGE_SIZE);

  paged.forEach(job => {
    const card = document.createElement("div");
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

    container.appendChild(card);
  });

  const showing = Math.min(currentPage * PAGE_SIZE, totalFiltered);
  updateCount(showing, totalFiltered);
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
// Filtering + Sorting (single source of truth)
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

  renderJobsAppend(__currentFiltered, __currentQuery, __currentFiltered.length);
}

// =====================
// Wire UI Events
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
// Infinite Scroll Listener
// =====================
function wireInfiniteScroll() {
  // 너무 자주 실행 방지
  let ticking = false;

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      ticking = false;

      if (!__currentFiltered || __currentFiltered.length === 0) return;

      const nearBottom =
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 250;

      if (!nearBottom) return;

      const canLoadMore = currentPage * PAGE_SIZE < __currentFiltered.length;
      if (!canLoadMore) return;

      currentPage += 1;
      renderJobsAppend(__currentFiltered, __currentQuery, __currentFiltered.length);
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

    // 공공데이터 json 구조: payload.data
    const jobs = payload.data?.result || [];
    const total = payload.data?.totalCount ?? jobs.length;

    const root = document.getElementById("jobs");
    if (!root) return;

    root.innerHTML = `
      <p id="showing-line"></p>
      <div id="jobs-grid"></div>
    `;

    __allJobs = jobs;

    wireBookmarkClicks();
    wireUI();
    wireInfiniteScroll();

    // 초기 1회
    applyFilters(true);

    // Total 표시 보정 (처음에 showing만 뜰 수 있어서)
    updateCount(Math.min(PAGE_SIZE, total), total);

  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

loadJobs();