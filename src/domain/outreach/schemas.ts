import { z } from "zod";

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const EmailTemplateSchema = z
  .object({
    subject: trimmed(1, 500),
    body: trimmed(1, 20_000),
  })
  .strict();

export type EmailTemplateInput = z.infer<typeof EmailTemplateSchema>;

export const OutreachSendSchema = z
  .object({
    buyerMatchId: trimmed(1, 200),
    contactId: trimmed(1, 200),
    subject: trimmed(1, 500),
    body: trimmed(1, 20_000),
  })
  .strict();

export type OutreachSendInput = z.infer<typeof OutreachSendSchema>;
