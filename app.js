const DATA_URL = "./data/nova-scotia-poll-results.json?v=20260415-1";

const state = {
  dataset: null,
  selectedDistrict: "all",
  selectedPollType: "all",
  searchText: "",
  compareDistrictA: "",
  compareDistrictB: "",
  isTableCollapsed: true,
};

const partyColorMap = new Map();
const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });
const colorSchemeQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

const elements = {
  sourceWorkbook: document.querySelector("#sourceWorkbook"),
  generatedAt: document.querySelector("#generatedAt"),
  districtSelect: document.querySelector("#districtSelect"),
  pollTypeSelect: document.querySelector("#pollTypeSelect"),
  searchInput: document.querySelector("#searchInput"),
  resetButton: document.querySelector("#resetButton"),
  scopeSummary: document.querySelector("#scopeSummary"),
  districtCountStat: document.querySelector("#districtCountStat"),
  pollCountStat: document.querySelector("#pollCountStat"),
  votesStat: document.querySelector("#votesStat"),
  turnoutStat: document.querySelector("#turnoutStat"),
  compareDistrictA: document.querySelector("#compareDistrictA"),
  compareDistrictB: document.querySelector("#compareDistrictB"),
  compareSummary: document.querySelector("#compareSummary"),
  compareBreakdown: document.querySelector("#compareBreakdown"),
  compareChart: document.querySelector("#compareChart"),
  spotlightTitle: document.querySelector("#spotlightTitle"),
  spotlightContent: document.querySelector("#spotlightContent"),
  partyChartTitle: document.querySelector("#partyChartTitle"),
  turnoutChartTitle: document.querySelector("#turnoutChartTitle"),
  tableNote: document.querySelector("#tableNote"),
  tableToggleButton: document.querySelector("#tableToggleButton"),
  tableWrap: document.querySelector("#tableWrap"),
  pollTableBody: document.querySelector("#pollTableBody"),
};

let partyChart;
let turnoutChart;
let compareChart;

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

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Unable to load dataset: ${response.status}`);
  }

  state.dataset = await response.json();
  state.dataset.parties.forEach((party) => partyColorMap.set(party.name, party.color));

  hydrateMetadata();
  populateFilters();
  bindEvents();
  render();
}

function hydrateMetadata() {
  const { metadata } = state.dataset;
  elements.sourceWorkbook.textContent = metadata.sourceWorkbook;
  elements.generatedAt.textContent = new Date(metadata.generatedAtUtc).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function populateFilters() {
  if (!elements.districtSelect || !elements.pollTypeSelect) {
    return;
  }

  const districtOptions = state.dataset.districts
    .map(
      (district) =>
        `<option value="${district.code}">${district.displayName}</option>`,
    )
    .join("");

  const pollTypeOptions = Object.keys(state.dataset.metadata.pollTypes)
    .sort(collator.compare)
    .map((pollType) => `<option value="${pollType}">${pollType}</option>`)
    .join("");

  elements.districtSelect.insertAdjacentHTML("beforeend", districtOptions);
  elements.pollTypeSelect.insertAdjacentHTML("beforeend", pollTypeOptions);
  if (elements.compareDistrictA) {
    elements.compareDistrictA.innerHTML = districtOptions;
  }
  if (elements.compareDistrictB) {
    elements.compareDistrictB.innerHTML = districtOptions;
  }

  state.compareDistrictA = state.dataset.districts[0]?.code || "";
  state.compareDistrictB = state.dataset.districts[1]?.code || state.compareDistrictA;
  if (elements.compareDistrictA) {
    elements.compareDistrictA.value = state.compareDistrictA;
  }
  if (elements.compareDistrictB) {
    elements.compareDistrictB.value = state.compareDistrictB;
  }
}

function bindEvents() {
  elements.districtSelect.addEventListener("change", (event) => {
    state.selectedDistrict = event.target.value;
    render();
  });

  elements.pollTypeSelect.addEventListener("change", (event) => {
    state.selectedPollType = event.target.value;
    render();
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.searchText = event.target.value.trim().toLowerCase();
    render();
  });

  if (elements.compareDistrictA) {
    elements.compareDistrictA.addEventListener("change", (event) => {
      state.compareDistrictA = event.target.value;
      render();
    });
  }

  if (elements.compareDistrictB) {
    elements.compareDistrictB.addEventListener("change", (event) => {
      state.compareDistrictB = event.target.value;
      render();
    });
  }

  if (elements.tableToggleButton) {
    elements.tableToggleButton.addEventListener("click", () => {
      state.isTableCollapsed = !state.isTableCollapsed;
      renderTableVisibility();
    });
  }

  if (colorSchemeQuery?.addEventListener) {
    colorSchemeQuery.addEventListener("change", () => {
      render();
    });
  }

  elements.resetButton.addEventListener("click", () => {
    state.selectedDistrict = "all";
    state.selectedPollType = "all";
    state.searchText = "";
    elements.districtSelect.value = "all";
    elements.pollTypeSelect.value = "all";
    elements.searchInput.value = "";
    render();
  });
}

function getSelectedDistrict() {
  return state.dataset.districts.find((district) => district.code === state.selectedDistrict) || null;
}

function getFilteredPolls() {
  return state.dataset.polls
    .filter((poll) => state.selectedDistrict === "all" || poll.districtCode === state.selectedDistrict)
    .filter((poll) => state.selectedPollType === "all" || poll.pollType === state.selectedPollType)
    .filter((poll) => {
      if (!state.searchText) {
        return true;
      }
      const haystack = [
        poll.districtDisplayName,
        poll.pollCode,
        poll.pollType,
        poll.location,
        poll.winner.candidate,
        poll.winner.party,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(state.searchText);
    })
    .sort((left, right) => {
      if (left.districtDisplayName !== right.districtDisplayName) {
        return collator.compare(left.districtDisplayName, right.districtDisplayName);
      }
      return collator.compare(left.pollCode, right.pollCode);
    });
}

function render() {
  const filteredPolls = getFilteredPolls();
  const uniqueDistricts = new Set(filteredPolls.map((poll) => poll.districtCode));
  const selectedDistrict = getSelectedDistrict();

  renderScopeSummary(filteredPolls, selectedDistrict, uniqueDistricts.size);
  renderStats(filteredPolls, uniqueDistricts.size);
  renderComparison();
  renderSpotlight(filteredPolls, selectedDistrict);
  renderPartyChart(filteredPolls, selectedDistrict);
  renderTurnoutChart(filteredPolls, selectedDistrict);
  renderTable(filteredPolls);
  renderTableVisibility();
}

function getDistrictByCode(code) {
  return state.dataset.districts.find((district) => district.code === code) || null;
}

function renderComparison() {
  if (!elements.compareSummary || !elements.compareBreakdown) {
    return;
  }

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
        ${renderCompareMetric("Turnout", typeof districtA.summary.turnoutRate === "number" ? percentFormatter.format(districtA.summary.turnoutRate) : "n/a")}
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
        ${renderCompareMetric("Higher vote total", sameDistrict ? escapeHtml(districtA.displayName) : `${escapeHtml(getLeaderLabel(districtA, districtB))}`)}
      </div>
    </article>
    <article class="compare-district-card">
      <p class="compare-label">Constituency B</p>
      <h3>${escapeHtml(districtB.displayName)}</h3>
      <div class="compare-metrics">
        ${renderCompareMetric("Winner", `${escapeHtml(districtB.winner.candidate)} (${escapeHtml(districtB.winner.party)})`)}
        ${renderCompareMetric("Turnout", typeof districtB.summary.turnoutRate === "number" ? percentFormatter.format(districtB.summary.turnoutRate) : "n/a")}
        ${renderCompareMetric("Votes cast", numberFormatter.format(districtB.summary.totalVotes))}
        ${renderCompareMetric("Electors", numberFormatter.format(districtB.summary.electors))}
        ${renderCompareMetric("Polls", numberFormatter.format(districtB.pollCount))}
      </div>
    </article>
  `;

  renderCompareChart(districtA, districtB);
  renderCompareBreakdown(districtA, districtB);
}

function renderScopeSummary(filteredPolls, selectedDistrict, districtCount) {
  const scopeLabel = selectedDistrict ? selectedDistrict.displayName : "all 55 constituencies";
  const pollTypeLabel = state.selectedPollType === "all" ? "all poll types" : state.selectedPollType;
  const searchLabel = state.searchText ? ` Matching "${state.searchText}".` : "";

  elements.scopeSummary.textContent =
    `Showing ${numberFormatter.format(filteredPolls.length)} polls across ${numberFormatter.format(districtCount)} ` +
    `${districtCount === 1 ? "district" : "districts"} in ${scopeLabel}, filtered to ${pollTypeLabel}.${searchLabel}`;
}

function renderStats(filteredPolls, districtCount) {
  const totalVotes = sum(filteredPolls, (poll) => poll.totalVotes);
  const totalElectors = sum(filteredPolls, (poll) => poll.electors || 0);
  const turnoutRate = totalElectors ? totalVotes / totalElectors : 0;

  elements.districtCountStat.textContent = numberFormatter.format(districtCount);
  elements.pollCountStat.textContent = numberFormatter.format(filteredPolls.length);
  elements.votesStat.textContent = numberFormatter.format(totalVotes);
  elements.turnoutStat.textContent = totalElectors ? percentFormatter.format(turnoutRate) : "n/a";
}

function renderSpotlight(filteredPolls, selectedDistrict) {
  if (!filteredPolls.length) {
    elements.spotlightTitle.textContent = "No polls match the current filters";
    elements.spotlightContent.innerHTML =
      '<div class="empty-state">Try broadening the constituency, poll type, or search filter.</div>';
    return;
  }

  if (selectedDistrict) {
    elements.spotlightTitle.textContent = `${selectedDistrict.displayName} at a glance`;
    const summary = summarizePolls(filteredPolls);
    const candidates = aggregateCandidateVotes(filteredPolls).sort((left, right) => right.votes - left.votes);
    const winner = candidates[0] || selectedDistrict.winner;
    const pollsWithTurnout = filteredPolls.filter(isEligibleForPollTurnoutRanking);
    const bestPoll = pollsWithTurnout.reduce(
      (best, poll) => (!best || poll.turnoutRate > best.turnoutRate ? poll : best),
      null,
    );
    const worstPoll = pollsWithTurnout.reduce(
      (worst, poll) => (!worst || poll.turnoutRate < worst.turnoutRate ? poll : worst),
      null,
    );
    const candidateMarkup = candidates
      .map(
        (candidate) => `
          <div class="candidate-row">
            <header>
              <div>
                <strong>${escapeHtml(candidate.candidate)}</strong>
                <small>${escapeHtml(candidate.party)}</small>
              </div>
              <div>
                <strong>${numberFormatter.format(candidate.votes)}</strong>
                <small>${percentFormatter.format(candidate.voteShare)}</small>
              </div>
            </header>
            <div class="candidate-track">
              <div class="candidate-fill" style="width: ${candidate.voteShare * 100}%; background: ${getPartyColor(candidate.party)};"></div>
            </div>
          </div>
        `,
      )
      .join("");

    elements.spotlightContent.innerHTML = `
      <div class="spotlight-card">
        <h3>Winning candidate</h3>
        <p>${escapeHtml(winner.candidate)} leads this filtered view for the ${escapeHtml(winner.party)} with ${numberFormatter.format(winner.votes)} votes.</p>
      </div>
      <div class="spotlight-card">
        <h3>Best and worst poll by turnout</h3>
        <div class="poll-turnout-list">
          ${renderPollTurnoutItem(bestPoll, "Best poll")}
          ${renderPollTurnoutItem(worstPoll, "Worst poll")}
        </div>
      </div>
      <div class="spotlight-metrics">
        <div class="metric">
          <strong>${typeof summary.turnoutRate === "number" ? percentFormatter.format(summary.turnoutRate) : "n/a"}</strong>
          <span>turnout in view</span>
        </div>
        <div class="metric">
          <strong>${numberFormatter.format(summary.totalVotes)}</strong>
          <span>ballots cast</span>
        </div>
        <div class="metric">
          <strong>${numberFormatter.format(filteredPolls.length)}</strong>
          <span>polls in view</span>
        </div>
      </div>
      <div class="candidate-list">
        <h3>Vote share in the current selection</h3>
        ${candidateMarkup}
      </div>
    `;
    return;
  }

  const topTurnoutDistricts = summarizeDistrictsFromPolls(filteredPolls)
    .sort((left, right) => right.turnoutRate - left.turnoutRate)
    .slice(0, 5);

  const leadersByVotes = aggregatePartyVotes(filteredPolls)
    .sort((left, right) => right.votes - left.votes)
    .slice(0, 3);

  elements.spotlightTitle.textContent = "Province-wide snapshot";
  elements.spotlightContent.innerHTML = `
    <div class="spotlight-card">
      <h3>Overall turnout</h3>
      <p>The current filtered view covers ${numberFormatter.format(filteredPolls.length)} polls and ${numberFormatter.format(sum(filteredPolls, (poll) => poll.totalVotes))} total ballots cast across Nova Scotia.</p>
    </div>
    <div class="mini-ranks">
      ${topTurnoutDistricts
        .map(
          (district) => `
            <div class="mini-rank">
              <div>
                <strong>${escapeHtml(district.districtDisplayName)}</strong>
                <span>${numberFormatter.format(district.totalVotes)} votes cast</span>
              </div>
              <strong>${typeof district.turnoutRate === "number" ? percentFormatter.format(district.turnoutRate) : "n/a"}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="spotlight-card">
      <h3>Largest party totals in this scope</h3>
      <p>${leadersByVotes
        .map((party) => `${escapeHtml(party.party)} (${numberFormatter.format(party.votes)})`)
        .join(", ")}</p>
    </div>
  `;
}

function renderPartyChart(filteredPolls, selectedDistrict) {
  const aggregates = aggregatePartyVotes(filteredPolls).sort((left, right) => right.votes - left.votes);

  elements.partyChartTitle.textContent = selectedDistrict
    ? `Party totals in ${selectedDistrict.displayName}`
    : "Party vote totals in the current view";

  const chartData = {
    labels: aggregates.map((entry) => entry.party),
    datasets: [
      {
        label: "Votes",
        data: aggregates.map((entry) => entry.votes),
        backgroundColor: aggregates.map((entry) => getPartyColor(entry.party)),
        borderRadius: 10,
        borderSkipped: false,
      },
    ],
  };

  partyChart = buildOrUpdateChart(partyChart, document.querySelector("#partyChart"), {
    type: "bar",
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: themeColor("--chart-muted", "#5e6678") },
          grid: { color: themeColor("--chart-grid", "rgba(31,39,64,0.08)") },
        },
        y: {
          ticks: { color: themeColor("--chart-text", "#1f2740") },
          grid: { display: false },
        },
      },
    },
  });
}

function renderTurnoutChart(filteredPolls, selectedDistrict) {
  const shouldShowPollTurnout =
    Boolean(selectedDistrict) ||
    state.selectedPollType !== "all" ||
    Boolean(state.searchText) ||
    filteredPolls.length <= 30;

  if (shouldShowPollTurnout) {
    const pollsForChart = [...filteredPolls]
      .filter((poll) => typeof poll.turnoutRate === "number")
      .sort((left, right) => {
        if (selectedDistrict) {
          return collator.compare(left.pollCode, right.pollCode);
        }
        return right.turnoutRate - left.turnoutRate;
      })
      .slice(0, 24);

    elements.turnoutChartTitle.textContent = selectedDistrict
      ? `Turnout by poll in ${selectedDistrict.displayName}`
      : "Highest-turnout polls in the current selection";

    turnoutChart = buildOrUpdateChart(turnoutChart, document.querySelector("#turnoutChart"), {
      type: "bar",
      data: {
        labels: pollsForChart.map((poll) =>
          selectedDistrict ? poll.pollCode : `${poll.districtNumber}-${poll.pollCode}`,
        ),
        datasets: [
          {
            label: "Turnout",
            data: pollsForChart.map((poll) => roundPercent(poll.turnoutRate)),
            backgroundColor: pollsForChart.map((poll) => getPartyColor(poll.winner.party)),
            borderRadius: 10,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title(items) {
                const poll = pollsForChart[items[0].dataIndex];
                return `${poll.districtDisplayName} • Poll ${poll.pollCode}`;
              },
              label(context) {
                const poll = pollsForChart[context.dataIndex];
                return `Turnout ${percentFormatter.format(poll.turnoutRate)} at ${poll.location}`;
              },
            },
          },
        },
        scales: {
          y: {
            ticks: {
              color: themeColor("--chart-muted", "#5e6678"),
              callback(value) {
                return `${value}%`;
              },
            },
            suggestedMax: 100,
            grid: { color: themeColor("--chart-grid", "rgba(31,39,64,0.08)") },
          },
          x: {
            ticks: { color: themeColor("--chart-text", "#1f2740") },
            grid: { display: false },
          },
        },
      },
    });
    return;
  }

  const districts = [...state.dataset.districts]
    .sort((left, right) => right.summary.turnoutRate - left.summary.turnoutRate)
    .slice(0, 20);

  elements.turnoutChartTitle.textContent = "Top districts by turnout";

  turnoutChart = buildOrUpdateChart(turnoutChart, document.querySelector("#turnoutChart"), {
    type: "bar",
    data: {
      labels: districts.map((district) => district.displayName),
      datasets: [
        {
          label: "Turnout",
          data: districts.map((district) => roundPercent(district.summary.turnoutRate)),
          backgroundColor: districts.map((district) => getPartyColor(district.winner.party)),
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const district = districts[context.dataIndex];
              return `${percentFormatter.format(district.summary.turnoutRate)} turnout`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: themeColor("--chart-muted", "#5e6678"),
            callback(value) {
              return `${value}%`;
            },
          },
          suggestedMax: 100,
          grid: { color: themeColor("--chart-grid", "rgba(31,39,64,0.08)") },
        },
        y: {
          ticks: { color: themeColor("--chart-text", "#1f2740") },
          grid: { display: false },
        },
      },
    },
  });
}

function renderTable(filteredPolls) {
  elements.tableNote.textContent = `${numberFormatter.format(filteredPolls.length)} poll rows shown`;

  if (!filteredPolls.length) {
    elements.pollTableBody.innerHTML =
      '<tr><td colspan="8" class="empty-state">No polls match the current filters.</td></tr>';
    return;
  }

  const rows = filteredPolls
    .map(
      (poll) => `
        <tr>
          <td data-label="District">${escapeHtml(poll.districtDisplayName)}</td>
          <td data-label="Poll">${escapeHtml(poll.pollCode)}</td>
          <td data-label="Type">${escapeHtml(poll.pollType)}</td>
          <td data-label="Location">${escapeHtml(poll.location)}</td>
          <td data-label="Electors">${poll.electors ? numberFormatter.format(poll.electors) : "n/a"}</td>
          <td data-label="Votes">${numberFormatter.format(poll.totalVotes)}</td>
          <td data-label="Turnout">${typeof poll.turnoutRate === "number" ? percentFormatter.format(poll.turnoutRate) : "n/a"}</td>
          <td data-label="Leading candidate">
            <span class="winner-badge">
              <span class="winner-dot" style="background: ${getPartyColor(poll.winner.party)};"></span>
              ${escapeHtml(poll.winner.candidate)} (${escapeHtml(poll.winner.party)})
            </span>
          </td>
        </tr>
      `,
    )
    .join("");

  elements.pollTableBody.innerHTML = rows;
}

function renderTableVisibility() {
  if (!elements.tableWrap || !elements.tableToggleButton) {
    return;
  }

  elements.tableWrap.classList.toggle("is-collapsed", state.isTableCollapsed);
  elements.tableToggleButton.textContent = state.isTableCollapsed ? "Expand table" : "Collapse table";
  elements.tableToggleButton.setAttribute("aria-expanded", String(!state.isTableCollapsed));
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
          labels: { color: "#1f2740" },
        },
      },
      scales: {
        x: {
          ticks: { color: "#1f2740" },
          grid: { display: false },
        },
        y: {
          ticks: { color: "#5e6678" },
          grid: { color: "rgba(31,39,64,0.08)" },
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

function aggregatePartyVotes(polls) {
  const totals = new Map();
  polls.forEach((poll) => {
    poll.candidates.forEach((candidate) => {
      const current = totals.get(candidate.party) || 0;
      totals.set(candidate.party, current + candidate.votes);
    });
  });

  return [...totals.entries()].map(([party, votes]) => ({ party, votes }));
}

function aggregateCandidateVotes(polls) {
  const totals = new Map();
  polls.forEach((poll) => {
    poll.candidates.forEach((candidate) => {
      const key = `${candidate.candidate}|||${candidate.party}`;
      const current = totals.get(key) || {
        candidate: candidate.candidate,
        party: candidate.party,
        votes: 0,
        voteShare: 0,
      };
      current.votes += candidate.votes;
      totals.set(key, current);
    });
  });

  const validVotes = [...totals.values()].reduce((total, candidate) => total + candidate.votes, 0);
  return [...totals.values()].map((candidate) => ({
    ...candidate,
    voteShare: validVotes ? candidate.votes / validVotes : 0,
  }));
}

function summarizePolls(polls) {
  const totalVotes = sum(polls, (poll) => poll.totalVotes);
  const totalElectors = sum(polls, (poll) => poll.electors || 0);
  return {
    totalVotes,
    totalElectors,
    turnoutRate: totalElectors ? totalVotes / totalElectors : null,
  };
}

function summarizeDistrictsFromPolls(polls) {
  const grouped = new Map();
  polls.forEach((poll) => {
    const current = grouped.get(poll.districtCode) || {
      districtCode: poll.districtCode,
      districtDisplayName: poll.districtDisplayName,
      totalVotes: 0,
      totalElectors: 0,
      turnoutRate: null,
    };
    current.totalVotes += poll.totalVotes;
    current.totalElectors += poll.electors || 0;
    grouped.set(poll.districtCode, current);
  });

  return [...grouped.values()].map((district) => ({
    ...district,
    turnoutRate: district.totalElectors ? district.totalVotes / district.totalElectors : null,
  }));
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

function formatPollTurnoutSummary(poll, label) {
  if (!poll || typeof poll.turnoutRate !== "number") {
    return `${label}: n/a`;
  }

  return `${label}: Poll ${escapeHtml(poll.pollCode)} at ${escapeHtml(poll.location)} with ${percentFormatter.format(poll.turnoutRate)}`;
}

function renderPollTurnoutItem(poll, label) {
  if (!poll || typeof poll.turnoutRate !== "number") {
    return `
      <div class="poll-turnout-item">
        <span class="poll-turnout-label">${label}</span>
        <strong class="poll-turnout-value">n/a</strong>
      </div>
    `;
  }

  return `
    <div class="poll-turnout-item">
      <div>
        <span class="poll-turnout-label">${label}</span>
        <strong class="poll-turnout-value">Poll ${escapeHtml(poll.pollCode)} • ${percentFormatter.format(poll.turnoutRate)}</strong>
      </div>
      <small class="poll-turnout-location">${escapeHtml(poll.location)}</small>
    </div>
  `;
}

function isEligibleForPollTurnoutRanking(poll) {
  if (typeof poll.turnoutRate !== "number") {
    return false;
  }

  if (poll.turnoutRate < 0 || poll.turnoutRate > 1) {
    return false;
  }

  if (!poll.electors || !poll.totalVotes) {
    return false;
  }

  if (poll.pollType !== "Regular Poll") {
    return false;
  }

  return true;
}

function buildOrUpdateChart(existingChart, canvas, config) {
  if (existingChart) {
    existingChart.destroy();
  }
  return new Chart(canvas, config);
}

function getPartyColor(party) {
  return partyColorMap.get(party) || "#5a6472";
}

function sum(values, accessor) {
  return values.reduce((total, value) => total + accessor(value), 0);
}

function roundPercent(value) {
  return Number((value * 100).toFixed(1));
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
  elements.scopeSummary.textContent = "The dashboard could not load the dataset.";
  elements.spotlightTitle.textContent = "Dataset load failed";
  elements.spotlightContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
