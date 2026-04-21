const RESULTS_URL = "./data/nova-scotia-poll-results.json?v=20260416-3";
const MAP_URL = "./data/nova-scotia-poll-map.json?v=20260416-1";
const DEFAULT_CENTER = [44.95, -63.6];
const DEFAULT_ZOOM = 7;
const PARTY_COLOR_LOOKUP_2024 = {
  "PC Party": "#1f4db5",
  NSNDP: "#f28f16",
  NDP: "#f28f16",
  Liberal: "#cc2b2b",
};
const colorSchemeQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

const state = {
  dataset: null,
  mapData: null,
  currentElection: "2024",
  mapViewByElection: {
    "2024": { selectedDistrict: "all", searchText: "" },
    "2021": { selectedDistrict: "all", searchText: "" },
  },
  selectedFeatureId: null,
  electionLookups: {},
  visibleRecordLookup: new Map(),
  visibleRecords: [],
  leafletMap: null,
  baseLayer: null,
  geoJsonLayer: null,
  layerById: new Map(),
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
  mapSourceLabel: document.querySelector("#mapSourceLabel"),
  generatedAt: document.querySelector("#generatedAt"),
  mapDistrictSelect: document.querySelector("#mapDistrictSelect"),
  mapSearchInput: document.querySelector("#mapSearchInput"),
  mapScopeSummary: document.querySelector("#mapScopeSummary"),
  mapLegend: document.querySelector("#mapLegend"),
  mapLegendTitle: document.querySelector("#mapLegendTitle"),
  mapPolygonStat: document.querySelector("#mapPolygonStat"),
  mapDistrictStat: document.querySelector("#mapDistrictStat"),
  mapMatchedStat: document.querySelector("#mapMatchedStat"),
  mapUnmatchedStat: document.querySelector("#mapUnmatchedStat"),
  mapDetailTitle: document.querySelector("#mapDetailTitle"),
  mapDetailContent: document.querySelector("#mapDetailContent"),
  resetMapButton: document.querySelector("#resetMapButton"),
  mapCanvas: document.querySelector("#mapCanvas"),
};

async function init() {
  const [resultsResponse, mapResponse] = await Promise.all([fetch(RESULTS_URL), fetch(MAP_URL)]);

  if (!resultsResponse.ok) {
    throw new Error(`Unable to load election dataset: ${resultsResponse.status}`);
  }
  if (!mapResponse.ok) {
    throw new Error(`Unable to load map dataset: ${mapResponse.status}`);
  }

  state.dataset = await resultsResponse.json();
  state.mapData = await mapResponse.json();
  state.currentElection = state.dataset.metadata.defaultElection || "2024";
  state.electionLookups = buildElectionLookups();

  populateElectionToggle();
  initLeafletMap();
  renderLegend();
  bindEvents();
  syncElectionView({ fitBounds: true });
}

function buildElectionLookups() {
  const lookups = {};

  Object.entries(state.dataset?.elections || {}).forEach(([electionId, electionData]) => {
    const districtLookup = new Map(
      (electionData.districts || []).map((district) => [normalizeDistrictNumber(district.number || district.code), district]),
    );
    const pollLookup = new Map();

    (electionData.polls || []).forEach((poll) => {
      const districtNumber = normalizeDistrictNumber(poll.districtNumber || poll.districtCode);

      buildPollCodeVariants(poll.pollCode).forEach((pollCode) => {
        pollLookup.set(`${districtNumber}|${pollCode}`, poll);
      });
    });

    lookups[electionId] = {
      districts: districtLookup,
      polls: pollLookup,
    };
  });

  return lookups;
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
    syncElectionView({ fitBounds: true });
  });

  elements.mapDistrictSelect?.addEventListener("change", (event) => {
    getCurrentMapView().selectedDistrict = event.target.value;
    state.selectedFeatureId = null;
    render({ fitBounds: true });
  });

  elements.mapSearchInput?.addEventListener("input", (event) => {
    getCurrentMapView().searchText = event.target.value.trim().toLowerCase();
    state.selectedFeatureId = null;
    render({ fitBounds: true });
  });

  elements.resetMapButton?.addEventListener("click", () => {
    resetCurrentMapView();
    state.selectedFeatureId = null;

    render({ fitBounds: true });
  });

  if (colorSchemeQuery?.addEventListener) {
    colorSchemeQuery.addEventListener("change", () => {
      renderLegend();
      refreshBaseLayer();
      refreshLayerStyles();
    });
  }
}

function syncElectionView({ fitBounds = false } = {}) {
  hydrateMetadata();
  populateDistrictFilter();
  syncMapControls();
  renderLegend();
  updateElectionToggle();
  render({ fitBounds });
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
  if (elements.mapSourceLabel) {
    elements.mapSourceLabel.textContent = state.mapData?.metadata?.sourceKmz || "March 2026 polygons";
  }
  if (elements.generatedAt) {
    elements.generatedAt.textContent = new Date(state.dataset.metadata.generatedAtUtc).toLocaleString("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
}

function populateDistrictFilter() {
  if (!elements.mapDistrictSelect || !state.mapData?.districts) {
    return;
  }

  const electionDistricts = getElectionLookup()?.districts || new Map();
  const options = state.mapData.districts
    .slice()
    .sort((left, right) => collator.compare(left.name, right.name))
    .map((district) => {
      const suffix = electionDistricts.has(district.code) ? "" : " (map only)";
      return `<option value="${district.code}">${escapeHtml(`${district.code} - ${district.name}${suffix}`)}</option>`;
    })
    .join("");

  elements.mapDistrictSelect.innerHTML = `<option value="all">All districts</option>${options}`;
  elements.mapDistrictSelect.value = getCurrentMapView().selectedDistrict;
}

function syncMapControls() {
  const currentView = getCurrentMapView();

  if (elements.mapDistrictSelect) {
    elements.mapDistrictSelect.value = currentView.selectedDistrict;
  }

  if (elements.mapSearchInput) {
    elements.mapSearchInput.value = currentView.searchText;
  }
}

function initLeafletMap() {
  if (!elements.mapCanvas || typeof L === "undefined") {
    return;
  }

  state.leafletMap = L.map(elements.mapCanvas, {
    preferCanvas: true,
    zoomControl: true,
    minZoom: 6,
  });

  refreshBaseLayer();
  L.control
    .scale({
      imperial: false,
      position: "bottomleft",
    })
    .addTo(state.leafletMap);

  const overallBounds = getOverallBounds();
  if (overallBounds) {
    state.leafletMap.fitBounds(overallBounds, { padding: [24, 24] });
  } else {
    state.leafletMap.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }
}

function refreshBaseLayer() {
  if (!state.leafletMap || typeof L === "undefined") {
    return;
  }

  if (state.baseLayer) {
    state.leafletMap.removeLayer(state.baseLayer);
  }

  const isDarkMode = Boolean(colorSchemeQuery?.matches);
  const tileUrl = isDarkMode
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  state.baseLayer = L.tileLayer(tileUrl, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO',
    maxZoom: 18,
  });

  state.baseLayer.addTo(state.leafletMap);
}

function renderLegend() {
  if (!elements.mapLegend) {
    return;
  }

  const legend = getActiveLegend();

  if (elements.mapLegendTitle) {
    elements.mapLegendTitle.textContent = legend.title;
  }

  elements.mapLegend.innerHTML = legend.items
    .map(
      (item) => `
        <span class="map-legend-item">
          <span class="map-legend-swatch" style="background:${item.color}"></span>
          <span>${escapeHtml(item.label)}</span>
        </span>
      `,
    )
    .join("");
}

function render({ fitBounds = false } = {}) {
  const visibleRecords = getVisibleRecords();
  state.visibleRecords = visibleRecords;
  state.visibleRecordLookup = new Map(visibleRecords.map((record) => [record.properties.id, record]));

  if (state.selectedFeatureId && !state.visibleRecordLookup.has(state.selectedFeatureId)) {
    state.selectedFeatureId = null;
  }

  renderScopeSummary(visibleRecords);
  renderStats(visibleRecords);
  renderFeatureLayer(visibleRecords);
  renderDetailPanel();

  if (fitBounds) {
    fitMapToRecords(visibleRecords);
  } else {
    refreshLayerStyles();
  }
}

function getVisibleRecords() {
  const electionLookup = getElectionLookup();
  const records = (state.mapData?.features || []).map((feature) => buildRecord(feature, electionLookup));
  return records.filter(matchesCurrentFilters);
}

function buildRecord(feature, electionLookup) {
  const properties = feature.properties || {};
  const poll = resolveJoinedPoll(properties, electionLookup?.polls);
  const district = electionLookup?.districts?.get(properties.districtCode) || null;

  return {
    feature,
    properties,
    poll,
    district,
    hasExactPollMatch: Boolean(poll),
    hasDistrictMatch: Boolean(district),
    turnoutRate: typeof poll?.turnoutRate === "number" ? poll.turnoutRate : null,
    leaderVoteShare: getLeaderVoteShare(poll),
    searchIndex: buildSearchIndex(properties, poll, district),
  };
}

function buildSearchIndex(properties, poll, district) {
  return [
    properties.districtCode,
    properties.districtName,
    properties.pollCode,
    properties.individualPoll,
    properties.serviceArea,
    properties.releaseDate,
    poll?.location,
    poll?.pollType,
    poll?.winner?.candidate,
    poll?.winner?.party,
    district?.winner?.candidate,
    district?.winner?.party,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesCurrentFilters(record) {
  const currentView = getCurrentMapView();
  const districtMatches =
    currentView.selectedDistrict === "all" || record.properties.districtCode === currentView.selectedDistrict;
  if (!districtMatches) {
    return false;
  }

  if (!currentView.searchText) {
    return true;
  }

  return record.searchIndex.includes(currentView.searchText);
}

function renderScopeSummary(records) {
  if (!elements.mapScopeSummary) {
    return;
  }

  const matchedCount = records.filter((record) => record.hasExactPollMatch).length;
  const districtOnlyCount = records.filter((record) => !record.hasExactPollMatch).length;
  const currentView = getCurrentMapView();
  const districtLabel =
    currentView.selectedDistrict === "all" ? "province-wide" : `district ${currentView.selectedDistrict}`;
  const modeSummary =
    state.currentElection === "2024"
      ? "Polygons are coloured by the winning party, with darker shades showing stronger winning vote share."
      : "Polygons are shaded by matched-poll turnout.";

  elements.mapScopeSummary.textContent =
    `${numberFormatter.format(records.length)} polling-division polygons are visible in the ${districtLabel} map view. ` +
    `${numberFormatter.format(matchedCount)} have an exact poll match for ${state.currentElection}, and ` +
    `${numberFormatter.format(districtOnlyCount)} are shown with boundary-only context. ${modeSummary}`;
}

function renderStats(records) {
  if (elements.mapPolygonStat) {
    elements.mapPolygonStat.textContent = numberFormatter.format(records.length);
  }
  if (elements.mapDistrictStat) {
    elements.mapDistrictStat.textContent = numberFormatter.format(
      new Set(records.map((record) => record.properties.districtCode)).size,
    );
  }
  if (elements.mapMatchedStat) {
    elements.mapMatchedStat.textContent = numberFormatter.format(
      records.filter((record) => record.hasExactPollMatch).length,
    );
  }
  if (elements.mapUnmatchedStat) {
    elements.mapUnmatchedStat.textContent = numberFormatter.format(
      records.filter((record) => !record.hasExactPollMatch).length,
    );
  }
}

function renderFeatureLayer(records) {
  if (!state.leafletMap || typeof L === "undefined") {
    return;
  }

  state.layerById = new Map();

  if (state.geoJsonLayer) {
    state.geoJsonLayer.remove();
  }

  state.geoJsonLayer = L.geoJSON(
    {
      type: "FeatureCollection",
      features: records.map((record) => record.feature),
    },
    {
      style: (feature) => getFeatureStyle(state.visibleRecordLookup.get(feature.properties.id)),
      onEachFeature: (feature, layer) => {
        const featureId = feature.properties.id;
        state.layerById.set(featureId, layer);
        layer.bindTooltip(buildTooltip(state.visibleRecordLookup.get(featureId)), {
          sticky: true,
          direction: "top",
          opacity: 0.92,
        });
        layer.on("click", () => {
          state.selectedFeatureId = featureId;
          renderDetailPanel();
          refreshLayerStyles();
        });
      },
    },
  ).addTo(state.leafletMap);
}

function refreshLayerStyles() {
  if (!state.geoJsonLayer) {
    return;
  }

  state.geoJsonLayer.setStyle((feature) => getFeatureStyle(state.visibleRecordLookup.get(feature.properties.id)));

  if (state.selectedFeatureId) {
    const selectedLayer = state.layerById.get(state.selectedFeatureId);
    selectedLayer?.bringToFront();
  }
}

function getFeatureStyle(record) {
  const isSelected = record?.properties?.id === state.selectedFeatureId;
  const currentView = getCurrentMapView();
  const isDistrictFocus =
    currentView.selectedDistrict !== "all" && record?.properties?.districtCode === currentView.selectedDistrict;
  const fillStyle = getFeatureFill(record);
  const borderColor = themeColor("--panel-card-border", "rgba(31, 39, 64, 0.22)");
  const selectedColor = themeColor("--blue", "#1f4db5");

  return {
    color: isSelected ? selectedColor : borderColor,
    weight: isSelected ? 2.6 : isDistrictFocus ? 1.6 : 1,
    fillColor: fillStyle.color,
    fillOpacity: isSelected ? 0.9 : isDistrictFocus ? 0.74 : 0.64,
    opacity: 1,
  };
}

function buildTooltip(record) {
  if (!record) {
    return "Polling division";
  }

  const turnoutText = record.hasExactPollMatch ? formatTurnout(record.turnoutRate) : "No exact poll match";
  const leaderShareText =
    record.hasExactPollMatch && typeof record.leaderVoteShare === "number"
      ? ` • Leader share ${formatTurnout(record.leaderVoteShare)}`
      : "";
  return `
    <strong>${escapeHtml(record.properties.districtName)}</strong><br />
    Poll ${escapeHtml(record.properties.pollCode)} • ${escapeHtml(turnoutText)}${escapeHtml(leaderShareText)}
  `;
}

function fitMapToRecords(records) {
  if (!state.leafletMap) {
    return;
  }

  if (!records.length) {
    const overallBounds = getOverallBounds();
    if (overallBounds) {
      state.leafletMap.fitBounds(overallBounds, { padding: [24, 24] });
    } else {
      state.leafletMap.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
    return;
  }

  if (state.geoJsonLayer) {
    state.leafletMap.fitBounds(state.geoJsonLayer.getBounds(), { padding: [24, 24], maxZoom: 13 });
  }
}

function renderDetailPanel() {
  const selectedRecord = state.selectedFeatureId ? state.visibleRecordLookup.get(state.selectedFeatureId) : null;

  if (selectedRecord) {
    renderSelectedRecord(selectedRecord);
    return;
  }

  if (getCurrentMapView().selectedDistrict !== "all") {
    renderSelectedDistrictSummary(getCurrentMapView().selectedDistrict);
    return;
  }

  if (elements.mapDetailTitle) {
    elements.mapDetailTitle.textContent = "Click a polling division";
  }
  if (elements.mapDetailContent) {
    elements.mapDetailContent.innerHTML = `
      <div class="empty-state">
        Click a polling division on the map to open its district summary, turnout, winner, and
        candidate totals. Use the district filter above if you want to zoom in first.
      </div>
    `;
  }
}

function renderSelectedDistrictSummary(districtCode) {
  const districtRecord = getElectionLookup()?.districts?.get(districtCode) || null;
  const districtMeta = state.mapData?.districts?.find((district) => district.code === districtCode) || null;
  const visibleCount = state.visibleRecords.length;
  const matchedCount = state.visibleRecords.filter((record) => record.hasExactPollMatch).length;

  if (elements.mapDetailTitle) {
    elements.mapDetailTitle.textContent = districtMeta
      ? `${districtMeta.code} - ${districtMeta.name}`
      : `District ${districtCode}`;
  }

  if (!elements.mapDetailContent) {
    return;
  }

  elements.mapDetailContent.innerHTML = `
    <article class="spotlight-card">
      <p>
        ${escapeHtml(numberFormatter.format(visibleCount))} polling-division polygons are visible in
        this district view, with ${escapeHtml(numberFormatter.format(matchedCount))} exact poll
        matches for the selected election.
      </p>
    </article>
    ${
      districtRecord
        ? `
          <article class="spotlight-card">
            <p class="compare-label">District summary</p>
            <h3>${escapeHtml(districtRecord.displayName)}</h3>
            <div class="compare-metrics">
              ${renderMetricCard("Winner", escapeHtml(formatWinnerDisplay(districtRecord.winner)))}
              ${renderMetricCard("District turnout", formatTurnout(districtRecord.summary.turnoutRate))}
              ${renderMetricCard("Votes cast", numberFormatter.format(districtRecord.summary.totalVotes))}
              ${renderMetricCard("Eligible voters", numberFormatter.format(districtRecord.summary.electors))}
            </div>
          </article>
          ${renderCandidateSection(districtRecord.candidates, "District candidate totals")}
        `
        : `
          <article class="spotlight-card">
            <p>
              This district is present in the March 2026 polygon file but does not have a direct
              district summary in the ${escapeHtml(state.currentElection)} election results dataset.
            </p>
          </article>
        `
    }
  `;
}

function renderSelectedRecord(record) {
  if (elements.mapDetailTitle) {
    elements.mapDetailTitle.textContent = `${record.properties.districtCode} - ${record.properties.districtName}`;
  }

  const poll = record.poll;
  const district = record.district;
  const turnoutLabel = poll ? formatTurnout(poll.turnoutRate) : "No exact poll match";
  const leaderShareLabel = poll ? formatTurnout(record.leaderVoteShare) : "No exact poll match";
  const voteCoverage = poll
    ? `${numberFormatter.format(poll.totalVotes)} / ${numberFormatter.format(poll.electors || 0)}`
    : record.properties.electorCount
      ? `Map electors: ${numberFormatter.format(record.properties.electorCount)}`
      : "No elector total";
  const leaderText = poll
    ? formatWinnerDisplay(poll.winner)
    : district
      ? `${formatWinnerDisplay(district.winner)} (district result)`
      : "No election match";

  const badges = [
    `Poll ${record.properties.pollCode}`,
    record.properties.serviceArea || "",
    record.properties.residentialCare === "Y" ? "Residential care" : "",
    record.properties.individualPoll ? `Individual poll ${record.properties.individualPoll}` : "",
  ].filter(Boolean);

  if (!elements.mapDetailContent) {
    return;
  }

  elements.mapDetailContent.innerHTML = `
    <article class="spotlight-card">
      <p class="compare-label">Selected polling division</p>
      <h3>${escapeHtml(record.properties.districtCode)} - ${escapeHtml(record.properties.districtName)}</h3>
      <p>${escapeHtml(badges.join(" • "))}</p>
      <div class="map-badge-row">
        ${badges.map((badge) => `<span class="map-chip">${escapeHtml(badge)}</span>`).join("")}
      </div>
    </article>

    <article class="spotlight-card">
      <p class="compare-label">Selected poll</p>
      <div class="compare-metrics">
        ${renderMetricCard("Turnout", turnoutLabel)}
        ${renderMetricCard("Leader vote share", leaderShareLabel)}
        ${renderMetricCard("Votes / electors", voteCoverage)}
        ${renderMetricCard("Leader", escapeHtml(leaderText))}
        ${renderMetricCard("Location", escapeHtml(poll?.location || record.properties.serviceArea || "Not available"))}
      </div>
    </article>

    ${
      poll
        ? renderCandidateSection(poll.candidates, "Poll candidate totals")
        : `
          <article class="spotlight-card">
            <p>
              This polygon does not have an exact ${escapeHtml(state.currentElection)} poll-code
              match, so the map is showing the boundary metadata only. District-wide results are
              still shown below when available.
            </p>
          </article>
        `
    }

    ${
      district
        ? `
          <article class="spotlight-card">
            <p class="compare-label">District context</p>
            <h3>${escapeHtml(district.displayName)}</h3>
            <div class="compare-metrics">
              ${renderMetricCard("Winner", escapeHtml(formatWinnerDisplay(district.winner)))}
              ${renderMetricCard("District turnout", formatTurnout(district.summary.turnoutRate))}
              ${renderMetricCard("Votes cast", numberFormatter.format(district.summary.totalVotes))}
              ${renderMetricCard("Polls in district", numberFormatter.format(district.pollCount))}
            </div>
          </article>
        `
        : `
          <article class="spotlight-card">
            <p>
              This polygon belongs to a district that does not exist as a direct entry in the
              selected election results dataset.
            </p>
          </article>
        `
    }
  `;
}

function renderCandidateSection(candidates, title) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return `
      <article class="spotlight-card">
        <p>No candidate totals are available for this selection.</p>
      </article>
    `;
  }

  return `
    <article class="spotlight-card candidate-list">
      <h3>${escapeHtml(title)}</h3>
      ${candidates
        .map(
          (candidate) => `
            <div class="candidate-row">
              <header>
                <strong>${escapeHtml(candidate.candidate)}</strong>
                <small>${numberFormatter.format(candidate.votes)} votes${
                  typeof candidate.voteShare === "number" ? ` • ${formatTurnout(candidate.voteShare)}` : ""
                }</small>
              </header>
              <small>${escapeHtml(candidate.groupLabel || candidate.party || "Candidate")}</small>
              <div class="candidate-track">
                <div
                  class="candidate-fill"
                  style="width:${typeof candidate.voteShare === "number" ? candidate.voteShare * 100 : 0}%;background:${escapeHtml(candidate.groupColor || themeColor("--blue", "#1f4db5"))}"
                ></div>
              </div>
            </div>
          `,
        )
        .join("")}
    </article>
  `;
}

function renderMetricCard(label, value) {
  return `
    <div class="compare-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function getElectionData() {
  return state.dataset?.elections?.[state.currentElection] || null;
}

function getElectionMetadata() {
  return getElectionData()?.metadata || null;
}

function getElectionLookup() {
  return state.electionLookups?.[state.currentElection] || null;
}

function getCurrentMapView() {
  if (!state.mapViewByElection[state.currentElection]) {
    state.mapViewByElection[state.currentElection] = { selectedDistrict: "all", searchText: "" };
  }

  return state.mapViewByElection[state.currentElection];
}

function resetCurrentMapView() {
  state.mapViewByElection[state.currentElection] = { selectedDistrict: "all", searchText: "" };
  syncMapControls();
}

function resolveJoinedPoll(properties, pollLookup) {
  if (!pollLookup) {
    return null;
  }

  const districtCode = normalizeDistrictNumber(properties.districtCode);
  const variants = buildPollCodeVariants(properties.pollCode);

  for (const pollCode of variants) {
    const poll = pollLookup.get(`${districtCode}|${pollCode}`);
    if (poll) {
      return poll;
    }
  }

  return null;
}

function buildPollCodeVariants(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return [];
  }

  const variants = new Set([value]);
  if (/^\d+$/.test(value)) {
    variants.add(String(Number.parseInt(value, 10)));
    variants.add(value.padStart(3, "0"));
  }
  return [...variants];
}

function normalizeDistrictNumber(rawValue) {
  return String(rawValue || "")
    .trim()
    .replace(/^ED/i, "")
    .padStart(2, "0");
}

function getOverallBounds() {
  const bounds = state.mapData?.metadata?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    return null;
  }
  return [
    [bounds[1], bounds[0]],
    [bounds[3], bounds[2]],
  ];
}

function getTurnoutBand(turnoutRate) {
  if (typeof turnoutRate !== "number" || Number.isNaN(turnoutRate)) {
    return {
      label: "No exact poll match",
      color: themeColor("--surface-track", "rgba(31, 39, 64, 0.16)"),
    };
  }

  const bands = getTurnoutLegend();
  return (
    bands.find((band) => typeof band.min === "number" && turnoutRate >= band.min && turnoutRate < band.max) ||
    bands.at(-2)
  );
}

function getFeatureFill(record) {
  if (state.currentElection === "2024") {
    return get2024WinnerFill(record);
  }

  return getTurnoutBand(record?.turnoutRate);
}

function get2024WinnerFill(record) {
  const party = record?.poll?.winner?.party || "";
  const color = PARTY_COLOR_LOOKUP_2024[party];

  if (color) {
    return {
      label: party,
      color: getStrengthShade(color, record?.leaderVoteShare),
    };
  }

  if (record?.hasExactPollMatch) {
    return {
      label: party || "Other winner",
      color: themeColor("--surface-track-strong", "#6e7687"),
    };
  }

  return {
    label: "No exact poll match",
    color: themeColor("--surface-track", "rgba(31, 39, 64, 0.16)"),
  };
}

function getActiveLegend() {
  if (state.currentElection === "2024") {
    return {
      title: "Winning party shade",
      items: [
        { label: "PC Party", color: PARTY_COLOR_LOOKUP_2024["PC Party"] },
        { label: "NDP", color: PARTY_COLOR_LOOKUP_2024.NDP },
        { label: "Liberal", color: PARTY_COLOR_LOOKUP_2024.Liberal },
        { label: "Other winner", color: themeColor("--surface-track-strong", "#6e7687") },
        {
          label: "No exact poll match",
          color: themeColor("--surface-track", "rgba(31, 39, 64, 0.16)"),
        },
      ],
    };
  }

  return {
    title: "Turnout shading",
    items: getTurnoutLegend(),
  };
}

function getTurnoutLegend() {
  return [
    { label: "Under 35%", min: 0, max: 0.35, color: "#c85f3d" },
    { label: "35% to 45%", min: 0.35, max: 0.45, color: "#e5903a" },
    { label: "45% to 55%", min: 0.45, max: 0.55, color: "#c8a93b" },
    { label: "55% to 65%", min: 0.55, max: 0.65, color: "#5b9d59" },
    { label: "65% and up", min: 0.65, max: 999, color: "#2f73c8" },
    {
      label: "No exact poll match",
      color: themeColor("--surface-track", "rgba(31, 39, 64, 0.16)"),
    },
  ];
}

function getLeaderVoteShare(poll) {
  if (!poll || typeof poll.validVotes !== "number" || poll.validVotes <= 0) {
    return null;
  }

  if (typeof poll.winner?.votes === "number") {
    return poll.winner.votes / poll.validVotes;
  }

  if (!Array.isArray(poll.candidates) || !poll.candidates.length) {
    return null;
  }

  const highestVotes = Math.max(...poll.candidates.map((candidate) => candidate.votes || 0));
  return highestVotes > 0 ? highestVotes / poll.validVotes : null;
}

function getStrengthShade(baseColor, leaderVoteShare) {
  if (typeof leaderVoteShare !== "number" || Number.isNaN(leaderVoteShare)) {
    return baseColor;
  }

  const normalized = clamp((leaderVoteShare - 0.35) / 0.35, 0, 1);
  const lightMix = clamp(0.5 - normalized * 0.38, 0.1, 0.5);
  const darkMix = clamp((normalized - 0.62) * 0.42, 0, 0.16);
  let shaded = mixHexColors(baseColor, "#ffffff", lightMix);
  if (darkMix > 0) {
    shaded = mixHexColors(shaded, "#000000", darkMix);
  }
  return shaded;
}

function mixHexColors(colorA, colorB, mixRatio) {
  const start = parseHexColor(colorA);
  const end = parseHexColor(colorB);
  if (!start || !end) {
    return colorA;
  }

  const ratio = clamp(mixRatio, 0, 1);
  const mixed = {
    red: Math.round(start.red + (end.red - start.red) * ratio),
    green: Math.round(start.green + (end.green - start.green) * ratio),
    blue: Math.round(start.blue + (end.blue - start.blue) * ratio),
  };

  return rgbToHex(mixed);
}

function parseHexColor(value) {
  const hex = String(value || "").trim().replace("#", "");
  if (!/^[\da-f]{6}$/i.test(hex)) {
    return null;
  }

  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex({ red, green, blue }) {
  return `#${[red, green, blue]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTurnout(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Not available";
  }
  return percentFormatter.format(value);
}

function formatWinnerDisplay(winner) {
  if (!winner) {
    return "Not available";
  }

  const candidate = winner.candidate || "Unknown";
  const party = winner.party ? ` (${winner.party})` : "";
  return `${candidate}${party}`;
}

function themeColor(variableName, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    if (elements.mapDetailTitle) {
      elements.mapDetailTitle.textContent = "Map unavailable";
    }
    if (elements.mapDetailContent) {
      elements.mapDetailContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  });
});
