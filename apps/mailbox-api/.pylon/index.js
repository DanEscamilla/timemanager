// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import { getContext } from "@getcronit/pylon";

// ../../libs/mailbox_kit/types.ts
var SPENDING_CANDIDATE_KIND = "spending.candidate";

// ../../libs/mailbox_kit/extractors/template_spending_extractor.ts
function parseSpendTemplateExtractors(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  const amount = parseFieldExtractor(obj.amount);
  if (!amount) return null;
  return {
    amount,
    currency: parseOptionalField(obj.currency),
    spentOn: parseOptionalField(obj.spentOn),
    merchant: parseOptionalField(obj.merchant),
    note: parseOptionalField(obj.note)
  };
}
function parseOptionalField(raw) {
  if (raw === void 0 || raw === null) return null;
  return parseFieldExtractor(raw);
}
function parseFieldExtractor(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  const source = obj.source;
  if (source === "from_domain") return { source: "from_domain" };
  if (source === "constant") {
    if (typeof obj.value !== "string") return null;
    return { source: "constant", value: obj.value };
  }
  if (source === "subject" || source === "text" || source === "html_text") {
    if (typeof obj.regex !== "string" || !obj.regex) return null;
    if (typeof obj.group !== "number" || !Number.isInteger(obj.group) || obj.group < 0) {
      return null;
    }
    try {
      new RegExp(obj.regex, "i");
    } catch {
      return null;
    }
    return { source, regex: obj.regex, group: obj.group };
  }
  return null;
}

// src/db/types/schema.ts
import "kysely";

// ../../libs/deno_api_kit/db/create_kysely.ts
import { Pool, types } from "pg";
import { Kysely, PostgresDialect } from "kysely";

// ../../libs/deno_api_kit/db/env.ts
function env(name) {
  if (typeof process !== "undefined" && process.env?.[name]) {
    return process.env[name];
  }
  try {
    return Deno.env.get(name);
  } catch {
    return void 0;
  }
}

// ../../libs/deno_api_kit/db/ssl.ts
function sslForDatabaseUrl(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return void 0;
  }
  const mode = url.searchParams.get("sslmode")?.toLowerCase();
  if (mode === "disable") return false;
  if (mode === "require" || mode === "verify-ca" || mode === "verify-full") {
    return { rejectUnauthorized: false };
  }
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1") return void 0;
  return { rejectUnauthorized: false };
}
function connectionStringWithoutSslParams(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    for (const key of [
      "sslmode",
      "ssl",
      "sslrootcert",
      "sslcert",
      "sslkey"
    ]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

// ../../libs/deno_api_kit/db/create_kysely.ts
types.setTypeParser(types.builtins.DATE, (value) => value);
function poolConfigFromEnv(defaultDatabase) {
  const databaseUrl = env("DATABASE_URL");
  if (databaseUrl) {
    const ssl = sslForDatabaseUrl(databaseUrl);
    return {
      connectionString: connectionStringWithoutSslParams(databaseUrl),
      max: 10,
      ...ssl === void 0 ? {} : { ssl }
    };
  }
  return {
    database: env("PGDATABASE") ?? defaultDatabase,
    host: env("PGHOST") ?? "localhost",
    user: env("PGUSER") ?? "postgres",
    password: env("PGPASSWORD") ?? "test1234",
    port: Number(env("PGPORT") ?? "5432"),
    max: 10
  };
}
function createKysely(options) {
  const dialect = new PostgresDialect({
    pool: new Pool(poolConfigFromEnv(options.defaultDatabase))
  });
  return new Kysely({ dialect });
}

// src/db/database.ts
var db = createKysely({
  defaultDatabase: "mailbox"
});

// src/services/ai_client.ts
var AiClientError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AiClientError";
  }
};
async function generateEmailSpendTemplate(input, options) {
  const baseUrl = (options?.baseUrl ?? Deno.env.get("AI_API_BASE_URL") ?? "http://localhost:3004").replace(/\/$/, "");
  const serviceKey = options?.serviceKey ?? Deno.env.get("AI_SERVICE_KEY");
  if (!serviceKey) {
    throw new AiClientError("AI_SERVICE_KEY is not configured");
  }
  const fetchImpl = options?.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `${baseUrl}/v1/use-cases/generate_email_spend_template/run`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: {
          from: input.from,
          subject: input.subject,
          textBody: input.textBody ?? void 0,
          htmlBody: input.htmlBody ?? void 0,
          hints: input.hints ?? void 0
        }
      })
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AiClientError(
      `ai-api error ${res.status}: ${text.slice(0, 300)}`
    );
  }
  const body = await res.json();
  if (!body.output) {
    throw new AiClientError("ai-api response missing output");
  }
  return body.output;
}

// src/services/spendmanager_expense_sink.ts
var SpendmanagerSinkError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SpendmanagerSinkError";
  }
};
async function publishExpenseToSpendmanager(candidate, categoryId, authorizationHeader, options) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new SpendmanagerSinkError("missing Bearer authorization");
  }
  const baseUrl = (options?.baseUrl ?? Deno.env.get("SPENDMANAGER_API_BASE_URL") ?? "http://localhost:3002").replace(/\/$/, "");
  const note = candidate.note?.trim() || [candidate.merchant, candidate.sourceSubject].filter(Boolean).join(" \u2014 ") || null;
  const query = `
    mutation CreateExpense($input: CreateExpenseInputInput!) {
      createExpense(args: { input: $input }) {
        id
      }
    }
  `;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const res = await fetchImpl(`${baseUrl}/graphql`, {
    method: "POST",
    headers: {
      Authorization: authorizationHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      variables: {
        input: {
          categoryId,
          amountCents: candidate.amountCents,
          spentOn: candidate.spentOn,
          currency: candidate.currency,
          note
        }
      }
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SpendmanagerSinkError(
      `spendmanager HTTP ${res.status}: ${text.slice(0, 300)}`
    );
  }
  const body = await res.json();
  if (body.errors?.length) {
    throw new SpendmanagerSinkError(
      body.errors.map((e) => e.message).join("; ")
    );
  }
  const id = body.data?.createExpense?.id;
  if (typeof id !== "number") {
    throw new SpendmanagerSinkError("spendmanager response missing expense id");
  }
  return { expenseId: id };
}

// src/graphql/timestamps.ts
function asIsoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const trimmed = value.trim();
  if (/^\d{10,}$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = trimmed.length <= 10 ? n * 1e3 : n;
    return new Date(ms).toISOString();
  }
  return value;
}
function asIsoTimestampOrNull(value) {
  if (value == null) return null;
  return asIsoTimestamp(value);
}

// src/graphql/validation.ts
var PROVIDERS = /* @__PURE__ */ new Set(["fixture", "gmail"]);
var ARTIFACT_STATUSES = /* @__PURE__ */ new Set(["pending", "accepted", "rejected"]);
var InvalidMailboxError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidMailboxError";
  }
};
function validateProvider(provider) {
  const trimmed = provider.trim().toLowerCase();
  if (!PROVIDERS.has(trimmed)) {
    throw new InvalidMailboxError(
      `provider must be one of: ${[...PROVIDERS].join(", ")}`
    );
  }
  return trimmed;
}
function validateLabel(label) {
  const trimmed = label.trim();
  if (!trimmed) throw new InvalidMailboxError("label is required");
  if (trimmed.length > 255) throw new InvalidMailboxError("label is too long");
  return trimmed;
}
function validateDomainPatterns(patterns) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p.length > 255) {
      throw new InvalidMailboxError("domain filter pattern is too long");
    }
    if (!isValidFromPattern(p)) {
      throw new InvalidMailboxError(
        `invalid domain filter pattern: ${raw}`
      );
    }
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
function isValidFromPattern(pattern) {
  const p = pattern.trim().toLowerCase();
  if (!p || p.length > 255) return false;
  if (p.includes("@")) {
    const at = p.lastIndexOf("@");
    if (at <= 0 || at === p.length - 1) return false;
    const local = p.slice(0, at);
    const domain = p.slice(at + 1);
    if (local !== "*" && (local.includes("*") || local.includes("@"))) {
      return false;
    }
    return isValidDomainPattern(domain);
  }
  return isValidDomainPattern(p);
}
function isValidDomainPattern(domain) {
  if (domain.startsWith("*.")) {
    const rest = domain.slice(2);
    if (!rest || rest.includes("*") || !rest.includes(".")) return false;
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(rest);
  }
  if (domain.includes("*")) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain);
}
function validateArtifactStatus(status) {
  const trimmed = status.trim().toLowerCase();
  if (!ARTIFACT_STATUSES.has(trimmed)) {
    throw new InvalidMailboxError(
      `status must be one of: ${[...ARTIFACT_STATUSES].join(", ")}`
    );
  }
  return trimmed;
}
function validateTemplateName(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new InvalidMailboxError("template name is required");
  if (trimmed.length > 255) {
    throw new InvalidMailboxError("template name is too long");
  }
  return trimmed;
}
function validateMatchFromPattern(pattern) {
  const p = pattern.trim().toLowerCase();
  if (!isValidFromPattern(p)) {
    throw new InvalidMailboxError(`invalid matchFromPattern: ${pattern}`);
  }
  return p;
}
function validateSubjectRegex(regex) {
  if (regex === null || regex === void 0) return null;
  const trimmed = regex.trim();
  if (!trimmed) return null;
  try {
    new RegExp(trimmed, "i");
  } catch {
    throw new InvalidMailboxError("matchSubjectRegex is not a valid regexp");
  }
  return trimmed;
}
function validateCategoryId(categoryId) {
  if (typeof categoryId !== "number" || !Number.isInteger(categoryId) || categoryId < 1) {
    throw new InvalidMailboxError(
      "categoryId is required when accepting a spending candidate"
    );
  }
  return categoryId;
}

// src/graphql/resolvers/resolvers.ts
function requireUserId() {
  const userId = getContext().get("userId");
  if (typeof userId !== "number") {
    throw new Error("Unauthenticated");
  }
  return userId;
}
function requireAuthorizationHeader() {
  const ctx = getContext();
  const header = ctx.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new InvalidMailboxError("missing Authorization bearer token");
  }
  return header;
}
function mapMailbox(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    label: row.label,
    enabled: row.enabled,
    sync_cursor: row.sync_cursor,
    sync_requested: row.sync_requested,
    last_synced_at: asIsoTimestampOrNull(row.last_synced_at),
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at)
  };
}
function mapDomainFilter(row) {
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    pattern: row.pattern,
    created_at: asIsoTimestamp(row.created_at)
  };
}
function mapMessage(row) {
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    provider_message_id: row.provider_message_id,
    rfc_message_id: row.rfc_message_id,
    from_address: row.from_address,
    subject: row.subject,
    received_at: asIsoTimestamp(row.received_at),
    text_body: row.text_body ?? null,
    html_body: row.html_body ?? null,
    created_at: asIsoTimestamp(row.created_at)
  };
}
function mapArtifact(row) {
  return {
    id: row.id,
    message_id: row.message_id,
    kind: row.kind,
    payload: typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload ?? {}),
    confidence: row.confidence,
    status: row.status,
    published_expense_id: row.published_expense_id ?? null,
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at)
  };
}
function mapSyncRun(row) {
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    started_at: asIsoTimestamp(row.started_at),
    finished_at: asIsoTimestampOrNull(row.finished_at),
    fetched_count: row.fetched_count,
    extracted_count: row.extracted_count,
    error_text: row.error_text
  };
}
function mapParsingTemplate(row) {
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    user_id: row.user_id,
    name: row.name,
    enabled: row.enabled,
    match_from_pattern: row.match_from_pattern,
    match_subject_regex: row.match_subject_regex,
    extractors: typeof row.extractors === "string" ? row.extractors : JSON.stringify(row.extractors ?? {}),
    source_message_id: row.source_message_id,
    version: row.version,
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at)
  };
}
async function requireOwnedMailbox(userId, mailboxId) {
  const row = await db.selectFrom("mailboxes").selectAll().where("id", "=", mailboxId).where("user_id", "=", userId).executeTakeFirst();
  if (!row) throw new InvalidMailboxError("mailbox not found");
  return row;
}
function parseExtractorsJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidMailboxError("extractorsJson must be valid JSON");
  }
  const extractors = parseSpendTemplateExtractors(parsed);
  if (!extractors) {
    throw new InvalidMailboxError("extractorsJson has invalid shape");
  }
  return extractors;
}
function asSpendingPayload(payload) {
  const obj = typeof payload === "string" ? (() => {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  })() : payload;
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  const p = obj;
  if (typeof p.amountCents !== "number" || typeof p.spentOn !== "string") {
    return null;
  }
  return {
    amountCents: p.amountCents,
    currency: typeof p.currency === "string" ? p.currency : "USD",
    spentOn: p.spentOn,
    merchant: typeof p.merchant === "string" ? p.merchant : null,
    note: typeof p.note === "string" ? p.note : null,
    sourceSubject: typeof p.sourceSubject === "string" ? p.sourceSubject : "",
    sourceFrom: typeof p.sourceFrom === "string" ? p.sourceFrom : "",
    publishedExpenseId: typeof p.publishedExpenseId === "number" ? p.publishedExpenseId : null,
    templateId: typeof p.templateId === "number" ? p.templateId : null
  };
}
var Query = {
  async mailboxes() {
    const userId = requireUserId();
    const rows = await db.selectFrom("mailboxes").selectAll().where("user_id", "=", userId).orderBy("id", "asc").execute();
    return rows.map(mapMailbox);
  },
  async domainFilters(mailboxId) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const rows = await db.selectFrom("domain_filters").selectAll().where("mailbox_id", "=", mailboxId).orderBy("id", "asc").execute();
    return rows.map(mapDomainFilter);
  },
  async messages(mailboxId) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const rows = await db.selectFrom("messages").selectAll().where("mailbox_id", "=", mailboxId).orderBy("received_at", "desc").execute();
    return rows.map(mapMessage);
  },
  async extractionArtifacts(mailboxId, status) {
    const userId = requireUserId();
    let q = db.selectFrom("extraction_artifacts").innerJoin("messages", "messages.id", "extraction_artifacts.message_id").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").selectAll("extraction_artifacts").where("mailboxes.user_id", "=", userId);
    if (mailboxId != null) {
      q = q.where("messages.mailbox_id", "=", mailboxId);
    }
    if (status != null && status !== "") {
      q = q.where("extraction_artifacts.status", "=", validateArtifactStatus(status));
    }
    const rows = await q.orderBy("extraction_artifacts.id", "desc").execute();
    return rows.map(mapArtifact);
  },
  async syncRuns(mailboxId) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const rows = await db.selectFrom("sync_runs").selectAll().where("mailbox_id", "=", mailboxId).orderBy("id", "desc").limit(50).execute();
    return rows.map(mapSyncRun);
  },
  async parsingTemplates(mailboxId) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const rows = await db.selectFrom("parsing_templates").selectAll().where("mailbox_id", "=", mailboxId).where("user_id", "=", userId).orderBy("id", "asc").execute();
    return rows.map(mapParsingTemplate);
  }
};
var Mutation = {
  async createMailbox(input) {
    const userId = requireUserId();
    const provider = validateProvider(input.provider);
    const label = validateLabel(input.label);
    const patterns = validateDomainPatterns(input.domainFilters ?? []);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const values = {
      user_id: userId,
      provider,
      label,
      enabled: input.enabled ?? true,
      sync_cursor: null,
      sync_requested: true,
      oauth_tokens_json: input.oauthTokensJson ?? null,
      last_synced_at: null,
      created_at: now,
      updated_at: now
    };
    const mailbox = await db.insertInto("mailboxes").values(values).returningAll().executeTakeFirstOrThrow();
    if (patterns.length > 0) {
      await db.insertInto("domain_filters").values(
        patterns.map((pattern) => ({
          mailbox_id: mailbox.id,
          pattern,
          created_at: now
        }))
      ).execute();
    }
    return mapMailbox(mailbox);
  },
  async deleteMailbox(id) {
    const userId = requireUserId();
    const result = await db.deleteFrom("mailboxes").where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  },
  async setDomainFilters(input) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, input.mailboxId);
    const patterns = validateDomainPatterns(input.patterns);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await db.deleteFrom("domain_filters").where("mailbox_id", "=", input.mailboxId).execute();
    if (patterns.length > 0) {
      await db.insertInto("domain_filters").values(
        patterns.map((pattern) => ({
          mailbox_id: input.mailboxId,
          pattern,
          created_at: now
        }))
      ).execute();
    }
    const rows = await db.selectFrom("domain_filters").selectAll().where("mailbox_id", "=", input.mailboxId).orderBy("id", "asc").execute();
    return rows.map(mapDomainFilter);
  },
  async triggerSync(mailboxId) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.updateTable("mailboxes").set({ sync_requested: true, updated_at: now }).where("id", "=", mailboxId).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return mapMailbox(row);
  },
  async updateArtifactStatus(input) {
    const userId = requireUserId();
    const status = validateArtifactStatus(input.status);
    const owned = await db.selectFrom("extraction_artifacts").innerJoin("messages", "messages.id", "extraction_artifacts.message_id").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").selectAll("extraction_artifacts").where("extraction_artifacts.id", "=", input.artifactId).where("mailboxes.user_id", "=", userId).executeTakeFirst();
    if (!owned) throw new InvalidMailboxError("artifact not found");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (status === "rejected") {
      const row2 = await db.updateTable("extraction_artifacts").set({ status, updated_at: now }).where("id", "=", input.artifactId).returningAll().executeTakeFirstOrThrow();
      return mapArtifact(row2);
    }
    if (status === "accepted") {
      if (owned.kind === SPENDING_CANDIDATE_KIND) {
        if (owned.published_expense_id != null) {
          const row3 = await db.updateTable("extraction_artifacts").set({ status: "accepted", updated_at: now }).where("id", "=", input.artifactId).returningAll().executeTakeFirstOrThrow();
          return mapArtifact(row3);
        }
        const categoryId = validateCategoryId(input.categoryId);
        const candidate = asSpendingPayload(owned.payload);
        if (!candidate) {
          throw new InvalidMailboxError("artifact payload is not a spending candidate");
        }
        try {
          const published = await publishExpenseToSpendmanager(
            candidate,
            categoryId,
            requireAuthorizationHeader()
          );
          const nextPayload = {
            ...candidate,
            publishedExpenseId: published.expenseId
          };
          const row3 = await db.updateTable("extraction_artifacts").set({
            status: "accepted",
            published_expense_id: published.expenseId,
            payload: nextPayload,
            updated_at: now
          }).where("id", "=", input.artifactId).returningAll().executeTakeFirstOrThrow();
          return mapArtifact(row3);
        } catch (err) {
          if (err instanceof SpendmanagerSinkError) {
            throw new InvalidMailboxError(
              `failed to publish expense: ${err.message}`
            );
          }
          throw err;
        }
      }
      const row2 = await db.updateTable("extraction_artifacts").set({ status: "accepted", updated_at: now }).where("id", "=", input.artifactId).returningAll().executeTakeFirstOrThrow();
      return mapArtifact(row2);
    }
    const row = await db.updateTable("extraction_artifacts").set({ status, updated_at: now }).where("id", "=", input.artifactId).returningAll().executeTakeFirstOrThrow();
    return mapArtifact(row);
  },
  async connectGmail(input) {
    const userId = requireUserId();
    const mailbox = await requireOwnedMailbox(userId, input.mailboxId);
    if (mailbox.provider !== "gmail") {
      throw new InvalidMailboxError("mailbox provider is not gmail");
    }
    if (!input.accessToken.trim()) {
      throw new InvalidMailboxError("accessToken is required");
    }
    const tokens = {
      accessToken: input.accessToken.trim(),
      refreshToken: input.refreshToken ?? null,
      expiresAtMs: input.expiresAtMs ?? null
    };
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.updateTable("mailboxes").set({
      oauth_tokens_json: JSON.stringify(tokens),
      sync_requested: true,
      updated_at: now
    }).where("id", "=", mailbox.id).returningAll().executeTakeFirstOrThrow();
    return mapMailbox(row);
  },
  async createParsingTemplate(input) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, input.mailboxId);
    const name = validateTemplateName(input.name);
    const matchFromPattern = validateMatchFromPattern(input.matchFromPattern);
    const matchSubjectRegex = validateSubjectRegex(input.matchSubjectRegex);
    const extractors = parseExtractorsJson(input.extractorsJson);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (input.sourceMessageId != null) {
      const msg = await db.selectFrom("messages").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").select("messages.id").where("messages.id", "=", input.sourceMessageId).where("mailboxes.user_id", "=", userId).where("messages.mailbox_id", "=", input.mailboxId).executeTakeFirst();
      if (!msg) throw new InvalidMailboxError("source message not found");
    }
    const row = await db.insertInto("parsing_templates").values({
      mailbox_id: input.mailboxId,
      user_id: userId,
      name,
      enabled: input.enabled ?? true,
      match_from_pattern: matchFromPattern,
      match_subject_regex: matchSubjectRegex,
      extractors,
      source_message_id: input.sourceMessageId ?? null,
      version: 1,
      created_at: now,
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
    return mapParsingTemplate(row);
  },
  async updateParsingTemplate(input) {
    const userId = requireUserId();
    const existing = await db.selectFrom("parsing_templates").selectAll().where("id", "=", input.id).where("user_id", "=", userId).executeTakeFirst();
    if (!existing) throw new InvalidMailboxError("template not found");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const patch = {
      version: existing.version + 1,
      updated_at: now
    };
    if (input.name != null) patch.name = validateTemplateName(input.name);
    if (input.matchFromPattern != null) {
      patch.match_from_pattern = validateMatchFromPattern(input.matchFromPattern);
    }
    if (input.matchSubjectRegex !== void 0) {
      patch.match_subject_regex = validateSubjectRegex(input.matchSubjectRegex);
    }
    if (input.extractorsJson != null) {
      patch.extractors = parseExtractorsJson(input.extractorsJson);
    }
    if (input.enabled != null) patch.enabled = input.enabled;
    const row = await db.updateTable("parsing_templates").set(patch).where("id", "=", input.id).returningAll().executeTakeFirstOrThrow();
    return mapParsingTemplate(row);
  },
  async deleteParsingTemplate(id) {
    const userId = requireUserId();
    const result = await db.deleteFrom("parsing_templates").where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  },
  async generateParsingTemplate(input) {
    const userId = requireUserId();
    const message = await db.selectFrom("messages").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").select([
      "messages.id",
      "messages.mailbox_id",
      "messages.from_address",
      "messages.subject",
      "messages.text_body",
      "messages.html_body"
    ]).where("messages.id", "=", input.messageId).where("mailboxes.user_id", "=", userId).executeTakeFirst();
    if (!message) throw new InvalidMailboxError("message not found");
    if (!message.text_body && !message.html_body) {
      throw new InvalidMailboxError(
        "message has no stored body; re-sync after upgrading mailbox"
      );
    }
    let aiOut;
    try {
      aiOut = await generateEmailSpendTemplate({
        from: message.from_address,
        subject: message.subject,
        textBody: message.text_body,
        htmlBody: message.html_body,
        hints: input.hints
      });
    } catch (err) {
      if (err instanceof AiClientError) {
        throw new InvalidMailboxError(`AI template generation failed: ${err.message}`);
      }
      throw err;
    }
    const matchFromPattern = validateMatchFromPattern(aiOut.matchFromPattern);
    const matchSubjectRegex = validateSubjectRegex(aiOut.matchSubjectRegex);
    const extractors = parseSpendTemplateExtractors(aiOut.extractors);
    if (!extractors) {
      throw new InvalidMailboxError("AI returned invalid extractors");
    }
    const name = validateTemplateName(
      input.name?.trim() || aiOut.nameSuggestion || "Spending template"
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.insertInto("parsing_templates").values({
      mailbox_id: message.mailbox_id,
      user_id: userId,
      name,
      enabled: true,
      match_from_pattern: matchFromPattern,
      match_subject_regex: matchSubjectRegex,
      extractors,
      source_message_id: message.id,
      version: 1,
      created_at: now,
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
    return mapParsingTemplate(row);
  }
};
var resolvers = { Query, Mutation };

// ../../libs/deno_api_kit/auth/verify.ts
import { createRemoteJWKSet, jwtVerify } from "jose";
var AUTH_API_DOMAIN = typeof process !== "undefined" && process.env?.AUTH_API_DOMAIN || "http://localhost:3001";
var JWKS_URL = `${AUTH_API_DOMAIN}/auth/jwt/jwks.json`;
var jwks = createRemoteJWKSet(new URL(JWKS_URL));
async function verifyAccessToken(authorizationHeader) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"]
    });
    const authUserId = typeof payload.sub === "string" ? payload.sub : null;
    if (!authUserId) {
      return null;
    }
    const email = typeof payload.email === "string" ? payload.email : void 0;
    return { authUserId, email };
  } catch {
    return null;
  }
}
function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, st-auth-mode",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}
async function corsMiddleware(ctx, next) {
  if (ctx.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, st-auth-mode",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      }
    });
  }
  await next();
  ctx.res.headers.set("Access-Control-Allow-Origin", "*");
  ctx.res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, st-auth-mode"
  );
  ctx.res.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
}

// ../../libs/deno_api_kit/pylon/middleware.ts
async function healthMiddleware(ctx, next) {
  const path = new URL(ctx.req.url).pathname;
  if (path === "/health" && ctx.req.method === "GET") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  await next();
}
function createGraphQLAuthMiddleware(resolveLocalUser3) {
  return async function graphQLAuthMiddleware(ctx, next) {
    if (ctx.req.method === "OPTIONS") {
      await next();
      return;
    }
    const path = new URL(ctx.req.url).pathname;
    if (path === "/health" || path !== "/graphql" && !path.endsWith("/graphql")) {
      await next();
      return;
    }
    const verified = await verifyAccessToken(ctx.req.header("Authorization"));
    if (!verified) {
      return unauthorizedResponse();
    }
    const localUser = await resolveLocalUser3(verified);
    ctx.set("authUserId", verified.authUserId);
    if (verified.email) {
      ctx.set("authEmail", verified.email);
    }
    ctx.set("userId", localUser.id);
    await next();
  };
}

// ../../libs/deno_api_kit/db/users.ts
async function resolveLocalUser(db2, identity) {
  const existing = await db2.selectFrom("users").where("auth_user_id", "=", identity.authUserId).selectAll().executeTakeFirst();
  if (existing) {
    return existing;
  }
  const email = identity.email?.trim() || `${identity.authUserId}@users.local`;
  const name = identity.name?.trim() || email.split("@")[0] || "User";
  const byEmail = await db2.selectFrom("users").where("email", "=", email).selectAll().executeTakeFirst();
  if (byEmail) {
    return await db2.updateTable("users").set({
      auth_user_id: identity.authUserId,
      name: byEmail.name || name,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", byEmail.id).returningAll().executeTakeFirstOrThrow();
  }
  return await db2.insertInto("users").values({
    email,
    name,
    auth_user_id: identity.authUserId,
    password_hash: null
  }).returningAll().executeTakeFirstOrThrow();
}

// src/db/users.ts
async function resolveLocalUser2(identity) {
  return resolveLocalUser(db, identity);
}

// src/index.ts
import { handler as __internalPylonHandler } from "@getcronit/pylon";
app.use(corsMiddleware);
app.use(healthMiddleware);
app.use(createGraphQLAuthMiddleware(resolveLocalUser2));
var graphql = {
  ...resolvers
};
var src_default = app;
var __internalPylonConfig = void 0;
try {
  __internalPylonConfig = config;
} catch {
}
app.use(__internalPylonHandler({
  typeDefs: "input CreateMailboxInputInput {\n	provider: String!\n	label: String!\n	enabled: Boolean\n	domainFilters: [String!]\n	oauthTokensJson: String\n}\ninput SetDomainFiltersInputInput {\n	mailboxId: Number!\n	patterns: [String!]!\n}\ninput UpdateArtifactStatusInputInput {\n	artifactId: Number!\n	status: String!\n	categoryId: Number\n}\ninput ConnectGmailInputInput {\n	mailboxId: Number!\n	accessToken: String!\n	refreshToken: String\n	expiresAtMs: Number\n}\ninput CreateParsingTemplateInputInput {\n	mailboxId: Number!\n	name: String!\n	matchFromPattern: String!\n	matchSubjectRegex: String\n	extractorsJson: String!\n	enabled: Boolean\n	sourceMessageId: Number\n}\ninput UpdateParsingTemplateInputInput {\n	id: Number!\n	name: String\n	matchFromPattern: String\n	matchSubjectRegex: String\n	extractorsJson: String\n	enabled: Boolean\n}\ninput GenerateParsingTemplateInputInput {\n	messageId: Number!\n	name: String\n	hints: String\n}\ntype Query {\nmailboxes: [Mailbox!]!\ndomainFilters(mailboxId: Number!): [DomainFilter!]!\nmessages(mailboxId: Number!): [Message!]!\nextractionArtifacts(mailboxId: Number, status: String): [ExtractionArtifact!]!\nsyncRuns(mailboxId: Number!): [SyncRun!]!\nparsingTemplates(mailboxId: Number!): [ParsingTemplate!]!\n}\ntype Mailbox {\nid: Number!\nuser_id: Number!\nprovider: String!\nlabel: String!\nenabled: Boolean!\nsync_cursor: String\nsync_requested: Boolean!\nlast_synced_at: String\ncreated_at: String!\nupdated_at: String!\n}\ntype DomainFilter {\nid: Number!\nmailbox_id: Number!\npattern: String!\ncreated_at: String!\n}\ntype Message {\nid: Number!\nmailbox_id: Number!\nprovider_message_id: String!\nrfc_message_id: String!\nfrom_address: String!\nsubject: String!\nreceived_at: String!\ntext_body: String\nhtml_body: String\ncreated_at: String!\n}\ntype ExtractionArtifact {\nid: Number!\nmessage_id: Number!\nkind: String!\npayload: String!\nconfidence: Number!\nstatus: String!\npublished_expense_id: Number\ncreated_at: String!\nupdated_at: String!\n}\ntype SyncRun {\nid: Number!\nmailbox_id: Number!\nstarted_at: String!\nfinished_at: String\nfetched_count: Number!\nextracted_count: Number!\nerror_text: String\n}\ntype ParsingTemplate {\nid: Number!\nmailbox_id: Number!\nuser_id: Number!\nname: String!\nenabled: Boolean!\nmatch_from_pattern: String!\nmatch_subject_regex: String\nextractors: String!\nsource_message_id: Number\nversion: Number!\ncreated_at: String!\nupdated_at: String!\n}\ntype Mutation {\ncreateMailbox(input: CreateMailboxInputInput!): Mailbox!\ndeleteMailbox(id: Number!): Boolean!\nsetDomainFilters(input: SetDomainFiltersInputInput!): [DomainFilter!]!\ntriggerSync(mailboxId: Number!): Mailbox!\nupdateArtifactStatus(input: UpdateArtifactStatusInputInput!): ExtractionArtifact!\nconnectGmail(input: ConnectGmailInputInput!): Mailbox!\ncreateParsingTemplate(input: CreateParsingTemplateInputInput!): ParsingTemplate!\nupdateParsingTemplate(input: UpdateParsingTemplateInputInput!): ParsingTemplate!\ndeleteParsingTemplate(id: Number!): Boolean!\ngenerateParsingTemplate(input: GenerateParsingTemplateInputInput!): ParsingTemplate!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vLi4vLi4vbGlicy9tYWlsYm94X2tpdC90eXBlcy50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2V4dHJhY3RvcnMvdGVtcGxhdGVfc3BlbmRpbmdfZXh0cmFjdG9yLnRzIiwgIi4uL3NyYy9kYi90eXBlcy9zY2hlbWEudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvY3JlYXRlX2t5c2VseS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvc3NsLnRzIiwgIi4uL3NyYy9kYi9kYXRhYmFzZS50cyIsICIuLi9zcmMvc2VydmljZXMvYWlfY2xpZW50LnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9zcGVuZG1hbmFnZXJfZXhwZW5zZV9zaW5rLnRzIiwgIi4uL3NyYy9ncmFwaHFsL3RpbWVzdGFtcHMudHMiLCAiLi4vc3JjL2dyYXBocWwvdmFsaWRhdGlvbi50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzIiwgIi4uL3NyYy9kYi91c2Vycy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHJlc29sdmVycyB9IGZyb20gJy4vZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzJ1xuaW1wb3J0IHsgY29yc01pZGRsZXdhcmUgfSBmcm9tICdkZW5vX2FwaV9raXQvYXV0aC92ZXJpZnkudHMnXG5pbXBvcnQge1xuICBjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUsXG4gIGhlYWx0aE1pZGRsZXdhcmUsXG59IGZyb20gJ2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciB9IGZyb20gJy4vZGIvdXNlcnMudHMnXG5cbmFwcC51c2UoY29yc01pZGRsZXdhcmUpXG5hcHAudXNlKGhlYWx0aE1pZGRsZXdhcmUpXG5hcHAudXNlKGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZShyZXNvbHZlTG9jYWxVc2VyKSlcblxuZXhwb3J0IGNvbnN0IGdyYXBocWwgPSB7XG4gIC4uLnJlc29sdmVycyxcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXBwXG5cbiAgICAgIGltcG9ydCB7aGFuZGxlciBhcyBfX2ludGVybmFsUHlsb25IYW5kbGVyfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiXG5cbiAgICAgIGxldCBfX2ludGVybmFsUHlsb25Db25maWcgPSB1bmRlZmluZWRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gY29uZmlnXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gY29uZmlnIGlzIG5vdCBkZWNsYXJlZCwgcHlsb25Db25maWcgcmVtYWlucyB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgYXBwLnVzZShfX2ludGVybmFsUHlsb25IYW5kbGVyKHtcbiAgICAgICAgdHlwZURlZnM6IFwiaW5wdXQgQ3JlYXRlTWFpbGJveElucHV0SW5wdXQge1xcblxcdHByb3ZpZGVyOiBTdHJpbmchXFxuXFx0bGFiZWw6IFN0cmluZyFcXG5cXHRlbmFibGVkOiBCb29sZWFuXFxuXFx0ZG9tYWluRmlsdGVyczogW1N0cmluZyFdXFxuXFx0b2F1dGhUb2tlbnNKc29uOiBTdHJpbmdcXG59XFxuaW5wdXQgU2V0RG9tYWluRmlsdGVyc0lucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdHBhdHRlcm5zOiBbU3RyaW5nIV0hXFxufVxcbmlucHV0IFVwZGF0ZUFydGlmYWN0U3RhdHVzSW5wdXRJbnB1dCB7XFxuXFx0YXJ0aWZhY3RJZDogTnVtYmVyIVxcblxcdHN0YXR1czogU3RyaW5nIVxcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcbn1cXG5pbnB1dCBDb25uZWN0R21haWxJbnB1dElucHV0IHtcXG5cXHRtYWlsYm94SWQ6IE51bWJlciFcXG5cXHRhY2Nlc3NUb2tlbjogU3RyaW5nIVxcblxcdHJlZnJlc2hUb2tlbjogU3RyaW5nXFxuXFx0ZXhwaXJlc0F0TXM6IE51bWJlclxcbn1cXG5pbnB1dCBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0IHtcXG5cXHRtYWlsYm94SWQ6IE51bWJlciFcXG5cXHRuYW1lOiBTdHJpbmchXFxuXFx0bWF0Y2hGcm9tUGF0dGVybjogU3RyaW5nIVxcblxcdG1hdGNoU3ViamVjdFJlZ2V4OiBTdHJpbmdcXG5cXHRleHRyYWN0b3JzSnNvbjogU3RyaW5nIVxcblxcdGVuYWJsZWQ6IEJvb2xlYW5cXG5cXHRzb3VyY2VNZXNzYWdlSWQ6IE51bWJlclxcbn1cXG5pbnB1dCBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdG5hbWU6IFN0cmluZ1xcblxcdG1hdGNoRnJvbVBhdHRlcm46IFN0cmluZ1xcblxcdG1hdGNoU3ViamVjdFJlZ2V4OiBTdHJpbmdcXG5cXHRleHRyYWN0b3JzSnNvbjogU3RyaW5nXFxuXFx0ZW5hYmxlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQge1xcblxcdG1lc3NhZ2VJZDogTnVtYmVyIVxcblxcdG5hbWU6IFN0cmluZ1xcblxcdGhpbnRzOiBTdHJpbmdcXG59XFxudHlwZSBRdWVyeSB7XFxubWFpbGJveGVzOiBbTWFpbGJveCFdIVxcbmRvbWFpbkZpbHRlcnMobWFpbGJveElkOiBOdW1iZXIhKTogW0RvbWFpbkZpbHRlciFdIVxcbm1lc3NhZ2VzKG1haWxib3hJZDogTnVtYmVyISk6IFtNZXNzYWdlIV0hXFxuZXh0cmFjdGlvbkFydGlmYWN0cyhtYWlsYm94SWQ6IE51bWJlciwgc3RhdHVzOiBTdHJpbmcpOiBbRXh0cmFjdGlvbkFydGlmYWN0IV0hXFxuc3luY1J1bnMobWFpbGJveElkOiBOdW1iZXIhKTogW1N5bmNSdW4hXSFcXG5wYXJzaW5nVGVtcGxhdGVzKG1haWxib3hJZDogTnVtYmVyISk6IFtQYXJzaW5nVGVtcGxhdGUhXSFcXG59XFxudHlwZSBNYWlsYm94IHtcXG5pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5wcm92aWRlcjogU3RyaW5nIVxcbmxhYmVsOiBTdHJpbmchXFxuZW5hYmxlZDogQm9vbGVhbiFcXG5zeW5jX2N1cnNvcjogU3RyaW5nXFxuc3luY19yZXF1ZXN0ZWQ6IEJvb2xlYW4hXFxubGFzdF9zeW5jZWRfYXQ6IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgRG9tYWluRmlsdGVyIHtcXG5pZDogTnVtYmVyIVxcbm1haWxib3hfaWQ6IE51bWJlciFcXG5wYXR0ZXJuOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbn1cXG50eXBlIE1lc3NhZ2Uge1xcbmlkOiBOdW1iZXIhXFxubWFpbGJveF9pZDogTnVtYmVyIVxcbnByb3ZpZGVyX21lc3NhZ2VfaWQ6IFN0cmluZyFcXG5yZmNfbWVzc2FnZV9pZDogU3RyaW5nIVxcbmZyb21fYWRkcmVzczogU3RyaW5nIVxcbnN1YmplY3Q6IFN0cmluZyFcXG5yZWNlaXZlZF9hdDogU3RyaW5nIVxcbnRleHRfYm9keTogU3RyaW5nXFxuaHRtbF9ib2R5OiBTdHJpbmdcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgRXh0cmFjdGlvbkFydGlmYWN0IHtcXG5pZDogTnVtYmVyIVxcbm1lc3NhZ2VfaWQ6IE51bWJlciFcXG5raW5kOiBTdHJpbmchXFxucGF5bG9hZDogU3RyaW5nIVxcbmNvbmZpZGVuY2U6IE51bWJlciFcXG5zdGF0dXM6IFN0cmluZyFcXG5wdWJsaXNoZWRfZXhwZW5zZV9pZDogTnVtYmVyXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBTeW5jUnVuIHtcXG5pZDogTnVtYmVyIVxcbm1haWxib3hfaWQ6IE51bWJlciFcXG5zdGFydGVkX2F0OiBTdHJpbmchXFxuZmluaXNoZWRfYXQ6IFN0cmluZ1xcbmZldGNoZWRfY291bnQ6IE51bWJlciFcXG5leHRyYWN0ZWRfY291bnQ6IE51bWJlciFcXG5lcnJvcl90ZXh0OiBTdHJpbmdcXG59XFxudHlwZSBQYXJzaW5nVGVtcGxhdGUge1xcbmlkOiBOdW1iZXIhXFxubWFpbGJveF9pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuZW5hYmxlZDogQm9vbGVhbiFcXG5tYXRjaF9mcm9tX3BhdHRlcm46IFN0cmluZyFcXG5tYXRjaF9zdWJqZWN0X3JlZ2V4OiBTdHJpbmdcXG5leHRyYWN0b3JzOiBTdHJpbmchXFxuc291cmNlX21lc3NhZ2VfaWQ6IE51bWJlclxcbnZlcnNpb246IE51bWJlciFcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxudXBkYXRlZF9hdDogU3RyaW5nIVxcbn1cXG50eXBlIE11dGF0aW9uIHtcXG5jcmVhdGVNYWlsYm94KGlucHV0OiBDcmVhdGVNYWlsYm94SW5wdXRJbnB1dCEpOiBNYWlsYm94IVxcbmRlbGV0ZU1haWxib3goaWQ6IE51bWJlciEpOiBCb29sZWFuIVxcbnNldERvbWFpbkZpbHRlcnMoaW5wdXQ6IFNldERvbWFpbkZpbHRlcnNJbnB1dElucHV0ISk6IFtEb21haW5GaWx0ZXIhXSFcXG50cmlnZ2VyU3luYyhtYWlsYm94SWQ6IE51bWJlciEpOiBNYWlsYm94IVxcbnVwZGF0ZUFydGlmYWN0U3RhdHVzKGlucHV0OiBVcGRhdGVBcnRpZmFjdFN0YXR1c0lucHV0SW5wdXQhKTogRXh0cmFjdGlvbkFydGlmYWN0IVxcbmNvbm5lY3RHbWFpbChpbnB1dDogQ29ubmVjdEdtYWlsSW5wdXRJbnB1dCEpOiBNYWlsYm94IVxcbmNyZWF0ZVBhcnNpbmdUZW1wbGF0ZShpbnB1dDogQ3JlYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXRJbnB1dCEpOiBQYXJzaW5nVGVtcGxhdGUhXFxudXBkYXRlUGFyc2luZ1RlbXBsYXRlKGlucHV0OiBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0ISk6IFBhcnNpbmdUZW1wbGF0ZSFcXG5kZWxldGVQYXJzaW5nVGVtcGxhdGUoaWQ6IE51bWJlciEpOiBCb29sZWFuIVxcbmdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlKGlucHV0OiBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQhKTogUGFyc2luZ1RlbXBsYXRlIVxcbn1cXG5zY2FsYXIgSURcXG5zY2FsYXIgSW50XFxuc2NhbGFyIEZsb2F0XFxuc2NhbGFyIE51bWJlclxcbnNjYWxhciBBbnlcXG5zY2FsYXIgVm9pZFxcbnNjYWxhciBPYmplY3RcXG5zY2FsYXIgRmlsZVxcbnNjYWxhciBEYXRlXFxuc2NhbGFyIEpTT05cXG5zY2FsYXIgU3RyaW5nXFxuc2NhbGFyIEJvb2xlYW5cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7fSxcbiAgICAgICAgY29uZmlnOiBfX2ludGVybmFsUHlsb25Db25maWdcbiAgICAgIH0pKVxuICAgICAgIiwgImltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHtcbiAgU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQsXG4gIHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMsXG4gIHR5cGUgU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkLFxufSBmcm9tICdtYWlsYm94X2tpdC9tb2QudHMnXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4uLy4uL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHR5cGUgeyBOZXdNYWlsYm94IH0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHtcbiAgQWlDbGllbnRFcnJvcixcbiAgZ2VuZXJhdGVFbWFpbFNwZW5kVGVtcGxhdGUsXG59IGZyb20gJy4uLy4uL3NlcnZpY2VzL2FpX2NsaWVudC50cydcbmltcG9ydCB7XG4gIFNwZW5kbWFuYWdlclNpbmtFcnJvcixcbiAgcHVibGlzaEV4cGVuc2VUb1NwZW5kbWFuYWdlcixcbn0gZnJvbSAnLi4vLi4vc2VydmljZXMvc3BlbmRtYW5hZ2VyX2V4cGVuc2Vfc2luay50cydcbmltcG9ydCB7IGFzSXNvVGltZXN0YW1wLCBhc0lzb1RpbWVzdGFtcE9yTnVsbCB9IGZyb20gJy4uL3RpbWVzdGFtcHMudHMnXG5pbXBvcnQgdHlwZSB7XG4gIENvbm5lY3RHbWFpbElucHV0LFxuICBDcmVhdGVNYWlsYm94SW5wdXQsXG4gIENyZWF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxuICBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxuICBTZXREb21haW5GaWx0ZXJzSW5wdXQsXG4gIFVwZGF0ZUFydGlmYWN0U3RhdHVzSW5wdXQsXG4gIFVwZGF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxufSBmcm9tICcuLi90eXBlcy50cydcbmltcG9ydCB7XG4gIEludmFsaWRNYWlsYm94RXJyb3IsXG4gIHZhbGlkYXRlQXJ0aWZhY3RTdGF0dXMsXG4gIHZhbGlkYXRlQ2F0ZWdvcnlJZCxcbiAgdmFsaWRhdGVEb21haW5QYXR0ZXJucyxcbiAgdmFsaWRhdGVMYWJlbCxcbiAgdmFsaWRhdGVNYXRjaEZyb21QYXR0ZXJuLFxuICB2YWxpZGF0ZVByb3ZpZGVyLFxuICB2YWxpZGF0ZVN1YmplY3RSZWdleCxcbiAgdmFsaWRhdGVUZW1wbGF0ZU5hbWUsXG59IGZyb20gJy4uL3ZhbGlkYXRpb24udHMnXG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldCgndXNlcklkJylcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbmF1dGhlbnRpY2F0ZWQnKVxuICB9XG4gIHJldHVybiB1c2VySWRcbn1cblxuZnVuY3Rpb24gcmVxdWlyZUF1dGhvcml6YXRpb25IZWFkZXIoKTogc3RyaW5nIHtcbiAgY29uc3QgY3R4ID0gZ2V0Q29udGV4dCgpXG4gIGNvbnN0IGhlYWRlciA9IGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJylcbiAgaWYgKCFoZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtaXNzaW5nIEF1dGhvcml6YXRpb24gYmVhcmVyIHRva2VuJylcbiAgfVxuICByZXR1cm4gaGVhZGVyXG59XG5cbi8qKiBOYW1lZCByZXR1cm4gc2hhcGVzIHNvIFB5bG9uIGVtaXRzIEdyYXBoUUwgb2JqZWN0IHR5cGVzIChub3QgYEFueSFgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFpbGJveCB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIHByb3ZpZGVyOiBzdHJpbmdcbiAgbGFiZWw6IHN0cmluZ1xuICBlbmFibGVkOiBib29sZWFuXG4gIHN5bmNfY3Vyc29yOiBzdHJpbmcgfCBudWxsXG4gIHN5bmNfcmVxdWVzdGVkOiBib29sZWFuXG4gIGxhc3Rfc3luY2VkX2F0OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBEb21haW5GaWx0ZXIge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwYXR0ZXJuOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVzc2FnZSB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gIGZyb21fYWRkcmVzczogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZF9hdDogc3RyaW5nXG4gIHRleHRfYm9keTogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdGlvbkFydGlmYWN0IHtcbiAgaWQ6IG51bWJlclxuICBtZXNzYWdlX2lkOiBudW1iZXJcbiAga2luZDogc3RyaW5nXG4gIHBheWxvYWQ6IHN0cmluZ1xuICBjb25maWRlbmNlOiBudW1iZXJcbiAgc3RhdHVzOiBzdHJpbmdcbiAgcHVibGlzaGVkX2V4cGVuc2VfaWQ6IG51bWJlciB8IG51bGxcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IHN0cmluZ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNSdW4ge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBzdGFydGVkX2F0OiBzdHJpbmdcbiAgZmluaXNoZWRfYXQ6IHN0cmluZyB8IG51bGxcbiAgZmV0Y2hlZF9jb3VudDogbnVtYmVyXG4gIGV4dHJhY3RlZF9jb3VudDogbnVtYmVyXG4gIGVycm9yX3RleHQ6IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYXJzaW5nVGVtcGxhdGUge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hfc3ViamVjdF9yZWdleDogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiBzdHJpbmdcbiAgc291cmNlX21lc3NhZ2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdmVyc2lvbjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBzdHJpbmdcbn1cblxuZnVuY3Rpb24gbWFwTWFpbGJveChyb3c6IHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgcHJvdmlkZXI6IHN0cmluZ1xuICBsYWJlbDogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgc3luY19jdXJzb3I6IHN0cmluZyB8IG51bGxcbiAgc3luY19yZXF1ZXN0ZWQ6IGJvb2xlYW5cbiAgbGFzdF9zeW5jZWRfYXQ6IERhdGUgfCBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSk6IE1haWxib3gge1xuICByZXR1cm4ge1xuICAgIGlkOiByb3cuaWQsXG4gICAgdXNlcl9pZDogcm93LnVzZXJfaWQsXG4gICAgcHJvdmlkZXI6IHJvdy5wcm92aWRlcixcbiAgICBsYWJlbDogcm93LmxhYmVsLFxuICAgIGVuYWJsZWQ6IHJvdy5lbmFibGVkLFxuICAgIHN5bmNfY3Vyc29yOiByb3cuc3luY19jdXJzb3IsXG4gICAgc3luY19yZXF1ZXN0ZWQ6IHJvdy5zeW5jX3JlcXVlc3RlZCxcbiAgICBsYXN0X3N5bmNlZF9hdDogYXNJc29UaW1lc3RhbXBPck51bGwocm93Lmxhc3Rfc3luY2VkX2F0KSxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gICAgdXBkYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnVwZGF0ZWRfYXQpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcERvbWFpbkZpbHRlcihyb3c6IHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcGF0dGVybjogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pOiBEb21haW5GaWx0ZXIge1xuICByZXR1cm4ge1xuICAgIGlkOiByb3cuaWQsXG4gICAgbWFpbGJveF9pZDogcm93Lm1haWxib3hfaWQsXG4gICAgcGF0dGVybjogcm93LnBhdHRlcm4sXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcE1lc3NhZ2Uocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gIGZyb21fYWRkcmVzczogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB0ZXh0X2JvZHk/OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keT86IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSk6IE1lc3NhZ2Uge1xuICByZXR1cm4ge1xuICAgIGlkOiByb3cuaWQsXG4gICAgbWFpbGJveF9pZDogcm93Lm1haWxib3hfaWQsXG4gICAgcHJvdmlkZXJfbWVzc2FnZV9pZDogcm93LnByb3ZpZGVyX21lc3NhZ2VfaWQsXG4gICAgcmZjX21lc3NhZ2VfaWQ6IHJvdy5yZmNfbWVzc2FnZV9pZCxcbiAgICBmcm9tX2FkZHJlc3M6IHJvdy5mcm9tX2FkZHJlc3MsXG4gICAgc3ViamVjdDogcm93LnN1YmplY3QsXG4gICAgcmVjZWl2ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5yZWNlaXZlZF9hdCksXG4gICAgdGV4dF9ib2R5OiByb3cudGV4dF9ib2R5ID8/IG51bGwsXG4gICAgaHRtbF9ib2R5OiByb3cuaHRtbF9ib2R5ID8/IG51bGwsXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcEFydGlmYWN0KHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1lc3NhZ2VfaWQ6IG51bWJlclxuICBraW5kOiBzdHJpbmdcbiAgcGF5bG9hZDogdW5rbm93blxuICBjb25maWRlbmNlOiBudW1iZXJcbiAgc3RhdHVzOiBzdHJpbmdcbiAgcHVibGlzaGVkX2V4cGVuc2VfaWQ/OiBudW1iZXIgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSk6IEV4dHJhY3Rpb25BcnRpZmFjdCB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtZXNzYWdlX2lkOiByb3cubWVzc2FnZV9pZCxcbiAgICBraW5kOiByb3cua2luZCxcbiAgICBwYXlsb2FkOlxuICAgICAgdHlwZW9mIHJvdy5wYXlsb2FkID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHJvdy5wYXlsb2FkXG4gICAgICAgIDogSlNPTi5zdHJpbmdpZnkocm93LnBheWxvYWQgPz8ge30pLFxuICAgIGNvbmZpZGVuY2U6IHJvdy5jb25maWRlbmNlLFxuICAgIHN0YXR1czogcm93LnN0YXR1cyxcbiAgICBwdWJsaXNoZWRfZXhwZW5zZV9pZDogcm93LnB1Ymxpc2hlZF9leHBlbnNlX2lkID8/IG51bGwsXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICAgIHVwZGF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy51cGRhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBTeW5jUnVuKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBzdGFydGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIGZpbmlzaGVkX2F0OiBEYXRlIHwgc3RyaW5nIHwgbnVsbFxuICBmZXRjaGVkX2NvdW50OiBudW1iZXJcbiAgZXh0cmFjdGVkX2NvdW50OiBudW1iZXJcbiAgZXJyb3JfdGV4dDogc3RyaW5nIHwgbnVsbFxufSk6IFN5bmNSdW4ge1xuICByZXR1cm4ge1xuICAgIGlkOiByb3cuaWQsXG4gICAgbWFpbGJveF9pZDogcm93Lm1haWxib3hfaWQsXG4gICAgc3RhcnRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnN0YXJ0ZWRfYXQpLFxuICAgIGZpbmlzaGVkX2F0OiBhc0lzb1RpbWVzdGFtcE9yTnVsbChyb3cuZmluaXNoZWRfYXQpLFxuICAgIGZldGNoZWRfY291bnQ6IHJvdy5mZXRjaGVkX2NvdW50LFxuICAgIGV4dHJhY3RlZF9jb3VudDogcm93LmV4dHJhY3RlZF9jb3VudCxcbiAgICBlcnJvcl90ZXh0OiByb3cuZXJyb3JfdGV4dCxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBQYXJzaW5nVGVtcGxhdGUocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBtYXRjaF9mcm9tX3BhdHRlcm46IHN0cmluZ1xuICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IHVua25vd25cbiAgc291cmNlX21lc3NhZ2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdmVyc2lvbjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSk6IFBhcnNpbmdUZW1wbGF0ZSB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtYWlsYm94X2lkOiByb3cubWFpbGJveF9pZCxcbiAgICB1c2VyX2lkOiByb3cudXNlcl9pZCxcbiAgICBuYW1lOiByb3cubmFtZSxcbiAgICBlbmFibGVkOiByb3cuZW5hYmxlZCxcbiAgICBtYXRjaF9mcm9tX3BhdHRlcm46IHJvdy5tYXRjaF9mcm9tX3BhdHRlcm4sXG4gICAgbWF0Y2hfc3ViamVjdF9yZWdleDogcm93Lm1hdGNoX3N1YmplY3RfcmVnZXgsXG4gICAgZXh0cmFjdG9yczpcbiAgICAgIHR5cGVvZiByb3cuZXh0cmFjdG9ycyA9PT0gJ3N0cmluZydcbiAgICAgICAgPyByb3cuZXh0cmFjdG9yc1xuICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHJvdy5leHRyYWN0b3JzID8/IHt9KSxcbiAgICBzb3VyY2VfbWVzc2FnZV9pZDogcm93LnNvdXJjZV9tZXNzYWdlX2lkLFxuICAgIHZlcnNpb246IHJvdy52ZXJzaW9uLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgICB1cGRhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cudXBkYXRlZF9hdCksXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQ6IG51bWJlciwgbWFpbGJveElkOiBudW1iZXIpIHtcbiAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnbWFpbGJveGVzJylcbiAgICAuc2VsZWN0QWxsKClcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ21haWxib3ggbm90IGZvdW5kJylcbiAgcmV0dXJuIHJvd1xufVxuXG5mdW5jdGlvbiBwYXJzZUV4dHJhY3RvcnNKc29uKHJhdzogc3RyaW5nKSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd25cbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdylcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2V4dHJhY3RvcnNKc29uIG11c3QgYmUgdmFsaWQgSlNPTicpXG4gIH1cbiAgY29uc3QgZXh0cmFjdG9ycyA9IHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMocGFyc2VkKVxuICBpZiAoIWV4dHJhY3RvcnMpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignZXh0cmFjdG9yc0pzb24gaGFzIGludmFsaWQgc2hhcGUnKVxuICB9XG4gIHJldHVybiBleHRyYWN0b3JzXG59XG5cbmZ1bmN0aW9uIGFzU3BlbmRpbmdQYXlsb2FkKHBheWxvYWQ6IHVua25vd24pOiBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQgfCBudWxsIHtcbiAgY29uc3Qgb2JqID0gdHlwZW9mIHBheWxvYWQgPT09ICdzdHJpbmcnXG4gICAgPyAoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UocGF5bG9hZClcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuICAgIH0pKClcbiAgICA6IHBheWxvYWRcbiAgaWYgKG9iaiA9PT0gbnVsbCB8fCB0eXBlb2Ygb2JqICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KG9iaikpIHJldHVybiBudWxsXG4gIGNvbnN0IHAgPSBvYmogYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgaWYgKHR5cGVvZiBwLmFtb3VudENlbnRzICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgcC5zcGVudE9uICE9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgcmV0dXJuIHtcbiAgICBhbW91bnRDZW50czogcC5hbW91bnRDZW50cyxcbiAgICBjdXJyZW5jeTogdHlwZW9mIHAuY3VycmVuY3kgPT09ICdzdHJpbmcnID8gcC5jdXJyZW5jeSA6ICdVU0QnLFxuICAgIHNwZW50T246IHAuc3BlbnRPbixcbiAgICBtZXJjaGFudDogdHlwZW9mIHAubWVyY2hhbnQgPT09ICdzdHJpbmcnID8gcC5tZXJjaGFudCA6IG51bGwsXG4gICAgbm90ZTogdHlwZW9mIHAubm90ZSA9PT0gJ3N0cmluZycgPyBwLm5vdGUgOiBudWxsLFxuICAgIHNvdXJjZVN1YmplY3Q6IHR5cGVvZiBwLnNvdXJjZVN1YmplY3QgPT09ICdzdHJpbmcnID8gcC5zb3VyY2VTdWJqZWN0IDogJycsXG4gICAgc291cmNlRnJvbTogdHlwZW9mIHAuc291cmNlRnJvbSA9PT0gJ3N0cmluZycgPyBwLnNvdXJjZUZyb20gOiAnJyxcbiAgICBwdWJsaXNoZWRFeHBlbnNlSWQ6XG4gICAgICB0eXBlb2YgcC5wdWJsaXNoZWRFeHBlbnNlSWQgPT09ICdudW1iZXInID8gcC5wdWJsaXNoZWRFeHBlbnNlSWQgOiBudWxsLFxuICAgIHRlbXBsYXRlSWQ6IHR5cGVvZiBwLnRlbXBsYXRlSWQgPT09ICdudW1iZXInID8gcC50ZW1wbGF0ZUlkIDogbnVsbCxcbiAgfVxufVxuXG5jb25zdCBRdWVyeSA9IHtcbiAgYXN5bmMgbWFpbGJveGVzKCk6IFByb21pc2U8TWFpbGJveFtdPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWFpbGJveGVzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwTWFpbGJveClcbiAgfSxcblxuICBhc3luYyBkb21haW5GaWx0ZXJzKG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxEb21haW5GaWx0ZXJbXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBEb21haW5GaWx0ZXIpXG4gIH0sXG5cbiAgYXN5bmMgbWVzc2FnZXMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPE1lc3NhZ2VbXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdyZWNlaXZlZF9hdCcsICdkZXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwTWVzc2FnZSlcbiAgfSxcblxuICBhc3luYyBleHRyYWN0aW9uQXJ0aWZhY3RzKFxuICAgIG1haWxib3hJZD86IG51bWJlciB8IG51bGwsXG4gICAgc3RhdHVzPzogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTxFeHRyYWN0aW9uQXJ0aWZhY3RbXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGxldCBxID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAuaW5uZXJKb2luKCdtZXNzYWdlcycsICdtZXNzYWdlcy5pZCcsICdleHRyYWN0aW9uX2FydGlmYWN0cy5tZXNzYWdlX2lkJylcbiAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAuc2VsZWN0QWxsKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG5cbiAgICBpZiAobWFpbGJveElkICE9IG51bGwpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdtZXNzYWdlcy5tYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgfVxuICAgIGlmIChzdGF0dXMgIT0gbnVsbCAmJiBzdGF0dXMgIT09ICcnKSB7XG4gICAgICBxID0gcS53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuc3RhdHVzJywgJz0nLCB2YWxpZGF0ZUFydGlmYWN0U3RhdHVzKHN0YXR1cykpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHEub3JkZXJCeSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuaWQnLCAnZGVzYycpLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBBcnRpZmFjdClcbiAgfSxcblxuICBhc3luYyBzeW5jUnVucyhtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8U3luY1J1bltdPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIG1haWxib3hJZClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdzeW5jX3J1bnMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdkZXNjJylcbiAgICAgIC5saW1pdCg1MClcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwU3luY1J1bilcbiAgfSxcblxuICBhc3luYyBwYXJzaW5nVGVtcGxhdGVzKG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxQYXJzaW5nVGVtcGxhdGVbXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2FzYycpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcFBhcnNpbmdUZW1wbGF0ZSlcbiAgfSxcbn1cblxuY29uc3QgTXV0YXRpb24gPSB7XG4gIGFzeW5jIGNyZWF0ZU1haWxib3goaW5wdXQ6IENyZWF0ZU1haWxib3hJbnB1dCk6IFByb21pc2U8TWFpbGJveD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHByb3ZpZGVyID0gdmFsaWRhdGVQcm92aWRlcihpbnB1dC5wcm92aWRlcilcbiAgICBjb25zdCBsYWJlbCA9IHZhbGlkYXRlTGFiZWwoaW5wdXQubGFiZWwpXG4gICAgY29uc3QgcGF0dGVybnMgPSB2YWxpZGF0ZURvbWFpblBhdHRlcm5zKGlucHV0LmRvbWFpbkZpbHRlcnMgPz8gW10pXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBjb25zdCB2YWx1ZXM6IE5ld01haWxib3ggPSB7XG4gICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICBwcm92aWRlcixcbiAgICAgIGxhYmVsLFxuICAgICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgc3luY19jdXJzb3I6IG51bGwsXG4gICAgICBzeW5jX3JlcXVlc3RlZDogdHJ1ZSxcbiAgICAgIG9hdXRoX3Rva2Vuc19qc29uOiBpbnB1dC5vYXV0aFRva2Vuc0pzb24gPz8gbnVsbCxcbiAgICAgIGxhc3Rfc3luY2VkX2F0OiBudWxsLFxuICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgIH1cblxuICAgIGNvbnN0IG1haWxib3ggPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ21haWxib3hlcycpXG4gICAgICAudmFsdWVzKHZhbHVlcylcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIGlmIChwYXR0ZXJucy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBkYlxuICAgICAgICAuaW5zZXJ0SW50bygnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgICAudmFsdWVzKFxuICAgICAgICAgIHBhdHRlcm5zLm1hcCgocGF0dGVybikgPT4gKHtcbiAgICAgICAgICAgIG1haWxib3hfaWQ6IG1haWxib3guaWQsXG4gICAgICAgICAgICBwYXR0ZXJuLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1hcE1haWxib3gobWFpbGJveClcbiAgfSxcblxuICBhc3luYyBkZWxldGVNYWlsYm94KGlkOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ21haWxib3hlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0Lm51bURlbGV0ZWRSb3dzID8/IDApID4gMFxuICB9LFxuXG4gIGFzeW5jIHNldERvbWFpbkZpbHRlcnMoaW5wdXQ6IFNldERvbWFpbkZpbHRlcnNJbnB1dCk6IFByb21pc2U8RG9tYWluRmlsdGVyW10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGNvbnN0IHBhdHRlcm5zID0gdmFsaWRhdGVEb21haW5QYXR0ZXJucyhpbnB1dC5wYXR0ZXJucylcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBpZiAocGF0dGVybnMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2RvbWFpbl9maWx0ZXJzJylcbiAgICAgICAgLnZhbHVlcyhcbiAgICAgICAgICBwYXR0ZXJucy5tYXAoKHBhdHRlcm4pID0+ICh7XG4gICAgICAgICAgICBtYWlsYm94X2lkOiBpbnB1dC5tYWlsYm94SWQsXG4gICAgICAgICAgICBwYXR0ZXJuLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIGlucHV0Lm1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBEb21haW5GaWx0ZXIpXG4gIH0sXG5cbiAgYXN5bmMgdHJpZ2dlclN5bmMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPE1haWxib3g+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ21haWxib3hlcycpXG4gICAgICAuc2V0KHsgc3luY19yZXF1ZXN0ZWQ6IHRydWUsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcE1haWxib3gocm93KVxuICB9LFxuXG4gIGFzeW5jIHVwZGF0ZUFydGlmYWN0U3RhdHVzKFxuICAgIGlucHV0OiBVcGRhdGVBcnRpZmFjdFN0YXR1c0lucHV0LFxuICApOiBQcm9taXNlPEV4dHJhY3Rpb25BcnRpZmFjdD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHN0YXR1cyA9IHZhbGlkYXRlQXJ0aWZhY3RTdGF0dXMoaW5wdXQuc3RhdHVzKVxuICAgIGNvbnN0IG93bmVkID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAuaW5uZXJKb2luKCdtZXNzYWdlcycsICdtZXNzYWdlcy5pZCcsICdleHRyYWN0aW9uX2FydGlmYWN0cy5tZXNzYWdlX2lkJylcbiAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAuc2VsZWN0QWxsKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAud2hlcmUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLmlkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFvd25lZCkgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2FydGlmYWN0IG5vdCBmb3VuZCcpXG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGlmIChzdGF0dXMgPT09ICdyZWplY3RlZCcpIHtcbiAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuc2V0KHsgc3RhdHVzLCB1cGRhdGVkX2F0OiBub3cgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICAgIH1cblxuICAgIGlmIChzdGF0dXMgPT09ICdhY2NlcHRlZCcpIHtcbiAgICAgIGlmIChvd25lZC5raW5kID09PSBTUEVORElOR19DQU5ESURBVEVfS0lORCkge1xuICAgICAgICBpZiAob3duZWQucHVibGlzaGVkX2V4cGVuc2VfaWQgIT0gbnVsbCkge1xuICAgICAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgICAgIC5zZXQoeyBzdGF0dXM6ICdhY2NlcHRlZCcsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgICAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY2F0ZWdvcnlJZCA9IHZhbGlkYXRlQ2F0ZWdvcnlJZChpbnB1dC5jYXRlZ29yeUlkKVxuICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSBhc1NwZW5kaW5nUGF5bG9hZChvd25lZC5wYXlsb2FkKVxuICAgICAgICBpZiAoIWNhbmRpZGF0ZSkge1xuICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdhcnRpZmFjdCBwYXlsb2FkIGlzIG5vdCBhIHNwZW5kaW5nIGNhbmRpZGF0ZScpXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHB1Ymxpc2hlZCA9IGF3YWl0IHB1Ymxpc2hFeHBlbnNlVG9TcGVuZG1hbmFnZXIoXG4gICAgICAgICAgICBjYW5kaWRhdGUsXG4gICAgICAgICAgICBjYXRlZ29yeUlkLFxuICAgICAgICAgICAgcmVxdWlyZUF1dGhvcml6YXRpb25IZWFkZXIoKSxcbiAgICAgICAgICApXG4gICAgICAgICAgY29uc3QgbmV4dFBheWxvYWQgPSB7XG4gICAgICAgICAgICAuLi5jYW5kaWRhdGUsXG4gICAgICAgICAgICBwdWJsaXNoZWRFeHBlbnNlSWQ6IHB1Ymxpc2hlZC5leHBlbnNlSWQsXG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgICAgIC5zZXQoe1xuICAgICAgICAgICAgICBzdGF0dXM6ICdhY2NlcHRlZCcsXG4gICAgICAgICAgICAgIHB1Ymxpc2hlZF9leHBlbnNlX2lkOiBwdWJsaXNoZWQuZXhwZW5zZUlkLFxuICAgICAgICAgICAgICBwYXlsb2FkOiBuZXh0UGF5bG9hZCxcbiAgICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmFydGlmYWN0SWQpXG4gICAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICAgICAgcmV0dXJuIG1hcEFydGlmYWN0KHJvdylcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIFNwZW5kbWFuYWdlclNpbmtFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICAgICAgICAgIGBmYWlsZWQgdG8gcHVibGlzaCBleHBlbnNlOiAke2Vyci5tZXNzYWdlfWAsXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVyclxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuc2V0KHsgc3RhdHVzOiAnYWNjZXB0ZWQnLCB1cGRhdGVkX2F0OiBub3cgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICAgIH1cblxuICAgIC8vIHBlbmRpbmcgLyBvdGhlclxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC5zZXQoeyBzdGF0dXMsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICB9LFxuXG4gIGFzeW5jIGNvbm5lY3RHbWFpbChpbnB1dDogQ29ubmVjdEdtYWlsSW5wdXQpOiBQcm9taXNlPE1haWxib3g+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBtYWlsYm94ID0gYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIGlucHV0Lm1haWxib3hJZClcbiAgICBpZiAobWFpbGJveC5wcm92aWRlciAhPT0gJ2dtYWlsJykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ21haWxib3ggcHJvdmlkZXIgaXMgbm90IGdtYWlsJylcbiAgICB9XG4gICAgaWYgKCFpbnB1dC5hY2Nlc3NUb2tlbi50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdhY2Nlc3NUb2tlbiBpcyByZXF1aXJlZCcpXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW5zID0ge1xuICAgICAgYWNjZXNzVG9rZW46IGlucHV0LmFjY2Vzc1Rva2VuLnRyaW0oKSxcbiAgICAgIHJlZnJlc2hUb2tlbjogaW5wdXQucmVmcmVzaFRva2VuID8/IG51bGwsXG4gICAgICBleHBpcmVzQXRNczogaW5wdXQuZXhwaXJlc0F0TXMgPz8gbnVsbCxcbiAgICB9XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnbWFpbGJveGVzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBvYXV0aF90b2tlbnNfanNvbjogSlNPTi5zdHJpbmdpZnkodG9rZW5zKSxcbiAgICAgICAgc3luY19yZXF1ZXN0ZWQ6IHRydWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBtYWlsYm94LmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBNYWlsYm94KHJvdylcbiAgfSxcblxuICBhc3luYyBjcmVhdGVQYXJzaW5nVGVtcGxhdGUoXG4gICAgaW5wdXQ6IENyZWF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxuICApOiBQcm9taXNlPFBhcnNpbmdUZW1wbGF0ZT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlVGVtcGxhdGVOYW1lKGlucHV0Lm5hbWUpXG4gICAgY29uc3QgbWF0Y2hGcm9tUGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihpbnB1dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgIGNvbnN0IG1hdGNoU3ViamVjdFJlZ2V4ID0gdmFsaWRhdGVTdWJqZWN0UmVnZXgoaW5wdXQubWF0Y2hTdWJqZWN0UmVnZXgpXG4gICAgY29uc3QgZXh0cmFjdG9ycyA9IHBhcnNlRXh0cmFjdG9yc0pzb24oaW5wdXQuZXh0cmFjdG9yc0pzb24pXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBpZiAoaW5wdXQuc291cmNlTWVzc2FnZUlkICE9IG51bGwpIHtcbiAgICAgIGNvbnN0IG1zZyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdtZXNzYWdlcycpXG4gICAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAgIC5zZWxlY3QoJ21lc3NhZ2VzLmlkJylcbiAgICAgICAgLndoZXJlKCdtZXNzYWdlcy5pZCcsICc9JywgaW5wdXQuc291cmNlTWVzc2FnZUlkKVxuICAgICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgnbWVzc2FnZXMubWFpbGJveF9pZCcsICc9JywgaW5wdXQubWFpbGJveElkKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIW1zZykgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3NvdXJjZSBtZXNzYWdlIG5vdCBmb3VuZCcpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgbWFpbGJveF9pZDogaW5wdXQubWFpbGJveElkLFxuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGVuYWJsZWQ6IGlucHV0LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBtYXRjaEZyb21QYXR0ZXJuLFxuICAgICAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBtYXRjaFN1YmplY3RSZWdleCxcbiAgICAgICAgZXh0cmFjdG9ycyxcbiAgICAgICAgc291cmNlX21lc3NhZ2VfaWQ6IGlucHV0LnNvdXJjZU1lc3NhZ2VJZCA/PyBudWxsLFxuICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0pXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcFBhcnNpbmdUZW1wbGF0ZShyb3cpXG4gIH0sXG5cbiAgYXN5bmMgdXBkYXRlUGFyc2luZ1RlbXBsYXRlKFxuICAgIGlucHV0OiBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgKTogUHJvbWlzZTxQYXJzaW5nVGVtcGxhdGU+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghZXhpc3RpbmcpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCd0ZW1wbGF0ZSBub3QgZm91bmQnKVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3QgcGF0Y2g6IHtcbiAgICAgIG5hbWU/OiBzdHJpbmdcbiAgICAgIG1hdGNoX2Zyb21fcGF0dGVybj86IHN0cmluZ1xuICAgICAgbWF0Y2hfc3ViamVjdF9yZWdleD86IHN0cmluZyB8IG51bGxcbiAgICAgIGV4dHJhY3RvcnM/OiBSZXR1cm5UeXBlPHR5cGVvZiBwYXJzZUV4dHJhY3RvcnNKc29uPlxuICAgICAgZW5hYmxlZD86IGJvb2xlYW5cbiAgICAgIHZlcnNpb246IG51bWJlclxuICAgICAgdXBkYXRlZF9hdDogc3RyaW5nXG4gICAgfSA9IHtcbiAgICAgIHZlcnNpb246IGV4aXN0aW5nLnZlcnNpb24gKyAxLFxuICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgIH1cblxuICAgIGlmIChpbnB1dC5uYW1lICE9IG51bGwpIHBhdGNoLm5hbWUgPSB2YWxpZGF0ZVRlbXBsYXRlTmFtZShpbnB1dC5uYW1lKVxuICAgIGlmIChpbnB1dC5tYXRjaEZyb21QYXR0ZXJuICE9IG51bGwpIHtcbiAgICAgIHBhdGNoLm1hdGNoX2Zyb21fcGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihpbnB1dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgIH1cbiAgICBpZiAoaW5wdXQubWF0Y2hTdWJqZWN0UmVnZXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0Y2gubWF0Y2hfc3ViamVjdF9yZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGlucHV0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgIH1cbiAgICBpZiAoaW5wdXQuZXh0cmFjdG9yc0pzb24gIT0gbnVsbCkge1xuICAgICAgcGF0Y2guZXh0cmFjdG9ycyA9IHBhcnNlRXh0cmFjdG9yc0pzb24oaW5wdXQuZXh0cmFjdG9yc0pzb24pXG4gICAgfVxuICAgIGlmIChpbnB1dC5lbmFibGVkICE9IG51bGwpIHBhdGNoLmVuYWJsZWQgPSBpbnB1dC5lbmFibGVkXG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAuc2V0KHBhdGNoKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcFBhcnNpbmdUZW1wbGF0ZShyb3cpXG4gIH0sXG5cbiAgYXN5bmMgZGVsZXRlUGFyc2luZ1RlbXBsYXRlKGlkOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgcmV0dXJuIE51bWJlcihyZXN1bHQubnVtRGVsZXRlZFJvd3MgPz8gMCkgPiAwXG4gIH0sXG5cbiAgYXN5bmMgZ2VuZXJhdGVQYXJzaW5nVGVtcGxhdGUoXG4gICAgaW5wdXQ6IEdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXQsXG4gICk6IFByb21pc2U8UGFyc2luZ1RlbXBsYXRlPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgbWVzc2FnZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgLmlubmVySm9pbignbWFpbGJveGVzJywgJ21haWxib3hlcy5pZCcsICdtZXNzYWdlcy5tYWlsYm94X2lkJylcbiAgICAgIC5zZWxlY3QoW1xuICAgICAgICAnbWVzc2FnZXMuaWQnLFxuICAgICAgICAnbWVzc2FnZXMubWFpbGJveF9pZCcsXG4gICAgICAgICdtZXNzYWdlcy5mcm9tX2FkZHJlc3MnLFxuICAgICAgICAnbWVzc2FnZXMuc3ViamVjdCcsXG4gICAgICAgICdtZXNzYWdlcy50ZXh0X2JvZHknLFxuICAgICAgICAnbWVzc2FnZXMuaHRtbF9ib2R5JyxcbiAgICAgIF0pXG4gICAgICAud2hlcmUoJ21lc3NhZ2VzLmlkJywgJz0nLCBpbnB1dC5tZXNzYWdlSWQpXG4gICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIW1lc3NhZ2UpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtZXNzYWdlIG5vdCBmb3VuZCcpXG4gICAgaWYgKCFtZXNzYWdlLnRleHRfYm9keSAmJiAhbWVzc2FnZS5odG1sX2JvZHkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgICAnbWVzc2FnZSBoYXMgbm8gc3RvcmVkIGJvZHk7IHJlLXN5bmMgYWZ0ZXIgdXBncmFkaW5nIG1haWxib3gnLFxuICAgICAgKVxuICAgIH1cblxuICAgIGxldCBhaU91dFxuICAgIHRyeSB7XG4gICAgICBhaU91dCA9IGF3YWl0IGdlbmVyYXRlRW1haWxTcGVuZFRlbXBsYXRlKHtcbiAgICAgICAgZnJvbTogbWVzc2FnZS5mcm9tX2FkZHJlc3MsXG4gICAgICAgIHN1YmplY3Q6IG1lc3NhZ2Uuc3ViamVjdCxcbiAgICAgICAgdGV4dEJvZHk6IG1lc3NhZ2UudGV4dF9ib2R5LFxuICAgICAgICBodG1sQm9keTogbWVzc2FnZS5odG1sX2JvZHksXG4gICAgICAgIGhpbnRzOiBpbnB1dC5oaW50cyxcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgQWlDbGllbnRFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihgQUkgdGVtcGxhdGUgZ2VuZXJhdGlvbiBmYWlsZWQ6ICR7ZXJyLm1lc3NhZ2V9YClcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cblxuICAgIGNvbnN0IG1hdGNoRnJvbVBhdHRlcm4gPSB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4oYWlPdXQubWF0Y2hGcm9tUGF0dGVybilcbiAgICBjb25zdCBtYXRjaFN1YmplY3RSZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGFpT3V0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgIGNvbnN0IGV4dHJhY3RvcnMgPSBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzKGFpT3V0LmV4dHJhY3RvcnMpXG4gICAgaWYgKCFleHRyYWN0b3JzKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignQUkgcmV0dXJuZWQgaW52YWxpZCBleHRyYWN0b3JzJylcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lID0gdmFsaWRhdGVUZW1wbGF0ZU5hbWUoXG4gICAgICBpbnB1dC5uYW1lPy50cmltKCkgfHwgYWlPdXQubmFtZVN1Z2dlc3Rpb24gfHwgJ1NwZW5kaW5nIHRlbXBsYXRlJyxcbiAgICApXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICBtYWlsYm94X2lkOiBtZXNzYWdlLm1haWxib3hfaWQsXG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBtYXRjaEZyb21QYXR0ZXJuLFxuICAgICAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBtYXRjaFN1YmplY3RSZWdleCxcbiAgICAgICAgZXh0cmFjdG9ycyxcbiAgICAgICAgc291cmNlX21lc3NhZ2VfaWQ6IG1lc3NhZ2UuaWQsXG4gICAgICAgIHZlcnNpb246IDEsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gbWFwUGFyc2luZ1RlbXBsYXRlKHJvdylcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IHJlc29sdmVycyA9IHsgUXVlcnksIE11dGF0aW9uIH1cbiIsICIvKiogTm9ybWFsaXplZCBlbWFpbCB1c2VkIGJ5IHRoZSBleHRyYWN0IHBpcGVsaW5lLiAqL1xuZXhwb3J0IGludGVyZmFjZSBFbWFpbE1lc3NhZ2Uge1xuICAvKiogUHJvdmlkZXItc3BlY2lmaWMgaWQgKEdtYWlsIG1lc3NhZ2UgaWQsIGZpeHR1cmUgaWQsIGV0Yy4pLiAqL1xuICBpZDogc3RyaW5nXG4gIC8qKiBSRkMgNTMyMiBNZXNzYWdlLUlEIHdoZW4gYXZhaWxhYmxlOyB1c2VkIGZvciBpZGVtcG90ZW5jeS4gKi9cbiAgcmZjTWVzc2FnZUlkOiBzdHJpbmdcbiAgZnJvbTogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZEF0OiBEYXRlXG4gIHRleHRCb2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxCb2R5OiBzdHJpbmcgfCBudWxsXG59XG5cbi8qKiBPcGFxdWUgc3luYyBjdXJzb3IgcmV0dXJuZWQgYnkgYSBNYWlsYm94UHJvdmlkZXIuICovXG5leHBvcnQgdHlwZSBTeW5jQ3Vyc29yID0gc3RyaW5nIHwgbnVsbFxuXG5leHBvcnQgaW50ZXJmYWNlIExpc3RNZXNzYWdlc1Jlc3VsdCB7XG4gIG1lc3NhZ2VzOiBFbWFpbE1lc3NhZ2VbXVxuICAvKiogQ3Vyc29yIHRvIHBlcnNpc3QgYWZ0ZXIgYSBzdWNjZXNzZnVsIHN5bmMuICovXG4gIG5leHRDdXJzb3I6IFN5bmNDdXJzb3Jcbn1cblxuZXhwb3J0IHR5cGUgQXJ0aWZhY3RTdGF0dXMgPSAncGVuZGluZycgfCAnYWNjZXB0ZWQnIHwgJ3JlamVjdGVkJ1xuXG4vKiogRG9tYWluLWFnbm9zdGljIGV4dHJhY3Rpb24gcmVzdWx0IChub3QgYSBzcGVuZG1hbmFnZXIgZXhwZW5zZSkuICovXG5leHBvcnQgaW50ZXJmYWNlIEV4dHJhY3Rpb25BcnRpZmFjdCB7XG4gIGtpbmQ6IHN0cmluZ1xuICBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBjb25maWRlbmNlOiBudW1iZXJcbn1cblxuLyoqIFBheWxvYWQgc2hhcGUgZm9yIFNwZW5kaW5nRXh0cmFjdG9yIChga2luZDogXCJzcGVuZGluZy5jYW5kaWRhdGVcImApLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQge1xuICBhbW91bnRDZW50czogbnVtYmVyXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgc3BlbnRPbjogc3RyaW5nXG4gIG1lcmNoYW50OiBzdHJpbmcgfCBudWxsXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgc291cmNlU3ViamVjdDogc3RyaW5nXG4gIHNvdXJjZUZyb206IHN0cmluZ1xuICAvKiogU2V0IHdoZW4gcHVibGlzaGVkIHRvIHNwZW5kbWFuYWdlci4gKi9cbiAgcHVibGlzaGVkRXhwZW5zZUlkPzogbnVtYmVyIHwgbnVsbFxuICAvKiogUGFyc2luZyB0ZW1wbGF0ZSBpZCB3aGVuIGV4dHJhY3RlZCB2aWEgYSB0ZW1wbGF0ZS4gKi9cbiAgdGVtcGxhdGVJZD86IG51bWJlciB8IG51bGxcbn1cblxuZXhwb3J0IGNvbnN0IFNQRU5ESU5HX0NBTkRJREFURV9LSU5EID0gJ3NwZW5kaW5nLmNhbmRpZGF0ZScgYXMgY29uc3RcblxuLyoqIERldGVybWluaXN0aWMgZmllbGQgZXh0cmFjdG9yIHVzZWQgYnkgcGFyc2luZyB0ZW1wbGF0ZXMuICovXG5leHBvcnQgdHlwZSBGaWVsZEV4dHJhY3RvciA9XG4gIHwge1xuICAgIHNvdXJjZTogJ3N1YmplY3QnIHwgJ3RleHQnIHwgJ2h0bWxfdGV4dCdcbiAgICByZWdleDogc3RyaW5nXG4gICAgZ3JvdXA6IG51bWJlclxuICB9XG4gIHwgeyBzb3VyY2U6ICdmcm9tX2RvbWFpbicgfVxuICB8IHsgc291cmNlOiAnY29uc3RhbnQnOyB2YWx1ZTogc3RyaW5nIH1cblxuLyoqIEZpZWxkIG1hcCBzdG9yZWQgaW4gYHBhcnNpbmdfdGVtcGxhdGVzLmV4dHJhY3RvcnNgIEpTT05CLiAqL1xuZXhwb3J0IHR5cGUgU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMgPSB7XG4gIGFtb3VudDogRmllbGRFeHRyYWN0b3JcbiAgY3VycmVuY3k/OiBGaWVsZEV4dHJhY3RvciB8IG51bGxcbiAgc3BlbnRPbj86IEZpZWxkRXh0cmFjdG9yIHwgbnVsbFxuICBtZXJjaGFudD86IEZpZWxkRXh0cmFjdG9yIHwgbnVsbFxuICBub3RlPzogRmllbGRFeHRyYWN0b3IgfCBudWxsXG59XG5cbi8qKiBSdW50aW1lIGRlZmluaXRpb24gZm9yIGEgbWFpbGJveCBwYXJzaW5nIHRlbXBsYXRlLiAqL1xuZXhwb3J0IHR5cGUgU3BlbmRQYXJzaW5nVGVtcGxhdGUgPSB7XG4gIGlkOiBudW1iZXJcbiAgbWF0Y2hGcm9tUGF0dGVybjogc3RyaW5nXG4gIG1hdGNoU3ViamVjdFJlZ2V4Pzogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiBTcGVuZFRlbXBsYXRlRXh0cmFjdG9yc1xuICBlbmFibGVkPzogYm9vbGVhblxufVxuIiwgImltcG9ydCB7IG1hdGNoZXNGcm9tUGF0dGVybiwgbm9ybWFsaXplRnJvbSB9IGZyb20gJy4uL2RvbWFpbl9maWx0ZXIudHMnXG5pbXBvcnQgdHlwZSB7IEV4dHJhY3RvciB9IGZyb20gJy4uL2V4dHJhY3Rvci50cydcbmltcG9ydCB7XG4gIFNQRU5ESU5HX0NBTkRJREFURV9LSU5ELFxuICB0eXBlIEVtYWlsTWVzc2FnZSxcbiAgdHlwZSBFeHRyYWN0aW9uQXJ0aWZhY3QsXG4gIHR5cGUgRmllbGRFeHRyYWN0b3IsXG4gIHR5cGUgU3BlbmRQYXJzaW5nVGVtcGxhdGUsXG4gIHR5cGUgU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMsXG4gIHR5cGUgU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkLFxufSBmcm9tICcuLi90eXBlcy50cydcblxuLyoqXG4gKiBEZXRlcm1pbmlzdGljIHNwZW5kaW5nIGV4dHJhY3RvciBkcml2ZW4gYnkgYSB1c2VyL0FJLWdlbmVyYXRlZCB0ZW1wbGF0ZS5cbiAqIE5vIExMTSBjYWxscyBcdTIwMTQgcmVnZXggLyBjb25zdGFudCAvIGZyb21fZG9tYWluIG9ubHkuXG4gKi9cbmV4cG9ydCBjbGFzcyBUZW1wbGF0ZVNwZW5kaW5nRXh0cmFjdG9yIGltcGxlbWVudHMgRXh0cmFjdG9yIHtcbiAgcmVhZG9ubHkga2luZCA9IFNQRU5ESU5HX0NBTkRJREFURV9LSU5EXG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB0ZW1wbGF0ZTogU3BlbmRQYXJzaW5nVGVtcGxhdGUpIHt9XG5cbiAgZ2V0IHRlbXBsYXRlSWQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy50ZW1wbGF0ZS5pZFxuICB9XG5cbiAgY2FuSGFuZGxlKG1lc3NhZ2U6IEVtYWlsTWVzc2FnZSk6IGJvb2xlYW4ge1xuICAgIGlmICh0aGlzLnRlbXBsYXRlLmVuYWJsZWQgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoIW1hdGNoZXNGcm9tUGF0dGVybihtZXNzYWdlLmZyb20sIHRoaXMudGVtcGxhdGUubWF0Y2hGcm9tUGF0dGVybikpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgICBjb25zdCBzdWJqZWN0UmUgPSB0aGlzLnRlbXBsYXRlLm1hdGNoU3ViamVjdFJlZ2V4Py50cmltKClcbiAgICBpZiAoc3ViamVjdFJlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIW5ldyBSZWdFeHAoc3ViamVjdFJlLCAnaScpLnRlc3QobWVzc2FnZS5zdWJqZWN0KSkgcmV0dXJuIGZhbHNlXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICBleHRyYWN0KG1lc3NhZ2U6IEVtYWlsTWVzc2FnZSk6IEV4dHJhY3Rpb25BcnRpZmFjdFtdIHtcbiAgICBjb25zdCBzb3VyY2VzID0gYnVpbGRTb3VyY2VzKG1lc3NhZ2UpXG4gICAgY29uc3QgYW1vdW50UmF3ID0gYXBwbHlGaWVsZCh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMuYW1vdW50LCBzb3VyY2VzKVxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gcGFyc2VNb25leVRvQ2VudHMoYW1vdW50UmF3KVxuICAgIGlmIChhbW91bnRDZW50cyA9PT0gbnVsbCkgcmV0dXJuIFtdXG5cbiAgICBjb25zdCBjdXJyZW5jeVJhdyA9IHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5jdXJyZW5jeVxuICAgICAgPyBhcHBseUZpZWxkKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5jdXJyZW5jeSwgc291cmNlcylcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IGN1cnJlbmN5ID0gbm9ybWFsaXplQ3VycmVuY3koY3VycmVuY3lSYXcpID8/ICdVU0QnXG5cbiAgICBjb25zdCBzcGVudE9uUmF3ID0gdGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLnNwZW50T25cbiAgICAgID8gYXBwbHlGaWVsZCh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMuc3BlbnRPbiwgc291cmNlcylcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IHNwZW50T24gPSBub3JtYWxpemVEYXRlKHNwZW50T25SYXcpID8/IHRvRGF0ZVN0cmluZyhtZXNzYWdlLnJlY2VpdmVkQXQpXG5cbiAgICBjb25zdCBtZXJjaGFudCA9IHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5tZXJjaGFudFxuICAgICAgPyBhcHBseUZpZWxkKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5tZXJjaGFudCwgc291cmNlcylcbiAgICAgIDogbnVsbFxuXG4gICAgY29uc3Qgbm90ZSA9IHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5ub3RlXG4gICAgICA/IGFwcGx5RmllbGQodGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLm5vdGUsIHNvdXJjZXMpXG4gICAgICA6IG1lc3NhZ2Uuc3ViamVjdC5zbGljZSgwLCAyMDApIHx8IG51bGxcblxuICAgIGNvbnN0IHBheWxvYWQ6IFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCA9IHtcbiAgICAgIGFtb3VudENlbnRzLFxuICAgICAgY3VycmVuY3ksXG4gICAgICBzcGVudE9uLFxuICAgICAgbWVyY2hhbnQ6IG1lcmNoYW50Py50cmltKCkgPyBtZXJjaGFudC50cmltKCkuc2xpY2UoMCwgMTIwKSA6IG51bGwsXG4gICAgICBub3RlOiBub3RlPy50cmltKCkgPyBub3RlLnRyaW0oKS5zbGljZSgwLCAyMDApIDogbnVsbCxcbiAgICAgIHNvdXJjZVN1YmplY3Q6IG1lc3NhZ2Uuc3ViamVjdCxcbiAgICAgIHNvdXJjZUZyb206IG1lc3NhZ2UuZnJvbSxcbiAgICAgIHRlbXBsYXRlSWQ6IHRoaXMudGVtcGxhdGUuaWQsXG4gICAgfVxuXG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQsXG4gICAgICAgIHBheWxvYWQ6IHsgLi4ucGF5bG9hZCB9LFxuICAgICAgICBjb25maWRlbmNlOiAwLjksXG4gICAgICB9LFxuICAgIF1cbiAgfVxufVxuXG50eXBlIFNvdXJjZXMgPSB7XG4gIHN1YmplY3Q6IHN0cmluZ1xuICB0ZXh0OiBzdHJpbmdcbiAgaHRtbF90ZXh0OiBzdHJpbmdcbiAgZnJvbV9kb21haW46IHN0cmluZyB8IG51bGxcbn1cblxuZnVuY3Rpb24gYnVpbGRTb3VyY2VzKG1lc3NhZ2U6IEVtYWlsTWVzc2FnZSk6IFNvdXJjZXMge1xuICBjb25zdCBmcm9tID0gbm9ybWFsaXplRnJvbShtZXNzYWdlLmZyb20pXG4gIHJldHVybiB7XG4gICAgc3ViamVjdDogbWVzc2FnZS5zdWJqZWN0ID8/ICcnLFxuICAgIHRleHQ6IG1lc3NhZ2UudGV4dEJvZHkgPz8gJycsXG4gICAgaHRtbF90ZXh0OiBzdHJpcEh0bWwobWVzc2FnZS5odG1sQm9keSksXG4gICAgZnJvbV9kb21haW46IGZyb20/LmRvbWFpbiA/PyBudWxsLFxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5RmllbGQoXG4gIGV4dHJhY3RvcjogRmllbGRFeHRyYWN0b3IsXG4gIHNvdXJjZXM6IFNvdXJjZXMsXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKGV4dHJhY3Rvci5zb3VyY2UgPT09ICdjb25zdGFudCcpIHtcbiAgICByZXR1cm4gZXh0cmFjdG9yLnZhbHVlXG4gIH1cbiAgaWYgKGV4dHJhY3Rvci5zb3VyY2UgPT09ICdmcm9tX2RvbWFpbicpIHtcbiAgICBpZiAoIXNvdXJjZXMuZnJvbV9kb21haW4pIHJldHVybiBudWxsXG4gICAgY29uc3QgYmFzZSA9IHNvdXJjZXMuZnJvbV9kb21haW4uc3BsaXQoJy4nKVswXVxuICAgIGlmICghYmFzZSkgcmV0dXJuIG51bGxcbiAgICByZXR1cm4gYmFzZS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIGJhc2Uuc2xpY2UoMSlcbiAgfVxuICBjb25zdCBoYXlzdGFjayA9IHNvdXJjZXNbZXh0cmFjdG9yLnNvdXJjZV1cbiAgdHJ5IHtcbiAgICBjb25zdCByZSA9IG5ldyBSZWdFeHAoZXh0cmFjdG9yLnJlZ2V4LCAnaScpXG4gICAgY29uc3QgbSA9IGhheXN0YWNrLm1hdGNoKHJlKVxuICAgIGNvbnN0IGdyb3VwID0gZXh0cmFjdG9yLmdyb3VwXG4gICAgaWYgKCFtIHx8IGdyb3VwIDwgMCB8fCBncm91cCA+PSBtLmxlbmd0aCkgcmV0dXJuIG51bGxcbiAgICBjb25zdCB2YWx1ZSA9IG1bZ3JvdXBdXG4gICAgcmV0dXJuIHZhbHVlPy50cmltKCkgPyB2YWx1ZS50cmltKCkgOiBudWxsXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZnVuY3Rpb24gc3RyaXBIdG1sKGh0bWw6IHN0cmluZyB8IG51bGwpOiBzdHJpbmcge1xuICBpZiAoIWh0bWwpIHJldHVybiAnJ1xuICByZXR1cm4gaHRtbC5yZXBsYWNlKC88W14+XSs+L2csICcgJykucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKVxufVxuXG5mdW5jdGlvbiBwYXJzZU1vbmV5VG9DZW50cyhyYXc6IHN0cmluZyB8IG51bGwpOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKCFyYXcpIHJldHVybiBudWxsXG4gIGNvbnN0IGNsZWFuZWQgPSByYXcucmVwbGFjZSgvW15cXGQuLC1dL2csICcnKS5yZXBsYWNlKC8sL2csICcnKVxuICBpZiAoIWNsZWFuZWQpIHJldHVybiBudWxsXG4gIGNvbnN0IGRvbGxhcnMgPSBOdW1iZXIoY2xlYW5lZClcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoZG9sbGFycykgfHwgZG9sbGFycyA8PSAwKSByZXR1cm4gbnVsbFxuICByZXR1cm4gTWF0aC5yb3VuZChkb2xsYXJzICogMTAwKVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVDdXJyZW5jeShyYXc6IHN0cmluZyB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFyYXcpIHJldHVybiBudWxsXG4gIGNvbnN0IG0gPSByYXcudG9VcHBlckNhc2UoKS5tYXRjaCgvXFxiKFVTRHxFVVJ8R0JQfE1YTnxDQUQpXFxiLylcbiAgcmV0dXJuIG0/LlsxXSA/PyBudWxsXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZURhdGUocmF3OiBzdHJpbmcgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghcmF3KSByZXR1cm4gbnVsbFxuICBjb25zdCBpc28gPSByYXcubWF0Y2goL1xcYigyMFxcZHsyfS1cXGR7Mn0tXFxkezJ9KVxcYi8pXG4gIGlmIChpc28/LlsxXSkgcmV0dXJuIGlzb1sxXVxuICByZXR1cm4gbnVsbFxufVxuXG5mdW5jdGlvbiB0b0RhdGVTdHJpbmcoZDogRGF0ZSk6IHN0cmluZyB7XG4gIHJldHVybiBkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG59XG5cbi8qKiBWYWxpZGF0ZSBleHRyYWN0b3JzIEpTT04gc2hhcGUgKHVzZWQgYnkgQVBJICsgQUkgb3V0cHV0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzKFxuICByYXc6IHVua25vd24sXG4pOiBTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyB8IG51bGwge1xuICBpZiAocmF3ID09PSBudWxsIHx8IHR5cGVvZiByYXcgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIG51bGxcbiAgY29uc3Qgb2JqID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGNvbnN0IGFtb3VudCA9IHBhcnNlRmllbGRFeHRyYWN0b3Iob2JqLmFtb3VudClcbiAgaWYgKCFhbW91bnQpIHJldHVybiBudWxsXG4gIHJldHVybiB7XG4gICAgYW1vdW50LFxuICAgIGN1cnJlbmN5OiBwYXJzZU9wdGlvbmFsRmllbGQob2JqLmN1cnJlbmN5KSxcbiAgICBzcGVudE9uOiBwYXJzZU9wdGlvbmFsRmllbGQob2JqLnNwZW50T24pLFxuICAgIG1lcmNoYW50OiBwYXJzZU9wdGlvbmFsRmllbGQob2JqLm1lcmNoYW50KSxcbiAgICBub3RlOiBwYXJzZU9wdGlvbmFsRmllbGQob2JqLm5vdGUpLFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlT3B0aW9uYWxGaWVsZChyYXc6IHVua25vd24pOiBGaWVsZEV4dHJhY3RvciB8IG51bGwge1xuICBpZiAocmF3ID09PSB1bmRlZmluZWQgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4gcGFyc2VGaWVsZEV4dHJhY3RvcihyYXcpXG59XG5cbmZ1bmN0aW9uIHBhcnNlRmllbGRFeHRyYWN0b3IocmF3OiB1bmtub3duKTogRmllbGRFeHRyYWN0b3IgfCBudWxsIHtcbiAgaWYgKHJhdyA9PT0gbnVsbCB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiBudWxsXG4gIGNvbnN0IG9iaiA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBjb25zdCBzb3VyY2UgPSBvYmouc291cmNlXG4gIGlmIChzb3VyY2UgPT09ICdmcm9tX2RvbWFpbicpIHJldHVybiB7IHNvdXJjZTogJ2Zyb21fZG9tYWluJyB9XG4gIGlmIChzb3VyY2UgPT09ICdjb25zdGFudCcpIHtcbiAgICBpZiAodHlwZW9mIG9iai52YWx1ZSAhPT0gJ3N0cmluZycpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIHsgc291cmNlOiAnY29uc3RhbnQnLCB2YWx1ZTogb2JqLnZhbHVlIH1cbiAgfVxuICBpZiAoc291cmNlID09PSAnc3ViamVjdCcgfHwgc291cmNlID09PSAndGV4dCcgfHwgc291cmNlID09PSAnaHRtbF90ZXh0Jykge1xuICAgIGlmICh0eXBlb2Ygb2JqLnJlZ2V4ICE9PSAnc3RyaW5nJyB8fCAhb2JqLnJlZ2V4KSByZXR1cm4gbnVsbFxuICAgIGlmICh0eXBlb2Ygb2JqLmdyb3VwICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcihvYmouZ3JvdXApIHx8IG9iai5ncm91cCA8IDApIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBuZXcgUmVnRXhwKG9iai5yZWdleCwgJ2knKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgcmV0dXJuIHsgc291cmNlLCByZWdleDogb2JqLnJlZ2V4LCBncm91cDogb2JqLmdyb3VwIH1cbiAgfVxuICByZXR1cm4gbnVsbFxufVxuIiwgImltcG9ydCB7IENvbHVtblR5cGUsIEdlbmVyYXRlZCwgSW5zZXJ0YWJsZSwgU2VsZWN0YWJsZSwgVXBkYXRlYWJsZSB9IGZyb20gJ2t5c2VseSdcblxuZXhwb3J0IGludGVyZmFjZSBEYXRhYmFzZSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG4gIG1haWxib3hlczogTWFpbGJveGVzVGFibGVcbiAgZG9tYWluX2ZpbHRlcnM6IERvbWFpbkZpbHRlcnNUYWJsZVxuICBtZXNzYWdlczogTWVzc2FnZXNUYWJsZVxuICBleHRyYWN0aW9uX2FydGlmYWN0czogRXh0cmFjdGlvbkFydGlmYWN0c1RhYmxlXG4gIHN5bmNfcnVuczogU3luY1J1bnNUYWJsZVxuICBwYXJzaW5nX3RlbXBsYXRlczogUGFyc2luZ1RlbXBsYXRlc1RhYmxlXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVXNlcnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBlbWFpbDogc3RyaW5nXG4gIHBhc3N3b3JkX2hhc2g6IHN0cmluZyB8IG51bGxcbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWFpbGJveGVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIC8qKiAnZml4dHVyZScgfCAnZ21haWwnICovXG4gIHByb3ZpZGVyOiBzdHJpbmdcbiAgbGFiZWw6IHN0cmluZ1xuICBlbmFibGVkOiBib29sZWFuXG4gIC8qKiBPcGFxdWUgcHJvdmlkZXIgc3luYyBjdXJzb3IuICovXG4gIHN5bmNfY3Vyc29yOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBXaGVuIHRydWUsIHdvcmtlciBzaG91bGQgc3luYyBBU0FQLiAqL1xuICBzeW5jX3JlcXVlc3RlZDogYm9vbGVhblxuICAvKiogSlNPTjogeyBhY2Nlc3NUb2tlbiwgcmVmcmVzaFRva2VuPywgZXhwaXJlc0F0TXM/IH0gZm9yIGdtYWlsLiAqL1xuICBvYXV0aF90b2tlbnNfanNvbjogc3RyaW5nIHwgbnVsbFxuICBsYXN0X3N5bmNlZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCwgc3RyaW5nIHwgbnVsbD5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIERvbWFpbkZpbHRlcnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgLyoqIERvbWFpbiAoYW1hem9uLmNvbSkgb3IgZnVsbCBhZGRyZXNzIChub3JlcGx5QGFtYXpvbi5jb20pLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lc3NhZ2VzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gIGZyb21fYWRkcmVzczogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIHN0cmluZz5cbiAgYm9keV9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIHRleHRfYm9keTogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEV4dHJhY3Rpb25BcnRpZmFjdHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBtZXNzYWdlX2lkOiBudW1iZXJcbiAga2luZDogc3RyaW5nXG4gIHBheWxvYWQ6IENvbHVtblR5cGU8dW5rbm93biwgc3RyaW5nIHwgdW5rbm93biwgc3RyaW5nIHwgdW5rbm93bj5cbiAgY29uZmlkZW5jZTogbnVtYmVyXG4gIC8qKiAncGVuZGluZycgfCAnYWNjZXB0ZWQnIHwgJ3JlamVjdGVkJyAqL1xuICBzdGF0dXM6IHN0cmluZ1xuICAvKiogc3BlbmRtYW5hZ2VyIGV4cGVuc2UgaWQgYWZ0ZXIgYWNjZXB0K3B1Ymxpc2ggKi9cbiAgcHVibGlzaGVkX2V4cGVuc2VfaWQ6IG51bWJlciB8IG51bGxcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNpbmdUZW1wbGF0ZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICBlbmFibGVkOiBib29sZWFuXG4gIG1hdGNoX2Zyb21fcGF0dGVybjogc3RyaW5nXG4gIG1hdGNoX3N1YmplY3RfcmVnZXg6IHN0cmluZyB8IG51bGxcbiAgZXh0cmFjdG9yczogQ29sdW1uVHlwZTx1bmtub3duLCBzdHJpbmcgfCB1bmtub3duLCBzdHJpbmcgfCB1bmtub3duPlxuICBzb3VyY2VfbWVzc2FnZV9pZDogbnVtYmVyIHwgbnVsbFxuICB2ZXJzaW9uOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNSdW5zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHN0YXJ0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgZmluaXNoZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsIHN0cmluZyB8IG51bGw+XG4gIGZldGNoZWRfY291bnQ6IG51bWJlclxuICBleHRyYWN0ZWRfY291bnQ6IG51bWJlclxuICBlcnJvcl90ZXh0OiBzdHJpbmcgfCBudWxsXG59XG5cbmV4cG9ydCB0eXBlIFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBNYWlsYm94ID0gU2VsZWN0YWJsZTxNYWlsYm94ZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld01haWxib3ggPSBJbnNlcnRhYmxlPE1haWxib3hlc1RhYmxlPlxuZXhwb3J0IHR5cGUgRG9tYWluRmlsdGVyID0gU2VsZWN0YWJsZTxEb21haW5GaWx0ZXJzVGFibGU+XG5leHBvcnQgdHlwZSBNZXNzYWdlID0gU2VsZWN0YWJsZTxNZXNzYWdlc1RhYmxlPlxuZXhwb3J0IHR5cGUgRXh0cmFjdGlvbkFydGlmYWN0ID0gU2VsZWN0YWJsZTxFeHRyYWN0aW9uQXJ0aWZhY3RzVGFibGU+XG5leHBvcnQgdHlwZSBTeW5jUnVuID0gU2VsZWN0YWJsZTxTeW5jUnVuc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3U3luY1J1biA9IEluc2VydGFibGU8U3luY1J1bnNUYWJsZT5cbmV4cG9ydCB0eXBlIFBhcnNpbmdUZW1wbGF0ZSA9IFNlbGVjdGFibGU8UGFyc2luZ1RlbXBsYXRlc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UGFyc2luZ1RlbXBsYXRlID0gSW5zZXJ0YWJsZTxQYXJzaW5nVGVtcGxhdGVzVGFibGU+XG4iLCAiaW1wb3J0IHsgUG9vbCwgdHlwZXMgfSBmcm9tICdwZydcbmltcG9ydCB7IEt5c2VseSwgUG9zdGdyZXNEaWFsZWN0IH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHsgZW52IH0gZnJvbSAnLi9lbnYudHMnXG5pbXBvcnQge1xuICBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyxcbiAgc3NsRm9yRGF0YWJhc2VVcmwsXG59IGZyb20gJy4vc3NsLnRzJ1xuXG4vLyBLZWVwIFBvc3RncmVzIGBkYXRlYCBhcyBgWVlZWS1NTS1ERGAgc3RyaW5ncy4gVGhlIGRlZmF1bHQgcGcgcGFyc2VyIHR1cm5zXG4vLyB0aGVtIGludG8gSlMgRGF0ZSBvYmplY3RzLCB3aGljaCBHcmFwaFFMIHRoZW4gc3RyaW5naWZpZXMgYXMgZnVsbCB0aW1lc3RhbXBzXG4vLyBhbmQgYnJlYWtzIEZsdXR0ZXIncyBkYXRlLW9ubHkgcGFyc2luZy5cbnR5cGVzLnNldFR5cGVQYXJzZXIodHlwZXMuYnVpbHRpbnMuREFURSwgKHZhbHVlOiBzdHJpbmcpID0+IHZhbHVlKVxuXG5leHBvcnQgdHlwZSBDcmVhdGVLeXNlbHlPcHRpb25zID0ge1xuICAvKiogRmFsbGJhY2sgd2hlbiBgUEdEQVRBQkFTRWAgLyBgREFUQUJBU0VfVVJMYCBhcmUgdW5zZXQuICovXG4gIGRlZmF1bHREYXRhYmFzZTogc3RyaW5nXG59XG5cbmZ1bmN0aW9uIHBvb2xDb25maWdGcm9tRW52KFxuICBkZWZhdWx0RGF0YWJhc2U6IHN0cmluZyxcbik6IENvbnN0cnVjdG9yUGFyYW1ldGVyczx0eXBlb2YgUG9vbD5bMF0ge1xuICBjb25zdCBkYXRhYmFzZVVybCA9IGVudignREFUQUJBU0VfVVJMJylcbiAgaWYgKGRhdGFiYXNlVXJsKSB7XG4gICAgY29uc3Qgc3NsID0gc3NsRm9yRGF0YWJhc2VVcmwoZGF0YWJhc2VVcmwpXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbm5lY3Rpb25TdHJpbmc6IGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zKGRhdGFiYXNlVXJsKSxcbiAgICAgIG1heDogMTAsXG4gICAgICAuLi4oc3NsID09PSB1bmRlZmluZWQgPyB7fSA6IHsgc3NsIH0pLFxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGF0YWJhc2U6IGVudignUEdEQVRBQkFTRScpID8/IGRlZmF1bHREYXRhYmFzZSxcbiAgICBob3N0OiBlbnYoJ1BHSE9TVCcpID8/ICdsb2NhbGhvc3QnLFxuICAgIHVzZXI6IGVudignUEdVU0VSJykgPz8gJ3Bvc3RncmVzJyxcbiAgICBwYXNzd29yZDogZW52KCdQR1BBU1NXT1JEJykgPz8gJ3Rlc3QxMjM0JyxcbiAgICBwb3J0OiBOdW1iZXIoZW52KCdQR1BPUlQnKSA/PyAnNTQzMicpLFxuICAgIG1heDogMTAsXG4gIH1cbn1cblxuLyoqIENyZWF0ZSBhIEt5c2VseSBpbnN0YW5jZSBmb3IgdGhlIGdpdmVuIHNjaGVtYSB0eXBlIGFuZCBkZWZhdWx0IERCIG5hbWUuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlS3lzZWx5PERCPihvcHRpb25zOiBDcmVhdGVLeXNlbHlPcHRpb25zKTogS3lzZWx5PERCPiB7XG4gIGNvbnN0IGRpYWxlY3QgPSBuZXcgUG9zdGdyZXNEaWFsZWN0KHtcbiAgICBwb29sOiBuZXcgUG9vbChwb29sQ29uZmlnRnJvbUVudihvcHRpb25zLmRlZmF1bHREYXRhYmFzZSkpLFxuICB9KVxuICByZXR1cm4gbmV3IEt5c2VseTxEQj4oeyBkaWFsZWN0IH0pXG59XG4iLCAiLyoqIFJlYWQgYW4gZW52IHZhciBmcm9tIE5vZGUgYHByb2Nlc3MuZW52YCBvciBEZW5vLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVudihuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5bbmFtZV0pIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbbmFtZV1cbiAgfVxuICB0cnkge1xuICAgIHJldHVybiBEZW5vLmVudi5nZXQobmFtZSlcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG59XG4iLCAiLyoqIFRMUyBvcHRpb25zIGZvciBgcGdgIGZyb20gYSBQb3N0Z3JlcyBVUkwuICovXG5leHBvcnQgZnVuY3Rpb24gc3NsRm9yRGF0YWJhc2VVcmwoXG4gIGRhdGFiYXNlVXJsOiBzdHJpbmcsXG4pOiBmYWxzZSB8IHsgcmVqZWN0VW5hdXRob3JpemVkOiBib29sZWFuIH0gfCB1bmRlZmluZWQge1xuICBsZXQgdXJsOiBVUkxcbiAgdHJ5IHtcbiAgICB1cmwgPSBuZXcgVVJMKGRhdGFiYXNlVXJsKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICBjb25zdCBtb2RlID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoJ3NzbG1vZGUnKT8udG9Mb3dlckNhc2UoKVxuICBpZiAobW9kZSA9PT0gJ2Rpc2FibGUnKSByZXR1cm4gZmFsc2VcbiAgaWYgKG1vZGUgPT09ICdyZXF1aXJlJyB8fCBtb2RlID09PSAndmVyaWZ5LWNhJyB8fCBtb2RlID09PSAndmVyaWZ5LWZ1bGwnKSB7XG4gICAgcmV0dXJuIHsgcmVqZWN0VW5hdXRob3JpemVkOiBmYWxzZSB9XG4gIH1cblxuICBjb25zdCBob3N0ID0gdXJsLmhvc3RuYW1lXG4gIGlmIChob3N0ID09PSAnbG9jYWxob3N0JyB8fCBob3N0ID09PSAnMTI3LjAuMC4xJykgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIHJldHVybiB7IHJlamVjdFVuYXV0aG9yaXplZDogZmFsc2UgfVxufVxuXG4vKipcbiAqIFN0cmlwIFNTTCBxdWVyeSBwYXJhbXMgZnJvbSBhIFBvc3RncmVzIFVSTCBiZWZvcmUgcGFzc2luZyBpdCB0byBgcGdgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMoZGF0YWJhc2VVcmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChkYXRhYmFzZVVybClcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBbXG4gICAgICAnc3NsbW9kZScsXG4gICAgICAnc3NsJyxcbiAgICAgICdzc2xyb290Y2VydCcsXG4gICAgICAnc3NsY2VydCcsXG4gICAgICAnc3Nsa2V5JyxcbiAgICBdKSB7XG4gICAgICB1cmwuc2VhcmNoUGFyYW1zLmRlbGV0ZShrZXkpXG4gICAgfVxuICAgIHJldHVybiB1cmwudG9TdHJpbmcoKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZGF0YWJhc2VVcmxcbiAgfVxufVxuIiwgImltcG9ydCB7IERhdGFiYXNlIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBjcmVhdGVLeXNlbHkgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvY3JlYXRlX2t5c2VseS50cydcblxuZXhwb3J0IHsgZW52IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2Vudi50cydcblxuZXhwb3J0IGNvbnN0IGRiID0gY3JlYXRlS3lzZWx5PERhdGFiYXNlPih7XG4gIGRlZmF1bHREYXRhYmFzZTogJ21haWxib3gnLFxufSlcbiIsICJleHBvcnQgdHlwZSBHZW5lcmF0ZVRlbXBsYXRlQWlJbnB1dCA9IHtcbiAgZnJvbTogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICB0ZXh0Qm9keT86IHN0cmluZyB8IG51bGxcbiAgaHRtbEJvZHk/OiBzdHJpbmcgfCBudWxsXG4gIGhpbnRzPzogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgdHlwZSBHZW5lcmF0ZVRlbXBsYXRlQWlPdXRwdXQgPSB7XG4gIG1hdGNoRnJvbVBhdHRlcm46IHN0cmluZ1xuICBtYXRjaFN1YmplY3RSZWdleDogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBuYW1lU3VnZ2VzdGlvbjogc3RyaW5nXG59XG5cbmV4cG9ydCBjbGFzcyBBaUNsaWVudEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdBaUNsaWVudEVycm9yJ1xuICB9XG59XG5cbi8qKlxuICogQ2FsbCBhaS1hcGkgZ2VuZXJhdGVfZW1haWxfc3BlbmRfdGVtcGxhdGUgdXNlIGNhc2UuXG4gKiBPdmVycmlkYWJsZSBmZXRjaCBmb3IgdGVzdHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUVtYWlsU3BlbmRUZW1wbGF0ZShcbiAgaW5wdXQ6IEdlbmVyYXRlVGVtcGxhdGVBaUlucHV0LFxuICBvcHRpb25zPzoge1xuICAgIGJhc2VVcmw/OiBzdHJpbmdcbiAgICBzZXJ2aWNlS2V5Pzogc3RyaW5nXG4gICAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoXG4gIH0sXG4pOiBQcm9taXNlPEdlbmVyYXRlVGVtcGxhdGVBaU91dHB1dD4ge1xuICBjb25zdCBiYXNlVXJsID0gKG9wdGlvbnM/LmJhc2VVcmwgPz9cbiAgICBEZW5vLmVudi5nZXQoJ0FJX0FQSV9CQVNFX1VSTCcpID8/XG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwNCcpLnJlcGxhY2UoL1xcLyQvLCAnJylcbiAgY29uc3Qgc2VydmljZUtleSA9IG9wdGlvbnM/LnNlcnZpY2VLZXkgPz8gRGVuby5lbnYuZ2V0KCdBSV9TRVJWSUNFX0tFWScpXG4gIGlmICghc2VydmljZUtleSkge1xuICAgIHRocm93IG5ldyBBaUNsaWVudEVycm9yKCdBSV9TRVJWSUNFX0tFWSBpcyBub3QgY29uZmlndXJlZCcpXG4gIH1cblxuICBjb25zdCBmZXRjaEltcGwgPSBvcHRpb25zPy5mZXRjaEltcGwgPz8gZmV0Y2hcbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2hJbXBsKFxuICAgIGAke2Jhc2VVcmx9L3YxL3VzZS1jYXNlcy9nZW5lcmF0ZV9lbWFpbF9zcGVuZF90ZW1wbGF0ZS9ydW5gLFxuICAgIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c2VydmljZUtleX1gLFxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBmcm9tOiBpbnB1dC5mcm9tLFxuICAgICAgICAgIHN1YmplY3Q6IGlucHV0LnN1YmplY3QsXG4gICAgICAgICAgdGV4dEJvZHk6IGlucHV0LnRleHRCb2R5ID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICBodG1sQm9keTogaW5wdXQuaHRtbEJvZHkgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgIGhpbnRzOiBpbnB1dC5oaW50cyA/PyB1bmRlZmluZWQsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9LFxuICApXG5cbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKS5jYXRjaCgoKSA9PiAnJylcbiAgICB0aHJvdyBuZXcgQWlDbGllbnRFcnJvcihcbiAgICAgIGBhaS1hcGkgZXJyb3IgJHtyZXMuc3RhdHVzfTogJHt0ZXh0LnNsaWNlKDAsIDMwMCl9YCxcbiAgICApXG4gIH1cblxuICBjb25zdCBib2R5ID0gYXdhaXQgcmVzLmpzb24oKSBhcyB7IG91dHB1dD86IEdlbmVyYXRlVGVtcGxhdGVBaU91dHB1dCB9XG4gIGlmICghYm9keS5vdXRwdXQpIHtcbiAgICB0aHJvdyBuZXcgQWlDbGllbnRFcnJvcignYWktYXBpIHJlc3BvbnNlIG1pc3Npbmcgb3V0cHV0JylcbiAgfVxuICByZXR1cm4gYm9keS5vdXRwdXRcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCB9IGZyb20gJ21haWxib3hfa2l0L21vZC50cydcblxuZXhwb3J0IGNsYXNzIFNwZW5kbWFuYWdlclNpbmtFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnU3BlbmRtYW5hZ2VyU2lua0Vycm9yJ1xuICB9XG59XG5cbmV4cG9ydCB0eXBlIFB1Ymxpc2hFeHBlbnNlUmVzdWx0ID0ge1xuICBleHBlbnNlSWQ6IG51bWJlclxufVxuXG4vKipcbiAqIFB1Ymxpc2ggYW4gYWNjZXB0ZWQgc3BlbmRpbmcgY2FuZGlkYXRlIHRvIHNwZW5kbWFuYWdlci1hcGkgdmlhIEdyYXBoUUwsXG4gKiBmb3J3YXJkaW5nIHRoZSBjYWxsZXIncyBTdXBlclRva2VucyBCZWFyZXIgSldULlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHVibGlzaEV4cGVuc2VUb1NwZW5kbWFuYWdlcihcbiAgY2FuZGlkYXRlOiBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQsXG4gIGNhdGVnb3J5SWQ6IG51bWJlcixcbiAgYXV0aG9yaXphdGlvbkhlYWRlcjogc3RyaW5nLFxuICBvcHRpb25zPzoge1xuICAgIGJhc2VVcmw/OiBzdHJpbmdcbiAgICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2hcbiAgfSxcbik6IFByb21pc2U8UHVibGlzaEV4cGVuc2VSZXN1bHQ+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICB0aHJvdyBuZXcgU3BlbmRtYW5hZ2VyU2lua0Vycm9yKCdtaXNzaW5nIEJlYXJlciBhdXRob3JpemF0aW9uJylcbiAgfVxuXG4gIGNvbnN0IGJhc2VVcmwgPSAob3B0aW9ucz8uYmFzZVVybCA/P1xuICAgIERlbm8uZW52LmdldCgnU1BFTkRNQU5BR0VSX0FQSV9CQVNFX1VSTCcpID8/XG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMicpLnJlcGxhY2UoL1xcLyQvLCAnJylcblxuICBjb25zdCBub3RlID0gY2FuZGlkYXRlLm5vdGU/LnRyaW0oKSB8fFxuICAgIFtjYW5kaWRhdGUubWVyY2hhbnQsIGNhbmRpZGF0ZS5zb3VyY2VTdWJqZWN0XS5maWx0ZXIoQm9vbGVhbikuam9pbignIFx1MjAxNCAnKSB8fFxuICAgIG51bGxcblxuICBjb25zdCBxdWVyeSA9IGBcbiAgICBtdXRhdGlvbiBDcmVhdGVFeHBlbnNlKCRpbnB1dDogQ3JlYXRlRXhwZW5zZUlucHV0SW5wdXQhKSB7XG4gICAgICBjcmVhdGVFeHBlbnNlKGFyZ3M6IHsgaW5wdXQ6ICRpbnB1dCB9KSB7XG4gICAgICAgIGlkXG4gICAgICB9XG4gICAgfVxuICBgXG5cbiAgY29uc3QgZmV0Y2hJbXBsID0gb3B0aW9ucz8uZmV0Y2hJbXBsID8/IGZldGNoXG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoSW1wbChgJHtiYXNlVXJsfS9ncmFwaHFsYCwge1xuICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgIEF1dGhvcml6YXRpb246IGF1dGhvcml6YXRpb25IZWFkZXIsXG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgcXVlcnksXG4gICAgICB2YXJpYWJsZXM6IHtcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBjYXRlZ29yeUlkLFxuICAgICAgICAgIGFtb3VudENlbnRzOiBjYW5kaWRhdGUuYW1vdW50Q2VudHMsXG4gICAgICAgICAgc3BlbnRPbjogY2FuZGlkYXRlLnNwZW50T24sXG4gICAgICAgICAgY3VycmVuY3k6IGNhbmRpZGF0ZS5jdXJyZW5jeSxcbiAgICAgICAgICBub3RlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KSxcbiAgfSlcblxuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpLmNhdGNoKCgpID0+ICcnKVxuICAgIHRocm93IG5ldyBTcGVuZG1hbmFnZXJTaW5rRXJyb3IoXG4gICAgICBgc3BlbmRtYW5hZ2VyIEhUVFAgJHtyZXMuc3RhdHVzfTogJHt0ZXh0LnNsaWNlKDAsIDMwMCl9YCxcbiAgICApXG4gIH1cblxuICBjb25zdCBib2R5ID0gYXdhaXQgcmVzLmpzb24oKSBhcyB7XG4gICAgZGF0YT86IHsgY3JlYXRlRXhwZW5zZT86IHsgaWQ6IG51bWJlciB9IH1cbiAgICBlcnJvcnM/OiB7IG1lc3NhZ2U6IHN0cmluZyB9W11cbiAgfVxuXG4gIGlmIChib2R5LmVycm9ycz8ubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFNwZW5kbWFuYWdlclNpbmtFcnJvcihcbiAgICAgIGJvZHkuZXJyb3JzLm1hcCgoZSkgPT4gZS5tZXNzYWdlKS5qb2luKCc7ICcpLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IGlkID0gYm9keS5kYXRhPy5jcmVhdGVFeHBlbnNlPy5pZFxuICBpZiAodHlwZW9mIGlkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBTcGVuZG1hbmFnZXJTaW5rRXJyb3IoJ3NwZW5kbWFuYWdlciByZXNwb25zZSBtaXNzaW5nIGV4cGVuc2UgaWQnKVxuICB9XG4gIHJldHVybiB7IGV4cGVuc2VJZDogaWQgfVxufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBhc0lzb1RpbWVzdGFtcCh2YWx1ZTogRGF0ZSB8IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcbiAgaWYgKC9eXFxkezEwLH0kLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgY29uc3QgbiA9IE51bWJlcih0cmltbWVkKVxuICAgIGNvbnN0IG1zID0gdHJpbW1lZC5sZW5ndGggPD0gMTAgPyBuICogMTAwMCA6IG5cbiAgICByZXR1cm4gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKClcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFzSXNvVGltZXN0YW1wT3JOdWxsKFxuICB2YWx1ZTogRGF0ZSB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiBhc0lzb1RpbWVzdGFtcCh2YWx1ZSlcbn1cbiIsICJjb25zdCBQUk9WSURFUlMgPSBuZXcgU2V0KFsnZml4dHVyZScsICdnbWFpbCddKVxuY29uc3QgQVJUSUZBQ1RfU1RBVFVTRVMgPSBuZXcgU2V0KFsncGVuZGluZycsICdhY2NlcHRlZCcsICdyZWplY3RlZCddKVxuXG5leHBvcnQgY2xhc3MgSW52YWxpZE1haWxib3hFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnSW52YWxpZE1haWxib3hFcnJvcidcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVQcm92aWRlcihwcm92aWRlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHByb3ZpZGVyLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGlmICghUFJPVklERVJTLmhhcyh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgYHByb3ZpZGVyIG11c3QgYmUgb25lIG9mOiAke1suLi5QUk9WSURFUlNdLmpvaW4oJywgJyl9YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTGFiZWwobGFiZWw6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsYWJlbC50cmltKClcbiAgaWYgKCF0cmltbWVkKSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbGFiZWwgaXMgcmVxdWlyZWQnKVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdsYWJlbCBpcyB0b28gbG9uZycpXG4gIHJldHVybiB0cmltbWVkXG59XG5cbi8qKlxuICogQWxsb3dlZCBwYXR0ZXJuczpcbiAqIC0gYHVzZXJAc2hvcC5jb21gLCBgKkBzaG9wLmNvbWAsIGAqQCouc2hvcC5jb21gXG4gKiAtIGBzaG9wLmNvbWAsIGAqLnNob3AuY29tYFxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEb21haW5QYXR0ZXJucyhwYXR0ZXJuczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXVxuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgZm9yIChjb25zdCByYXcgb2YgcGF0dGVybnMpIHtcbiAgICBjb25zdCBwID0gcmF3LnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgaWYgKCFwKSBjb250aW51ZVxuICAgIGlmIChwLmxlbmd0aCA+IDI1NSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2RvbWFpbiBmaWx0ZXIgcGF0dGVybiBpcyB0b28gbG9uZycpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEZyb21QYXR0ZXJuKHApKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgICAgYGludmFsaWQgZG9tYWluIGZpbHRlciBwYXR0ZXJuOiAke3Jhd31gLFxuICAgICAgKVxuICAgIH1cbiAgICBpZiAoc2Vlbi5oYXMocCkpIGNvbnRpbnVlXG4gICAgc2Vlbi5hZGQocClcbiAgICBvdXQucHVzaChwKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRGcm9tUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3QgcCA9IHBhdHRlcm4udHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFwIHx8IHAubGVuZ3RoID4gMjU1KSByZXR1cm4gZmFsc2VcblxuICBpZiAocC5pbmNsdWRlcygnQCcpKSB7XG4gICAgY29uc3QgYXQgPSBwLmxhc3RJbmRleE9mKCdAJylcbiAgICBpZiAoYXQgPD0gMCB8fCBhdCA9PT0gcC5sZW5ndGggLSAxKSByZXR1cm4gZmFsc2VcbiAgICBjb25zdCBsb2NhbCA9IHAuc2xpY2UoMCwgYXQpXG4gICAgY29uc3QgZG9tYWluID0gcC5zbGljZShhdCArIDEpXG4gICAgaWYgKGxvY2FsICE9PSAnKicgJiYgKGxvY2FsLmluY2x1ZGVzKCcqJykgfHwgbG9jYWwuaW5jbHVkZXMoJ0AnKSkpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgICByZXR1cm4gaXNWYWxpZERvbWFpblBhdHRlcm4oZG9tYWluKVxuICB9XG4gIHJldHVybiBpc1ZhbGlkRG9tYWluUGF0dGVybihwKVxufVxuXG5mdW5jdGlvbiBpc1ZhbGlkRG9tYWluUGF0dGVybihkb21haW46IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoZG9tYWluLnN0YXJ0c1dpdGgoJyouJykpIHtcbiAgICBjb25zdCByZXN0ID0gZG9tYWluLnNsaWNlKDIpXG4gICAgaWYgKCFyZXN0IHx8IHJlc3QuaW5jbHVkZXMoJyonKSB8fCAhcmVzdC5pbmNsdWRlcygnLicpKSByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gL15bYS16MC05XShbYS16MC05LV0qW2EtejAtOV0pPyhcXC5bYS16MC05XShbYS16MC05LV0qW2EtejAtOV0pPykrJC9cbiAgICAgIC50ZXN0KHJlc3QpXG4gIH1cbiAgaWYgKGRvbWFpbi5pbmNsdWRlcygnKicpKSByZXR1cm4gZmFsc2VcbiAgcmV0dXJuIC9eW2EtejAtOV0oW2EtejAtOS1dKlthLXowLTldKT8oXFwuW2EtejAtOV0oW2EtejAtOS1dKlthLXowLTldKT8pKyQvXG4gICAgLnRlc3QoZG9tYWluKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBcnRpZmFjdFN0YXR1cyhzdGF0dXM6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBzdGF0dXMudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFBUlRJRkFDVF9TVEFUVVNFUy5oYXModHJpbW1lZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgIGBzdGF0dXMgbXVzdCBiZSBvbmUgb2Y6ICR7Wy4uLkFSVElGQUNUX1NUQVRVU0VTXS5qb2luKCcsICcpfWAsXG4gICAgKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVRlbXBsYXRlTmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gbmFtZS50cmltKClcbiAgaWYgKCF0cmltbWVkKSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcigndGVtcGxhdGUgbmFtZSBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCd0ZW1wbGF0ZSBuYW1lIGlzIHRvbyBsb25nJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVNYXRjaEZyb21QYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHAgPSBwYXR0ZXJuLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGlmICghaXNWYWxpZEZyb21QYXR0ZXJuKHApKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoYGludmFsaWQgbWF0Y2hGcm9tUGF0dGVybjogJHtwYXR0ZXJufWApXG4gIH1cbiAgcmV0dXJuIHBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3ViamVjdFJlZ2V4KFxuICByZWdleDogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAocmVnZXggPT09IG51bGwgfHwgcmVnZXggPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGxcbiAgY29uc3QgdHJpbW1lZCA9IHJlZ2V4LnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHJldHVybiBudWxsXG4gIHRyeSB7XG4gICAgbmV3IFJlZ0V4cCh0cmltbWVkLCAnaScpXG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtYXRjaFN1YmplY3RSZWdleCBpcyBub3QgYSB2YWxpZCByZWdleHAnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNhdGVnb3J5SWQoY2F0ZWdvcnlJZDogdW5rbm93bik6IG51bWJlciB7XG4gIGlmIChcbiAgICB0eXBlb2YgY2F0ZWdvcnlJZCAhPT0gJ251bWJlcicgfHxcbiAgICAhTnVtYmVyLmlzSW50ZWdlcihjYXRlZ29yeUlkKSB8fFxuICAgIGNhdGVnb3J5SWQgPCAxXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgJ2NhdGVnb3J5SWQgaXMgcmVxdWlyZWQgd2hlbiBhY2NlcHRpbmcgYSBzcGVuZGluZyBjYW5kaWRhdGUnLFxuICAgIClcbiAgfVxuICByZXR1cm4gY2F0ZWdvcnlJZFxufVxuIiwgImltcG9ydCB7IGNyZWF0ZVJlbW90ZUpXS1NldCwgand0VmVyaWZ5IH0gZnJvbSAnam9zZSdcbmltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5cbmNvbnN0IEFVVEhfQVBJX0RPTUFJTiA9XG4gICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFVVEhfQVBJX0RPTUFJTikgfHxcbiAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMSdcbmNvbnN0IEpXS1NfVVJMID0gYCR7QVVUSF9BUElfRE9NQUlOfS9hdXRoL2p3dC9qd2tzLmpzb25gXG5cbmNvbnN0IGp3a3MgPSBjcmVhdGVSZW1vdGVKV0tTZXQobmV3IFVSTChKV0tTX1VSTCkpXG5cbmV4cG9ydCB0eXBlIFZlcmlmaWVkQXV0aCA9IHtcbiAgYXV0aFVzZXJJZDogc3RyaW5nXG4gIGVtYWlsPzogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJpZnlBY2Nlc3NUb2tlbihcbiAgYXV0aG9yaXphdGlvbkhlYWRlcjogc3RyaW5nIHwgdW5kZWZpbmVkLFxuKTogUHJvbWlzZTxWZXJpZmllZEF1dGggfCBudWxsPiB7XG4gIGlmICghYXV0aG9yaXphdGlvbkhlYWRlcj8uc3RhcnRzV2l0aCgnQmVhcmVyICcpKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGNvbnN0IHRva2VuID0gYXV0aG9yaXphdGlvbkhlYWRlci5zbGljZSgnQmVhcmVyICcubGVuZ3RoKS50cmltKClcbiAgaWYgKCF0b2tlbikge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHsgcGF5bG9hZCB9ID0gYXdhaXQgand0VmVyaWZ5KHRva2VuLCBqd2tzLCB7XG4gICAgICBhbGdvcml0aG1zOiBbJ1JTMjU2J10sXG4gICAgfSlcblxuICAgIGNvbnN0IGF1dGhVc2VySWQgPSB0eXBlb2YgcGF5bG9hZC5zdWIgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5zdWIgOiBudWxsXG4gICAgaWYgKCFhdXRoVXNlcklkKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IGVtYWlsID1cbiAgICAgIHR5cGVvZiBwYXlsb2FkLmVtYWlsID09PSAnc3RyaW5nJyA/IHBheWxvYWQuZW1haWwgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7IGF1dGhVc2VySWQsIGVtYWlsIH1cbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdW5hdXRob3JpemVkUmVzcG9uc2UoKTogUmVzcG9uc2Uge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdVbmF1dGhvcml6ZWQnIH0pLCB7XG4gICAgc3RhdHVzOiA0MDEsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICAgIH0sXG4gIH0pXG59XG5cbi8qKiBDT1JTIHByZWZsaWdodCAvIHNpbXBsZSByZXNwb25zZXMgZm9yIGJyb3dzZXIgR3JhcGhRTCBjbGllbnRzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvcnNNaWRkbGV3YXJlKGN0eDogQ29udGV4dCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikge1xuICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UobnVsbCwge1xuICAgICAgc3RhdHVzOiAyMDQsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG5cbiAgYXdhaXQgbmV4dCgpXG5cbiAgY3R4LnJlcy5oZWFkZXJzLnNldCgnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgJyonKVxuICBjdHgucmVzLmhlYWRlcnMuc2V0KFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJyxcbiAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICApXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnLFxuICAgICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICApXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7XG4gIHVuYXV0aG9yaXplZFJlc3BvbnNlLFxuICB2ZXJpZnlBY2Nlc3NUb2tlbixcbiAgdHlwZSBWZXJpZmllZEF1dGgsXG59IGZyb20gJy4uL2F1dGgvdmVyaWZ5LnRzJ1xuXG4vKiogUHVibGljIEFMQiAvIGxvYWQtYmFsYW5jZXIgaGVhbHRoIGNoZWNrLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhlYWx0aE1pZGRsZXdhcmUoXG4gIGN0eDogQ29udGV4dCxcbiAgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPixcbikge1xuICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcbiAgaWYgKHBhdGggPT09ICcvaGVhbHRoJyAmJiBjdHgucmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IHRydWUgfSksIHtcbiAgICAgIHN0YXR1czogMjAwLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG4gIGF3YWl0IG5leHQoKVxufVxuXG5leHBvcnQgdHlwZSBMb2NhbFVzZXJSZWYgPSB7XG4gIGlkOiBudW1iZXJcbn1cblxuZXhwb3J0IHR5cGUgUmVzb2x2ZUxvY2FsVXNlckZuID0gKFxuICBpZGVudGl0eTogVmVyaWZpZWRBdXRoLFxuKSA9PiBQcm9taXNlPExvY2FsVXNlclJlZj5cblxuLyoqXG4gKiBSZXF1aXJlIGEgdmFsaWQgQmVhcmVyIEpXVCBvbiBgL2dyYXBocWxgIGFuZCBzZXQgUHlsb24gY29udGV4dCB2YXJzOlxuICogYHVzZXJJZGAsIGBhdXRoVXNlcklkYCwgb3B0aW9uYWwgYGF1dGhFbWFpbGAuXG4gKlxuICogQ2FsbGVycyB0aGF0IG5lZWQgYXV0aCBmb3Igb3RoZXIgcGF0aHMgKGUuZy4gUkVTVCBhc3NldHMpIHNob3VsZCBoYW5kbGVcbiAqIHRob3NlIGJlZm9yZSB0aGlzIG1pZGRsZXdhcmUgb3IgdXNlIGB2ZXJpZnlBY2Nlc3NUb2tlbmAgZGlyZWN0bHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUoXG4gIHJlc29sdmVMb2NhbFVzZXI6IFJlc29sdmVMb2NhbFVzZXJGbixcbikge1xuICByZXR1cm4gYXN5bmMgZnVuY3Rpb24gZ3JhcGhRTEF1dGhNaWRkbGV3YXJlKFxuICAgIGN0eDogQ29udGV4dCxcbiAgICBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgICAgYXdhaXQgbmV4dCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcblxuICAgIGlmIChcbiAgICAgIHBhdGggPT09ICcvaGVhbHRoJyB8fFxuICAgICAgKHBhdGggIT09ICcvZ3JhcGhxbCcgJiYgIXBhdGguZW5kc1dpdGgoJy9ncmFwaHFsJykpXG4gICAgKSB7XG4gICAgICBhd2FpdCBuZXh0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgdmVyaWZ5QWNjZXNzVG9rZW4oY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSlcbiAgICBpZiAoIXZlcmlmaWVkKSB7XG4gICAgICByZXR1cm4gdW5hdXRob3JpemVkUmVzcG9uc2UoKVxuICAgIH1cblxuICAgIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIodmVyaWZpZWQpXG5cbiAgICBjdHguc2V0KCdhdXRoVXNlcklkJywgdmVyaWZpZWQuYXV0aFVzZXJJZClcbiAgICBpZiAodmVyaWZpZWQuZW1haWwpIHtcbiAgICAgIGN0eC5zZXQoJ2F1dGhFbWFpbCcsIHZlcmlmaWVkLmVtYWlsKVxuICAgIH1cbiAgICBjdHguc2V0KCd1c2VySWQnLCBsb2NhbFVzZXIuaWQpXG5cbiAgICBhd2FpdCBuZXh0KClcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBLeXNlbHksIFNlbGVjdGFibGUgfSBmcm9tICdreXNlbHknXG5cbi8qKiBNaW5pbWFsIHVzZXJzIHRhYmxlIHNoYXBlIHJlcXVpcmVkIGJ5IHJlc29sdmVMb2NhbFVzZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBVc2Vyc0RhdGFiYXNlID0ge1xuICB1c2VyczogVXNlcnNUYWJsZVxufVxuXG5leHBvcnQgdHlwZSBMb2NhbFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEF1dGhJZGVudGl0eSA9IHtcbiAgYXV0aFVzZXJJZDogc3RyaW5nXG4gIGVtYWlsPzogc3RyaW5nXG4gIG5hbWU/OiBzdHJpbmdcbn1cblxuLyoqXG4gKiBSZXNvbHZlIChvciBjcmVhdGUpIHRoZSBsb2NhbCBgdXNlcnNgIHJvdyBmb3IgYSBTdXBlclRva2VucyBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVMb2NhbFVzZXI8REIgZXh0ZW5kcyBVc2Vyc0RhdGFiYXNlPihcbiAgZGI6IEt5c2VseTxEQj4sXG4gIGlkZW50aXR5OiBBdXRoSWRlbnRpdHksXG4pOiBQcm9taXNlPFNlbGVjdGFibGU8REJbJ3VzZXJzJ10+PiB7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnYXV0aF91c2VyX2lkJywgJz0nLCBpZGVudGl0eS5hdXRoVXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoZXhpc3RpbmcpIHtcbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIGNvbnN0IGVtYWlsID1cbiAgICBpZGVudGl0eS5lbWFpbD8udHJpbSgpIHx8XG4gICAgYCR7aWRlbnRpdHkuYXV0aFVzZXJJZH1AdXNlcnMubG9jYWxgXG4gIGNvbnN0IG5hbWUgPVxuICAgIGlkZW50aXR5Lm5hbWU/LnRyaW0oKSB8fFxuICAgIGVtYWlsLnNwbGl0KCdAJylbMF0gfHxcbiAgICAnVXNlcidcblxuICAvLyBQcmVmZXIgbGlua2luZyBhbiBleGlzdGluZyBlbWFpbCByb3cgKGUuZy4gc2VlZGVkIGRldiB1c2VyKSB3aGVuIHByZXNlbnQuXG4gIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdlbWFpbCcsICc9JywgZW1haWwpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChieUVtYWlsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3VzZXJzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICAgIG5hbWU6IGJ5RW1haWwubmFtZSB8fCBuYW1lLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYnlFbWFpbC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCd1c2VycycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBlbWFpbCxcbiAgICAgIG5hbWUsXG4gICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICBwYXNzd29yZF9oYXNoOiBudWxsLFxuICAgIH0pXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbn1cbiIsICJpbXBvcnQgeyBkYiB9IGZyb20gJy4vZGF0YWJhc2UudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIGFzIHJlc29sdmVMb2NhbFVzZXJLaXQgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvdXNlcnMudHMnXG5pbXBvcnQgdHlwZSB7IEF1dGhJZGVudGl0eSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cydcbmltcG9ydCB0eXBlIHsgVXNlciB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSB7IEF1dGhJZGVudGl0eSB9XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyKGlkZW50aXR5OiBBdXRoSWRlbnRpdHkpOiBQcm9taXNlPFVzZXI+IHtcbiAgcmV0dXJuIHJlc29sdmVMb2NhbFVzZXJLaXQoZGIsIGlkZW50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
