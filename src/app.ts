import {
  CalculationError,
  calculateCosting,
  createDuplicateDraft,
  getCalculationWarnings,
  type CostItem,
  type CostingDraft,
  type CalculationWarning,
  type SavedCosting,
  type CostStage,
  type Incoterm,
  type PricingInput,
} from "./domain/costing/index.js";

type CostRowState = {
  id: string;
  name: string;
  stage: CostStage;
  amount: string;
  amountPlaceholder?: string;
  currency: CostItem["currency"];
  isStandard: boolean;
};

type PricingMode = PricingInput["type"];

const stageOrder: Record<CostStage, number> = {
  EXW: 0,
  FOB: 1,
  CFR: 2,
  CIF: 3,
};

const standardCosts: CostRowState[] = [
  { id: "product-cost", name: "Product", stage: "EXW", amount: "", amountPlaceholder: "162500000", currency: "IDR", isStandard: true },
  { id: "packaging-cost", name: "Packaging", stage: "EXW", amount: "", amountPlaceholder: "10000000", currency: "IDR", isStandard: true },
  { id: "processing-cost", name: "Processing", stage: "EXW", amount: "", amountPlaceholder: "0", currency: "IDR", isStandard: true },
  { id: "trucking-cost", name: "Trucking", stage: "FOB", amount: "", amountPlaceholder: "5000000", currency: "IDR", isStandard: true },
  { id: "documentation-cost", name: "Documentation", stage: "FOB", amount: "", amountPlaceholder: "2500000", currency: "IDR", isStandard: true },
  { id: "port-cost", name: "Port Charges", stage: "FOB", amount: "", amountPlaceholder: "6000000", currency: "IDR", isStandard: true },
  { id: "freight-cost", name: "Freight", stage: "CFR", amount: "", amountPlaceholder: "1450", currency: "USD", isStandard: true },
  { id: "insurance-cost", name: "Insurance", stage: "CIF", amount: "", amountPlaceholder: "80", currency: "USD", isStandard: true },
];

const costRows = mustGetElement("cost-rows");
const form = mustGetElement("costing-form");
const addCostButton = mustGetElement("add-cost");
const saveCostingButton = mustGetElement("save-costing");
const newCostingButton = mustGetElement("new-costing");
const backToListButton = mustGetElement("back-to-list");
const historyNewCostingButton = mustGetElement("history-new-costing");
const showCostingsButton = mustGetElement("show-costings");
const showArchivedButton = mustGetElement("show-archived");
const editorMode = mustGetElement("editor-mode");
const editorSection = mustQueryElement(".editor");
const resultsPanel = mustQueryElement(".results");
const historySection = mustGetElement("history-section");
const historyRows = mustGetElement("history-rows");
const historyEmpty = mustGetElement("history-empty");
const archiveSection = mustGetElement("archive-section");
const archiveRows = mustGetElement("archive-rows");
const archiveEmpty = mustGetElement("archive-empty");
let currentCostingId: string | undefined;

for (const cost of standardCosts) {
  costRows.appendChild(createCostRow(cost));
}

form.addEventListener("input", render);
form.addEventListener("change", render);
addCostButton.addEventListener("click", addCustomCostRow);
costRows.addEventListener("click", handleCostTableClick);
saveCostingButton.addEventListener("click", handleSaveCosting);
newCostingButton.addEventListener("click", handleNewCosting);
backToListButton.addEventListener("click", () => setView("costings"));
historyNewCostingButton.addEventListener("click", handleNewCosting);
showCostingsButton.addEventListener("click", () => setView("costings"));
showArchivedButton.addEventListener("click", () => setView("archived"));
historyRows.addEventListener("click", handleHistoryAction);
archiveRows.addEventListener("click", handleHistoryAction);

void renderHistory();
void renderArchived();
updateSaveButtonLabel();
render();
setView("costings");

async function handleSaveCosting(): Promise<void> {
  try {
    const draft = buildCostingDraft();
    const isExistingCosting = Boolean(currentCostingId);
    const saved = await persistCosting(draft, currentCostingId);
    currentCostingId = saved.id;
    await renderHistory();
    await renderArchived();
    updateSaveButtonLabel();
    setText("save-status", `${isExistingCosting ? "Updated" : "Saved"} ${saved.name}.`);
    render();
  } catch (error) {
    const message =
      error instanceof CalculationError ? error.message : "Fix the costing before saving.";
    setText("save-status", "");
    setText("error-message", message);
  }
}

async function handleNewCosting(): Promise<void> {
  currentCostingId = undefined;
  setInputValue("costing-name", "");
  setInputValue("product", "");
  setInputValue("quantity", "");
  setInputValue("incoterm", "CIF");
  setInputValue("fx", "");
  setPricingMode("MARGIN");
  setInputValue("target-margin", "");
  setInputValue("target-markup", "");
  setInputValue("buyer-offer", "");
  replaceCostRows(standardCosts);
  await renderHistory();
  await renderArchived();
  updateSaveButtonLabel();
  setText("save-status", "New costing ready.");
  render();
  setView("editor");
}

async function handleHistoryAction(event: MouseEvent): Promise<void> {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-history-action]");

  if (!button) {
    return;
  }

  const id = button.dataset.costingId;

  if (!id) {
    return;
  }

  const saved = await fetchCosting(id);

  if (!saved) {
    setText("save-status", "");
    setText("error-message", "Saved costing could not be found.");
    await renderHistory();
    await renderArchived();
    return;
  }

  if (button.dataset.historyAction === "edit") {
    currentCostingId = saved.id;
    applySavedCosting(saved);
    updateSaveButtonLabel();
    setText("save-status", `Opened ${saved.name}.`);
    render();
    setView("editor");
    return;
  }

  if (button.dataset.historyAction === "duplicate") {
    currentCostingId = undefined;
    applySavedCosting({
      ...createDuplicateDraft(saved),
    });
    updateSaveButtonLabel();
    setText("save-status", `Duplicated ${saved.name}. Save when ready.`);
    render();
    setView("editor");
    return;
  }

  if (button.dataset.historyAction === "archive") {
    await archivePersistedCosting(saved.id);

    if (currentCostingId === saved.id) {
      currentCostingId = undefined;
    }

    await renderHistory();
    await renderArchived();
    updateSaveButtonLabel();
    setText("save-status", `Archived ${saved.name}.`);
    setView("costings");
    return;
  }

  if (button.dataset.historyAction === "delete") {
    const confirmed = window.confirm(`Permanently delete "${saved.name}"?`);

    if (!confirmed) {
      return;
    }

    await deletePersistedCosting(saved.id);

    if (currentCostingId === saved.id) {
      currentCostingId = undefined;
    }

    await renderHistory();
    await renderArchived();
    updateSaveButtonLabel();
    setText("save-status", `Deleted ${saved.name}.`);
  }
}

function addCustomCostRow(): void {
  costRows.appendChild(
    createCostRow({
      id: `custom-cost-${crypto.randomUUID()}`,
      name: "Other",
      stage: "FOB",
      amount: "0",
      currency: "USD",
      isStandard: false,
    }),
  );
  render();
}

function replaceCostRows(costs: CostRowState[]): void {
  costRows.replaceChildren();

  for (const cost of costs) {
    costRows.appendChild(createCostRow(cost));
  }
}

function handleCostTableClick(event: MouseEvent): void {
  const target = event.target;

  if (!(target instanceof HTMLElement) || !target.matches("[data-remove-cost]")) {
    return;
  }

  target.closest(".cost-row")?.remove();
  render();
}

function createCostRow(cost: CostRowState): HTMLElement {
  const row = document.createElement("div");
  row.className = cost.isStandard ? "cost-row" : "cost-row custom-cost-row";
  row.dataset.costId = cost.id;
  row.dataset.stage = cost.stage;
  row.dataset.standard = String(cost.isStandard);

  const nameCell = cost.isStandard ? createStaticName(cost.name, cost.stage) : createNameInput(cost.name);
  const amountLabel = createAmountInput(cost.amount, cost.amountPlaceholder);
  const currencyLabel = createCurrencySelect(cost.currency);

  row.append(nameCell, amountLabel, currencyLabel);

  if (!cost.isStandard) {
    row.append(createCustomRowActions(cost.stage));
  }

  return row;
}

function createStaticName(name: string, stage: CostStage): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "cost-row-name";

  const text = document.createElement("span");
  text.textContent = name;

  const stageHint = document.createElement("small");
  stageHint.textContent = stage;

  wrapper.append(text, stageHint);
  return wrapper;
}

function createNameInput(name: string): HTMLLabelElement {
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = "Cost";
  const input = document.createElement("input");
  input.type = "text";
  input.value = name;
  input.dataset.costNameInput = "true";
  label.append(caption, input);
  return label;
}

function createAmountInput(value: string, placeholder = "0"): HTMLLabelElement {
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = "Amount";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "0.01";
  input.value = value;
  input.placeholder = placeholder;
  input.dataset.costAmount = "true";
  label.append(caption, input);
  return label;
}

function createCurrencySelect(selectedValue: CostItem["currency"]): HTMLLabelElement {
  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = "Currency";
  const select = document.createElement("select");
  select.dataset.costCurrency = "true";
  select.append(createOption("IDR", selectedValue), createOption("USD", selectedValue));
  label.append(caption, select);
  return label;
}

function createCustomRowActions(selectedStage: CostStage): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "cost-row-actions";

  const details = document.createElement("details");
  details.className = "advanced-stage";
  const summary = document.createElement("summary");
  summary.textContent = "Advanced";

  const label = document.createElement("label");
  const caption = document.createElement("span");
  caption.textContent = "Stage";
  const select = document.createElement("select");
  select.dataset.costStage = "true";
  select.append(
    createStageOption("EXW", selectedStage),
    createStageOption("FOB", selectedStage),
    createStageOption("CFR", selectedStage),
    createStageOption("CIF", selectedStage),
  );
  label.append(caption, select);
  details.append(summary, label);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "icon-button";
  removeButton.dataset.removeCost = "true";
  removeButton.setAttribute("aria-label", "Remove custom cost");
  removeButton.textContent = "x";

  wrapper.append(details, removeButton);
  return wrapper;
}

function createOption(value: CostItem["currency"], selectedValue: CostItem["currency"]): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  option.selected = value === selectedValue;
  return option;
}

function createStageOption(value: CostStage, selectedValue: CostStage): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  option.selected = value === selectedValue;
  return option;
}

function render(): void {
  try {
    clearFieldErrors();
    const product = getInputValue("product").trim() || "Untitled product";
    const quantity = getInputValue("quantity");
    const incoterm = getInputValue("incoterm") as Incoterm;
    const pricingMode = getCheckedPricingMode();

    updatePricingInputs(pricingMode);
    updateCostRowVisibility(incoterm);
    updateResultStageVisibility(incoterm);

    if (!hasMinimumCalculationInputs()) {
      renderEmptyResult(incoterm);
      return;
    }

    const draft = buildCostingDraft();
    const costs = readCosts();
    const result = draft.result;

    setText("product-summary", `${product} · ${incoterm} · ${formatKg(quantity)} kg`);
    setText("fob", formatUsdPerKg(result.stageUnitCosts.fobPerKg));
    setText("cfr", formatUsdPerKg(result.stageUnitCosts.cfrPerKg));
    setText("cif", formatUsdPerKg(result.stageUnitCosts.cifPerKg));
    setText("break-even", formatUsdPerKg(result.pricing.breakEvenPricePerKg));
    setText("primary-result-label", pricingMode === "BUYER_OFFER" ? "Buyer offer" : "Suggested price");
    setText("suggested-price", formatUsdPerKg(result.pricing.sellingPricePerKg));
    setText("profit", formatUsd(result.pricing.profit));
    setText("revenue", formatUsd(result.pricing.revenue));
    setText("margin", formatPercent(result.pricing.margin));
    setText("markup", formatPercent(result.pricing.markup));
    renderWarnings(getCalculationWarnings({ incoterm, costs, isBelowBreakEven: result.pricing.isBelowBreakEven }));
    setText("error-message", "");
  } catch (error) {
    const message =
      error instanceof CalculationError ? error.message : "Check the shipment, cost, and FX inputs.";

    applyCalculationError(error);
    renderWarnings([]);
    setText("error-message", message);
    setText("suggested-price", "Needs input");
    setText("fob", "-");
    setText("cfr", "-");
    setText("cif", "-");
    setText("break-even", "-");
    setText("profit", "-");
    setText("revenue", "-");
    setText("margin", "-");
    setText("markup", "-");
  }
}

function renderEmptyResult(incoterm: Incoterm): void {
  setText("product-summary", "Enter quantity and USD/IDR to calculate.");
  setText("primary-result-label", getCheckedPricingMode() === "BUYER_OFFER" ? "Buyer offer" : "Suggested price");
  setText("suggested-price", "-");
  setText("fob", "-");
  setText("cfr", "-");
  setText("cif", "-");
  setText("break-even", "-");
  setText("profit", "-");
  setText("revenue", "-");
  setText("margin", "-");
  setText("markup", "-");
  renderWarnings([]);
  setText("error-message", "");
  updateResultStageVisibility(incoterm);
}

function hasMinimumCalculationInputs(): boolean {
  return getInputValue("quantity").trim() !== "" && getInputValue("fx").trim() !== "";
}

function buildCostingDraft(): CostingDraft {
  const incoterm = getInputValue("incoterm") as Incoterm;
  updateCostRowVisibility(incoterm);

  const input = {
    quantity: { value: getInputValue("quantity"), unit: "KG" as const },
    quotationCurrency: "USD" as const,
    exchangeRates: { USD_IDR: getInputValue("fx") },
    incoterm,
    costs: readCosts(),
    pricing: readPricing(getCheckedPricingMode()),
  };

  return {
    name: getInputValue("costing-name").trim() || "Untitled Costing",
    product: getInputValue("product").trim(),
    ...input,
    costs: readAllCosts(),
    result: calculateCosting(input),
  };
}

function readCosts(): CostItem[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".cost-row"))
    .filter((row) => !row.hidden)
    .map(readCostRow);
}

function readAllCosts(): CostItem[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".cost-row"))
    .map(readCostRow);
}

function readCostRow(row: HTMLElement): CostItem {
  const amount = row.querySelector<HTMLInputElement>("[data-cost-amount]");
  const currency = row.querySelector<HTMLSelectElement>("[data-cost-currency]");
  const stageInput = row.querySelector<HTMLSelectElement>("[data-cost-stage]");
  const nameInput = row.querySelector<HTMLInputElement>("[data-cost-name-input]");
  const staticName = row.querySelector<HTMLElement>(".cost-row-name span");
  const stage = (stageInput?.value ?? row.dataset.stage) as CostStage | undefined;
  const name = nameInput?.value.trim() || staticName?.textContent?.trim() || "Other";

  if (!amount || !currency || !stage) {
    throw new Error("Cost row is missing required fields.");
  }

  return {
    ...(row.dataset.costId ? { id: row.dataset.costId } : {}),
    name,
    stage,
    amount: amount.value || "0",
    currency: currency.value as CostItem["currency"],
  };
}

function readPricing(mode: PricingMode): PricingInput {
  if (mode === "MARKUP") {
    return {
      type: "MARKUP",
      markup: percentInputToDecimal("target-markup"),
    };
  }

  if (mode === "BUYER_OFFER") {
    return {
      type: "BUYER_OFFER",
      offerPricePerKg: getInputValue("buyer-offer") || "0",
    };
  }

  return {
    type: "MARGIN",
    targetMargin: percentInputToDecimal("target-margin"),
  };
}

function renderWarnings(warnings: CalculationWarning[]): void {
  const warningContainer = mustGetElement("warnings");
  warningContainer.replaceChildren();

  for (const warning of warnings) {
    const item = document.createElement("p");
    item.textContent = warning.message;
    warningContainer.appendChild(item);
  }
}

function getCheckedPricingMode(): PricingMode {
  const checked = document.querySelector<HTMLInputElement>('input[name="pricing-mode"]:checked');
  return (checked?.value ?? "MARGIN") as PricingMode;
}

function updatePricingInputs(mode: PricingMode): void {
  for (const input of document.querySelectorAll<HTMLElement>("[data-pricing-input]")) {
    const isActive = input.dataset.pricingInput === mode;
    input.hidden = !isActive;
    input.classList.toggle("is-active", isActive);
    input.setAttribute("aria-hidden", String(!isActive));
  }
}

function updateCostRowVisibility(incoterm: Incoterm): void {
  const selectedStageOrder = stageOrder[incoterm];

  for (const row of document.querySelectorAll<HTMLElement>(".cost-row")) {
    const stageInput = row.querySelector<HTMLSelectElement>("[data-cost-stage]");
    const stage = (stageInput?.value ?? row.dataset.stage) as CostStage | undefined;

    if (!stage) {
      continue;
    }

    row.hidden = stageOrder[stage] > selectedStageOrder;
    row.classList.toggle("is-excluded", row.hidden);
  }
}

function updateResultStageVisibility(incoterm: Incoterm): void {
  const selectedStageOrder = stageOrder[incoterm];

  for (const row of document.querySelectorAll<HTMLElement>("[data-result-stage]")) {
    const stage = row.dataset.resultStage as CostStage | undefined;

    if (!stage) {
      continue;
    }

    row.hidden = stageOrder[stage] > selectedStageOrder;
  }
}

function applySavedCosting(saved: CostingDraft): void {
  setInputValue("costing-name", saved.name);
  setInputValue("product", saved.product);
  setInputValue("quantity", String(saved.quantity.value));
  setInputValue("incoterm", saved.incoterm);
  setInputValue("fx", String(saved.exchangeRates.USD_IDR ?? ""));
  applyPricing(saved.pricing);
  replaceCostRows(saved.costs.map(costItemToRowState));
}

function applyPricing(pricing: PricingInput): void {
  setPricingMode(pricing.type);

  if (pricing.type === "MARGIN") {
    setInputValue("target-margin", decimalToPercentInput(pricing.targetMargin));
  } else if (pricing.type === "MARKUP") {
    setInputValue("target-markup", decimalToPercentInput(pricing.markup));
  } else {
    setInputValue("buyer-offer", String(pricing.offerPricePerKg));
  }
}

function setPricingMode(mode: PricingMode): void {
  const input = document.querySelector<HTMLInputElement>(`input[name="pricing-mode"][value="${mode}"]`);

  if (input) {
    input.checked = true;
  }
}

function costItemToRowState(cost: CostItem, index: number): CostRowState {
  const standard = standardCosts.find((standardCost) => standardCost.id === cost.id);

  return {
    id: standard?.id ?? `saved-cost-${index}`,
    name: cost.name,
    stage: cost.stage,
    amount: String(cost.amount),
    currency: cost.currency,
    isStandard: standard?.stage === cost.stage,
  };
}

async function renderHistory(): Promise<void> {
  const savedCostings = await listPersistedCostings("ACTIVE");
  historyRows.replaceChildren();
  historyEmpty.hidden = savedCostings.length > 0;

  for (const costing of savedCostings) {
    historyRows.appendChild(createHistoryRow(costing, "active"));
  }
}

async function renderArchived(): Promise<void> {
  const savedCostings = await listPersistedCostings("ARCHIVED");
  archiveRows.replaceChildren();
  archiveEmpty.hidden = savedCostings.length > 0;

  for (const costing of savedCostings) {
    archiveRows.appendChild(createHistoryRow(costing, "archived"));
  }
}

function createHistoryRow(costing: SavedCosting, mode: "active" | "archived"): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.append(
    createCell(costing.name),
    createCell(costing.product || "-"),
    createCell(costing.incoterm),
    createCell(formatUsdPerKg(costing.result.pricing.breakEvenPricePerKg), "numeric"),
    createCell(formatUsdPerKg(costing.result.pricing.sellingPricePerKg), "numeric"),
    createCell(formatPercent(costing.result.pricing.margin), "numeric"),
    createCell(formatDate(costing.updatedAt)),
    createActionCell(costing.id, mode),
  );
  return row;
}

function createCell(text: string, className?: string): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.textContent = text;

  if (className) {
    cell.className = className;
  }

  return cell;
}

function createActionCell(costingId: string, mode: "active" | "archived"): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.className = "history-actions";

  if (mode === "active") {
    cell.append(
      createHistoryButton("Edit", "edit", costingId),
      createHistoryButton("Duplicate", "duplicate", costingId),
      createHistoryButton("Archive", "archive", costingId),
    );
  } else {
    cell.append(
      createHistoryButton("Duplicate", "duplicate", costingId),
      createHistoryButton("Delete", "delete", costingId),
    );
  }

  return cell;
}

function createHistoryButton(label: string, action: string, costingId: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = getHistoryButtonClassName(action);
  button.dataset.historyAction = action;
  button.dataset.costingId = costingId;
  button.textContent = label;
  return button;
}

function getHistoryButtonClassName(action: string): string {
  if (action === "delete") {
    return "table-button danger-button";
  }

  if (action === "archive") {
    return "table-button muted-button";
  }

  return "table-button";
}

function setView(view: "costings" | "archived" | "editor"): void {
  const isEditor = view === "editor";
  const isArchived = view === "archived";
  const isCostings = view === "costings";

  editorSection.hidden = !isEditor;
  resultsPanel.hidden = !isEditor;
  historySection.hidden = !isCostings;
  archiveSection.hidden = !isArchived;
  showCostingsButton.classList.toggle("is-active", isCostings);
  showArchivedButton.classList.toggle("is-active", isArchived);

  if (isCostings) {
    void renderHistory();
  }

  if (isArchived) {
    void renderArchived();
  }
}

async function listPersistedCostings(status: SavedCosting["status"]): Promise<SavedCosting[]> {
  const response = await fetch("/api/costings");
  const costings = await parseJsonResponse<SavedCosting[]>(response);
  return costings.filter((costing) => costing.status === status);
}

async function fetchCosting(id: string): Promise<SavedCosting | undefined> {
  const response = await fetch(`/api/costings/${encodeURIComponent(id)}`);

  if (response.status === 404) {
    return undefined;
  }

  return parseJsonResponse<SavedCosting>(response);
}

async function persistCosting(draft: CostingDraft, existingId?: string): Promise<SavedCosting> {
  const response = await fetch(existingId ? `/api/costings/${encodeURIComponent(existingId)}` : "/api/costings", {
    method: existingId ? "PUT" : "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(draft),
  });

  return parseJsonResponse<SavedCosting>(response);
}

async function archivePersistedCosting(id: string): Promise<SavedCosting> {
  const response = await fetch(`/api/costings/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });

  return parseJsonResponse<SavedCosting>(response);
}

async function deletePersistedCosting(id: string): Promise<void> {
  const response = await fetch(`/api/costings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  await parseJsonResponse<{ deleted: true }>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as unknown;

  if (!response.ok) {
    throw new Error(getResponseError(body) ?? "Request failed.");
  }

  return body as T;
}

function getResponseError(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return undefined;
  }

  const error = body.error;
  return typeof error === "string" ? error : undefined;
}

function createCostingId(): string {
  return crypto.randomUUID();
}

function decimalToPercentInput(value: string | number): string {
  return String(Number(value) * 100);
}

function percentInputToDecimal(id: string): string {
  return String(Number(getInputValue(id) || "0") / 100);
}

function updateSaveButtonLabel(): void {
  saveCostingButton.textContent = currentCostingId ? "Update" : "Save";
  editorMode.textContent = currentCostingId ? "Update costing" : "New costing";
}

function clearFieldErrors(): void {
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[aria-invalid='true']")) {
    input.removeAttribute("aria-invalid");
  }
}

function applyCalculationError(error: unknown): void {
  clearFieldErrors();

  if (!(error instanceof CalculationError)) {
    return;
  }

  if (error.code === "INVALID_QUANTITY") {
    markFieldInvalid("quantity");
  } else if (error.code === "INVALID_EXCHANGE_RATE") {
    markFieldInvalid("fx");
  } else if (error.code === "INVALID_MARGIN") {
    markFieldInvalid("target-margin");
  } else if (error.code === "INVALID_MARKUP") {
    markFieldInvalid("target-markup");
  } else if (error.code === "INVALID_BUYER_OFFER") {
    markFieldInvalid("buyer-offer");
  } else if (error.code === "INVALID_COST") {
    for (const input of document.querySelectorAll<HTMLInputElement>("[data-cost-amount]")) {
      const amount = Number(input.value || "0");

      if (!Number.isFinite(amount) || amount < 0) {
        input.setAttribute("aria-invalid", "true");
      }
    }
  }
}

function markFieldInvalid(id: string): void {
  const field = mustGetElement(id);
  field.setAttribute("aria-invalid", "true");
}

function formatUsdPerKg(value: string): string {
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })}/kg`;
}

function formatUsd(value: string): string {
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatPercent(value: string): string {
  return Number(value).toLocaleString("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatKg(value: string): string {
  return Number(value || "0").toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getInputValue(id: string): string {
  const element = mustGetElement(id) as HTMLInputElement | HTMLSelectElement;
  return element.value;
}

function setInputValue(id: string, value: string): void {
  const element = mustGetElement(id) as HTMLInputElement | HTMLSelectElement;
  element.value = value;
}

function setText(id: string, value: string): void {
  mustGetElement(id).textContent = value;
}

function mustGetElement(id: string): HTMLElement {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element;
}

function mustQueryElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}
