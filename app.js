const API_URL = "/api/jobs";

async function loadJobs() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    const data = await res.json();

    console.log("API DATA:", data);

    if (!data.ok) {
      document.body.innerHTML = "<h2>API ok:false</h2>";
      return;
    }

    const jobs = data.data?.result || [];
    const loaded = data.data?.totalCount ?? jobs.length;

    document.body.innerHTML = `
      <h1>Jobs</h1>
      <p>Loaded: ${loaded}</p>
      <div id="jobs"></div>
    `;

    const container = document.getElementById("jobs");

    jobs.forEach(job => {
      const card = document.createElement("div");
      card.style.border = "1px solid #ccc";
      card.style.padding = "10px";
      card.style.margin = "10px 0";

      card.innerHTML = `
        <h3>${job.title || "No title"}</h3>
        <p>${job.company || ""}</p>
      `;

      container.appendChild(card);
    });

  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

loadJobs();