export type BuyerSubview = "calculator" | "saved" | "archived";

type BuyerType = "IMPORTER" | "DISTRIBUTOR" | "WHOLESALER" | "PROCESSOR" | "MANUFACTURER" | "RETAILER";
type SearchStatus = "QUEUED" | "PLANNING" | "RESEARCHING" | "VERIFYING" | "SAVING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
type ReviewStatus = "NEW" | "APPROVED" | "REJECTED";

type SearchProgress = { current: number; total: number };
type SearchUsage = { inputTokens: number; outputTokens: number; estimatedCostUsd: number | string };
type SearchSummary = {
  researchedCandidateCount: number;
  groundedCandidateCount: number;
  groundingRejectedCount: number;
  deduplicatedCandidateCount: number;
  verificationCandidateCount: number;
  verifiedCandidateCount: number;
  savedCandidateCount: number;
  rejectedCandidateCount: number;
  savedMatchCount: number;
};
type CandidateDecision = {
  companyName: string;
  status: string;
  isEligible: boolean;
  confidenceScore: number;
  confidenceLevel: string;
  missingEvidenceTypes: string[];
  rejectionReasons: string[];
};
type SearchOutcome = { summary: SearchSummary; decisions: CandidateDecision[] };

type SearchListItem = {
  id: string;
  status: SearchStatus;
  commodity: string;
  targetCountry: string;
  targetArea?: string;
  requestedLimit: number;
  currentStage: string;
  progress: SearchProgress;
  summary?: SearchSummary | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
};

type SearchStatusRecord = {
  id: string;
  status: SearchStatus;
  input: {
    commodity: string;
    targetCountry: string;
    buyerTypes: BuyerType[];
    resultLimit: number;
    targetArea?: string;
    hsCode?: string;
    originCountry?: string;
    aliases?: string[];
    productDetails?: string;
    exclusions?: string[];
    requireWebsite?: boolean;
    requireContact?: boolean;
  };
  currentStage: string;
  progress: SearchProgress;
  usage: SearchUsage;
  outcome: SearchOutcome | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

type BuyerSource = {
  url: string;
  title: string;
  publisher?: string;
  evidenceType: string;
  excerpt?: string;
  retrievedAt: string;
};

type BuyerContact = {
  type: string;
  value: string;
  label?: string;
  isPublicBusinessContact: boolean;
  sourceUrl: string;
};

type BuyerResult = {
  id: string;
  company: {
    id: string;
    name: string;
    websiteUrl?: string;
    countryCode?: string;
    countryName: string;
    city?: string;
    address?: string;
  };
  commodity: string;
  buyerType: BuyerType;
  commodityRelationship: string;
  confidence: { score: number; level: "HIGH" | "MEDIUM" | "LOW" };
  verificationStatus: string;
  reviewStatus: ReviewStatus;
  rejectionReason?: string;
  reviewedAt?: string;
  sources: BuyerSource[];
  contacts: BuyerContact[];
};

type ResultsResponse = { searchId: string; status: SearchStatus; results: BuyerResult[] };
type ApiErrorBody = { error?: { code?: string; message?: string } };

const TERMINAL_STATUSES = new Set<SearchStatus>(["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"]);
const POLL_INTERVAL_MS = 2_000;

export class BuyerFinderUi {
  private readonly searchSection = getElement("buyer-search-section");
  private readonly historySection = getElement("buyer-history-section");
  private readonly savedSection = getElement("buyer-saved-section");
  private readonly form = getElement("buyer-search-form") as HTMLFormElement;
  private readonly resultList = getElement("buyer-result-list");
  private readonly detail = getElement("buyer-detail");
  private currentSearchId: string | undefined;
  private currentResults: BuyerResult[] = [];
  private selectedResultId: string | undefined;
  private currentStatus: SearchStatus | undefined;
  private pollTimer: number | undefined;
  private hydrateFormOnNextStatus = false;
  private formLocked = false;

  constructor(private readonly requestWorkspace: (subview: BuyerSubview) => void) {
    this.form.addEventListener("submit", (event) => void this.startSearch(event));
    getElement("buyer-new-search").addEventListener("click", () => this.newSearch());
    getElement("buyer-history-new").addEventListener("click", () => this.newSearch());
    getElement("buyer-cancel-search").addEventListener("click", () => void this.cancelSearch());
    getElement("buyer-retry-search").addEventListener("click", () => this.prepareRetry());
    getElement("buyer-history-rows").addEventListener("click", (event) => void this.openHistorySearch(event));
    getElement("buyer-saved-refresh").addEventListener("click", () => void this.renderSavedBuyers());
    this.resultList.addEventListener("click", (event) => this.selectResult(event));
    this.detail.addEventListener("click", (event) => void this.reviewResult(event));
  }

  show(subview: BuyerSubview): void {
    this.searchSection.hidden = subview !== "calculator";
    this.historySection.hidden = subview !== "saved";
    this.savedSection.hidden = subview !== "archived";

    if (subview === "saved") {
      void this.renderHistory();
    }

    if (subview === "archived") {
      void this.renderSavedBuyers();
    }
  }

  hide(): void {
    this.searchSection.hidden = true;
    this.historySection.hidden = true;
    this.savedSection.hidden = true;
  }

  stop(): void {
    if (this.pollTimer !== undefined) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private newSearch(): void {
    this.stop();
    this.currentSearchId = undefined;
    this.currentResults = [];
    this.selectedResultId = undefined;
    this.currentStatus = undefined;
    this.hydrateFormOnNextStatus = false;
    this.form.reset();
    setValue("buyer-result-limit", "10");
    setText("buyer-form-error", "");
    setText("buyer-progress-error", "");
    getElement("buyer-results-panel").hidden = true;
    this.setFormLocked(false);
    this.renderReadyState();
    this.requestWorkspace("calculator");
    (getElement("buyer-commodity") as HTMLInputElement).focus();
  }

  private async startSearch(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    setText("buyer-form-error", "");

    if (this.formLocked || this.currentSearchId) {
      setText("buyer-form-error", "This search brief is read-only. Select New search to start another research run.");
      return;
    }

    const buyerTypes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="buyer-type"]:checked'))
      .map((input) => input.value as BuyerType);

    if (buyerTypes.length === 0) {
      setText("buyer-form-error", "Select at least one buyer type.");
      return;
    }

    const resultLimit = Number(getValue("buyer-result-limit"));
    const input = compactObject({
      commodity: getValue("buyer-commodity").trim(),
      targetCountry: getValue("buyer-country").trim(),
      buyerTypes,
      resultLimit,
      targetArea: optionalValue("buyer-area"),
      hsCode: optionalValue("buyer-hs-code"),
      originCountry: optionalValue("buyer-origin-country"),
      aliases: commaList("buyer-aliases"),
      productDetails: optionalValue("buyer-product-details"),
      exclusions: commaList("buyer-exclusions"),
      requireWebsite: (getElement("buyer-require-website") as HTMLInputElement).checked || undefined,
      requireContact: (getElement("buyer-require-contact") as HTMLInputElement).checked || undefined,
    });

    try {
      this.stop();
      this.setSubmitting(true);
      const accepted = await apiRequest<{ id: string; status: SearchStatus }>("/api/buyer-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      this.currentSearchId = accepted.id;
      this.currentResults = [];
      this.selectedResultId = undefined;
      this.currentStatus = accepted.status;
      this.hydrateFormOnNextStatus = false;
      this.setFormLocked(true, accepted.status);
      getElement("buyer-results-panel").hidden = true;
      await this.refreshCurrentSearch();
    } catch (error) {
      setText("buyer-form-error", getErrorMessage(error));
      this.renderReadyState();
    } finally {
      this.setSubmitting(false);
    }
  }

  private async refreshCurrentSearch(): Promise<void> {
    if (!this.currentSearchId) {
      return;
    }

    try {
      const status = await apiRequest<SearchStatusRecord>(`/api/buyer-searches/${encodeURIComponent(this.currentSearchId)}`);
      this.renderProgress(status);
      await this.loadResults(status.id);

      if (!TERMINAL_STATUSES.has(status.status)) {
        this.pollTimer = window.setTimeout(() => void this.refreshCurrentSearch(), POLL_INTERVAL_MS);
      } else {
        this.stop();
        void this.renderHistory();
      }
    } catch (error) {
      this.stop();
      setText("buyer-progress-error", getErrorMessage(error));
    }
  }

  private async loadResults(searchId: string): Promise<void> {
    const response = await apiRequest<ResultsResponse>(`/api/buyer-searches/${encodeURIComponent(searchId)}/results`);
    this.currentResults = response.results;

    if (!this.selectedResultId || !response.results.some((result) => result.id === this.selectedResultId)) {
      this.selectedResultId = response.results[0]?.id;
    }

    this.renderResults();
  }

  private renderProgress(run: SearchStatusRecord): void {
    this.currentStatus = run.status;
    if (this.hydrateFormOnNextStatus) {
      applySearchInput(run.input);
      this.hydrateFormOnNextStatus = false;
    }
    this.setFormLocked(true, run.status);
    const label = formatStatus(run.status);
    const badge = getElement("buyer-status-badge");
    badge.textContent = label;
    badge.className = `status-badge status-${run.status.toLowerCase()}`;
    setText("buyer-progress-title", `${run.input.commodity} · ${run.input.targetCountry}`);
    setText("buyer-progress-summary", getProgressSummary(run));
    setText("buyer-progress-stage", run.currentStage || label);
    setText("buyer-progress-count", `${run.progress.current} of ${run.progress.total}`);
    setText("buyer-progress-error", run.error?.message ?? "");
    this.renderOutcome(run.outcome);

    const percent = run.progress.total > 0
      ? Math.min(100, Math.round((run.progress.current / run.progress.total) * 100))
      : run.status === "COMPLETED" ? 100 : 0;
    const bar = getElement("buyer-progress-bar");
    bar.style.width = `${percent}%`;
    bar.parentElement?.classList.toggle("is-indeterminate", !TERMINAL_STATUSES.has(run.status) && run.progress.total === 0);

    const usage = getElement("buyer-usage");
    const estimatedCostUsd = Number(run.usage.estimatedCostUsd);
    const hasUsage = run.usage.inputTokens > 0 || run.usage.outputTokens > 0 || estimatedCostUsd > 0;
    usage.hidden = !hasUsage;
    setText("buyer-input-tokens", formatInteger(run.usage.inputTokens));
    setText("buyer-output-tokens", formatInteger(run.usage.outputTokens));
    setText("buyer-cost", `$${Number.isFinite(estimatedCostUsd) ? estimatedCostUsd.toFixed(4) : "0.0000"}`);
    getElement("buyer-cancel-search").hidden = TERMINAL_STATUSES.has(run.status);
    getElement("buyer-retry-search").hidden = !["FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status);
  }

  private renderReadyState(): void {
    this.setFormLocked(false);
    const badge = getElement("buyer-status-badge");
    badge.textContent = "Ready";
    badge.className = "status-badge";
    setText("buyer-progress-title", "Ready to research");
    setText("buyer-progress-summary", "Complete the search brief to begin.");
    setText("buyer-progress-count", "0 of 0");
    setText("buyer-progress-stage", "Not started");
    getElement("buyer-progress-bar").style.width = "0%";
    getElement("buyer-usage").hidden = true;
    getElement("buyer-cancel-search").hidden = true;
    getElement("buyer-retry-search").hidden = true;
    getElement("buyer-outcome").hidden = true;
  }

  private renderResults(): void {
    const panel = getElement("buyer-results-panel");
    panel.hidden = !this.currentSearchId;
    this.resultList.replaceChildren();
    getElement("buyer-results-empty").hidden = this.currentResults.length > 0;
    setText(
      "buyer-results-empty",
      this.currentStatus && !TERMINAL_STATUSES.has(this.currentStatus)
        ? "Qualified candidates will appear here as they are verified."
        : "No qualified candidates were saved for this search.",
    );
    setText("buyer-results-count", `${this.currentResults.length} ${this.currentResults.length === 1 ? "candidate" : "candidates"}`);

    for (const result of this.currentResults) {
      this.resultList.appendChild(createResultCard(result, result.id === this.selectedResultId));
    }

    const selected = this.currentResults.find((result) => result.id === this.selectedResultId);
    this.renderDetail(selected);
  }

  private renderOutcome(outcome: SearchOutcome | null): void {
    const panel = getElement("buyer-outcome");
    const details = getElement("buyer-rejection-details");
    const list = getElement("buyer-rejection-list");
    list.replaceChildren();

    if (!outcome) {
      panel.hidden = true;
      return;
    }

    const rejected = outcome.summary.groundingRejectedCount + outcome.summary.rejectedCandidateCount;
    setText(
      "buyer-outcome-summary",
      `${outcome.summary.researchedCandidateCount} researched · ${outcome.summary.savedCandidateCount} qualified · ${rejected} rejected`,
    );
    const rejectedDecisions = outcome.decisions.filter((decision) => !decision.isEligible);
    details.hidden = rejectedDecisions.length === 0;

    for (const decision of rejectedDecisions) {
      const reasons = [
        ...decision.rejectionReasons,
        ...(decision.missingEvidenceTypes.length > 0
          ? [`Missing evidence: ${decision.missingEvidenceTypes.map(formatStatus).join(", ")}.`]
          : []),
      ];
      list.appendChild(createElement("li", "", `${decision.companyName}: ${reasons.join(" ") || "Did not meet the qualification threshold."}`));
    }

    panel.hidden = false;
  }

  private selectResult(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const control = target.closest<HTMLElement>("[data-buyer-result-id]");
    if (!control?.dataset.buyerResultId) return;
    this.selectedResultId = control.dataset.buyerResultId;
    this.renderResults();
  }

  private renderDetail(result: BuyerResult | undefined): void {
    this.detail.replaceChildren();
    if (!result) {
      const empty = createElement("div", "buyer-detail-empty");
      empty.append(createElement("strong", "", "Select a candidate"), createElement("span", "", "Company details, contacts, and supporting evidence will appear here."));
      this.detail.appendChild(empty);
      return;
    }

    const heading = createElement("div", "buyer-detail-heading");
    const headingText = createElement("div");
    headingText.append(createElement("p", "eyebrow", `${formatBuyerType(result.buyerType)} · ${result.confidence.level} confidence`), createElement("h3", "", result.company.name));
    heading.append(headingText, createReviewBadge(result.reviewStatus));

    const location = [result.company.city, result.company.countryName].filter(Boolean).join(", ");
    const meta = createElement("div", "buyer-company-meta");
    meta.append(createElement("p", "", location || "Location unavailable"));
    if (result.company.address) meta.append(createElement("p", "", result.company.address));
    if (result.company.websiteUrl) meta.append(createSafeLink(result.company.websiteUrl, "Visit company website"));

    const relationship = createElement("section", "buyer-detail-section");
    relationship.append(createElement("h4", "", "Why this company matches"), createElement("p", "", result.commodityRelationship));

    const contacts = createElement("section", "buyer-detail-section");
    contacts.append(createElement("h4", "", "Public contacts"));
    if (result.contacts.length === 0) {
      contacts.append(createElement("p", "empty-copy", "No public contact method was retained."));
    } else {
      const list = createElement("div", "buyer-contact-list");
      for (const contact of result.contacts) list.append(createContactRow(contact));
      contacts.append(list);
    }

    const evidence = createElement("section", "buyer-detail-section");
    evidence.append(createElement("h4", "", `Evidence (${result.sources.length})`));
    const sourceList = createElement("div", "buyer-source-list");
    for (const source of result.sources) sourceList.append(createSourceCard(source));
    evidence.append(sourceList);

    const review = createElement("section", "buyer-review-actions");
    review.append(createElement("span", "", "Your review"));
    review.append(
      createReviewButton("Keep for review", "NEW", result),
      createReviewButton("Approve", "APPROVED", result),
      createReviewButton("Reject", "REJECTED", result),
    );
    const reviewStatus = createElement("p", "save-status");
    reviewStatus.id = "buyer-review-status";

    this.detail.append(heading, meta, relationship, contacts, evidence, review, reviewStatus);
  }

  private async reviewResult(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>("[data-review-status]");
    const selected = this.currentResults.find((result) => result.id === this.selectedResultId);
    if (!button?.dataset.reviewStatus || !selected) return;

    try {
      button.disabled = true;
      const updated = await apiRequest<BuyerResult>(`/api/buyer-matches/${encodeURIComponent(selected.id)}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: button.dataset.reviewStatus }),
      });
      this.currentResults = this.currentResults.map((result) => result.id === updated.id ? updated : result);
      this.renderResults();
      setText("buyer-review-status", `Marked ${updated.company.name} as ${updated.reviewStatus.toLowerCase()}.`);
    } catch (error) {
      setText("buyer-review-status", getErrorMessage(error));
    } finally {
      button.disabled = false;
    }
  }

  private async cancelSearch(): Promise<void> {
    if (!this.currentSearchId) return;
    try {
      getElement("buyer-cancel-search").setAttribute("disabled", "true");
      const status = await apiRequest<SearchStatusRecord>(`/api/buyer-searches/${encodeURIComponent(this.currentSearchId)}/cancel`, { method: "POST" });
      this.stop();
      this.renderProgress(status);
      await this.loadResults(status.id);
    } catch (error) {
      setText("buyer-progress-error", getErrorMessage(error));
    } finally {
      getElement("buyer-cancel-search").removeAttribute("disabled");
    }
  }

  private prepareRetry(): void {
    this.stop();
    this.currentSearchId = undefined;
    this.currentResults = [];
    this.selectedResultId = undefined;
    this.currentStatus = undefined;
    this.setFormLocked(false);
    getElement("buyer-results-panel").hidden = true;
    setText("buyer-progress-error", "");
    this.renderReadyState();
    getElement("buyer-start-search").focus();
  }

  private async renderHistory(): Promise<void> {
    const rows = getElement("buyer-history-rows");
    rows.replaceChildren();
    setText("buyer-history-error", "");
    try {
      const searches = await apiRequest<SearchListItem[]>("/api/buyer-searches");
      getElement("buyer-history-empty").hidden = searches.length > 0;
      for (const search of searches) rows.appendChild(createHistoryRow(search));
    } catch (error) {
      getElement("buyer-history-empty").hidden = true;
      setText("buyer-history-error", getErrorMessage(error));
    }
  }

  private async openHistorySearch(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>("[data-buyer-search-id]");
    if (!button?.dataset.buyerSearchId) return;
    this.stop();
    this.currentSearchId = button.dataset.buyerSearchId;
    this.currentResults = [];
    this.selectedResultId = undefined;
    this.currentStatus = undefined;
    this.hydrateFormOnNextStatus = true;
    this.requestWorkspace("calculator");
    await this.refreshCurrentSearch();
  }

  private async renderSavedBuyers(): Promise<void> {
    const list = getElement("buyer-saved-list");
    list.replaceChildren();
    setText("buyer-saved-error", "");
    try {
      const searches = await apiRequest<SearchListItem[]>("/api/buyer-searches");
      const completed = searches.filter((search) => TERMINAL_STATUSES.has(search.status));
      const responses = await Promise.all(completed.map((search) =>
        apiRequest<ResultsResponse>(`/api/buyer-searches/${encodeURIComponent(search.id)}/results`),
      ));
      const approved = responses.flatMap((response) => response.results).filter((result) => result.reviewStatus === "APPROVED");
      getElement("buyer-saved-empty").hidden = approved.length > 0;
      for (const result of approved) list.appendChild(createSavedBuyerCard(result));
    } catch (error) {
      getElement("buyer-saved-empty").hidden = true;
      setText("buyer-saved-error", getErrorMessage(error));
    }
  }

  private setSubmitting(submitting: boolean): void {
    const button = getElement("buyer-start-search") as HTMLButtonElement;
    button.disabled = submitting || this.formLocked;
    button.textContent = submitting
      ? "Starting…"
      : this.formLocked
        ? this.currentStatus === "COMPLETED" ? "Research completed" : "Research already started"
        : "Start research";
  }

  private setFormLocked(locked: boolean, status?: SearchStatus): void {
    this.formLocked = locked;
    this.form.classList.toggle("is-readonly", locked);

    for (const control of this.form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    )) {
      control.disabled = locked;
    }

    const state = getElement("buyer-form-state");
    state.hidden = !locked;
    state.textContent = !locked
      ? ""
      : status === "COMPLETED"
        ? "This completed search is read-only. Select New search to research a different brief."
        : "This search brief is locked because its research run has already started. Select New search for another brief.";
    setText(
      "buyer-form-hint",
      locked
        ? "Search inputs are preserved as part of this research record."
        : "Results are potential buyers and require human review before outreach.",
    );
    this.setSubmitting(false);
  }
}

function createResultCard(result: BuyerResult, selected: boolean): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.className = selected ? "is-selected" : "";
  const companyCell = document.createElement("td");
  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "buyer-company-button";
  selectButton.dataset.buyerResultId = result.id;
  selectButton.append(
    createElement("strong", "", result.company.name),
    createElement("span", "buyer-result-location", [result.company.city, result.company.countryName].filter(Boolean).join(", ")),
  );
  companyCell.appendChild(selectButton);
  const confidenceCell = document.createElement("td");
  confidenceCell.appendChild(createConfidenceBadge(result.confidence));
  const reviewCell = document.createElement("td");
  reviewCell.appendChild(createReviewBadge(result.reviewStatus));
  row.append(
    companyCell,
    createTableCell(formatBuyerType(result.buyerType)),
    confidenceCell,
    createTableCell(String(result.sources.length)),
    reviewCell,
  );
  return row;
}

function createConfidenceBadge(confidence: BuyerResult["confidence"]): HTMLElement {
  return createElement("span", `confidence-badge confidence-${confidence.level.toLowerCase()}`, `${confidence.score} · ${confidence.level}`);
}

function createReviewBadge(status: ReviewStatus): HTMLElement {
  return createElement("span", `review-badge review-${status.toLowerCase()}`, formatStatus(status));
}

function createReviewButton(label: string, status: ReviewStatus, result: BuyerResult): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `table-button${result.reviewStatus === status ? " is-active" : ""}${status === "REJECTED" ? " danger-button" : ""}`;
  button.dataset.reviewStatus = status;
  button.textContent = label;
  return button;
}

function createContactRow(contact: BuyerContact): HTMLElement {
  const row = createElement("div", "buyer-contact-row");
  const value = contact.type === "EMAIL"
    ? createSafeLink(`mailto:${contact.value}`, contact.value, ["mailto:"])
    : contact.type === "PHONE"
      ? createSafeLink(`tel:${contact.value}`, contact.value, ["tel:"])
      : createSafeLink(contact.value, contact.label || "Contact page");
  row.append(createElement("span", "contact-type", formatStatus(contact.type)), value, createSafeLink(contact.sourceUrl, "Source"));
  return row;
}

function createSourceCard(source: BuyerSource): HTMLElement {
  const card = createElement("article", "buyer-source-card");
  const heading = createElement("div", "buyer-source-heading");
  heading.append(createElement("span", "source-type", source.evidenceType.replaceAll("_", " ")), createSafeLink(source.url, source.title));
  card.append(heading);
  if (source.publisher) card.append(createElement("small", "", source.publisher));
  if (source.excerpt) card.append(createElement("p", "", source.excerpt));
  return card;
}

function createHistoryRow(search: SearchListItem): HTMLTableRowElement {
  const row = document.createElement("tr");
  const market = [search.targetArea, search.targetCountry].filter(Boolean).join(", ");
  const progress = search.progress.total > 0 ? `${search.progress.current}/${search.progress.total}` : "—";
  const action = document.createElement("button");
  action.type = "button";
  action.className = "table-button";
  action.dataset.buyerSearchId = search.id;
  action.textContent = TERMINAL_STATUSES.has(search.status) ? "View" : "Monitor";
  row.append(
    createTableCell(search.commodity),
    createTableCell(market),
    createTableCell(formatStatus(search.status)),
    createTableCell(progress),
    createTableCell(formatDate(search.createdAt)),
    createTableCellWith(action),
  );
  return row;
}

function createSavedBuyerCard(result: BuyerResult): HTMLElement {
  const card = createElement("article", "buyer-saved-card");
  const heading = createElement("div", "buyer-result-card-top");
  heading.append(createElement("h3", "", result.company.name), createConfidenceBadge(result.confidence));
  card.append(
    heading,
    createElement("p", "buyer-result-location", [result.company.city, result.company.countryName].filter(Boolean).join(", ")),
    createElement("p", "buyer-result-role", `${formatBuyerType(result.buyerType)} · ${result.commodity}`),
    createElement("p", "", result.commodityRelationship),
  );
  const links = createElement("div", "buyer-saved-links");
  if (result.company.websiteUrl) links.append(createSafeLink(result.company.websiteUrl, "Website"));
  if (result.sources[0]) links.append(createSafeLink(result.sources[0].url, "Primary evidence"));
  card.append(links);
  return card;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json() as T | ApiErrorBody;
  if (!response.ok) {
    const apiError = body as ApiErrorBody;
    throw new Error(apiError.error?.message ?? `Request failed with status ${response.status}.`);
  }
  return body as T;
}

function getProgressSummary(run: SearchStatusRecord): string {
  if (run.status === "COMPLETED" && run.outcome) {
    const rejected = run.outcome.summary.groundingRejectedCount + run.outcome.summary.rejectedCandidateCount;
    return `Research complete: ${run.outcome.summary.savedCandidateCount} qualified and ${rejected} rejected.`;
  }
  if (run.status === "COMPLETED") return "Research complete. Review the saved candidates below.";
  if (run.status === "FAILED") return "Research stopped before completion. You can review any candidates already saved.";
  if (run.status === "CANCELLED") return "Search cancelled. Any candidates saved before cancellation remain available.";
  if (run.status === "INTERRUPTED") return "The server restarted while this search was running. Start a new search to try again.";
  return "Research is running in the background. You can leave this view and return from History.";
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)));
}

function applySearchInput(input: SearchStatusRecord["input"]): void {
  setValue("buyer-commodity", input.commodity);
  setValue("buyer-country", input.targetCountry);
  setValue("buyer-area", input.targetArea ?? "");
  setValue("buyer-hs-code", input.hsCode ?? "");
  setValue("buyer-origin-country", input.originCountry ?? "");
  setValue("buyer-result-limit", String(input.resultLimit));
  setValue("buyer-aliases", input.aliases?.join(", ") ?? "");
  setValue("buyer-exclusions", input.exclusions?.join(", ") ?? "");
  setValue("buyer-product-details", input.productDetails ?? "");
  (getElement("buyer-require-website") as HTMLInputElement).checked = input.requireWebsite ?? false;
  (getElement("buyer-require-contact") as HTMLInputElement).checked = input.requireContact ?? false;
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[name="buyer-type"]')) {
    checkbox.checked = input.buyerTypes.includes(checkbox.value as BuyerType);
  }
}

function commaList(id: string): string[] | undefined {
  const values = getValue(id).split(",").map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function optionalValue(id: string): string | undefined {
  const value = getValue(id).trim();
  return value || undefined;
}

function createSafeLink(url: string, label: string, allowedProtocols = ["http:", "https:"]): HTMLAnchorElement {
  const link = document.createElement("a");
  link.textContent = label;
  try {
    const parsed = new URL(url, window.location.origin);
    if (allowedProtocols.includes(parsed.protocol)) {
      link.href = url;
      if (["http:", "https:"].includes(parsed.protocol)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    }
  } catch {
    link.removeAttribute("href");
  }
  return link;
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function createTableCell(text: string): HTMLTableCellElement {
  return createElement("td", "", text);
}

function createTableCellWith(element: HTMLElement): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.appendChild(element);
  return cell;
}

function formatBuyerType(value: BuyerType): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatStatus(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Buyer Finder could not complete the request.";
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element;
}

function getValue(id: string): string {
  return (getElement(id) as HTMLInputElement | HTMLTextAreaElement).value;
}

function setValue(id: string, value: string): void {
  (getElement(id) as HTMLInputElement).value = value;
}

function setText(id: string, value: string): void {
  getElement(id).textContent = value;
}
