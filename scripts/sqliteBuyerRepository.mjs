import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

const ACTIVE_RUN_STATUSES = ["QUEUED", "PLANNING", "RESEARCHING", "VERIFYING", "SAVING"];

export class BuyerSearchRunNotFoundError extends Error {
  constructor(id) {
    super(`Buyer search run ${id} was not found.`);
    this.name = "BuyerSearchRunNotFoundError";
    this.code = "BUYER_SEARCH_RUN_NOT_FOUND";
  }
}

export class BuyerMatchNotFoundError extends Error {
  constructor(id) {
    super(`Buyer match ${id} was not found.`);
    this.name = "BuyerMatchNotFoundError";
    this.code = "BUYER_MATCH_NOT_FOUND";
  }
}

export function createSqliteBuyerRepository(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  createSchema(db);

  return {
    createSearchRun(input, options) {
      const id = options.createId();
      const now = options.now;
      const modelConfig = options.modelConfig ?? {};

      db.prepare(`
        INSERT INTO buyer_search_runs (
          id, status, commodity, target_country, target_area, requested_limit,
          input_json, plan_json, model_config_json, current_stage,
          progress_current, progress_total, input_tokens, output_tokens,
          estimated_cost_usd, error_code, error_message,
          created_at, started_at, completed_at, updated_at
        ) VALUES (?, 'QUEUED', ?, ?, ?, ?, ?, NULL, ?, 'Queued', 0, ?, 0, 0, '0', NULL, NULL, ?, NULL, NULL, ?)
      `).run(
        id,
        input.commodity,
        input.targetCountry,
        input.targetArea ?? null,
        input.resultLimit,
        JSON.stringify(input),
        JSON.stringify(modelConfig),
        input.resultLimit,
        now,
        now,
      );

      return this.getSearchRun(id);
    },

    listSearchRuns() {
      return db
        .prepare("SELECT * FROM buyer_search_runs ORDER BY created_at DESC, id DESC")
        .all()
        .map(rowToSearchRun);
    },

    getSearchRun(id) {
      const row = db.prepare("SELECT * FROM buyer_search_runs WHERE id = ?").get(id);
      return row ? rowToSearchRun(row) : undefined;
    },

    transitionSearchRun(id, nextStatus, changes = {}) {
      const current = this.getSearchRun(id);

      if (!current) {
        throw new BuyerSearchRunNotFoundError(id);
      }

      assertSearchRunTransition(current.status, nextStatus);

      const now = changes.now ?? new Date().toISOString();
      const startedAt = current.startedAt ?? (nextStatus === "PLANNING" ? now : null);
      const completedAt = isTerminalSearchRunStatus(nextStatus) ? now : null;
      const currentStage = changes.currentStage ?? getSearchRunStage(nextStatus);

      db.prepare(`
        UPDATE buyer_search_runs SET
          status = ?,
          plan_json = ?,
          model_config_json = ?,
          current_stage = ?,
          progress_current = ?,
          progress_total = ?,
          input_tokens = ?,
          output_tokens = ?,
          estimated_cost_usd = ?,
          error_code = ?,
          error_message = ?,
          started_at = ?,
          completed_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        nextStatus,
        changes.plan === undefined ? nullableJson(current.plan) : nullableJson(changes.plan),
        JSON.stringify(changes.modelConfig ?? current.modelConfig),
        currentStage,
        changes.progressCurrent ?? current.progress.current,
        changes.progressTotal ?? current.progress.total,
        changes.inputTokens ?? current.usage.inputTokens,
        changes.outputTokens ?? current.usage.outputTokens,
        String(changes.estimatedCostUsd ?? current.usage.estimatedCostUsd),
        changes.errorCode === undefined ? current.error?.code ?? null : changes.errorCode,
        changes.errorMessage === undefined ? current.error?.message ?? null : changes.errorMessage,
        startedAt,
        completedAt,
        now,
        id,
      );

      return this.getSearchRun(id);
    },

    updateSearchRunProgress(id, progress, now) {
      const current = this.getSearchRun(id);

      if (!current) {
        throw new BuyerSearchRunNotFoundError(id);
      }

      if (isTerminalSearchRunStatus(current.status)) {
        throw new Error(`Cannot update progress for terminal buyer search run ${id}.`);
      }

      if (!Number.isInteger(progress.current) || !Number.isInteger(progress.total) ||
          progress.current < 0 || progress.total < 0 || progress.current > progress.total) {
        throw new RangeError("Buyer search progress must use non-negative integers with current <= total.");
      }

      db.prepare(`
        UPDATE buyer_search_runs
        SET progress_current = ?, progress_total = ?, current_stage = ?, updated_at = ?
        WHERE id = ?
      `).run(progress.current, progress.total, progress.stage ?? current.currentStage, now, id);

      return this.getSearchRun(id);
    },

    updateSearchRunTelemetry(id, telemetry, now) {
      const current = this.getSearchRun(id);

      if (!current) {
        throw new BuyerSearchRunNotFoundError(id);
      }

      const inputTokens = telemetry.inputTokens ?? current.usage.inputTokens;
      const outputTokens = telemetry.outputTokens ?? current.usage.outputTokens;
      const estimatedCostUsd = telemetry.estimatedCostUsd ?? current.usage.estimatedCostUsd;

      if (!Number.isInteger(inputTokens) || inputTokens < 0 ||
          !Number.isInteger(outputTokens) || outputTokens < 0 ||
          !isNonNegativeDecimal(estimatedCostUsd)) {
        throw new RangeError("Buyer search telemetry must contain non-negative token and cost values.");
      }

      db.prepare(`
        UPDATE buyer_search_runs
        SET input_tokens = ?, output_tokens = ?, estimated_cost_usd = ?,
            model_config_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        inputTokens,
        outputTokens,
        String(estimatedCostUsd),
        JSON.stringify(telemetry.modelConfig ?? current.modelConfig),
        now,
        id,
      );

      return this.getSearchRun(id);
    },

    interruptStaleSearchRuns(now) {
      const placeholders = ACTIVE_RUN_STATUSES.map(() => "?").join(", ");
      const result = db.prepare(`
        UPDATE buyer_search_runs
        SET status = 'INTERRUPTED',
            current_stage = 'Interrupted',
            error_code = 'SERVER_RESTARTED',
            error_message = 'The search was interrupted because the local server restarted.',
            completed_at = ?,
            updated_at = ?
        WHERE status IN (${placeholders})
      `).run(now, now, ...ACTIVE_RUN_STATUSES);

      return Number(result.changes);
    },

    saveCandidateBundle(searchRunId, bundle, options) {
      const searchRun = this.getSearchRun(searchRunId);

      if (!searchRun) {
        throw new BuyerSearchRunNotFoundError(searchRunId);
      }

      const now = options.now;
      const company = normalizeCompany(bundle.company);
      const normalizedSources = deduplicateEvidenceSources(bundle.sources.map(normalizeEvidenceSource));
      let matchId;

      if (normalizedSources.length === 0) {
        throw new Error("A persisted buyer candidate must contain at least one evidence source.");
      }

      if (bundle.contacts.some((contact) => contact.isPublicBusinessContact !== true)) {
        throw new Error("Only sourced public business contacts may be persisted.");
      }

      db.exec("BEGIN IMMEDIATE;");

      try {
        const companyId = findCompanyId(db, company) ?? options.createId();
        upsertCompany(db, companyId, company, now);

        matchId = options.createId();
        db.prepare(`
          INSERT INTO buyer_matches (
            id, search_run_id, company_id, commodity, buyer_type,
            commodity_relationship, confidence_score, confidence_level,
            verification_status, review_status, rejection_reason,
            created_at, updated_at, reviewed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(
          matchId,
          searchRunId,
          companyId,
          bundle.match.commodity,
          bundle.match.buyerType,
          bundle.match.commodityRelationship,
          bundle.match.confidenceScore,
          bundle.match.confidenceLevel,
          bundle.match.verificationStatus,
          bundle.match.reviewStatus ?? "NEW",
          bundle.match.rejectionReason ?? null,
          now,
          now,
        );

        const sourceIdsByUrl = new Map();

        for (const source of normalizedSources) {
          const sourceId = options.createId();
          db.prepare(`
            INSERT INTO buyer_sources (
              id, buyer_match_id, url, normalized_url, title, publisher,
              evidence_type, excerpt, retrieved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            sourceId,
            matchId,
            source.url,
            source.normalizedUrl,
            source.title,
            source.publisher ?? null,
            source.evidenceType,
            source.excerpt ?? null,
            source.retrievedAt,
          );

          if (!sourceIdsByUrl.has(source.normalizedUrl)) {
            sourceIdsByUrl.set(source.normalizedUrl, sourceId);
          }
        }

        for (const contact of bundle.contacts) {
          const normalizedSourceUrl = normalizeSourceUrl(contact.sourceUrl);
          const sourceId = normalizedSourceUrl ? sourceIdsByUrl.get(normalizedSourceUrl) : undefined;

          if (!sourceId) {
            throw new Error(`Contact source is not present in the candidate evidence: ${contact.sourceUrl}`);
          }

          const value = normalizeContactValue(contact.type, contact.value);
          db.prepare(`
            INSERT INTO buyer_contacts (
              id, company_id, source_id, contact_type, value, label,
              is_public_business_contact, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(company_id, contact_type, value) DO UPDATE SET
              source_id = excluded.source_id,
              label = excluded.label,
              is_public_business_contact = excluded.is_public_business_contact,
              updated_at = excluded.updated_at
          `).run(
            options.createId(),
            companyId,
            sourceId,
            contact.type,
            value,
            contact.label ?? null,
            now,
            now,
          );
        }

        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }

      return this.getBuyerMatch(matchId);
    },

    getBuyerMatch(id) {
      const row = db.prepare(`
        SELECT
          m.*,
          c.name AS company_name,
          c.normalized_name,
          c.website_url,
          c.website_domain,
          c.country_code,
          c.country_name,
          c.city,
          c.address
        FROM buyer_matches m
        JOIN buyer_companies c ON c.id = m.company_id
        WHERE m.id = ?
      `).get(id);

      return row ? hydrateMatch(db, row) : undefined;
    },

    getSearchResults(searchRunId) {
      return db.prepare(`
        SELECT
          m.*,
          c.name AS company_name,
          c.normalized_name,
          c.website_url,
          c.website_domain,
          c.country_code,
          c.country_name,
          c.city,
          c.address
        FROM buyer_matches m
        JOIN buyer_companies c ON c.id = m.company_id
        WHERE m.search_run_id = ?
        ORDER BY m.confidence_score DESC, c.name ASC
      `).all(searchRunId).map((row) => hydrateMatch(db, row));
    },

    updateMatchReviewStatus(id, reviewStatus, now) {
      if (!["NEW", "APPROVED", "REJECTED"].includes(reviewStatus)) {
        throw new RangeError(`Unsupported buyer review status: ${reviewStatus}`);
      }

      const existing = this.getBuyerMatch(id);

      if (!existing) {
        throw new BuyerMatchNotFoundError(id);
      }

      db.prepare(`
        UPDATE buyer_matches
        SET review_status = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(reviewStatus, reviewStatus === "NEW" ? null : now, now, id);

      return this.getBuyerMatch(id);
    },

    close() {
      db.close();
    },
  };
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS buyer_search_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('QUEUED', 'PLANNING', 'RESEARCHING', 'VERIFYING', 'SAVING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
      commodity TEXT NOT NULL,
      target_country TEXT NOT NULL,
      target_area TEXT,
      requested_limit INTEGER NOT NULL CHECK (requested_limit BETWEEN 1 AND 25),
      input_json TEXT NOT NULL,
      plan_json TEXT,
      model_config_json TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
      progress_total INTEGER NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
      input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
      output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
      estimated_cost_usd TEXT NOT NULL DEFAULT '0',
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buyer_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      website_url TEXT,
      website_domain TEXT,
      country_code TEXT,
      country_name TEXT NOT NULL,
      city TEXT,
      address TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buyer_matches (
      id TEXT PRIMARY KEY,
      search_run_id TEXT NOT NULL REFERENCES buyer_search_runs(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES buyer_companies(id) ON DELETE RESTRICT,
      commodity TEXT NOT NULL,
      buyer_type TEXT NOT NULL CHECK (buyer_type IN ('IMPORTER', 'DISTRIBUTOR', 'WHOLESALER', 'PROCESSOR', 'MANUFACTURER', 'RETAILER')),
      commodity_relationship TEXT NOT NULL,
      confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
      confidence_level TEXT NOT NULL CHECK (confidence_level IN ('HIGH', 'MEDIUM', 'LOW')),
      verification_status TEXT NOT NULL CHECK (verification_status IN ('VERIFIED', 'NEEDS_REVIEW', 'REJECTED')),
      review_status TEXT NOT NULL DEFAULT 'NEW' CHECK (review_status IN ('NEW', 'APPROVED', 'REJECTED')),
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS buyer_sources (
      id TEXT PRIMARY KEY,
      buyer_match_id TEXT NOT NULL REFERENCES buyer_matches(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      title TEXT NOT NULL,
      publisher TEXT,
      evidence_type TEXT NOT NULL CHECK (evidence_type IN ('COMPANY_IDENTITY', 'LOCATION', 'COMMODITY', 'BUYER_ROLE', 'CONTACT')),
      excerpt TEXT,
      retrieved_at TEXT NOT NULL,
      UNIQUE (buyer_match_id, normalized_url, evidence_type)
    );

    CREATE TABLE IF NOT EXISTS buyer_contacts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES buyer_companies(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES buyer_sources(id) ON DELETE CASCADE,
      contact_type TEXT NOT NULL CHECK (contact_type IN ('EMAIL', 'PHONE', 'CONTACT_PAGE')),
      value TEXT NOT NULL,
      label TEXT,
      is_public_business_contact INTEGER NOT NULL CHECK (is_public_business_contact IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (company_id, contact_type, value)
    );

    CREATE INDEX IF NOT EXISTS buyer_search_runs_status_created_idx
      ON buyer_search_runs(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS buyer_companies_website_domain_idx
      ON buyer_companies(website_domain);
    CREATE INDEX IF NOT EXISTS buyer_companies_name_country_idx
      ON buyer_companies(normalized_name, country_code, country_name);
    CREATE INDEX IF NOT EXISTS buyer_matches_search_run_idx
      ON buyer_matches(search_run_id);
    CREATE INDEX IF NOT EXISTS buyer_matches_company_commodity_idx
      ON buyer_matches(company_id, commodity);
    CREATE INDEX IF NOT EXISTS buyer_sources_match_idx
      ON buyer_sources(buyer_match_id);
    CREATE INDEX IF NOT EXISTS buyer_contacts_company_idx
      ON buyer_contacts(company_id);
  `);
}

function rowToSearchRun(row) {
  return {
    id: row.id,
    status: row.status,
    commodity: row.commodity,
    targetCountry: row.target_country,
    ...(row.target_area ? { targetArea: row.target_area } : {}),
    requestedLimit: row.requested_limit,
    input: JSON.parse(row.input_json),
    plan: row.plan_json ? JSON.parse(row.plan_json) : null,
    modelConfig: JSON.parse(row.model_config_json),
    currentStage: row.current_stage,
    progress: { current: row.progress_current, total: row.progress_total },
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      estimatedCostUsd: row.estimated_cost_usd,
    },
    error: row.error_code || row.error_message
      ? { code: row.error_code, message: row.error_message }
      : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function nullableJson(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function isNonNegativeDecimal(value) {
  return typeof value === "number"
    ? Number.isFinite(value) && value >= 0
    : typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function normalizeCompany(company) {
  const websiteUrl = company.websiteUrl ? normalizeWebsiteUrl(company.websiteUrl) : undefined;
  const normalizedName = normalizeCompanyName(company.name);

  if (!normalizedName) {
    throw new Error("A buyer company must have a normalizable name.");
  }

  return {
    ...company,
    normalizedName,
    websiteUrl,
    websiteDomain: extractCanonicalDomain(websiteUrl),
    countryCode: company.countryCode
      ? normalizeCountryCode(company.countryCode)
      : normalizeCountryCode(company.countryName),
  };
}

function normalizeEvidenceSource(source) {
  const normalizedUrl = normalizeSourceUrl(source.url);

  if (!normalizedUrl) {
    throw new Error(`Invalid buyer evidence URL: ${source.url}`);
  }

  return { ...source, normalizedUrl };
}

function deduplicateEvidenceSources(sources) {
  const unique = new Map();

  for (const source of sources) {
    const key = `${source.normalizedUrl}\u0000${source.evidenceType}`;

    if (!unique.has(key)) {
      unique.set(key, source);
    }
  }

  return [...unique.values()];
}

function normalizeContactValue(type, value) {
  if (type === "EMAIL") {
    return normalizeEmail(value);
  }

  if (type === "PHONE") {
    const phone = normalizePhone(value);

    if (!phone) {
      throw new Error(`Invalid public business phone number: ${value}`);
    }

    return phone;
  }

  const url = normalizeWebsiteUrl(value);

  if (!url) {
    throw new Error(`Invalid contact page URL: ${value}`);
  }

  return url;
}

function findCompanyId(db, company) {
  if (company.websiteDomain) {
    const row = db.prepare(
      "SELECT id FROM buyer_companies WHERE website_domain = ? ORDER BY created_at ASC LIMIT 1",
    ).get(company.websiteDomain);

    if (row) {
      return row.id;
    }
  }

  const row = company.countryCode
    ? db.prepare(`
        SELECT id FROM buyer_companies
        WHERE normalized_name = ? AND country_code = ?
        ORDER BY created_at ASC LIMIT 1
      `).get(company.normalizedName, company.countryCode)
    : db.prepare(`
        SELECT id FROM buyer_companies
        WHERE normalized_name = ? AND country_name = ?
        ORDER BY created_at ASC LIMIT 1
      `).get(company.normalizedName, company.countryName);

  return row?.id;
}

function upsertCompany(db, id, company, now) {
  db.prepare(`
    INSERT INTO buyer_companies (
      id, name, normalized_name, website_url, website_domain,
      country_code, country_name, city, address, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      normalized_name = excluded.normalized_name,
      website_url = COALESCE(excluded.website_url, buyer_companies.website_url),
      website_domain = COALESCE(excluded.website_domain, buyer_companies.website_domain),
      country_code = COALESCE(excluded.country_code, buyer_companies.country_code),
      country_name = excluded.country_name,
      city = COALESCE(excluded.city, buyer_companies.city),
      address = COALESCE(excluded.address, buyer_companies.address),
      updated_at = excluded.updated_at
  `).run(
    id,
    company.name,
    company.normalizedName,
    company.websiteUrl ?? null,
    company.websiteDomain ?? null,
    company.countryCode ?? null,
    company.countryName,
    company.city ?? null,
    company.address ?? null,
    now,
    now,
  );
}

function hydrateMatch(db, row) {
  const sources = db.prepare(`
    SELECT * FROM buyer_sources WHERE buyer_match_id = ? ORDER BY retrieved_at DESC, id ASC
  `).all(row.id).map((source) => ({
    id: source.id,
    url: source.url,
    normalizedUrl: source.normalized_url,
    title: source.title,
    publisher: source.publisher,
    evidenceType: source.evidence_type,
    excerpt: source.excerpt,
    retrievedAt: source.retrieved_at,
  }));

  const contacts = db.prepare(`
    SELECT * FROM buyer_contacts WHERE company_id = ? ORDER BY contact_type ASC, value ASC
  `).all(row.company_id).map((contact) => ({
    id: contact.id,
    sourceId: contact.source_id,
    type: contact.contact_type,
    value: contact.value,
    label: contact.label,
    isPublicBusinessContact: contact.is_public_business_contact === 1,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
  }));

  return {
    id: row.id,
    searchRunId: row.search_run_id,
    company: {
      id: row.company_id,
      name: row.company_name,
      normalizedName: row.normalized_name,
      websiteUrl: row.website_url,
      websiteDomain: row.website_domain,
      countryCode: row.country_code,
      countryName: row.country_name,
      city: row.city,
      address: row.address,
    },
    commodity: row.commodity,
    buyerType: row.buyer_type,
    commodityRelationship: row.commodity_relationship,
    confidence: { score: row.confidence_score, level: row.confidence_level },
    verificationStatus: row.verification_status,
    reviewStatus: row.review_status,
    rejectionReason: row.rejection_reason,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sources,
    contacts,
  };
}
