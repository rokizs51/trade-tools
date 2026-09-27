import { z } from "zod";

import {
  EmailTemplateSchema,
  OutreachSendSchema,
  PLACEHOLDER_KEYS,
} from "../dist/domain/outreach/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;

class InvalidJsonError extends Error {
  constructor() { super("Request body must contain valid JSON."); this.name = "InvalidJsonError"; this.code = "INVALID_JSON"; }
}
class RequestBodyTooLargeError extends Error {
  constructor(max) { super(`Request body cannot exceed ${max} bytes.`); this.name = "RequestBodyTooLargeError"; this.code = "REQUEST_BODY_TOO_LARGE"; }
}

export function createOutreachApiHandler({ outreachRepository, buyerRepository, mailSender, config, now = () => new Date().toISOString(), createId }) {
  // The client-visible flag follows config.mailConfigured (the server pairs it with a sender);
  // sending additionally requires an actual mailSender so a degenerate config still yields 503.
  const mailConfigured = config.mailConfigured !== false;
  const canSend = mailConfigured && Boolean(mailSender);

  return async function handleOutreachApiRequest(request, response, url) {
    if (!url.pathname.startsWith("/api/buyer-outreach")) return false;
    try {
      if (request.method === "GET" && url.pathname === "/api/buyer-outreach/template") {
        const stored = await outreachRepository.getTemplate();
        sendJson(response, 200, {
          template: stored ?? { subject: config.defaultTemplate.subject, body: config.defaultTemplate.body },
          mailConfigured,
          sender: { fromAddress: config.fromAddress || null, ourCompany: config.ourCompany ?? "" },
          placeholders: [...PLACEHOLDER_KEYS],
        });
        return true;
      }

      if (request.method === "PUT" && url.pathname === "/api/buyer-outreach/template") {
        const input = EmailTemplateSchema.parse(await readJsonBody(request));
        const saved = await outreachRepository.saveTemplate(input, { now: now() });
        sendJson(response, 200, { template: saved });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/api/buyer-outreach/summaries") {
        sendJson(response, 200, { summaries: await outreachRepository.listSummaries() });
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/buyer-outreach/send") {
        const result = await handleSend(request);
        sendJson(response, result.status, result.body);
        return true;
      }

      sendError(response, 404, "API_ROUTE_NOT_FOUND", "Outreach API route was not found.");
      return true;
    } catch (error) {
      handleApiError(response, error);
      return true;
    }
  };

  async function handleSend(request) {
    const input = OutreachSendSchema.parse(await readJsonBody(request));
    if (!canSend) {
      return { status: 503, body: error("MAIL_NOT_CONFIGURED", "Configure the Zoho SMTP settings on the server before sending.") };
    }
    const match = await buyerRepository.getBuyerMatch(input.buyerMatchId);
    if (!match) {
      return { status: 404, body: error("BUYER_MATCH_NOT_FOUND", "Buyer candidate was not found.") };
    }
    if (match.reviewStatus !== "APPROVED") {
      return { status: 409, body: error("MATCH_NOT_APPROVED", "Only approved buyers can be emailed.") };
    }
    const contact = match.contacts.find((item) => item.id === input.contactId && item.type === "EMAIL");
    if (!contact) {
      return { status: 409, body: error("RECIPIENT_MISMATCH", "The selected email address is not a stored contact for this buyer.") };
    }
    const sinceIso = new Date(Date.parse(now()) - DAY_MS).toISOString();
    if ((await outreachRepository.countRecentSends(sinceIso)) >= config.maxSendsPerDay) {
      return { status: 429, body: error("DAILY_CAP_REACHED", `The daily outreach limit of ${config.maxSendsPerDay} has been reached.`) };
    }

    const base = {
      id: createId(),
      buyerMatchId: match.id,
      companyId: match.company.id,
      recipientEmail: contact.value,
      subject: input.subject,
      body: input.body,
      sentAt: now(),
    };
    try {
      await mailSender.send({ to: contact.value, subject: input.subject, text: input.body });
      const saved = await outreachRepository.recordSend({ ...base, status: "SENT", errorMessage: null });
      return { status: 201, body: { send: saved } };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown mail error.";
      const saved = await outreachRepository.recordSend({ ...base, status: "FAILED", errorMessage: message.slice(0, 500) });
      return { status: 502, body: { ...error("SEND_FAILED", `Sending failed: ${message.slice(0, 300)}`), send: saved } };
    }
  }
}

function error(code, message) { return { error: { code, message } }; }

function handleApiError(response, err) {
  if (err instanceof z.ZodError) {
    sendError(response, 400, "INVALID_REQUEST", "Request validation failed.", {
      issues: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }
  if (err instanceof InvalidJsonError) { sendError(response, 400, err.code, err.message); return; }
  if (err instanceof RequestBodyTooLargeError) { sendError(response, 413, err.code, err.message); return; }
  console.error("Outreach API error:", err instanceof Error ? err.message : err);
  sendError(response, 500, "INTERNAL_ERROR", "Outreach encountered an internal error.");
}

async function readJsonBody(request, maximumBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new RequestBodyTooLargeError(maximumBytes);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new InvalidJsonError(); }
}

function sendError(response, status, code, message, details) {
  sendJson(response, status, { error: { code, message, ...(details === undefined ? {} : { details }) } });
}
function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
