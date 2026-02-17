// Replace this URL later with your Worker endpoint (e.g. https://...workers.dev/jobs)
const API_URL = "/api/jobs";

const DUMMY_JOBS = [
  { id: 1, title: "Frontend Engineer", company: "Aster Labs", region: "seoul", type: "regular", keywords: ["react", "typescript"] },
  { id: 2, title: "Backend Engineer", company: "Pine Data", region: "gyeonggi", type: "regular", keywords: ["node", "api"] },
  { id: 3, title: "Product Design Intern", company: "Moru Studio", region: "seoul", type: "intern", keywords: ["figma", "ux"] },
  { id: 4, title: "Data Analyst Intern", company: "Grid Finance", region: "gyeonggi", type: "intern", keywords: ["sql", "bi"] },
  { id: 5, title: "iOS Engineer", company: "Blue River", region: "seoul", type: "regular", keywords: ["swift", "pwa"] },
  { id: 6, title: "QA Intern", company: "North Hub", region: "gyeonggi", type: "intern", keywords: ["test", "automation"] }
];

const els = {
  region: document.getElementById("regionFilter"),
  type: document.getElementById("typeFilter"),
  search: document.getElementById("searchInput"),
  list: document.getElementById("jobList"),
  meta: document.getElementById("resultMeta"),
  tip: document.getElementById("installTip")
};

const state = {
  jobs: [],
  region: "all",
  type: "all",
  query: ""
};

async function loadJobs() {
  try {
    const res = await fetch(API_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const arr = json?.data?.result;
    if (!Array.isArray(arr)) throw new Error("Unexpected API response shape");

    // 화면 렌더용으로 최소 변환 (기존 render()가 job.title/company/region/type을 쓰는 구조라서 맞춰줌)
    return arr.map((j, idx) => {
      const regionName = String(j.workRgnNmLst || "");
      const region =
        regionName.includes("서울") ? "seoul" :
        regionName.includes("경기") ? "gyeonggi" :
        "all";

      const typeName = String(j.hireTypeNmLst || "");
      const type =
        typeName.includes("정규") ? "regular" :
        typeName.includes("인턴") ? "intern" :
        "regular";

      return {
        id: j.recrutPblntSn ?? idx,
        title: j.recrutPbancTtl ?? "",
        company: j.instNm ?? "",
        region,
        type,
        keywords: []
      };
    });
  } catch (err) {
    console.error("API load failed:", err);
    return []; // 실패 시 더미로 떨어지지 않게!
  }
}


function normalize(text) {
  return String(text || "").toLowerCase();
}

function displayRegion(region) {
  if (region === "seoul") return "Seoul";
  if (region === "gyeonggi") return "Gyeonggi";
  return region;
}

function displayType(type) {
  if (type === "regular") return "Regular";
  if (type === "intern") return "Intern";
  return type;
}

function filterJobs() {
  const q = normalize(state.query);
  return state.jobs.filter((job) => {
    const byRegion = state.region === "all" || job.region === state.region;
    const byType = state.type === "all" || job.type === state.type;

    const searchBlob = normalize([
      job.title,
      job.company,
      ...(job.keywords || [])
    ].join(" "));

    const byQuery = !q || searchBlob.includes(q);
    return byRegion && byType && byQuery;
  });
}

function render() {
  const filtered = filterJobs();
  els.meta.textContent = `${filtered.length} jobs found`;

  if (!filtered.length) {
    els.list.innerHTML = '<div class="empty">No matching jobs.</div>';
    return;
  }

  els.list.innerHTML = filtered.map((job) => `
    <article class="card">
      <h3>${job.title}</h3>
      <div class="meta">
        <span class="badge">${displayRegion(job.region)}</span>
        <span class="badge">${displayType(job.type)}</span>
      </div>
      <p class="company">${job.company}</p>
    </article>
  `).join("");
}

function bindEvents() {
  els.region.addEventListener("change", (e) => {
    state.region = e.target.value;
    render();
  });

  els.type.addEventListener("change", (e) => {
    state.type = e.target.value;
    render();
  });

  els.search.addEventListener("input", (e) => {
    state.query = e.target.value;
    render();
  });
}

function setupInstallTip() {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  if (!isStandalone && isIOS) {
    els.tip.hidden = false;
  }
}

async function main() {
  state.jobs = await loadJobs();
  bindEvents();
  setupInstallTip();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }
}

main();

  html += "</ul>";

  document.body.innerHTML = html;
}

loadJobs();
