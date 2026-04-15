const DATA_URL = "./data/nova-scotia-poll-results.json?v=20260415-1";

const state = {
  dataset: null,
  compareDistrictA: "",
  compareDistrictB: "",
};

const elements = {
  sourceWorkbook: document.querySelector("#sourceWorkbook"),
  generatedAt: document.querySelector("#generatedAt"),
  compareDistrictA: document.querySelector("#compareDistrictA"),
  compareDistrictB: document.querySelector("#compareDistrictB"),
  compareSummary: document.querySelector("#compareSummary"),
  compareBreakdown: document.querySelector("#compareBreakdown"),
  compareChart: document.querySelector("#compareChart"),
};

const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });
const colorSchemeQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const numberFormatter = new Intl.NumberFormat("en-CA");
const percentFormatter = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function themeColor(variableName, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value || fallback;
}

let compareChart;

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Unable to load dataset: ${response.status}`);
  }

  state.dataset = await response.json();
  hydrateMetadata();
  populateDistricts();
  bindEvents();
  render();
}

function hydrateMetadata() {
  elements.sourceWorkbook.textContent = state.dataset.metadata.sourceWorkbook;
  elements.generatedAt.textContent = new Date(state.dataset.metadata.generatedAtUtc).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function populateDistricts() {
  const options = state.dataset.districts
    .slice()
    .sort((left, right) => collator.compare(left.displayName, right.displayName))
    .map((district) => `<option value="${district.code}">${district.displayName}</option>`)
    .join("");

  elements.compareDistrictA.innerHTML = options;
  elements.compareDistrictB.innerHTML = options;

  state.compareDistrictA = state.dataset.districts[0]?.code || "";
  state.compareDistrictB = state.dataset.districts[1]?.code || state.compareDistrictA;

  elements.compareDistrictA.value = state.compareDistrictA;
  elements.compareDistrictB.value = state.compareDistrictB;
}

function bindEvents() {
  elements.compareDistrictA.addEventListener("change", (event) => {
    state.compareDistrictA = event.target.value;
    render();
  });

  elements.compareDistrictB.addEventListener("change", (event) => {
    state.compareDistrictB = event.target.value;
    render();
  });

  if (colorSchemeQuery?.addEventListener) {
    colorSchemeQuery.addEventListener("change", () => {
      render();
    });
  }
}

function render() {
  const districtA = getDistrictByCode(state.compareDistrictA);
  const districtB = getDistrictByCode(state.compareDistrictB);

  if (!districtA || !districtB) {
    elements.compareSummary.innerHTML =
      '<div class="empty-state">Select two constituencies to compare.</div>';
    elements.compareBreakdown.innerHTML = "";
    return;
  }

  const sameDistrict = districtA.code === districtB.code;
  const turnoutGap = compareMetricValue(districtA.summary.turnoutRate, districtB.summary.turnoutRate, "percent");
  const votesGap = compareMetricValue(districtA.summary.totalVotes, districtB.summary.totalVotes, "number");

  elements.compareSummary.innerHTML = `
    <article class="compare-district-card">
      <p class="compare-label">Constituency A</p>
      <h3>${escapeHtml(districtA.displayName)}</h3>
      <div class="compare-metrics">
        ${renderCompareMetric("Winner", `${escapeHtml(districtA.winner.candidate)} (${escapeHtml(districtA.winner.party)})`)}
        ${renderCompareMetric("Turnout", formatTurnout(districtA.summary.turnoutRate))}
        ${renderCompareMetric("Votes cast", numberFormatter.format(districtA.summary.totalVotes))}
        ${renderCompareMetric("Electors", numberFormatter.format(districtA.summary.electors))}
        ${renderCompareMetric("Polls", numberFormatter.format(districtA.pollCount))}
      </div>
    </article>
    <article class="compare-center-card">
      <p class="compare-label">Key gap</p>
      <h3>${sameDistrict ? "Same constituency selected" : "At a glance"}</h3>
      <div class="compare-gap-grid">
        ${renderCompareMetric("Turnout gap", sameDistrict ? "0.0%" : turnoutGap)}
        ${renderCompareMetric("Vote gap", sameDistrict ? "0" : votesGap)}
        ${renderCompareMetric("Higher vote total", sameDistrict ? escapeHtml(districtA.displayName) : escapeHtml(getLeaderLabel(districtA, districtB)))}
      </div>
    </article>
    <article class="compare-district-card">
      <p class="compare-label">Constituency B</p>
      <h3>${escapeHtml(districtB.displayName)}</h3>
      <div class="compare-metrics">
        ${renderCompareMetric("Winner", `${escapeHtml(districtB.winner.candidate)} (${escapeHtml(districtB.winner.party)})`)}
        ${renderCompareMetric("Turnout", formatTurnout(districtB.summary.turnoutRate))}
        ${renderCompareMetric("Votes cast", numberFormatter.format(districtB.summary.totalVotes))}
        ${renderCompareMetric("Electors", numberFormatter.format(districtB.summary.electors))}
        ${renderCompareMetric("Polls", numberFormatter.format(districtB.pollCount))}
      </div>
    </article>
  `;

  renderCompareChart(districtA, districtB);
  renderCompareBreakdown(districtA, districtB);
}

function getDistrictByCode(code) {
  return state.dataset.districts.find((district) => district.code === code) || null;
}

function renderCompareChart(districtA, districtB) {
  if (!elements.compareChart || typeof Chart === "undefined") {
    return;
  }

  const parties = state.dataset.parties.map((party) => party.name);
  const districtATotals = candidateTotalsByParty(districtA);
  const districtBTotals = candidateTotalsByParty(districtB);

  compareChart = buildOrUpdateChart(compareChart, elements.compareChart, {
    type: "bar",
    data: {
      labels: parties,
      datasets: [
        {
          label: districtA.displayName,
          data: parties.map((party) => districtATotals.get(party) || 0),
          backgroundColor: "rgba(31, 77, 181, 0.82)",
          borderRadius: 10,
          borderSkipped: false,
        },
        {
          label: districtB.displayName,
          data: parties.map((party) => districtBTotals.get(party) || 0),
          backgroundColor: "rgba(242, 143, 22, 0.82)",
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: themeColor("--chart-text", "#1f2740") },
        },
      },
      scales: {
        x: {
          ticks: { color: themeColor("--chart-text", "#1f2740") },
          grid: { display: false },
        },
        y: {
          ticks: { color: themeColor("--chart-muted", "#5e6678") },
          grid: { color: themeColor("--chart-grid", "rgba(31,39,64,0.08)") },
        },
      },
    },
  });
}

function renderCompareBreakdown(districtA, districtB) {
  const parties = state.dataset.parties.map((party) => party.name);
  const districtAShares = candidateSharesByParty(districtA);
  const districtBShares = candidateSharesByParty(districtB);

  elements.compareBreakdown.innerHTML = parties
    .map((party) => {
      const leftShare = districtAShares.get(party) || 0;
      const rightShare = districtBShares.get(party) || 0;
      return `
        <div class="compare-breakdown-row">
          <div class="compare-share compare-share-left">
            <strong>${percentFormatter.format(leftShare)}</strong>
            <span>${escapeHtml(districtA.displayName)}</span>
          </div>
          <div class="compare-party-center">
            <span class="compare-party-name">${escapeHtml(party)}</span>
            <div class="compare-share-track">
              <div class="compare-share-fill compare-share-fill-left" style="width: ${leftShare * 100}%;"></div>
              <div class="compare-share-fill compare-share-fill-right" style="width: ${rightShare * 100}%;"></div>
            </div>
          </div>
          <div class="compare-share compare-share-right">
            <strong>${percentFormatter.format(rightShare)}</strong>
            <span>${escapeHtml(districtB.displayName)}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function candidateTotalsByParty(district) {
  const totals = new Map();
  district.candidates.forEach((candidate) => {
    totals.set(candidate.party, (totals.get(candidate.party) || 0) + candidate.votes);
  });
  return totals;
}

function candidateSharesByParty(district) {
  const shares = new Map();
  district.candidates.forEach((candidate) => {
    shares.set(candidate.party, candidate.voteShare || 0);
  });
  return shares;
}

function compareMetricValue(left, right, type) {
  const difference = Math.abs((left || 0) - (right || 0));
  return type === "percent" ? percentFormatter.format(difference) : numberFormatter.format(Math.round(difference));
}

function getLeaderLabel(districtA, districtB) {
  if (districtA.summary.totalVotes === districtB.summary.totalVotes) {
    return "Tie on total votes";
  }
  return districtA.summary.totalVotes > districtB.summary.totalVotes
    ? `${districtA.displayName} by votes`
    : `${districtB.displayName} by votes`;
}

function renderCompareMetric(label, value) {
  return `
    <div class="compare-metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function formatTurnout(value) {
  return typeof value === "number" ? percentFormatter.format(value) : "n/a";
}

function buildOrUpdateChart(existingChart, canvas, config) {
  if (existingChart) {
    existingChart.destroy();
  }
  return new Chart(canvas, config);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init().catch((error) => {
  console.error(error);
  elements.compareSummary.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
