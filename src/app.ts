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
import {
  LoadCalculationError,
  calculatePacking,
  comparePackingAcrossContainers,
  containerSpecifications,
  createDuplicateLoadPlanDraft,
  createLoadCostingSeed,
  getContainerSpecification,
  getPackingLayers,
  type CargoInput,
  type DimensionUnit,
  type LoadPlanDraft,
  type LoadPlanMode,
  type PackingResult,
  type SavedLoadPlan,
  type WeightUnit,
} from "./domain/load/index.js";
import { LoadViewer, type CameraPreset, type ContainerDisplayMode } from "./loadViewer.js";
import { BuyerFinderUi } from "./buyerFinderUi.js";
import {
  defaultWorkspaceRoute,
  formatWorkspaceHash,
  parseWorkspaceHash,
  type ToolName,
  type ToolSubview,
} from "./workspaceRoute.js";

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
type WorkspaceNavigation = "push" | "replace" | "none";

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
const backToListButton = mustGetElement("back-to-list");
const historyNewCostingButton = mustGetElement("history-new-costing");
const showCostingToolButton = mustGetElement("show-costing-tool");
const showLoadToolButton = mustGetElement("show-load-tool");
const showBuyerToolButton = mustGetElement("show-buyer-tool");
const showCalculatorButton = mustGetElement("show-calculator");
const showSavedPlansButton = mustGetElement("show-saved-plans");
const showArchivedPlansButton = mustGetElement("show-archived-plans");
const pageTitle = mustGetElement("page-title");
const editorMode = mustGetElement("editor-mode");
const editorSection = mustQueryElement(".editor");
const resultsPanel = mustQueryElement(".results");
const historySection = mustGetElement("history-section");
const historyRows = mustGetElement("history-rows");
const historyEmpty = mustGetElement("history-empty");
const archiveSection = mustGetElement("archive-section");
const archiveRows = mustGetElement("archive-rows");
const archiveEmpty = mustGetElement("archive-empty");
const loadSection = mustGetElement("load-section");
const loadSavedSection = mustGetElement("load-saved-section");
const loadArchiveSection = mustGetElement("load-archive-section");
const loadForm = mustGetElement("load-form");
const loadPlanNameInput = mustGetElement("load-plan-name") as HTMLInputElement;
const loadContainerSelect = mustGetElement("load-container") as HTMLSelectElement;
const loadModeSelect = mustGetElement("load-mode") as HTMLSelectElement;
const newLoadPlanButton = mustGetElement("new-load-plan");
const savedNewLoadPlanButton = mustGetElement("saved-new-load-plan");
const saveLoadPlanButton = mustGetElement("save-load-plan") as HTMLButtonElement;
const createCostingFromLoadButton = mustGetElement("create-costing-from-load") as HTMLButtonElement;
const resetLoadCameraButton = mustGetElement("reset-load-camera");
const loadLayerFilter = mustGetElement("load-layer-filter") as HTMLSelectElement;
const loadContainerMode = mustGetElement("load-container-mode") as HTMLSelectElement;
const loadViewerStatus = mustGetElement("load-viewer-status");
const loadComparisonRows = mustGetElement("load-comparison-rows");
const loadComparisonEmpty = mustGetElement("load-comparison-empty");
const loadPlanRows = mustGetElement("load-plan-rows");
const loadPlansEmpty = mustGetElement("load-plans-empty");
const loadPlansStatus = mustGetElement("load-plans-status");
const loadArchiveRows = mustGetElement("load-archive-rows");
const loadArchiveEmpty = mustGetElement("load-archive-empty");
const loadArchiveStatus = mustGetElement("load-archive-status");
const cameraPresetButtons = document.querySelectorAll<HTMLButtonElement>("[data-camera-preset]");
const loadViewer = new LoadViewer(mustGetElement("load-viewer"));
const buyerFinderUi = new BuyerFinderUi((subview) => setWorkspace("buyer", subview));
let currentCostingId: string | undefined;
let activeTool: ToolName = "costing";
let activeSubview: ToolSubview = "calculator";
let currentLoadPlanId: string | undefined;
let currentLoadResult: PackingResult | undefined;
let currentLoadComparisons: PackingResult[] = [];
const maxViewerCartons = 5000;

for (const cost of standardCosts) {
  costRows.appendChild(createCostRow(cost));
}

populateLoadContainers();
form.addEventListener("input", render);
form.addEventListener("change", render);
addCostButton.addEventListener("click", addCustomCostRow);
costRows.addEventListener("click", handleCostTableClick);
saveCostingButton.addEventListener("click", handleSaveCosting);
backToListButton.addEventListener("click", () => setWorkspace("costing", "saved"));
historyNewCostingButton.addEventListener("click", handleNewCosting);
showCostingToolButton.addEventListener("click", () => setWorkspace("costing", "calculator"));
showLoadToolButton.addEventListener("click", () => setWorkspace("load", "calculator"));
showBuyerToolButton.addEventListener("click", () => setWorkspace("buyer", "calculator"));
showCalculatorButton.addEventListener("click", () => setWorkspace(activeTool, "calculator"));
showSavedPlansButton.addEventListener("click", () => setWorkspace(activeTool, "saved"));
showArchivedPlansButton.addEventListener("click", () => setWorkspace(activeTool, "archived"));
historyRows.addEventListener("click", handleHistoryAction);
archiveRows.addEventListener("click", handleHistoryAction);
loadForm.addEventListener("submit", handleCalculateLoad);
loadForm.addEventListener("input", handleLoadInputChange);
loadForm.addEventListener("change", handleLoadInputChange);
newLoadPlanButton.addEventListener("click", handleNewLoadPlan);
savedNewLoadPlanButton.addEventListener("click", handleNewLoadPlan);
saveLoadPlanButton.addEventListener("click", handleSaveLoadPlan);
createCostingFromLoadButton.addEventListener("click", handleCreateCostingFromLoad);
resetLoadCameraButton.addEventListener("click", () => {
  loadViewer.resetCamera(getContainerSpecification(getInputValue("load-container")));
});
loadLayerFilter.addEventListener("change", handleLayerFilterChange);
loadContainerMode.addEventListener("change", () => {
  loadViewer.setContainerMode(loadContainerMode.value as ContainerDisplayMode);
});
loadComparisonRows.addEventListener("click", handleLoadComparisonClick);
loadComparisonRows.addEventListener("keydown", handleLoadComparisonKeydown);
loadPlanRows.addEventListener("click", handleLoadPlanAction);
loadArchiveRows.addEventListener("click", handleLoadPlanAction);
window.addEventListener("popstate", handleWorkspaceLocationChange);
window.addEventListener("hashchange", handleWorkspaceLocationChange);

for (const button of cameraPresetButtons) {
  button.addEventListener("click", () => {
    loadViewer.setCameraPreset(button.dataset.cameraPreset as CameraPreset);
  });
}

void renderHistory();
void renderArchived();
void renderLoadPlans();
void renderArchivedLoadPlans();
updateSaveButtonLabel();
updateLoadSaveButtonLabel();
updateLoadCostingButtonState();
render();
renderEmptyLoadResult();
const initialWorkspace = parseWorkspaceHash(window.location.hash) ?? defaultWorkspaceRoute;
setWorkspace(initialWorkspace.tool, initialWorkspace.subview, "replace");

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
  setWorkspace("costing", "calculator");
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
    setWorkspace("costing", "calculator");
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
    setWorkspace("costing", "calculator");
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
    setWorkspace("costing", "saved");
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

function setWorkspace(
  tool: ToolName,
  subview: ToolSubview,
  navigation: WorkspaceNavigation = "push",
): void {
  activeTool = tool;
  activeSubview = subview;
  updateWorkspaceLocation(tool, subview, navigation);

  const showCostingCalculator = tool === "costing" && subview === "calculator";
  const showCostingSaved = tool === "costing" && subview === "saved";
  const showCostingArchived = tool === "costing" && subview === "archived";
  const showLoadCalculator = tool === "load" && subview === "calculator";
  const showLoadSaved = tool === "load" && subview === "saved";
  const showLoadArchived = tool === "load" && subview === "archived";

  editorSection.hidden = !showCostingCalculator;
  resultsPanel.hidden = !showCostingCalculator;
  historySection.hidden = !showCostingSaved;
  archiveSection.hidden = !showCostingArchived;
  loadSection.hidden = !showLoadCalculator;
  loadSavedSection.hidden = !showLoadSaved;
  loadArchiveSection.hidden = !showLoadArchived;
  if (tool === "buyer") {
    buyerFinderUi.show(subview);
  } else {
    buyerFinderUi.hide();
  }

  showCostingToolButton.classList.toggle("is-active", tool === "costing");
  showLoadToolButton.classList.toggle("is-active", tool === "load");
  showBuyerToolButton.classList.toggle("is-active", tool === "buyer");
  showCalculatorButton.classList.toggle("is-active", subview === "calculator");
  showSavedPlansButton.classList.toggle("is-active", subview === "saved");
  showArchivedPlansButton.classList.toggle("is-active", subview === "archived");
  showCalculatorButton.textContent = tool === "buyer" ? "Search" : "Calculator";
  showSavedPlansButton.textContent = tool === "buyer" ? "History" : "Saved Plans";
  showArchivedPlansButton.textContent = tool === "buyer" ? "Saved Buyers" : "Archived";
  pageTitle.textContent = getPageTitle(tool, subview);

  if (showCostingSaved) {
    void renderHistory();
  }

  if (showCostingArchived) {
    void renderArchived();
  }

  if (showLoadSaved) {
    void renderLoadPlans();
  }

  if (showLoadArchived) {
    void renderArchivedLoadPlans();
  }

  if (showLoadCalculator) {
    loadViewer.resize();
  }
}

function handleWorkspaceLocationChange(): void {
  const route = parseWorkspaceHash(window.location.hash);

  if (!route) {
    setWorkspace(defaultWorkspaceRoute.tool, defaultWorkspaceRoute.subview, "replace");
    return;
  }

  if (route.tool === activeTool && route.subview === activeSubview) {
    return;
  }

  setWorkspace(route.tool, route.subview, "none");
}

function updateWorkspaceLocation(
  tool: ToolName,
  subview: ToolSubview,
  navigation: WorkspaceNavigation,
): void {
  if (navigation === "none") {
    return;
  }

  const nextHash = formatWorkspaceHash({ tool, subview });

  if (window.location.hash === nextHash) {
    return;
  }

  if (navigation === "replace") {
    window.history.replaceState(null, "", nextHash);
  } else {
    window.history.pushState(null, "", nextHash);
  }
}

function getPageTitle(tool: ToolName, subview: ToolSubview): string {
  if (tool === "buyer") {
    if (subview === "saved") return "Buyer Finder History";
    if (subview === "archived") return "Saved Buyers";
    return "Buyer Finder";
  }

  const toolLabel = tool === "costing" ? "Costing Calculator" : "Load Calculator";

  if (subview === "calculator") {
    return tool === "costing" && currentCostingId ? "Edit Costing" : toolLabel;
  }

  if (subview === "saved") {
    return `${toolLabel} Saved Plans`;
  }

  return `${toolLabel} Archived`;
}

function populateLoadContainers(): void {
  loadContainerSelect.replaceChildren();

  for (const container of containerSpecifications) {
    const option = document.createElement("option");
    option.value = container.id;
    option.textContent = container.name;
    option.selected = container.id === "40ft-hc";
    loadContainerSelect.appendChild(option);
  }
}

function handleCalculateLoad(event: SubmitEvent): void {
  event.preventDefault();

  try {
    clearLoadFieldErrors();
    const container = getContainerSpecification(getInputValue("load-container"));
    const cargoInput = readLoadCargoInput();
    const comparisons = comparePackingAcrossContainers(cargoInput, containerSpecifications);
    const result = comparisons.find((comparison) => comparison.containerId === container?.id)
      ?? calculatePacking(cargoInput, container);
    currentLoadComparisons = comparisons;
    renderLoadComparison(comparisons, result.containerId);
    renderLoadResult(result, container);
    setText("load-error-message", getLoadResultMessage(result));
    setLoadPlanStatus("");
  } catch (error) {
    applyLoadCalculationError(error);
    renderEmptyLoadResult();
    setText(
      "load-error-message",
      error instanceof LoadCalculationError ? error.message : "Check the cargo and container inputs.",
    );
  }
}

function handleLoadInputChange(): void {
  const activeElement = document.activeElement;

  if (activeElement === loadPlanNameInput) {
    return;
  }

  renderEmptyLoadResult();
  setText("load-error-message", "");
  setLoadPlanStatus("");
}

async function handleSaveLoadPlan(): Promise<void> {
  try {
    const isExistingLoadPlan = Boolean(currentLoadPlanId);
    const saved = await persistLoadPlan(buildLoadPlanDraft(), currentLoadPlanId);
    currentLoadPlanId = saved.id;
    applySavedLoadPlan(saved);
    await renderLoadPlans();
    updateLoadSaveButtonLabel();
    setLoadPlanStatus(`${isExistingLoadPlan ? "Updated" : "Saved"} ${saved.name}.`);
  } catch (error) {
    setLoadPlanStatus("");
    setText(
      "load-error-message",
      error instanceof Error ? error.message : "Calculate the load before saving.",
    );
  }
}

async function handleNewLoadPlan(): Promise<void> {
  currentLoadPlanId = undefined;
  loadPlanNameInput.value = "";
  setInputValue("load-product", "");
  setInputValue("load-dimension-unit", "CM");
  setInputValue("load-length", "");
  setInputValue("load-width", "");
  setInputValue("load-height", "");
  setInputValue("load-weight", "");
  setInputValue("load-weight-unit", "KG");
  setInputValue("load-units", "");
  setInputValue("load-container", "40ft-hc");
  setInputValue("load-mode", "FLOOR_LOADED");
  clearLoadFieldErrors();
  renderEmptyLoadResult();
  await renderLoadPlans();
  setText("load-error-message", "");
  setLoadPlanStatus("New load plan ready.");
  setWorkspace("load", "calculator");
}

function handleCreateCostingFromLoad(): void {
  if (!currentLoadResult) {
    setLoadPlanStatus("");
    setText("load-error-message", "Calculate the load before starting a costing.");
    return;
  }

  const seed = createLoadCostingSeed(currentLoadResult, getLoadProductName());
  currentCostingId = undefined;
  setInputValue("costing-name", seed.costingName);
  setInputValue("product", seed.product);
  setInputValue("quantity", seed.quantityKg);
  setInputValue("incoterm", "CIF");
  setInputValue("fx", "");
  setPricingMode("MARGIN");
  setInputValue("target-margin", "");
  setInputValue("target-markup", "");
  setInputValue("buyer-offer", "");
  replaceCostRows(standardCosts);
  updateSaveButtonLabel();
  render();
  setText("save-status", `Started from load plan: ${seed.note}`);
  setLoadPlanStatus("");
  setWorkspace("costing", "calculator");
}

function readLoadCargoInput(): CargoInput {
  const productName = getInputValue("load-product").trim();

  return {
    ...(productName ? { productName } : {}),
    dimensions: {
      length: getInputValue("load-length"),
      width: getInputValue("load-width"),
      height: getInputValue("load-height"),
      unit: getInputValue("load-dimension-unit") as DimensionUnit,
    },
    grossWeight: {
      value: getInputValue("load-weight"),
      unit: getInputValue("load-weight-unit") as WeightUnit,
    },
    unitsPerCarton: getInputValue("load-units"),
  };
}

function buildLoadPlanDraft(): LoadPlanDraft {
  if (!currentLoadResult || currentLoadComparisons.length === 0) {
    throw new Error("Calculate the load before saving.");
  }

  return {
    name: getLoadPlanName(currentLoadResult),
    cargoInput: readLoadCargoInput(),
    containerId: currentLoadResult.containerId,
    loadingMode: loadModeSelect.value as LoadPlanMode,
    result: currentLoadResult,
    comparisons: currentLoadComparisons,
  };
}

function renderLoadResult(result: PackingResult, container = getContainerSpecification(result.containerId)): void {
  currentLoadResult = result;
  updateLoadSaveButtonLabel();
  updateLoadCostingButtonState();
  setText("load-summary", `${result.containerName} · ${getLoadProductName()}`);
  setText("load-cartons", formatInteger(result.cartonsLoaded));
  setText("load-total-units", formatInteger(result.totalUnits));
  setText("load-cargo-weight", `${formatNumber(result.totalCargoWeightKg, 2)} kg`);
  setText("load-cargo-cbm", `${formatNumber(result.cargoVolumeM3, 2)} CBM`);
  setText("load-volume-utilization", formatPercentNumber(result.volumeUtilizationPercent));
  setText("load-payload-utilization", formatPercentNumber(result.payloadUtilizationPercent));
  setText("load-limiting-factor", formatLimitingFactor(result.limitingFactor));
  setText("load-orientation", formatOrientation(result));
  setText("load-grid", `${result.grid.x} x ${result.grid.y} x ${result.grid.z}`);
  updateLoadLayerFilter(result);

  if (!container) {
    setText("load-viewer-status", "");
    loadViewer.clear();
    return;
  }

  if (result.cartonsLoaded > maxViewerCartons) {
    loadViewer.clear();
    setText(
      "load-viewer-status",
      `3D preview is limited to ${formatInteger(maxViewerCartons)} cartons. The calculation and comparison results are still complete.`,
    );
  } else {
    loadViewer.renderPacking(result, container);
    setText("load-viewer-status", "");
  }
}

function renderEmptyLoadResult(): void {
  currentLoadResult = undefined;
  setText("load-summary", "Enter cargo details and calculate a container load.");
  setText("load-cartons", "-");
  setText("load-total-units", "-");
  setText("load-cargo-weight", "-");
  setText("load-cargo-cbm", "-");
  setText("load-volume-utilization", "-");
  setText("load-payload-utilization", "-");
  setText("load-limiting-factor", "-");
  setText("load-orientation", "-");
  setText("load-grid", "-");
  clearLoadComparison();
  clearLoadLayerFilter();
  loadViewer.clear();
  setText("load-viewer-status", "");
  updateLoadSaveButtonLabel();
  updateLoadCostingButtonState();
}

function renderLoadComparison(results: PackingResult[], selectedContainerId: string): void {
  loadComparisonRows.replaceChildren();
  loadComparisonEmpty.hidden = results.length > 0;

  for (const result of results) {
    loadComparisonRows.appendChild(createLoadComparisonRow(result, selectedContainerId));
  }
}

function createLoadComparisonRow(result: PackingResult, selectedContainerId: string): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.className = result.containerId === selectedContainerId ? "is-selected" : "";
  row.dataset.containerId = result.containerId;
  row.tabIndex = 0;
  row.append(
    createCell(result.containerName),
    createCell(formatInteger(result.cartonsLoaded), "numeric"),
    createCell(formatInteger(result.totalUnits), "numeric"),
    createCell(`${formatNumber(result.totalCargoWeightKg, 2)} kg`, "numeric"),
    createCell(formatNumber(result.cargoVolumeM3, 2), "numeric"),
    createCell(formatPercentNumber(result.volumeUtilizationPercent), "numeric"),
    createCell(formatPercentNumber(result.payloadUtilizationPercent), "numeric"),
    createCell(formatLimitingFactor(result.limitingFactor)),
  );
  return row;
}

function clearLoadComparison(): void {
  currentLoadComparisons = [];
  loadComparisonRows.replaceChildren();
  loadComparisonEmpty.hidden = false;
}

function handleLoadComparisonClick(event: MouseEvent): void {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const row = target.closest<HTMLTableRowElement>("[data-container-id]");

  if (!row?.dataset.containerId) {
    return;
  }

  selectLoadComparison(row.dataset.containerId);
}

function handleLoadComparisonKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const row = target.closest<HTMLTableRowElement>("[data-container-id]");

  if (!row?.dataset.containerId) {
    return;
  }

  event.preventDefault();
  selectLoadComparison(row.dataset.containerId);
}

function selectLoadComparison(containerId: string): void {
  const result = currentLoadComparisons.find((comparison) => comparison.containerId === containerId);
  const container = getContainerSpecification(containerId);

  if (!result || !container) {
    return;
  }

  loadContainerSelect.value = containerId;
  renderLoadComparison(currentLoadComparisons, containerId);
  renderLoadResult(result, container);
  setText("load-error-message", getLoadResultMessage(result));
}

async function renderLoadPlans(): Promise<void> {
  const loadPlans = await listPersistedLoadPlans("ACTIVE");
  loadPlanRows.replaceChildren();
  loadPlansEmpty.hidden = loadPlans.length > 0;

  for (const loadPlan of loadPlans) {
    loadPlanRows.appendChild(createLoadPlanRow(loadPlan, "active"));
  }
}

async function renderArchivedLoadPlans(): Promise<void> {
  const loadPlans = await listPersistedLoadPlans("ARCHIVED");
  loadArchiveRows.replaceChildren();
  loadArchiveEmpty.hidden = loadPlans.length > 0;

  for (const loadPlan of loadPlans) {
    loadArchiveRows.appendChild(createLoadPlanRow(loadPlan, "archived"));
  }
}

function createLoadPlanRow(loadPlan: SavedLoadPlan, mode: "active" | "archived"): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.append(
    createCell(loadPlan.name),
    createCell(loadPlan.cargoInput.productName || "-"),
    createCell(loadPlan.result.containerName),
    createCell(formatInteger(loadPlan.result.cartonsLoaded), "numeric"),
    createCell(formatInteger(loadPlan.result.totalUnits), "numeric"),
    createCell(formatDate(loadPlan.updatedAt)),
    createLoadPlanActionCell(loadPlan.id, mode),
  );
  return row;
}

function createLoadPlanActionCell(loadPlanId: string, mode: "active" | "archived"): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.className = "history-actions";

  if (mode === "active") {
    cell.append(
      createLoadPlanButton("Open", "open", loadPlanId),
      createLoadPlanButton("Duplicate", "duplicate", loadPlanId),
      createLoadPlanButton("Archive", "archive", loadPlanId),
    );
  } else {
    cell.append(
      createLoadPlanButton("Duplicate", "duplicate", loadPlanId),
      createLoadPlanButton("Delete", "delete", loadPlanId),
    );
  }

  return cell;
}

function createLoadPlanButton(label: string, action: string, loadPlanId: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = getLoadPlanButtonClassName(action);
  button.dataset.loadPlanAction = action;
  button.dataset.loadPlanId = loadPlanId;
  button.textContent = label;
  return button;
}

function getLoadPlanButtonClassName(action: string): string {
  if (action === "delete") {
    return "table-button danger-button";
  }

  if (action === "archive") {
    return "table-button muted-button";
  }

  return "table-button";
}

async function handleLoadPlanAction(event: MouseEvent): Promise<void> {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-load-plan-action]");
  const id = button?.dataset.loadPlanId;

  if (!button || !id) {
    return;
  }

  const saved = await fetchLoadPlan(id);

  if (!saved) {
    await renderLoadPlans();
    setLoadPlanStatus("");
    setText("load-error-message", "Saved load plan could not be found.");
    return;
  }

  if (button.dataset.loadPlanAction === "open") {
    currentLoadPlanId = saved.id;
    applySavedLoadPlan(saved);
    setText("load-error-message", getLoadResultMessage(saved.result));
    setLoadPlanStatus(`Opened ${saved.name}.`);
    setWorkspace("load", "calculator");
    return;
  }

  if (button.dataset.loadPlanAction === "duplicate") {
    currentLoadPlanId = undefined;
    applyLoadPlanDraft(createDuplicateLoadPlanDraft(saved));
    setText("load-error-message", getLoadResultMessage(saved.result));
    setLoadPlanStatus(`Duplicated ${saved.name}. Save when ready.`);
    setWorkspace("load", "calculator");
    return;
  }

  if (button.dataset.loadPlanAction === "archive") {
    await archivePersistedLoadPlan(saved.id);

    if (currentLoadPlanId === saved.id) {
      currentLoadPlanId = undefined;
      updateLoadSaveButtonLabel();
    }

    await renderLoadPlans();
    await renderArchivedLoadPlans();
    setLoadPlanStatus(`Archived ${saved.name}.`);
    setWorkspace("load", "saved");
    return;
  }

  if (button.dataset.loadPlanAction === "delete") {
    const confirmed = window.confirm(`Permanently delete "${saved.name}"?`);

    if (!confirmed) {
      return;
    }

    await deletePersistedLoadPlan(saved.id);

    if (currentLoadPlanId === saved.id) {
      currentLoadPlanId = undefined;
      updateLoadSaveButtonLabel();
    }

    await renderLoadPlans();
    await renderArchivedLoadPlans();
    setLoadPlanStatus(`Deleted ${saved.name}.`);
  }
}

function applySavedLoadPlan(saved: SavedLoadPlan): void {
  currentLoadPlanId = saved.id;
  applyLoadPlanDraft(saved);
}

function applyLoadPlanDraft(draft: LoadPlanDraft): void {
  loadPlanNameInput.value = draft.name;
  setInputValue("load-product", draft.cargoInput.productName ?? "");
  setInputValue("load-dimension-unit", draft.cargoInput.dimensions.unit);
  setInputValue("load-length", String(draft.cargoInput.dimensions.length));
  setInputValue("load-width", String(draft.cargoInput.dimensions.width));
  setInputValue("load-height", String(draft.cargoInput.dimensions.height));
  setInputValue("load-weight", String(draft.cargoInput.grossWeight.value));
  setInputValue("load-weight-unit", draft.cargoInput.grossWeight.unit);
  setInputValue("load-units", String(draft.cargoInput.unitsPerCarton));
  setInputValue("load-container", draft.containerId);
  setInputValue("load-mode", draft.loadingMode);
  currentLoadComparisons = draft.comparisons;
  renderLoadComparison(draft.comparisons, draft.result.containerId);
  renderLoadResult(draft.result, getContainerSpecification(draft.result.containerId));
  updateLoadSaveButtonLabel();
}

function updateLoadLayerFilter(result: PackingResult): void {
  const previousValue = loadLayerFilter.value;
  const layers = getPackingLayers(result);

  loadLayerFilter.replaceChildren();
  loadLayerFilter.append(createTextOption("ALL", "All layers", true));

  for (const layer of layers) {
    const option = createTextOption(String(layer.layer), `Layer ${layer.layer} (${layer.cartonCount})`);
    loadLayerFilter.append(option);
  }

  loadLayerFilter.disabled = layers.length === 0;

  if (previousValue !== "ALL" && Array.from(loadLayerFilter.options).some((option) => option.value === previousValue)) {
    loadLayerFilter.value = previousValue;
    loadViewer.setLayerFilter(Number(previousValue));
  } else {
    loadLayerFilter.value = "ALL";
    loadViewer.setLayerFilter("ALL");
  }
}

function clearLoadLayerFilter(): void {
  loadLayerFilter.replaceChildren(createTextOption("ALL", "All layers", true));
  loadLayerFilter.disabled = true;
  loadViewer.setLayerFilter("ALL");
}

function handleLayerFilterChange(): void {
  const value = loadLayerFilter.value;
  loadViewer.setLayerFilter(value === "ALL" ? "ALL" : Number(value));
}

function createTextOption(value: string, label: string, selected = false): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  return option;
}

function getLoadResultMessage(result: PackingResult): string {
  if (result.reason === "CARGO_DIMENSIONS_EXCEED_CONTAINER") {
    return "This cargo cannot fit inside the selected container.";
  }

  if (result.reason === "CARGO_WEIGHT_EXCEEDS_PAYLOAD") {
    return "One carton is heavier than the selected container payload.";
  }

  return "";
}

function getLoadProductName(): string {
  return getInputValue("load-product").trim() || "Untitled product";
}

function formatOrientation(result: PackingResult): string {
  const unit = getInputValue("load-dimension-unit") as DimensionUnit;
  const divisor = unit === "MM" ? 1 : unit === "CM" ? 10 : 25.4;
  const suffix = unit === "MM" ? "mm" : unit === "CM" ? "cm" : "in";
  const orientation = result.orientation;

  return [
    formatNumber(orientation.lengthMm / divisor, 2),
    formatNumber(orientation.widthMm / divisor, 2),
    formatNumber(orientation.heightMm / divisor, 2),
  ].join(" x ") + ` ${suffix}`;
}

function formatLimitingFactor(value: PackingResult["limitingFactor"]): string {
  if (value === "SPACE") {
    return "Space";
  }

  if (value === "WEIGHT") {
    return "Weight";
  }

  return "Equal";
}

function clearLoadFieldErrors(): void {
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-load-field][aria-invalid='true']")) {
    input.removeAttribute("aria-invalid");
  }
}

function applyLoadCalculationError(error: unknown): void {
  clearLoadFieldErrors();

  if (!(error instanceof LoadCalculationError)) {
    return;
  }

  if (error.code === "INVALID_DIMENSION") {
    markLoadFieldsInvalid("dimension");
  } else if (error.code === "INVALID_WEIGHT") {
    markLoadFieldsInvalid("weight");
  } else if (error.code === "INVALID_UNITS_PER_CARTON") {
    markLoadFieldsInvalid("units");
  } else if (error.code === "INVALID_CONTAINER") {
    markLoadFieldsInvalid("container");
  }
}

function markLoadFieldsInvalid(fieldName: string): void {
  for (const field of document.querySelectorAll<HTMLElement>(`[data-load-field="${fieldName}"]`)) {
    field.setAttribute("aria-invalid", "true");
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

async function listPersistedLoadPlans(status: SavedLoadPlan["status"]): Promise<SavedLoadPlan[]> {
  const response = await fetch("/api/load-plans");
  const loadPlans = await parseJsonResponse<SavedLoadPlan[]>(response);
  return loadPlans.filter((loadPlan) => loadPlan.status === status);
}

async function fetchLoadPlan(id: string): Promise<SavedLoadPlan | undefined> {
  const response = await fetch(`/api/load-plans/${encodeURIComponent(id)}`);

  if (response.status === 404) {
    return undefined;
  }

  return parseJsonResponse<SavedLoadPlan>(response);
}

async function persistLoadPlan(draft: LoadPlanDraft, existingId?: string): Promise<SavedLoadPlan> {
  const response = await fetch(existingId ? `/api/load-plans/${encodeURIComponent(existingId)}` : "/api/load-plans", {
    method: existingId ? "PUT" : "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(draft),
  });

  return parseJsonResponse<SavedLoadPlan>(response);
}

async function deletePersistedLoadPlan(id: string): Promise<void> {
  const response = await fetch(`/api/load-plans/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  await parseJsonResponse<{ deleted: true }>(response);
}

async function archivePersistedLoadPlan(id: string): Promise<SavedLoadPlan> {
  const response = await fetch(`/api/load-plans/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });

  return parseJsonResponse<SavedLoadPlan>(response);
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

  if (!editorSection.hidden) {
    pageTitle.textContent = currentCostingId ? "Edit costing" : "New costing";
  }
}

function updateLoadSaveButtonLabel(): void {
  saveLoadPlanButton.textContent = currentLoadPlanId ? "Update plan" : "Save plan";
  saveLoadPlanButton.disabled = !currentLoadResult;
}

function updateLoadCostingButtonState(): void {
  createCostingFromLoadButton.disabled = !currentLoadResult;
}

function setLoadPlanStatus(message: string): void {
  loadPlansStatus.textContent = message;
  loadArchiveStatus.textContent = message;
  setText("load-save-status", message);
}

function getLoadPlanName(result: PackingResult): string {
  const explicitName = loadPlanNameInput.value.trim();

  if (explicitName) {
    return explicitName;
  }

  const product = getLoadProductName();
  return product === "Untitled product" ? `${result.containerName} load plan` : `${product} ${result.containerName}`;
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

function formatPercentNumber(value: number): string {
  return `${formatNumber(value, 1)}%`;
}

function formatInteger(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
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
