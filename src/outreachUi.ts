import { listUnknownPlaceholders, renderEmailTemplate, type TemplateValues } from "./domain/outreach/emailTemplate.js";
import { fetchOutreachTemplate, saveOutreachTemplate } from "./outreachApi.js";

const SAMPLE: Required<TemplateValues> = {
  company: "Acme Foods",
  country: "Thailand",
  city: "Bangkok",
  commodity: "coconut",
  buyerType: "Importer",
  contactName: "Purchasing",
  ourCompany: "Trade Tools",
};

export class OutreachUi {
  private readonly section = mustGetElement("buyer-outreach-section");
  private readonly subject = mustGetElement("outreach-subject") as HTMLInputElement;
  private readonly body = mustGetElement("outreach-body") as HTMLTextAreaElement;
  private ourCompany = "";
  private loaded = false;

  constructor() {
    this.subject.addEventListener("input", () => this.renderPreview());
    this.body.addEventListener("input", () => this.renderPreview());
    mustGetElement("outreach-save").addEventListener("click", () => void this.save());
  }

  show(visible: boolean): void {
    this.section.hidden = !visible;
    if (visible && !this.loaded) void this.load();
  }

  hide(): void {
    this.section.hidden = true;
  }

  private async load(): Promise<void> {
    setText("outreach-error", "");
    try {
      const response = await fetchOutreachTemplate();
      this.ourCompany = response.sender.ourCompany;
      this.subject.value = response.template.subject;
      this.body.value = response.template.body;
      this.loaded = true;
      const warning = mustGetElement("outreach-config-warning");
      warning.hidden = response.mailConfigured;
      warning.textContent = "Outreach is not configured on the server. Set ZOHO_SMTP_USER and ZOHO_SMTP_PASSWORD to enable sending.";
      this.renderChips(response.placeholders);
      this.renderPreview();
    } catch (error) {
      setText("outreach-error", messageOf(error));
    }
  }

  private renderChips(placeholders: string[]): void {
    const container = mustGetElement("outreach-placeholders");
    container.replaceChildren();
    for (const key of placeholders) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "placeholder-chip";
      chip.textContent = `{${key}}`;
      chip.addEventListener("click", () => this.insertToken(`{${key}}`));
      chip.addEventListener("mousedown", (event) => event.preventDefault());
      container.appendChild(chip);
    }
  }

  private insertToken(token: string): void {
    const active = document.activeElement === this.body ? this.body : this.subject;
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? start;
    active.value = `${active.value.slice(0, start)}${token}${active.value.slice(end)}`;
    active.focus();
    active.selectionStart = active.selectionEnd = start + token.length;
    this.renderPreview();
  }

  private renderPreview(): void {
    const template = { subject: this.subject.value, body: this.body.value };
    const values: TemplateValues = { ...SAMPLE, ourCompany: this.ourCompany || SAMPLE.ourCompany };
    const rendered = renderEmailTemplate(template, values);
    setText("outreach-preview-subject", rendered.subject);
    setText("outreach-preview-body", rendered.body);
    const unknown = listUnknownPlaceholders(template);
    const note = mustGetElement("outreach-unknown");
    note.hidden = unknown.length === 0;
    note.textContent = unknown.length ? `Unrecognized placeholders (kept as typed): ${unknown.map((k) => `{${k}}`).join(", ")}.` : "";
  }

  private async save(): Promise<void> {
    setText("outreach-error", "");
    setText("outreach-status", "");
    try {
      await saveOutreachTemplate({ subject: this.subject.value, body: this.body.value });
      setText("outreach-status", "Template saved.");
    } catch (error) {
      setText("outreach-error", messageOf(error));
    }
  }
}

function mustGetElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element;
}
function setText(id: string, value: string): void {
  const element = mustGetElement(id);
  element.textContent = value;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
