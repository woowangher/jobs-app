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

const PAGE_SIZE = 20;
let currentPage = 1;

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
// Render
// =====================
function renderJobs(jobs, q = "", totalFiltered = jobs.length) {
  const container = document.getElementById("jobs-grid");
  if (!container) return;

  container.innerHTML = "";

  // 페이지 계산
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
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3>${highlight(title, q)}</h3>
        <button class="bm-btn" data-bm="${key}" style="border:0;background:none;font-size:18px;cursor:pointer;">${star}</button>
      </div>
      <p><b>${highlight(company, q)}</b></p>
      <p>${highlight(region, q)}</p>
      <p>${highlight(recruitType, q)}${hireType ? " · " + highlight(hireType, q) : ""}</p>
      <p>${highlight(period, q)}</p>
      ${url ? `<a href="${url}" target="_blank">공고 링크</a>` : ""}
    `;

    container.appendChild(card);
  });

  updateCount(paged.length, totalFiltered);
  renderPagination(totalFiltered);
}

// =====================
// Pagination UI
// =====================
function renderPagination(totalFiltered) {
  const totalPages = Math.ceil(totalFiltered / PAGE_SIZE);
  let pager = document.getElementById("pager");

  if (!pager) {
    pager = document.createElement("div");
    pager.id = "pager";
    pager.style.margin = "20px 0";
    document.getElementById("jobs").appendChild(pager);
  }

  pager.innerHTML = "";

  if (totalPages <= 1) return;

  if (currentPage > 1) {
    const prev = document.createElement("button");
    prev.textContent = "← Prev";
    prev.onclick = () => {
      currentPage--;
      applyFilters();
    };
    pager.appendChild(prev);
  }

  const info = document.createElement("span");
  info.textContent = ` Page ${currentPage} / ${totalPages} `;
  info.style.margin = "0 10px";
  pager.appendChild(info);

  if (currentPage < totalPages) {
    const next = document.createElement("button");
    next.textContent = "Next →";
    next.onclick = () => {
      currentPage++;
      applyFilters();
    };
    pager.appendChild(next);
  }
}

// =====================
// Bookmark Click
// =====================
function wireBookmarkClicks() {
  const container = document.getElementById("jobs-grid");
  if (!container) return;

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".bm-btn");
    if (!btn) return;

    const key = btn.dataset.bm;
    if (bookmarks.has(key)) bookmarks.delete(key);
    else bookmarks.add(key);

    saveBookmarks(bookmarks);
    btn.textContent = bookmarks.has(key) ? "★" : "☆";
  });
}

// =====================
// Filters
// =====================
function applyFilters() {
  const input = document.getElementById("search");
  const regionEl = document.getElementById("regionFilter");
  const typeEl = document.getElementById("typeFilter");
  const sortEl = document.getElementById("sortFilter");
  const bmEl = document.getElementById("onlyBookmarked");

  const q = input?.value.trim().toLowerCase() || "";
  const onlyBm = bmEl?.checked;

  let filtered = __allJobs.filter(job => {
    if (q && !JSON.stringify(job).toLowerCase().includes(q)) return false;
    return true;
  });

  if (onlyBm) {
    filtered = filtered.filter(job => bookmarks.has(getJobKey(job)));
  }

  if (sortEl?.value === "deadline") {
    filtered.sort((a, b) => parseYmd(a.pbancEndYmd) - parseYmd(b.pbancEndYmd));
  }

  if (sortEl?.value === "latest") {
    filtered.sort((a, b) => parseYmd(b.pbancBgngYmd) - parseYmd(a.pbancBgngYmd));
  }

  renderJobs(filtered, q, filtered.length);
}

function wireSearch() {
  const els = ["search","regionFilter","typeFilter","sortFilter","onlyBookmarked"];
  els.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => {
      currentPage = 1;
      applyFilters();
    });
    if (id === "search" && el) {
      el.addEventListener("input", () => {
        currentPage = 1;
        applyFilters();
      });
    }
  });
}

// =====================
// Load
// =====================
async function loadJobs() {
  const res = await fetch(API_URL, { cache: "no-store" });
  const data = await res.json();

  if (!data.ok) {
    document.body.innerHTML = "<h2>API ok:false</h2>";
    return;
  }

  const jobs = data.data?.result || [];
  const total = data.data?.totalCount ?? jobs.length;

  const root = document.getElementById("jobs");
  root.innerHTML = `
    <p id="showing-line"></p>
    <div id="jobs-grid"></div>
  `;

  __allJobs = jobs;

  wireBookmarkClicks();
  wireSearch();
  applyFilters();
}

loadJobs();