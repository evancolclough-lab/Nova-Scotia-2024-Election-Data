const DATA_URL = "./data/nova-scotia-poll-results.json?v=20260415-2";

const state = {
  dataset: null,
  currentElection: "2024",
  selectedDistrict: "all",
  selectedPollType: "all",
  searchText: "",
  isTableCollapsed: true,
};

const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });
const colorSchemeQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

const elements = {
  electionToggle: document.querySelector("#electionToggle"),
  currentElectionLabel: document.querySelector("#currentElectionLabel"),
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
  turnoutChartCanvas: document.querySelector("#turnoutChart"),
  tableNote: document.querySelector("#tableNote"),
  tableToggleButton: document.querySelector("#tableToggleButton"),
  tableWrap: document.querySelector("#tableWrap"),
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

function getSelectedDistrict() {
  const electionData = getElectionData();
  return electionData?.districts.find((district) => district.code === state.selectedDistrict) || null;
}

function getGroupMode() {
  return getElectionMetadata()?.groupMode || "party";
}

function getGroupLabelSingular() {
  return getGroupMode() === "candidate" ? "Candidate" : "Party";
}

function getGroupLabelPlural() {
  return getGroupMode() === "candidate" ? "Candidates" : "Parties";
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

function resetDashboardFilters() {
  state.selectedDistrict = "all";
  state.selectedPollType = "all";
  state.searchText = "";

  if (elements.districtSelect) {
    elements.districtSelect.value = "all";
  }
  if (elements.pollTypeSelect) {
    elements.pollTypeSelect.value = "all";
  }
  if (elements.searchInput) {
    elements.searchInput.value = "";
  }
}

function syncElectionView() {
  const electionData = getElectionData();
  if (!electionData) {
    return;
  }

  resetDashboardFilters();
  hydrateMetadata();
  populateFilters();
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

function populateFilters() {
  const electionData = getElectionData();
  if (!electionData || !elements.districtSelect || !elements.pollTypeSelect) {
    return;
  }

  const districtOptions = electionData.districts
    .slice()
    .sort((left, right) => collator.compare(left.displayName, right.displayName))
    .map((district) => `<option value="${district.code}">${district.displayName}</option>`)
    .join("");

  const pollTypeOptions = Object.keys(electionData.metadata.pollTypes || {})
    .sort(collator.compare)
    .map((pollType) => `<option value="${pollType}">${pollType}</option>`)
    .join("");

  elements.districtSelect.innerHTML = `<option value="all">All constituencies</option>${districtOptions}`;
  elements.pollTypeSelect.innerHTML = `<option value="all">All poll types</option>${pollTypeOptions}`;
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

  elements.districtSelect?.addEventListener("change", (event) => {
    state.selectedDistrict = event.target.value;
    render();
  });

  elements.pollTypeSelect?.addEventListener("change", (event) => {
    state.selectedPollType = event.target.value;
    render();
  });

  elements.searchInput?.addEventListener("input", (event) => {
    state.searchText = event.target.value.trim().toLowerCase();
    render();
  });

  elements.resetButton?.addEventListener("click", () => {
    resetDashboardFilters();
    render();
  });

  elements.tableToggleButton?.addEventListener("click", () => {
    state.isTableCollapsed = !state.isTableCollapsed;
    renderTableVisibility();
  });

  if (colorSchemeQuery?.addEventListener) {
    colorSchemeQuery.addEventListener("change", () => {
      render();
    });
  }
}

function getFilteredPolls() {
  const electionData = getElectionData();
  if (!electionData) {
    return [];
  }

  return electionData.polls
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
        poll.candidates.map((candidate) => candidate.candidate).join(" "),
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
  const electionData = getElectionData();
  if (!electionData) {
    return;
  }

  const filteredPolls = getFilteredPolls();
  const uniqueDistricts = new Set(filteredPolls.map((poll) => poll.districtCode));
  const selectedDistrict = getSelectedDistrict();

  renderScopeSummary(filteredPolls, selectedDistrict, uniqueDistricts.size);
  renderStats(filteredPolls, uniqueDistricts.size);
  renderSpotlight(filteredPolls, selectedDistrict);
  renderGroupChart(filteredPolls, selectedDistrict);
  renderTurnoutChart(filteredPolls, selectedDistrict);
  renderTable(filteredPolls);
  renderTableVisibility();
}

function renderScopeSummary(filteredPolls, selectedDistrict, districtCount) {
  if (!elements.scopeSummary) {
    return;
  }

  const electionMetadata = getElectionMetadata();
  const scopeLabel = selectedDistrict ? selectedDistrict.displayName : "all constituencies";
  const pollTypeLabel = state.selectedPollType === "all" ? "all poll types" : state.selectedPollType;
  const searchLabel = state.searchText ? ` Matching "${state.searchText}".` : "";

  elements.scopeSummary.textContent =
    `Showing ${numberFormatter.format(filteredPolls.length)} polls across ${numberFormatter.format(districtCount)} ` +
    `${districtCount === 1 ? "district" : "districts"} in ${scopeLabel} for the ${electionMetadata?.electionLabel || ""} election, filtered to ${pollTypeLabel}.${searchLabel}`;
}

function renderStats(filteredPolls, districtCount) {
  const totalVotes = sum(filteredPolls, (poll) => poll.totalVotes);
  const totalElectors = sum(filteredPolls, (poll) => poll.electors || 0);
  const turnoutRate = totalElectors ? totalVotes / totalElectors : 0;

  if (elements.districtCountStat) {
    elements.districtCountStat.textContent = numberFormatter.format(districtCount);
  }
  if (elements.pollCountStat) {
    elements.pollCountStat.textContent = numberFormatter.format(filteredPolls.length);
  }
  if (elements.votesStat) {
    elements.votesStat.textContent = numberFormatter.format(totalVotes);
  }
  if (elements.turnoutStat) {
    elements.turnoutStat.textContent = totalElectors ? percentFormatter.format(turnoutRate) : "n/a";
  }
}

function renderSpotlight(filteredPolls, selectedDistrict) {
  if (!elements.spotlightTitle || !elements.spotlightContent) {
    return;
  }

  if (!filteredPolls.length) {
    elements.spotlightTitle.textContent = "No polls match the current filters";
    elements.spotlightContent.innerHTML =
      '<div class="empty-state">Try broadening the constituency, poll type, or search filter.</div>';
    return;
  }

  if (selectedDistrict) {
    renderDistrictSpotlight(filteredPolls, selectedDistrict);
    return;
  }

  const groupLabel = getGroupLabelSingular().toLowerCase();
  const topTurnoutDistricts = summarizeDistrictsFromPolls(filteredPolls)
    .filter((district) => typeof district.turnoutRate === "number")
    .sort((left, right) => right.turnoutRate - left.turnoutRate)
    .slice(0, 5);

  const leadersByVotes = aggregateGroupVotes(filteredPolls)
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
              <strong>${percentFormatter.format(district.turnoutRate)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="spotlight-card">
      <h3>Largest ${groupLabel} totals in this scope</h3>
      <p>${leadersByVotes.length ? leadersByVotes.map((entry) => `${escapeHtml(entry.label)} (${numberFormatter.format(entry.votes)})`).join(", ") : "No vote totals are available for this view."}</p>
    </div>
  `;
}

function renderDistrictSpotlight(filteredPolls, selectedDistrict) {
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

  elements.spotlightTitle.textContent = `${selectedDistrict.displayName} at a glance`;
  elements.spotlightContent.innerHTML = `
    <div class="spotlight-card">
      <h3>Leading candidate</h3>
      <p>${escapeHtml(winner.candidate)} leads this filtered view with ${numberFormatter.format(winner.votes)} votes.</p>
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
      ${candidates
        .map(
          (candidate) => `
            <div class="candidate-row">
              <header>
                <div>
                  <strong>${escapeHtml(candidate.candidate)}</strong>
                  ${renderCandidateSubtext(candidate)}
                </div>
                <div>
                  <strong>${numberFormatter.format(candidate.votes)}</strong>
                  <small>${percentFormatter.format(candidate.voteShare)}</small>
                </div>
              </header>
              <div class="candidate-track">
                <div class="candidate-fill" style="width: ${candidate.voteShare * 100}%; background: ${escapeHtml(candidate.groupColor)};"></div>
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderGroupChart(filteredPolls, selectedDistrict) {
  if (typeof Chart === "undefined") {
    return;
  }

  const aggregates = aggregateGroupVotes(filteredPolls).sort((left, right) => right.votes - left.votes);
  const groupLabel = getGroupLabelSingular();
  const chartEntries =
    !selectedDistrict && getGroupMode() === "candidate" ? aggregates.slice(0, 15) : aggregates;

  if (elements.partyChartTitle) {
    elements.partyChartTitle.textContent = selectedDistrict
      ? `${groupLabel} vote totals in ${selectedDistrict.displayName}`
      : `${groupLabel} vote totals in the current view`;
  }

  partyChart = buildOrUpdateChart(partyChart, document.querySelector("#partyChart"), {
    type: "bar",
    data: {
      labels: chartEntries.map((entry) => entry.label),
      datasets: [
        {
          label: "Votes",
          data: chartEntries.map((entry) => entry.votes),
          backgroundColor: chartEntries.map((entry) => entry.color),
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
  if (typeof Chart === "undefined") {
    return;
  }

  const electionData = getElectionData();
  const shouldShowPollTurnout =
    Boolean(selectedDistrict) ||
    state.selectedPollType !== "all" ||
    Boolean(state.searchText) ||
    filteredPolls.length <= 30;

  if (shouldShowPollTurnout) {
    const pollsForChart = filteredPolls
      .filter((poll) => typeof poll.turnoutRate === "number")
      .sort((left, right) => {
        if (selectedDistrict) {
          return collator.compare(left.pollCode, right.pollCode);
        }
        return right.turnoutRate - left.turnoutRate;
      })
      .slice(0, 24);

    if (elements.turnoutChartTitle) {
      elements.turnoutChartTitle.textContent = selectedDistrict
        ? `Turnout by poll in ${selectedDistrict.displayName}`
        : "Highest-turnout polls in the current selection";
    }

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
            backgroundColor: pollsForChart.map(getWinnerColor),
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
    setTurnoutChartHeight(Math.max(320, pollsForChart.length * 30));
    return;
  }

  const districts = electionData.districts
    .slice()
    .filter((district) => typeof district.summary.turnoutRate === "number")
    .sort((left, right) => right.summary.turnoutRate - left.summary.turnoutRate)
    .slice(0, 20);

  if (elements.turnoutChartTitle) {
    elements.turnoutChartTitle.textContent = "Top districts by turnout";
  }

  turnoutChart = buildOrUpdateChart(turnoutChart, document.querySelector("#turnoutChart"), {
    type: "bar",
    data: {
      labels: districts.map((district) => wrapChartLabel(district.displayName, 18)),
      datasets: [
        {
          label: "Turnout",
          data: districts.map((district) => roundPercent(district.summary.turnoutRate)),
          backgroundColor: districts.map(getWinnerColor),
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
          ticks: {
            color: themeColor("--chart-text", "#1f2740"),
            autoSkip: false,
          },
          grid: { display: false },
        },
      },
    },
  });
  setTurnoutChartHeight(Math.max(420, districts.length * 42));
}

function renderTable(filteredPolls) {
  if (elements.tableNote) {
    elements.tableNote.textContent = `${numberFormatter.format(filteredPolls.length)} poll rows shown`;
  }

  if (!elements.pollTableBody) {
    return;
  }

  if (!filteredPolls.length) {
    elements.pollTableBody.innerHTML =
      '<tr><td colspan="8" class="empty-state">No polls match the current filters.</td></tr>';
    return;
  }

  elements.pollTableBody.innerHTML = filteredPolls
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
              <span class="winner-dot" style="background: ${escapeHtml(getWinnerColor(poll))};"></span>
              ${escapeHtml(formatWinnerDisplay(poll.winner))}
            </span>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderTableVisibility() {
  if (!elements.tableWrap || !elements.tableToggleButton) {
    return;
  }

  elements.tableWrap.classList.toggle("is-collapsed", state.isTableCollapsed);
  elements.tableToggleButton.textContent = state.isTableCollapsed ? "Expand table" : "Collapse table";
  elements.tableToggleButton.setAttribute("aria-expanded", String(!state.isTableCollapsed));
}

function aggregateGroupVotes(polls) {
  const totals = new Map();

  polls.forEach((poll) => {
    poll.candidates.forEach((candidate) => {
      const key = candidate.groupLabel || candidate.party || candidate.candidate;
      const current = totals.get(key) || {
        label: key,
        color: candidate.groupColor || candidate.color || "#5a6472",
        votes: 0,
      };
      current.votes += candidate.votes;
      totals.set(key, current);
    });
  });

  return [...totals.values()];
}

function aggregateCandidateVotes(polls) {
  const totals = new Map();

  polls.forEach((poll) => {
    poll.candidates.forEach((candidate) => {
      const key = `${candidate.candidate}|||${candidate.party}|||${candidate.groupColor || candidate.color || ""}`;
      const current = totals.get(key) || {
        candidate: candidate.candidate,
        party: candidate.party,
        groupColor: candidate.groupColor || candidate.color || "#5a6472",
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

function renderCandidateSubtext(candidate) {
  if (getGroupMode() !== "party" || !candidate.party) {
    return "";
  }
  return `<small>${escapeHtml(candidate.party)}</small>`;
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

  return poll.pollType === "Regular Poll";
}

function getWinnerColor(result) {
  if (!result?.candidates?.length) {
    return "#5a6472";
  }

  const winnerName = normalizeText(result.winner?.candidate);
  const winnerCandidate = result.candidates.find(
    (candidate) => normalizeText(candidate.candidate) === winnerName,
  );
  return winnerCandidate?.groupColor || winnerCandidate?.color || "#5a6472";
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

function sum(values, accessor) {
  return values.reduce((total, value) => total + accessor(value), 0);
}

function roundPercent(value) {
  return Number((value * 100).toFixed(1));
}

function wrapChartLabel(label, maxLength) {
  const words = String(label || "").split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [""];
  }

  const lines = [];
  let currentLine = words[0];

  for (const word of words.slice(1)) {
    const nextLine = `${currentLine} ${word}`;
    if (nextLine.length <= maxLength) {
      currentLine = nextLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  lines.push(currentLine);
  return lines;
}

function setTurnoutChartHeight(minHeight) {
  const chartWrap = elements.turnoutChartCanvas?.closest(".chart-wrap");
  if (!chartWrap) {
    return;
  }

  chartWrap.style.minHeight = `${minHeight}px`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

init().catch((error) => {
  console.error(error);
  if (elements.scopeSummary) {
    elements.scopeSummary.textContent = "The dashboard could not load the dataset.";
  }
  if (elements.spotlightTitle) {
    elements.spotlightTitle.textContent = "Dataset load failed";
  }
  if (elements.spotlightContent) {
    elements.spotlightContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
});
