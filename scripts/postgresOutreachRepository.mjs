export function createPostgresOutreachRepository(sql) {
  return {
    async getTemplate() {
      const rows = await sql`
        select subject, body from public.email_templates where id = 'default' limit 1
      `;
      const row = rows[0];
      return row ? { subject: row.subject, body: row.body } : null;
    },

    async saveTemplate(template, options) {
      const now = options.now;
      const rows = await sql`
        insert into public.email_templates (id, subject, body, created_at, updated_at)
        values ('default', ${template.subject}, ${template.body}, ${now}, ${now})
        on conflict (id) do update set
          subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at
        returning subject, body
      `;
      const row = rows[0];
      return { subject: row.subject, body: row.body };
    },

    async recordSend(send) {
      const rows = await sql`
        insert into public.buyer_outreach_sends (
          id, buyer_match_id, company_id, recipient_email, subject, body,
          status, error_message, sent_at, created_at
        ) values (
          ${send.id}, ${send.buyerMatchId}, ${send.companyId}, ${send.recipientEmail},
          ${send.subject}, ${send.body}, ${send.status}, ${send.errorMessage ?? null},
          ${send.sentAt}, ${send.sentAt}
        )
        returning id, status
      `;
      const row = rows[0];
      return { id: row.id, status: row.status };
    },

    async countRecentSends(sinceIso) {
      const rows = await sql`
        select count(*)::int as count from public.buyer_outreach_sends
        where created_at >= ${sinceIso}
      `;
      return rows[0].count;
    },

    async listSummaries() {
      const rows = await sql`
        select company_id,
          count(*) filter (where status = 'SENT')::int as sent_count,
          max(sent_at) filter (where status = 'SENT') as last_sent_at
        from public.buyer_outreach_sends
        group by company_id
      `;
      return Object.fromEntries(rows.map((row) => [
        row.company_id,
        {
          sentCount: row.sent_count,
          lastSentAt: row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null,
        },
      ]));
    },
  };
}
