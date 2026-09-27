import { authenticatedFetch } from "./auth.js";
import type { EmailTemplate, OutreachSummary } from "./domain/outreach/emailTemplate.js";

export type OutreachTemplateResponse = {
  template: EmailTemplate;
  mailConfigured: boolean;
  sender: { fromAddress: string | null; ourCompany: string };
  placeholders: string[];
};

type ErrorBody = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    ...(init?.body ? { body: init.body } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as ErrorBody | null)?.error?.message;
    throw new Error(message ?? `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

export function fetchOutreachTemplate(): Promise<OutreachTemplateResponse> {
  return request<OutreachTemplateResponse>("/api/buyer-outreach/template");
}

export function saveOutreachTemplate(template: EmailTemplate): Promise<{ template: EmailTemplate }> {
  return request<{ template: EmailTemplate }>("/api/buyer-outreach/template", {
    method: "PUT",
    body: JSON.stringify(template),
  });
}

export async function fetchOutreachSummaries(): Promise<Record<string, OutreachSummary>> {
  const body = await request<{ summaries: Record<string, OutreachSummary> }>("/api/buyer-outreach/summaries");
  return body.summaries ?? {};
}
