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
    ...row,
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
    ...row,
    started_at: asIsoTimestamp(row.started_at),
    finished_at: asIsoTimestampOrNull(row.finished_at)
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
  typeDefs: "input CreateMailboxInputInput {\n	provider: String!\n	label: String!\n	enabled: Boolean\n	domainFilters: [String!]\n	oauthTokensJson: String\n}\ninput SetDomainFiltersInputInput {\n	mailboxId: Number!\n	patterns: [String!]!\n}\ninput UpdateArtifactStatusInputInput {\n	artifactId: Number!\n	status: String!\n	categoryId: Number\n}\ninput ConnectGmailInputInput {\n	mailboxId: Number!\n	accessToken: String!\n	refreshToken: String\n	expiresAtMs: Number\n}\ninput CreateParsingTemplateInputInput {\n	mailboxId: Number!\n	name: String!\n	matchFromPattern: String!\n	matchSubjectRegex: String\n	extractorsJson: String!\n	enabled: Boolean\n	sourceMessageId: Number\n}\ninput UpdateParsingTemplateInputInput {\n	id: Number!\n	name: String\n	matchFromPattern: String\n	matchSubjectRegex: String\n	extractorsJson: String\n	enabled: Boolean\n}\ninput GenerateParsingTemplateInputInput {\n	messageId: Number!\n	name: String\n	hints: String\n}\ntype Query {\nmailboxes: Any!\ndomainFilters(mailboxId: Number!): Any!\nmessages(mailboxId: Number!): Any!\nextractionArtifacts(mailboxId: Number, status: String): Any!\nsyncRuns(mailboxId: Number!): Any!\nparsingTemplates(mailboxId: Number!): Any!\n}\ntype Mutation {\ncreateMailbox(input: CreateMailboxInputInput!): CreateMailbox!\ndeleteMailbox(id: Number!): Boolean!\nsetDomainFilters(input: SetDomainFiltersInputInput!): Any!\ntriggerSync(mailboxId: Number!): CreateMailbox!\nupdateArtifactStatus(input: UpdateArtifactStatusInputInput!): UpdateArtifactStatus!\nconnectGmail(input: ConnectGmailInputInput!): CreateMailbox!\ncreateParsingTemplate(input: CreateParsingTemplateInputInput!): CreateParsingTemplate!\nupdateParsingTemplate(input: UpdateParsingTemplateInputInput!): CreateParsingTemplate!\ndeleteParsingTemplate(id: Number!): Boolean!\ngenerateParsingTemplate(input: GenerateParsingTemplateInputInput!): CreateParsingTemplate!\n}\ntype CreateMailbox {\nid: Number!\nuser_id: Number!\nprovider: String!\nlabel: String!\nenabled: Boolean!\nsync_cursor: String\nsync_requested: Boolean!\nlast_synced_at: String\ncreated_at: String!\nupdated_at: String!\n}\ntype UpdateArtifactStatus {\nid: Number!\nmessage_id: Number!\nkind: String!\npayload: String!\nconfidence: Number!\nstatus: String!\npublished_expense_id: Number\ncreated_at: String!\nupdated_at: String!\n}\ntype CreateParsingTemplate {\nid: Number!\nmailbox_id: Number!\nuser_id: Number!\nname: String!\nenabled: Boolean!\nmatch_from_pattern: String!\nmatch_subject_regex: String\nextractors: String!\nsource_message_id: Number\nversion: Number!\ncreated_at: String!\nupdated_at: String!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vLi4vLi4vbGlicy9tYWlsYm94X2tpdC90eXBlcy50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2V4dHJhY3RvcnMvdGVtcGxhdGVfc3BlbmRpbmdfZXh0cmFjdG9yLnRzIiwgIi4uL3NyYy9kYi90eXBlcy9zY2hlbWEudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvY3JlYXRlX2t5c2VseS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvc3NsLnRzIiwgIi4uL3NyYy9kYi9kYXRhYmFzZS50cyIsICIuLi9zcmMvc2VydmljZXMvYWlfY2xpZW50LnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9zcGVuZG1hbmFnZXJfZXhwZW5zZV9zaW5rLnRzIiwgIi4uL3NyYy9ncmFwaHFsL3RpbWVzdGFtcHMudHMiLCAiLi4vc3JjL2dyYXBocWwvdmFsaWRhdGlvbi50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzIiwgIi4uL3NyYy9kYi91c2Vycy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHJlc29sdmVycyB9IGZyb20gJy4vZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzJ1xuaW1wb3J0IHsgY29yc01pZGRsZXdhcmUgfSBmcm9tICdkZW5vX2FwaV9raXQvYXV0aC92ZXJpZnkudHMnXG5pbXBvcnQge1xuICBjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUsXG4gIGhlYWx0aE1pZGRsZXdhcmUsXG59IGZyb20gJ2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciB9IGZyb20gJy4vZGIvdXNlcnMudHMnXG5cbmFwcC51c2UoY29yc01pZGRsZXdhcmUpXG5hcHAudXNlKGhlYWx0aE1pZGRsZXdhcmUpXG5hcHAudXNlKGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZShyZXNvbHZlTG9jYWxVc2VyKSlcblxuZXhwb3J0IGNvbnN0IGdyYXBocWwgPSB7XG4gIC4uLnJlc29sdmVycyxcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXBwXG5cbiAgICAgIGltcG9ydCB7aGFuZGxlciBhcyBfX2ludGVybmFsUHlsb25IYW5kbGVyfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiXG5cbiAgICAgIGxldCBfX2ludGVybmFsUHlsb25Db25maWcgPSB1bmRlZmluZWRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gY29uZmlnXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gY29uZmlnIGlzIG5vdCBkZWNsYXJlZCwgcHlsb25Db25maWcgcmVtYWlucyB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgYXBwLnVzZShfX2ludGVybmFsUHlsb25IYW5kbGVyKHtcbiAgICAgICAgdHlwZURlZnM6IFwiaW5wdXQgQ3JlYXRlTWFpbGJveElucHV0SW5wdXQge1xcblxcdHByb3ZpZGVyOiBTdHJpbmchXFxuXFx0bGFiZWw6IFN0cmluZyFcXG5cXHRlbmFibGVkOiBCb29sZWFuXFxuXFx0ZG9tYWluRmlsdGVyczogW1N0cmluZyFdXFxuXFx0b2F1dGhUb2tlbnNKc29uOiBTdHJpbmdcXG59XFxuaW5wdXQgU2V0RG9tYWluRmlsdGVyc0lucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdHBhdHRlcm5zOiBbU3RyaW5nIV0hXFxufVxcbmlucHV0IFVwZGF0ZUFydGlmYWN0U3RhdHVzSW5wdXRJbnB1dCB7XFxuXFx0YXJ0aWZhY3RJZDogTnVtYmVyIVxcblxcdHN0YXR1czogU3RyaW5nIVxcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcbn1cXG5pbnB1dCBDb25uZWN0R21haWxJbnB1dElucHV0IHtcXG5cXHRtYWlsYm94SWQ6IE51bWJlciFcXG5cXHRhY2Nlc3NUb2tlbjogU3RyaW5nIVxcblxcdHJlZnJlc2hUb2tlbjogU3RyaW5nXFxuXFx0ZXhwaXJlc0F0TXM6IE51bWJlclxcbn1cXG5pbnB1dCBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0IHtcXG5cXHRtYWlsYm94SWQ6IE51bWJlciFcXG5cXHRuYW1lOiBTdHJpbmchXFxuXFx0bWF0Y2hGcm9tUGF0dGVybjogU3RyaW5nIVxcblxcdG1hdGNoU3ViamVjdFJlZ2V4OiBTdHJpbmdcXG5cXHRleHRyYWN0b3JzSnNvbjogU3RyaW5nIVxcblxcdGVuYWJsZWQ6IEJvb2xlYW5cXG5cXHRzb3VyY2VNZXNzYWdlSWQ6IE51bWJlclxcbn1cXG5pbnB1dCBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdG5hbWU6IFN0cmluZ1xcblxcdG1hdGNoRnJvbVBhdHRlcm46IFN0cmluZ1xcblxcdG1hdGNoU3ViamVjdFJlZ2V4OiBTdHJpbmdcXG5cXHRleHRyYWN0b3JzSnNvbjogU3RyaW5nXFxuXFx0ZW5hYmxlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQge1xcblxcdG1lc3NhZ2VJZDogTnVtYmVyIVxcblxcdG5hbWU6IFN0cmluZ1xcblxcdGhpbnRzOiBTdHJpbmdcXG59XFxudHlwZSBRdWVyeSB7XFxubWFpbGJveGVzOiBBbnkhXFxuZG9tYWluRmlsdGVycyhtYWlsYm94SWQ6IE51bWJlciEpOiBBbnkhXFxubWVzc2FnZXMobWFpbGJveElkOiBOdW1iZXIhKTogQW55IVxcbmV4dHJhY3Rpb25BcnRpZmFjdHMobWFpbGJveElkOiBOdW1iZXIsIHN0YXR1czogU3RyaW5nKTogQW55IVxcbnN5bmNSdW5zKG1haWxib3hJZDogTnVtYmVyISk6IEFueSFcXG5wYXJzaW5nVGVtcGxhdGVzKG1haWxib3hJZDogTnVtYmVyISk6IEFueSFcXG59XFxudHlwZSBNdXRhdGlvbiB7XFxuY3JlYXRlTWFpbGJveChpbnB1dDogQ3JlYXRlTWFpbGJveElucHV0SW5wdXQhKTogQ3JlYXRlTWFpbGJveCFcXG5kZWxldGVNYWlsYm94KGlkOiBOdW1iZXIhKTogQm9vbGVhbiFcXG5zZXREb21haW5GaWx0ZXJzKGlucHV0OiBTZXREb21haW5GaWx0ZXJzSW5wdXRJbnB1dCEpOiBBbnkhXFxudHJpZ2dlclN5bmMobWFpbGJveElkOiBOdW1iZXIhKTogQ3JlYXRlTWFpbGJveCFcXG51cGRhdGVBcnRpZmFjdFN0YXR1cyhpbnB1dDogVXBkYXRlQXJ0aWZhY3RTdGF0dXNJbnB1dElucHV0ISk6IFVwZGF0ZUFydGlmYWN0U3RhdHVzIVxcbmNvbm5lY3RHbWFpbChpbnB1dDogQ29ubmVjdEdtYWlsSW5wdXRJbnB1dCEpOiBDcmVhdGVNYWlsYm94IVxcbmNyZWF0ZVBhcnNpbmdUZW1wbGF0ZShpbnB1dDogQ3JlYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXRJbnB1dCEpOiBDcmVhdGVQYXJzaW5nVGVtcGxhdGUhXFxudXBkYXRlUGFyc2luZ1RlbXBsYXRlKGlucHV0OiBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0ISk6IENyZWF0ZVBhcnNpbmdUZW1wbGF0ZSFcXG5kZWxldGVQYXJzaW5nVGVtcGxhdGUoaWQ6IE51bWJlciEpOiBCb29sZWFuIVxcbmdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlKGlucHV0OiBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQhKTogQ3JlYXRlUGFyc2luZ1RlbXBsYXRlIVxcbn1cXG50eXBlIENyZWF0ZU1haWxib3gge1xcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbnByb3ZpZGVyOiBTdHJpbmchXFxubGFiZWw6IFN0cmluZyFcXG5lbmFibGVkOiBCb29sZWFuIVxcbnN5bmNfY3Vyc29yOiBTdHJpbmdcXG5zeW5jX3JlcXVlc3RlZDogQm9vbGVhbiFcXG5sYXN0X3N5bmNlZF9hdDogU3RyaW5nXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBVcGRhdGVBcnRpZmFjdFN0YXR1cyB7XFxuaWQ6IE51bWJlciFcXG5tZXNzYWdlX2lkOiBOdW1iZXIhXFxua2luZDogU3RyaW5nIVxcbnBheWxvYWQ6IFN0cmluZyFcXG5jb25maWRlbmNlOiBOdW1iZXIhXFxuc3RhdHVzOiBTdHJpbmchXFxucHVibGlzaGVkX2V4cGVuc2VfaWQ6IE51bWJlclxcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgQ3JlYXRlUGFyc2luZ1RlbXBsYXRlIHtcXG5pZDogTnVtYmVyIVxcbm1haWxib3hfaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmVuYWJsZWQ6IEJvb2xlYW4hXFxubWF0Y2hfZnJvbV9wYXR0ZXJuOiBTdHJpbmchXFxubWF0Y2hfc3ViamVjdF9yZWdleDogU3RyaW5nXFxuZXh0cmFjdG9yczogU3RyaW5nIVxcbnNvdXJjZV9tZXNzYWdlX2lkOiBOdW1iZXJcXG52ZXJzaW9uOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG59XFxuc2NhbGFyIElEXFxuc2NhbGFyIEludFxcbnNjYWxhciBGbG9hdFxcbnNjYWxhciBOdW1iZXJcXG5zY2FsYXIgQW55XFxuc2NhbGFyIFZvaWRcXG5zY2FsYXIgT2JqZWN0XFxuc2NhbGFyIEZpbGVcXG5zY2FsYXIgRGF0ZVxcbnNjYWxhciBKU09OXFxuc2NhbGFyIFN0cmluZ1xcbnNjYWxhciBCb29sZWFuXFxuXCIsXG4gICAgICAgIGdyYXBocWwsXG4gICAgICAgIHJlc29sdmVyczoge30sXG4gICAgICAgIGNvbmZpZzogX19pbnRlcm5hbFB5bG9uQ29uZmlnXG4gICAgICB9KSlcbiAgICAgICIsICJpbXBvcnQgeyBnZXRDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7XG4gIFNQRU5ESU5HX0NBTkRJREFURV9LSU5ELFxuICBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzLFxuICB0eXBlIFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCxcbn0gZnJvbSAnbWFpbGJveF9raXQvbW9kLnRzJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuLi8uLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHsgTmV3TWFpbGJveCB9IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIEFpQ2xpZW50RXJyb3IsXG4gIGdlbmVyYXRlRW1haWxTcGVuZFRlbXBsYXRlLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9haV9jbGllbnQudHMnXG5pbXBvcnQge1xuICBTcGVuZG1hbmFnZXJTaW5rRXJyb3IsXG4gIHB1Ymxpc2hFeHBlbnNlVG9TcGVuZG1hbmFnZXIsXG59IGZyb20gJy4uLy4uL3NlcnZpY2VzL3NwZW5kbWFuYWdlcl9leHBlbnNlX3NpbmsudHMnXG5pbXBvcnQgeyBhc0lzb1RpbWVzdGFtcCwgYXNJc29UaW1lc3RhbXBPck51bGwgfSBmcm9tICcuLi90aW1lc3RhbXBzLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBDb25uZWN0R21haWxJbnB1dCxcbiAgQ3JlYXRlTWFpbGJveElucHV0LFxuICBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgR2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgU2V0RG9tYWluRmlsdGVyc0lucHV0LFxuICBVcGRhdGVBcnRpZmFjdFN0YXR1c0lucHV0LFxuICBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbn0gZnJvbSAnLi4vdHlwZXMudHMnXG5pbXBvcnQge1xuICBJbnZhbGlkTWFpbGJveEVycm9yLFxuICB2YWxpZGF0ZUFydGlmYWN0U3RhdHVzLFxuICB2YWxpZGF0ZUNhdGVnb3J5SWQsXG4gIHZhbGlkYXRlRG9tYWluUGF0dGVybnMsXG4gIHZhbGlkYXRlTGFiZWwsXG4gIHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybixcbiAgdmFsaWRhdGVQcm92aWRlcixcbiAgdmFsaWRhdGVTdWJqZWN0UmVnZXgsXG4gIHZhbGlkYXRlVGVtcGxhdGVOYW1lLFxufSBmcm9tICcuLi92YWxpZGF0aW9uLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVBdXRob3JpemF0aW9uSGVhZGVyKCk6IHN0cmluZyB7XG4gIGNvbnN0IGN0eCA9IGdldENvbnRleHQoKVxuICBjb25zdCBoZWFkZXIgPSBjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpXG4gIGlmICghaGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWlzc2luZyBBdXRob3JpemF0aW9uIGJlYXJlciB0b2tlbicpXG4gIH1cbiAgcmV0dXJuIGhlYWRlclxufVxuXG5mdW5jdGlvbiBtYXBNYWlsYm94KHJvdzoge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBwcm92aWRlcjogc3RyaW5nXG4gIGxhYmVsOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBzeW5jX2N1cnNvcjogc3RyaW5nIHwgbnVsbFxuICBzeW5jX3JlcXVlc3RlZDogYm9vbGVhblxuICBsYXN0X3N5bmNlZF9hdDogRGF0ZSB8IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KSB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICB1c2VyX2lkOiByb3cudXNlcl9pZCxcbiAgICBwcm92aWRlcjogcm93LnByb3ZpZGVyLFxuICAgIGxhYmVsOiByb3cubGFiZWwsXG4gICAgZW5hYmxlZDogcm93LmVuYWJsZWQsXG4gICAgc3luY19jdXJzb3I6IHJvdy5zeW5jX2N1cnNvcixcbiAgICBzeW5jX3JlcXVlc3RlZDogcm93LnN5bmNfcmVxdWVzdGVkLFxuICAgIGxhc3Rfc3luY2VkX2F0OiBhc0lzb1RpbWVzdGFtcE9yTnVsbChyb3cubGFzdF9zeW5jZWRfYXQpLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgICB1cGRhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cudXBkYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwRG9tYWluRmlsdGVyKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwYXR0ZXJuOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSkge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwTWVzc2FnZShyb3c6IHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHRleHRfYm9keT86IHN0cmluZyB8IG51bGxcbiAgaHRtbF9ib2R5Pzogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KSB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtYWlsYm94X2lkOiByb3cubWFpbGJveF9pZCxcbiAgICBwcm92aWRlcl9tZXNzYWdlX2lkOiByb3cucHJvdmlkZXJfbWVzc2FnZV9pZCxcbiAgICByZmNfbWVzc2FnZV9pZDogcm93LnJmY19tZXNzYWdlX2lkLFxuICAgIGZyb21fYWRkcmVzczogcm93LmZyb21fYWRkcmVzcyxcbiAgICBzdWJqZWN0OiByb3cuc3ViamVjdCxcbiAgICByZWNlaXZlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnJlY2VpdmVkX2F0KSxcbiAgICB0ZXh0X2JvZHk6IHJvdy50ZXh0X2JvZHkgPz8gbnVsbCxcbiAgICBodG1sX2JvZHk6IHJvdy5odG1sX2JvZHkgPz8gbnVsbCxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwQXJ0aWZhY3Qocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgbWVzc2FnZV9pZDogbnVtYmVyXG4gIGtpbmQ6IHN0cmluZ1xuICBwYXlsb2FkOiB1bmtub3duXG4gIGNvbmZpZGVuY2U6IG51bWJlclxuICBzdGF0dXM6IHN0cmluZ1xuICBwdWJsaXNoZWRfZXhwZW5zZV9pZD86IG51bWJlciB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KSB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtZXNzYWdlX2lkOiByb3cubWVzc2FnZV9pZCxcbiAgICBraW5kOiByb3cua2luZCxcbiAgICBwYXlsb2FkOlxuICAgICAgdHlwZW9mIHJvdy5wYXlsb2FkID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHJvdy5wYXlsb2FkXG4gICAgICAgIDogSlNPTi5zdHJpbmdpZnkocm93LnBheWxvYWQgPz8ge30pLFxuICAgIGNvbmZpZGVuY2U6IHJvdy5jb25maWRlbmNlLFxuICAgIHN0YXR1czogcm93LnN0YXR1cyxcbiAgICBwdWJsaXNoZWRfZXhwZW5zZV9pZDogcm93LnB1Ymxpc2hlZF9leHBlbnNlX2lkID8/IG51bGwsXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICAgIHVwZGF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy51cGRhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBTeW5jUnVuKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBzdGFydGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIGZpbmlzaGVkX2F0OiBEYXRlIHwgc3RyaW5nIHwgbnVsbFxuICBmZXRjaGVkX2NvdW50OiBudW1iZXJcbiAgZXh0cmFjdGVkX2NvdW50OiBudW1iZXJcbiAgZXJyb3JfdGV4dDogc3RyaW5nIHwgbnVsbFxufSkge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBzdGFydGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuc3RhcnRlZF9hdCksXG4gICAgZmluaXNoZWRfYXQ6IGFzSXNvVGltZXN0YW1wT3JOdWxsKHJvdy5maW5pc2hlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwUGFyc2luZ1RlbXBsYXRlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hfc3ViamVjdF9yZWdleDogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiB1bmtub3duXG4gIHNvdXJjZV9tZXNzYWdlX2lkOiBudW1iZXIgfCBudWxsXG4gIHZlcnNpb246IG51bWJlclxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHVzZXJfaWQ6IHJvdy51c2VyX2lkLFxuICAgIG5hbWU6IHJvdy5uYW1lLFxuICAgIGVuYWJsZWQ6IHJvdy5lbmFibGVkLFxuICAgIG1hdGNoX2Zyb21fcGF0dGVybjogcm93Lm1hdGNoX2Zyb21fcGF0dGVybixcbiAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiByb3cubWF0Y2hfc3ViamVjdF9yZWdleCxcbiAgICBleHRyYWN0b3JzOlxuICAgICAgdHlwZW9mIHJvdy5leHRyYWN0b3JzID09PSAnc3RyaW5nJ1xuICAgICAgICA/IHJvdy5leHRyYWN0b3JzXG4gICAgICAgIDogSlNPTi5zdHJpbmdpZnkocm93LmV4dHJhY3RvcnMgPz8ge30pLFxuICAgIHNvdXJjZV9tZXNzYWdlX2lkOiByb3cuc291cmNlX21lc3NhZ2VfaWQsXG4gICAgdmVyc2lvbjogcm93LnZlcnNpb24sXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICAgIHVwZGF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy51cGRhdGVkX2F0KSxcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZDogbnVtYmVyLCBtYWlsYm94SWQ6IG51bWJlcikge1xuICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdtYWlsYm94ZXMnKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC53aGVyZSgnaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gIGlmICghcm93KSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWFpbGJveCBub3QgZm91bmQnKVxuICByZXR1cm4gcm93XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXh0cmFjdG9yc0pzb24ocmF3OiBzdHJpbmcpIHtcbiAgbGV0IHBhcnNlZDogdW5rbm93blxuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KVxuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignZXh0cmFjdG9yc0pzb24gbXVzdCBiZSB2YWxpZCBKU09OJylcbiAgfVxuICBjb25zdCBleHRyYWN0b3JzID0gcGFyc2VTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyhwYXJzZWQpXG4gIGlmICghZXh0cmFjdG9ycykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdleHRyYWN0b3JzSnNvbiBoYXMgaW52YWxpZCBzaGFwZScpXG4gIH1cbiAgcmV0dXJuIGV4dHJhY3RvcnNcbn1cblxuZnVuY3Rpb24gYXNTcGVuZGluZ1BheWxvYWQocGF5bG9hZDogdW5rbm93bik6IFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCB8IG51bGwge1xuICBjb25zdCBvYmogPSB0eXBlb2YgcGF5bG9hZCA9PT0gJ3N0cmluZydcbiAgICA/ICgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShwYXlsb2FkKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsXG4gICAgICB9XG4gICAgfSkoKVxuICAgIDogcGF5bG9hZFxuICBpZiAob2JqID09PSBudWxsIHx8IHR5cGVvZiBvYmogIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkob2JqKSkgcmV0dXJuIG51bGxcbiAgY29uc3QgcCA9IG9iaiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBpZiAodHlwZW9mIHAuYW1vdW50Q2VudHMgIT09ICdudW1iZXInIHx8IHR5cGVvZiBwLnNwZW50T24gIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICByZXR1cm4ge1xuICAgIGFtb3VudENlbnRzOiBwLmFtb3VudENlbnRzLFxuICAgIGN1cnJlbmN5OiB0eXBlb2YgcC5jdXJyZW5jeSA9PT0gJ3N0cmluZycgPyBwLmN1cnJlbmN5IDogJ1VTRCcsXG4gICAgc3BlbnRPbjogcC5zcGVudE9uLFxuICAgIG1lcmNoYW50OiB0eXBlb2YgcC5tZXJjaGFudCA9PT0gJ3N0cmluZycgPyBwLm1lcmNoYW50IDogbnVsbCxcbiAgICBub3RlOiB0eXBlb2YgcC5ub3RlID09PSAnc3RyaW5nJyA/IHAubm90ZSA6IG51bGwsXG4gICAgc291cmNlU3ViamVjdDogdHlwZW9mIHAuc291cmNlU3ViamVjdCA9PT0gJ3N0cmluZycgPyBwLnNvdXJjZVN1YmplY3QgOiAnJyxcbiAgICBzb3VyY2VGcm9tOiB0eXBlb2YgcC5zb3VyY2VGcm9tID09PSAnc3RyaW5nJyA/IHAuc291cmNlRnJvbSA6ICcnLFxuICAgIHB1Ymxpc2hlZEV4cGVuc2VJZDpcbiAgICAgIHR5cGVvZiBwLnB1Ymxpc2hlZEV4cGVuc2VJZCA9PT0gJ251bWJlcicgPyBwLnB1Ymxpc2hlZEV4cGVuc2VJZCA6IG51bGwsXG4gICAgdGVtcGxhdGVJZDogdHlwZW9mIHAudGVtcGxhdGVJZCA9PT0gJ251bWJlcicgPyBwLnRlbXBsYXRlSWQgOiBudWxsLFxuICB9XG59XG5cbmNvbnN0IFF1ZXJ5ID0ge1xuICBhc3luYyBtYWlsYm94ZXMoKSB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWFpbGJveGVzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwTWFpbGJveClcbiAgfSxcblxuICBhc3luYyBkb21haW5GaWx0ZXJzKG1haWxib3hJZDogbnVtYmVyKSB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIG1haWxib3hJZClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdkb21haW5fZmlsdGVycycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2FzYycpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcERvbWFpbkZpbHRlcilcbiAgfSxcblxuICBhc3luYyBtZXNzYWdlcyhtYWlsYm94SWQ6IG51bWJlcikge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdyZWNlaXZlZF9hdCcsICdkZXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwTWVzc2FnZSlcbiAgfSxcblxuICBhc3luYyBleHRyYWN0aW9uQXJ0aWZhY3RzKG1haWxib3hJZD86IG51bWJlciB8IG51bGwsIHN0YXR1cz86IHN0cmluZyB8IG51bGwpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBsZXQgcSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgLmlubmVySm9pbignbWVzc2FnZXMnLCAnbWVzc2FnZXMuaWQnLCAnZXh0cmFjdGlvbl9hcnRpZmFjdHMubWVzc2FnZV9pZCcpXG4gICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgLnNlbGVjdEFsbCgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuXG4gICAgaWYgKG1haWxib3hJZCAhPSBudWxsKSB7XG4gICAgICBxID0gcS53aGVyZSgnbWVzc2FnZXMubWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgIH1cbiAgICBpZiAoc3RhdHVzICE9IG51bGwgJiYgc3RhdHVzICE9PSAnJykge1xuICAgICAgcSA9IHEud2hlcmUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLnN0YXR1cycsICc9JywgdmFsaWRhdGVBcnRpZmFjdFN0YXR1cyhzdGF0dXMpKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxLm9yZGVyQnkoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLmlkJywgJ2Rlc2MnKS5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwQXJ0aWZhY3QpXG4gIH0sXG5cbiAgYXN5bmMgc3luY1J1bnMobWFpbGJveElkOiBudW1iZXIpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3N5bmNfcnVucycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KDUwKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBTeW5jUnVuKVxuICB9LFxuXG4gIGFzeW5jIHBhcnNpbmdUZW1wbGF0ZXMobWFpbGJveElkOiBudW1iZXIpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBQYXJzaW5nVGVtcGxhdGUpXG4gIH0sXG59XG5cbmNvbnN0IE11dGF0aW9uID0ge1xuICBhc3luYyBjcmVhdGVNYWlsYm94KGlucHV0OiBDcmVhdGVNYWlsYm94SW5wdXQpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBwcm92aWRlciA9IHZhbGlkYXRlUHJvdmlkZXIoaW5wdXQucHJvdmlkZXIpXG4gICAgY29uc3QgbGFiZWwgPSB2YWxpZGF0ZUxhYmVsKGlucHV0LmxhYmVsKVxuICAgIGNvbnN0IHBhdHRlcm5zID0gdmFsaWRhdGVEb21haW5QYXR0ZXJucyhpbnB1dC5kb21haW5GaWx0ZXJzID8/IFtdKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3QgdmFsdWVzOiBOZXdNYWlsYm94ID0ge1xuICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgcHJvdmlkZXIsXG4gICAgICBsYWJlbCxcbiAgICAgIGVuYWJsZWQ6IGlucHV0LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgIHN5bmNfY3Vyc29yOiBudWxsLFxuICAgICAgc3luY19yZXF1ZXN0ZWQ6IHRydWUsXG4gICAgICBvYXV0aF90b2tlbnNfanNvbjogaW5wdXQub2F1dGhUb2tlbnNKc29uID8/IG51bGwsXG4gICAgICBsYXN0X3N5bmNlZF9hdDogbnVsbCxcbiAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICB9XG5cbiAgICBjb25zdCBtYWlsYm94ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdtYWlsYm94ZXMnKVxuICAgICAgLnZhbHVlcyh2YWx1ZXMpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBpZiAocGF0dGVybnMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2RvbWFpbl9maWx0ZXJzJylcbiAgICAgICAgLnZhbHVlcyhcbiAgICAgICAgICBwYXR0ZXJucy5tYXAoKHBhdHRlcm4pID0+ICh7XG4gICAgICAgICAgICBtYWlsYm94X2lkOiBtYWlsYm94LmlkLFxuICAgICAgICAgICAgcGF0dGVybixcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KSksXG4gICAgICAgIClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgIH1cblxuICAgIHJldHVybiBtYXBNYWlsYm94KG1haWxib3gpXG4gIH0sXG5cbiAgYXN5bmMgZGVsZXRlTWFpbGJveChpZDogbnVtYmVyKSB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdtYWlsYm94ZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gTnVtYmVyKHJlc3VsdC5udW1EZWxldGVkUm93cyA/PyAwKSA+IDBcbiAgfSxcblxuICBhc3luYyBzZXREb21haW5GaWx0ZXJzKGlucHV0OiBTZXREb21haW5GaWx0ZXJzSW5wdXQpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGNvbnN0IHBhdHRlcm5zID0gdmFsaWRhdGVEb21haW5QYXR0ZXJucyhpbnB1dC5wYXR0ZXJucylcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBpZiAocGF0dGVybnMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2RvbWFpbl9maWx0ZXJzJylcbiAgICAgICAgLnZhbHVlcyhcbiAgICAgICAgICBwYXR0ZXJucy5tYXAoKHBhdHRlcm4pID0+ICh7XG4gICAgICAgICAgICBtYWlsYm94X2lkOiBpbnB1dC5tYWlsYm94SWQsXG4gICAgICAgICAgICBwYXR0ZXJuLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIGlucHV0Lm1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBEb21haW5GaWx0ZXIpXG4gIH0sXG5cbiAgYXN5bmMgdHJpZ2dlclN5bmMobWFpbGJveElkOiBudW1iZXIpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ21haWxib3hlcycpXG4gICAgICAuc2V0KHsgc3luY19yZXF1ZXN0ZWQ6IHRydWUsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcE1haWxib3gocm93KVxuICB9LFxuXG4gIGFzeW5jIHVwZGF0ZUFydGlmYWN0U3RhdHVzKGlucHV0OiBVcGRhdGVBcnRpZmFjdFN0YXR1c0lucHV0KSB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgc3RhdHVzID0gdmFsaWRhdGVBcnRpZmFjdFN0YXR1cyhpbnB1dC5zdGF0dXMpXG4gICAgY29uc3Qgb3duZWQgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC5pbm5lckpvaW4oJ21lc3NhZ2VzJywgJ21lc3NhZ2VzLmlkJywgJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLm1lc3NhZ2VfaWQnKVxuICAgICAgLmlubmVySm9pbignbWFpbGJveGVzJywgJ21haWxib3hlcy5pZCcsICdtZXNzYWdlcy5tYWlsYm94X2lkJylcbiAgICAgIC5zZWxlY3RBbGwoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuaWQnLCAnPScsIGlucHV0LmFydGlmYWN0SWQpXG4gICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIW93bmVkKSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignYXJ0aWZhY3Qgbm90IGZvdW5kJylcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgaWYgKHN0YXR1cyA9PT0gJ3JlamVjdGVkJykge1xuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXMsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gICAgfVxuXG4gICAgaWYgKHN0YXR1cyA9PT0gJ2FjY2VwdGVkJykge1xuICAgICAgaWYgKG93bmVkLmtpbmQgPT09IFNQRU5ESU5HX0NBTkRJREFURV9LSU5EKSB7XG4gICAgICAgIGlmIChvd25lZC5wdWJsaXNoZWRfZXhwZW5zZV9pZCAhPSBudWxsKSB7XG4gICAgICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAgICAgLnNldCh7IHN0YXR1czogJ2FjY2VwdGVkJywgdXBkYXRlZF9hdDogbm93IH0pXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjYXRlZ29yeUlkID0gdmFsaWRhdGVDYXRlZ29yeUlkKGlucHV0LmNhdGVnb3J5SWQpXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGFzU3BlbmRpbmdQYXlsb2FkKG93bmVkLnBheWxvYWQpXG4gICAgICAgIGlmICghY2FuZGlkYXRlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2FydGlmYWN0IHBheWxvYWQgaXMgbm90IGEgc3BlbmRpbmcgY2FuZGlkYXRlJylcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcHVibGlzaGVkID0gYXdhaXQgcHVibGlzaEV4cGVuc2VUb1NwZW5kbWFuYWdlcihcbiAgICAgICAgICAgIGNhbmRpZGF0ZSxcbiAgICAgICAgICAgIGNhdGVnb3J5SWQsXG4gICAgICAgICAgICByZXF1aXJlQXV0aG9yaXphdGlvbkhlYWRlcigpLFxuICAgICAgICAgIClcbiAgICAgICAgICBjb25zdCBuZXh0UGF5bG9hZCA9IHtcbiAgICAgICAgICAgIC4uLmNhbmRpZGF0ZSxcbiAgICAgICAgICAgIHB1Ymxpc2hlZEV4cGVuc2VJZDogcHVibGlzaGVkLmV4cGVuc2VJZCxcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAgICAgLnNldCh7XG4gICAgICAgICAgICAgIHN0YXR1czogJ2FjY2VwdGVkJyxcbiAgICAgICAgICAgICAgcHVibGlzaGVkX2V4cGVuc2VfaWQ6IHB1Ymxpc2hlZC5leHBlbnNlSWQsXG4gICAgICAgICAgICAgIHBheWxvYWQ6IG5leHRQYXlsb2FkLFxuICAgICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgICAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgU3BlbmRtYW5hZ2VyU2lua0Vycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgICAgICAgICAgYGZhaWxlZCB0byBwdWJsaXNoIGV4cGVuc2U6ICR7ZXJyLm1lc3NhZ2V9YCxcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXM6ICdhY2NlcHRlZCcsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gICAgfVxuXG4gICAgLy8gcGVuZGluZyAvIG90aGVyXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgLnNldCh7IHN0YXR1cywgdXBkYXRlZF9hdDogbm93IH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gIH0sXG5cbiAgYXN5bmMgY29ubmVjdEdtYWlsKGlucHV0OiBDb25uZWN0R21haWxJbnB1dCkge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG1haWxib3ggPSBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGlmIChtYWlsYm94LnByb3ZpZGVyICE9PSAnZ21haWwnKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWFpbGJveCBwcm92aWRlciBpcyBub3QgZ21haWwnKVxuICAgIH1cbiAgICBpZiAoIWlucHV0LmFjY2Vzc1Rva2VuLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2FjY2Vzc1Rva2VuIGlzIHJlcXVpcmVkJylcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbnMgPSB7XG4gICAgICBhY2Nlc3NUb2tlbjogaW5wdXQuYWNjZXNzVG9rZW4udHJpbSgpLFxuICAgICAgcmVmcmVzaFRva2VuOiBpbnB1dC5yZWZyZXNoVG9rZW4gPz8gbnVsbCxcbiAgICAgIGV4cGlyZXNBdE1zOiBpbnB1dC5leHBpcmVzQXRNcyA/PyBudWxsLFxuICAgIH1cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdtYWlsYm94ZXMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIG9hdXRoX3Rva2Vuc19qc29uOiBKU09OLnN0cmluZ2lmeSh0b2tlbnMpLFxuICAgICAgICBzeW5jX3JlcXVlc3RlZDogdHJ1ZSxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIG1haWxib3guaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcE1haWxib3gocm93KVxuICB9LFxuXG4gIGFzeW5jIGNyZWF0ZVBhcnNpbmdUZW1wbGF0ZShpbnB1dDogQ3JlYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXQpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZVRlbXBsYXRlTmFtZShpbnB1dC5uYW1lKVxuICAgIGNvbnN0IG1hdGNoRnJvbVBhdHRlcm4gPSB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4oaW5wdXQubWF0Y2hGcm9tUGF0dGVybilcbiAgICBjb25zdCBtYXRjaFN1YmplY3RSZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGlucHV0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgIGNvbnN0IGV4dHJhY3RvcnMgPSBwYXJzZUV4dHJhY3RvcnNKc29uKGlucHV0LmV4dHJhY3RvcnNKc29uKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgaWYgKGlucHV0LnNvdXJjZU1lc3NhZ2VJZCAhPSBudWxsKSB7XG4gICAgICBjb25zdCBtc2cgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgICAuc2VsZWN0KCdtZXNzYWdlcy5pZCcpXG4gICAgICAgIC53aGVyZSgnbWVzc2FnZXMuaWQnLCAnPScsIGlucHV0LnNvdXJjZU1lc3NhZ2VJZClcbiAgICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAud2hlcmUoJ21lc3NhZ2VzLm1haWxib3hfaWQnLCAnPScsIGlucHV0Lm1haWxib3hJZClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgaWYgKCFtc2cpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdzb3VyY2UgbWVzc2FnZSBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIG1haWxib3hfaWQ6IGlucHV0Lm1haWxib3hJZCxcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIG1hdGNoX2Zyb21fcGF0dGVybjogbWF0Y2hGcm9tUGF0dGVybixcbiAgICAgICAgbWF0Y2hfc3ViamVjdF9yZWdleDogbWF0Y2hTdWJqZWN0UmVnZXgsXG4gICAgICAgIGV4dHJhY3RvcnMsXG4gICAgICAgIHNvdXJjZV9tZXNzYWdlX2lkOiBpbnB1dC5zb3VyY2VNZXNzYWdlSWQgPz8gbnVsbCxcbiAgICAgICAgdmVyc2lvbjogMSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBQYXJzaW5nVGVtcGxhdGUocm93KVxuICB9LFxuXG4gIGFzeW5jIHVwZGF0ZVBhcnNpbmdUZW1wbGF0ZShpbnB1dDogVXBkYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXQpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghZXhpc3RpbmcpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCd0ZW1wbGF0ZSBub3QgZm91bmQnKVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3QgcGF0Y2g6IHtcbiAgICAgIG5hbWU/OiBzdHJpbmdcbiAgICAgIG1hdGNoX2Zyb21fcGF0dGVybj86IHN0cmluZ1xuICAgICAgbWF0Y2hfc3ViamVjdF9yZWdleD86IHN0cmluZyB8IG51bGxcbiAgICAgIGV4dHJhY3RvcnM/OiBSZXR1cm5UeXBlPHR5cGVvZiBwYXJzZUV4dHJhY3RvcnNKc29uPlxuICAgICAgZW5hYmxlZD86IGJvb2xlYW5cbiAgICAgIHZlcnNpb246IG51bWJlclxuICAgICAgdXBkYXRlZF9hdDogc3RyaW5nXG4gICAgfSA9IHtcbiAgICAgIHZlcnNpb246IGV4aXN0aW5nLnZlcnNpb24gKyAxLFxuICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgIH1cblxuICAgIGlmIChpbnB1dC5uYW1lICE9IG51bGwpIHBhdGNoLm5hbWUgPSB2YWxpZGF0ZVRlbXBsYXRlTmFtZShpbnB1dC5uYW1lKVxuICAgIGlmIChpbnB1dC5tYXRjaEZyb21QYXR0ZXJuICE9IG51bGwpIHtcbiAgICAgIHBhdGNoLm1hdGNoX2Zyb21fcGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihpbnB1dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgIH1cbiAgICBpZiAoaW5wdXQubWF0Y2hTdWJqZWN0UmVnZXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0Y2gubWF0Y2hfc3ViamVjdF9yZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGlucHV0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgIH1cbiAgICBpZiAoaW5wdXQuZXh0cmFjdG9yc0pzb24gIT0gbnVsbCkge1xuICAgICAgcGF0Y2guZXh0cmFjdG9ycyA9IHBhcnNlRXh0cmFjdG9yc0pzb24oaW5wdXQuZXh0cmFjdG9yc0pzb24pXG4gICAgfVxuICAgIGlmIChpbnB1dC5lbmFibGVkICE9IG51bGwpIHBhdGNoLmVuYWJsZWQgPSBpbnB1dC5lbmFibGVkXG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAuc2V0KHBhdGNoKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcFBhcnNpbmdUZW1wbGF0ZShyb3cpXG4gIH0sXG5cbiAgYXN5bmMgZGVsZXRlUGFyc2luZ1RlbXBsYXRlKGlkOiBudW1iZXIpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgcmV0dXJuIE51bWJlcihyZXN1bHQubnVtRGVsZXRlZFJvd3MgPz8gMCkgPiAwXG4gIH0sXG5cbiAgYXN5bmMgZ2VuZXJhdGVQYXJzaW5nVGVtcGxhdGUoaW5wdXQ6IEdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXQpIHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBtZXNzYWdlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdtZXNzYWdlcycpXG4gICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgLnNlbGVjdChbXG4gICAgICAgICdtZXNzYWdlcy5pZCcsXG4gICAgICAgICdtZXNzYWdlcy5tYWlsYm94X2lkJyxcbiAgICAgICAgJ21lc3NhZ2VzLmZyb21fYWRkcmVzcycsXG4gICAgICAgICdtZXNzYWdlcy5zdWJqZWN0JyxcbiAgICAgICAgJ21lc3NhZ2VzLnRleHRfYm9keScsXG4gICAgICAgICdtZXNzYWdlcy5odG1sX2JvZHknLFxuICAgICAgXSlcbiAgICAgIC53aGVyZSgnbWVzc2FnZXMuaWQnLCAnPScsIGlucHV0Lm1lc3NhZ2VJZClcbiAgICAgIC53aGVyZSgnbWFpbGJveGVzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIGlmICghbWVzc2FnZSkgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ21lc3NhZ2Ugbm90IGZvdW5kJylcbiAgICBpZiAoIW1lc3NhZ2UudGV4dF9ib2R5ICYmICFtZXNzYWdlLmh0bWxfYm9keSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICAgICdtZXNzYWdlIGhhcyBubyBzdG9yZWQgYm9keTsgcmUtc3luYyBhZnRlciB1cGdyYWRpbmcgbWFpbGJveCcsXG4gICAgICApXG4gICAgfVxuXG4gICAgbGV0IGFpT3V0XG4gICAgdHJ5IHtcbiAgICAgIGFpT3V0ID0gYXdhaXQgZ2VuZXJhdGVFbWFpbFNwZW5kVGVtcGxhdGUoe1xuICAgICAgICBmcm9tOiBtZXNzYWdlLmZyb21fYWRkcmVzcyxcbiAgICAgICAgc3ViamVjdDogbWVzc2FnZS5zdWJqZWN0LFxuICAgICAgICB0ZXh0Qm9keTogbWVzc2FnZS50ZXh0X2JvZHksXG4gICAgICAgIGh0bWxCb2R5OiBtZXNzYWdlLmh0bWxfYm9keSxcbiAgICAgICAgaGludHM6IGlucHV0LmhpbnRzLFxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBBaUNsaWVudEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKGBBSSB0ZW1wbGF0ZSBnZW5lcmF0aW9uIGZhaWxlZDogJHtlcnIubWVzc2FnZX1gKVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hGcm9tUGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihhaU91dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgIGNvbnN0IG1hdGNoU3ViamVjdFJlZ2V4ID0gdmFsaWRhdGVTdWJqZWN0UmVnZXgoYWlPdXQubWF0Y2hTdWJqZWN0UmVnZXgpXG4gICAgY29uc3QgZXh0cmFjdG9ycyA9IHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMoYWlPdXQuZXh0cmFjdG9ycylcbiAgICBpZiAoIWV4dHJhY3RvcnMpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdBSSByZXR1cm5lZCBpbnZhbGlkIGV4dHJhY3RvcnMnKVxuICAgIH1cblxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZVRlbXBsYXRlTmFtZShcbiAgICAgIGlucHV0Lm5hbWU/LnRyaW0oKSB8fCBhaU91dC5uYW1lU3VnZ2VzdGlvbiB8fCAnU3BlbmRpbmcgdGVtcGxhdGUnLFxuICAgIClcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIG1haWxib3hfaWQ6IG1lc3NhZ2UubWFpbGJveF9pZCxcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBtYXRjaF9mcm9tX3BhdHRlcm46IG1hdGNoRnJvbVBhdHRlcm4sXG4gICAgICAgIG1hdGNoX3N1YmplY3RfcmVnZXg6IG1hdGNoU3ViamVjdFJlZ2V4LFxuICAgICAgICBleHRyYWN0b3JzLFxuICAgICAgICBzb3VyY2VfbWVzc2FnZV9pZDogbWVzc2FnZS5pZCxcbiAgICAgICAgdmVyc2lvbjogMSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBQYXJzaW5nVGVtcGxhdGUocm93KVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgcmVzb2x2ZXJzID0geyBRdWVyeSwgTXV0YXRpb24gfVxuIiwgIi8qKiBOb3JtYWxpemVkIGVtYWlsIHVzZWQgYnkgdGhlIGV4dHJhY3QgcGlwZWxpbmUuICovXG5leHBvcnQgaW50ZXJmYWNlIEVtYWlsTWVzc2FnZSB7XG4gIC8qKiBQcm92aWRlci1zcGVjaWZpYyBpZCAoR21haWwgbWVzc2FnZSBpZCwgZml4dHVyZSBpZCwgZXRjLikuICovXG4gIGlkOiBzdHJpbmdcbiAgLyoqIFJGQyA1MzIyIE1lc3NhZ2UtSUQgd2hlbiBhdmFpbGFibGU7IHVzZWQgZm9yIGlkZW1wb3RlbmN5LiAqL1xuICByZmNNZXNzYWdlSWQ6IHN0cmluZ1xuICBmcm9tOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkQXQ6IERhdGVcbiAgdGV4dEJvZHk6IHN0cmluZyB8IG51bGxcbiAgaHRtbEJvZHk6IHN0cmluZyB8IG51bGxcbn1cblxuLyoqIE9wYXF1ZSBzeW5jIGN1cnNvciByZXR1cm5lZCBieSBhIE1haWxib3hQcm92aWRlci4gKi9cbmV4cG9ydCB0eXBlIFN5bmNDdXJzb3IgPSBzdHJpbmcgfCBudWxsXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGlzdE1lc3NhZ2VzUmVzdWx0IHtcbiAgbWVzc2FnZXM6IEVtYWlsTWVzc2FnZVtdXG4gIC8qKiBDdXJzb3IgdG8gcGVyc2lzdCBhZnRlciBhIHN1Y2Nlc3NmdWwgc3luYy4gKi9cbiAgbmV4dEN1cnNvcjogU3luY0N1cnNvclxufVxuXG5leHBvcnQgdHlwZSBBcnRpZmFjdFN0YXR1cyA9ICdwZW5kaW5nJyB8ICdhY2NlcHRlZCcgfCAncmVqZWN0ZWQnXG5cbi8qKiBEb21haW4tYWdub3N0aWMgZXh0cmFjdGlvbiByZXN1bHQgKG5vdCBhIHNwZW5kbWFuYWdlciBleHBlbnNlKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdGlvbkFydGlmYWN0IHtcbiAga2luZDogc3RyaW5nXG4gIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGNvbmZpZGVuY2U6IG51bWJlclxufVxuXG4vKiogUGF5bG9hZCBzaGFwZSBmb3IgU3BlbmRpbmdFeHRyYWN0b3IgKGBraW5kOiBcInNwZW5kaW5nLmNhbmRpZGF0ZVwiYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCB7XG4gIGFtb3VudENlbnRzOiBudW1iZXJcbiAgY3VycmVuY3k6IHN0cmluZ1xuICBzcGVudE9uOiBzdHJpbmdcbiAgbWVyY2hhbnQ6IHN0cmluZyB8IG51bGxcbiAgbm90ZTogc3RyaW5nIHwgbnVsbFxuICBzb3VyY2VTdWJqZWN0OiBzdHJpbmdcbiAgc291cmNlRnJvbTogc3RyaW5nXG4gIC8qKiBTZXQgd2hlbiBwdWJsaXNoZWQgdG8gc3BlbmRtYW5hZ2VyLiAqL1xuICBwdWJsaXNoZWRFeHBlbnNlSWQ/OiBudW1iZXIgfCBudWxsXG4gIC8qKiBQYXJzaW5nIHRlbXBsYXRlIGlkIHdoZW4gZXh0cmFjdGVkIHZpYSBhIHRlbXBsYXRlLiAqL1xuICB0ZW1wbGF0ZUlkPzogbnVtYmVyIHwgbnVsbFxufVxuXG5leHBvcnQgY29uc3QgU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQgPSAnc3BlbmRpbmcuY2FuZGlkYXRlJyBhcyBjb25zdFxuXG4vKiogRGV0ZXJtaW5pc3RpYyBmaWVsZCBleHRyYWN0b3IgdXNlZCBieSBwYXJzaW5nIHRlbXBsYXRlcy4gKi9cbmV4cG9ydCB0eXBlIEZpZWxkRXh0cmFjdG9yID1cbiAgfCB7XG4gICAgc291cmNlOiAnc3ViamVjdCcgfCAndGV4dCcgfCAnaHRtbF90ZXh0J1xuICAgIHJlZ2V4OiBzdHJpbmdcbiAgICBncm91cDogbnVtYmVyXG4gIH1cbiAgfCB7IHNvdXJjZTogJ2Zyb21fZG9tYWluJyB9XG4gIHwgeyBzb3VyY2U6ICdjb25zdGFudCc7IHZhbHVlOiBzdHJpbmcgfVxuXG4vKiogRmllbGQgbWFwIHN0b3JlZCBpbiBgcGFyc2luZ190ZW1wbGF0ZXMuZXh0cmFjdG9yc2AgSlNPTkIuICovXG5leHBvcnQgdHlwZSBTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyA9IHtcbiAgYW1vdW50OiBGaWVsZEV4dHJhY3RvclxuICBjdXJyZW5jeT86IEZpZWxkRXh0cmFjdG9yIHwgbnVsbFxuICBzcGVudE9uPzogRmllbGRFeHRyYWN0b3IgfCBudWxsXG4gIG1lcmNoYW50PzogRmllbGRFeHRyYWN0b3IgfCBudWxsXG4gIG5vdGU/OiBGaWVsZEV4dHJhY3RvciB8IG51bGxcbn1cblxuLyoqIFJ1bnRpbWUgZGVmaW5pdGlvbiBmb3IgYSBtYWlsYm94IHBhcnNpbmcgdGVtcGxhdGUuICovXG5leHBvcnQgdHlwZSBTcGVuZFBhcnNpbmdUZW1wbGF0ZSA9IHtcbiAgaWQ6IG51bWJlclxuICBtYXRjaEZyb21QYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hTdWJqZWN0UmVnZXg/OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IFNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzXG4gIGVuYWJsZWQ/OiBib29sZWFuXG59XG4iLCAiaW1wb3J0IHsgbWF0Y2hlc0Zyb21QYXR0ZXJuLCBub3JtYWxpemVGcm9tIH0gZnJvbSAnLi4vZG9tYWluX2ZpbHRlci50cydcbmltcG9ydCB0eXBlIHsgRXh0cmFjdG9yIH0gZnJvbSAnLi4vZXh0cmFjdG9yLnRzJ1xuaW1wb3J0IHtcbiAgU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQsXG4gIHR5cGUgRW1haWxNZXNzYWdlLFxuICB0eXBlIEV4dHJhY3Rpb25BcnRpZmFjdCxcbiAgdHlwZSBGaWVsZEV4dHJhY3RvcixcbiAgdHlwZSBTcGVuZFBhcnNpbmdUZW1wbGF0ZSxcbiAgdHlwZSBTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyxcbiAgdHlwZSBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuXG4vKipcbiAqIERldGVybWluaXN0aWMgc3BlbmRpbmcgZXh0cmFjdG9yIGRyaXZlbiBieSBhIHVzZXIvQUktZ2VuZXJhdGVkIHRlbXBsYXRlLlxuICogTm8gTExNIGNhbGxzIFx1MjAxNCByZWdleCAvIGNvbnN0YW50IC8gZnJvbV9kb21haW4gb25seS5cbiAqL1xuZXhwb3J0IGNsYXNzIFRlbXBsYXRlU3BlbmRpbmdFeHRyYWN0b3IgaW1wbGVtZW50cyBFeHRyYWN0b3Ige1xuICByZWFkb25seSBraW5kID0gU1BFTkRJTkdfQ0FORElEQVRFX0tJTkRcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHRlbXBsYXRlOiBTcGVuZFBhcnNpbmdUZW1wbGF0ZSkge31cblxuICBnZXQgdGVtcGxhdGVJZCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnRlbXBsYXRlLmlkXG4gIH1cblxuICBjYW5IYW5kbGUobWVzc2FnZTogRW1haWxNZXNzYWdlKTogYm9vbGVhbiB7XG4gICAgaWYgKHRoaXMudGVtcGxhdGUuZW5hYmxlZCA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICAgIGlmICghbWF0Y2hlc0Zyb21QYXR0ZXJuKG1lc3NhZ2UuZnJvbSwgdGhpcy50ZW1wbGF0ZS5tYXRjaEZyb21QYXR0ZXJuKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIGNvbnN0IHN1YmplY3RSZSA9IHRoaXMudGVtcGxhdGUubWF0Y2hTdWJqZWN0UmVnZXg/LnRyaW0oKVxuICAgIGlmIChzdWJqZWN0UmUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghbmV3IFJlZ0V4cChzdWJqZWN0UmUsICdpJykudGVzdChtZXNzYWdlLnN1YmplY3QpKSByZXR1cm4gZmFsc2VcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIGV4dHJhY3QobWVzc2FnZTogRW1haWxNZXNzYWdlKTogRXh0cmFjdGlvbkFydGlmYWN0W10ge1xuICAgIGNvbnN0IHNvdXJjZXMgPSBidWlsZFNvdXJjZXMobWVzc2FnZSlcbiAgICBjb25zdCBhbW91bnRSYXcgPSBhcHBseUZpZWxkKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5hbW91bnQsIHNvdXJjZXMpXG4gICAgY29uc3QgYW1vdW50Q2VudHMgPSBwYXJzZU1vbmV5VG9DZW50cyhhbW91bnRSYXcpXG4gICAgaWYgKGFtb3VudENlbnRzID09PSBudWxsKSByZXR1cm4gW11cblxuICAgIGNvbnN0IGN1cnJlbmN5UmF3ID0gdGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLmN1cnJlbmN5XG4gICAgICA/IGFwcGx5RmllbGQodGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLmN1cnJlbmN5LCBzb3VyY2VzKVxuICAgICAgOiBudWxsXG4gICAgY29uc3QgY3VycmVuY3kgPSBub3JtYWxpemVDdXJyZW5jeShjdXJyZW5jeVJhdykgPz8gJ1VTRCdcblxuICAgIGNvbnN0IHNwZW50T25SYXcgPSB0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMuc3BlbnRPblxuICAgICAgPyBhcHBseUZpZWxkKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5zcGVudE9uLCBzb3VyY2VzKVxuICAgICAgOiBudWxsXG4gICAgY29uc3Qgc3BlbnRPbiA9IG5vcm1hbGl6ZURhdGUoc3BlbnRPblJhdykgPz8gdG9EYXRlU3RyaW5nKG1lc3NhZ2UucmVjZWl2ZWRBdClcblxuICAgIGNvbnN0IG1lcmNoYW50ID0gdGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLm1lcmNoYW50XG4gICAgICA/IGFwcGx5RmllbGQodGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLm1lcmNoYW50LCBzb3VyY2VzKVxuICAgICAgOiBudWxsXG5cbiAgICBjb25zdCBub3RlID0gdGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLm5vdGVcbiAgICAgID8gYXBwbHlGaWVsZCh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMubm90ZSwgc291cmNlcylcbiAgICAgIDogbWVzc2FnZS5zdWJqZWN0LnNsaWNlKDAsIDIwMCkgfHwgbnVsbFxuXG4gICAgY29uc3QgcGF5bG9hZDogU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkID0ge1xuICAgICAgYW1vdW50Q2VudHMsXG4gICAgICBjdXJyZW5jeSxcbiAgICAgIHNwZW50T24sXG4gICAgICBtZXJjaGFudDogbWVyY2hhbnQ/LnRyaW0oKSA/IG1lcmNoYW50LnRyaW0oKS5zbGljZSgwLCAxMjApIDogbnVsbCxcbiAgICAgIG5vdGU6IG5vdGU/LnRyaW0oKSA/IG5vdGUudHJpbSgpLnNsaWNlKDAsIDIwMCkgOiBudWxsLFxuICAgICAgc291cmNlU3ViamVjdDogbWVzc2FnZS5zdWJqZWN0LFxuICAgICAgc291cmNlRnJvbTogbWVzc2FnZS5mcm9tLFxuICAgICAgdGVtcGxhdGVJZDogdGhpcy50ZW1wbGF0ZS5pZCxcbiAgICB9XG5cbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiBTUEVORElOR19DQU5ESURBVEVfS0lORCxcbiAgICAgICAgcGF5bG9hZDogeyAuLi5wYXlsb2FkIH0sXG4gICAgICAgIGNvbmZpZGVuY2U6IDAuOSxcbiAgICAgIH0sXG4gICAgXVxuICB9XG59XG5cbnR5cGUgU291cmNlcyA9IHtcbiAgc3ViamVjdDogc3RyaW5nXG4gIHRleHQ6IHN0cmluZ1xuICBodG1sX3RleHQ6IHN0cmluZ1xuICBmcm9tX2RvbWFpbjogc3RyaW5nIHwgbnVsbFxufVxuXG5mdW5jdGlvbiBidWlsZFNvdXJjZXMobWVzc2FnZTogRW1haWxNZXNzYWdlKTogU291cmNlcyB7XG4gIGNvbnN0IGZyb20gPSBub3JtYWxpemVGcm9tKG1lc3NhZ2UuZnJvbSlcbiAgcmV0dXJuIHtcbiAgICBzdWJqZWN0OiBtZXNzYWdlLnN1YmplY3QgPz8gJycsXG4gICAgdGV4dDogbWVzc2FnZS50ZXh0Qm9keSA/PyAnJyxcbiAgICBodG1sX3RleHQ6IHN0cmlwSHRtbChtZXNzYWdlLmh0bWxCb2R5KSxcbiAgICBmcm9tX2RvbWFpbjogZnJvbT8uZG9tYWluID8/IG51bGwsXG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlGaWVsZChcbiAgZXh0cmFjdG9yOiBGaWVsZEV4dHJhY3RvcixcbiAgc291cmNlczogU291cmNlcyxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAoZXh0cmFjdG9yLnNvdXJjZSA9PT0gJ2NvbnN0YW50Jykge1xuICAgIHJldHVybiBleHRyYWN0b3IudmFsdWVcbiAgfVxuICBpZiAoZXh0cmFjdG9yLnNvdXJjZSA9PT0gJ2Zyb21fZG9tYWluJykge1xuICAgIGlmICghc291cmNlcy5mcm9tX2RvbWFpbikgcmV0dXJuIG51bGxcbiAgICBjb25zdCBiYXNlID0gc291cmNlcy5mcm9tX2RvbWFpbi5zcGxpdCgnLicpWzBdXG4gICAgaWYgKCFiYXNlKSByZXR1cm4gbnVsbFxuICAgIHJldHVybiBiYXNlLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgYmFzZS5zbGljZSgxKVxuICB9XG4gIGNvbnN0IGhheXN0YWNrID0gc291cmNlc1tleHRyYWN0b3Iuc291cmNlXVxuICB0cnkge1xuICAgIGNvbnN0IHJlID0gbmV3IFJlZ0V4cChleHRyYWN0b3IucmVnZXgsICdpJylcbiAgICBjb25zdCBtID0gaGF5c3RhY2subWF0Y2gocmUpXG4gICAgY29uc3QgZ3JvdXAgPSBleHRyYWN0b3IuZ3JvdXBcbiAgICBpZiAoIW0gfHwgZ3JvdXAgPCAwIHx8IGdyb3VwID49IG0ubGVuZ3RoKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IHZhbHVlID0gbVtncm91cF1cbiAgICByZXR1cm4gdmFsdWU/LnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGxcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5mdW5jdGlvbiBzdHJpcEh0bWwoaHRtbDogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB7XG4gIGlmICghaHRtbCkgcmV0dXJuICcnXG4gIHJldHVybiBodG1sLnJlcGxhY2UoLzxbXj5dKz4vZywgJyAnKS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpXG59XG5cbmZ1bmN0aW9uIHBhcnNlTW9uZXlUb0NlbnRzKHJhdzogc3RyaW5nIHwgbnVsbCk6IG51bWJlciB8IG51bGwge1xuICBpZiAoIXJhdykgcmV0dXJuIG51bGxcbiAgY29uc3QgY2xlYW5lZCA9IHJhdy5yZXBsYWNlKC9bXlxcZC4sLV0vZywgJycpLnJlcGxhY2UoLywvZywgJycpXG4gIGlmICghY2xlYW5lZCkgcmV0dXJuIG51bGxcbiAgY29uc3QgZG9sbGFycyA9IE51bWJlcihjbGVhbmVkKVxuICBpZiAoIU51bWJlci5pc0Zpbml0ZShkb2xsYXJzKSB8fCBkb2xsYXJzIDw9IDApIHJldHVybiBudWxsXG4gIHJldHVybiBNYXRoLnJvdW5kKGRvbGxhcnMgKiAxMDApXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUN1cnJlbmN5KHJhdzogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIXJhdykgcmV0dXJuIG51bGxcbiAgY29uc3QgbSA9IHJhdy50b1VwcGVyQ2FzZSgpLm1hdGNoKC9cXGIoVVNEfEVVUnxHQlB8TVhOfENBRClcXGIvKVxuICByZXR1cm4gbT8uWzFdID8/IG51bGxcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRGF0ZShyYXc6IHN0cmluZyB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFyYXcpIHJldHVybiBudWxsXG4gIGNvbnN0IGlzbyA9IHJhdy5tYXRjaCgvXFxiKDIwXFxkezJ9LVxcZHsyfS1cXGR7Mn0pXFxiLylcbiAgaWYgKGlzbz8uWzFdKSByZXR1cm4gaXNvWzFdXG4gIHJldHVybiBudWxsXG59XG5cbmZ1bmN0aW9uIHRvRGF0ZVN0cmluZyhkOiBEYXRlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbn1cblxuLyoqIFZhbGlkYXRlIGV4dHJhY3RvcnMgSlNPTiBzaGFwZSAodXNlZCBieSBBUEkgKyBBSSBvdXRwdXQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMoXG4gIHJhdzogdW5rbm93bixcbik6IFNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzIHwgbnVsbCB7XG4gIGlmIChyYXcgPT09IG51bGwgfHwgdHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gbnVsbFxuICBjb25zdCBvYmogPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uc3QgYW1vdW50ID0gcGFyc2VGaWVsZEV4dHJhY3RvcihvYmouYW1vdW50KVxuICBpZiAoIWFtb3VudCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIHtcbiAgICBhbW91bnQsXG4gICAgY3VycmVuY3k6IHBhcnNlT3B0aW9uYWxGaWVsZChvYmouY3VycmVuY3kpLFxuICAgIHNwZW50T246IHBhcnNlT3B0aW9uYWxGaWVsZChvYmouc3BlbnRPbiksXG4gICAgbWVyY2hhbnQ6IHBhcnNlT3B0aW9uYWxGaWVsZChvYmoubWVyY2hhbnQpLFxuICAgIG5vdGU6IHBhcnNlT3B0aW9uYWxGaWVsZChvYmoubm90ZSksXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VPcHRpb25hbEZpZWxkKHJhdzogdW5rbm93bik6IEZpZWxkRXh0cmFjdG9yIHwgbnVsbCB7XG4gIGlmIChyYXcgPT09IHVuZGVmaW5lZCB8fCByYXcgPT09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiBwYXJzZUZpZWxkRXh0cmFjdG9yKHJhdylcbn1cblxuZnVuY3Rpb24gcGFyc2VGaWVsZEV4dHJhY3RvcihyYXc6IHVua25vd24pOiBGaWVsZEV4dHJhY3RvciB8IG51bGwge1xuICBpZiAocmF3ID09PSBudWxsIHx8IHR5cGVvZiByYXcgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIG51bGxcbiAgY29uc3Qgb2JqID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGNvbnN0IHNvdXJjZSA9IG9iai5zb3VyY2VcbiAgaWYgKHNvdXJjZSA9PT0gJ2Zyb21fZG9tYWluJykgcmV0dXJuIHsgc291cmNlOiAnZnJvbV9kb21haW4nIH1cbiAgaWYgKHNvdXJjZSA9PT0gJ2NvbnN0YW50Jykge1xuICAgIGlmICh0eXBlb2Ygb2JqLnZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGxcbiAgICByZXR1cm4geyBzb3VyY2U6ICdjb25zdGFudCcsIHZhbHVlOiBvYmoudmFsdWUgfVxuICB9XG4gIGlmIChzb3VyY2UgPT09ICdzdWJqZWN0JyB8fCBzb3VyY2UgPT09ICd0ZXh0JyB8fCBzb3VyY2UgPT09ICdodG1sX3RleHQnKSB7XG4gICAgaWYgKHR5cGVvZiBvYmoucmVnZXggIT09ICdzdHJpbmcnIHx8ICFvYmoucmVnZXgpIHJldHVybiBudWxsXG4gICAgaWYgKHR5cGVvZiBvYmouZ3JvdXAgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKG9iai5ncm91cCkgfHwgb2JqLmdyb3VwIDwgMCkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIG5ldyBSZWdFeHAob2JqLnJlZ2V4LCAnaScpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgICByZXR1cm4geyBzb3VyY2UsIHJlZ2V4OiBvYmoucmVnZXgsIGdyb3VwOiBvYmouZ3JvdXAgfVxuICB9XG4gIHJldHVybiBudWxsXG59XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgbWFpbGJveGVzOiBNYWlsYm94ZXNUYWJsZVxuICBkb21haW5fZmlsdGVyczogRG9tYWluRmlsdGVyc1RhYmxlXG4gIG1lc3NhZ2VzOiBNZXNzYWdlc1RhYmxlXG4gIGV4dHJhY3Rpb25fYXJ0aWZhY3RzOiBFeHRyYWN0aW9uQXJ0aWZhY3RzVGFibGVcbiAgc3luY19ydW5zOiBTeW5jUnVuc1RhYmxlXG4gIHBhcnNpbmdfdGVtcGxhdGVzOiBQYXJzaW5nVGVtcGxhdGVzVGFibGVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBVc2Vyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGVtYWlsOiBzdHJpbmdcbiAgcGFzc3dvcmRfaGFzaDogc3RyaW5nIHwgbnVsbFxuICBhdXRoX3VzZXJfaWQ6IHN0cmluZyB8IG51bGxcbiAgbmFtZTogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBNYWlsYm94ZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgLyoqICdmaXh0dXJlJyB8ICdnbWFpbCcgKi9cbiAgcHJvdmlkZXI6IHN0cmluZ1xuICBsYWJlbDogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgLyoqIE9wYXF1ZSBwcm92aWRlciBzeW5jIGN1cnNvci4gKi9cbiAgc3luY19jdXJzb3I6IHN0cmluZyB8IG51bGxcbiAgLyoqIFdoZW4gdHJ1ZSwgd29ya2VyIHNob3VsZCBzeW5jIEFTQVAuICovXG4gIHN5bmNfcmVxdWVzdGVkOiBib29sZWFuXG4gIC8qKiBKU09OOiB7IGFjY2Vzc1Rva2VuLCByZWZyZXNoVG9rZW4/LCBleHBpcmVzQXRNcz8gfSBmb3IgZ21haWwuICovXG4gIG9hdXRoX3Rva2Vuc19qc29uOiBzdHJpbmcgfCBudWxsXG4gIGxhc3Rfc3luY2VkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRG9tYWluRmlsdGVyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1haWxib3hfaWQ6IG51bWJlclxuICAvKiogRG9tYWluIChhbWF6b24uY29tKSBvciBmdWxsIGFkZHJlc3MgKG5vcmVwbHlAYW1hem9uLmNvbSkuICovXG4gIHBhdHRlcm46IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVzc2FnZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgc3RyaW5nPlxuICBib2R5X2hhc2g6IHN0cmluZyB8IG51bGxcbiAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keTogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdGlvbkFydGlmYWN0c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1lc3NhZ2VfaWQ6IG51bWJlclxuICBraW5kOiBzdHJpbmdcbiAgcGF5bG9hZDogQ29sdW1uVHlwZTx1bmtub3duLCBzdHJpbmcgfCB1bmtub3duLCBzdHJpbmcgfCB1bmtub3duPlxuICBjb25maWRlbmNlOiBudW1iZXJcbiAgLyoqICdwZW5kaW5nJyB8ICdhY2NlcHRlZCcgfCAncmVqZWN0ZWQnICovXG4gIHN0YXR1czogc3RyaW5nXG4gIC8qKiBzcGVuZG1hbmFnZXIgZXhwZW5zZSBpZCBhZnRlciBhY2NlcHQrcHVibGlzaCAqL1xuICBwdWJsaXNoZWRfZXhwZW5zZV9pZDogbnVtYmVyIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2luZ1RlbXBsYXRlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1haWxib3hfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hfc3ViamVjdF9yZWdleDogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiBDb2x1bW5UeXBlPHVua25vd24sIHN0cmluZyB8IHVua25vd24sIHN0cmluZyB8IHVua25vd24+XG4gIHNvdXJjZV9tZXNzYWdlX2lkOiBudW1iZXIgfCBudWxsXG4gIHZlcnNpb246IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1J1bnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgc3RhcnRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICBmaW5pc2hlZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCwgc3RyaW5nIHwgbnVsbD5cbiAgZmV0Y2hlZF9jb3VudDogbnVtYmVyXG4gIGV4dHJhY3RlZF9jb3VudDogbnVtYmVyXG4gIGVycm9yX3RleHQ6IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IHR5cGUgVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIE1haWxib3ggPSBTZWxlY3RhYmxlPE1haWxib3hlc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3TWFpbGJveCA9IEluc2VydGFibGU8TWFpbGJveGVzVGFibGU+XG5leHBvcnQgdHlwZSBEb21haW5GaWx0ZXIgPSBTZWxlY3RhYmxlPERvbWFpbkZpbHRlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIE1lc3NhZ2UgPSBTZWxlY3RhYmxlPE1lc3NhZ2VzVGFibGU+XG5leHBvcnQgdHlwZSBFeHRyYWN0aW9uQXJ0aWZhY3QgPSBTZWxlY3RhYmxlPEV4dHJhY3Rpb25BcnRpZmFjdHNUYWJsZT5cbmV4cG9ydCB0eXBlIFN5bmNSdW4gPSBTZWxlY3RhYmxlPFN5bmNSdW5zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdTeW5jUnVuID0gSW5zZXJ0YWJsZTxTeW5jUnVuc1RhYmxlPlxuZXhwb3J0IHR5cGUgUGFyc2luZ1RlbXBsYXRlID0gU2VsZWN0YWJsZTxQYXJzaW5nVGVtcGxhdGVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdQYXJzaW5nVGVtcGxhdGUgPSBJbnNlcnRhYmxlPFBhcnNpbmdUZW1wbGF0ZXNUYWJsZT5cbiIsICJpbXBvcnQgeyBQb29sLCB0eXBlcyB9IGZyb20gJ3BnJ1xuaW1wb3J0IHsgS3lzZWx5LCBQb3N0Z3Jlc0RpYWxlY3QgfSBmcm9tICdreXNlbHknXG5pbXBvcnQgeyBlbnYgfSBmcm9tICcuL2Vudi50cydcbmltcG9ydCB7XG4gIGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zLFxuICBzc2xGb3JEYXRhYmFzZVVybCxcbn0gZnJvbSAnLi9zc2wudHMnXG5cbi8vIEtlZXAgUG9zdGdyZXMgYGRhdGVgIGFzIGBZWVlZLU1NLUREYCBzdHJpbmdzLiBUaGUgZGVmYXVsdCBwZyBwYXJzZXIgdHVybnNcbi8vIHRoZW0gaW50byBKUyBEYXRlIG9iamVjdHMsIHdoaWNoIEdyYXBoUUwgdGhlbiBzdHJpbmdpZmllcyBhcyBmdWxsIHRpbWVzdGFtcHNcbi8vIGFuZCBicmVha3MgRmx1dHRlcidzIGRhdGUtb25seSBwYXJzaW5nLlxudHlwZXMuc2V0VHlwZVBhcnNlcih0eXBlcy5idWlsdGlucy5EQVRFLCAodmFsdWU6IHN0cmluZykgPT4gdmFsdWUpXG5cbmV4cG9ydCB0eXBlIENyZWF0ZUt5c2VseU9wdGlvbnMgPSB7XG4gIC8qKiBGYWxsYmFjayB3aGVuIGBQR0RBVEFCQVNFYCAvIGBEQVRBQkFTRV9VUkxgIGFyZSB1bnNldC4gKi9cbiAgZGVmYXVsdERhdGFiYXNlOiBzdHJpbmdcbn1cblxuZnVuY3Rpb24gcG9vbENvbmZpZ0Zyb21FbnYoXG4gIGRlZmF1bHREYXRhYmFzZTogc3RyaW5nLFxuKTogQ29uc3RydWN0b3JQYXJhbWV0ZXJzPHR5cGVvZiBQb29sPlswXSB7XG4gIGNvbnN0IGRhdGFiYXNlVXJsID0gZW52KCdEQVRBQkFTRV9VUkwnKVxuICBpZiAoZGF0YWJhc2VVcmwpIHtcbiAgICBjb25zdCBzc2wgPSBzc2xGb3JEYXRhYmFzZVVybChkYXRhYmFzZVVybClcbiAgICByZXR1cm4ge1xuICAgICAgY29ubmVjdGlvblN0cmluZzogY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMoZGF0YWJhc2VVcmwpLFxuICAgICAgbWF4OiAxMCxcbiAgICAgIC4uLihzc2wgPT09IHVuZGVmaW5lZCA/IHt9IDogeyBzc2wgfSksXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhYmFzZTogZW52KCdQR0RBVEFCQVNFJykgPz8gZGVmYXVsdERhdGFiYXNlLFxuICAgIGhvc3Q6IGVudignUEdIT1NUJykgPz8gJ2xvY2FsaG9zdCcsXG4gICAgdXNlcjogZW52KCdQR1VTRVInKSA/PyAncG9zdGdyZXMnLFxuICAgIHBhc3N3b3JkOiBlbnYoJ1BHUEFTU1dPUkQnKSA/PyAndGVzdDEyMzQnLFxuICAgIHBvcnQ6IE51bWJlcihlbnYoJ1BHUE9SVCcpID8/ICc1NDMyJyksXG4gICAgbWF4OiAxMCxcbiAgfVxufVxuXG4vKiogQ3JlYXRlIGEgS3lzZWx5IGluc3RhbmNlIGZvciB0aGUgZ2l2ZW4gc2NoZW1hIHR5cGUgYW5kIGRlZmF1bHQgREIgbmFtZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVLeXNlbHk8REI+KG9wdGlvbnM6IENyZWF0ZUt5c2VseU9wdGlvbnMpOiBLeXNlbHk8REI+IHtcbiAgY29uc3QgZGlhbGVjdCA9IG5ldyBQb3N0Z3Jlc0RpYWxlY3Qoe1xuICAgIHBvb2w6IG5ldyBQb29sKHBvb2xDb25maWdGcm9tRW52KG9wdGlvbnMuZGVmYXVsdERhdGFiYXNlKSksXG4gIH0pXG4gIHJldHVybiBuZXcgS3lzZWx5PERCPih7IGRpYWxlY3QgfSlcbn1cbiIsICIvKiogUmVhZCBhbiBlbnYgdmFyIGZyb20gTm9kZSBgcHJvY2Vzcy5lbnZgIG9yIERlbm8uICovXG5leHBvcnQgZnVuY3Rpb24gZW52KG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LltuYW1lXSkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltuYW1lXVxuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIERlbm8uZW52LmdldChuYW1lKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cbiIsICIvKiogVExTIG9wdGlvbnMgZm9yIGBwZ2AgZnJvbSBhIFBvc3RncmVzIFVSTC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzc2xGb3JEYXRhYmFzZVVybChcbiAgZGF0YWJhc2VVcmw6IHN0cmluZyxcbik6IGZhbHNlIHwgeyByZWplY3RVbmF1dGhvcml6ZWQ6IGJvb2xlYW4gfSB8IHVuZGVmaW5lZCB7XG4gIGxldCB1cmw6IFVSTFxuICB0cnkge1xuICAgIHVybCA9IG5ldyBVUkwoZGF0YWJhc2VVcmwpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIGNvbnN0IG1vZGUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgnc3NsbW9kZScpPy50b0xvd2VyQ2FzZSgpXG4gIGlmIChtb2RlID09PSAnZGlzYWJsZScpIHJldHVybiBmYWxzZVxuICBpZiAobW9kZSA9PT0gJ3JlcXVpcmUnIHx8IG1vZGUgPT09ICd2ZXJpZnktY2EnIHx8IG1vZGUgPT09ICd2ZXJpZnktZnVsbCcpIHtcbiAgICByZXR1cm4geyByZWplY3RVbmF1dGhvcml6ZWQ6IGZhbHNlIH1cbiAgfVxuXG4gIGNvbnN0IGhvc3QgPSB1cmwuaG9zdG5hbWVcbiAgaWYgKGhvc3QgPT09ICdsb2NhbGhvc3QnIHx8IGhvc3QgPT09ICcxMjcuMC4wLjEnKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHsgcmVqZWN0VW5hdXRob3JpemVkOiBmYWxzZSB9XG59XG5cbi8qKlxuICogU3RyaXAgU1NMIHF1ZXJ5IHBhcmFtcyBmcm9tIGEgUG9zdGdyZXMgVVJMIGJlZm9yZSBwYXNzaW5nIGl0IHRvIGBwZ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyhkYXRhYmFzZVVybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKGRhdGFiYXNlVXJsKVxuICAgIGZvciAoY29uc3Qga2V5IG9mIFtcbiAgICAgICdzc2xtb2RlJyxcbiAgICAgICdzc2wnLFxuICAgICAgJ3NzbHJvb3RjZXJ0JyxcbiAgICAgICdzc2xjZXJ0JyxcbiAgICAgICdzc2xrZXknLFxuICAgIF0pIHtcbiAgICAgIHVybC5zZWFyY2hQYXJhbXMuZGVsZXRlKGtleSlcbiAgICB9XG4gICAgcmV0dXJuIHVybC50b1N0cmluZygpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBkYXRhYmFzZVVybFxuICB9XG59XG4iLCAiaW1wb3J0IHsgRGF0YWJhc2UgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGNyZWF0ZUt5c2VseSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9jcmVhdGVfa3lzZWx5LnRzJ1xuXG5leHBvcnQgeyBlbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvZW52LnRzJ1xuXG5leHBvcnQgY29uc3QgZGIgPSBjcmVhdGVLeXNlbHk8RGF0YWJhc2U+KHtcbiAgZGVmYXVsdERhdGFiYXNlOiAnbWFpbGJveCcsXG59KVxuIiwgImV4cG9ydCB0eXBlIEdlbmVyYXRlVGVtcGxhdGVBaUlucHV0ID0ge1xuICBmcm9tOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHRleHRCb2R5Pzogc3RyaW5nIHwgbnVsbFxuICBodG1sQm9keT86IHN0cmluZyB8IG51bGxcbiAgaGludHM/OiBzdHJpbmcgfCBudWxsXG59XG5cbmV4cG9ydCB0eXBlIEdlbmVyYXRlVGVtcGxhdGVBaU91dHB1dCA9IHtcbiAgbWF0Y2hGcm9tUGF0dGVybjogc3RyaW5nXG4gIG1hdGNoU3ViamVjdFJlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIG5hbWVTdWdnZXN0aW9uOiBzdHJpbmdcbn1cblxuZXhwb3J0IGNsYXNzIEFpQ2xpZW50RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0FpQ2xpZW50RXJyb3InXG4gIH1cbn1cblxuLyoqXG4gKiBDYWxsIGFpLWFwaSBnZW5lcmF0ZV9lbWFpbF9zcGVuZF90ZW1wbGF0ZSB1c2UgY2FzZS5cbiAqIE92ZXJyaWRhYmxlIGZldGNoIGZvciB0ZXN0cy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdlbmVyYXRlRW1haWxTcGVuZFRlbXBsYXRlKFxuICBpbnB1dDogR2VuZXJhdGVUZW1wbGF0ZUFpSW5wdXQsXG4gIG9wdGlvbnM/OiB7XG4gICAgYmFzZVVybD86IHN0cmluZ1xuICAgIHNlcnZpY2VLZXk/OiBzdHJpbmdcbiAgICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2hcbiAgfSxcbik6IFByb21pc2U8R2VuZXJhdGVUZW1wbGF0ZUFpT3V0cHV0PiB7XG4gIGNvbnN0IGJhc2VVcmwgPSAob3B0aW9ucz8uYmFzZVVybCA/P1xuICAgIERlbm8uZW52LmdldCgnQUlfQVBJX0JBU0VfVVJMJykgPz9cbiAgICAnaHR0cDovL2xvY2FsaG9zdDozMDA0JykucmVwbGFjZSgvXFwvJC8sICcnKVxuICBjb25zdCBzZXJ2aWNlS2V5ID0gb3B0aW9ucz8uc2VydmljZUtleSA/PyBEZW5vLmVudi5nZXQoJ0FJX1NFUlZJQ0VfS0VZJylcbiAgaWYgKCFzZXJ2aWNlS2V5KSB7XG4gICAgdGhyb3cgbmV3IEFpQ2xpZW50RXJyb3IoJ0FJX1NFUlZJQ0VfS0VZIGlzIG5vdCBjb25maWd1cmVkJylcbiAgfVxuXG4gIGNvbnN0IGZldGNoSW1wbCA9IG9wdGlvbnM/LmZldGNoSW1wbCA/PyBmZXRjaFxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaEltcGwoXG4gICAgYCR7YmFzZVVybH0vdjEvdXNlLWNhc2VzL2dlbmVyYXRlX2VtYWlsX3NwZW5kX3RlbXBsYXRlL3J1bmAsXG4gICAge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtzZXJ2aWNlS2V5fWAsXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGZyb206IGlucHV0LmZyb20sXG4gICAgICAgICAgc3ViamVjdDogaW5wdXQuc3ViamVjdCxcbiAgICAgICAgICB0ZXh0Qm9keTogaW5wdXQudGV4dEJvZHkgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgIGh0bWxCb2R5OiBpbnB1dC5odG1sQm9keSA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgaGludHM6IGlucHV0LmhpbnRzID8/IHVuZGVmaW5lZCxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIH0sXG4gIClcblxuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpLmNhdGNoKCgpID0+ICcnKVxuICAgIHRocm93IG5ldyBBaUNsaWVudEVycm9yKFxuICAgICAgYGFpLWFwaSBlcnJvciAke3Jlcy5zdGF0dXN9OiAke3RleHQuc2xpY2UoMCwgMzAwKX1gLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IGJvZHkgPSBhd2FpdCByZXMuanNvbigpIGFzIHsgb3V0cHV0PzogR2VuZXJhdGVUZW1wbGF0ZUFpT3V0cHV0IH1cbiAgaWYgKCFib2R5Lm91dHB1dCkge1xuICAgIHRocm93IG5ldyBBaUNsaWVudEVycm9yKCdhaS1hcGkgcmVzcG9uc2UgbWlzc2luZyBvdXRwdXQnKVxuICB9XG4gIHJldHVybiBib2R5Lm91dHB1dFxufVxuIiwgImltcG9ydCB0eXBlIHsgU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkIH0gZnJvbSAnbWFpbGJveF9raXQvbW9kLnRzJ1xuXG5leHBvcnQgY2xhc3MgU3BlbmRtYW5hZ2VyU2lua0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdTcGVuZG1hbmFnZXJTaW5rRXJyb3InXG4gIH1cbn1cblxuZXhwb3J0IHR5cGUgUHVibGlzaEV4cGVuc2VSZXN1bHQgPSB7XG4gIGV4cGVuc2VJZDogbnVtYmVyXG59XG5cbi8qKlxuICogUHVibGlzaCBhbiBhY2NlcHRlZCBzcGVuZGluZyBjYW5kaWRhdGUgdG8gc3BlbmRtYW5hZ2VyLWFwaSB2aWEgR3JhcGhRTCxcbiAqIGZvcndhcmRpbmcgdGhlIGNhbGxlcidzIFN1cGVyVG9rZW5zIEJlYXJlciBKV1QuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwdWJsaXNoRXhwZW5zZVRvU3BlbmRtYW5hZ2VyKFxuICBjYW5kaWRhdGU6IFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCxcbiAgY2F0ZWdvcnlJZDogbnVtYmVyLFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcsXG4gIG9wdGlvbnM/OiB7XG4gICAgYmFzZVVybD86IHN0cmluZ1xuICAgIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaFxuICB9LFxuKTogUHJvbWlzZTxQdWJsaXNoRXhwZW5zZVJlc3VsdD4ge1xuICBpZiAoIWF1dGhvcml6YXRpb25IZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHRocm93IG5ldyBTcGVuZG1hbmFnZXJTaW5rRXJyb3IoJ21pc3NpbmcgQmVhcmVyIGF1dGhvcml6YXRpb24nKVxuICB9XG5cbiAgY29uc3QgYmFzZVVybCA9IChvcHRpb25zPy5iYXNlVXJsID8/XG4gICAgRGVuby5lbnYuZ2V0KCdTUEVORE1BTkFHRVJfQVBJX0JBU0VfVVJMJykgPz9cbiAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAyJykucmVwbGFjZSgvXFwvJC8sICcnKVxuXG4gIGNvbnN0IG5vdGUgPSBjYW5kaWRhdGUubm90ZT8udHJpbSgpIHx8XG4gICAgW2NhbmRpZGF0ZS5tZXJjaGFudCwgY2FuZGlkYXRlLnNvdXJjZVN1YmplY3RdLmZpbHRlcihCb29sZWFuKS5qb2luKCcgXHUyMDE0ICcpIHx8XG4gICAgbnVsbFxuXG4gIGNvbnN0IHF1ZXJ5ID0gYFxuICAgIG11dGF0aW9uIENyZWF0ZUV4cGVuc2UoJGlucHV0OiBDcmVhdGVFeHBlbnNlSW5wdXRJbnB1dCEpIHtcbiAgICAgIGNyZWF0ZUV4cGVuc2UoYXJnczogeyBpbnB1dDogJGlucHV0IH0pIHtcbiAgICAgICAgaWRcbiAgICAgIH1cbiAgICB9XG4gIGBcblxuICBjb25zdCBmZXRjaEltcGwgPSBvcHRpb25zPy5mZXRjaEltcGwgPz8gZmV0Y2hcbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2hJbXBsKGAke2Jhc2VVcmx9L2dyYXBocWxgLCB7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgaGVhZGVyczoge1xuICAgICAgQXV0aG9yaXphdGlvbjogYXV0aG9yaXphdGlvbkhlYWRlcixcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgfSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBxdWVyeSxcbiAgICAgIHZhcmlhYmxlczoge1xuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGNhdGVnb3J5SWQsXG4gICAgICAgICAgYW1vdW50Q2VudHM6IGNhbmRpZGF0ZS5hbW91bnRDZW50cyxcbiAgICAgICAgICBzcGVudE9uOiBjYW5kaWRhdGUuc3BlbnRPbixcbiAgICAgICAgICBjdXJyZW5jeTogY2FuZGlkYXRlLmN1cnJlbmN5LFxuICAgICAgICAgIG5vdGUsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pLFxuICB9KVxuXG4gIGlmICghcmVzLm9rKSB7XG4gICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlcy50ZXh0KCkuY2F0Y2goKCkgPT4gJycpXG4gICAgdGhyb3cgbmV3IFNwZW5kbWFuYWdlclNpbmtFcnJvcihcbiAgICAgIGBzcGVuZG1hbmFnZXIgSFRUUCAke3Jlcy5zdGF0dXN9OiAke3RleHQuc2xpY2UoMCwgMzAwKX1gLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IGJvZHkgPSBhd2FpdCByZXMuanNvbigpIGFzIHtcbiAgICBkYXRhPzogeyBjcmVhdGVFeHBlbnNlPzogeyBpZDogbnVtYmVyIH0gfVxuICAgIGVycm9ycz86IHsgbWVzc2FnZTogc3RyaW5nIH1bXVxuICB9XG5cbiAgaWYgKGJvZHkuZXJyb3JzPy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgU3BlbmRtYW5hZ2VyU2lua0Vycm9yKFxuICAgICAgYm9keS5lcnJvcnMubWFwKChlKSA9PiBlLm1lc3NhZ2UpLmpvaW4oJzsgJyksXG4gICAgKVxuICB9XG5cbiAgY29uc3QgaWQgPSBib2R5LmRhdGE/LmNyZWF0ZUV4cGVuc2U/LmlkXG4gIGlmICh0eXBlb2YgaWQgIT09ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IFNwZW5kbWFuYWdlclNpbmtFcnJvcignc3BlbmRtYW5hZ2VyIHJlc3BvbnNlIG1pc3NpbmcgZXhwZW5zZSBpZCcpXG4gIH1cbiAgcmV0dXJuIHsgZXhwZW5zZUlkOiBpZCB9XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGFzSXNvVGltZXN0YW1wKHZhbHVlOiBEYXRlIHwgc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKVxuICBpZiAoL15cXGR7MTAsfSQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICBjb25zdCBuID0gTnVtYmVyKHRyaW1tZWQpXG4gICAgY29uc3QgbXMgPSB0cmltbWVkLmxlbmd0aCA8PSAxMCA/IG4gKiAxMDAwIDogblxuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXNJc29UaW1lc3RhbXBPck51bGwoXG4gIHZhbHVlOiBEYXRlIHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIGFzSXNvVGltZXN0YW1wKHZhbHVlKVxufVxuIiwgImNvbnN0IFBST1ZJREVSUyA9IG5ldyBTZXQoWydmaXh0dXJlJywgJ2dtYWlsJ10pXG5jb25zdCBBUlRJRkFDVF9TVEFUVVNFUyA9IG5ldyBTZXQoWydwZW5kaW5nJywgJ2FjY2VwdGVkJywgJ3JlamVjdGVkJ10pXG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkTWFpbGJveEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkTWFpbGJveEVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVByb3ZpZGVyKHByb3ZpZGVyOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gcHJvdmlkZXIudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFQUk9WSURFUlMuaGFzKHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICBgcHJvdmlkZXIgbXVzdCBiZSBvbmUgb2Y6ICR7Wy4uLlBST1ZJREVSU10uam9pbignLCAnKX1gLFxuICAgIClcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVMYWJlbChsYWJlbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxhYmVsLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdsYWJlbCBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2xhYmVsIGlzIHRvbyBsb25nJylcbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuLyoqXG4gKiBBbGxvd2VkIHBhdHRlcm5zOlxuICogLSBgdXNlckBzaG9wLmNvbWAsIGAqQHNob3AuY29tYCwgYCpAKi5zaG9wLmNvbWBcbiAqIC0gYHNob3AuY29tYCwgYCouc2hvcC5jb21gXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZURvbWFpblBhdHRlcm5zKHBhdHRlcm5zOiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKVxuICBmb3IgKGNvbnN0IHJhdyBvZiBwYXR0ZXJucykge1xuICAgIGNvbnN0IHAgPSByYXcudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICBpZiAoIXApIGNvbnRpbnVlXG4gICAgaWYgKHAubGVuZ3RoID4gMjU1KSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignZG9tYWluIGZpbHRlciBwYXR0ZXJuIGlzIHRvbyBsb25nJylcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkRnJvbVBhdHRlcm4ocCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgICBgaW52YWxpZCBkb21haW4gZmlsdGVyIHBhdHRlcm46ICR7cmF3fWAsXG4gICAgICApXG4gICAgfVxuICAgIGlmIChzZWVuLmhhcyhwKSkgY29udGludWVcbiAgICBzZWVuLmFkZChwKVxuICAgIG91dC5wdXNoKHApXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZEZyb21QYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBwID0gcGF0dGVybi50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIXAgfHwgcC5sZW5ndGggPiAyNTUpIHJldHVybiBmYWxzZVxuXG4gIGlmIChwLmluY2x1ZGVzKCdAJykpIHtcbiAgICBjb25zdCBhdCA9IHAubGFzdEluZGV4T2YoJ0AnKVxuICAgIGlmIChhdCA8PSAwIHx8IGF0ID09PSBwLmxlbmd0aCAtIDEpIHJldHVybiBmYWxzZVxuICAgIGNvbnN0IGxvY2FsID0gcC5zbGljZSgwLCBhdClcbiAgICBjb25zdCBkb21haW4gPSBwLnNsaWNlKGF0ICsgMSlcbiAgICBpZiAobG9jYWwgIT09ICcqJyAmJiAobG9jYWwuaW5jbHVkZXMoJyonKSB8fCBsb2NhbC5pbmNsdWRlcygnQCcpKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIHJldHVybiBpc1ZhbGlkRG9tYWluUGF0dGVybihkb21haW4pXG4gIH1cbiAgcmV0dXJuIGlzVmFsaWREb21haW5QYXR0ZXJuKHApXG59XG5cbmZ1bmN0aW9uIGlzVmFsaWREb21haW5QYXR0ZXJuKGRvbWFpbjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChkb21haW4uc3RhcnRzV2l0aCgnKi4nKSkge1xuICAgIGNvbnN0IHJlc3QgPSBkb21haW4uc2xpY2UoMilcbiAgICBpZiAoIXJlc3QgfHwgcmVzdC5pbmNsdWRlcygnKicpIHx8ICFyZXN0LmluY2x1ZGVzKCcuJykpIHJldHVybiBmYWxzZVxuICAgIHJldHVybiAvXlthLXowLTldKFthLXowLTktXSpbYS16MC05XSk/KFxcLlthLXowLTldKFthLXowLTktXSpbYS16MC05XSk/KSskL1xuICAgICAgLnRlc3QocmVzdClcbiAgfVxuICBpZiAoZG9tYWluLmluY2x1ZGVzKCcqJykpIHJldHVybiBmYWxzZVxuICByZXR1cm4gL15bYS16MC05XShbYS16MC05LV0qW2EtejAtOV0pPyhcXC5bYS16MC05XShbYS16MC05LV0qW2EtejAtOV0pPykrJC9cbiAgICAudGVzdChkb21haW4pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFydGlmYWN0U3RhdHVzKHN0YXR1czogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHN0YXR1cy50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIUFSVElGQUNUX1NUQVRVU0VTLmhhcyh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgYHN0YXR1cyBtdXN0IGJlIG9uZSBvZjogJHtbLi4uQVJUSUZBQ1RfU1RBVFVTRVNdLmpvaW4oJywgJyl9YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVGVtcGxhdGVOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCd0ZW1wbGF0ZSBuYW1lIGlzIHJlcXVpcmVkJylcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3RlbXBsYXRlIG5hbWUgaXMgdG9vIGxvbmcnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgcCA9IHBhdHRlcm4udHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFpc1ZhbGlkRnJvbVBhdHRlcm4ocCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihgaW52YWxpZCBtYXRjaEZyb21QYXR0ZXJuOiAke3BhdHRlcm59YClcbiAgfVxuICByZXR1cm4gcFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVTdWJqZWN0UmVnZXgoXG4gIHJlZ2V4OiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChyZWdleCA9PT0gbnVsbCB8fCByZWdleCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuICBjb25zdCB0cmltbWVkID0gcmVnZXgudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgcmV0dXJuIG51bGxcbiAgdHJ5IHtcbiAgICBuZXcgUmVnRXhwKHRyaW1tZWQsICdpJylcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ21hdGNoU3ViamVjdFJlZ2V4IGlzIG5vdCBhIHZhbGlkIHJlZ2V4cCcpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ2F0ZWdvcnlJZChjYXRlZ29yeUlkOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKFxuICAgIHR5cGVvZiBjYXRlZ29yeUlkICE9PSAnbnVtYmVyJyB8fFxuICAgICFOdW1iZXIuaXNJbnRlZ2VyKGNhdGVnb3J5SWQpIHx8XG4gICAgY2F0ZWdvcnlJZCA8IDFcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICAnY2F0ZWdvcnlJZCBpcyByZXF1aXJlZCB3aGVuIGFjY2VwdGluZyBhIHNwZW5kaW5nIGNhbmRpZGF0ZScsXG4gICAgKVxuICB9XG4gIHJldHVybiBjYXRlZ29yeUlkXG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVtb3RlSldLU2V0LCBqd3RWZXJpZnkgfSBmcm9tICdqb3NlJ1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcblxuY29uc3QgQVVUSF9BUElfRE9NQUlOID1cbiAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVVUSF9BUElfRE9NQUlOKSB8fFxuICAnaHR0cDovL2xvY2FsaG9zdDozMDAxJ1xuY29uc3QgSldLU19VUkwgPSBgJHtBVVRIX0FQSV9ET01BSU59L2F1dGgvand0L2p3a3MuanNvbmBcblxuY29uc3QgandrcyA9IGNyZWF0ZVJlbW90ZUpXS1NldChuZXcgVVJMKEpXS1NfVVJMKSlcblxuZXhwb3J0IHR5cGUgVmVyaWZpZWRBdXRoID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUFjY2Vzc1Rva2VuKFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4pOiBQcm9taXNlPFZlcmlmaWVkQXV0aCB8IG51bGw+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBhdXRob3JpemF0aW9uSGVhZGVyLnNsaWNlKCdCZWFyZXIgJy5sZW5ndGgpLnRyaW0oKVxuICBpZiAoIXRva2VuKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBwYXlsb2FkIH0gPSBhd2FpdCBqd3RWZXJpZnkodG9rZW4sIGp3a3MsIHtcbiAgICAgIGFsZ29yaXRobXM6IFsnUlMyNTYnXSxcbiAgICB9KVxuXG4gICAgY29uc3QgYXV0aFVzZXJJZCA9IHR5cGVvZiBwYXlsb2FkLnN1YiA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLnN1YiA6IG51bGxcbiAgICBpZiAoIWF1dGhVc2VySWQpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgZW1haWwgPVxuICAgICAgdHlwZW9mIHBheWxvYWQuZW1haWwgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5lbWFpbCA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHsgYXV0aFVzZXJJZCwgZW1haWwgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpOiBSZXNwb25zZSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1VuYXV0aG9yaXplZCcgfSksIHtcbiAgICBzdGF0dXM6IDQwMSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgfSxcbiAgfSlcbn1cblxuLyoqIENPUlMgcHJlZmxpZ2h0IC8gc2ltcGxlIHJlc3BvbnNlcyBmb3IgYnJvd3NlciBHcmFwaFFMIGNsaWVudHMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29yc01pZGRsZXdhcmUoY3R4OiBDb250ZXh0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7XG4gICAgICBzdGF0dXM6IDIwNCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcblxuICBjdHgucmVzLmhlYWRlcnMuc2V0KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLFxuICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gIClcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsXG4gICAgJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gIClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHtcbiAgdW5hdXRob3JpemVkUmVzcG9uc2UsXG4gIHZlcmlmeUFjY2Vzc1Rva2VuLFxuICB0eXBlIFZlcmlmaWVkQXV0aCxcbn0gZnJvbSAnLi4vYXV0aC92ZXJpZnkudHMnXG5cbi8qKiBQdWJsaWMgQUxCIC8gbG9hZC1iYWxhbmNlciBoZWFsdGggY2hlY2suICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGVhbHRoTWlkZGxld2FyZShcbiAgY3R4OiBDb250ZXh0LFxuICBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuKSB7XG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuICBpZiAocGF0aCA9PT0gJy9oZWFsdGgnICYmIGN0eC5yZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogdHJ1ZSB9KSwge1xuICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cbiAgYXdhaXQgbmV4dCgpXG59XG5cbmV4cG9ydCB0eXBlIExvY2FsVXNlclJlZiA9IHtcbiAgaWQ6IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBSZXNvbHZlTG9jYWxVc2VyRm4gPSAoXG4gIGlkZW50aXR5OiBWZXJpZmllZEF1dGgsXG4pID0+IFByb21pc2U8TG9jYWxVc2VyUmVmPlxuXG4vKipcbiAqIFJlcXVpcmUgYSB2YWxpZCBCZWFyZXIgSldUIG9uIGAvZ3JhcGhxbGAgYW5kIHNldCBQeWxvbiBjb250ZXh0IHZhcnM6XG4gKiBgdXNlcklkYCwgYGF1dGhVc2VySWRgLCBvcHRpb25hbCBgYXV0aEVtYWlsYC5cbiAqXG4gKiBDYWxsZXJzIHRoYXQgbmVlZCBhdXRoIGZvciBvdGhlciBwYXRocyAoZS5nLiBSRVNUIGFzc2V0cykgc2hvdWxkIGhhbmRsZVxuICogdGhvc2UgYmVmb3JlIHRoaXMgbWlkZGxld2FyZSBvciB1c2UgYHZlcmlmeUFjY2Vzc1Rva2VuYCBkaXJlY3RseS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZShcbiAgcmVzb2x2ZUxvY2FsVXNlcjogUmVzb2x2ZUxvY2FsVXNlckZuLFxuKSB7XG4gIHJldHVybiBhc3luYyBmdW5jdGlvbiBncmFwaFFMQXV0aE1pZGRsZXdhcmUoXG4gICAgY3R4OiBDb250ZXh0LFxuICAgIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4sXG4gICkge1xuICAgIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgICBhd2FpdCBuZXh0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuXG4gICAgaWYgKFxuICAgICAgcGF0aCA9PT0gJy9oZWFsdGgnIHx8XG4gICAgICAocGF0aCAhPT0gJy9ncmFwaHFsJyAmJiAhcGF0aC5lbmRzV2l0aCgnL2dyYXBocWwnKSlcbiAgICApIHtcbiAgICAgIGF3YWl0IG5leHQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlBY2Nlc3NUb2tlbihjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpKVxuICAgIGlmICghdmVyaWZpZWQpIHtcbiAgICAgIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbG9jYWxVc2VyID0gYXdhaXQgcmVzb2x2ZUxvY2FsVXNlcih2ZXJpZmllZClcblxuICAgIGN0eC5zZXQoJ2F1dGhVc2VySWQnLCB2ZXJpZmllZC5hdXRoVXNlcklkKVxuICAgIGlmICh2ZXJpZmllZC5lbWFpbCkge1xuICAgICAgY3R4LnNldCgnYXV0aEVtYWlsJywgdmVyaWZpZWQuZW1haWwpXG4gICAgfVxuICAgIGN0eC5zZXQoJ3VzZXJJZCcsIGxvY2FsVXNlci5pZClcblxuICAgIGF3YWl0IG5leHQoKVxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEt5c2VseSwgU2VsZWN0YWJsZSB9IGZyb20gJ2t5c2VseSdcblxuLyoqIE1pbmltYWwgdXNlcnMgdGFibGUgc2hhcGUgcmVxdWlyZWQgYnkgcmVzb2x2ZUxvY2FsVXNlci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXNlcnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBlbWFpbDogc3RyaW5nXG4gIHBhc3N3b3JkX2hhc2g6IHN0cmluZyB8IG51bGxcbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIFVzZXJzRGF0YWJhc2UgPSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG59XG5cbmV4cG9ydCB0eXBlIExvY2FsVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQXV0aElkZW50aXR5ID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbiAgbmFtZT86IHN0cmluZ1xufVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcjxEQiBleHRlbmRzIFVzZXJzRGF0YWJhc2U+KFxuICBkYjogS3lzZWx5PERCPixcbiAgaWRlbnRpdHk6IEF1dGhJZGVudGl0eSxcbik6IFByb21pc2U8U2VsZWN0YWJsZTxEQlsndXNlcnMnXT4+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdhdXRoX3VzZXJfaWQnLCAnPScsIGlkZW50aXR5LmF1dGhVc2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChleGlzdGluZykge1xuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgY29uc3QgZW1haWwgPVxuICAgIGlkZW50aXR5LmVtYWlsPy50cmltKCkgfHxcbiAgICBgJHtpZGVudGl0eS5hdXRoVXNlcklkfUB1c2Vycy5sb2NhbGBcbiAgY29uc3QgbmFtZSA9XG4gICAgaWRlbnRpdHkubmFtZT8udHJpbSgpIHx8XG4gICAgZW1haWwuc3BsaXQoJ0AnKVswXSB8fFxuICAgICdVc2VyJ1xuXG4gIC8vIFByZWZlciBsaW5raW5nIGFuIGV4aXN0aW5nIGVtYWlsIHJvdyAoZS5nLiBzZWVkZWQgZGV2IHVzZXIpIHdoZW4gcHJlc2VudC5cbiAgY29uc3QgYnlFbWFpbCA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2VtYWlsJywgJz0nLCBlbWFpbClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGJ5RW1haWwpIHtcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgndXNlcnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgICAgbmFtZTogYnlFbWFpbC5uYW1lIHx8IG5hbWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBieUVtYWlsLmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ3VzZXJzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGVtYWlsLFxuICAgICAgbmFtZSxcbiAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgIHBhc3N3b3JkX2hhc2g6IG51bGwsXG4gICAgfSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuIiwgImltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYXRhYmFzZS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgYXMgcmVzb2x2ZUxvY2FsVXNlcktpdCB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cydcbmltcG9ydCB0eXBlIHsgQXV0aElkZW50aXR5IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBVc2VyIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIHsgQXV0aElkZW50aXR5IH1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVMb2NhbFVzZXIoaWRlbnRpdHk6IEF1dGhJZGVudGl0eSk6IFByb21pc2U8VXNlcj4ge1xuICByZXR1cm4gcmVzb2x2ZUxvY2FsVXNlcktpdChkYiwgaWRlbnRpdHkpXG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsU0FBUyxXQUFXOzs7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S0FBSyxLQUFLLEVBQ3pCLFVBQVUsRUFDVixpQkFBaUI7QUFFcEIsTUFBSSxTQUFTO0FBQ1gsV0FBTyxNQUFNQSxJQUNWLFlBQVksT0FBTyxFQUNuQixJQUFJO0FBQUEsTUFDSCxjQUFjLFNBQVM7QUFBQSxNQUN2QixNQUFNLFFBQVEsUUFBUTtBQUFBLE1BQ3RCLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNyQyxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssUUFBUSxFQUFFLEVBQzNCLGFBQWEsRUFDYix3QkFBd0I7QUFBQSxFQUM3QjtBQUVBLFNBQU8sTUFBTUEsSUFDVixXQUFXLE9BQU8sRUFDbEIsT0FBTztBQUFBLElBQ047QUFBQSxJQUNBO0FBQUEsSUFDQSxjQUFjLFNBQVM7QUFBQSxJQUN2QixlQUFlO0FBQUEsRUFDakIsQ0FBQyxFQUNBLGFBQWEsRUFDYix3QkFBd0I7QUFDN0I7OztBQ3pFQSxlQUFzQkMsa0JBQWlCLFVBQXVDO0FBQzVFLFNBQU8saUJBQW9CLElBQUksUUFBUTtBQUN6Qzs7O0FoQlVNLFNBQVEsV0FBVyw4QkFBNkI7QUFWdEQsSUFBSSxJQUFJLGNBQWM7QUFDdEIsSUFBSSxJQUFJLGdCQUFnQjtBQUN4QixJQUFJLElBQUksNEJBQTRCQyxpQkFBZ0IsQ0FBQztBQUU5QyxJQUFNLFVBQVU7QUFBQSxFQUNyQixHQUFHO0FBQ0w7QUFFQSxJQUFPLGNBQVE7QUFJVCxJQUFJLHdCQUF3QjtBQUU1QixJQUFJO0FBQ0YsMEJBQXdCO0FBQzFCLFFBQVE7QUFFUjtBQUVBLElBQUksSUFBSSx1QkFBdUI7QUFBQSxFQUM3QixVQUFVO0FBQUEsRUFDVjtBQUFBLEVBQ0EsV0FBVyxDQUFDO0FBQUEsRUFDWixRQUFRO0FBQ1YsQ0FBQyxDQUFDOyIsCiAgIm5hbWVzIjogWyJyb3ciLCAicmVzb2x2ZUxvY2FsVXNlciIsICJkYiIsICJyZXNvbHZlTG9jYWxVc2VyIiwgInJlc29sdmVMb2NhbFVzZXIiXQp9Cg==
