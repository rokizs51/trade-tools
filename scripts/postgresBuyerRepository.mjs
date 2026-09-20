import {
  extractCanonicalDomain,
  normalizeCompanyName,
  normalizeCountryCode,
  normalizeEmail,
  normalizePhone,
  normalizeSourceUrl,
  normalizeWebsiteUrl,
} from "../dist/domain/buyers/index.js";
import {
  assertSearchRunTransition,
  getSearchRunStage,
  isTerminalSearchRunStatus,
} from "../dist/application/buyerDiscovery/index.js";
import { BuyerMatchNotFoundError, BuyerSearchRunNotFoundError } from "./buyerRepositoryErrors.mjs";

const ACTIVE_RUN_STATUSES = ["QUEUED", "PLANNING", "RESEARCHING", "VERIFYING", "SAVING"];

export function createPostgresBuyerRepository(sql) {
  return {
    async createSearchRun(input, options) {
      const id = options.createId();
      const now = options.now;
      const modelConfig = options.modelConfig ?? {};

      await sql`
        insert into public.buyer_search_runs (
          id, status, commodity, target_country, target_area, requested_limit,
          input_json, plan_json, model_config_json, current_stage,
          progress_current, progress_total, input_tokens, output_tokens,
          estimated_cost_usd, error_code, error_message,
          created_at, started_at, completed_at, updated_at
        ) values (
          ${id}, 'QUEUED', ${input.commodity}, ${input.targetCountry}, ${input.targetArea ?? null},
          ${input.resultLimit}, ${sql.json(input)}, null, ${sql.json(modelConfig)}, 'Queued',
          0, ${input.resultLimit}, 0, 0, 0, null, null, ${now}, null, null, ${now}
        )
      `;
      return this.getSearchRun(id);
    },

    async listSearchRuns() {
      const rows = await sql`
        select * from public.buyer_search_runs order by created_at desc, id desc
      `;
      return rows.map(rowToSearchRun);
    },

    async getSearchRun(id) {
      return getSearchRun(sql, id);
    },

    async transitionSearchRun(id, nextStatus, changes = {}) {
      return sql.begin(async (tx) => {
        const current = await getSearchRun(tx, id, true);
        if (!current) throw new BuyerSearchRunNotFoundError(id);

        assertSearchRunTransition(current.status, nextStatus);
        const now = changes.now ?? new Date().toISOString();
        const startedAt = current.startedAt ?? (nextStatus === "PLANNING" ? now : null);
        const completedAt = isTerminalSearchRunStatus(nextStatus) ? now : null;
        const currentStage = changes.currentStage ?? getSearchRunStage(nextStatus);
        const rows = await tx`
          update public.buyer_search_runs set
            status = ${nextStatus},
            plan_json = ${jsonParameter(tx, changes.plan === undefined ? current.plan : changes.plan)},
            model_config_json = ${tx.json(changes.modelConfig ?? current.modelConfig)},
            outcome_json = ${jsonParameter(tx, changes.outcome === undefined ? current.outcome : changes.outcome)},
            current_stage = ${currentStage},
            progress_current = ${changes.progressCurrent ?? current.progress.current},
            progress_total = ${changes.progressTotal ?? current.progress.total},
            input_tokens = ${changes.inputTokens ?? current.usage.inputTokens},
            output_tokens = ${changes.outputTokens ?? current.usage.outputTokens},
            estimated_cost_usd = ${String(changes.estimatedCostUsd ?? current.usage.estimatedCostUsd)},
            error_code = ${changes.errorCode === undefined ? current.error?.code ?? null : changes.errorCode},
            error_message = ${changes.errorMessage === undefined ? current.error?.message ?? null : changes.errorMessage},
            started_at = ${startedAt}, completed_at = ${completedAt}, updated_at = ${now}
          where id = ${id}
          returning *
        `;
        return rowToSearchRun(rows[0]);
      });
    },

    async updateSearchRunProgress(id, progress, now) {
      if (!Number.isInteger(progress.current) || !Number.isInteger(progress.total) ||
          progress.current < 0 || progress.total < 0 || progress.current > progress.total) {
        throw new RangeError("Buyer search progress must use non-negative integers with current <= total.");
      }

      return sql.begin(async (tx) => {
        const current = await getSearchRun(tx, id, true);
        if (!current) throw new BuyerSearchRunNotFoundError(id);
        if (isTerminalSearchRunStatus(current.status)) {
          throw new Error(`Cannot update progress for terminal buyer search run ${id}.`);
        }
        const rows = await tx`
          update public.buyer_search_runs set
            progress_current = ${progress.current}, progress_total = ${progress.total},
            current_stage = ${progress.stage ?? current.currentStage}, updated_at = ${now}
          where id = ${id}
          returning *
        `;
        return rowToSearchRun(rows[0]);
      });
    },

    async updateSearchRunTelemetry(id, telemetry, now) {
      return sql.begin(async (tx) => {
        const current = await getSearchRun(tx, id, true);
        if (!current) throw new BuyerSearchRunNotFoundError(id);
        const inputTokens = telemetry.inputTokens ?? current.usage.inputTokens;
        const outputTokens = telemetry.outputTokens ?? current.usage.outputTokens;
        const estimatedCostUsd = telemetry.estimatedCostUsd ?? current.usage.estimatedCostUsd;
        if (!Number.isInteger(inputTokens) || inputTokens < 0 ||
            !Number.isInteger(outputTokens) || outputTokens < 0 || !isNonNegativeDecimal(estimatedCostUsd)) {
          throw new RangeError("Buyer search telemetry must contain non-negative token and cost values.");
        }
        const rows = await tx`
          update public.buyer_search_runs set
            input_tokens = ${inputTokens}, output_tokens = ${outputTokens},
            estimated_cost_usd = ${String(estimatedCostUsd)},
            model_config_json = ${tx.json(telemetry.modelConfig ?? current.modelConfig)}, updated_at = ${now}
          where id = ${id}
          returning *
        `;
        return rowToSearchRun(rows[0]);
      });
    },

    async interruptStaleSearchRuns(now) {
      const rows = await sql`
        update public.buyer_search_runs set
          status = 'INTERRUPTED', current_stage = 'Interrupted',
          error_code = 'SERVER_RESTARTED',
          error_message = 'The search was interrupted because the server restarted.',
          completed_at = ${now}, updated_at = ${now}
        where status in ${sql(ACTIVE_RUN_STATUSES)}
        returning id
      `;
      return rows.length;
    },

    async saveCandidateBundle(searchRunId, bundle, options) {
      const now = options.now;
      const company = normalizeCompany(bundle.company);
      const sources = deduplicateEvidenceSources(bundle.sources.map(normalizeEvidenceSource));
      if (sources.length === 0) throw new Error("A persisted buyer candidate must contain at least one evidence source.");
      if (bundle.contacts.some((contact) => contact.isPublicBusinessContact !== true)) {
        throw new Error("Only sourced public business contacts may be persisted.");
      }

      const matchId = options.createId();
      await sql.begin(async (tx) => {
        if (!await getSearchRun(tx, searchRunId, true)) throw new BuyerSearchRunNotFoundError(searchRunId);
        const companyId = await findCompanyId(tx, company) ?? options.createId();
        await upsertCompany(tx, companyId, company, now);
        await tx`
          insert into public.buyer_matches (
            id, search_run_id, company_id, commodity, buyer_type, commodity_relationship,
            confidence_score, confidence_level, verification_status, review_status,
            rejection_reason, created_at, updated_at, reviewed_at
          ) values (
            ${matchId}, ${searchRunId}, ${companyId}, ${bundle.match.commodity}, ${bundle.match.buyerType},
            ${bundle.match.commodityRelationship}, ${bundle.match.confidenceScore}, ${bundle.match.confidenceLevel},
            ${bundle.match.verificationStatus}, ${bundle.match.reviewStatus ?? "NEW"},
            ${bundle.match.rejectionReason ?? null}, ${now}, ${now}, null
          )
        `;

        const sourceIdsByUrl = new Map();
        for (const source of sources) {
          const sourceId = options.createId();
          await tx`
            insert into public.buyer_sources (
              id, buyer_match_id, url, normalized_url, title, publisher,
              evidence_type, excerpt, retrieved_at
            ) values (
              ${sourceId}, ${matchId}, ${source.url}, ${source.normalizedUrl}, ${source.title},
              ${source.publisher ?? null}, ${source.evidenceType}, ${source.excerpt ?? null}, ${source.retrievedAt}
            )
          `;
          if (!sourceIdsByUrl.has(source.normalizedUrl)) sourceIdsByUrl.set(source.normalizedUrl, sourceId);
        }

        for (const contact of bundle.contacts) {
          const normalizedSourceUrl = normalizeSourceUrl(contact.sourceUrl);
          const sourceId = normalizedSourceUrl ? sourceIdsByUrl.get(normalizedSourceUrl) : undefined;
          if (!sourceId) throw new Error(`Contact source is not present in the candidate evidence: ${contact.sourceUrl}`);
          const value = normalizeContactValue(contact.type, contact.value);
          await tx`
            insert into public.buyer_contacts (
              id, company_id, source_id, contact_type, value, label,
              is_public_business_contact, created_at, updated_at
            ) values (
              ${options.createId()}, ${companyId}, ${sourceId}, ${contact.type}, ${value},
              ${contact.label ?? null}, true, ${now}, ${now}
            )
            on conflict (company_id, contact_type, value) do update set
              source_id = excluded.source_id, label = excluded.label,
              is_public_business_contact = excluded.is_public_business_contact,
              updated_at = excluded.updated_at
          `;
        }
      });
      return this.getBuyerMatch(matchId);
    },

    async getBuyerMatch(id) {
      const rows = await baseMatchQuery(sql, sql`m.id = ${id}`);
      return rows[0] ? hydrateMatch(sql, rows[0]) : undefined;
    },

    async getSearchResults(searchRunId) {
      const rows = await baseMatchQuery(sql, sql`m.search_run_id = ${searchRunId}`);
      const matches = [];
      for (const row of rows) matches.push(await hydrateMatch(sql, row));
      return matches;
    },

    async updateMatchReviewStatus(id, reviewStatus, now) {
      if (!["NEW", "APPROVED", "REJECTED"].includes(reviewStatus)) {
        throw new RangeError(`Unsupported buyer review status: ${reviewStatus}`);
      }
      const rows = await sql`
        update public.buyer_matches set
          review_status = ${reviewStatus}, reviewed_at = ${reviewStatus === "NEW" ? null : now}, updated_at = ${now}
        where id = ${id}
        returning id
      `;
      if (rows.length === 0) throw new BuyerMatchNotFoundError(id);
      return this.getBuyerMatch(id);
    },
  };
}

async function getSearchRun(sql, id, forUpdate = false) {
  const rows = forUpdate
    ? await sql`select * from public.buyer_search_runs where id = ${id} for update`
    : await sql`select * from public.buyer_search_runs where id = ${id} limit 1`;
  return rows[0] ? rowToSearchRun(rows[0]) : undefined;
}

async function baseMatchQuery(sql, condition) {
  return sql`
    select m.*, c.name as company_name, c.normalized_name, c.website_url,
      c.website_domain, c.country_code, c.country_name, c.city, c.address
    from public.buyer_matches m
    join public.buyer_companies c on c.id = m.company_id
    where ${condition}
    order by m.confidence_score desc, c.name asc
  `;
}

async function hydrateMatch(sql, row) {
  const sources = await sql`
    select * from public.buyer_sources where buyer_match_id = ${row.id}
    order by retrieved_at desc, id asc
  `;
  const contacts = await sql`
    select bc.*, bs.url as source_url
    from public.buyer_contacts bc
    join public.buyer_sources bs on bs.id = bc.source_id
    where bc.company_id = ${row.company_id}
    order by bc.contact_type asc, bc.value asc
  `;
  return {
    id: row.id, searchRunId: row.search_run_id,
    company: {
      id: row.company_id, name: row.company_name, normalizedName: row.normalized_name,
      websiteUrl: row.website_url, websiteDomain: row.website_domain,
      countryCode: row.country_code, countryName: row.country_name, city: row.city, address: row.address,
    },
    commodity: row.commodity, buyerType: row.buyer_type,
    commodityRelationship: row.commodity_relationship,
    confidence: { score: row.confidence_score, level: row.confidence_level },
    verificationStatus: row.verification_status, reviewStatus: row.review_status,
    rejectionReason: row.rejection_reason, reviewedAt: nullableIso(row.reviewed_at),
    createdAt: isoValue(row.created_at), updatedAt: isoValue(row.updated_at),
    sources: sources.map((source) => ({
      id: source.id, url: source.url, normalizedUrl: source.normalized_url,
      title: source.title, publisher: source.publisher, evidenceType: source.evidence_type,
      excerpt: source.excerpt, retrievedAt: isoValue(source.retrieved_at),
    })),
    contacts: contacts.map((contact) => ({
      id: contact.id, sourceId: contact.source_id, type: contact.contact_type,
      value: contact.value, label: contact.label,
      isPublicBusinessContact: contact.is_public_business_contact,
      sourceUrl: contact.source_url, createdAt: isoValue(contact.created_at), updatedAt: isoValue(contact.updated_at),
    })),
  };
}

function rowToSearchRun(row) {
  return {
    id: row.id, status: row.status, commodity: row.commodity, targetCountry: row.target_country,
    ...(row.target_area ? { targetArea: row.target_area } : {}),
    requestedLimit: row.requested_limit, input: jsonValue(row.input_json),
    plan: nullableJsonValue(row.plan_json), modelConfig: jsonValue(row.model_config_json),
    outcome: nullableJsonValue(row.outcome_json), currentStage: row.current_stage,
    progress: { current: row.progress_current, total: row.progress_total },
    usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens, estimatedCostUsd: String(row.estimated_cost_usd) },
    error: row.error_code || row.error_message ? { code: row.error_code, message: row.error_message } : null,
    createdAt: isoValue(row.created_at), startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at), updatedAt: isoValue(row.updated_at),
  };
}

async function findCompanyId(sql, company) {
  if (company.websiteDomain) {
    const rows = await sql`
      select id from public.buyer_companies where website_domain = ${company.websiteDomain}
      order by created_at asc limit 1
    `;
    if (rows[0]) return rows[0].id;
  }
  const rows = company.countryCode
    ? await sql`select id from public.buyer_companies where normalized_name = ${company.normalizedName} and country_code = ${company.countryCode} order by created_at asc limit 1`
    : await sql`select id from public.buyer_companies where normalized_name = ${company.normalizedName} and country_name = ${company.countryName} order by created_at asc limit 1`;
  return rows[0]?.id;
}

async function upsertCompany(sql, id, company, now) {
  await sql`
    insert into public.buyer_companies (
      id, name, normalized_name, website_url, website_domain,
      country_code, country_name, city, address, created_at, updated_at
    ) values (
      ${id}, ${company.name}, ${company.normalizedName}, ${company.websiteUrl ?? null},
      ${company.websiteDomain ?? null}, ${company.countryCode ?? null}, ${company.countryName},
      ${company.city ?? null}, ${company.address ?? null}, ${now}, ${now}
    )
    on conflict (id) do update set
      name = excluded.name, normalized_name = excluded.normalized_name,
      website_url = coalesce(excluded.website_url, public.buyer_companies.website_url),
      website_domain = coalesce(excluded.website_domain, public.buyer_companies.website_domain),
      country_code = coalesce(excluded.country_code, public.buyer_companies.country_code),
      country_name = excluded.country_name, city = coalesce(excluded.city, public.buyer_companies.city),
      address = coalesce(excluded.address, public.buyer_companies.address), updated_at = excluded.updated_at
  `;
}

function normalizeCompany(company) {
  const websiteUrl = company.websiteUrl ? normalizeWebsiteUrl(company.websiteUrl) : undefined;
  const normalizedName = normalizeCompanyName(company.name);
  if (!normalizedName) throw new Error("A buyer company must have a normalizable name.");
  return {
    ...company, normalizedName, websiteUrl, websiteDomain: extractCanonicalDomain(websiteUrl),
    countryCode: company.countryCode ? normalizeCountryCode(company.countryCode) : normalizeCountryCode(company.countryName),
  };
}

function normalizeEvidenceSource(source) {
  const normalizedUrl = normalizeSourceUrl(source.url);
  if (!normalizedUrl) throw new Error(`Invalid buyer evidence URL: ${source.url}`);
  return { ...source, normalizedUrl };
}

function deduplicateEvidenceSources(sources) {
  const unique = new Map();
  for (const source of sources) {
    const key = `${source.normalizedUrl}\u0000${source.evidenceType}`;
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
}

function normalizeContactValue(type, value) {
  if (type === "EMAIL") return normalizeEmail(value);
  if (type === "PHONE") {
    const phone = normalizePhone(value);
    if (!phone) throw new Error(`Invalid public business phone number: ${value}`);
    return phone;
  }
  const url = normalizeWebsiteUrl(value);
  if (!url) throw new Error(`Invalid contact page URL: ${value}`);
  return url;
}

function jsonParameter(sql, value) {
  return value === null || value === undefined ? null : sql.json(value);
}

function jsonValue(value) { return typeof value === "string" ? JSON.parse(value) : value; }
function nullableJsonValue(value) { return value === null || value === undefined ? null : jsonValue(value); }
function isoValue(value) { return value instanceof Date ? value.toISOString() : String(value); }
function nullableIso(value) { return value === null || value === undefined ? null : isoValue(value); }
function isNonNegativeDecimal(value) {
  return typeof value === "number" ? Number.isFinite(value) && value >= 0 : typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}
