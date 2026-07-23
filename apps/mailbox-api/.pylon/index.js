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
  if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
    return Deno.env.get(name);
  }
  return void 0;
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
  const baseUrl = (options?.baseUrl ?? env("AI_API_BASE_URL") ?? "http://localhost:3004").replace(/\/$/, "");
  const serviceKey = options?.serviceKey ?? env("AI_SERVICE_KEY");
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

// src/services/message_lookups.ts
function mapOwnedMessage(row) {
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
function createKyselyMessageLookupStore(db2) {
  return {
    async findOwnedMessageRow(userId, messageId) {
      return await db2.selectFrom("messages").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").selectAll("messages").where("messages.id", "=", messageId).where("mailboxes.user_id", "=", userId).executeTakeFirst();
    },
    async findSourceMessageRow(userId, expenseId) {
      return await db2.selectFrom("extraction_artifacts").innerJoin(
        "messages",
        "messages.id",
        "extraction_artifacts.message_id"
      ).innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").selectAll("messages").where("extraction_artifacts.published_expense_id", "=", expenseId).where("extraction_artifacts.status", "=", "accepted").where("mailboxes.user_id", "=", userId).orderBy("extraction_artifacts.id", "desc").executeTakeFirst();
    }
  };
}
async function findOwnedMessage(store, userId, messageId) {
  const row = await store.findOwnedMessageRow(userId, messageId);
  return row ? mapOwnedMessage(row) : null;
}
async function findSourceMessageForExpense(store, userId, expenseId) {
  const row = await store.findSourceMessageRow(userId, expenseId);
  return row ? mapOwnedMessage(row) : null;
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
  const baseUrl = (options?.baseUrl ?? env("SPENDMANAGER_API_BASE_URL") ?? "http://localhost:3002").replace(/\/$/, "");
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

// src/services/gmail_oauth.ts
var GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
var GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
var GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
var STATE_TTL_SECONDS = 10 * 60;
var GmailOAuthError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "GmailOAuthError";
  }
};
function loadGmailOAuthConfig(env2) {
  const source = env2 ?? {
    GMAIL_OAUTH_CLIENT_ID: env("GMAIL_OAUTH_CLIENT_ID"),
    GMAIL_OAUTH_CLIENT_SECRET: env("GMAIL_OAUTH_CLIENT_SECRET"),
    GMAIL_OAUTH_REDIRECT_URI: env("GMAIL_OAUTH_REDIRECT_URI"),
    GMAIL_OAUTH_RETURN_TO_ALLOWLIST: env("GMAIL_OAUTH_RETURN_TO_ALLOWLIST")
  };
  const clientId = source.GMAIL_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = source.GMAIL_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = source.GMAIL_OAUTH_REDIRECT_URI?.trim() || "http://localhost:3003/oauth/gmail/callback";
  const allowRaw = source.GMAIL_OAUTH_RETURN_TO_ALLOWLIST?.trim() || "http://localhost:4445,spendmanager://settings/email-import";
  const returnToAllowlist = allowRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!clientId || !clientSecret) {
    throw new GmailOAuthError(
      "GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET are required"
    );
  }
  if (returnToAllowlist.length === 0) {
    throw new GmailOAuthError("GMAIL_OAUTH_RETURN_TO_ALLOWLIST is empty");
  }
  return { clientId, clientSecret, redirectUri, returnToAllowlist };
}
function isReturnToAllowed(returnTo, allowlist) {
  let url;
  try {
    url = new URL(returnTo);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.hash) return false;
  for (const entry of allowlist) {
    if (!entry) continue;
    try {
      const allowed = new URL(entry);
      if (url.protocol === allowed.protocol && url.host === allowed.host) {
        if (!allowed.pathname || allowed.pathname === "/") return true;
        const prefix = allowed.pathname.endsWith("/") ? allowed.pathname : `${allowed.pathname}/`;
        if (url.pathname === allowed.pathname || url.pathname.startsWith(prefix)) {
          return true;
        }
      }
    } catch {
      if (returnTo === entry || returnTo.startsWith(`${entry}`)) {
        return true;
      }
    }
  }
  return false;
}
function bytesToBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlToBytes(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
async function signOAuthState(payload, clientSecret, nowMs = Date.now()) {
  const body = {
    userId: payload.userId,
    mailboxId: payload.mailboxId,
    returnTo: payload.returnTo,
    exp: payload.exp ?? Math.floor(nowMs / 1e3) + STATE_TTL_SECONDS
  };
  const payloadB64 = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(body))
  );
  const key = await hmacKey(clientSecret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return `${payloadB64}.${bytesToBase64Url(new Uint8Array(sig))}`;
}
async function verifyOAuthState(state, clientSecret, nowMs = Date.now()) {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GmailOAuthError("invalid OAuth state");
  }
  const [payloadB64, sigB64] = parts;
  const key = await hmacKey(clientSecret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(sigB64),
    new TextEncoder().encode(payloadB64)
  );
  if (!ok) throw new GmailOAuthError("invalid OAuth state signature");
  let body;
  try {
    body = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payloadB64))
    );
  } catch {
    throw new GmailOAuthError("invalid OAuth state payload");
  }
  if (typeof body.userId !== "number" || typeof body.mailboxId !== "number" || typeof body.returnTo !== "string" || typeof body.exp !== "number") {
    throw new GmailOAuthError("invalid OAuth state fields");
  }
  if (body.exp < Math.floor(nowMs / 1e3)) {
    throw new GmailOAuthError("OAuth state expired");
  }
  return body;
}
function buildGoogleAuthorizeUrl(options) {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: options.scope ?? GMAIL_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: options.state
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}
async function exchangeAuthorizationCode(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(options.tokenUrl ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      grant_type: "authorization_code"
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GmailOAuthError(
      `token exchange failed (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new GmailOAuthError("token exchange missing access_token");
  }
  const expiresAtMs = typeof json.expires_in === "number" ? Date.now() + json.expires_in * 1e3 : null;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAtMs
  };
}
var GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
async function fetchGmailEmailAddress(options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.profileUrl ?? GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${options.accessToken}` }
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (typeof json.emailAddress !== "string") return null;
    const email = json.emailAddress.trim();
    return email.length > 0 && email.length <= 255 ? email : null;
  } catch {
    return null;
  }
}
function buildReturnRedirect(returnTo, result) {
  const url = new URL(returnTo);
  if (result.ok) {
    url.searchParams.set("gmail", "connected");
    url.searchParams.delete("error");
  } else {
    url.searchParams.set("gmail", "error");
    url.searchParams.set("error", result.error.slice(0, 200));
  }
  return url.toString();
}

// src/graphql/validation.ts
import { ServiceError } from "@getcronit/pylon";
var PROVIDERS = /* @__PURE__ */ new Set(["fixture", "gmail"]);
var ARTIFACT_STATUSES = /* @__PURE__ */ new Set(["pending", "accepted", "rejected"]);
var InvalidMailboxError = class extends ServiceError {
  constructor(message) {
    super(message, {
      code: "INVALID_MAILBOX_INPUT",
      statusCode: 400
    });
    this.name = "InvalidMailboxError";
  }
};
var FROM_PATTERN_HELP = "Allowed patterns: shop.com, *.shop.com, user@shop.com, *@shop.com, *@*.shop.com";
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
      throw new InvalidMailboxError(describeInvalidFromPattern(raw, "domain filter"));
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
    throw new InvalidMailboxError(
      describeInvalidFromPattern(pattern, "matchFromPattern")
    );
  }
  return p;
}
function describeInvalidFromPattern(raw, label) {
  const p = raw.trim().toLowerCase();
  const prefix = `invalid ${label} "${raw}"`;
  if (!p) {
    return `${prefix}: pattern is empty. ${FROM_PATTERN_HELP}`;
  }
  if (p.startsWith("*") && !p.startsWith("*.") && !p.startsWith("*@")) {
    const rest = p.slice(1);
    if (rest.includes(".") && !rest.includes("*") && isValidDomainPattern(rest)) {
      return `${prefix}: use "*.${rest}" for subdomains of ${rest}, or "${rest}" for that domain and its subdomains. ${FROM_PATTERN_HELP}`;
    }
    return `${prefix}: wildcard must be "*.domain.tld" or "*@domain.tld". ` + FROM_PATTERN_HELP;
  }
  if (p.startsWith("*.") && !p.slice(2).includes(".") || p.includes("@") && p.endsWith("@*")) {
    return `${prefix}: wildcard needs a multi-part domain (e.g. "*.shop.com"), not a bare TLD. ${FROM_PATTERN_HELP}`;
  }
  if (!p.includes(".") && !p.includes("@")) {
    return `${prefix}: must include a domain with a dot (e.g. "shop.com"). ` + FROM_PATTERN_HELP;
  }
  return `${prefix}. ${FROM_PATTERN_HELP}`;
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
  async message(id) {
    const userId = requireUserId();
    return await findOwnedMessage(createKyselyMessageLookupStore(db), userId, id);
  },
  async sourceMessageForExpense(expenseId) {
    const userId = requireUserId();
    return await findSourceMessageForExpense(
      createKyselyMessageLookupStore(db),
      userId,
      expenseId
    );
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
  async updateMailbox(input) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, input.id);
    const label = validateLabel(input.label);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.updateTable("mailboxes").set({ label, updated_at: now }).where("id", "=", input.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return mapMailbox(row);
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
    const accessToken = input.accessToken.trim();
    const tokens = {
      accessToken,
      refreshToken: input.refreshToken ?? null,
      expiresAtMs: input.expiresAtMs ?? null
    };
    const email = await fetchGmailEmailAddress({ accessToken });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.updateTable("mailboxes").set({
      oauth_tokens_json: JSON.stringify(tokens),
      ...email ? { label: email } : {},
      sync_requested: true,
      updated_at: now
    }).where("id", "=", mailbox.id).returningAll().executeTakeFirstOrThrow();
    return mapMailbox(row);
  },
  async startGmailOAuth(input) {
    const userId = requireUserId();
    const mailbox = await requireOwnedMailbox(userId, input.mailboxId);
    if (mailbox.provider !== "gmail") {
      throw new InvalidMailboxError("mailbox provider is not gmail");
    }
    const returnTo = input.returnTo?.trim() ?? "";
    if (!returnTo) {
      throw new InvalidMailboxError("returnTo is required");
    }
    let config2;
    try {
      config2 = loadGmailOAuthConfig();
    } catch (err) {
      if (err instanceof GmailOAuthError) {
        throw new InvalidMailboxError(err.message);
      }
      throw err;
    }
    if (!isReturnToAllowed(returnTo, config2.returnToAllowlist)) {
      throw new InvalidMailboxError("returnTo is not allowed");
    }
    const state = await signOAuthState(
      { userId, mailboxId: mailbox.id, returnTo },
      config2.clientSecret
    );
    const authorizationUrl = buildGoogleAuthorizeUrl({
      clientId: config2.clientId,
      redirectUri: config2.redirectUri,
      state
    });
    return { authorizationUrl };
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
    const genericFailMessage = "Template generation failed. Please try again.";
    const failTemplateGeneration = (reason, details) => {
      console.error(
        "[mailbox-api] template generation failed:",
        reason,
        details ?? ""
      );
      throw new InvalidMailboxError(genericFailMessage);
    };
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
        failTemplateGeneration(err.message, { messageId: message.id });
      }
      throw err;
    }
    let matchFromPattern;
    let matchSubjectRegex;
    let extractors;
    try {
      matchFromPattern = validateMatchFromPattern(aiOut.matchFromPattern);
      matchSubjectRegex = validateSubjectRegex(aiOut.matchSubjectRegex);
      const parsed = parseSpendTemplateExtractors(aiOut.extractors);
      if (!parsed) {
        failTemplateGeneration("AI returned invalid extractors", {
          messageId: message.id,
          extractors: aiOut.extractors
        });
      }
      extractors = parsed;
    } catch (err) {
      if (err instanceof InvalidMailboxError && err.message === genericFailMessage) {
        throw err;
      }
      if (err instanceof InvalidMailboxError) {
        failTemplateGeneration(err.message, {
          messageId: message.id,
          matchFromPattern: aiOut.matchFromPattern,
          matchSubjectRegex: aiOut.matchSubjectRegex
        });
      }
      throw err;
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

// src/services/gmail_oauth_callback.ts
async function handleGmailOAuthCallback(requestUrl, deps) {
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const oauthError = requestUrl.searchParams.get("error");
  let config2;
  try {
    config2 = (deps.loadConfig ?? loadGmailOAuthConfig)();
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_config_error";
    return new Response(`Gmail OAuth misconfigured: ${message}`, {
      status: 500
    });
  }
  let returnToFallback = null;
  if (state) {
    try {
      const payload2 = await verifyOAuthState(
        state,
        config2.clientSecret,
        deps.nowMs
      );
      returnToFallback = payload2.returnTo;
    } catch {
    }
  }
  const redirectError = (error, returnTo) => {
    if (returnTo && isReturnToAllowed(returnTo, config2.returnToAllowlist)) {
      return Response.redirect(
        buildReturnRedirect(returnTo, { ok: false, error }),
        302
      );
    }
    return new Response(`Gmail OAuth failed: ${error}`, { status: 400 });
  };
  if (oauthError) {
    return redirectError(oauthError, returnToFallback);
  }
  if (!code || !state) {
    return redirectError("missing_code_or_state", returnToFallback);
  }
  let payload;
  try {
    payload = await verifyOAuthState(state, config2.clientSecret, deps.nowMs);
  } catch (err) {
    const message = err instanceof GmailOAuthError ? err.message : "invalid_state";
    return redirectError(message, returnToFallback);
  }
  if (!isReturnToAllowed(payload.returnTo, config2.returnToAllowlist)) {
    return new Response("Gmail OAuth failed: returnTo is not allowed", {
      status: 400
    });
  }
  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      clientId: config2.clientId,
      clientSecret: config2.clientSecret,
      redirectUri: config2.redirectUri,
      fetchImpl: deps.fetchImpl
    });
    const mailbox = await deps.db.selectFrom("mailboxes").select(["id", "user_id", "provider"]).where("id", "=", payload.mailboxId).executeTakeFirst();
    if (!mailbox || mailbox.user_id !== payload.userId) {
      return redirectError("mailbox_not_found", payload.returnTo);
    }
    if (mailbox.provider !== "gmail") {
      return redirectError("mailbox_not_gmail", payload.returnTo);
    }
    const now = new Date(
      deps.nowMs ?? Date.now()
    ).toISOString();
    const email = await fetchGmailEmailAddress({
      accessToken: tokens.accessToken,
      fetchImpl: deps.fetchImpl
    });
    await deps.db.updateTable("mailboxes").set({
      oauth_tokens_json: JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAtMs: tokens.expiresAtMs
      }),
      ...email ? { label: email } : {},
      sync_requested: true,
      updated_at: now
    }).where("id", "=", mailbox.id).execute();
    return Response.redirect(
      buildReturnRedirect(payload.returnTo, { ok: true }),
      302
    );
  } catch (err) {
    const message = err instanceof GmailOAuthError ? err.message : "token_exchange_failed";
    return redirectError(message, payload.returnTo);
  }
}

// src/index.ts
import { handler as __internalPylonHandler } from "@getcronit/pylon";
app.use(corsMiddleware);
app.use(healthMiddleware);
app.use(async (ctx, next) => {
  if (ctx.req.method === "OPTIONS") {
    await next();
    return;
  }
  const url = new URL(ctx.req.url);
  if (url.pathname === "/oauth/gmail/callback" && ctx.req.method === "GET") {
    return handleGmailOAuthCallback(url, { db });
  }
  await next();
});
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
  typeDefs: "input CreateMailboxInputInput {\n	provider: String!\n	label: String!\n	enabled: Boolean\n	domainFilters: [String!]\n	oauthTokensJson: String\n}\ninput UpdateMailboxInputInput {\n	id: Number!\n	label: String!\n}\ninput SetDomainFiltersInputInput {\n	mailboxId: Number!\n	patterns: [String!]!\n}\ninput UpdateArtifactStatusInputInput {\n	artifactId: Number!\n	status: String!\n	categoryId: Number\n}\ninput ConnectGmailInputInput {\n	mailboxId: Number!\n	accessToken: String!\n	refreshToken: String\n	expiresAtMs: Number\n}\ninput StartGmailOAuthInputInput {\n	mailboxId: Number!\n	returnTo: String!\n}\ninput CreateParsingTemplateInputInput {\n	mailboxId: Number!\n	name: String!\n	matchFromPattern: String!\n	matchSubjectRegex: String\n	extractorsJson: String!\n	enabled: Boolean\n	sourceMessageId: Number\n}\ninput UpdateParsingTemplateInputInput {\n	id: Number!\n	name: String\n	matchFromPattern: String\n	matchSubjectRegex: String\n	extractorsJson: String\n	enabled: Boolean\n}\ninput GenerateParsingTemplateInputInput {\n	messageId: Number!\n	name: String\n	hints: String\n}\ntype Query {\nmailboxes: [Mailbox!]!\ndomainFilters(mailboxId: Number!): [DomainFilter!]!\nmessages(mailboxId: Number!): [Message!]!\nmessage(id: Number!): Message\nsourceMessageForExpense(expenseId: Number!): Message\nextractionArtifacts(mailboxId: Number, status: String): [ExtractionArtifact!]!\nsyncRuns(mailboxId: Number!): [SyncRun!]!\nparsingTemplates(mailboxId: Number!): [ParsingTemplate!]!\n}\ntype Mailbox {\nid: Number!\nuser_id: Number!\nprovider: String!\nlabel: String!\nenabled: Boolean!\nsync_cursor: String\nsync_requested: Boolean!\nlast_synced_at: String\ncreated_at: String!\nupdated_at: String!\n}\ntype DomainFilter {\nid: Number!\nmailbox_id: Number!\npattern: String!\ncreated_at: String!\n}\ntype Message {\nid: Number!\nmailbox_id: Number!\nprovider_message_id: String!\nrfc_message_id: String!\nfrom_address: String!\nsubject: String!\nreceived_at: String!\ntext_body: String\nhtml_body: String\ncreated_at: String!\n}\ntype ExtractionArtifact {\nid: Number!\nmessage_id: Number!\nkind: String!\npayload: String!\nconfidence: Number!\nstatus: String!\npublished_expense_id: Number\ncreated_at: String!\nupdated_at: String!\n}\ntype SyncRun {\nid: Number!\nmailbox_id: Number!\nstarted_at: String!\nfinished_at: String\nfetched_count: Number!\nextracted_count: Number!\nerror_text: String\n}\ntype ParsingTemplate {\nid: Number!\nmailbox_id: Number!\nuser_id: Number!\nname: String!\nenabled: Boolean!\nmatch_from_pattern: String!\nmatch_subject_regex: String\nextractors: String!\nsource_message_id: Number\nversion: Number!\ncreated_at: String!\nupdated_at: String!\n}\ntype Mutation {\ncreateMailbox(input: CreateMailboxInputInput!): Mailbox!\nupdateMailbox(input: UpdateMailboxInputInput!): Mailbox!\ndeleteMailbox(id: Number!): Boolean!\nsetDomainFilters(input: SetDomainFiltersInputInput!): [DomainFilter!]!\ntriggerSync(mailboxId: Number!): Mailbox!\nupdateArtifactStatus(input: UpdateArtifactStatusInputInput!): ExtractionArtifact!\nconnectGmail(input: ConnectGmailInputInput!): Mailbox!\nstartGmailOAuth(input: StartGmailOAuthInputInput!): StartGmailOAuthPayload!\ncreateParsingTemplate(input: CreateParsingTemplateInputInput!): ParsingTemplate!\nupdateParsingTemplate(input: UpdateParsingTemplateInputInput!): ParsingTemplate!\ndeleteParsingTemplate(id: Number!): Boolean!\ngenerateParsingTemplate(input: GenerateParsingTemplateInputInput!): ParsingTemplate!\n}\ntype StartGmailOAuthPayload {\nauthorizationUrl: String!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vLi4vLi4vbGlicy9tYWlsYm94X2tpdC90eXBlcy50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2V4dHJhY3RvcnMvdGVtcGxhdGVfc3BlbmRpbmdfZXh0cmFjdG9yLnRzIiwgIi4uL3NyYy9kYi90eXBlcy9zY2hlbWEudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvY3JlYXRlX2t5c2VseS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvc3NsLnRzIiwgIi4uL3NyYy9kYi9kYXRhYmFzZS50cyIsICIuLi9zcmMvc2VydmljZXMvYWlfY2xpZW50LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3RpbWVzdGFtcHMudHMiLCAiLi4vc3JjL3NlcnZpY2VzL21lc3NhZ2VfbG9va3Vwcy50cyIsICIuLi9zcmMvc2VydmljZXMvc3BlbmRtYW5hZ2VyX2V4cGVuc2Vfc2luay50cyIsICIuLi9zcmMvc2VydmljZXMvZ21haWxfb2F1dGgudHMiLCAiLi4vc3JjL2dyYXBocWwvdmFsaWRhdGlvbi50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzIiwgIi4uL3NyYy9kYi91c2Vycy50cyIsICIuLi9zcmMvc2VydmljZXMvZ21haWxfb2F1dGhfY2FsbGJhY2sudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IGFwcCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQgeyByZXNvbHZlcnMgfSBmcm9tICcuL2dyYXBocWwvcmVzb2x2ZXJzL3Jlc29sdmVycy50cydcbmltcG9ydCB7IGNvcnNNaWRkbGV3YXJlIH0gZnJvbSAnZGVub19hcGlfa2l0L2F1dGgvdmVyaWZ5LnRzJ1xuaW1wb3J0IHtcbiAgY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlLFxuICBoZWFsdGhNaWRkbGV3YXJlLFxufSBmcm9tICdkZW5vX2FwaV9raXQvcHlsb24vbWlkZGxld2FyZS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgfSBmcm9tICcuL2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHsgaGFuZGxlR21haWxPQXV0aENhbGxiYWNrIH0gZnJvbSAnLi9zZXJ2aWNlcy9nbWFpbF9vYXV0aF9jYWxsYmFjay50cydcblxuYXBwLnVzZShjb3JzTWlkZGxld2FyZSlcbmFwcC51c2UoaGVhbHRoTWlkZGxld2FyZSlcblxuLyoqIFB1YmxpYyBHb29nbGUgT0F1dGggcmVkaXJlY3QgKGF1dGggaXMgc2lnbmVkIGBzdGF0ZWApLiAqL1xuYXBwLnVzZShhc3luYyAoY3R4LCBuZXh0KSA9PiB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgYXdhaXQgbmV4dCgpXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCB1cmwgPSBuZXcgVVJMKGN0eC5yZXEudXJsKVxuICBpZiAodXJsLnBhdGhuYW1lID09PSAnL29hdXRoL2dtYWlsL2NhbGxiYWNrJyAmJiBjdHgucmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcbiAgICByZXR1cm4gaGFuZGxlR21haWxPQXV0aENhbGxiYWNrKHVybCwgeyBkYiB9KVxuICB9XG5cbiAgYXdhaXQgbmV4dCgpXG59KVxuXG5hcHAudXNlKGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZShyZXNvbHZlTG9jYWxVc2VyKSlcblxuZXhwb3J0IGNvbnN0IGdyYXBocWwgPSB7XG4gIC4uLnJlc29sdmVycyxcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXBwXG5cbiAgICAgIGltcG9ydCB7aGFuZGxlciBhcyBfX2ludGVybmFsUHlsb25IYW5kbGVyfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiXG5cbiAgICAgIGxldCBfX2ludGVybmFsUHlsb25Db25maWcgPSB1bmRlZmluZWRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gY29uZmlnXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gY29uZmlnIGlzIG5vdCBkZWNsYXJlZCwgcHlsb25Db25maWcgcmVtYWlucyB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgYXBwLnVzZShfX2ludGVybmFsUHlsb25IYW5kbGVyKHtcbiAgICAgICAgdHlwZURlZnM6IFwiaW5wdXQgQ3JlYXRlTWFpbGJveElucHV0SW5wdXQge1xcblxcdHByb3ZpZGVyOiBTdHJpbmchXFxuXFx0bGFiZWw6IFN0cmluZyFcXG5cXHRlbmFibGVkOiBCb29sZWFuXFxuXFx0ZG9tYWluRmlsdGVyczogW1N0cmluZyFdXFxuXFx0b2F1dGhUb2tlbnNKc29uOiBTdHJpbmdcXG59XFxuaW5wdXQgVXBkYXRlTWFpbGJveElucHV0SW5wdXQge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0bGFiZWw6IFN0cmluZyFcXG59XFxuaW5wdXQgU2V0RG9tYWluRmlsdGVyc0lucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdHBhdHRlcm5zOiBbU3RyaW5nIV0hXFxufVxcbmlucHV0IFVwZGF0ZUFydGlmYWN0U3RhdHVzSW5wdXRJbnB1dCB7XFxuXFx0YXJ0aWZhY3RJZDogTnVtYmVyIVxcblxcdHN0YXR1czogU3RyaW5nIVxcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcbn1cXG5pbnB1dCBDb25uZWN0R21haWxJbnB1dElucHV0IHtcXG5cXHRtYWlsYm94SWQ6IE51bWJlciFcXG5cXHRhY2Nlc3NUb2tlbjogU3RyaW5nIVxcblxcdHJlZnJlc2hUb2tlbjogU3RyaW5nXFxuXFx0ZXhwaXJlc0F0TXM6IE51bWJlclxcbn1cXG5pbnB1dCBTdGFydEdtYWlsT0F1dGhJbnB1dElucHV0IHtcXG5cXHRtYWlsYm94SWQ6IE51bWJlciFcXG5cXHRyZXR1cm5UbzogU3RyaW5nIVxcbn1cXG5pbnB1dCBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0IHtcXG5cXHRtYWlsYm94SWQ6IE51bWJlciFcXG5cXHRuYW1lOiBTdHJpbmchXFxuXFx0bWF0Y2hGcm9tUGF0dGVybjogU3RyaW5nIVxcblxcdG1hdGNoU3ViamVjdFJlZ2V4OiBTdHJpbmdcXG5cXHRleHRyYWN0b3JzSnNvbjogU3RyaW5nIVxcblxcdGVuYWJsZWQ6IEJvb2xlYW5cXG5cXHRzb3VyY2VNZXNzYWdlSWQ6IE51bWJlclxcbn1cXG5pbnB1dCBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdG5hbWU6IFN0cmluZ1xcblxcdG1hdGNoRnJvbVBhdHRlcm46IFN0cmluZ1xcblxcdG1hdGNoU3ViamVjdFJlZ2V4OiBTdHJpbmdcXG5cXHRleHRyYWN0b3JzSnNvbjogU3RyaW5nXFxuXFx0ZW5hYmxlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQge1xcblxcdG1lc3NhZ2VJZDogTnVtYmVyIVxcblxcdG5hbWU6IFN0cmluZ1xcblxcdGhpbnRzOiBTdHJpbmdcXG59XFxudHlwZSBRdWVyeSB7XFxubWFpbGJveGVzOiBbTWFpbGJveCFdIVxcbmRvbWFpbkZpbHRlcnMobWFpbGJveElkOiBOdW1iZXIhKTogW0RvbWFpbkZpbHRlciFdIVxcbm1lc3NhZ2VzKG1haWxib3hJZDogTnVtYmVyISk6IFtNZXNzYWdlIV0hXFxubWVzc2FnZShpZDogTnVtYmVyISk6IE1lc3NhZ2VcXG5zb3VyY2VNZXNzYWdlRm9yRXhwZW5zZShleHBlbnNlSWQ6IE51bWJlciEpOiBNZXNzYWdlXFxuZXh0cmFjdGlvbkFydGlmYWN0cyhtYWlsYm94SWQ6IE51bWJlciwgc3RhdHVzOiBTdHJpbmcpOiBbRXh0cmFjdGlvbkFydGlmYWN0IV0hXFxuc3luY1J1bnMobWFpbGJveElkOiBOdW1iZXIhKTogW1N5bmNSdW4hXSFcXG5wYXJzaW5nVGVtcGxhdGVzKG1haWxib3hJZDogTnVtYmVyISk6IFtQYXJzaW5nVGVtcGxhdGUhXSFcXG59XFxudHlwZSBNYWlsYm94IHtcXG5pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5wcm92aWRlcjogU3RyaW5nIVxcbmxhYmVsOiBTdHJpbmchXFxuZW5hYmxlZDogQm9vbGVhbiFcXG5zeW5jX2N1cnNvcjogU3RyaW5nXFxuc3luY19yZXF1ZXN0ZWQ6IEJvb2xlYW4hXFxubGFzdF9zeW5jZWRfYXQ6IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgRG9tYWluRmlsdGVyIHtcXG5pZDogTnVtYmVyIVxcbm1haWxib3hfaWQ6IE51bWJlciFcXG5wYXR0ZXJuOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbn1cXG50eXBlIE1lc3NhZ2Uge1xcbmlkOiBOdW1iZXIhXFxubWFpbGJveF9pZDogTnVtYmVyIVxcbnByb3ZpZGVyX21lc3NhZ2VfaWQ6IFN0cmluZyFcXG5yZmNfbWVzc2FnZV9pZDogU3RyaW5nIVxcbmZyb21fYWRkcmVzczogU3RyaW5nIVxcbnN1YmplY3Q6IFN0cmluZyFcXG5yZWNlaXZlZF9hdDogU3RyaW5nIVxcbnRleHRfYm9keTogU3RyaW5nXFxuaHRtbF9ib2R5OiBTdHJpbmdcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgRXh0cmFjdGlvbkFydGlmYWN0IHtcXG5pZDogTnVtYmVyIVxcbm1lc3NhZ2VfaWQ6IE51bWJlciFcXG5raW5kOiBTdHJpbmchXFxucGF5bG9hZDogU3RyaW5nIVxcbmNvbmZpZGVuY2U6IE51bWJlciFcXG5zdGF0dXM6IFN0cmluZyFcXG5wdWJsaXNoZWRfZXhwZW5zZV9pZDogTnVtYmVyXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBTeW5jUnVuIHtcXG5pZDogTnVtYmVyIVxcbm1haWxib3hfaWQ6IE51bWJlciFcXG5zdGFydGVkX2F0OiBTdHJpbmchXFxuZmluaXNoZWRfYXQ6IFN0cmluZ1xcbmZldGNoZWRfY291bnQ6IE51bWJlciFcXG5leHRyYWN0ZWRfY291bnQ6IE51bWJlciFcXG5lcnJvcl90ZXh0OiBTdHJpbmdcXG59XFxudHlwZSBQYXJzaW5nVGVtcGxhdGUge1xcbmlkOiBOdW1iZXIhXFxubWFpbGJveF9pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuZW5hYmxlZDogQm9vbGVhbiFcXG5tYXRjaF9mcm9tX3BhdHRlcm46IFN0cmluZyFcXG5tYXRjaF9zdWJqZWN0X3JlZ2V4OiBTdHJpbmdcXG5leHRyYWN0b3JzOiBTdHJpbmchXFxuc291cmNlX21lc3NhZ2VfaWQ6IE51bWJlclxcbnZlcnNpb246IE51bWJlciFcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxudXBkYXRlZF9hdDogU3RyaW5nIVxcbn1cXG50eXBlIE11dGF0aW9uIHtcXG5jcmVhdGVNYWlsYm94KGlucHV0OiBDcmVhdGVNYWlsYm94SW5wdXRJbnB1dCEpOiBNYWlsYm94IVxcbnVwZGF0ZU1haWxib3goaW5wdXQ6IFVwZGF0ZU1haWxib3hJbnB1dElucHV0ISk6IE1haWxib3ghXFxuZGVsZXRlTWFpbGJveChpZDogTnVtYmVyISk6IEJvb2xlYW4hXFxuc2V0RG9tYWluRmlsdGVycyhpbnB1dDogU2V0RG9tYWluRmlsdGVyc0lucHV0SW5wdXQhKTogW0RvbWFpbkZpbHRlciFdIVxcbnRyaWdnZXJTeW5jKG1haWxib3hJZDogTnVtYmVyISk6IE1haWxib3ghXFxudXBkYXRlQXJ0aWZhY3RTdGF0dXMoaW5wdXQ6IFVwZGF0ZUFydGlmYWN0U3RhdHVzSW5wdXRJbnB1dCEpOiBFeHRyYWN0aW9uQXJ0aWZhY3QhXFxuY29ubmVjdEdtYWlsKGlucHV0OiBDb25uZWN0R21haWxJbnB1dElucHV0ISk6IE1haWxib3ghXFxuc3RhcnRHbWFpbE9BdXRoKGlucHV0OiBTdGFydEdtYWlsT0F1dGhJbnB1dElucHV0ISk6IFN0YXJ0R21haWxPQXV0aFBheWxvYWQhXFxuY3JlYXRlUGFyc2luZ1RlbXBsYXRlKGlucHV0OiBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0ISk6IFBhcnNpbmdUZW1wbGF0ZSFcXG51cGRhdGVQYXJzaW5nVGVtcGxhdGUoaW5wdXQ6IFVwZGF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQhKTogUGFyc2luZ1RlbXBsYXRlIVxcbmRlbGV0ZVBhcnNpbmdUZW1wbGF0ZShpZDogTnVtYmVyISk6IEJvb2xlYW4hXFxuZ2VuZXJhdGVQYXJzaW5nVGVtcGxhdGUoaW5wdXQ6IEdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXRJbnB1dCEpOiBQYXJzaW5nVGVtcGxhdGUhXFxufVxcbnR5cGUgU3RhcnRHbWFpbE9BdXRoUGF5bG9hZCB7XFxuYXV0aG9yaXphdGlvblVybDogU3RyaW5nIVxcbn1cXG5zY2FsYXIgSURcXG5zY2FsYXIgSW50XFxuc2NhbGFyIEZsb2F0XFxuc2NhbGFyIE51bWJlclxcbnNjYWxhciBBbnlcXG5zY2FsYXIgVm9pZFxcbnNjYWxhciBPYmplY3RcXG5zY2FsYXIgRmlsZVxcbnNjYWxhciBEYXRlXFxuc2NhbGFyIEpTT05cXG5zY2FsYXIgU3RyaW5nXFxuc2NhbGFyIEJvb2xlYW5cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7fSxcbiAgICAgICAgY29uZmlnOiBfX2ludGVybmFsUHlsb25Db25maWdcbiAgICAgIH0pKVxuICAgICAgIiwgImltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHtcbiAgU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQsXG4gIHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMsXG4gIHR5cGUgU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkLFxufSBmcm9tICdtYWlsYm94X2tpdC9tb2QudHMnXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4uLy4uL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHR5cGUgeyBOZXdNYWlsYm94IH0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHtcbiAgQWlDbGllbnRFcnJvcixcbiAgZ2VuZXJhdGVFbWFpbFNwZW5kVGVtcGxhdGUsXG59IGZyb20gJy4uLy4uL3NlcnZpY2VzL2FpX2NsaWVudC50cydcbmltcG9ydCB7XG4gIGNyZWF0ZUt5c2VseU1lc3NhZ2VMb29rdXBTdG9yZSxcbiAgZmluZE93bmVkTWVzc2FnZSxcbiAgZmluZFNvdXJjZU1lc3NhZ2VGb3JFeHBlbnNlLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9tZXNzYWdlX2xvb2t1cHMudHMnXG5pbXBvcnQge1xuICBTcGVuZG1hbmFnZXJTaW5rRXJyb3IsXG4gIHB1Ymxpc2hFeHBlbnNlVG9TcGVuZG1hbmFnZXIsXG59IGZyb20gJy4uLy4uL3NlcnZpY2VzL3NwZW5kbWFuYWdlcl9leHBlbnNlX3NpbmsudHMnXG5pbXBvcnQge1xuICBHbWFpbE9BdXRoRXJyb3IsXG4gIGJ1aWxkR29vZ2xlQXV0aG9yaXplVXJsLFxuICBmZXRjaEdtYWlsRW1haWxBZGRyZXNzLFxuICBpc1JldHVyblRvQWxsb3dlZCxcbiAgbG9hZEdtYWlsT0F1dGhDb25maWcsXG4gIHNpZ25PQXV0aFN0YXRlLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9nbWFpbF9vYXV0aC50cydcbmltcG9ydCB7IGFzSXNvVGltZXN0YW1wLCBhc0lzb1RpbWVzdGFtcE9yTnVsbCB9IGZyb20gJy4uL3RpbWVzdGFtcHMudHMnXG5pbXBvcnQgdHlwZSB7XG4gIENvbm5lY3RHbWFpbElucHV0LFxuICBDcmVhdGVNYWlsYm94SW5wdXQsXG4gIENyZWF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxuICBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxuICBTZXREb21haW5GaWx0ZXJzSW5wdXQsXG4gIFN0YXJ0R21haWxPQXV0aElucHV0LFxuICBVcGRhdGVBcnRpZmFjdFN0YXR1c0lucHV0LFxuICBVcGRhdGVNYWlsYm94SW5wdXQsXG4gIFVwZGF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxufSBmcm9tICcuLi90eXBlcy50cydcbmltcG9ydCB7XG4gIEludmFsaWRNYWlsYm94RXJyb3IsXG4gIHZhbGlkYXRlQXJ0aWZhY3RTdGF0dXMsXG4gIHZhbGlkYXRlQ2F0ZWdvcnlJZCxcbiAgdmFsaWRhdGVEb21haW5QYXR0ZXJucyxcbiAgdmFsaWRhdGVMYWJlbCxcbiAgdmFsaWRhdGVNYXRjaEZyb21QYXR0ZXJuLFxuICB2YWxpZGF0ZVByb3ZpZGVyLFxuICB2YWxpZGF0ZVN1YmplY3RSZWdleCxcbiAgdmFsaWRhdGVUZW1wbGF0ZU5hbWUsXG59IGZyb20gJy4uL3ZhbGlkYXRpb24udHMnXG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldCgndXNlcklkJylcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbmF1dGhlbnRpY2F0ZWQnKVxuICB9XG4gIHJldHVybiB1c2VySWRcbn1cblxuZnVuY3Rpb24gcmVxdWlyZUF1dGhvcml6YXRpb25IZWFkZXIoKTogc3RyaW5nIHtcbiAgY29uc3QgY3R4ID0gZ2V0Q29udGV4dCgpXG4gIGNvbnN0IGhlYWRlciA9IGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJylcbiAgaWYgKCFoZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtaXNzaW5nIEF1dGhvcml6YXRpb24gYmVhcmVyIHRva2VuJylcbiAgfVxuICByZXR1cm4gaGVhZGVyXG59XG5cbi8qKiBOYW1lZCByZXR1cm4gc2hhcGVzIHNvIFB5bG9uIGVtaXRzIEdyYXBoUUwgb2JqZWN0IHR5cGVzIChub3QgYEFueSFgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFpbGJveCB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIHByb3ZpZGVyOiBzdHJpbmdcbiAgbGFiZWw6IHN0cmluZ1xuICBlbmFibGVkOiBib29sZWFuXG4gIHN5bmNfY3Vyc29yOiBzdHJpbmcgfCBudWxsXG4gIHN5bmNfcmVxdWVzdGVkOiBib29sZWFuXG4gIGxhc3Rfc3luY2VkX2F0OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBEb21haW5GaWx0ZXIge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwYXR0ZXJuOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVzc2FnZSB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gIGZyb21fYWRkcmVzczogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZF9hdDogc3RyaW5nXG4gIHRleHRfYm9keTogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdGlvbkFydGlmYWN0IHtcbiAgaWQ6IG51bWJlclxuICBtZXNzYWdlX2lkOiBudW1iZXJcbiAga2luZDogc3RyaW5nXG4gIHBheWxvYWQ6IHN0cmluZ1xuICBjb25maWRlbmNlOiBudW1iZXJcbiAgc3RhdHVzOiBzdHJpbmdcbiAgcHVibGlzaGVkX2V4cGVuc2VfaWQ6IG51bWJlciB8IG51bGxcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IHN0cmluZ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNSdW4ge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBzdGFydGVkX2F0OiBzdHJpbmdcbiAgZmluaXNoZWRfYXQ6IHN0cmluZyB8IG51bGxcbiAgZmV0Y2hlZF9jb3VudDogbnVtYmVyXG4gIGV4dHJhY3RlZF9jb3VudDogbnVtYmVyXG4gIGVycm9yX3RleHQ6IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYXJzaW5nVGVtcGxhdGUge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hfc3ViamVjdF9yZWdleDogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiBzdHJpbmdcbiAgc291cmNlX21lc3NhZ2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdmVyc2lvbjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGFydEdtYWlsT0F1dGhQYXlsb2FkIHtcbiAgYXV0aG9yaXphdGlvblVybDogc3RyaW5nXG59XG5cbmZ1bmN0aW9uIG1hcE1haWxib3gocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIHByb3ZpZGVyOiBzdHJpbmdcbiAgbGFiZWw6IHN0cmluZ1xuICBlbmFibGVkOiBib29sZWFuXG4gIHN5bmNfY3Vyc29yOiBzdHJpbmcgfCBudWxsXG4gIHN5bmNfcmVxdWVzdGVkOiBib29sZWFuXG4gIGxhc3Rfc3luY2VkX2F0OiBEYXRlIHwgc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pOiBNYWlsYm94IHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIHVzZXJfaWQ6IHJvdy51c2VyX2lkLFxuICAgIHByb3ZpZGVyOiByb3cucHJvdmlkZXIsXG4gICAgbGFiZWw6IHJvdy5sYWJlbCxcbiAgICBlbmFibGVkOiByb3cuZW5hYmxlZCxcbiAgICBzeW5jX2N1cnNvcjogcm93LnN5bmNfY3Vyc29yLFxuICAgIHN5bmNfcmVxdWVzdGVkOiByb3cuc3luY19yZXF1ZXN0ZWQsXG4gICAgbGFzdF9zeW5jZWRfYXQ6IGFzSXNvVGltZXN0YW1wT3JOdWxsKHJvdy5sYXN0X3N5bmNlZF9hdCksXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICAgIHVwZGF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy51cGRhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBEb21haW5GaWx0ZXIocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHBhdHRlcm46IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KTogRG9tYWluRmlsdGVyIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHBhdHRlcm46IHJvdy5wYXR0ZXJuLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBNZXNzYWdlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwcm92aWRlcl9tZXNzYWdlX2lkOiBzdHJpbmdcbiAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdGV4dF9ib2R5Pzogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk/OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pOiBNZXNzYWdlIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHJvdy5wcm92aWRlcl9tZXNzYWdlX2lkLFxuICAgIHJmY19tZXNzYWdlX2lkOiByb3cucmZjX21lc3NhZ2VfaWQsXG4gICAgZnJvbV9hZGRyZXNzOiByb3cuZnJvbV9hZGRyZXNzLFxuICAgIHN1YmplY3Q6IHJvdy5zdWJqZWN0LFxuICAgIHJlY2VpdmVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cucmVjZWl2ZWRfYXQpLFxuICAgIHRleHRfYm9keTogcm93LnRleHRfYm9keSA/PyBudWxsLFxuICAgIGh0bWxfYm9keTogcm93Lmh0bWxfYm9keSA/PyBudWxsLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBBcnRpZmFjdChyb3c6IHtcbiAgaWQ6IG51bWJlclxuICBtZXNzYWdlX2lkOiBudW1iZXJcbiAga2luZDogc3RyaW5nXG4gIHBheWxvYWQ6IHVua25vd25cbiAgY29uZmlkZW5jZTogbnVtYmVyXG4gIHN0YXR1czogc3RyaW5nXG4gIHB1Ymxpc2hlZF9leHBlbnNlX2lkPzogbnVtYmVyIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pOiBFeHRyYWN0aW9uQXJ0aWZhY3Qge1xuICByZXR1cm4ge1xuICAgIGlkOiByb3cuaWQsXG4gICAgbWVzc2FnZV9pZDogcm93Lm1lc3NhZ2VfaWQsXG4gICAga2luZDogcm93LmtpbmQsXG4gICAgcGF5bG9hZDpcbiAgICAgIHR5cGVvZiByb3cucGF5bG9hZCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyByb3cucGF5bG9hZFxuICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHJvdy5wYXlsb2FkID8/IHt9KSxcbiAgICBjb25maWRlbmNlOiByb3cuY29uZmlkZW5jZSxcbiAgICBzdGF0dXM6IHJvdy5zdGF0dXMsXG4gICAgcHVibGlzaGVkX2V4cGVuc2VfaWQ6IHJvdy5wdWJsaXNoZWRfZXhwZW5zZV9pZCA/PyBudWxsLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgICB1cGRhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cudXBkYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwU3luY1J1bihyb3c6IHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgc3RhcnRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICBmaW5pc2hlZF9hdDogRGF0ZSB8IHN0cmluZyB8IG51bGxcbiAgZmV0Y2hlZF9jb3VudDogbnVtYmVyXG4gIGV4dHJhY3RlZF9jb3VudDogbnVtYmVyXG4gIGVycm9yX3RleHQ6IHN0cmluZyB8IG51bGxcbn0pOiBTeW5jUnVuIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHN0YXJ0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5zdGFydGVkX2F0KSxcbiAgICBmaW5pc2hlZF9hdDogYXNJc29UaW1lc3RhbXBPck51bGwocm93LmZpbmlzaGVkX2F0KSxcbiAgICBmZXRjaGVkX2NvdW50OiByb3cuZmV0Y2hlZF9jb3VudCxcbiAgICBleHRyYWN0ZWRfY291bnQ6IHJvdy5leHRyYWN0ZWRfY291bnQsXG4gICAgZXJyb3JfdGV4dDogcm93LmVycm9yX3RleHQsXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwUGFyc2luZ1RlbXBsYXRlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hfc3ViamVjdF9yZWdleDogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiB1bmtub3duXG4gIHNvdXJjZV9tZXNzYWdlX2lkOiBudW1iZXIgfCBudWxsXG4gIHZlcnNpb246IG51bWJlclxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pOiBQYXJzaW5nVGVtcGxhdGUge1xuICByZXR1cm4ge1xuICAgIGlkOiByb3cuaWQsXG4gICAgbWFpbGJveF9pZDogcm93Lm1haWxib3hfaWQsXG4gICAgdXNlcl9pZDogcm93LnVzZXJfaWQsXG4gICAgbmFtZTogcm93Lm5hbWUsXG4gICAgZW5hYmxlZDogcm93LmVuYWJsZWQsXG4gICAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiByb3cubWF0Y2hfZnJvbV9wYXR0ZXJuLFxuICAgIG1hdGNoX3N1YmplY3RfcmVnZXg6IHJvdy5tYXRjaF9zdWJqZWN0X3JlZ2V4LFxuICAgIGV4dHJhY3RvcnM6XG4gICAgICB0eXBlb2Ygcm93LmV4dHJhY3RvcnMgPT09ICdzdHJpbmcnXG4gICAgICAgID8gcm93LmV4dHJhY3RvcnNcbiAgICAgICAgOiBKU09OLnN0cmluZ2lmeShyb3cuZXh0cmFjdG9ycyA/PyB7fSksXG4gICAgc291cmNlX21lc3NhZ2VfaWQ6IHJvdy5zb3VyY2VfbWVzc2FnZV9pZCxcbiAgICB2ZXJzaW9uOiByb3cudmVyc2lvbixcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gICAgdXBkYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnVwZGF0ZWRfYXQpLFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlcXVpcmVPd25lZE1haWxib3godXNlcklkOiBudW1iZXIsIG1haWxib3hJZDogbnVtYmVyKSB7XG4gIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ21haWxib3hlcycpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLndoZXJlKCdpZCcsICc9JywgbWFpbGJveElkKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgaWYgKCFyb3cpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtYWlsYm94IG5vdCBmb3VuZCcpXG4gIHJldHVybiByb3dcbn1cblxuZnVuY3Rpb24gcGFyc2VFeHRyYWN0b3JzSnNvbihyYXc6IHN0cmluZykge1xuICBsZXQgcGFyc2VkOiB1bmtub3duXG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpXG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdleHRyYWN0b3JzSnNvbiBtdXN0IGJlIHZhbGlkIEpTT04nKVxuICB9XG4gIGNvbnN0IGV4dHJhY3RvcnMgPSBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzKHBhcnNlZClcbiAgaWYgKCFleHRyYWN0b3JzKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2V4dHJhY3RvcnNKc29uIGhhcyBpbnZhbGlkIHNoYXBlJylcbiAgfVxuICByZXR1cm4gZXh0cmFjdG9yc1xufVxuXG5mdW5jdGlvbiBhc1NwZW5kaW5nUGF5bG9hZChwYXlsb2FkOiB1bmtub3duKTogU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkIHwgbnVsbCB7XG4gIGNvbnN0IG9iaiA9IHR5cGVvZiBwYXlsb2FkID09PSAnc3RyaW5nJ1xuICAgID8gKCgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKHBheWxvYWQpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGxcbiAgICAgIH1cbiAgICB9KSgpXG4gICAgOiBwYXlsb2FkXG4gIGlmIChvYmogPT09IG51bGwgfHwgdHlwZW9mIG9iaiAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShvYmopKSByZXR1cm4gbnVsbFxuICBjb25zdCBwID0gb2JqIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGlmICh0eXBlb2YgcC5hbW91bnRDZW50cyAhPT0gJ251bWJlcicgfHwgdHlwZW9mIHAuc3BlbnRPbiAhPT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG4gIHJldHVybiB7XG4gICAgYW1vdW50Q2VudHM6IHAuYW1vdW50Q2VudHMsXG4gICAgY3VycmVuY3k6IHR5cGVvZiBwLmN1cnJlbmN5ID09PSAnc3RyaW5nJyA/IHAuY3VycmVuY3kgOiAnVVNEJyxcbiAgICBzcGVudE9uOiBwLnNwZW50T24sXG4gICAgbWVyY2hhbnQ6IHR5cGVvZiBwLm1lcmNoYW50ID09PSAnc3RyaW5nJyA/IHAubWVyY2hhbnQgOiBudWxsLFxuICAgIG5vdGU6IHR5cGVvZiBwLm5vdGUgPT09ICdzdHJpbmcnID8gcC5ub3RlIDogbnVsbCxcbiAgICBzb3VyY2VTdWJqZWN0OiB0eXBlb2YgcC5zb3VyY2VTdWJqZWN0ID09PSAnc3RyaW5nJyA/IHAuc291cmNlU3ViamVjdCA6ICcnLFxuICAgIHNvdXJjZUZyb206IHR5cGVvZiBwLnNvdXJjZUZyb20gPT09ICdzdHJpbmcnID8gcC5zb3VyY2VGcm9tIDogJycsXG4gICAgcHVibGlzaGVkRXhwZW5zZUlkOlxuICAgICAgdHlwZW9mIHAucHVibGlzaGVkRXhwZW5zZUlkID09PSAnbnVtYmVyJyA/IHAucHVibGlzaGVkRXhwZW5zZUlkIDogbnVsbCxcbiAgICB0ZW1wbGF0ZUlkOiB0eXBlb2YgcC50ZW1wbGF0ZUlkID09PSAnbnVtYmVyJyA/IHAudGVtcGxhdGVJZCA6IG51bGwsXG4gIH1cbn1cblxuY29uc3QgUXVlcnkgPSB7XG4gIGFzeW5jIG1haWxib3hlcygpOiBQcm9taXNlPE1haWxib3hbXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ21haWxib3hlcycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2FzYycpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcE1haWxib3gpXG4gIH0sXG5cbiAgYXN5bmMgZG9tYWluRmlsdGVycyhtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8RG9tYWluRmlsdGVyW10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2RvbWFpbl9maWx0ZXJzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwRG9tYWluRmlsdGVyKVxuICB9LFxuXG4gIGFzeW5jIG1lc3NhZ2VzKG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxNZXNzYWdlW10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ21lc3NhZ2VzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAub3JkZXJCeSgncmVjZWl2ZWRfYXQnLCAnZGVzYycpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcE1lc3NhZ2UpXG4gIH0sXG5cbiAgYXN5bmMgbWVzc2FnZShpZDogbnVtYmVyKTogUHJvbWlzZTxNZXNzYWdlIHwgbnVsbD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIHJldHVybiBhd2FpdCBmaW5kT3duZWRNZXNzYWdlKGNyZWF0ZUt5c2VseU1lc3NhZ2VMb29rdXBTdG9yZShkYiksIHVzZXJJZCwgaWQpXG4gIH0sXG5cbiAgYXN5bmMgc291cmNlTWVzc2FnZUZvckV4cGVuc2UoZXhwZW5zZUlkOiBudW1iZXIpOiBQcm9taXNlPE1lc3NhZ2UgfCBudWxsPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgcmV0dXJuIGF3YWl0IGZpbmRTb3VyY2VNZXNzYWdlRm9yRXhwZW5zZShcbiAgICAgIGNyZWF0ZUt5c2VseU1lc3NhZ2VMb29rdXBTdG9yZShkYiksXG4gICAgICB1c2VySWQsXG4gICAgICBleHBlbnNlSWQsXG4gICAgKVxuICB9LFxuXG4gIGFzeW5jIGV4dHJhY3Rpb25BcnRpZmFjdHMoXG4gICAgbWFpbGJveElkPzogbnVtYmVyIHwgbnVsbCxcbiAgICBzdGF0dXM/OiBzdHJpbmcgfCBudWxsLFxuICApOiBQcm9taXNlPEV4dHJhY3Rpb25BcnRpZmFjdFtdPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgbGV0IHEgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC5pbm5lckpvaW4oJ21lc3NhZ2VzJywgJ21lc3NhZ2VzLmlkJywgJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLm1lc3NhZ2VfaWQnKVxuICAgICAgLmlubmVySm9pbignbWFpbGJveGVzJywgJ21haWxib3hlcy5pZCcsICdtZXNzYWdlcy5tYWlsYm94X2lkJylcbiAgICAgIC5zZWxlY3RBbGwoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC53aGVyZSgnbWFpbGJveGVzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcblxuICAgIGlmIChtYWlsYm94SWQgIT0gbnVsbCkge1xuICAgICAgcSA9IHEud2hlcmUoJ21lc3NhZ2VzLm1haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICB9XG4gICAgaWYgKHN0YXR1cyAhPSBudWxsICYmIHN0YXR1cyAhPT0gJycpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdleHRyYWN0aW9uX2FydGlmYWN0cy5zdGF0dXMnLCAnPScsIHZhbGlkYXRlQXJ0aWZhY3RTdGF0dXMoc3RhdHVzKSlcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcS5vcmRlckJ5KCdleHRyYWN0aW9uX2FydGlmYWN0cy5pZCcsICdkZXNjJykuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcEFydGlmYWN0KVxuICB9LFxuXG4gIGFzeW5jIHN5bmNSdW5zKG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxTeW5jUnVuW10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3N5bmNfcnVucycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KDUwKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBTeW5jUnVuKVxuICB9LFxuXG4gIGFzeW5jIHBhcnNpbmdUZW1wbGF0ZXMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPFBhcnNpbmdUZW1wbGF0ZVtdPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIG1haWxib3hJZClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwUGFyc2luZ1RlbXBsYXRlKVxuICB9LFxufVxuXG5jb25zdCBNdXRhdGlvbiA9IHtcbiAgYXN5bmMgY3JlYXRlTWFpbGJveChpbnB1dDogQ3JlYXRlTWFpbGJveElucHV0KTogUHJvbWlzZTxNYWlsYm94PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcHJvdmlkZXIgPSB2YWxpZGF0ZVByb3ZpZGVyKGlucHV0LnByb3ZpZGVyKVxuICAgIGNvbnN0IGxhYmVsID0gdmFsaWRhdGVMYWJlbChpbnB1dC5sYWJlbClcbiAgICBjb25zdCBwYXR0ZXJucyA9IHZhbGlkYXRlRG9tYWluUGF0dGVybnMoaW5wdXQuZG9tYWluRmlsdGVycyA/PyBbXSlcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGNvbnN0IHZhbHVlczogTmV3TWFpbGJveCA9IHtcbiAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgIHByb3ZpZGVyLFxuICAgICAgbGFiZWwsXG4gICAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IHRydWUsXG4gICAgICBzeW5jX2N1cnNvcjogbnVsbCxcbiAgICAgIHN5bmNfcmVxdWVzdGVkOiB0cnVlLFxuICAgICAgb2F1dGhfdG9rZW5zX2pzb246IGlucHV0Lm9hdXRoVG9rZW5zSnNvbiA/PyBudWxsLFxuICAgICAgbGFzdF9zeW5jZWRfYXQ6IG51bGwsXG4gICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgfVxuXG4gICAgY29uc3QgbWFpbGJveCA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygnbWFpbGJveGVzJylcbiAgICAgIC52YWx1ZXModmFsdWVzKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgaWYgKHBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC5pbnNlcnRJbnRvKCdkb21haW5fZmlsdGVycycpXG4gICAgICAgIC52YWx1ZXMoXG4gICAgICAgICAgcGF0dGVybnMubWFwKChwYXR0ZXJuKSA9PiAoe1xuICAgICAgICAgICAgbWFpbGJveF9pZDogbWFpbGJveC5pZCxcbiAgICAgICAgICAgIHBhdHRlcm4sXG4gICAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSkpLFxuICAgICAgICApXG4gICAgICAgIC5leGVjdXRlKClcbiAgICB9XG5cbiAgICByZXR1cm4gbWFwTWFpbGJveChtYWlsYm94KVxuICB9LFxuXG4gIGFzeW5jIHVwZGF0ZU1haWxib3goaW5wdXQ6IFVwZGF0ZU1haWxib3hJbnB1dCk6IFByb21pc2U8TWFpbGJveD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBpbnB1dC5pZClcbiAgICBjb25zdCBsYWJlbCA9IHZhbGlkYXRlTGFiZWwoaW5wdXQubGFiZWwpXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnbWFpbGJveGVzJylcbiAgICAgIC5zZXQoeyBsYWJlbCwgdXBkYXRlZF9hdDogbm93IH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBNYWlsYm94KHJvdylcbiAgfSxcblxuICBhc3luYyBkZWxldGVNYWlsYm94KGlkOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ21haWxib3hlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0Lm51bURlbGV0ZWRSb3dzID8/IDApID4gMFxuICB9LFxuXG4gIGFzeW5jIHNldERvbWFpbkZpbHRlcnMoaW5wdXQ6IFNldERvbWFpbkZpbHRlcnNJbnB1dCk6IFByb21pc2U8RG9tYWluRmlsdGVyW10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGNvbnN0IHBhdHRlcm5zID0gdmFsaWRhdGVEb21haW5QYXR0ZXJucyhpbnB1dC5wYXR0ZXJucylcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBpZiAocGF0dGVybnMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2RvbWFpbl9maWx0ZXJzJylcbiAgICAgICAgLnZhbHVlcyhcbiAgICAgICAgICBwYXR0ZXJucy5tYXAoKHBhdHRlcm4pID0+ICh7XG4gICAgICAgICAgICBtYWlsYm94X2lkOiBpbnB1dC5tYWlsYm94SWQsXG4gICAgICAgICAgICBwYXR0ZXJuLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIGlucHV0Lm1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBEb21haW5GaWx0ZXIpXG4gIH0sXG5cbiAgYXN5bmMgdHJpZ2dlclN5bmMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPE1haWxib3g+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ21haWxib3hlcycpXG4gICAgICAuc2V0KHsgc3luY19yZXF1ZXN0ZWQ6IHRydWUsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcE1haWxib3gocm93KVxuICB9LFxuXG4gIGFzeW5jIHVwZGF0ZUFydGlmYWN0U3RhdHVzKFxuICAgIGlucHV0OiBVcGRhdGVBcnRpZmFjdFN0YXR1c0lucHV0LFxuICApOiBQcm9taXNlPEV4dHJhY3Rpb25BcnRpZmFjdD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHN0YXR1cyA9IHZhbGlkYXRlQXJ0aWZhY3RTdGF0dXMoaW5wdXQuc3RhdHVzKVxuICAgIGNvbnN0IG93bmVkID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAuaW5uZXJKb2luKCdtZXNzYWdlcycsICdtZXNzYWdlcy5pZCcsICdleHRyYWN0aW9uX2FydGlmYWN0cy5tZXNzYWdlX2lkJylcbiAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAuc2VsZWN0QWxsKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAud2hlcmUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLmlkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFvd25lZCkgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2FydGlmYWN0IG5vdCBmb3VuZCcpXG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGlmIChzdGF0dXMgPT09ICdyZWplY3RlZCcpIHtcbiAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuc2V0KHsgc3RhdHVzLCB1cGRhdGVkX2F0OiBub3cgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICAgIH1cblxuICAgIGlmIChzdGF0dXMgPT09ICdhY2NlcHRlZCcpIHtcbiAgICAgIGlmIChvd25lZC5raW5kID09PSBTUEVORElOR19DQU5ESURBVEVfS0lORCkge1xuICAgICAgICBpZiAob3duZWQucHVibGlzaGVkX2V4cGVuc2VfaWQgIT0gbnVsbCkge1xuICAgICAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgICAgIC5zZXQoeyBzdGF0dXM6ICdhY2NlcHRlZCcsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgICAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY2F0ZWdvcnlJZCA9IHZhbGlkYXRlQ2F0ZWdvcnlJZChpbnB1dC5jYXRlZ29yeUlkKVxuICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSBhc1NwZW5kaW5nUGF5bG9hZChvd25lZC5wYXlsb2FkKVxuICAgICAgICBpZiAoIWNhbmRpZGF0ZSkge1xuICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdhcnRpZmFjdCBwYXlsb2FkIGlzIG5vdCBhIHNwZW5kaW5nIGNhbmRpZGF0ZScpXG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHB1Ymxpc2hlZCA9IGF3YWl0IHB1Ymxpc2hFeHBlbnNlVG9TcGVuZG1hbmFnZXIoXG4gICAgICAgICAgICBjYW5kaWRhdGUsXG4gICAgICAgICAgICBjYXRlZ29yeUlkLFxuICAgICAgICAgICAgcmVxdWlyZUF1dGhvcml6YXRpb25IZWFkZXIoKSxcbiAgICAgICAgICApXG4gICAgICAgICAgY29uc3QgbmV4dFBheWxvYWQgPSB7XG4gICAgICAgICAgICAuLi5jYW5kaWRhdGUsXG4gICAgICAgICAgICBwdWJsaXNoZWRFeHBlbnNlSWQ6IHB1Ymxpc2hlZC5leHBlbnNlSWQsXG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgICAgIC5zZXQoe1xuICAgICAgICAgICAgICBzdGF0dXM6ICdhY2NlcHRlZCcsXG4gICAgICAgICAgICAgIHB1Ymxpc2hlZF9leHBlbnNlX2lkOiBwdWJsaXNoZWQuZXhwZW5zZUlkLFxuICAgICAgICAgICAgICBwYXlsb2FkOiBuZXh0UGF5bG9hZCxcbiAgICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmFydGlmYWN0SWQpXG4gICAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICAgICAgcmV0dXJuIG1hcEFydGlmYWN0KHJvdylcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIFNwZW5kbWFuYWdlclNpbmtFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICAgICAgICAgIGBmYWlsZWQgdG8gcHVibGlzaCBleHBlbnNlOiAke2Vyci5tZXNzYWdlfWAsXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVyclxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuc2V0KHsgc3RhdHVzOiAnYWNjZXB0ZWQnLCB1cGRhdGVkX2F0OiBub3cgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICAgIH1cblxuICAgIC8vIHBlbmRpbmcgLyBvdGhlclxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC5zZXQoeyBzdGF0dXMsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICB9LFxuXG4gIGFzeW5jIGNvbm5lY3RHbWFpbChpbnB1dDogQ29ubmVjdEdtYWlsSW5wdXQpOiBQcm9taXNlPE1haWxib3g+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBtYWlsYm94ID0gYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIGlucHV0Lm1haWxib3hJZClcbiAgICBpZiAobWFpbGJveC5wcm92aWRlciAhPT0gJ2dtYWlsJykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ21haWxib3ggcHJvdmlkZXIgaXMgbm90IGdtYWlsJylcbiAgICB9XG4gICAgaWYgKCFpbnB1dC5hY2Nlc3NUb2tlbi50cmltKCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdhY2Nlc3NUb2tlbiBpcyByZXF1aXJlZCcpXG4gICAgfVxuXG4gICAgY29uc3QgYWNjZXNzVG9rZW4gPSBpbnB1dC5hY2Nlc3NUb2tlbi50cmltKClcbiAgICBjb25zdCB0b2tlbnMgPSB7XG4gICAgICBhY2Nlc3NUb2tlbixcbiAgICAgIHJlZnJlc2hUb2tlbjogaW5wdXQucmVmcmVzaFRva2VuID8/IG51bGwsXG4gICAgICBleHBpcmVzQXRNczogaW5wdXQuZXhwaXJlc0F0TXMgPz8gbnVsbCxcbiAgICB9XG4gICAgY29uc3QgZW1haWwgPSBhd2FpdCBmZXRjaEdtYWlsRW1haWxBZGRyZXNzKHsgYWNjZXNzVG9rZW4gfSlcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdtYWlsYm94ZXMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIG9hdXRoX3Rva2Vuc19qc29uOiBKU09OLnN0cmluZ2lmeSh0b2tlbnMpLFxuICAgICAgICAuLi4oZW1haWwgPyB7IGxhYmVsOiBlbWFpbCB9IDoge30pLFxuICAgICAgICBzeW5jX3JlcXVlc3RlZDogdHJ1ZSxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIG1haWxib3guaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcE1haWxib3gocm93KVxuICB9LFxuXG4gIGFzeW5jIHN0YXJ0R21haWxPQXV0aChcbiAgICBpbnB1dDogU3RhcnRHbWFpbE9BdXRoSW5wdXQsXG4gICk6IFByb21pc2U8U3RhcnRHbWFpbE9BdXRoUGF5bG9hZD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG1haWxib3ggPSBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGlmIChtYWlsYm94LnByb3ZpZGVyICE9PSAnZ21haWwnKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWFpbGJveCBwcm92aWRlciBpcyBub3QgZ21haWwnKVxuICAgIH1cblxuICAgIGNvbnN0IHJldHVyblRvID0gaW5wdXQucmV0dXJuVG8/LnRyaW0oKSA/PyAnJ1xuICAgIGlmICghcmV0dXJuVG8pIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdyZXR1cm5UbyBpcyByZXF1aXJlZCcpXG4gICAgfVxuXG4gICAgbGV0IGNvbmZpZ1xuICAgIHRyeSB7XG4gICAgICBjb25maWcgPSBsb2FkR21haWxPQXV0aENvbmZpZygpXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgR21haWxPQXV0aEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKGVyci5tZXNzYWdlKVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgaWYgKCFpc1JldHVyblRvQWxsb3dlZChyZXR1cm5UbywgY29uZmlnLnJldHVyblRvQWxsb3dsaXN0KSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3JldHVyblRvIGlzIG5vdCBhbGxvd2VkJylcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHNpZ25PQXV0aFN0YXRlKFxuICAgICAgeyB1c2VySWQsIG1haWxib3hJZDogbWFpbGJveC5pZCwgcmV0dXJuVG8gfSxcbiAgICAgIGNvbmZpZy5jbGllbnRTZWNyZXQsXG4gICAgKVxuICAgIGNvbnN0IGF1dGhvcml6YXRpb25VcmwgPSBidWlsZEdvb2dsZUF1dGhvcml6ZVVybCh7XG4gICAgICBjbGllbnRJZDogY29uZmlnLmNsaWVudElkLFxuICAgICAgcmVkaXJlY3RVcmk6IGNvbmZpZy5yZWRpcmVjdFVyaSxcbiAgICAgIHN0YXRlLFxuICAgIH0pXG4gICAgcmV0dXJuIHsgYXV0aG9yaXphdGlvblVybCB9XG4gIH0sXG5cbiAgYXN5bmMgY3JlYXRlUGFyc2luZ1RlbXBsYXRlKFxuICAgIGlucHV0OiBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgKTogUHJvbWlzZTxQYXJzaW5nVGVtcGxhdGU+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZVRlbXBsYXRlTmFtZShpbnB1dC5uYW1lKVxuICAgIGNvbnN0IG1hdGNoRnJvbVBhdHRlcm4gPSB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4oaW5wdXQubWF0Y2hGcm9tUGF0dGVybilcbiAgICBjb25zdCBtYXRjaFN1YmplY3RSZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGlucHV0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgIGNvbnN0IGV4dHJhY3RvcnMgPSBwYXJzZUV4dHJhY3RvcnNKc29uKGlucHV0LmV4dHJhY3RvcnNKc29uKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgaWYgKGlucHV0LnNvdXJjZU1lc3NhZ2VJZCAhPSBudWxsKSB7XG4gICAgICBjb25zdCBtc2cgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgICAuc2VsZWN0KCdtZXNzYWdlcy5pZCcpXG4gICAgICAgIC53aGVyZSgnbWVzc2FnZXMuaWQnLCAnPScsIGlucHV0LnNvdXJjZU1lc3NhZ2VJZClcbiAgICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAud2hlcmUoJ21lc3NhZ2VzLm1haWxib3hfaWQnLCAnPScsIGlucHV0Lm1haWxib3hJZClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgaWYgKCFtc2cpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdzb3VyY2UgbWVzc2FnZSBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIG1haWxib3hfaWQ6IGlucHV0Lm1haWxib3hJZCxcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIG1hdGNoX2Zyb21fcGF0dGVybjogbWF0Y2hGcm9tUGF0dGVybixcbiAgICAgICAgbWF0Y2hfc3ViamVjdF9yZWdleDogbWF0Y2hTdWJqZWN0UmVnZXgsXG4gICAgICAgIGV4dHJhY3RvcnMsXG4gICAgICAgIHNvdXJjZV9tZXNzYWdlX2lkOiBpbnB1dC5zb3VyY2VNZXNzYWdlSWQgPz8gbnVsbCxcbiAgICAgICAgdmVyc2lvbjogMSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBQYXJzaW5nVGVtcGxhdGUocm93KVxuICB9LFxuXG4gIGFzeW5jIHVwZGF0ZVBhcnNpbmdUZW1wbGF0ZShcbiAgICBpbnB1dDogVXBkYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXQsXG4gICk6IFByb21pc2U8UGFyc2luZ1RlbXBsYXRlPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWV4aXN0aW5nKSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcigndGVtcGxhdGUgbm90IGZvdW5kJylcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHBhdGNoOiB7XG4gICAgICBuYW1lPzogc3RyaW5nXG4gICAgICBtYXRjaF9mcm9tX3BhdHRlcm4/OiBzdHJpbmdcbiAgICAgIG1hdGNoX3N1YmplY3RfcmVnZXg/OiBzdHJpbmcgfCBudWxsXG4gICAgICBleHRyYWN0b3JzPzogUmV0dXJuVHlwZTx0eXBlb2YgcGFyc2VFeHRyYWN0b3JzSnNvbj5cbiAgICAgIGVuYWJsZWQ/OiBib29sZWFuXG4gICAgICB2ZXJzaW9uOiBudW1iZXJcbiAgICAgIHVwZGF0ZWRfYXQ6IHN0cmluZ1xuICAgIH0gPSB7XG4gICAgICB2ZXJzaW9uOiBleGlzdGluZy52ZXJzaW9uICsgMSxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICB9XG5cbiAgICBpZiAoaW5wdXQubmFtZSAhPSBudWxsKSBwYXRjaC5uYW1lID0gdmFsaWRhdGVUZW1wbGF0ZU5hbWUoaW5wdXQubmFtZSlcbiAgICBpZiAoaW5wdXQubWF0Y2hGcm9tUGF0dGVybiAhPSBudWxsKSB7XG4gICAgICBwYXRjaC5tYXRjaF9mcm9tX3BhdHRlcm4gPSB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4oaW5wdXQubWF0Y2hGcm9tUGF0dGVybilcbiAgICB9XG4gICAgaWYgKGlucHV0Lm1hdGNoU3ViamVjdFJlZ2V4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdGNoLm1hdGNoX3N1YmplY3RfcmVnZXggPSB2YWxpZGF0ZVN1YmplY3RSZWdleChpbnB1dC5tYXRjaFN1YmplY3RSZWdleClcbiAgICB9XG4gICAgaWYgKGlucHV0LmV4dHJhY3RvcnNKc29uICE9IG51bGwpIHtcbiAgICAgIHBhdGNoLmV4dHJhY3RvcnMgPSBwYXJzZUV4dHJhY3RvcnNKc29uKGlucHV0LmV4dHJhY3RvcnNKc29uKVxuICAgIH1cbiAgICBpZiAoaW5wdXQuZW5hYmxlZCAhPSBudWxsKSBwYXRjaC5lbmFibGVkID0gaW5wdXQuZW5hYmxlZFxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnNldChwYXRjaClcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBQYXJzaW5nVGVtcGxhdGUocm93KVxuICB9LFxuXG4gIGFzeW5jIGRlbGV0ZVBhcnNpbmdUZW1wbGF0ZShpZDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiBOdW1iZXIocmVzdWx0Lm51bURlbGV0ZWRSb3dzID8/IDApID4gMFxuICB9LFxuXG4gIGFzeW5jIGdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlKFxuICAgIGlucHV0OiBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxuICApOiBQcm9taXNlPFBhcnNpbmdUZW1wbGF0ZT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG1lc3NhZ2UgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ21lc3NhZ2VzJylcbiAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAuc2VsZWN0KFtcbiAgICAgICAgJ21lc3NhZ2VzLmlkJyxcbiAgICAgICAgJ21lc3NhZ2VzLm1haWxib3hfaWQnLFxuICAgICAgICAnbWVzc2FnZXMuZnJvbV9hZGRyZXNzJyxcbiAgICAgICAgJ21lc3NhZ2VzLnN1YmplY3QnLFxuICAgICAgICAnbWVzc2FnZXMudGV4dF9ib2R5JyxcbiAgICAgICAgJ21lc3NhZ2VzLmh0bWxfYm9keScsXG4gICAgICBdKVxuICAgICAgLndoZXJlKCdtZXNzYWdlcy5pZCcsICc9JywgaW5wdXQubWVzc2FnZUlkKVxuICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFtZXNzYWdlKSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWVzc2FnZSBub3QgZm91bmQnKVxuICAgIGlmICghbWVzc2FnZS50ZXh0X2JvZHkgJiYgIW1lc3NhZ2UuaHRtbF9ib2R5KSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgICAgJ21lc3NhZ2UgaGFzIG5vIHN0b3JlZCBib2R5OyByZS1zeW5jIGFmdGVyIHVwZ3JhZGluZyBtYWlsYm94JyxcbiAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBnZW5lcmljRmFpbE1lc3NhZ2UgPSAnVGVtcGxhdGUgZ2VuZXJhdGlvbiBmYWlsZWQuIFBsZWFzZSB0cnkgYWdhaW4uJ1xuICAgIGNvbnN0IGZhaWxUZW1wbGF0ZUdlbmVyYXRpb24gPSAocmVhc29uOiBzdHJpbmcsIGRldGFpbHM/OiB1bmtub3duKTogbmV2ZXIgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgJ1ttYWlsYm94LWFwaV0gdGVtcGxhdGUgZ2VuZXJhdGlvbiBmYWlsZWQ6JyxcbiAgICAgICAgcmVhc29uLFxuICAgICAgICBkZXRhaWxzID8/ICcnLFxuICAgICAgKVxuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoZ2VuZXJpY0ZhaWxNZXNzYWdlKVxuICAgIH1cblxuICAgIGxldCBhaU91dFxuICAgIHRyeSB7XG4gICAgICBhaU91dCA9IGF3YWl0IGdlbmVyYXRlRW1haWxTcGVuZFRlbXBsYXRlKHtcbiAgICAgICAgZnJvbTogbWVzc2FnZS5mcm9tX2FkZHJlc3MsXG4gICAgICAgIHN1YmplY3Q6IG1lc3NhZ2Uuc3ViamVjdCxcbiAgICAgICAgdGV4dEJvZHk6IG1lc3NhZ2UudGV4dF9ib2R5LFxuICAgICAgICBodG1sQm9keTogbWVzc2FnZS5odG1sX2JvZHksXG4gICAgICAgIGhpbnRzOiBpbnB1dC5oaW50cyxcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgQWlDbGllbnRFcnJvcikge1xuICAgICAgICBmYWlsVGVtcGxhdGVHZW5lcmF0aW9uKGVyci5tZXNzYWdlLCB7IG1lc3NhZ2VJZDogbWVzc2FnZS5pZCB9KVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgbGV0IG1hdGNoRnJvbVBhdHRlcm46IHN0cmluZ1xuICAgIGxldCBtYXRjaFN1YmplY3RSZWdleDogc3RyaW5nIHwgbnVsbFxuICAgIGxldCBleHRyYWN0b3JzOiBOb25OdWxsYWJsZTxSZXR1cm5UeXBlPHR5cGVvZiBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzPj5cbiAgICB0cnkge1xuICAgICAgbWF0Y2hGcm9tUGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihhaU91dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgICAgbWF0Y2hTdWJqZWN0UmVnZXggPSB2YWxpZGF0ZVN1YmplY3RSZWdleChhaU91dC5tYXRjaFN1YmplY3RSZWdleClcbiAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMoYWlPdXQuZXh0cmFjdG9ycylcbiAgICAgIGlmICghcGFyc2VkKSB7XG4gICAgICAgIGZhaWxUZW1wbGF0ZUdlbmVyYXRpb24oJ0FJIHJldHVybmVkIGludmFsaWQgZXh0cmFjdG9ycycsIHtcbiAgICAgICAgICBtZXNzYWdlSWQ6IG1lc3NhZ2UuaWQsXG4gICAgICAgICAgZXh0cmFjdG9yczogYWlPdXQuZXh0cmFjdG9ycyxcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICAgIGV4dHJhY3RvcnMgPSBwYXJzZWRcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChcbiAgICAgICAgZXJyIGluc3RhbmNlb2YgSW52YWxpZE1haWxib3hFcnJvciAmJlxuICAgICAgICBlcnIubWVzc2FnZSA9PT0gZ2VuZXJpY0ZhaWxNZXNzYWdlXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgZXJyXG4gICAgICB9XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgSW52YWxpZE1haWxib3hFcnJvcikge1xuICAgICAgICBmYWlsVGVtcGxhdGVHZW5lcmF0aW9uKGVyci5tZXNzYWdlLCB7XG4gICAgICAgICAgbWVzc2FnZUlkOiBtZXNzYWdlLmlkLFxuICAgICAgICAgIG1hdGNoRnJvbVBhdHRlcm46IGFpT3V0Lm1hdGNoRnJvbVBhdHRlcm4sXG4gICAgICAgICAgbWF0Y2hTdWJqZWN0UmVnZXg6IGFpT3V0Lm1hdGNoU3ViamVjdFJlZ2V4LFxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlVGVtcGxhdGVOYW1lKFxuICAgICAgaW5wdXQubmFtZT8udHJpbSgpIHx8IGFpT3V0Lm5hbWVTdWdnZXN0aW9uIHx8ICdTcGVuZGluZyB0ZW1wbGF0ZScsXG4gICAgKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgbWFpbGJveF9pZDogbWVzc2FnZS5tYWlsYm94X2lkLFxuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIG1hdGNoX2Zyb21fcGF0dGVybjogbWF0Y2hGcm9tUGF0dGVybixcbiAgICAgICAgbWF0Y2hfc3ViamVjdF9yZWdleDogbWF0Y2hTdWJqZWN0UmVnZXgsXG4gICAgICAgIGV4dHJhY3RvcnMsXG4gICAgICAgIHNvdXJjZV9tZXNzYWdlX2lkOiBtZXNzYWdlLmlkLFxuICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0pXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcFBhcnNpbmdUZW1wbGF0ZShyb3cpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCByZXNvbHZlcnMgPSB7IFF1ZXJ5LCBNdXRhdGlvbiB9XG4iLCAiLyoqIE5vcm1hbGl6ZWQgZW1haWwgdXNlZCBieSB0aGUgZXh0cmFjdCBwaXBlbGluZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRW1haWxNZXNzYWdlIHtcbiAgLyoqIFByb3ZpZGVyLXNwZWNpZmljIGlkIChHbWFpbCBtZXNzYWdlIGlkLCBmaXh0dXJlIGlkLCBldGMuKS4gKi9cbiAgaWQ6IHN0cmluZ1xuICAvKiogUkZDIDUzMjIgTWVzc2FnZS1JRCB3aGVuIGF2YWlsYWJsZTsgdXNlZCBmb3IgaWRlbXBvdGVuY3kuICovXG4gIHJmY01lc3NhZ2VJZDogc3RyaW5nXG4gIGZyb206IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRBdDogRGF0ZVxuICB0ZXh0Qm9keTogc3RyaW5nIHwgbnVsbFxuICBodG1sQm9keTogc3RyaW5nIHwgbnVsbFxufVxuXG4vKiogT3BhcXVlIHN5bmMgY3Vyc29yIHJldHVybmVkIGJ5IGEgTWFpbGJveFByb3ZpZGVyLiAqL1xuZXhwb3J0IHR5cGUgU3luY0N1cnNvciA9IHN0cmluZyB8IG51bGxcblxuZXhwb3J0IGludGVyZmFjZSBMaXN0TWVzc2FnZXNSZXN1bHQge1xuICBtZXNzYWdlczogRW1haWxNZXNzYWdlW11cbiAgLyoqIEN1cnNvciB0byBwZXJzaXN0IGFmdGVyIGEgc3VjY2Vzc2Z1bCBzeW5jLiAqL1xuICBuZXh0Q3Vyc29yOiBTeW5jQ3Vyc29yXG59XG5cbmV4cG9ydCB0eXBlIEFydGlmYWN0U3RhdHVzID0gJ3BlbmRpbmcnIHwgJ2FjY2VwdGVkJyB8ICdyZWplY3RlZCdcblxuLyoqIERvbWFpbi1hZ25vc3RpYyBleHRyYWN0aW9uIHJlc3VsdCAobm90IGEgc3BlbmRtYW5hZ2VyIGV4cGVuc2UpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBFeHRyYWN0aW9uQXJ0aWZhY3Qge1xuICBraW5kOiBzdHJpbmdcbiAgcGF5bG9hZDogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uZmlkZW5jZTogbnVtYmVyXG59XG5cbi8qKiBQYXlsb2FkIHNoYXBlIGZvciBTcGVuZGluZ0V4dHJhY3RvciAoYGtpbmQ6IFwic3BlbmRpbmcuY2FuZGlkYXRlXCJgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkIHtcbiAgYW1vdW50Q2VudHM6IG51bWJlclxuICBjdXJyZW5jeTogc3RyaW5nXG4gIHNwZW50T246IHN0cmluZ1xuICBtZXJjaGFudDogc3RyaW5nIHwgbnVsbFxuICBub3RlOiBzdHJpbmcgfCBudWxsXG4gIHNvdXJjZVN1YmplY3Q6IHN0cmluZ1xuICBzb3VyY2VGcm9tOiBzdHJpbmdcbiAgLyoqIFNldCB3aGVuIHB1Ymxpc2hlZCB0byBzcGVuZG1hbmFnZXIuICovXG4gIHB1Ymxpc2hlZEV4cGVuc2VJZD86IG51bWJlciB8IG51bGxcbiAgLyoqIFBhcnNpbmcgdGVtcGxhdGUgaWQgd2hlbiBleHRyYWN0ZWQgdmlhIGEgdGVtcGxhdGUuICovXG4gIHRlbXBsYXRlSWQ/OiBudW1iZXIgfCBudWxsXG59XG5cbmV4cG9ydCBjb25zdCBTUEVORElOR19DQU5ESURBVEVfS0lORCA9ICdzcGVuZGluZy5jYW5kaWRhdGUnIGFzIGNvbnN0XG5cbi8qKiBEZXRlcm1pbmlzdGljIGZpZWxkIGV4dHJhY3RvciB1c2VkIGJ5IHBhcnNpbmcgdGVtcGxhdGVzLiAqL1xuZXhwb3J0IHR5cGUgRmllbGRFeHRyYWN0b3IgPVxuICB8IHtcbiAgICBzb3VyY2U6ICdzdWJqZWN0JyB8ICd0ZXh0JyB8ICdodG1sX3RleHQnXG4gICAgcmVnZXg6IHN0cmluZ1xuICAgIGdyb3VwOiBudW1iZXJcbiAgfVxuICB8IHsgc291cmNlOiAnZnJvbV9kb21haW4nIH1cbiAgfCB7IHNvdXJjZTogJ2NvbnN0YW50JzsgdmFsdWU6IHN0cmluZyB9XG5cbi8qKiBGaWVsZCBtYXAgc3RvcmVkIGluIGBwYXJzaW5nX3RlbXBsYXRlcy5leHRyYWN0b3JzYCBKU09OQi4gKi9cbmV4cG9ydCB0eXBlIFNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzID0ge1xuICBhbW91bnQ6IEZpZWxkRXh0cmFjdG9yXG4gIGN1cnJlbmN5PzogRmllbGRFeHRyYWN0b3IgfCBudWxsXG4gIHNwZW50T24/OiBGaWVsZEV4dHJhY3RvciB8IG51bGxcbiAgbWVyY2hhbnQ/OiBGaWVsZEV4dHJhY3RvciB8IG51bGxcbiAgbm90ZT86IEZpZWxkRXh0cmFjdG9yIHwgbnVsbFxufVxuXG4vKiogUnVudGltZSBkZWZpbml0aW9uIGZvciBhIG1haWxib3ggcGFyc2luZyB0ZW1wbGF0ZS4gKi9cbmV4cG9ydCB0eXBlIFNwZW5kUGFyc2luZ1RlbXBsYXRlID0ge1xuICBpZDogbnVtYmVyXG4gIG1hdGNoRnJvbVBhdHRlcm46IHN0cmluZ1xuICBtYXRjaFN1YmplY3RSZWdleD86IHN0cmluZyB8IG51bGxcbiAgZXh0cmFjdG9yczogU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnNcbiAgZW5hYmxlZD86IGJvb2xlYW5cbn1cbiIsICJpbXBvcnQgeyBtYXRjaGVzRnJvbVBhdHRlcm4sIG5vcm1hbGl6ZUZyb20gfSBmcm9tICcuLi9kb21haW5fZmlsdGVyLnRzJ1xuaW1wb3J0IHR5cGUgeyBFeHRyYWN0b3IgfSBmcm9tICcuLi9leHRyYWN0b3IudHMnXG5pbXBvcnQge1xuICBTUEVORElOR19DQU5ESURBVEVfS0lORCxcbiAgdHlwZSBFbWFpbE1lc3NhZ2UsXG4gIHR5cGUgRXh0cmFjdGlvbkFydGlmYWN0LFxuICB0eXBlIEZpZWxkRXh0cmFjdG9yLFxuICB0eXBlIFNwZW5kUGFyc2luZ1RlbXBsYXRlLFxuICB0eXBlIFNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzLFxuICB0eXBlIFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCxcbn0gZnJvbSAnLi4vdHlwZXMudHMnXG5cbi8qKlxuICogRGV0ZXJtaW5pc3RpYyBzcGVuZGluZyBleHRyYWN0b3IgZHJpdmVuIGJ5IGEgdXNlci9BSS1nZW5lcmF0ZWQgdGVtcGxhdGUuXG4gKiBObyBMTE0gY2FsbHMgXHUyMDE0IHJlZ2V4IC8gY29uc3RhbnQgLyBmcm9tX2RvbWFpbiBvbmx5LlxuICovXG5leHBvcnQgY2xhc3MgVGVtcGxhdGVTcGVuZGluZ0V4dHJhY3RvciBpbXBsZW1lbnRzIEV4dHJhY3RvciB7XG4gIHJlYWRvbmx5IGtpbmQgPSBTUEVORElOR19DQU5ESURBVEVfS0lORFxuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgdGVtcGxhdGU6IFNwZW5kUGFyc2luZ1RlbXBsYXRlKSB7fVxuXG4gIGdldCB0ZW1wbGF0ZUlkKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMudGVtcGxhdGUuaWRcbiAgfVxuXG4gIGNhbkhhbmRsZShtZXNzYWdlOiBFbWFpbE1lc3NhZ2UpOiBib29sZWFuIHtcbiAgICBpZiAodGhpcy50ZW1wbGF0ZS5lbmFibGVkID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKCFtYXRjaGVzRnJvbVBhdHRlcm4obWVzc2FnZS5mcm9tLCB0aGlzLnRlbXBsYXRlLm1hdGNoRnJvbVBhdHRlcm4pKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gICAgY29uc3Qgc3ViamVjdFJlID0gdGhpcy50ZW1wbGF0ZS5tYXRjaFN1YmplY3RSZWdleD8udHJpbSgpXG4gICAgaWYgKHN1YmplY3RSZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCFuZXcgUmVnRXhwKHN1YmplY3RSZSwgJ2knKS50ZXN0KG1lc3NhZ2Uuc3ViamVjdCkpIHJldHVybiBmYWxzZVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgZXh0cmFjdChtZXNzYWdlOiBFbWFpbE1lc3NhZ2UpOiBFeHRyYWN0aW9uQXJ0aWZhY3RbXSB7XG4gICAgY29uc3Qgc291cmNlcyA9IGJ1aWxkU291cmNlcyhtZXNzYWdlKVxuICAgIGNvbnN0IGFtb3VudFJhdyA9IGFwcGx5RmllbGQodGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLmFtb3VudCwgc291cmNlcylcbiAgICBjb25zdCBhbW91bnRDZW50cyA9IHBhcnNlTW9uZXlUb0NlbnRzKGFtb3VudFJhdylcbiAgICBpZiAoYW1vdW50Q2VudHMgPT09IG51bGwpIHJldHVybiBbXVxuXG4gICAgY29uc3QgY3VycmVuY3lSYXcgPSB0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMuY3VycmVuY3lcbiAgICAgID8gYXBwbHlGaWVsZCh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMuY3VycmVuY3ksIHNvdXJjZXMpXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBjdXJyZW5jeSA9IG5vcm1hbGl6ZUN1cnJlbmN5KGN1cnJlbmN5UmF3KSA/PyAnVVNEJ1xuXG4gICAgY29uc3Qgc3BlbnRPblJhdyA9IHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5zcGVudE9uXG4gICAgICA/IGFwcGx5RmllbGQodGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLnNwZW50T24sIHNvdXJjZXMpXG4gICAgICA6IG51bGxcbiAgICBjb25zdCBzcGVudE9uID0gbm9ybWFsaXplRGF0ZShzcGVudE9uUmF3KSA/PyB0b0RhdGVTdHJpbmcobWVzc2FnZS5yZWNlaXZlZEF0KVxuXG4gICAgY29uc3QgbWVyY2hhbnQgPSB0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMubWVyY2hhbnRcbiAgICAgID8gYXBwbHlGaWVsZCh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMubWVyY2hhbnQsIHNvdXJjZXMpXG4gICAgICA6IG51bGxcblxuICAgIGNvbnN0IG5vdGUgPSB0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMubm90ZVxuICAgICAgPyBhcHBseUZpZWxkKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5ub3RlLCBzb3VyY2VzKVxuICAgICAgOiBtZXNzYWdlLnN1YmplY3Quc2xpY2UoMCwgMjAwKSB8fCBudWxsXG5cbiAgICBjb25zdCBwYXlsb2FkOiBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQgPSB7XG4gICAgICBhbW91bnRDZW50cyxcbiAgICAgIGN1cnJlbmN5LFxuICAgICAgc3BlbnRPbixcbiAgICAgIG1lcmNoYW50OiBtZXJjaGFudD8udHJpbSgpID8gbWVyY2hhbnQudHJpbSgpLnNsaWNlKDAsIDEyMCkgOiBudWxsLFxuICAgICAgbm90ZTogbm90ZT8udHJpbSgpID8gbm90ZS50cmltKCkuc2xpY2UoMCwgMjAwKSA6IG51bGwsXG4gICAgICBzb3VyY2VTdWJqZWN0OiBtZXNzYWdlLnN1YmplY3QsXG4gICAgICBzb3VyY2VGcm9tOiBtZXNzYWdlLmZyb20sXG4gICAgICB0ZW1wbGF0ZUlkOiB0aGlzLnRlbXBsYXRlLmlkLFxuICAgIH1cblxuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6IFNQRU5ESU5HX0NBTkRJREFURV9LSU5ELFxuICAgICAgICBwYXlsb2FkOiB7IC4uLnBheWxvYWQgfSxcbiAgICAgICAgY29uZmlkZW5jZTogMC45LFxuICAgICAgfSxcbiAgICBdXG4gIH1cbn1cblxudHlwZSBTb3VyY2VzID0ge1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgdGV4dDogc3RyaW5nXG4gIGh0bWxfdGV4dDogc3RyaW5nXG4gIGZyb21fZG9tYWluOiBzdHJpbmcgfCBudWxsXG59XG5cbmZ1bmN0aW9uIGJ1aWxkU291cmNlcyhtZXNzYWdlOiBFbWFpbE1lc3NhZ2UpOiBTb3VyY2VzIHtcbiAgY29uc3QgZnJvbSA9IG5vcm1hbGl6ZUZyb20obWVzc2FnZS5mcm9tKVxuICByZXR1cm4ge1xuICAgIHN1YmplY3Q6IG1lc3NhZ2Uuc3ViamVjdCA/PyAnJyxcbiAgICB0ZXh0OiBtZXNzYWdlLnRleHRCb2R5ID8/ICcnLFxuICAgIGh0bWxfdGV4dDogc3RyaXBIdG1sKG1lc3NhZ2UuaHRtbEJvZHkpLFxuICAgIGZyb21fZG9tYWluOiBmcm9tPy5kb21haW4gPz8gbnVsbCxcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUZpZWxkKFxuICBleHRyYWN0b3I6IEZpZWxkRXh0cmFjdG9yLFxuICBzb3VyY2VzOiBTb3VyY2VzLFxuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChleHRyYWN0b3Iuc291cmNlID09PSAnY29uc3RhbnQnKSB7XG4gICAgcmV0dXJuIGV4dHJhY3Rvci52YWx1ZVxuICB9XG4gIGlmIChleHRyYWN0b3Iuc291cmNlID09PSAnZnJvbV9kb21haW4nKSB7XG4gICAgaWYgKCFzb3VyY2VzLmZyb21fZG9tYWluKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IGJhc2UgPSBzb3VyY2VzLmZyb21fZG9tYWluLnNwbGl0KCcuJylbMF1cbiAgICBpZiAoIWJhc2UpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIGJhc2UuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBiYXNlLnNsaWNlKDEpXG4gIH1cbiAgY29uc3QgaGF5c3RhY2sgPSBzb3VyY2VzW2V4dHJhY3Rvci5zb3VyY2VdXG4gIHRyeSB7XG4gICAgY29uc3QgcmUgPSBuZXcgUmVnRXhwKGV4dHJhY3Rvci5yZWdleCwgJ2knKVxuICAgIGNvbnN0IG0gPSBoYXlzdGFjay5tYXRjaChyZSlcbiAgICBjb25zdCBncm91cCA9IGV4dHJhY3Rvci5ncm91cFxuICAgIGlmICghbSB8fCBncm91cCA8IDAgfHwgZ3JvdXAgPj0gbS5sZW5ndGgpIHJldHVybiBudWxsXG4gICAgY29uc3QgdmFsdWUgPSBtW2dyb3VwXVxuICAgIHJldHVybiB2YWx1ZT8udHJpbSgpID8gdmFsdWUudHJpbSgpIDogbnVsbFxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmZ1bmN0aW9uIHN0cmlwSHRtbChodG1sOiBzdHJpbmcgfCBudWxsKTogc3RyaW5nIHtcbiAgaWYgKCFodG1sKSByZXR1cm4gJydcbiAgcmV0dXJuIGh0bWwucmVwbGFjZSgvPFtePl0rPi9nLCAnICcpLnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKClcbn1cblxuZnVuY3Rpb24gcGFyc2VNb25leVRvQ2VudHMocmF3OiBzdHJpbmcgfCBudWxsKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICghcmF3KSByZXR1cm4gbnVsbFxuICBjb25zdCBjbGVhbmVkID0gcmF3LnJlcGxhY2UoL1teXFxkLiwtXS9nLCAnJykucmVwbGFjZSgvLC9nLCAnJylcbiAgaWYgKCFjbGVhbmVkKSByZXR1cm4gbnVsbFxuICBjb25zdCBkb2xsYXJzID0gTnVtYmVyKGNsZWFuZWQpXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKGRvbGxhcnMpIHx8IGRvbGxhcnMgPD0gMCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIE1hdGgucm91bmQoZG9sbGFycyAqIDEwMClcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplQ3VycmVuY3kocmF3OiBzdHJpbmcgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghcmF3KSByZXR1cm4gbnVsbFxuICBjb25zdCBtID0gcmF3LnRvVXBwZXJDYXNlKCkubWF0Y2goL1xcYihVU0R8RVVSfEdCUHxNWE58Q0FEKVxcYi8pXG4gIHJldHVybiBtPy5bMV0gPz8gbnVsbFxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVEYXRlKHJhdzogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIXJhdykgcmV0dXJuIG51bGxcbiAgY29uc3QgaXNvID0gcmF3Lm1hdGNoKC9cXGIoMjBcXGR7Mn0tXFxkezJ9LVxcZHsyfSlcXGIvKVxuICBpZiAoaXNvPy5bMV0pIHJldHVybiBpc29bMV1cbiAgcmV0dXJuIG51bGxcbn1cblxuZnVuY3Rpb24gdG9EYXRlU3RyaW5nKGQ6IERhdGUpOiBzdHJpbmcge1xuICByZXR1cm4gZC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxufVxuXG4vKiogVmFsaWRhdGUgZXh0cmFjdG9ycyBKU09OIHNoYXBlICh1c2VkIGJ5IEFQSSArIEFJIG91dHB1dCkuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyhcbiAgcmF3OiB1bmtub3duLFxuKTogU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMgfCBudWxsIHtcbiAgaWYgKHJhdyA9PT0gbnVsbCB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiBudWxsXG4gIGNvbnN0IG9iaiA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBjb25zdCBhbW91bnQgPSBwYXJzZUZpZWxkRXh0cmFjdG9yKG9iai5hbW91bnQpXG4gIGlmICghYW1vdW50KSByZXR1cm4gbnVsbFxuICByZXR1cm4ge1xuICAgIGFtb3VudCxcbiAgICBjdXJyZW5jeTogcGFyc2VPcHRpb25hbEZpZWxkKG9iai5jdXJyZW5jeSksXG4gICAgc3BlbnRPbjogcGFyc2VPcHRpb25hbEZpZWxkKG9iai5zcGVudE9uKSxcbiAgICBtZXJjaGFudDogcGFyc2VPcHRpb25hbEZpZWxkKG9iai5tZXJjaGFudCksXG4gICAgbm90ZTogcGFyc2VPcHRpb25hbEZpZWxkKG9iai5ub3RlKSxcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZU9wdGlvbmFsRmllbGQocmF3OiB1bmtub3duKTogRmllbGRFeHRyYWN0b3IgfCBudWxsIHtcbiAgaWYgKHJhdyA9PT0gdW5kZWZpbmVkIHx8IHJhdyA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIHBhcnNlRmllbGRFeHRyYWN0b3IocmF3KVxufVxuXG5mdW5jdGlvbiBwYXJzZUZpZWxkRXh0cmFjdG9yKHJhdzogdW5rbm93bik6IEZpZWxkRXh0cmFjdG9yIHwgbnVsbCB7XG4gIGlmIChyYXcgPT09IG51bGwgfHwgdHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gbnVsbFxuICBjb25zdCBvYmogPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uc3Qgc291cmNlID0gb2JqLnNvdXJjZVxuICBpZiAoc291cmNlID09PSAnZnJvbV9kb21haW4nKSByZXR1cm4geyBzb3VyY2U6ICdmcm9tX2RvbWFpbicgfVxuICBpZiAoc291cmNlID09PSAnY29uc3RhbnQnKSB7XG4gICAgaWYgKHR5cGVvZiBvYmoudmFsdWUgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbFxuICAgIHJldHVybiB7IHNvdXJjZTogJ2NvbnN0YW50JywgdmFsdWU6IG9iai52YWx1ZSB9XG4gIH1cbiAgaWYgKHNvdXJjZSA9PT0gJ3N1YmplY3QnIHx8IHNvdXJjZSA9PT0gJ3RleHQnIHx8IHNvdXJjZSA9PT0gJ2h0bWxfdGV4dCcpIHtcbiAgICBpZiAodHlwZW9mIG9iai5yZWdleCAhPT0gJ3N0cmluZycgfHwgIW9iai5yZWdleCkgcmV0dXJuIG51bGxcbiAgICBpZiAodHlwZW9mIG9iai5ncm91cCAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIob2JqLmdyb3VwKSB8fCBvYmouZ3JvdXAgPCAwKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgICB0cnkge1xuICAgICAgbmV3IFJlZ0V4cChvYmoucmVnZXgsICdpJylcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIHJldHVybiB7IHNvdXJjZSwgcmVnZXg6IG9iai5yZWdleCwgZ3JvdXA6IG9iai5ncm91cCB9XG4gIH1cbiAgcmV0dXJuIG51bGxcbn1cbiIsICJpbXBvcnQgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEluc2VydGFibGUsIFNlbGVjdGFibGUsIFVwZGF0ZWFibGUgfSBmcm9tICdreXNlbHknXG5cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YWJhc2Uge1xuICB1c2VyczogVXNlcnNUYWJsZVxuICBtYWlsYm94ZXM6IE1haWxib3hlc1RhYmxlXG4gIGRvbWFpbl9maWx0ZXJzOiBEb21haW5GaWx0ZXJzVGFibGVcbiAgbWVzc2FnZXM6IE1lc3NhZ2VzVGFibGVcbiAgZXh0cmFjdGlvbl9hcnRpZmFjdHM6IEV4dHJhY3Rpb25BcnRpZmFjdHNUYWJsZVxuICBzeW5jX3J1bnM6IFN5bmNSdW5zVGFibGVcbiAgcGFyc2luZ190ZW1wbGF0ZXM6IFBhcnNpbmdUZW1wbGF0ZXNUYWJsZVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1haWxib3hlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICAvKiogJ2ZpeHR1cmUnIHwgJ2dtYWlsJyAqL1xuICBwcm92aWRlcjogc3RyaW5nXG4gIGxhYmVsOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICAvKiogT3BhcXVlIHByb3ZpZGVyIHN5bmMgY3Vyc29yLiAqL1xuICBzeW5jX2N1cnNvcjogc3RyaW5nIHwgbnVsbFxuICAvKiogV2hlbiB0cnVlLCB3b3JrZXIgc2hvdWxkIHN5bmMgQVNBUC4gKi9cbiAgc3luY19yZXF1ZXN0ZWQ6IGJvb2xlYW5cbiAgLyoqIEpTT046IHsgYWNjZXNzVG9rZW4sIHJlZnJlc2hUb2tlbj8sIGV4cGlyZXNBdE1zPyB9IGZvciBnbWFpbC4gKi9cbiAgb2F1dGhfdG9rZW5zX2pzb246IHN0cmluZyB8IG51bGxcbiAgbGFzdF9zeW5jZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsIHN0cmluZyB8IG51bGw+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBEb21haW5GaWx0ZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIC8qKiBEb21haW4gKGFtYXpvbi5jb20pIG9yIGZ1bGwgYWRkcmVzcyAobm9yZXBseUBhbWF6b24uY29tKS4gKi9cbiAgcGF0dGVybjogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBNZXNzYWdlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwcm92aWRlcl9tZXNzYWdlX2lkOiBzdHJpbmdcbiAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBzdHJpbmc+XG4gIGJvZHlfaGFzaDogc3RyaW5nIHwgbnVsbFxuICB0ZXh0X2JvZHk6IHN0cmluZyB8IG51bGxcbiAgaHRtbF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBFeHRyYWN0aW9uQXJ0aWZhY3RzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgbWVzc2FnZV9pZDogbnVtYmVyXG4gIGtpbmQ6IHN0cmluZ1xuICBwYXlsb2FkOiBDb2x1bW5UeXBlPHVua25vd24sIHN0cmluZyB8IHVua25vd24sIHN0cmluZyB8IHVua25vd24+XG4gIGNvbmZpZGVuY2U6IG51bWJlclxuICAvKiogJ3BlbmRpbmcnIHwgJ2FjY2VwdGVkJyB8ICdyZWplY3RlZCcgKi9cbiAgc3RhdHVzOiBzdHJpbmdcbiAgLyoqIHNwZW5kbWFuYWdlciBleHBlbnNlIGlkIGFmdGVyIGFjY2VwdCtwdWJsaXNoICovXG4gIHB1Ymxpc2hlZF9leHBlbnNlX2lkOiBudW1iZXIgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYXJzaW5nVGVtcGxhdGVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBtYXRjaF9mcm9tX3BhdHRlcm46IHN0cmluZ1xuICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IENvbHVtblR5cGU8dW5rbm93biwgc3RyaW5nIHwgdW5rbm93biwgc3RyaW5nIHwgdW5rbm93bj5cbiAgc291cmNlX21lc3NhZ2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdmVyc2lvbjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBTeW5jUnVuc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBzdGFydGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIGZpbmlzaGVkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICBmZXRjaGVkX2NvdW50OiBudW1iZXJcbiAgZXh0cmFjdGVkX2NvdW50OiBudW1iZXJcbiAgZXJyb3JfdGV4dDogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgdHlwZSBVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTWFpbGJveCA9IFNlbGVjdGFibGU8TWFpbGJveGVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdNYWlsYm94ID0gSW5zZXJ0YWJsZTxNYWlsYm94ZXNUYWJsZT5cbmV4cG9ydCB0eXBlIERvbWFpbkZpbHRlciA9IFNlbGVjdGFibGU8RG9tYWluRmlsdGVyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTWVzc2FnZSA9IFNlbGVjdGFibGU8TWVzc2FnZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEV4dHJhY3Rpb25BcnRpZmFjdCA9IFNlbGVjdGFibGU8RXh0cmFjdGlvbkFydGlmYWN0c1RhYmxlPlxuZXhwb3J0IHR5cGUgU3luY1J1biA9IFNlbGVjdGFibGU8U3luY1J1bnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1N5bmNSdW4gPSBJbnNlcnRhYmxlPFN5bmNSdW5zVGFibGU+XG5leHBvcnQgdHlwZSBQYXJzaW5nVGVtcGxhdGUgPSBTZWxlY3RhYmxlPFBhcnNpbmdUZW1wbGF0ZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1BhcnNpbmdUZW1wbGF0ZSA9IEluc2VydGFibGU8UGFyc2luZ1RlbXBsYXRlc1RhYmxlPlxuIiwgImltcG9ydCB7IFBvb2wsIHR5cGVzIH0gZnJvbSAncGcnXG5pbXBvcnQgeyBLeXNlbHksIFBvc3RncmVzRGlhbGVjdCB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IGVudiB9IGZyb20gJy4vZW52LnRzJ1xuaW1wb3J0IHtcbiAgY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMsXG4gIHNzbEZvckRhdGFiYXNlVXJsLFxufSBmcm9tICcuL3NzbC50cydcblxuLy8gS2VlcCBQb3N0Z3JlcyBgZGF0ZWAgYXMgYFlZWVktTU0tRERgIHN0cmluZ3MuIFRoZSBkZWZhdWx0IHBnIHBhcnNlciB0dXJuc1xuLy8gdGhlbSBpbnRvIEpTIERhdGUgb2JqZWN0cywgd2hpY2ggR3JhcGhRTCB0aGVuIHN0cmluZ2lmaWVzIGFzIGZ1bGwgdGltZXN0YW1wc1xuLy8gYW5kIGJyZWFrcyBGbHV0dGVyJ3MgZGF0ZS1vbmx5IHBhcnNpbmcuXG50eXBlcy5zZXRUeXBlUGFyc2VyKHR5cGVzLmJ1aWx0aW5zLkRBVEUsICh2YWx1ZTogc3RyaW5nKSA9PiB2YWx1ZSlcblxuZXhwb3J0IHR5cGUgQ3JlYXRlS3lzZWx5T3B0aW9ucyA9IHtcbiAgLyoqIEZhbGxiYWNrIHdoZW4gYFBHREFUQUJBU0VgIC8gYERBVEFCQVNFX1VSTGAgYXJlIHVuc2V0LiAqL1xuICBkZWZhdWx0RGF0YWJhc2U6IHN0cmluZ1xufVxuXG5mdW5jdGlvbiBwb29sQ29uZmlnRnJvbUVudihcbiAgZGVmYXVsdERhdGFiYXNlOiBzdHJpbmcsXG4pOiBDb25zdHJ1Y3RvclBhcmFtZXRlcnM8dHlwZW9mIFBvb2w+WzBdIHtcbiAgY29uc3QgZGF0YWJhc2VVcmwgPSBlbnYoJ0RBVEFCQVNFX1VSTCcpXG4gIGlmIChkYXRhYmFzZVVybCkge1xuICAgIGNvbnN0IHNzbCA9IHNzbEZvckRhdGFiYXNlVXJsKGRhdGFiYXNlVXJsKVxuICAgIHJldHVybiB7XG4gICAgICBjb25uZWN0aW9uU3RyaW5nOiBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyhkYXRhYmFzZVVybCksXG4gICAgICBtYXg6IDEwLFxuICAgICAgLi4uKHNzbCA9PT0gdW5kZWZpbmVkID8ge30gOiB7IHNzbCB9KSxcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRhdGFiYXNlOiBlbnYoJ1BHREFUQUJBU0UnKSA/PyBkZWZhdWx0RGF0YWJhc2UsXG4gICAgaG9zdDogZW52KCdQR0hPU1QnKSA/PyAnbG9jYWxob3N0JyxcbiAgICB1c2VyOiBlbnYoJ1BHVVNFUicpID8/ICdwb3N0Z3JlcycsXG4gICAgcGFzc3dvcmQ6IGVudignUEdQQVNTV09SRCcpID8/ICd0ZXN0MTIzNCcsXG4gICAgcG9ydDogTnVtYmVyKGVudignUEdQT1JUJykgPz8gJzU0MzInKSxcbiAgICBtYXg6IDEwLFxuICB9XG59XG5cbi8qKiBDcmVhdGUgYSBLeXNlbHkgaW5zdGFuY2UgZm9yIHRoZSBnaXZlbiBzY2hlbWEgdHlwZSBhbmQgZGVmYXVsdCBEQiBuYW1lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUt5c2VseTxEQj4ob3B0aW9uczogQ3JlYXRlS3lzZWx5T3B0aW9ucyk6IEt5c2VseTxEQj4ge1xuICBjb25zdCBkaWFsZWN0ID0gbmV3IFBvc3RncmVzRGlhbGVjdCh7XG4gICAgcG9vbDogbmV3IFBvb2wocG9vbENvbmZpZ0Zyb21FbnYob3B0aW9ucy5kZWZhdWx0RGF0YWJhc2UpKSxcbiAgfSlcbiAgcmV0dXJuIG5ldyBLeXNlbHk8REI+KHsgZGlhbGVjdCB9KVxufVxuIiwgIi8qKiBSZWFkIGFuIGVudiB2YXIgZnJvbSBOb2RlIGBwcm9jZXNzLmVudmAgb3IgRGVubyAoUHlsb24gYnVuZGxlcyBydW4gdW5kZXIgTm9kZSkuICovXG5leHBvcnQgZnVuY3Rpb24gZW52KG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LltuYW1lXSkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltuYW1lXVxuICB9XG4gIGlmICh0eXBlb2YgRGVubyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIERlbm8uZW52Py5nZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gRGVuby5lbnYuZ2V0KG5hbWUpXG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZFxufVxuIiwgIi8qKiBUTFMgb3B0aW9ucyBmb3IgYHBnYCBmcm9tIGEgUG9zdGdyZXMgVVJMLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNzbEZvckRhdGFiYXNlVXJsKFxuICBkYXRhYmFzZVVybDogc3RyaW5nLFxuKTogZmFsc2UgfCB7IHJlamVjdFVuYXV0aG9yaXplZDogYm9vbGVhbiB9IHwgdW5kZWZpbmVkIHtcbiAgbGV0IHVybDogVVJMXG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTChkYXRhYmFzZVVybClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgY29uc3QgbW9kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCdzc2xtb2RlJyk/LnRvTG93ZXJDYXNlKClcbiAgaWYgKG1vZGUgPT09ICdkaXNhYmxlJykgcmV0dXJuIGZhbHNlXG4gIGlmIChtb2RlID09PSAncmVxdWlyZScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1jYScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1mdWxsJykge1xuICAgIHJldHVybiB7IHJlamVjdFVuYXV0aG9yaXplZDogZmFsc2UgfVxuICB9XG5cbiAgY29uc3QgaG9zdCA9IHVybC5ob3N0bmFtZVxuICBpZiAoaG9zdCA9PT0gJ2xvY2FsaG9zdCcgfHwgaG9zdCA9PT0gJzEyNy4wLjAuMScpIHJldHVybiB1bmRlZmluZWRcblxuICByZXR1cm4geyByZWplY3RVbmF1dGhvcml6ZWQ6IGZhbHNlIH1cbn1cblxuLyoqXG4gKiBTdHJpcCBTU0wgcXVlcnkgcGFyYW1zIGZyb20gYSBQb3N0Z3JlcyBVUkwgYmVmb3JlIHBhc3NpbmcgaXQgdG8gYHBnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zKGRhdGFiYXNlVXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoZGF0YWJhc2VVcmwpXG4gICAgZm9yIChjb25zdCBrZXkgb2YgW1xuICAgICAgJ3NzbG1vZGUnLFxuICAgICAgJ3NzbCcsXG4gICAgICAnc3Nscm9vdGNlcnQnLFxuICAgICAgJ3NzbGNlcnQnLFxuICAgICAgJ3NzbGtleScsXG4gICAgXSkge1xuICAgICAgdXJsLnNlYXJjaFBhcmFtcy5kZWxldGUoa2V5KVxuICAgIH1cbiAgICByZXR1cm4gdXJsLnRvU3RyaW5nKClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGRhdGFiYXNlVXJsXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBEYXRhYmFzZSB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3JlYXRlS3lzZWx5IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2NyZWF0ZV9reXNlbHkudHMnXG5cbmV4cG9ydCB7IGVudiB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMnXG5cbmV4cG9ydCBjb25zdCBkYiA9IGNyZWF0ZUt5c2VseTxEYXRhYmFzZT4oe1xuICBkZWZhdWx0RGF0YWJhc2U6ICdtYWlsYm94Jyxcbn0pXG4iLCAiaW1wb3J0IHsgZW52IGFzIHJlYWRFbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvZW52LnRzJ1xuXG5leHBvcnQgdHlwZSBHZW5lcmF0ZVRlbXBsYXRlQWlJbnB1dCA9IHtcbiAgZnJvbTogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICB0ZXh0Qm9keT86IHN0cmluZyB8IG51bGxcbiAgaHRtbEJvZHk/OiBzdHJpbmcgfCBudWxsXG4gIGhpbnRzPzogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgdHlwZSBHZW5lcmF0ZVRlbXBsYXRlQWlPdXRwdXQgPSB7XG4gIG1hdGNoRnJvbVBhdHRlcm46IHN0cmluZ1xuICBtYXRjaFN1YmplY3RSZWdleDogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBuYW1lU3VnZ2VzdGlvbjogc3RyaW5nXG59XG5cbmV4cG9ydCBjbGFzcyBBaUNsaWVudEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdBaUNsaWVudEVycm9yJ1xuICB9XG59XG5cbi8qKlxuICogQ2FsbCBhaS1hcGkgZ2VuZXJhdGVfZW1haWxfc3BlbmRfdGVtcGxhdGUgdXNlIGNhc2UuXG4gKiBPdmVycmlkYWJsZSBmZXRjaCBmb3IgdGVzdHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUVtYWlsU3BlbmRUZW1wbGF0ZShcbiAgaW5wdXQ6IEdlbmVyYXRlVGVtcGxhdGVBaUlucHV0LFxuICBvcHRpb25zPzoge1xuICAgIGJhc2VVcmw/OiBzdHJpbmdcbiAgICBzZXJ2aWNlS2V5Pzogc3RyaW5nXG4gICAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoXG4gIH0sXG4pOiBQcm9taXNlPEdlbmVyYXRlVGVtcGxhdGVBaU91dHB1dD4ge1xuICBjb25zdCBiYXNlVXJsID0gKG9wdGlvbnM/LmJhc2VVcmwgPz9cbiAgICByZWFkRW52KCdBSV9BUElfQkFTRV9VUkwnKSA/P1xuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDQnKS5yZXBsYWNlKC9cXC8kLywgJycpXG4gIGNvbnN0IHNlcnZpY2VLZXkgPSBvcHRpb25zPy5zZXJ2aWNlS2V5ID8/IHJlYWRFbnYoJ0FJX1NFUlZJQ0VfS0VZJylcbiAgaWYgKCFzZXJ2aWNlS2V5KSB7XG4gICAgdGhyb3cgbmV3IEFpQ2xpZW50RXJyb3IoJ0FJX1NFUlZJQ0VfS0VZIGlzIG5vdCBjb25maWd1cmVkJylcbiAgfVxuXG4gIGNvbnN0IGZldGNoSW1wbCA9IG9wdGlvbnM/LmZldGNoSW1wbCA/PyBmZXRjaFxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaEltcGwoXG4gICAgYCR7YmFzZVVybH0vdjEvdXNlLWNhc2VzL2dlbmVyYXRlX2VtYWlsX3NwZW5kX3RlbXBsYXRlL3J1bmAsXG4gICAge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtzZXJ2aWNlS2V5fWAsXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGZyb206IGlucHV0LmZyb20sXG4gICAgICAgICAgc3ViamVjdDogaW5wdXQuc3ViamVjdCxcbiAgICAgICAgICB0ZXh0Qm9keTogaW5wdXQudGV4dEJvZHkgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgIGh0bWxCb2R5OiBpbnB1dC5odG1sQm9keSA/PyB1bmRlZmluZWQsXG4gICAgICAgICAgaGludHM6IGlucHV0LmhpbnRzID8/IHVuZGVmaW5lZCxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIH0sXG4gIClcblxuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpLmNhdGNoKCgpID0+ICcnKVxuICAgIHRocm93IG5ldyBBaUNsaWVudEVycm9yKFxuICAgICAgYGFpLWFwaSBlcnJvciAke3Jlcy5zdGF0dXN9OiAke3RleHQuc2xpY2UoMCwgMzAwKX1gLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IGJvZHkgPSBhd2FpdCByZXMuanNvbigpIGFzIHsgb3V0cHV0PzogR2VuZXJhdGVUZW1wbGF0ZUFpT3V0cHV0IH1cbiAgaWYgKCFib2R5Lm91dHB1dCkge1xuICAgIHRocm93IG5ldyBBaUNsaWVudEVycm9yKCdhaS1hcGkgcmVzcG9uc2UgbWlzc2luZyBvdXRwdXQnKVxuICB9XG4gIHJldHVybiBib2R5Lm91dHB1dFxufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBhc0lzb1RpbWVzdGFtcCh2YWx1ZTogRGF0ZSB8IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcbiAgaWYgKC9eXFxkezEwLH0kLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgY29uc3QgbiA9IE51bWJlcih0cmltbWVkKVxuICAgIGNvbnN0IG1zID0gdHJpbW1lZC5sZW5ndGggPD0gMTAgPyBuICogMTAwMCA6IG5cbiAgICByZXR1cm4gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKClcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFzSXNvVGltZXN0YW1wT3JOdWxsKFxuICB2YWx1ZTogRGF0ZSB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiBhc0lzb1RpbWVzdGFtcCh2YWx1ZSlcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHsgRGF0YWJhc2UgfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBhc0lzb1RpbWVzdGFtcCB9IGZyb20gJy4uL2dyYXBocWwvdGltZXN0YW1wcy50cydcblxuLyoqIEdyYXBoUUwgTWVzc2FnZSBzaGFwZSAoSVNPIHRpbWVzdGFtcHMgYXMgc3RyaW5ncykuICovXG5leHBvcnQgdHlwZSBPd25lZE1lc3NhZ2UgPSB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gIGZyb21fYWRkcmVzczogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZF9hdDogc3RyaW5nXG4gIHRleHRfYm9keTogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG59XG5cbmV4cG9ydCB0eXBlIE1lc3NhZ2VKb2luUm93ID0ge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwcm92aWRlcl9tZXNzYWdlX2lkOiBzdHJpbmdcbiAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keTogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59XG5cbi8qKiBNaW5pbWFsIHN0b3JlIHNvIG93bmVyc2hpcCAvIG1pc3NpbmcgcGF0aHMgY2FuIGJlIHVuaXQtdGVzdGVkIHdpdGhvdXQgUG9zdGdyZXMuICovXG5leHBvcnQgdHlwZSBNZXNzYWdlTG9va3VwU3RvcmUgPSB7XG4gIGZpbmRPd25lZE1lc3NhZ2VSb3coXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgbWVzc2FnZUlkOiBudW1iZXIsXG4gICk6IFByb21pc2U8TWVzc2FnZUpvaW5Sb3cgfCB1bmRlZmluZWQ+XG4gIGZpbmRTb3VyY2VNZXNzYWdlUm93KFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGV4cGVuc2VJZDogbnVtYmVyLFxuICApOiBQcm9taXNlPE1lc3NhZ2VKb2luUm93IHwgdW5kZWZpbmVkPlxufVxuXG5leHBvcnQgZnVuY3Rpb24gbWFwT3duZWRNZXNzYWdlKHJvdzogTWVzc2FnZUpvaW5Sb3cpOiBPd25lZE1lc3NhZ2Uge1xuICByZXR1cm4ge1xuICAgIGlkOiByb3cuaWQsXG4gICAgbWFpbGJveF9pZDogcm93Lm1haWxib3hfaWQsXG4gICAgcHJvdmlkZXJfbWVzc2FnZV9pZDogcm93LnByb3ZpZGVyX21lc3NhZ2VfaWQsXG4gICAgcmZjX21lc3NhZ2VfaWQ6IHJvdy5yZmNfbWVzc2FnZV9pZCxcbiAgICBmcm9tX2FkZHJlc3M6IHJvdy5mcm9tX2FkZHJlc3MsXG4gICAgc3ViamVjdDogcm93LnN1YmplY3QsXG4gICAgcmVjZWl2ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5yZWNlaXZlZF9hdCksXG4gICAgdGV4dF9ib2R5OiByb3cudGV4dF9ib2R5ID8/IG51bGwsXG4gICAgaHRtbF9ib2R5OiByb3cuaHRtbF9ib2R5ID8/IG51bGwsXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVLeXNlbHlNZXNzYWdlTG9va3VwU3RvcmUoXG4gIGRiOiBLeXNlbHk8RGF0YWJhc2U+LFxuKTogTWVzc2FnZUxvb2t1cFN0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBhc3luYyBmaW5kT3duZWRNZXNzYWdlUm93KHVzZXJJZCwgbWVzc2FnZUlkKSB7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ21lc3NhZ2VzJylcbiAgICAgICAgLmlubmVySm9pbignbWFpbGJveGVzJywgJ21haWxib3hlcy5pZCcsICdtZXNzYWdlcy5tYWlsYm94X2lkJylcbiAgICAgICAgLnNlbGVjdEFsbCgnbWVzc2FnZXMnKVxuICAgICAgICAud2hlcmUoJ21lc3NhZ2VzLmlkJywgJz0nLCBtZXNzYWdlSWQpXG4gICAgICAgIC53aGVyZSgnbWFpbGJveGVzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIH0sXG4gICAgYXN5bmMgZmluZFNvdXJjZU1lc3NhZ2VSb3codXNlcklkLCBleHBlbnNlSWQpIHtcbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuaW5uZXJKb2luKFxuICAgICAgICAgICdtZXNzYWdlcycsXG4gICAgICAgICAgJ21lc3NhZ2VzLmlkJyxcbiAgICAgICAgICAnZXh0cmFjdGlvbl9hcnRpZmFjdHMubWVzc2FnZV9pZCcsXG4gICAgICAgIClcbiAgICAgICAgLmlubmVySm9pbignbWFpbGJveGVzJywgJ21haWxib3hlcy5pZCcsICdtZXNzYWdlcy5tYWlsYm94X2lkJylcbiAgICAgICAgLnNlbGVjdEFsbCgnbWVzc2FnZXMnKVxuICAgICAgICAud2hlcmUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLnB1Ymxpc2hlZF9leHBlbnNlX2lkJywgJz0nLCBleHBlbnNlSWQpXG4gICAgICAgIC53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuc3RhdHVzJywgJz0nLCAnYWNjZXB0ZWQnKVxuICAgICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5vcmRlckJ5KCdleHRyYWN0aW9uX2FydGlmYWN0cy5pZCcsICdkZXNjJylcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIH0sXG4gIH1cbn1cblxuLyoqIFVzZXItc2NvcGVkIG1lc3NhZ2UgYnkgaWQuIFJldHVybnMgbnVsbCB3aGVuIG1pc3Npbmcgb3Igbm90IG93bmVkLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZpbmRPd25lZE1lc3NhZ2UoXG4gIHN0b3JlOiBNZXNzYWdlTG9va3VwU3RvcmUsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBtZXNzYWdlSWQ6IG51bWJlcixcbik6IFByb21pc2U8T3duZWRNZXNzYWdlIHwgbnVsbD4ge1xuICBjb25zdCByb3cgPSBhd2FpdCBzdG9yZS5maW5kT3duZWRNZXNzYWdlUm93KHVzZXJJZCwgbWVzc2FnZUlkKVxuICByZXR1cm4gcm93ID8gbWFwT3duZWRNZXNzYWdlKHJvdykgOiBudWxsXG59XG5cbi8qKlxuICogUmV2ZXJzZSBsb29rdXA6IGFjY2VwdGVkIGFydGlmYWN0IHdpdGggcHVibGlzaGVkX2V4cGVuc2VfaWQgXHUyMTkyIHNvdXJjZSBtZXNzYWdlLlxuICogUmV0dXJucyBudWxsIHdoZW4gbm8gbWF0Y2hpbmcgYWNjZXB0ZWQgcHVibGlzaCBleGlzdHMgZm9yIHRoaXMgdXNlci5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZpbmRTb3VyY2VNZXNzYWdlRm9yRXhwZW5zZShcbiAgc3RvcmU6IE1lc3NhZ2VMb29rdXBTdG9yZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIGV4cGVuc2VJZDogbnVtYmVyLFxuKTogUHJvbWlzZTxPd25lZE1lc3NhZ2UgfCBudWxsPiB7XG4gIGNvbnN0IHJvdyA9IGF3YWl0IHN0b3JlLmZpbmRTb3VyY2VNZXNzYWdlUm93KHVzZXJJZCwgZXhwZW5zZUlkKVxuICByZXR1cm4gcm93ID8gbWFwT3duZWRNZXNzYWdlKHJvdykgOiBudWxsXG59XG4iLCAiaW1wb3J0IHsgZW52IGFzIHJlYWRFbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvZW52LnRzJ1xuaW1wb3J0IHR5cGUgeyBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQgfSBmcm9tICdtYWlsYm94X2tpdC9tb2QudHMnXG5cbmV4cG9ydCBjbGFzcyBTcGVuZG1hbmFnZXJTaW5rRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ1NwZW5kbWFuYWdlclNpbmtFcnJvcidcbiAgfVxufVxuXG5leHBvcnQgdHlwZSBQdWJsaXNoRXhwZW5zZVJlc3VsdCA9IHtcbiAgZXhwZW5zZUlkOiBudW1iZXJcbn1cblxuLyoqXG4gKiBQdWJsaXNoIGFuIGFjY2VwdGVkIHNwZW5kaW5nIGNhbmRpZGF0ZSB0byBzcGVuZG1hbmFnZXItYXBpIHZpYSBHcmFwaFFMLFxuICogZm9yd2FyZGluZyB0aGUgY2FsbGVyJ3MgU3VwZXJUb2tlbnMgQmVhcmVyIEpXVC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHB1Ymxpc2hFeHBlbnNlVG9TcGVuZG1hbmFnZXIoXG4gIGNhbmRpZGF0ZTogU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkLFxuICBjYXRlZ29yeUlkOiBudW1iZXIsXG4gIGF1dGhvcml6YXRpb25IZWFkZXI6IHN0cmluZyxcbiAgb3B0aW9ucz86IHtcbiAgICBiYXNlVXJsPzogc3RyaW5nXG4gICAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoXG4gIH0sXG4pOiBQcm9taXNlPFB1Ymxpc2hFeHBlbnNlUmVzdWx0PiB7XG4gIGlmICghYXV0aG9yaXphdGlvbkhlYWRlcj8uc3RhcnRzV2l0aCgnQmVhcmVyICcpKSB7XG4gICAgdGhyb3cgbmV3IFNwZW5kbWFuYWdlclNpbmtFcnJvcignbWlzc2luZyBCZWFyZXIgYXV0aG9yaXphdGlvbicpXG4gIH1cblxuICBjb25zdCBiYXNlVXJsID0gKG9wdGlvbnM/LmJhc2VVcmwgPz9cbiAgICByZWFkRW52KCdTUEVORE1BTkFHRVJfQVBJX0JBU0VfVVJMJykgPz9cbiAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAyJykucmVwbGFjZSgvXFwvJC8sICcnKVxuXG4gIGNvbnN0IG5vdGUgPSBjYW5kaWRhdGUubm90ZT8udHJpbSgpIHx8XG4gICAgW2NhbmRpZGF0ZS5tZXJjaGFudCwgY2FuZGlkYXRlLnNvdXJjZVN1YmplY3RdLmZpbHRlcihCb29sZWFuKS5qb2luKCcgXHUyMDE0ICcpIHx8XG4gICAgbnVsbFxuXG4gIGNvbnN0IHF1ZXJ5ID0gYFxuICAgIG11dGF0aW9uIENyZWF0ZUV4cGVuc2UoJGlucHV0OiBDcmVhdGVFeHBlbnNlSW5wdXRJbnB1dCEpIHtcbiAgICAgIGNyZWF0ZUV4cGVuc2UoYXJnczogeyBpbnB1dDogJGlucHV0IH0pIHtcbiAgICAgICAgaWRcbiAgICAgIH1cbiAgICB9XG4gIGBcblxuICBjb25zdCBmZXRjaEltcGwgPSBvcHRpb25zPy5mZXRjaEltcGwgPz8gZmV0Y2hcbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2hJbXBsKGAke2Jhc2VVcmx9L2dyYXBocWxgLCB7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgaGVhZGVyczoge1xuICAgICAgQXV0aG9yaXphdGlvbjogYXV0aG9yaXphdGlvbkhlYWRlcixcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgfSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBxdWVyeSxcbiAgICAgIHZhcmlhYmxlczoge1xuICAgICAgICBpbnB1dDoge1xuICAgICAgICAgIGNhdGVnb3J5SWQsXG4gICAgICAgICAgYW1vdW50Q2VudHM6IGNhbmRpZGF0ZS5hbW91bnRDZW50cyxcbiAgICAgICAgICBzcGVudE9uOiBjYW5kaWRhdGUuc3BlbnRPbixcbiAgICAgICAgICBjdXJyZW5jeTogY2FuZGlkYXRlLmN1cnJlbmN5LFxuICAgICAgICAgIG5vdGUsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pLFxuICB9KVxuXG4gIGlmICghcmVzLm9rKSB7XG4gICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlcy50ZXh0KCkuY2F0Y2goKCkgPT4gJycpXG4gICAgdGhyb3cgbmV3IFNwZW5kbWFuYWdlclNpbmtFcnJvcihcbiAgICAgIGBzcGVuZG1hbmFnZXIgSFRUUCAke3Jlcy5zdGF0dXN9OiAke3RleHQuc2xpY2UoMCwgMzAwKX1gLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IGJvZHkgPSBhd2FpdCByZXMuanNvbigpIGFzIHtcbiAgICBkYXRhPzogeyBjcmVhdGVFeHBlbnNlPzogeyBpZDogbnVtYmVyIH0gfVxuICAgIGVycm9ycz86IHsgbWVzc2FnZTogc3RyaW5nIH1bXVxuICB9XG5cbiAgaWYgKGJvZHkuZXJyb3JzPy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgU3BlbmRtYW5hZ2VyU2lua0Vycm9yKFxuICAgICAgYm9keS5lcnJvcnMubWFwKChlKSA9PiBlLm1lc3NhZ2UpLmpvaW4oJzsgJyksXG4gICAgKVxuICB9XG5cbiAgY29uc3QgaWQgPSBib2R5LmRhdGE/LmNyZWF0ZUV4cGVuc2U/LmlkXG4gIGlmICh0eXBlb2YgaWQgIT09ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IFNwZW5kbWFuYWdlclNpbmtFcnJvcignc3BlbmRtYW5hZ2VyIHJlc3BvbnNlIG1pc3NpbmcgZXhwZW5zZSBpZCcpXG4gIH1cbiAgcmV0dXJuIHsgZXhwZW5zZUlkOiBpZCB9XG59XG4iLCAiLyoqIEdtYWlsIE9BdXRoIGF1dGhvcml6YXRpb24tY29kZSBoZWxwZXJzIChzdGFydCArIGNhbGxiYWNrKS4gKi9cblxuaW1wb3J0IHsgZW52IGFzIHJlYWRFbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvZW52LnRzJ1xuXG5leHBvcnQgY29uc3QgR01BSUxfUkVBRE9OTFlfU0NPUEUgPVxuICAnaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vYXV0aC9nbWFpbC5yZWFkb25seSdcblxuZXhwb3J0IGNvbnN0IEdPT0dMRV9BVVRIT1JJWkVfVVJMID1cbiAgJ2h0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbS9vL29hdXRoMi92Mi9hdXRoJ1xuXG5leHBvcnQgY29uc3QgR09PR0xFX1RPS0VOX1VSTCA9ICdodHRwczovL29hdXRoMi5nb29nbGVhcGlzLmNvbS90b2tlbidcblxuY29uc3QgU1RBVEVfVFRMX1NFQ09ORFMgPSAxMCAqIDYwXG5cbmV4cG9ydCBpbnRlcmZhY2UgR21haWxPQXV0aENvbmZpZyB7XG4gIGNsaWVudElkOiBzdHJpbmdcbiAgY2xpZW50U2VjcmV0OiBzdHJpbmdcbiAgcmVkaXJlY3RVcmk6IHN0cmluZ1xuICByZXR1cm5Ub0FsbG93bGlzdDogc3RyaW5nW11cbn1cblxuZXhwb3J0IGludGVyZmFjZSBHbWFpbE9BdXRoU3RhdGVQYXlsb2FkIHtcbiAgdXNlcklkOiBudW1iZXJcbiAgbWFpbGJveElkOiBudW1iZXJcbiAgcmV0dXJuVG86IHN0cmluZ1xuICBleHA6IG51bWJlclxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdtYWlsVG9rZW5SZXN1bHQge1xuICBhY2Nlc3NUb2tlbjogc3RyaW5nXG4gIHJlZnJlc2hUb2tlbjogc3RyaW5nIHwgbnVsbFxuICBleHBpcmVzQXRNczogbnVtYmVyIHwgbnVsbFxufVxuXG5leHBvcnQgY2xhc3MgR21haWxPQXV0aEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdHbWFpbE9BdXRoRXJyb3InXG4gIH1cbn1cblxuLyoqIExvYWQgR21haWwgT0F1dGggc2V0dGluZ3MgKG9taXQgYGVudmAgdG8gcmVhZCBwcm9jZXNzL0Rlbm8gdmlhIGRlbm9fYXBpX2tpdCkuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEdtYWlsT0F1dGhDb25maWcoXG4gIGVudj86IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4sXG4pOiBHbWFpbE9BdXRoQ29uZmlnIHtcbiAgY29uc3Qgc291cmNlID0gZW52ID8/IHtcbiAgICBHTUFJTF9PQVVUSF9DTElFTlRfSUQ6IHJlYWRFbnYoJ0dNQUlMX09BVVRIX0NMSUVOVF9JRCcpLFxuICAgIEdNQUlMX09BVVRIX0NMSUVOVF9TRUNSRVQ6IHJlYWRFbnYoJ0dNQUlMX09BVVRIX0NMSUVOVF9TRUNSRVQnKSxcbiAgICBHTUFJTF9PQVVUSF9SRURJUkVDVF9VUkk6IHJlYWRFbnYoJ0dNQUlMX09BVVRIX1JFRElSRUNUX1VSSScpLFxuICAgIEdNQUlMX09BVVRIX1JFVFVSTl9UT19BTExPV0xJU1Q6IHJlYWRFbnYoJ0dNQUlMX09BVVRIX1JFVFVSTl9UT19BTExPV0xJU1QnKSxcbiAgfVxuICBjb25zdCBjbGllbnRJZCA9IHNvdXJjZS5HTUFJTF9PQVVUSF9DTElFTlRfSUQ/LnRyaW0oKSA/PyAnJ1xuICBjb25zdCBjbGllbnRTZWNyZXQgPSBzb3VyY2UuR01BSUxfT0FVVEhfQ0xJRU5UX1NFQ1JFVD8udHJpbSgpID8/ICcnXG4gIGNvbnN0IHJlZGlyZWN0VXJpID0gKHNvdXJjZS5HTUFJTF9PQVVUSF9SRURJUkVDVF9VUkk/LnRyaW0oKSB8fFxuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDMvb2F1dGgvZ21haWwvY2FsbGJhY2snKVxuICBjb25zdCBhbGxvd1JhdyA9IHNvdXJjZS5HTUFJTF9PQVVUSF9SRVRVUk5fVE9fQUxMT1dMSVNUPy50cmltKCkgfHxcbiAgICAnaHR0cDovL2xvY2FsaG9zdDo0NDQ1LHNwZW5kbWFuYWdlcjovL3NldHRpbmdzL2VtYWlsLWltcG9ydCdcbiAgY29uc3QgcmV0dXJuVG9BbGxvd2xpc3QgPSBhbGxvd1Jhd1xuICAgIC5zcGxpdCgnLCcpXG4gICAgLm1hcCgocykgPT4gcy50cmltKCkpXG4gICAgLmZpbHRlcihCb29sZWFuKVxuXG4gIGlmICghY2xpZW50SWQgfHwgIWNsaWVudFNlY3JldCkge1xuICAgIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoXG4gICAgICAnR01BSUxfT0FVVEhfQ0xJRU5UX0lEIGFuZCBHTUFJTF9PQVVUSF9DTElFTlRfU0VDUkVUIGFyZSByZXF1aXJlZCcsXG4gICAgKVxuICB9XG4gIGlmIChyZXR1cm5Ub0FsbG93bGlzdC5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKCdHTUFJTF9PQVVUSF9SRVRVUk5fVE9fQUxMT1dMSVNUIGlzIGVtcHR5JylcbiAgfVxuXG4gIHJldHVybiB7IGNsaWVudElkLCBjbGllbnRTZWNyZXQsIHJlZGlyZWN0VXJpLCByZXR1cm5Ub0FsbG93bGlzdCB9XG59XG5cbi8qKiBUcnVlIHdoZW4gYHJldHVyblRvYCBvcmlnaW4gKG9yIHNjaGVtZSBwcmVmaXgpIG1hdGNoZXMgYW4gYWxsb3dsaXN0IGVudHJ5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUmV0dXJuVG9BbGxvd2VkKFxuICByZXR1cm5Ubzogc3RyaW5nLFxuICBhbGxvd2xpc3Q6IHN0cmluZ1tdLFxuKTogYm9vbGVhbiB7XG4gIGxldCB1cmw6IFVSTFxuICB0cnkge1xuICAgIHVybCA9IG5ldyBVUkwocmV0dXJuVG8pXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgaWYgKHVybC51c2VybmFtZSB8fCB1cmwucGFzc3dvcmQpIHJldHVybiBmYWxzZVxuICBpZiAodXJsLmhhc2gpIHJldHVybiBmYWxzZVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgYWxsb3dsaXN0KSB7XG4gICAgaWYgKCFlbnRyeSkgY29udGludWVcbiAgICB0cnkge1xuICAgICAgY29uc3QgYWxsb3dlZCA9IG5ldyBVUkwoZW50cnkpXG4gICAgICBpZiAodXJsLnByb3RvY29sID09PSBhbGxvd2VkLnByb3RvY29sICYmIHVybC5ob3N0ID09PSBhbGxvd2VkLmhvc3QpIHtcbiAgICAgICAgLy8gQWxsb3cgZXhhY3Qgb3JpZ2luIG9yIGFueSBwYXRoIHVuZGVyIHRoYXQgb3JpZ2luLlxuICAgICAgICBpZiAoIWFsbG93ZWQucGF0aG5hbWUgfHwgYWxsb3dlZC5wYXRobmFtZSA9PT0gJy8nKSByZXR1cm4gdHJ1ZVxuICAgICAgICBjb25zdCBwcmVmaXggPSBhbGxvd2VkLnBhdGhuYW1lLmVuZHNXaXRoKCcvJylcbiAgICAgICAgICA/IGFsbG93ZWQucGF0aG5hbWVcbiAgICAgICAgICA6IGAke2FsbG93ZWQucGF0aG5hbWV9L2BcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHVybC5wYXRobmFtZSA9PT0gYWxsb3dlZC5wYXRobmFtZSB8fFxuICAgICAgICAgIHVybC5wYXRobmFtZS5zdGFydHNXaXRoKHByZWZpeClcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ3VzdG9tIHNjaGVtZXMgd2l0aG91dCBhdXRob3JpdHksIGUuZy4gc3BlbmRtYW5hZ2VyOi8vc2V0dGluZ3MvLi4uXG4gICAgICBpZiAocmV0dXJuVG8gPT09IGVudHJ5IHx8IHJldHVyblRvLnN0YXJ0c1dpdGgoYCR7ZW50cnl9YCkpIHtcbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlXG59XG5cbmZ1bmN0aW9uIGJ5dGVzVG9CYXNlNjRVcmwoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xuICBsZXQgYmluID0gJydcbiAgZm9yIChjb25zdCBiIG9mIGJ5dGVzKSBiaW4gKz0gU3RyaW5nLmZyb21DaGFyQ29kZShiKVxuICByZXR1cm4gYnRvYShiaW4pLnJlcGxhY2UoL1xcKy9nLCAnLScpLnJlcGxhY2UoL1xcLy9nLCAnXycpLnJlcGxhY2UoLz0rJC8sICcnKVxufVxuXG5mdW5jdGlvbiBiYXNlNjRVcmxUb0J5dGVzKHM6IHN0cmluZyk6IFVpbnQ4QXJyYXkge1xuICBjb25zdCBwYWRkZWQgPSBzLnJlcGxhY2UoLy0vZywgJysnKS5yZXBsYWNlKC9fL2csICcvJykgK1xuICAgICc9PT0nLnNsaWNlKChzLmxlbmd0aCArIDMpICUgNClcbiAgY29uc3QgYmluID0gYXRvYihwYWRkZWQpXG4gIGNvbnN0IG91dCA9IG5ldyBVaW50OEFycmF5KGJpbi5sZW5ndGgpXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYmluLmxlbmd0aDsgaSsrKSBvdXRbaV0gPSBiaW4uY2hhckNvZGVBdChpKVxuICByZXR1cm4gb3V0XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhtYWNLZXkoc2VjcmV0OiBzdHJpbmcpOiBQcm9taXNlPENyeXB0b0tleT4ge1xuICByZXR1cm4gY3J5cHRvLnN1YnRsZS5pbXBvcnRLZXkoXG4gICAgJ3JhdycsXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNlY3JldCksXG4gICAgeyBuYW1lOiAnSE1BQycsIGhhc2g6ICdTSEEtMjU2JyB9LFxuICAgIGZhbHNlLFxuICAgIFsnc2lnbicsICd2ZXJpZnknXSxcbiAgKVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2lnbk9BdXRoU3RhdGUoXG4gIHBheWxvYWQ6IE9taXQ8R21haWxPQXV0aFN0YXRlUGF5bG9hZCwgJ2V4cCc+ICYgeyBleHA/OiBudW1iZXIgfSxcbiAgY2xpZW50U2VjcmV0OiBzdHJpbmcsXG4gIG5vd01zOiBudW1iZXIgPSBEYXRlLm5vdygpLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgYm9keTogR21haWxPQXV0aFN0YXRlUGF5bG9hZCA9IHtcbiAgICB1c2VySWQ6IHBheWxvYWQudXNlcklkLFxuICAgIG1haWxib3hJZDogcGF5bG9hZC5tYWlsYm94SWQsXG4gICAgcmV0dXJuVG86IHBheWxvYWQucmV0dXJuVG8sXG4gICAgZXhwOiBwYXlsb2FkLmV4cCA/PyBNYXRoLmZsb29yKG5vd01zIC8gMTAwMCkgKyBTVEFURV9UVExfU0VDT05EUyxcbiAgfVxuICBjb25zdCBwYXlsb2FkQjY0ID0gYnl0ZXNUb0Jhc2U2NFVybChcbiAgICBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoSlNPTi5zdHJpbmdpZnkoYm9keSkpLFxuICApXG4gIGNvbnN0IGtleSA9IGF3YWl0IGhtYWNLZXkoY2xpZW50U2VjcmV0KVxuICBjb25zdCBzaWcgPSBhd2FpdCBjcnlwdG8uc3VidGxlLnNpZ24oXG4gICAgJ0hNQUMnLFxuICAgIGtleSxcbiAgICBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUocGF5bG9hZEI2NCksXG4gIClcbiAgcmV0dXJuIGAke3BheWxvYWRCNjR9LiR7Ynl0ZXNUb0Jhc2U2NFVybChuZXcgVWludDhBcnJheShzaWcpKX1gXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJpZnlPQXV0aFN0YXRlKFxuICBzdGF0ZTogc3RyaW5nLFxuICBjbGllbnRTZWNyZXQ6IHN0cmluZyxcbiAgbm93TXM6IG51bWJlciA9IERhdGUubm93KCksXG4pOiBQcm9taXNlPEdtYWlsT0F1dGhTdGF0ZVBheWxvYWQ+IHtcbiAgY29uc3QgcGFydHMgPSBzdGF0ZS5zcGxpdCgnLicpXG4gIGlmIChwYXJ0cy5sZW5ndGggIT09IDIgfHwgIXBhcnRzWzBdIHx8ICFwYXJ0c1sxXSkge1xuICAgIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoJ2ludmFsaWQgT0F1dGggc3RhdGUnKVxuICB9XG4gIGNvbnN0IFtwYXlsb2FkQjY0LCBzaWdCNjRdID0gcGFydHNcbiAgY29uc3Qga2V5ID0gYXdhaXQgaG1hY0tleShjbGllbnRTZWNyZXQpXG4gIGNvbnN0IG9rID0gYXdhaXQgY3J5cHRvLnN1YnRsZS52ZXJpZnkoXG4gICAgJ0hNQUMnLFxuICAgIGtleSxcbiAgICBiYXNlNjRVcmxUb0J5dGVzKHNpZ0I2NCkgYXMgQnVmZmVyU291cmNlLFxuICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShwYXlsb2FkQjY0KSxcbiAgKVxuICBpZiAoIW9rKSB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKCdpbnZhbGlkIE9BdXRoIHN0YXRlIHNpZ25hdHVyZScpXG5cbiAgbGV0IGJvZHk6IEdtYWlsT0F1dGhTdGF0ZVBheWxvYWRcbiAgdHJ5IHtcbiAgICBib2R5ID0gSlNPTi5wYXJzZShcbiAgICAgIG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShiYXNlNjRVcmxUb0J5dGVzKHBheWxvYWRCNjQpKSxcbiAgICApIGFzIEdtYWlsT0F1dGhTdGF0ZVBheWxvYWRcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcignaW52YWxpZCBPQXV0aCBzdGF0ZSBwYXlsb2FkJylcbiAgfVxuXG4gIGlmIChcbiAgICB0eXBlb2YgYm9keS51c2VySWQgIT09ICdudW1iZXInIHx8XG4gICAgdHlwZW9mIGJvZHkubWFpbGJveElkICE9PSAnbnVtYmVyJyB8fFxuICAgIHR5cGVvZiBib2R5LnJldHVyblRvICE9PSAnc3RyaW5nJyB8fFxuICAgIHR5cGVvZiBib2R5LmV4cCAhPT0gJ251bWJlcidcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcignaW52YWxpZCBPQXV0aCBzdGF0ZSBmaWVsZHMnKVxuICB9XG4gIGlmIChib2R5LmV4cCA8IE1hdGguZmxvb3Iobm93TXMgLyAxMDAwKSkge1xuICAgIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoJ09BdXRoIHN0YXRlIGV4cGlyZWQnKVxuICB9XG4gIHJldHVybiBib2R5XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEdvb2dsZUF1dGhvcml6ZVVybChvcHRpb25zOiB7XG4gIGNsaWVudElkOiBzdHJpbmdcbiAgcmVkaXJlY3RVcmk6IHN0cmluZ1xuICBzdGF0ZTogc3RyaW5nXG4gIHNjb3BlPzogc3RyaW5nXG59KTogc3RyaW5nIHtcbiAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7XG4gICAgY2xpZW50X2lkOiBvcHRpb25zLmNsaWVudElkLFxuICAgIHJlZGlyZWN0X3VyaTogb3B0aW9ucy5yZWRpcmVjdFVyaSxcbiAgICByZXNwb25zZV90eXBlOiAnY29kZScsXG4gICAgc2NvcGU6IG9wdGlvbnMuc2NvcGUgPz8gR01BSUxfUkVBRE9OTFlfU0NPUEUsXG4gICAgYWNjZXNzX3R5cGU6ICdvZmZsaW5lJyxcbiAgICBwcm9tcHQ6ICdjb25zZW50JyxcbiAgICBpbmNsdWRlX2dyYW50ZWRfc2NvcGVzOiAndHJ1ZScsXG4gICAgc3RhdGU6IG9wdGlvbnMuc3RhdGUsXG4gIH0pXG4gIHJldHVybiBgJHtHT09HTEVfQVVUSE9SSVpFX1VSTH0/JHtwYXJhbXMudG9TdHJpbmcoKX1gXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGNoYW5nZUF1dGhvcml6YXRpb25Db2RlKG9wdGlvbnM6IHtcbiAgY29kZTogc3RyaW5nXG4gIGNsaWVudElkOiBzdHJpbmdcbiAgY2xpZW50U2VjcmV0OiBzdHJpbmdcbiAgcmVkaXJlY3RVcmk6IHN0cmluZ1xuICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2hcbiAgdG9rZW5Vcmw/OiBzdHJpbmdcbn0pOiBQcm9taXNlPEdtYWlsVG9rZW5SZXN1bHQ+IHtcbiAgY29uc3QgZmV0Y2hJbXBsID0gb3B0aW9ucy5mZXRjaEltcGwgPz8gZmV0Y2hcbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2hJbXBsKG9wdGlvbnMudG9rZW5VcmwgPz8gR09PR0xFX1RPS0VOX1VSTCwge1xuICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnIH0sXG4gICAgYm9keTogbmV3IFVSTFNlYXJjaFBhcmFtcyh7XG4gICAgICBjb2RlOiBvcHRpb25zLmNvZGUsXG4gICAgICBjbGllbnRfaWQ6IG9wdGlvbnMuY2xpZW50SWQsXG4gICAgICBjbGllbnRfc2VjcmV0OiBvcHRpb25zLmNsaWVudFNlY3JldCxcbiAgICAgIHJlZGlyZWN0X3VyaTogb3B0aW9ucy5yZWRpcmVjdFVyaSxcbiAgICAgIGdyYW50X3R5cGU6ICdhdXRob3JpemF0aW9uX2NvZGUnLFxuICAgIH0pLFxuICB9KVxuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpLmNhdGNoKCgpID0+ICcnKVxuICAgIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoXG4gICAgICBgdG9rZW4gZXhjaGFuZ2UgZmFpbGVkICgke3Jlcy5zdGF0dXN9KTogJHt0ZXh0LnNsaWNlKDAsIDIwMCl9YCxcbiAgICApXG4gIH1cbiAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCkgYXMge1xuICAgIGFjY2Vzc190b2tlbj86IHN0cmluZ1xuICAgIHJlZnJlc2hfdG9rZW4/OiBzdHJpbmdcbiAgICBleHBpcmVzX2luPzogbnVtYmVyXG4gIH1cbiAgaWYgKCFqc29uLmFjY2Vzc190b2tlbikge1xuICAgIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoJ3Rva2VuIGV4Y2hhbmdlIG1pc3NpbmcgYWNjZXNzX3Rva2VuJylcbiAgfVxuICBjb25zdCBleHBpcmVzQXRNcyA9IHR5cGVvZiBqc29uLmV4cGlyZXNfaW4gPT09ICdudW1iZXInXG4gICAgPyBEYXRlLm5vdygpICsganNvbi5leHBpcmVzX2luICogMTAwMFxuICAgIDogbnVsbFxuICByZXR1cm4ge1xuICAgIGFjY2Vzc1Rva2VuOiBqc29uLmFjY2Vzc190b2tlbixcbiAgICByZWZyZXNoVG9rZW46IGpzb24ucmVmcmVzaF90b2tlbiA/PyBudWxsLFxuICAgIGV4cGlyZXNBdE1zLFxuICB9XG59XG5cbmNvbnN0IEdNQUlMX1BST0ZJTEVfVVJMID1cbiAgJ2h0dHBzOi8vZ21haWwuZ29vZ2xlYXBpcy5jb20vZ21haWwvdjEvdXNlcnMvbWUvcHJvZmlsZSdcblxuLyoqIEJlc3QtZWZmb3J0IEdtYWlsIGFkZHJlc3MgZm9yIG1haWxib3ggbGFiZWw7IG51bGwgd2hlbiB1bmF2YWlsYWJsZS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEdtYWlsRW1haWxBZGRyZXNzKG9wdGlvbnM6IHtcbiAgYWNjZXNzVG9rZW46IHN0cmluZ1xuICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2hcbiAgcHJvZmlsZVVybD86IHN0cmluZ1xufSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICBjb25zdCBmZXRjaEltcGwgPSBvcHRpb25zLmZldGNoSW1wbCA/PyBmZXRjaFxuICB0cnkge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoSW1wbChvcHRpb25zLnByb2ZpbGVVcmwgPz8gR01BSUxfUFJPRklMRV9VUkwsIHtcbiAgICAgIGhlYWRlcnM6IHsgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke29wdGlvbnMuYWNjZXNzVG9rZW59YCB9LFxuICAgIH0pXG4gICAgaWYgKCFyZXMub2spIHJldHVybiBudWxsXG4gICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCkgYXMgeyBlbWFpbEFkZHJlc3M/OiB1bmtub3duIH1cbiAgICBpZiAodHlwZW9mIGpzb24uZW1haWxBZGRyZXNzICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGxcbiAgICBjb25zdCBlbWFpbCA9IGpzb24uZW1haWxBZGRyZXNzLnRyaW0oKVxuICAgIHJldHVybiBlbWFpbC5sZW5ndGggPiAwICYmIGVtYWlsLmxlbmd0aCA8PSAyNTUgPyBlbWFpbCA6IG51bGxcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG4vKiogQXBwZW5kIGdtYWlsPWNvbm5lY3RlZHxlcnJvciBxdWVyeSBwYXJhbXMgdG8gcmV0dXJuVG8uICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRSZXR1cm5SZWRpcmVjdChcbiAgcmV0dXJuVG86IHN0cmluZyxcbiAgcmVzdWx0OiB7IG9rOiB0cnVlIH0gfCB7IG9rOiBmYWxzZTsgZXJyb3I6IHN0cmluZyB9LFxuKTogc3RyaW5nIHtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChyZXR1cm5UbylcbiAgaWYgKHJlc3VsdC5vaykge1xuICAgIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdnbWFpbCcsICdjb25uZWN0ZWQnKVxuICAgIHVybC5zZWFyY2hQYXJhbXMuZGVsZXRlKCdlcnJvcicpXG4gIH0gZWxzZSB7XG4gICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2dtYWlsJywgJ2Vycm9yJylcbiAgICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnZXJyb3InLCByZXN1bHQuZXJyb3Iuc2xpY2UoMCwgMjAwKSlcbiAgfVxuICByZXR1cm4gdXJsLnRvU3RyaW5nKClcbn1cbiIsICJpbXBvcnQgeyBTZXJ2aWNlRXJyb3IgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuXG5jb25zdCBQUk9WSURFUlMgPSBuZXcgU2V0KFsnZml4dHVyZScsICdnbWFpbCddKVxuY29uc3QgQVJUSUZBQ1RfU1RBVFVTRVMgPSBuZXcgU2V0KFsncGVuZGluZycsICdhY2NlcHRlZCcsICdyZWplY3RlZCddKVxuXG4vKipcbiAqIENsaWVudC1mYWNpbmcgdmFsaWRhdGlvbiBmYWlsdXJlLiBFeHRlbmRzIFB5bG9uIFNlcnZpY2VFcnJvciAoR3JhcGhRTEVycm9yKVxuICogc28gR3JhcGhRTCBZb2dhIGRvZXMgbm90IG1hc2sgdGhlIG1lc3NhZ2UgYXMgXCJVbmV4cGVjdGVkIGVycm9yLlwiXG4gKi9cbmV4cG9ydCBjbGFzcyBJbnZhbGlkTWFpbGJveEVycm9yIGV4dGVuZHMgU2VydmljZUVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSwge1xuICAgICAgY29kZTogJ0lOVkFMSURfTUFJTEJPWF9JTlBVVCcsXG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgfSlcbiAgICB0aGlzLm5hbWUgPSAnSW52YWxpZE1haWxib3hFcnJvcidcbiAgfVxufVxuXG5jb25zdCBGUk9NX1BBVFRFUk5fSEVMUCA9XG4gICdBbGxvd2VkIHBhdHRlcm5zOiBzaG9wLmNvbSwgKi5zaG9wLmNvbSwgdXNlckBzaG9wLmNvbSwgKkBzaG9wLmNvbSwgKkAqLnNob3AuY29tJ1xuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVQcm92aWRlcihwcm92aWRlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHByb3ZpZGVyLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGlmICghUFJPVklERVJTLmhhcyh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgYHByb3ZpZGVyIG11c3QgYmUgb25lIG9mOiAke1suLi5QUk9WSURFUlNdLmpvaW4oJywgJyl9YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTGFiZWwobGFiZWw6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBsYWJlbC50cmltKClcbiAgaWYgKCF0cmltbWVkKSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbGFiZWwgaXMgcmVxdWlyZWQnKVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdsYWJlbCBpcyB0b28gbG9uZycpXG4gIHJldHVybiB0cmltbWVkXG59XG5cbi8qKlxuICogQWxsb3dlZCBwYXR0ZXJuczpcbiAqIC0gYHVzZXJAc2hvcC5jb21gLCBgKkBzaG9wLmNvbWAsIGAqQCouc2hvcC5jb21gXG4gKiAtIGBzaG9wLmNvbWAsIGAqLnNob3AuY29tYFxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEb21haW5QYXR0ZXJucyhwYXR0ZXJuczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXVxuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgZm9yIChjb25zdCByYXcgb2YgcGF0dGVybnMpIHtcbiAgICBjb25zdCBwID0gcmF3LnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgaWYgKCFwKSBjb250aW51ZVxuICAgIGlmIChwLmxlbmd0aCA+IDI1NSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2RvbWFpbiBmaWx0ZXIgcGF0dGVybiBpcyB0b28gbG9uZycpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEZyb21QYXR0ZXJuKHApKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihkZXNjcmliZUludmFsaWRGcm9tUGF0dGVybihyYXcsICdkb21haW4gZmlsdGVyJykpXG4gICAgfVxuICAgIGlmIChzZWVuLmhhcyhwKSkgY29udGludWVcbiAgICBzZWVuLmFkZChwKVxuICAgIG91dC5wdXNoKHApXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZEZyb21QYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBwID0gcGF0dGVybi50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIXAgfHwgcC5sZW5ndGggPiAyNTUpIHJldHVybiBmYWxzZVxuXG4gIGlmIChwLmluY2x1ZGVzKCdAJykpIHtcbiAgICBjb25zdCBhdCA9IHAubGFzdEluZGV4T2YoJ0AnKVxuICAgIGlmIChhdCA8PSAwIHx8IGF0ID09PSBwLmxlbmd0aCAtIDEpIHJldHVybiBmYWxzZVxuICAgIGNvbnN0IGxvY2FsID0gcC5zbGljZSgwLCBhdClcbiAgICBjb25zdCBkb21haW4gPSBwLnNsaWNlKGF0ICsgMSlcbiAgICBpZiAobG9jYWwgIT09ICcqJyAmJiAobG9jYWwuaW5jbHVkZXMoJyonKSB8fCBsb2NhbC5pbmNsdWRlcygnQCcpKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIHJldHVybiBpc1ZhbGlkRG9tYWluUGF0dGVybihkb21haW4pXG4gIH1cbiAgcmV0dXJuIGlzVmFsaWREb21haW5QYXR0ZXJuKHApXG59XG5cbmZ1bmN0aW9uIGlzVmFsaWREb21haW5QYXR0ZXJuKGRvbWFpbjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChkb21haW4uc3RhcnRzV2l0aCgnKi4nKSkge1xuICAgIGNvbnN0IHJlc3QgPSBkb21haW4uc2xpY2UoMilcbiAgICBpZiAoIXJlc3QgfHwgcmVzdC5pbmNsdWRlcygnKicpIHx8ICFyZXN0LmluY2x1ZGVzKCcuJykpIHJldHVybiBmYWxzZVxuICAgIHJldHVybiAvXlthLXowLTldKFthLXowLTktXSpbYS16MC05XSk/KFxcLlthLXowLTldKFthLXowLTktXSpbYS16MC05XSk/KSskL1xuICAgICAgLnRlc3QocmVzdClcbiAgfVxuICBpZiAoZG9tYWluLmluY2x1ZGVzKCcqJykpIHJldHVybiBmYWxzZVxuICByZXR1cm4gL15bYS16MC05XShbYS16MC05LV0qW2EtejAtOV0pPyhcXC5bYS16MC05XShbYS16MC05LV0qW2EtejAtOV0pPykrJC9cbiAgICAudGVzdChkb21haW4pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFydGlmYWN0U3RhdHVzKHN0YXR1czogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHN0YXR1cy50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIUFSVElGQUNUX1NUQVRVU0VTLmhhcyh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgYHN0YXR1cyBtdXN0IGJlIG9uZSBvZjogJHtbLi4uQVJUSUZBQ1RfU1RBVFVTRVNdLmpvaW4oJywgJyl9YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVGVtcGxhdGVOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCd0ZW1wbGF0ZSBuYW1lIGlzIHJlcXVpcmVkJylcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3RlbXBsYXRlIG5hbWUgaXMgdG9vIGxvbmcnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgcCA9IHBhdHRlcm4udHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFpc1ZhbGlkRnJvbVBhdHRlcm4ocCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgIGRlc2NyaWJlSW52YWxpZEZyb21QYXR0ZXJuKHBhdHRlcm4sICdtYXRjaEZyb21QYXR0ZXJuJyksXG4gICAgKVxuICB9XG4gIHJldHVybiBwXG59XG5cbi8qKlxuICogRXhwbGFpbnMgd2h5IGEgZnJvbS9kb21haW4gcGF0dGVybiBmYWlsZWQgdmFsaWRhdGlvbiwgd2l0aCBhIGZpeCBoaW50IHdoZW5cbiAqIHRoZSBtaXN0YWtlIGlzIHJlY29nbml6YWJsZSAoZS5nLiBgKmVudmlvLnNob3AuY29tYCBcdTIxOTIgYCouZW52aW8uc2hvcC5jb21gKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlSW52YWxpZEZyb21QYXR0ZXJuKFxuICByYXc6IHN0cmluZyxcbiAgbGFiZWw6IHN0cmluZyxcbik6IHN0cmluZyB7XG4gIGNvbnN0IHAgPSByYXcudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgY29uc3QgcHJlZml4ID0gYGludmFsaWQgJHtsYWJlbH0gXCIke3Jhd31cImBcblxuICBpZiAoIXApIHtcbiAgICByZXR1cm4gYCR7cHJlZml4fTogcGF0dGVybiBpcyBlbXB0eS4gJHtGUk9NX1BBVFRFUk5fSEVMUH1gXG4gIH1cblxuICAvLyBgKmVudmlvLnNhbnRhbmRlci5jb20ubXhgIFx1MjAxNCB3aWxkY2FyZCBtaXNzaW5nIHRoZSBkb3QgKG9yIEApLlxuICBpZiAocC5zdGFydHNXaXRoKCcqJykgJiYgIXAuc3RhcnRzV2l0aCgnKi4nKSAmJiAhcC5zdGFydHNXaXRoKCcqQCcpKSB7XG4gICAgY29uc3QgcmVzdCA9IHAuc2xpY2UoMSlcbiAgICBpZiAocmVzdC5pbmNsdWRlcygnLicpICYmICFyZXN0LmluY2x1ZGVzKCcqJykgJiYgaXNWYWxpZERvbWFpblBhdHRlcm4ocmVzdCkpIHtcbiAgICAgIHJldHVybiAoXG4gICAgICAgIGAke3ByZWZpeH06IHVzZSBcIiouJHtyZXN0fVwiIGZvciBzdWJkb21haW5zIG9mICR7cmVzdH0sIGAgK1xuICAgICAgICBgb3IgXCIke3Jlc3R9XCIgZm9yIHRoYXQgZG9tYWluIGFuZCBpdHMgc3ViZG9tYWlucy4gJHtGUk9NX1BBVFRFUk5fSEVMUH1gXG4gICAgICApXG4gICAgfVxuICAgIHJldHVybiAoXG4gICAgICBgJHtwcmVmaXh9OiB3aWxkY2FyZCBtdXN0IGJlIFwiKi5kb21haW4udGxkXCIgb3IgXCIqQGRvbWFpbi50bGRcIi4gYCArXG4gICAgICBGUk9NX1BBVFRFUk5fSEVMUFxuICAgIClcbiAgfVxuXG4gIC8vIGAqLmNvbWAgLyBgKkAqYCBcdTIwMTQgbmVlZHMgYSBtdWx0aS1wYXJ0IGRvbWFpbi5cbiAgaWYgKFxuICAgIChwLnN0YXJ0c1dpdGgoJyouJykgJiYgIXAuc2xpY2UoMikuaW5jbHVkZXMoJy4nKSkgfHxcbiAgICAocC5pbmNsdWRlcygnQCcpICYmIHAuZW5kc1dpdGgoJ0AqJykpXG4gICkge1xuICAgIHJldHVybiAoXG4gICAgICBgJHtwcmVmaXh9OiB3aWxkY2FyZCBuZWVkcyBhIG11bHRpLXBhcnQgZG9tYWluIGAgK1xuICAgICAgYChlLmcuIFwiKi5zaG9wLmNvbVwiKSwgbm90IGEgYmFyZSBUTEQuICR7RlJPTV9QQVRURVJOX0hFTFB9YFxuICAgIClcbiAgfVxuXG4gIGlmICghcC5pbmNsdWRlcygnLicpICYmICFwLmluY2x1ZGVzKCdAJykpIHtcbiAgICByZXR1cm4gKFxuICAgICAgYCR7cHJlZml4fTogbXVzdCBpbmNsdWRlIGEgZG9tYWluIHdpdGggYSBkb3QgKGUuZy4gXCJzaG9wLmNvbVwiKS4gYCArXG4gICAgICBGUk9NX1BBVFRFUk5fSEVMUFxuICAgIClcbiAgfVxuXG4gIHJldHVybiBgJHtwcmVmaXh9LiAke0ZST01fUEFUVEVSTl9IRUxQfWBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3ViamVjdFJlZ2V4KFxuICByZWdleDogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAocmVnZXggPT09IG51bGwgfHwgcmVnZXggPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGxcbiAgY29uc3QgdHJpbW1lZCA9IHJlZ2V4LnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHJldHVybiBudWxsXG4gIHRyeSB7XG4gICAgbmV3IFJlZ0V4cCh0cmltbWVkLCAnaScpXG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtYXRjaFN1YmplY3RSZWdleCBpcyBub3QgYSB2YWxpZCByZWdleHAnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNhdGVnb3J5SWQoY2F0ZWdvcnlJZDogdW5rbm93bik6IG51bWJlciB7XG4gIGlmIChcbiAgICB0eXBlb2YgY2F0ZWdvcnlJZCAhPT0gJ251bWJlcicgfHxcbiAgICAhTnVtYmVyLmlzSW50ZWdlcihjYXRlZ29yeUlkKSB8fFxuICAgIGNhdGVnb3J5SWQgPCAxXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgJ2NhdGVnb3J5SWQgaXMgcmVxdWlyZWQgd2hlbiBhY2NlcHRpbmcgYSBzcGVuZGluZyBjYW5kaWRhdGUnLFxuICAgIClcbiAgfVxuICByZXR1cm4gY2F0ZWdvcnlJZFxufVxuIiwgImltcG9ydCB7IGNyZWF0ZVJlbW90ZUpXS1NldCwgand0VmVyaWZ5IH0gZnJvbSAnam9zZSdcbmltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5cbmNvbnN0IEFVVEhfQVBJX0RPTUFJTiA9XG4gICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFVVEhfQVBJX0RPTUFJTikgfHxcbiAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMSdcbmNvbnN0IEpXS1NfVVJMID0gYCR7QVVUSF9BUElfRE9NQUlOfS9hdXRoL2p3dC9qd2tzLmpzb25gXG5cbmNvbnN0IGp3a3MgPSBjcmVhdGVSZW1vdGVKV0tTZXQobmV3IFVSTChKV0tTX1VSTCkpXG5cbmV4cG9ydCB0eXBlIFZlcmlmaWVkQXV0aCA9IHtcbiAgYXV0aFVzZXJJZDogc3RyaW5nXG4gIGVtYWlsPzogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJpZnlBY2Nlc3NUb2tlbihcbiAgYXV0aG9yaXphdGlvbkhlYWRlcjogc3RyaW5nIHwgdW5kZWZpbmVkLFxuKTogUHJvbWlzZTxWZXJpZmllZEF1dGggfCBudWxsPiB7XG4gIGlmICghYXV0aG9yaXphdGlvbkhlYWRlcj8uc3RhcnRzV2l0aCgnQmVhcmVyICcpKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGNvbnN0IHRva2VuID0gYXV0aG9yaXphdGlvbkhlYWRlci5zbGljZSgnQmVhcmVyICcubGVuZ3RoKS50cmltKClcbiAgaWYgKCF0b2tlbikge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHsgcGF5bG9hZCB9ID0gYXdhaXQgand0VmVyaWZ5KHRva2VuLCBqd2tzLCB7XG4gICAgICBhbGdvcml0aG1zOiBbJ1JTMjU2J10sXG4gICAgfSlcblxuICAgIGNvbnN0IGF1dGhVc2VySWQgPSB0eXBlb2YgcGF5bG9hZC5zdWIgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5zdWIgOiBudWxsXG4gICAgaWYgKCFhdXRoVXNlcklkKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IGVtYWlsID1cbiAgICAgIHR5cGVvZiBwYXlsb2FkLmVtYWlsID09PSAnc3RyaW5nJyA/IHBheWxvYWQuZW1haWwgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7IGF1dGhVc2VySWQsIGVtYWlsIH1cbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdW5hdXRob3JpemVkUmVzcG9uc2UoKTogUmVzcG9uc2Uge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdVbmF1dGhvcml6ZWQnIH0pLCB7XG4gICAgc3RhdHVzOiA0MDEsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICAgIH0sXG4gIH0pXG59XG5cbi8qKiBDT1JTIHByZWZsaWdodCAvIHNpbXBsZSByZXNwb25zZXMgZm9yIGJyb3dzZXIgR3JhcGhRTCBjbGllbnRzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvcnNNaWRkbGV3YXJlKGN0eDogQ29udGV4dCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikge1xuICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UobnVsbCwge1xuICAgICAgc3RhdHVzOiAyMDQsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG5cbiAgYXdhaXQgbmV4dCgpXG5cbiAgY3R4LnJlcy5oZWFkZXJzLnNldCgnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgJyonKVxuICBjdHgucmVzLmhlYWRlcnMuc2V0KFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJyxcbiAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICApXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnLFxuICAgICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICApXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7XG4gIHVuYXV0aG9yaXplZFJlc3BvbnNlLFxuICB2ZXJpZnlBY2Nlc3NUb2tlbixcbiAgdHlwZSBWZXJpZmllZEF1dGgsXG59IGZyb20gJy4uL2F1dGgvdmVyaWZ5LnRzJ1xuXG4vKiogUHVibGljIEFMQiAvIGxvYWQtYmFsYW5jZXIgaGVhbHRoIGNoZWNrLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhlYWx0aE1pZGRsZXdhcmUoXG4gIGN0eDogQ29udGV4dCxcbiAgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPixcbikge1xuICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcbiAgaWYgKHBhdGggPT09ICcvaGVhbHRoJyAmJiBjdHgucmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IHRydWUgfSksIHtcbiAgICAgIHN0YXR1czogMjAwLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG4gIGF3YWl0IG5leHQoKVxufVxuXG5leHBvcnQgdHlwZSBMb2NhbFVzZXJSZWYgPSB7XG4gIGlkOiBudW1iZXJcbn1cblxuZXhwb3J0IHR5cGUgUmVzb2x2ZUxvY2FsVXNlckZuID0gKFxuICBpZGVudGl0eTogVmVyaWZpZWRBdXRoLFxuKSA9PiBQcm9taXNlPExvY2FsVXNlclJlZj5cblxuLyoqXG4gKiBSZXF1aXJlIGEgdmFsaWQgQmVhcmVyIEpXVCBvbiBgL2dyYXBocWxgIGFuZCBzZXQgUHlsb24gY29udGV4dCB2YXJzOlxuICogYHVzZXJJZGAsIGBhdXRoVXNlcklkYCwgb3B0aW9uYWwgYGF1dGhFbWFpbGAuXG4gKlxuICogQ2FsbGVycyB0aGF0IG5lZWQgYXV0aCBmb3Igb3RoZXIgcGF0aHMgKGUuZy4gUkVTVCBhc3NldHMpIHNob3VsZCBoYW5kbGVcbiAqIHRob3NlIGJlZm9yZSB0aGlzIG1pZGRsZXdhcmUgb3IgdXNlIGB2ZXJpZnlBY2Nlc3NUb2tlbmAgZGlyZWN0bHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUoXG4gIHJlc29sdmVMb2NhbFVzZXI6IFJlc29sdmVMb2NhbFVzZXJGbixcbikge1xuICByZXR1cm4gYXN5bmMgZnVuY3Rpb24gZ3JhcGhRTEF1dGhNaWRkbGV3YXJlKFxuICAgIGN0eDogQ29udGV4dCxcbiAgICBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgICAgYXdhaXQgbmV4dCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcblxuICAgIGlmIChcbiAgICAgIHBhdGggPT09ICcvaGVhbHRoJyB8fFxuICAgICAgKHBhdGggIT09ICcvZ3JhcGhxbCcgJiYgIXBhdGguZW5kc1dpdGgoJy9ncmFwaHFsJykpXG4gICAgKSB7XG4gICAgICBhd2FpdCBuZXh0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgdmVyaWZ5QWNjZXNzVG9rZW4oY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSlcbiAgICBpZiAoIXZlcmlmaWVkKSB7XG4gICAgICByZXR1cm4gdW5hdXRob3JpemVkUmVzcG9uc2UoKVxuICAgIH1cblxuICAgIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIodmVyaWZpZWQpXG5cbiAgICBjdHguc2V0KCdhdXRoVXNlcklkJywgdmVyaWZpZWQuYXV0aFVzZXJJZClcbiAgICBpZiAodmVyaWZpZWQuZW1haWwpIHtcbiAgICAgIGN0eC5zZXQoJ2F1dGhFbWFpbCcsIHZlcmlmaWVkLmVtYWlsKVxuICAgIH1cbiAgICBjdHguc2V0KCd1c2VySWQnLCBsb2NhbFVzZXIuaWQpXG5cbiAgICBhd2FpdCBuZXh0KClcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBLeXNlbHksIFNlbGVjdGFibGUgfSBmcm9tICdreXNlbHknXG5cbi8qKiBNaW5pbWFsIHVzZXJzIHRhYmxlIHNoYXBlIHJlcXVpcmVkIGJ5IHJlc29sdmVMb2NhbFVzZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBVc2Vyc0RhdGFiYXNlID0ge1xuICB1c2VyczogVXNlcnNUYWJsZVxufVxuXG5leHBvcnQgdHlwZSBMb2NhbFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEF1dGhJZGVudGl0eSA9IHtcbiAgYXV0aFVzZXJJZDogc3RyaW5nXG4gIGVtYWlsPzogc3RyaW5nXG4gIG5hbWU/OiBzdHJpbmdcbn1cblxuLyoqXG4gKiBSZXNvbHZlIChvciBjcmVhdGUpIHRoZSBsb2NhbCBgdXNlcnNgIHJvdyBmb3IgYSBTdXBlclRva2VucyBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVMb2NhbFVzZXI8REIgZXh0ZW5kcyBVc2Vyc0RhdGFiYXNlPihcbiAgZGI6IEt5c2VseTxEQj4sXG4gIGlkZW50aXR5OiBBdXRoSWRlbnRpdHksXG4pOiBQcm9taXNlPFNlbGVjdGFibGU8REJbJ3VzZXJzJ10+PiB7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnYXV0aF91c2VyX2lkJywgJz0nLCBpZGVudGl0eS5hdXRoVXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoZXhpc3RpbmcpIHtcbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIGNvbnN0IGVtYWlsID1cbiAgICBpZGVudGl0eS5lbWFpbD8udHJpbSgpIHx8XG4gICAgYCR7aWRlbnRpdHkuYXV0aFVzZXJJZH1AdXNlcnMubG9jYWxgXG4gIGNvbnN0IG5hbWUgPVxuICAgIGlkZW50aXR5Lm5hbWU/LnRyaW0oKSB8fFxuICAgIGVtYWlsLnNwbGl0KCdAJylbMF0gfHxcbiAgICAnVXNlcidcblxuICAvLyBQcmVmZXIgbGlua2luZyBhbiBleGlzdGluZyBlbWFpbCByb3cgKGUuZy4gc2VlZGVkIGRldiB1c2VyKSB3aGVuIHByZXNlbnQuXG4gIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdlbWFpbCcsICc9JywgZW1haWwpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChieUVtYWlsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3VzZXJzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICAgIG5hbWU6IGJ5RW1haWwubmFtZSB8fCBuYW1lLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYnlFbWFpbC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCd1c2VycycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBlbWFpbCxcbiAgICAgIG5hbWUsXG4gICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICBwYXNzd29yZF9oYXNoOiBudWxsLFxuICAgIH0pXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbn1cbiIsICJpbXBvcnQgeyBkYiB9IGZyb20gJy4vZGF0YWJhc2UudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIGFzIHJlc29sdmVMb2NhbFVzZXJLaXQgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvdXNlcnMudHMnXG5pbXBvcnQgdHlwZSB7IEF1dGhJZGVudGl0eSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cydcbmltcG9ydCB0eXBlIHsgVXNlciB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSB7IEF1dGhJZGVudGl0eSB9XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyKGlkZW50aXR5OiBBdXRoSWRlbnRpdHkpOiBQcm9taXNlPFVzZXI+IHtcbiAgcmV0dXJuIHJlc29sdmVMb2NhbFVzZXJLaXQoZGIsIGlkZW50aXR5KVxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5IH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBEYXRhYmFzZSB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIEdtYWlsT0F1dGhFcnJvcixcbiAgYnVpbGRSZXR1cm5SZWRpcmVjdCxcbiAgZXhjaGFuZ2VBdXRob3JpemF0aW9uQ29kZSxcbiAgZmV0Y2hHbWFpbEVtYWlsQWRkcmVzcyxcbiAgaXNSZXR1cm5Ub0FsbG93ZWQsXG4gIGxvYWRHbWFpbE9BdXRoQ29uZmlnLFxuICB2ZXJpZnlPQXV0aFN0YXRlLFxuICB0eXBlIEdtYWlsT0F1dGhDb25maWcsXG59IGZyb20gJy4vZ21haWxfb2F1dGgudHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR21haWxPQXV0aENhbGxiYWNrRGVwcyB7XG4gIGRiOiBLeXNlbHk8RGF0YWJhc2U+XG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaFxuICBub3dNcz86IG51bWJlclxuICBsb2FkQ29uZmlnPzogKCkgPT4gR21haWxPQXV0aENvbmZpZ1xufVxuXG4vKipcbiAqIEhhbmRsZSBHb29nbGUgT0F1dGggcmVkaXJlY3Q6IHZlcmlmeSBzdGF0ZSwgZXhjaGFuZ2UgY29kZSwgcGVyc2lzdCB0b2tlbnMuXG4gKiBSZXR1cm5zIGEgMzAyIExvY2F0aW9uIHRvd2FyZCB0aGUgRmx1dHRlciByZXR1cm5UbyBVUkwuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVHbWFpbE9BdXRoQ2FsbGJhY2soXG4gIHJlcXVlc3RVcmw6IFVSTCxcbiAgZGVwczogR21haWxPQXV0aENhbGxiYWNrRGVwcyxcbik6IFByb21pc2U8UmVzcG9uc2U+IHtcbiAgY29uc3QgY29kZSA9IHJlcXVlc3RVcmwuc2VhcmNoUGFyYW1zLmdldCgnY29kZScpXG4gIGNvbnN0IHN0YXRlID0gcmVxdWVzdFVybC5zZWFyY2hQYXJhbXMuZ2V0KCdzdGF0ZScpXG4gIGNvbnN0IG9hdXRoRXJyb3IgPSByZXF1ZXN0VXJsLnNlYXJjaFBhcmFtcy5nZXQoJ2Vycm9yJylcblxuICBsZXQgY29uZmlnOiBHbWFpbE9BdXRoQ29uZmlnXG4gIHRyeSB7XG4gICAgY29uZmlnID0gKGRlcHMubG9hZENvbmZpZyA/PyBsb2FkR21haWxPQXV0aENvbmZpZykoKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6ICdvYXV0aF9jb25maWdfZXJyb3InXG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShgR21haWwgT0F1dGggbWlzY29uZmlndXJlZDogJHttZXNzYWdlfWAsIHtcbiAgICAgIHN0YXR1czogNTAwLFxuICAgIH0pXG4gIH1cblxuICAvLyBCZXN0LWVmZm9ydCBkZWNvZGUgb2YgcmV0dXJuVG8gZnJvbSBzdGF0ZSBmb3IgZXJyb3IgcmVkaXJlY3RzLlxuICBsZXQgcmV0dXJuVG9GYWxsYmFjazogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgaWYgKHN0YXRlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBhd2FpdCB2ZXJpZnlPQXV0aFN0YXRlKFxuICAgICAgICBzdGF0ZSxcbiAgICAgICAgY29uZmlnLmNsaWVudFNlY3JldCxcbiAgICAgICAgZGVwcy5ub3dNcyxcbiAgICAgIClcbiAgICAgIHJldHVyblRvRmFsbGJhY2sgPSBwYXlsb2FkLnJldHVyblRvXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBpZ25vcmUgXHUyMDE0IGhhbmRsZWQgYmVsb3dcbiAgICB9XG4gIH1cblxuICBjb25zdCByZWRpcmVjdEVycm9yID0gKGVycm9yOiBzdHJpbmcsIHJldHVyblRvOiBzdHJpbmcgfCBudWxsKSA9PiB7XG4gICAgaWYgKHJldHVyblRvICYmIGlzUmV0dXJuVG9BbGxvd2VkKHJldHVyblRvLCBjb25maWcucmV0dXJuVG9BbGxvd2xpc3QpKSB7XG4gICAgICByZXR1cm4gUmVzcG9uc2UucmVkaXJlY3QoXG4gICAgICAgIGJ1aWxkUmV0dXJuUmVkaXJlY3QocmV0dXJuVG8sIHsgb2s6IGZhbHNlLCBlcnJvciB9KSxcbiAgICAgICAgMzAyLFxuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKGBHbWFpbCBPQXV0aCBmYWlsZWQ6ICR7ZXJyb3J9YCwgeyBzdGF0dXM6IDQwMCB9KVxuICB9XG5cbiAgaWYgKG9hdXRoRXJyb3IpIHtcbiAgICByZXR1cm4gcmVkaXJlY3RFcnJvcihvYXV0aEVycm9yLCByZXR1cm5Ub0ZhbGxiYWNrKVxuICB9XG4gIGlmICghY29kZSB8fCAhc3RhdGUpIHtcbiAgICByZXR1cm4gcmVkaXJlY3RFcnJvcignbWlzc2luZ19jb2RlX29yX3N0YXRlJywgcmV0dXJuVG9GYWxsYmFjaylcbiAgfVxuXG4gIGxldCBwYXlsb2FkXG4gIHRyeSB7XG4gICAgcGF5bG9hZCA9IGF3YWl0IHZlcmlmeU9BdXRoU3RhdGUoc3RhdGUsIGNvbmZpZy5jbGllbnRTZWNyZXQsIGRlcHMubm93TXMpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBHbWFpbE9BdXRoRXJyb3JcbiAgICAgID8gZXJyLm1lc3NhZ2VcbiAgICAgIDogJ2ludmFsaWRfc3RhdGUnXG4gICAgcmV0dXJuIHJlZGlyZWN0RXJyb3IobWVzc2FnZSwgcmV0dXJuVG9GYWxsYmFjaylcbiAgfVxuXG4gIGlmICghaXNSZXR1cm5Ub0FsbG93ZWQocGF5bG9hZC5yZXR1cm5UbywgY29uZmlnLnJldHVyblRvQWxsb3dsaXN0KSkge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoJ0dtYWlsIE9BdXRoIGZhaWxlZDogcmV0dXJuVG8gaXMgbm90IGFsbG93ZWQnLCB7XG4gICAgICBzdGF0dXM6IDQwMCxcbiAgICB9KVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB0b2tlbnMgPSBhd2FpdCBleGNoYW5nZUF1dGhvcml6YXRpb25Db2RlKHtcbiAgICAgIGNvZGUsXG4gICAgICBjbGllbnRJZDogY29uZmlnLmNsaWVudElkLFxuICAgICAgY2xpZW50U2VjcmV0OiBjb25maWcuY2xpZW50U2VjcmV0LFxuICAgICAgcmVkaXJlY3RVcmk6IGNvbmZpZy5yZWRpcmVjdFVyaSxcbiAgICAgIGZldGNoSW1wbDogZGVwcy5mZXRjaEltcGwsXG4gICAgfSlcblxuICAgIGNvbnN0IG1haWxib3ggPSBhd2FpdCBkZXBzLmRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWFpbGJveGVzJylcbiAgICAgIC5zZWxlY3QoWydpZCcsICd1c2VyX2lkJywgJ3Byb3ZpZGVyJ10pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBwYXlsb2FkLm1haWxib3hJZClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIGlmICghbWFpbGJveCB8fCBtYWlsYm94LnVzZXJfaWQgIT09IHBheWxvYWQudXNlcklkKSB7XG4gICAgICByZXR1cm4gcmVkaXJlY3RFcnJvcignbWFpbGJveF9ub3RfZm91bmQnLCBwYXlsb2FkLnJldHVyblRvKVxuICAgIH1cbiAgICBpZiAobWFpbGJveC5wcm92aWRlciAhPT0gJ2dtYWlsJykge1xuICAgICAgcmV0dXJuIHJlZGlyZWN0RXJyb3IoJ21haWxib3hfbm90X2dtYWlsJywgcGF5bG9hZC5yZXR1cm5UbylcbiAgICB9XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZShcbiAgICAgIGRlcHMubm93TXMgPz8gRGF0ZS5ub3coKSxcbiAgICApLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCBlbWFpbCA9IGF3YWl0IGZldGNoR21haWxFbWFpbEFkZHJlc3Moe1xuICAgICAgYWNjZXNzVG9rZW46IHRva2Vucy5hY2Nlc3NUb2tlbixcbiAgICAgIGZldGNoSW1wbDogZGVwcy5mZXRjaEltcGwsXG4gICAgfSlcbiAgICBhd2FpdCBkZXBzLmRiXG4gICAgICAudXBkYXRlVGFibGUoJ21haWxib3hlcycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgb2F1dGhfdG9rZW5zX2pzb246IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogdG9rZW5zLmFjY2Vzc1Rva2VuLFxuICAgICAgICAgIHJlZnJlc2hUb2tlbjogdG9rZW5zLnJlZnJlc2hUb2tlbixcbiAgICAgICAgICBleHBpcmVzQXRNczogdG9rZW5zLmV4cGlyZXNBdE1zLFxuICAgICAgICB9KSxcbiAgICAgICAgLi4uKGVtYWlsID8geyBsYWJlbDogZW1haWwgfSA6IHt9KSxcbiAgICAgICAgc3luY19yZXF1ZXN0ZWQ6IHRydWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBtYWlsYm94LmlkKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIFJlc3BvbnNlLnJlZGlyZWN0KFxuICAgICAgYnVpbGRSZXR1cm5SZWRpcmVjdChwYXlsb2FkLnJldHVyblRvLCB7IG9rOiB0cnVlIH0pLFxuICAgICAgMzAyLFxuICAgIClcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGVyciBpbnN0YW5jZW9mIEdtYWlsT0F1dGhFcnJvclxuICAgICAgPyBlcnIubWVzc2FnZVxuICAgICAgOiAndG9rZW5fZXhjaGFuZ2VfZmFpbGVkJ1xuICAgIHJldHVybiByZWRpcmVjdEVycm9yKG1lc3NhZ2UsIHBheWxvYWQucmV0dXJuVG8pXG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxTQUFTLFdBQVc7OztBQ0FwQixTQUFTLGtCQUFrQjs7O0FDOENwQixJQUFNLDBCQUEwQjs7O0FDbUhoQyxTQUFTLDZCQUNkLEtBQ2dDO0FBQ2hDLE1BQUksUUFBUSxRQUFRLE9BQU8sUUFBUSxZQUFZLE1BQU0sUUFBUSxHQUFHLEVBQUcsUUFBTztBQUMxRSxRQUFNLE1BQU07QUFDWixRQUFNLFNBQVMsb0JBQW9CLElBQUksTUFBTTtBQUM3QyxNQUFJLENBQUMsT0FBUSxRQUFPO0FBQ3BCLFNBQU87QUFBQSxJQUNMO0FBQUEs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QUFLLFVBQVU7QUFBQSxRQUNoQyxhQUFhLE9BQU87QUFBQSxRQUNwQixjQUFjLE9BQU87QUFBQSxRQUNyQixhQUFhLE9BQU87QUFBQSxNQUN0QixDQUFDO0FBQUEsTUFDRCxHQUFJLFFBQVEsRUFBRSxPQUFPLE1BQU0sSUFBSSxDQUFDO0FBQUEsTUFDaEMsZ0JBQWdCO0FBQUEsTUFDaEIsWUFBWTtBQUFBLElBQ2QsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLFFBQVEsRUFBRSxFQUMzQixRQUFRO0FBRVgsV0FBTyxTQUFTO0FBQUEsTUFDZCxvQkFBb0IsUUFBUSxVQUFVLEVBQUUsSUFBSSxLQUFLLENBQUM7QUFBQSxNQUNsRDtBQUFBLElBQ0Y7QUFBQSxFQUNGLFNBQVMsS0FBSztBQUNaLFVBQU0sVUFBVSxlQUFlLGtCQUMzQixJQUFJLFVBQ0o7QUFDSixXQUFPLGNBQWMsU0FBUyxRQUFRLFFBQVE7QUFBQSxFQUNoRDtBQUNGOzs7QW5CM0dNLFNBQVEsV0FBVyw4QkFBNkI7QUExQnRELElBQUksSUFBSSxjQUFjO0FBQ3RCLElBQUksSUFBSSxnQkFBZ0I7QUFHeEIsSUFBSSxJQUFJLE9BQU8sS0FBSyxTQUFTO0FBQzNCLE1BQUksSUFBSSxJQUFJLFdBQVcsV0FBVztBQUNoQyxVQUFNLEtBQUs7QUFDWDtBQUFBLEVBQ0Y7QUFFQSxRQUFNLE1BQU0sSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHO0FBQy9CLE1BQUksSUFBSSxhQUFhLDJCQUEyQixJQUFJLElBQUksV0FBVyxPQUFPO0FBQ3hFLFdBQU8seUJBQXlCLEtBQUssRUFBRSxHQUFHLENBQUM7QUFBQSxFQUM3QztBQUVBLFFBQU0sS0FBSztBQUNiLENBQUM7QUFFRCxJQUFJLElBQUksNEJBQTRCRSxpQkFBZ0IsQ0FBQztBQUU5QyxJQUFNLFVBQVU7QUFBQSxFQUNyQixHQUFHO0FBQ0w7QUFFQSxJQUFPLGNBQVE7QUFJVCxJQUFJLHdCQUF3QjtBQUU1QixJQUFJO0FBQ0YsMEJBQXdCO0FBQzFCLFFBQVE7QUFFUjtBQUVBLElBQUksSUFBSSx1QkFBdUI7QUFBQSxFQUM3QixVQUFVO0FBQUEsRUFDVjtBQUFBLEVBQ0EsV0FBVyxDQUFDO0FBQUEsRUFDWixRQUFRO0FBQ1YsQ0FBQyxDQUFDOyIsCiAgIm5hbWVzIjogWyJkYiIsICJlbnYiLCAicm93IiwgImNvbmZpZyIsICJyZXNvbHZlTG9jYWxVc2VyIiwgImRiIiwgInJlc29sdmVMb2NhbFVzZXIiLCAiY29uZmlnIiwgInBheWxvYWQiLCAicmVzb2x2ZUxvY2FsVXNlciJdCn0K
