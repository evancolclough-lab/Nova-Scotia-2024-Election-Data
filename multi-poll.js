const DATA_URL = "./data/nova-scotia-poll-results.json?v=20260416-3";
const MAX_POLLS = 10;

const state = {
  dataset: null,
  currentElection: "2024",
  districtSearch: "",
  pollSearch: "",
  selectedDistricts: new Set(),
  selectedPolls: new Set(),
  limitWarning: false,
  currentStep: 1,
};

const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });
const numberFormatter = new Intl.NumberFormat("en-CA");
const percentFormatter = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const elements = {
  electionToggle: document.querySelector("#electionToggle"),
  currentElectionLabel: document.querySelector("#currentElectionLabel"),
  sourceWorkbook: document.querySelector("#sourceWorkbook"),
  generatedAt: document.querySelector("#generatedAt"),
  selectionStatus: document.querySelector("#selectionStatus"),
  stepOneDisclosure: document.querySelector("#stepOneDisclosure"),
  stepTwoDisclosure: document.querySelector("#stepTwoDisclosure"),
  stepOneNextButton: document.querySelector("#stepOneNextButton"),
  stepTwoBackButton: document.querySelector("#stepTwoBackButton"),
  stepTwoNextButton: document.querySelector("#stepTwoNextButton"),
  resultsEditButton: document.querySelector("#resultsEditButton"),
  analysisResults: document.querySelector("#analysisResults"),
  analysisDistrictSearch: document.querySelector("#analysisDistrictSearch"),
  analysisPollSearch: document.querySelector("#analysisPollSearch"),
  analysisDistrictList: document.querySelector("#analysisDistrictList"),
  analysisPollList: document.querySelector("#analysisPollList"),
  selectedDistrictChips: document.querySelector("#selectedDistrictChips"),
  selectedPollChips: document.querySelector("#selectedPollChips"),
  analysisDistrictSummaryCount: document.querySelector("#analysisDistrictSummaryCount"),
  analysisPollSummaryCount: document.querySelector("#analysisPollSummaryCount"),
  analysisDistrictCount: document.querySelector("#analysisDistrictCount"),
  analysisPollCount: document.querySelector("#analysisPollCount"),
  analysisVotesStat: document.querySelector("#analysisVotesStat"),
  analysisTurnoutStat: document.querySelector("#analysisTurnoutStat"),
  analysisTurnoutContent: document.querySelector("#analysisTurnoutContent"),
  analysisMarginGrid: document.querySelector("#analysisMarginGrid"),
  analysisTableBody: document.querySelector("#analysisTableBody"),
};

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
  elements.electionToggle?.querySelectorAll("[data-election]").forEach((button) => {
    const isActive = button.dataset.election === state.currentElection;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncElectionView() {
  state.districtSearch = "";
  state.pollSearch = "";
  state.selectedDistricts = new Set();
  state.selectedPolls = new Set();
  state.limitWarning = false;
  state.currentStep = 1;

  if (elements.analysisDistrictSearch) {
    elements.analysisDistrictSearch.value = "";
  }
  if (elements.analysisPollSearch) {
    elements.analysisPollSearch.value = "";
  }

  hydrateMetadata();
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

  elements.analysisDistrictSearch?.addEventListener("input", (event) => {
    state.districtSearch = event.target.value.trim().toLowerCase();
    renderDistrictList();
  });

  elements.stepOneDisclosure?.querySelector("summary")?.addEventListener("click", (event) => {
    event.preventDefault();
    state.currentStep = 1;
    render();
  });

  elements.stepTwoDisclosure?.querySelector("summary")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!state.selectedDistricts.size) {
      state.currentStep = 1;
      renderSelectionStatus("Choose at least one district before opening poll selection.");
      renderStepFlow();
      return;
    }

    state.currentStep = 2;
    render();
  });

  elements.analysisPollSearch?.addEventListener("input", (event) => {
    state.pollSearch = event.target.value.trim().toLowerCase();
    renderPollList();
  });

  elements.analysisDistrictList?.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement)) {
      return;
    }

    const districtCode = checkbox.value;
    if (checkbox.checked) {
      state.selectedDistricts.add(districtCode);
    } else {
      state.selectedDistricts.delete(districtCode);
      prunePollSelections();
    }

    state.limitWarning = false;
    reconcileCurrentStep();
    render();
  });

  elements.analysisPollList?.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement)) {
      return;
    }

    const pollId = checkbox.value;
    if (checkbox.checked) {
      if (state.selectedPolls.size >= MAX_POLLS) {
        checkbox.checked = false;
        state.limitWarning = true;
        renderSelectionStatus();
        return;
      }
      state.selectedPolls.add(pollId);
    } else {
      state.selectedPolls.delete(pollId);
    }

    state.limitWarning = false;
    reconcileCurrentStep();
    render();
  });

  elements.selectedPollChips?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-poll]");
    if (!button) {
      return;
    }

    state.selectedPolls.delete(button.dataset.removePoll);
    state.limitWarning = false;
    reconcileCurrentStep();
    render();
  });

  elements.stepOneNextButton?.addEventListener("click", () => {
    if (!state.selectedDistricts.size) {
      state.currentStep = 1;
      renderSelectionStatus("Select at least one district before moving to poll selection.");
      renderStepFlow();
      return;
    }

    state.currentStep = 2;
    state.limitWarning = false;
    render();
  });

  elements.stepTwoBackButton?.addEventListener("click", () => {
    state.currentStep = 1;
    state.limitWarning = false;
    render();
  });

  elements.stepTwoNextButton?.addEventListener("click", () => {
    if (!state.selectedPolls.size) {
      state.currentStep = 2;
      renderSelectionStatus("Select at least one poll before opening the analysis.");
      renderStepFlow();
      return;
    }

    state.currentStep = 3;
    state.limitWarning = false;
    render();
  });

  elements.resultsEditButton?.addEventListener("click", () => {
    state.currentStep = 2;
    render();
  });
}

function render() {
  renderStepFlow();
  renderDistrictList();
  renderPollList();
  renderSelectedDistrictChips();
  renderSelectedPollChips();
  renderSelectionStatus();
  renderStats();
  renderTurnoutMetrics();
  renderMargins();
  renderComparisonTable();
}

function renderStepFlow() {
  const atResults = state.currentStep >= 3;
  if (elements.stepOneDisclosure) {
    elements.stepOneDisclosure.open = state.currentStep === 1;
  }
  if (elements.stepTwoDisclosure) {
    elements.stepTwoDisclosure.open = state.currentStep === 2;
  }
  if (elements.analysisResults) {
    elements.analysisResults.classList.toggle("is-hidden", !atResults);
  }
}

function renderDistrictList() {
  const electionData = getElectionData();
  if (!electionData || !elements.analysisDistrictList) {
    return;
  }

  const districts = electionData.districts
    .slice()
    .sort((left, right) => collator.compare(left.displayName, right.displayName))
    .filter((district) => district.displayName.toLowerCase().includes(state.districtSearch));

  elements.analysisDistrictList.innerHTML = districts.length
    ? districts
        .map(
          (district) => `
            <label class="selection-item">
              <input type="checkbox" value="${escapeHtml(district.code)}" ${
                state.selectedDistricts.has(district.code) ? "checked" : ""
              } />
              <span>
                <strong>${escapeHtml(district.displayName)}</strong>
                <small>${numberFormatter.format(district.pollCount)} polls in this district</small>
              </span>
            </label>
          `,
        )
        .join("")
    : '<div class="empty-state">No districts match that search.</div>';
}

function renderPollList() {
  if (!elements.analysisPollList) {
    return;
  }

  if (!state.selectedDistricts.size) {
    elements.analysisPollList.innerHTML =
      '<div class="empty-state">Select one or more districts to view polls.</div>';
    return;
  }

  const polls = getAvailablePolls().filter((poll) => {
    if (!state.pollSearch) {
      return true;
    }
    const haystack = [
      poll.districtDisplayName,
      poll.pollCode,
      poll.pollType,
      poll.location,
      formatWinnerDisplay(poll.winner),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.pollSearch);
  });

  if (!polls.length) {
    elements.analysisPollList.innerHTML =
      '<div class="empty-state">No polls match the current district and poll search.</div>';
    return;
  }

  const groupedPolls = new Map();
  polls.forEach((poll) => {
    const current = groupedPolls.get(poll.districtCode) || [];
    current.push(poll);
    groupedPolls.set(poll.districtCode, current);
  });

  const electionData = getElectionData();
  const orderedDistricts = electionData.districts.filter((district) => groupedPolls.has(district.code));

  elements.analysisPollList.innerHTML = orderedDistricts
    .map((district) => {
      const districtPolls = groupedPolls.get(district.code) || [];
      const selectedCount = districtPolls.filter((poll) => state.selectedPolls.has(poll.id)).length;
      const shouldOpen = selectedCount > 0 || orderedDistricts.length === 1;
      return `
        <details class="poll-group-card poll-group-disclosure" ${shouldOpen ? "open" : ""}>
          <summary class="poll-group-header">
            <div>
              <p class="compare-label">District</p>
              <h4>${escapeHtml(district.displayName)}</h4>
            </div>
            <div class="poll-group-summary-meta">
              <span class="poll-group-count">${numberFormatter.format(districtPolls.length)} polls</span>
              <span class="poll-group-count">${numberFormatter.format(selectedCount)} selected</span>
            </div>
          </summary>
          <div class="poll-group-list">
            ${districtPolls
              .map(
                (poll) => `
                  <label class="selection-item poll-selection-item">
                    <input type="checkbox" value="${escapeHtml(poll.id)}" ${
                      state.selectedPolls.has(poll.id) ? "checked" : ""
                    } />
                    <span>
                      <strong>Poll ${escapeHtml(poll.pollCode)}</strong>
                      <small>${escapeHtml(poll.pollType)} • ${escapeHtml(poll.location)}</small>
                    </span>
                    <span class="poll-selection-meta">
                      <strong>${typeof poll.turnoutRate === "number" ? percentFormatter.format(poll.turnoutRate) : "n/a"}</strong>
                      <small>${numberFormatter.format(poll.totalVotes)} votes</small>
                    </span>
                  </label>
                `,
              )
              .join("")}
          </div>
        </details>
      `;
    })
    .join("");
}

function renderSelectedDistrictChips() {
  if (!elements.selectedDistrictChips) {
    return;
  }

  const electionData = getElectionData();
  const districts = electionData
    ? electionData.districts
        .filter((district) => state.selectedDistricts.has(district.code))
        .sort((left, right) => collator.compare(left.displayName, right.displayName))
    : [];

  elements.selectedDistrictChips.innerHTML = districts.length
    ? districts
        .map(
          (district) => `
            <span class="selection-chip selection-chip-static">${escapeHtml(district.displayName)}</span>
          `,
        )
        .join("")
    : '<div class="selection-chip-empty">No districts selected yet.</div>';
}

function renderSelectedPollChips() {
  if (!elements.selectedPollChips) {
    return;
  }

  const polls = getSelectedPolls();
  elements.selectedPollChips.innerHTML = polls.length
    ? polls
        .map(
          (poll) => `
            <button class="selection-chip" type="button" data-remove-poll="${escapeHtml(poll.id)}">
              ${escapeHtml(poll.districtDisplayName)} • ${escapeHtml(poll.pollCode)}
            </button>
          `,
        )
        .join("")
    : '<div class="selection-chip-empty">No polls selected yet.</div>';
}

function renderSelectionStatus(overrideMessage = "") {
  if (!elements.selectionStatus) {
    return;
  }

  if (elements.analysisDistrictSummaryCount) {
    elements.analysisDistrictSummaryCount.textContent = `${numberFormatter.format(state.selectedDistricts.size)} selected`;
  }
  if (elements.analysisPollSummaryCount) {
    elements.analysisPollSummaryCount.textContent = `${numberFormatter.format(state.selectedPolls.size)} selected`;
  }

  if (overrideMessage) {
    elements.selectionStatus.textContent = overrideMessage;
    return;
  }

  if (!state.selectedDistricts.size) {
    elements.selectionStatus.textContent = "Select one or more districts to unlock poll selection.";
    return;
  }

  if (state.limitWarning) {
    elements.selectionStatus.textContent = `You can select up to ${MAX_POLLS} polls at once. Remove one before adding another.`;
    return;
  }

  if (!state.selectedPolls.size) {
    elements.selectionStatus.textContent = `Choose up to ${MAX_POLLS} polls from the selected districts.`;
    return;
  }

  const selectedCount = state.selectedPolls.size;
  elements.selectionStatus.textContent =
    `${selectedCount} of ${MAX_POLLS} polls selected across ${state.selectedDistricts.size} districts.`;
}

function renderStats() {
  const selectedPolls = getSelectedPolls();
  const totalVotes = sum(selectedPolls, (poll) => poll.totalVotes);
  const totalElectors = sum(selectedPolls, (poll) => poll.electors || 0);
  const turnoutRate = totalElectors ? totalVotes / totalElectors : null;
  const districtCount = state.selectedDistricts.size;

  if (elements.analysisDistrictCount) {
    elements.analysisDistrictCount.textContent = numberFormatter.format(districtCount);
  }
  if (elements.analysisPollCount) {
    elements.analysisPollCount.textContent = numberFormatter.format(selectedPolls.length);
  }
  if (elements.analysisVotesStat) {
    elements.analysisVotesStat.textContent = selectedPolls.length ? numberFormatter.format(totalVotes) : "-";
  }
  if (elements.analysisTurnoutStat) {
    elements.analysisTurnoutStat.textContent = turnoutRate !== null ? percentFormatter.format(turnoutRate) : "-";
  }
}

function renderTurnoutMetrics() {
  if (!elements.analysisTurnoutContent) {
    return;
  }

  if (!state.selectedDistricts.size) {
    elements.analysisTurnoutContent.innerHTML =
      '<div class="empty-state">Select districts to start multi-poll analysis.</div>';
    return;
  }

  const selectedPolls = getSelectedPolls();
  if (!selectedPolls.length) {
    elements.analysisTurnoutContent.innerHTML =
      '<div class="empty-state">Select one or more polls to see turnout metrics.</div>';
    return;
  }

  const totalVotes = sum(selectedPolls, (poll) => poll.totalVotes);
  const totalElectors = sum(selectedPolls, (poll) => poll.electors || 0);
  const turnoutRate = totalElectors ? totalVotes / totalElectors : null;
  const turnoutPolls = selectedPolls.filter((poll) => typeof poll.turnoutRate === "number");
  const bestPoll = turnoutPolls.reduce(
    (best, poll) => (!best || poll.turnoutRate > best.turnoutRate ? poll : best),
    null,
  );
  const worstPoll = turnoutPolls.reduce(
    (worst, poll) => (!worst || poll.turnoutRate < worst.turnoutRate ? poll : worst),
    null,
  );

  elements.analysisTurnoutContent.innerHTML = `
    <div class="spotlight-card">
      <h3>Coverage</h3>
      <p>${numberFormatter.format(totalVotes)} votes cast across ${numberFormatter.format(totalElectors)} eligible voters in the selected polls.</p>
    </div>
    <div class="spotlight-metrics">
      <div class="metric">
        <strong>${turnoutRate !== null ? percentFormatter.format(turnoutRate) : "n/a"}</strong>
        <span>weighted turnout</span>
      </div>
      <div class="metric">
        <strong>${numberFormatter.format(selectedPolls.length)}</strong>
        <span>polls selected</span>
      </div>
      <div class="metric">
        <strong>${numberFormatter.format(new Set(selectedPolls.map((poll) => poll.districtCode)).size)}</strong>
        <span>districts covered</span>
      </div>
    </div>
    <div class="poll-turnout-list">
      ${renderPollTurnoutCard(bestPoll, "Best poll")}
      ${renderPollTurnoutCard(worstPoll, "Worst poll")}
    </div>
  `;
}

function renderMargins() {
  if (!elements.analysisMarginGrid) {
    return;
  }

  if (!state.selectedDistricts.size) {
    elements.analysisMarginGrid.innerHTML =
      '<div class="empty-state">Select districts to unlock district margin analysis.</div>';
    return;
  }

  const selectedPolls = getSelectedPolls();
  if (!selectedPolls.length) {
    elements.analysisMarginGrid.innerHTML =
      '<div class="empty-state">Select one or more polls to calculate district margins.</div>';
    return;
  }

  const margins = summarizeDistrictMargins(selectedPolls);
  elements.analysisMarginGrid.innerHTML = margins
    .map(
      (entry) => `
        <article class="margin-card">
          <p class="compare-label">District margin</p>
          <h3>${escapeHtml(entry.districtDisplayName)}</h3>
          <div class="compare-metrics">
            ${renderMetricLine("Leader", escapeHtml(formatWinnerDisplay(entry.leader)))}
            ${renderMetricLine("Runner-up", entry.runnerUp ? escapeHtml(formatWinnerDisplay(entry.runnerUp)) : "n/a")}
            ${renderMetricLine("Margin", numberFormatter.format(entry.marginVotes))}
            ${renderMetricLine("Selected polls", numberFormatter.format(entry.pollCount))}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderComparisonTable() {
  if (!elements.analysisTableBody) {
    return;
  }

  if (!state.selectedDistricts.size) {
    elements.analysisTableBody.innerHTML =
      '<tr><td colspan="7" class="empty-state">Select districts to build the multi-poll table.</td></tr>';
    return;
  }

  const selectedPolls = getSelectedPolls();
  if (!selectedPolls.length) {
    elements.analysisTableBody.innerHTML =
      '<tr><td colspan="7" class="empty-state">Select one or more polls to compare them here.</td></tr>';
    return;
  }

  const districtMargins = new Map(
    summarizeDistrictMargins(selectedPolls).map((entry) => [entry.districtCode, entry]),
  );

  elements.analysisTableBody.innerHTML = selectedPolls
    .map((poll) => {
      const districtMargin = districtMargins.get(poll.districtCode);
      return `
        <tr>
          <td data-label="District">${escapeHtml(poll.districtDisplayName)}</td>
          <td data-label="Poll">${escapeHtml(poll.pollCode)}</td>
          <td data-label="Turnout">${typeof poll.turnoutRate === "number" ? percentFormatter.format(poll.turnoutRate) : "n/a"}</td>
          <td data-label="Votes / Electors">${numberFormatter.format(poll.totalVotes)} / ${poll.electors ? numberFormatter.format(poll.electors) : "n/a"}</td>
          <td data-label="Leader">${escapeHtml(formatWinnerDisplay(poll.winner))}</td>
          <td data-label="District margin">${districtMargin ? numberFormatter.format(districtMargin.marginVotes) : "n/a"}</td>
          <td data-label="Candidate totals">
            <div class="candidate-stack">
              ${poll.candidates
                .slice()
                .sort((left, right) => right.votes - left.votes)
                .map(
                  (candidate) => `
                    <div class="candidate-stack-row">
                      <span>${escapeHtml(formatCandidateLabel(candidate))}</span>
                      <strong>${numberFormatter.format(candidate.votes)}</strong>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function getAvailablePolls() {
  const electionData = getElectionData();
  if (!electionData) {
    return [];
  }

  return electionData.polls
    .filter((poll) => state.selectedDistricts.has(poll.districtCode))
    .sort((left, right) => {
      if (left.districtDisplayName !== right.districtDisplayName) {
        return collator.compare(left.districtDisplayName, right.districtDisplayName);
      }
      return collator.compare(left.pollCode, right.pollCode);
    });
}

function getSelectedPolls() {
  const electionData = getElectionData();
  if (!electionData) {
    return [];
  }

  return electionData.polls
    .filter((poll) => state.selectedPolls.has(poll.id))
    .sort((left, right) => {
      if (left.districtDisplayName !== right.districtDisplayName) {
        return collator.compare(left.districtDisplayName, right.districtDisplayName);
      }
      return collator.compare(left.pollCode, right.pollCode);
    });
}

function prunePollSelections() {
  const validPollIds = new Set(getAvailablePolls().map((poll) => poll.id));
  state.selectedPolls = new Set([...state.selectedPolls].filter((pollId) => validPollIds.has(pollId)));
}

function reconcileCurrentStep() {
  if (!state.selectedDistricts.size) {
    state.currentStep = 1;
    return;
  }

  if (!state.selectedPolls.size && state.currentStep >= 3) {
    state.currentStep = 2;
  }
}

function summarizeDistrictMargins(polls) {
  const grouped = new Map();

  polls.forEach((poll) => {
    const current = grouped.get(poll.districtCode) || {
      districtCode: poll.districtCode,
      districtDisplayName: poll.districtDisplayName,
      pollCount: 0,
      candidates: new Map(),
    };

    current.pollCount += 1;
    poll.candidates.forEach((candidate) => {
      const key = `${candidate.candidate}|||${candidate.party}`;
      const existing = current.candidates.get(key) || {
        candidate: candidate.candidate,
        party: candidate.party,
        votes: 0,
      };
      existing.votes += candidate.votes;
      current.candidates.set(key, existing);
    });

    grouped.set(poll.districtCode, current);
  });

  return [...grouped.values()]
    .map((district) => {
      const ranked = [...district.candidates.values()].sort((left, right) => right.votes - left.votes);
      const leader = ranked[0] || null;
      const runnerUp = ranked[1] || null;
      return {
        districtCode: district.districtCode,
        districtDisplayName: district.districtDisplayName,
        pollCount: district.pollCount,
        leader,
        runnerUp,
        marginVotes: leader ? leader.votes - (runnerUp?.votes || 0) : 0,
      };
    })
    .sort((left, right) => collator.compare(left.districtDisplayName, right.districtDisplayName));
}

function renderPollTurnoutCard(poll, label) {
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
        <strong class="poll-turnout-value">${escapeHtml(poll.districtDisplayName)} • Poll ${escapeHtml(poll.pollCode)} • ${percentFormatter.format(poll.turnoutRate)}</strong>
      </div>
      <small class="poll-turnout-location">${escapeHtml(poll.location)}</small>
    </div>
  `;
}

function renderMetricLine(label, value) {
  return `
    <div class="compare-metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function formatCandidateLabel(candidate) {
  if (getGroupMode() === "candidate" || !candidate.party) {
    return candidate.candidate;
  }
  return `${candidate.candidate} (${candidate.party})`;
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

function sum(values, accessor) {
  return values.reduce((total, value) => total + accessor(value), 0);
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
  if (elements.selectionStatus) {
    elements.selectionStatus.textContent = "The multi-poll analysis page could not load the dataset.";
  }
  if (elements.analysisTurnoutContent) {
    elements.analysisTurnoutContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
  if (elements.analysisMarginGrid) {
    elements.analysisMarginGrid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
  if (elements.analysisTableBody) {
    elements.analysisTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
  }
});
