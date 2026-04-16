const DATA_URL = "./data/nova-scotia-poll-results.json?v=20260415-2";

const state = {
  dataset: null,
  currentElection: "2024",
  compareDistrictA: "",
  compareDistrictB: "",
};

const elements = {
  electionToggle: document.querySelector("#electionToggle"),
  currentElectionLabel: document.querySelector("#currentElectionLabel"),
  sourceWorkbook: document.querySelector("#sourceWorkbook"),
  generatedAt: document.querySelector("#generatedAt"),
  compareDistrictA: document.querySelector("#compareDistrictA"),
  compareDistrictB: document.querySelector("#compareDistrictB"),
  compareSummary: document.querySelector("#compareSummary"),
  compareBreakdown: document.querySelector("#compareBreakdown"),
  compareChart: document.querySelector("#compareChart"),
  compareChartTitle: document.querySelector("#compareChartTitle"),
  compareBreakdownTitle: document.querySelector("#compareBreakdownTitle"),
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

let compareChart;

function themeColor(variableName, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value || fallback;
}

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Unable to load dataset: ${response.status}`);
  }

  state.dataset = await response.json();
  state.currentElection = state.dataset.metadata.defaultElection || "2024";

  populateElectionToggle();
  bindEvents();
  syncElectionView();
}

function getElectionData() {
  return state.dataset?.elections?.[state.currentElection] || null;
}

function getElectionMetadata() {
  return getElectionData()?.metadata || null;
}

function getGroupMode() {
  return getElectionMetadata()?.groupMode || "party";
}

function getGroupLabelSingular() {
  return getGroupMode() === "candidate" ? "Candidate" : "Party";
}

function populateElectionToggle() {
  if (!elements.electionToggle || !state.dataset?.metadata?.availableElections) {
    return;
  }

  elements.electionToggle.innerHTML = state.dataset.metadata.availableElections
    .map(
      (election) => `
        <button
          class="election-option${election.id === state.currentElection ? " is-active" : ""}"
          type="button"
          data-election="${escapeHtml(election.id)}"
          aria-pressed="${String(election.id === state.currentElection)}"
        >
          ${escapeHtml(election.label)}
        </button>
      `,
    )
    .join("");
}

function updateElectionToggle() {
  if (!elements.electionToggle) {
    return;
  }

  elements.electionToggle.querySelectorAll("[data-election]").forEach((button) => {
    const isActive = button.dataset.election === state.currentElection;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncElectionView() {
  hydrateMetadata();
  populateDistricts();
  updateElectionToggle();
  render();
}

function hydrateMetadata() {
  const metadata = getElectionMetadata();
  if (!metadata) {
    return;
  }

  if (elements.currentElectionLabel) {
    elements.currentElectionLabel.textContent = metadata.electionLabel;
  }
  if (elements.sourceWorkbook) {
    elements.sourceWorkbook.textContent = metadata.sourceWorkbook;
  }
  if (elements.generatedAt) {
    elements.generatedAt.textContent = new Date(state.dataset.metadata.generatedAtUtc).toLocaleString("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
}

function populateDistricts() {
  const electionData = getElectionData();
  if (!electionData || !elements.compareDistrictA || !elements.compareDistrictB) {
    return;
  }

  const sortedDistricts = electionData.districts
    .slice()
    .sort((left, right) => collator.compare(left.displayName, right.displayName));

  const options = sortedDistricts
    .map((district) => `<option value="${district.code}">${district.displayName}</option>`)
    .join("");

  elements.compareDistrictA.innerHTML = options;
  elements.compareDistrictB.innerHTML = options;

  state.compareDistrictA = sortedDistricts[0]?.code || "";
  state.compareDistrictB = sortedDistricts[1]?.code || state.compareDistrictA;

  elements.compareDistrictA.value = state.compareDistrictA;
  elements.compareDistrictB.value = state.compareDistrictB;
}

function bindEvents() {
  elements.electionToggle?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-election]");
    if (!button) {
      return;
    }

    const nextElection = button.dataset.election;
    if (!nextElection || nextElection === state.currentElection) {
      return;
    }

    state.currentElection = nextElection;
    syncElectionView();
  });

  elements.compareDistrictA?.addEventListener("change", (event) => {
    state.compareDistrictA = event.target.value;
    render();
  });

  elements.compareDistrictB?.addEventListener("change", (event) => {
    state.compareDistrictB = event.target.value;
    render();
  });

  if (colorSchemeQuery?.addEventListener) {
    colorSchemeQuery.addEventListener("change", () => {
      render();
    });
  }
}

function getDistrictByCode(code) {
  return getElectionData()?.districts.find((district) => district.code === code) || null;
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
        ${renderCompareMetric("Winner", escapeHtml(formatWinnerDisplay(districtA.winner)))}
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
        ${renderCompareMetric("Winner", escapeHtml(formatWinnerDisplay(districtB.winner)))}
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

function renderCompareChart(districtA, districtB) {
  if (!elements.compareChart || typeof Chart === "undefined") {
    return;
  }

  const entries = getComparisonEntries(districtA, districtB);
  const groupLabel = getGroupLabelSingular();

  if (elements.compareChartTitle) {
    elements.compareChartTitle.textContent = `${groupLabel} vote totals`;
  }
  if (elements.compareBreakdownTitle) {
    elements.compareBreakdownTitle.textContent = `${groupLabel} vote share`;
  }

  compareChart = buildOrUpdateChart(compareChart, elements.compareChart, {
    type: "bar",
    data: {
      labels: entries.map((entry) => entry.label),
      datasets: [
        {
          label: districtA.displayName,
          data: entries.map((entry) => entry.leftVotes),
          backgroundColor: "rgba(31, 77, 181, 0.82)",
          borderRadius: 10,
          borderSkipped: false,
        },
        {
          label: districtB.displayName,
          data: entries.map((entry) => entry.rightVotes),
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
  const entries = getComparisonEntries(districtA, districtB);

  elements.compareBreakdown.innerHTML = entries
    .map((entry) => `
      <div class="compare-breakdown-row">
        <div class="compare-share compare-share-left">
          <strong>${percentFormatter.format(entry.leftShare)}</strong>
          <span>${escapeHtml(districtA.displayName)}</span>
        </div>
        <div class="compare-party-center">
          <span class="compare-party-name">${escapeHtml(entry.label)}</span>
          <div class="compare-share-track">
            <div class="compare-share-fill compare-share-fill-left" style="width: ${entry.leftShare * 100}%;"></div>
            <div class="compare-share-fill compare-share-fill-right" style="width: ${entry.rightShare * 100}%;"></div>
          </div>
        </div>
        <div class="compare-share compare-share-right">
          <strong>${percentFormatter.format(entry.rightShare)}</strong>
          <span>${escapeHtml(districtB.displayName)}</span>
        </div>
      </div>
    `)
    .join("");
}

function getComparisonEntries(districtA, districtB) {
  const leftMap = groupTotalsMap(districtA);
  const rightMap = groupTotalsMap(districtB);
  const labels = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const leftValidVotes = districtA.candidates.reduce((total, candidate) => total + candidate.votes, 0);
  const rightValidVotes = districtB.candidates.reduce((total, candidate) => total + candidate.votes, 0);

  return [...labels]
    .map((label) => {
      const leftVotes = leftMap.get(label)?.votes || 0;
      const rightVotes = rightMap.get(label)?.votes || 0;
      return {
        label,
        leftVotes,
        rightVotes,
        leftShare: leftValidVotes ? leftVotes / leftValidVotes : 0,
        rightShare: rightValidVotes ? rightVotes / rightValidVotes : 0,
      };
    })
    .sort((left, right) => {
      const voteDifference = right.leftVotes + right.rightVotes - (left.leftVotes + left.rightVotes);
      if (voteDifference !== 0) {
        return voteDifference;
      }
      return collator.compare(left.label, right.label);
    });
}

function groupTotalsMap(district) {
  const totals = new Map();

  district.candidates.forEach((candidate) => {
    const key = candidate.groupLabel || candidate.party || candidate.candidate;
    const current = totals.get(key) || { votes: 0 };
    current.votes += candidate.votes;
    totals.set(key, current);
  });

  return totals;
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

function formatWinnerDisplay(winner) {
  if (!winner) {
    return "n/a";
  }

  if (getGroupMode() === "candidate" || !winner.party) {
    return winner.candidate;
  }

  return `${winner.candidate} (${winner.party})`;
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
  if (!canvas || typeof Chart === "undefined") {
    return existingChart;
  }

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
  if (elements.compareSummary) {
    elements.compareSummary.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
});
