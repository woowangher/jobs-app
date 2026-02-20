const API_URL = "/api/jobs";

// =========================
// Bookmarks (localStorage)
// =========================
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

// =========================
// Utils
// =========================
function getJobKey(job) {
  // 가능한 한 안정적인 키: srcUrl 우선
  const title = job.recrutPbancTtl || "";
  const company = job.instNm || "";
  const url = job.srcUrl || "";
  const region = Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(", ") : (job.workRgnNmLst || "");
  const hireType = Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(", ") : (job.hireTypeNmLst || "");
  return url || `${company}__${title}__${region}__${hireType}`;
}

/* ---------- 날짜 ---------- */
function parseYmd(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;

  const digits = s.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  if (!y || !m || !d) return null;

  return new Date(y, m - 1, d).getTime();
}

/* ---------- 검색어 하이라이트 ---------- */
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

/* ---------- 상단 숫자 업데이트 ---------- */
function updateCount(showing, total) {
  const el = document.getElementById("showing-line");
  if (!el) return;
  el.innerHTML =
    `<b>Showing:</b> ${showing} / <b>Total:</b> ${total}` +
    ` <span style="margin-left:10px; color:#666;">북마크: <b>${bookmarks.size}</b></span>`;
}

/* ---------- 카드 렌더 ---------- */
function renderJobs(jobs, q = "") {
  const container = document.getElementById("jobs-grid");
  if (!container) return;

  container.innerHTML = "";

  jobs.forEach(job => {
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
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <h3 style="margin:0 0 6px 0;">${highlight(title, q)}</h3>
        <button class="bm-btn" data-bm="${key}" style="border:0;background:transparent;font-size:18px;cursor:pointer;">
          ${star}
        </button>
      </div>
      <p style="margin:0 0 6px 0;"><b>${highlight(company, q)}</b></p>
      <p style="margin:0 0 6px 0; color:#666;">${highlight(region, q)}</p>
      <p style="margin:0 0 10px 0; color:#666;">${highlight(recruitType, q)}${hireType ? " · " + highlight(hireType, q) : ""}</p>
      <p style="margin:0 0 10px 0; color:#666;">${highlight(period, q)}</p>
      ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">공고 링크</a>` : ""}
    `;

    container.appendChild(card);
  });
}

/* ---------- 북마크 클릭(이벤트 위임) ---------- */
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

    // Showing/Total은 유지하면서 북마크 숫자만 갱신 (문구 치환)
    const line = document.getElementById("showing-line");
    if (line) {
      line.innerHTML = line.innerHTML.replace(
        /북마크:\s*<b>\d+<\/b>/,
        `북마크: <b>${bookmarks.size}</b>`
      );
    }
  });
}

/* ---------- 검색 ---------- */
function matchesQuery(job, q) {
  if (!q) return true;
  const blob = JSON.stringify(job ?? {}).toLowerCase();
  return blob.includes(q);
}

function wireSearch(total) {
  const input = document.getElementById("search") || document.getElementById("searchInput");
  const regionEl = document.getElementById("regionFilter");
  const typeEl = document.getElementById("typeFilter");
  const sortEl = document.getElementById("sortFilter");
  const bmEl = document.getElementById("onlyBookmarked");

  if (!input) return;

  let t = null;

  const regionMap = { all: "", seoul: "서울", gyeonggi: "경기" };
  const typeMap = { all: "", regular: "정규", intern: "인턴" };

  const apply = () => {
    const q = input.value.trim().toLowerCase();
    const regionKey = regionEl ? regionEl.value : "all";
    const typeKey = typeEl ? typeEl.value : "all";
    const sortKey = sortEl ? sortEl.value : "default";
    const onlyBm = bmEl ? bmEl.checked : false;

    const regionNeedle = (regionMap[regionKey] ?? "").toLowerCase();
    const typeNeedle = (typeMap[typeKey] ?? "").toLowerCase();

    let filtered = __allJobs.filter((job) => {
      if (q && !matchesQuery(job, q)) return false;

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

    // ✅ 북마크만 보기 (정렬 전에 적용)
    if (onlyBm) {
      filtered = filtered.filter(job => bookmarks.has(getJobKey(job)));
    }

    // ✅ 정렬
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

    renderJobs(filtered, q);
    updateCount(filtered.length, total);
  };

  // 이벤트는 한 번씩만
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(apply, 300);
  });
  input.addEventListener("search", apply);

  if (regionEl) regionEl.addEventListener("change", apply);
  if (typeEl) typeEl.addEventListener("change", apply);
  if (sortEl) sortEl.addEventListener("change", apply);
  if (bmEl) bmEl.addEventListener("change", apply);

  apply();
}

/* ---------- 메인 로딩 ---------- */
async function loadJobs() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    const data = await res.json();

    if (!data.ok) {
      document.body.innerHTML = "<h2>API ok:false</h2>";
      return;
    }

    const jobs = data.data?.result || [];
    const total = data.data?.totalCount ?? jobs.length;

    const root = document.getElementById("jobs");
    if (!root) return;

    root.innerHTML = `
      <p id="showing-line"><b>Showing:</b> ${jobs.length} / <b>Total:</b> ${total}</p>
      <div id="jobs-grid"></div>
    `;

    __allJobs = jobs;

    renderJobs(jobs);
    updateCount(jobs.length, total);
    wireBookmarkClicks();
    wireSearch(total);

  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

loadJobs();