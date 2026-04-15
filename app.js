const DATA_URL = "./data/nova-scotia-poll-results.json";

const state = {
  dataset: null,
  selectedDistrict: "all",
  selectedPollType: "all",
  searchText: "",
};

const partyColorMap = new Map();
const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });

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
  spotlightTitle: document.querySelector("#spotlightTitle"),
  spotlightContent: document.querySelector("#spotlightContent"),
  partyChartTitle: document.querySelector("#partyChartTitle"),
  turnoutChartTitle: document.querySelector("#turnoutChartTitle"),
  tableNote: document.querySelector("#tableNote"),
  pollTableBody: document.querySelector("#pollTableBody"),
};

let partyChart;
let turnoutChart;

const numberFormatter = new Intl.NumberFormat("en-CA");
const percentFormatter = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

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
  renderSpotlight(filteredPolls, selectedDistrict);
  renderPartyChart(filteredPolls, selectedDistrict);
  renderTurnoutChart(filteredPolls, selectedDistrict);
  renderTable(filteredPolls);
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
          ticks: { color: "#5e6678" },
          grid: { color: "rgba(31,39,64,0.08)" },
        },
        y: {
          ticks: { color: "#1f2740" },
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
              color: "#5e6678",
              callback(value) {
                return `${value}%`;
              },
            },
            suggestedMax: 100,
            grid: { color: "rgba(31,39,64,0.08)" },
          },
          x: {
            ticks: { color: "#1f2740" },
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
            color: "#5e6678",
            callback(value) {
              return `${value}%`;
            },
          },
          suggestedMax: 100,
          grid: { color: "rgba(31,39,64,0.08)" },
        },
        y: {
          ticks: { color: "#1f2740" },
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
          <td>${escapeHtml(poll.districtDisplayName)}</td>
          <td>${escapeHtml(poll.pollCode)}</td>
          <td>${escapeHtml(poll.pollType)}</td>
          <td>${escapeHtml(poll.location)}</td>
          <td>${poll.electors ? numberFormatter.format(poll.electors) : "n/a"}</td>
          <td>${numberFormatter.format(poll.totalVotes)}</td>
          <td>${typeof poll.turnoutRate === "number" ? percentFormatter.format(poll.turnoutRate) : "n/a"}</td>
          <td>
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
