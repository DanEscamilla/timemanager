// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import { getContext } from "@getcronit/pylon";

// ../../libs/mailbox_kit/types.ts
var SPENDING_CANDIDATE_KIND = "spending.candidate";

// ../../libs/mailbox_kit/domain_filter.ts
function matchesFromPattern(fromAddress, pattern) {
  const normalizedFrom = normalizeFrom(fromAddress);
  if (!normalizedFrom) return false;
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  return matchesSinglePattern(normalizedFrom, p);
}
function normalizeFrom(from) {
  const trimmed = from.trim();
  const angle = trimmed.match(/<([^>]+)>/);
  const email = (angle?.[1] ?? trimmed).trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain.includes(".")) return null;
  return { email, local, domain };
}
function matchesSinglePattern(from, pattern) {
  if (pattern.includes("@")) {
    return matchesAddressPattern(from, pattern);
  }
  return matchesDomainPattern(from.domain, pattern);
}
function matchesAddressPattern(from, pattern) {
  const at = pattern.lastIndexOf("@");
  if (at <= 0 || at === pattern.length - 1) return false;
  const localPat = pattern.slice(0, at);
  const domainPat = pattern.slice(at + 1);
  if (localPat !== "*" && localPat !== from.local) return false;
  if (domainPat.startsWith("*.")) {
    return matchesDomainPattern(from.domain, domainPat);
  }
  return from.domain === domainPat;
}
function matchesDomainPattern(domain, pattern) {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    if (!suffix.includes(".")) return false;
    return domain.endsWith(`.${suffix}`);
  }
  return domain === pattern || domain.endsWith(`.${pattern}`);
}

// ../../libs/mailbox_kit/template_match.ts
function messageMatchesTemplate(message, template) {
  if (template.enabled === false) return false;
  if (!matchesFromPattern(message.from, template.matchFromPattern)) {
    return false;
  }
  const subjectRe = template.matchSubjectRegex?.trim();
  if (subjectRe) {
    try {
      if (!new RegExp(subjectRe, "i").test(message.subject)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
function messageMatchesAnyTemplate(message, templates) {
  return templates.some((t) => messageMatchesTemplate(message, t));
}

// ../../libs/mailbox_kit/extractor.ts
var ExtractorPipeline = class {
  constructor(extractors, options) {
    this.extractors = extractors;
    this.firstMatchOnly = options?.firstMatchOnly ?? false;
  }
  firstMatchOnly;
  run(message) {
    const out = [];
    for (const extractor of this.extractors) {
      if (!extractor.canHandle(message)) continue;
      const arts = extractor.extract(message);
      if (arts.length === 0) continue;
      out.push(...arts);
      if (this.firstMatchOnly) return out;
    }
    return out;
  }
};

// ../../libs/mailbox_kit/html_to_plain_text.ts
function htmlToPlainText(html) {
  if (!html) return "";
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|h[1-6]|li|blockquote)\s*>/gi, "\n");
  s = s.replace(/<\/td\s*>/gi, " ");
  s = s.replace(/<\/th\s*>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeHtmlEntities(s);
  s = s.split("\n").map((line) => line.replace(/[ \t\f\v]+/g, " ").trim()).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
function looksLikeHtml(value) {
  return /^\s*(<!DOCTYPE\b|<html\b|<head\b|<body\b|<div\b|<table\b|<p\b|<br\b|<span\b)/i.test(value);
}
function resolveTextBody(textBody, htmlBody) {
  const text = textBody?.trim();
  if (text && !looksLikeHtml(text)) return text;
  const fromHtml = htmlToPlainText(htmlBody);
  if (fromHtml) return fromHtml;
  if (text) {
    const stripped = htmlToPlainText(text);
    if (stripped) return stripped;
  }
  return null;
}
var NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Common Latin accents in MX / ES bank emails
  aacute: "\xE1",
  eacute: "\xE9",
  iacute: "\xED",
  oacute: "\xF3",
  uacute: "\xFA",
  ntilde: "\xF1",
  Aacute: "\xC1",
  Eacute: "\xC9",
  Iacute: "\xCD",
  Oacute: "\xD3",
  Uacute: "\xDA",
  Ntilde: "\xD1",
  uuml: "\xFC",
  Uuml: "\xDC",
  iexcl: "\xA1",
  iquest: "\xBF",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  laquo: "\xAB",
  raquo: "\xBB"
};
function decodeHtmlEntities(s) {
  return s.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const hex = entity[1] === "x" || entity[1] === "X";
        const code = hex ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
        if (Number.isFinite(code) && code >= 0) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return match;
          }
        }
        return match;
      }
      return NAMED_ENTITIES[entity] ?? match;
    }
  );
}

// ../../libs/mailbox_kit/extractors/template_spending_extractor.ts
var TemplateSpendingExtractor = class {
  constructor(template) {
    this.template = template;
  }
  kind = SPENDING_CANDIDATE_KIND;
  get templateId() {
    return this.template.id;
  }
  canHandle(message) {
    return messageMatchesTemplate(message, this.template);
  }
  extract(message) {
    const sources = buildSources(message);
    if (this.template.extractors.direction) {
      const flow = classifyDirection(
        this.template.extractors.direction,
        sources
      );
      if (flow === "inbound") return [];
    }
    const amountRaw = applyField(this.template.extractors.amount, sources);
    const amountCents = parseMoneyToCents(amountRaw);
    if (amountCents === null) return [];
    const currencyRaw = this.template.extractors.currency ? applyField(this.template.extractors.currency, sources) : null;
    const currency = normalizeCurrency(currencyRaw) ?? "USD";
    const spentOn = resolveSpentOn(this.template.extractors.spentOn, sources) ?? toDateString(message.receivedAt);
    const merchant = this.template.extractors.merchant ? applyField(this.template.extractors.merchant, sources) : null;
    const note = this.template.extractors.note ? applyField(this.template.extractors.note, sources) : message.subject.slice(0, 200) || null;
    const payload = {
      amountCents,
      currency,
      spentOn,
      merchant: merchant?.trim() ? merchant.trim().slice(0, 120) : null,
      note: note?.trim() ? note.trim().slice(0, 200) : null,
      sourceSubject: message.subject,
      sourceFrom: message.from,
      templateId: this.template.id
    };
    return [
      {
        kind: SPENDING_CANDIDATE_KIND,
        payload: { ...payload },
        confidence: 0.9
      }
    ];
  }
};
function buildSources(message) {
  const from = normalizeFrom(message.from);
  const text = resolveTextBody(message.textBody, message.htmlBody) ?? "";
  const fromHtml = htmlToPlainText(message.htmlBody);
  return {
    subject: message.subject ?? "",
    text,
    // Prefer extracted HTML; fall back to stored plain text (post-migration).
    html_text: fromHtml || text,
    from_domain: from?.domain ?? null
  };
}
function applyField(extractor, sources) {
  if (extractor.source === "constant") {
    return extractor.value;
  }
  if (extractor.source === "from_domain") {
    if (!sources.from_domain) return null;
    const base = sources.from_domain.split(".")[0];
    if (!base) return null;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  const haystack = sources[extractor.source];
  try {
    const re = new RegExp(extractor.regex, "i");
    const m = haystack.match(re);
    const group = extractor.group;
    if (!m || group < 0 || group >= m.length) return null;
    const value = m[group];
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}
function resolveSpentOn(extractor, sources) {
  if (!extractor) return null;
  if (isDatePartsExtractor(extractor)) {
    return composeDateParts(extractor, sources);
  }
  const spentOnRaw = applyField(extractor, sources);
  return normalizeDate(spentOnRaw);
}
function composeDateParts(extractor, sources) {
  const haystack = sources[extractor.source];
  try {
    const re = new RegExp(extractor.regex, "i");
    const m = haystack.match(re);
    if (!m) return null;
    const year = Number(m[extractor.yearGroup]);
    const month = Number(m[extractor.monthGroup]);
    const day = Number(m[extractor.dayGroup]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }
    if (year < 2e3 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    const composed = `${year}-${pad2(month)}-${pad2(day)}`;
    const check = /* @__PURE__ */ new Date(`${composed}T00:00:00.000Z`);
    if (Number.isNaN(check.getTime()) || check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
      return null;
    }
    return composed;
  } catch {
    return null;
  }
}
function classifyDirection(extractor, sources) {
  const haystack = sources[extractor.source];
  try {
    const re = new RegExp(extractor.regex, "i");
    const m = haystack.match(re);
    const group = extractor.group;
    if (!m || group < 0 || group >= m.length) return "unknown";
    const raw = m[group]?.trim();
    if (!raw) return "unknown";
    const normalized = foldKey(raw);
    if (extractor.inboundMatches.some((k) => foldKey(k) === normalized)) {
      return "inbound";
    }
    if (extractor.outboundMatches.some((k) => foldKey(k) === normalized)) {
      return "outbound";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
function foldKey(s) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
function parseMoneyToCents(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}
function normalizeCurrency(raw) {
  if (!raw) return null;
  const m = raw.toUpperCase().match(/\b(USD|EUR|GBP|MXN|CAD)\b/);
  return m?.[1] ?? null;
}
function normalizeDate(raw) {
  if (!raw) return null;
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) return iso[1];
  return null;
}
function toDateString(d) {
  return d.toISOString().slice(0, 10);
}
function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}
function isDatePartsExtractor(raw) {
  return "yearGroup" in raw && "monthGroup" in raw && "dayGroup" in raw && typeof raw.yearGroup === "number";
}
function parseSpendTemplateExtractors(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  const amount = parseFieldExtractor(obj.amount);
  if (!amount) return null;
  const spentOn = parseSpentOnExtractor(obj.spentOn);
  if (obj.spentOn !== void 0 && obj.spentOn !== null && spentOn === null) {
    return null;
  }
  const direction = parseDirectionExtractor(obj.direction);
  if (obj.direction !== void 0 && obj.direction !== null && direction === null) {
    return null;
  }
  return {
    amount,
    currency: parseOptionalField(obj.currency),
    spentOn,
    merchant: parseOptionalField(obj.merchant),
    note: parseOptionalField(obj.note),
    direction
  };
}
function parseOptionalField(raw) {
  if (raw === void 0 || raw === null) return null;
  return parseFieldExtractor(raw);
}
function parseSpentOnExtractor(raw) {
  if (raw === void 0 || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  if (typeof obj.yearGroup === "number" || typeof obj.monthGroup === "number" || typeof obj.dayGroup === "number") {
    return parseDatePartsExtractor(obj);
  }
  return parseFieldExtractor(raw);
}
function parseDatePartsExtractor(obj) {
  const source = obj.source;
  if (source !== "subject" && source !== "text" && source !== "html_text") {
    return null;
  }
  if (typeof obj.regex !== "string" || !obj.regex) return null;
  if (!isNonNegInt(obj.yearGroup)) return null;
  if (!isNonNegInt(obj.monthGroup)) return null;
  if (!isNonNegInt(obj.dayGroup)) return null;
  try {
    new RegExp(obj.regex, "i");
  } catch {
    return null;
  }
  return {
    source,
    regex: obj.regex,
    yearGroup: obj.yearGroup,
    monthGroup: obj.monthGroup,
    dayGroup: obj.dayGroup
  };
}
function parseDirectionExtractor(raw) {
  if (raw === void 0 || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  const source = obj.source;
  if (source !== "subject" && source !== "text" && source !== "html_text") {
    return null;
  }
  if (typeof obj.regex !== "string" || !obj.regex) return null;
  if (!isNonNegInt(obj.group)) return null;
  const inbound = parseStringList(obj.inboundMatches);
  const outbound = parseStringList(obj.outboundMatches);
  if (!inbound || !outbound) return null;
  if (inbound.length === 0 && outbound.length === 0) return null;
  try {
    new RegExp(obj.regex, "i");
  } catch {
    return null;
  }
  return {
    source,
    regex: obj.regex,
    group: obj.group,
    inboundMatches: inbound,
    outboundMatches: outbound
  };
}
function parseStringList(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
function isNonNegInt(raw) {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0;
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

// ../../libs/mailbox_kit/template_extract.ts
function extractSpendingCandidates(message, options) {
  if (messageMatchesAnyTemplate(message, options.rejectTemplates)) {
    return [];
  }
  if (options.approveTemplates.length === 0) return [];
  const pipeline = new ExtractorPipeline(
    options.approveTemplates.map((t) => new TemplateSpendingExtractor(t)),
    { firstMatchOnly: true }
  );
  return pipeline.run(message);
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
async function runAiUseCase(useCaseId, input, options) {
  const baseUrl = (options?.baseUrl ?? env("AI_API_BASE_URL") ?? "http://localhost:3004").replace(/\/$/, "");
  const serviceKey = options?.serviceKey ?? env("AI_SERVICE_KEY");
  if (!serviceKey) {
    throw new AiClientError("AI_SERVICE_KEY is not configured");
  }
  const fetchImpl = options?.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `${baseUrl}/v1/use-cases/${useCaseId}/run`,
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
async function generateEmailSpendTemplate(input, options) {
  return await runAiUseCase(
    "generate_email_spend_template",
    input,
    options
  );
}
async function generateEmailRejectTemplate(input, options) {
  return await runAiUseCase(
    "generate_email_reject_template",
    input,
    options
  );
}

// src/services/apply_templates.ts
function createKyselyApplyTemplatesStore(db2) {
  return {
    async listEnabledTemplates(mailboxId) {
      return await db2.selectFrom("parsing_templates").select([
        "id",
        "kind",
        "enabled",
        "match_from_pattern",
        "match_subject_regex",
        "extractors"
      ]).where("mailbox_id", "=", mailboxId).where("enabled", "=", true).orderBy("id", "asc").execute();
    },
    async listMessages(mailboxId) {
      return await db2.selectFrom("messages").select([
        "id",
        "provider_message_id",
        "rfc_message_id",
        "from_address",
        "subject",
        "received_at",
        "text_body",
        "html_body"
      ]).where("mailbox_id", "=", mailboxId).execute();
    },
    async listArtifactStatuses(messageIds) {
      if (messageIds.length === 0) return [];
      return await db2.selectFrom("extraction_artifacts").select(["message_id", "status"]).where("message_id", "in", messageIds).where("kind", "=", SPENDING_CANDIDATE_KIND).execute();
    },
    async rejectPendingForMessages(messageIds, updatedAt) {
      if (messageIds.length === 0) return 0;
      const result = await db2.updateTable("extraction_artifacts").set({ status: "rejected", updated_at: updatedAt }).where("status", "=", "pending").where("kind", "=", SPENDING_CANDIDATE_KIND).where("message_id", "in", messageIds).executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0);
    },
    async insertArtifact(messageId, art, now) {
      await db2.insertInto("extraction_artifacts").values({
        message_id: messageId,
        kind: art.kind,
        payload: art.payload,
        confidence: art.confidence,
        status: "pending",
        published_expense_id: null,
        created_at: now,
        updated_at: now
      }).execute();
    }
  };
}
async function applyTemplatesToMailbox(store, mailboxId, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const rows = await store.listEnabledTemplates(mailboxId);
  const rejectTemplates = [];
  const approveTemplates = [];
  for (const row of rows) {
    const match = {
      matchFromPattern: row.match_from_pattern,
      matchSubjectRegex: row.match_subject_regex,
      enabled: row.enabled
    };
    if (row.kind === "reject") {
      rejectTemplates.push(match);
      continue;
    }
    const extractors = parseSpendTemplateExtractors(row.extractors);
    if (!extractors) continue;
    approveTemplates.push({
      id: row.id,
      matchFromPattern: row.match_from_pattern,
      matchSubjectRegex: row.match_subject_regex,
      extractors,
      enabled: row.enabled
    });
  }
  const messages = await store.listMessages(mailboxId);
  if (messages.length === 0) {
    return { rejectedPending: 0, insertedArtifacts: 0 };
  }
  const statuses = await store.listArtifactStatuses(messages.map((m) => m.id));
  const statusByMessage = /* @__PURE__ */ new Map();
  for (const s of statuses) {
    let set = statusByMessage.get(s.message_id);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      statusByMessage.set(s.message_id, set);
    }
    set.add(s.status);
  }
  const rejectMessageIds = [];
  let insertedArtifacts = 0;
  for (const row of messages) {
    const email = rowToEmailMessage(row);
    if (messageMatchesAnyTemplate(email, rejectTemplates)) {
      rejectMessageIds.push(row.id);
      continue;
    }
    const existing = statusByMessage.get(row.id);
    if (existing?.has("pending") || existing?.has("accepted")) continue;
    const arts = extractSpendingCandidates(email, {
      rejectTemplates: [],
      approveTemplates
    });
    for (const art of arts) {
      await store.insertArtifact(row.id, art, now);
      insertedArtifacts += 1;
    }
  }
  const rejectedPending = await store.rejectPendingForMessages(
    rejectMessageIds,
    now
  );
  return { rejectedPending, insertedArtifacts };
}
function rowToEmailMessage(row) {
  const receivedAt = row.received_at instanceof Date ? row.received_at : new Date(row.received_at);
  const textBody = resolveTextBody(row.text_body, row.html_body);
  return {
    id: row.provider_message_id,
    rfcMessageId: row.rfc_message_id,
    from: row.from_address,
    subject: row.subject,
    receivedAt,
    textBody,
    htmlBody: row.html_body
  };
}

// src/services/inbox_ops.ts
function createKyselyInboxOpsStore(db2) {
  return {
    async deleteMessages(mailboxId) {
      const result = await db2.deleteFrom("messages").where("mailbox_id", "=", mailboxId).executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    },
    async deleteSyncRuns(mailboxId) {
      const result = await db2.deleteFrom("sync_runs").where("mailbox_id", "=", mailboxId).executeTakeFirst();
      return Number(result.numDeletedRows ?? 0);
    },
    async resetMailboxSyncState(mailboxId, updatedAt) {
      return await db2.updateTable("mailboxes").set({
        sync_cursor: null,
        sync_backfill_cursor: null,
        sync_since: null,
        sync_until: null,
        sync_requested: false,
        last_synced_at: null,
        updated_at: updatedAt
      }).where("id", "=", mailboxId).returningAll().executeTakeFirstOrThrow();
    },
    async rejectPendingArtifacts(mailboxId, updatedAt) {
      const result = await db2.updateTable("extraction_artifacts").set({ status: "rejected", updated_at: updatedAt }).where("status", "=", "pending").where(
        "message_id",
        "in",
        db2.selectFrom("messages").select("id").where("mailbox_id", "=", mailboxId)
      ).executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0);
    }
  };
}
async function clearInboxData(store, mailboxId, now = (/* @__PURE__ */ new Date()).toISOString()) {
  await store.deleteMessages(mailboxId);
  await store.deleteSyncRuns(mailboxId);
  return await store.resetMailboxSyncState(mailboxId, now);
}
async function rejectAllPendingArtifacts(store, mailboxId, now = (/* @__PURE__ */ new Date()).toISOString()) {
  return await store.rejectPendingArtifacts(mailboxId, now);
}

// src/services/template_reevaluate.ts
function createKyselyTemplateReevaluateStore(db2) {
  return {
    async listPendingArtifacts(mailboxId) {
      return await db2.selectFrom("extraction_artifacts").innerJoin(
        "messages",
        "messages.id",
        "extraction_artifacts.message_id"
      ).select([
        "extraction_artifacts.id as artifact_id",
        "messages.id as message_id",
        "messages.provider_message_id",
        "messages.rfc_message_id",
        "messages.from_address",
        "messages.subject",
        "messages.received_at",
        "messages.text_body",
        "messages.html_body"
      ]).where("messages.mailbox_id", "=", mailboxId).where("extraction_artifacts.status", "=", "pending").where("extraction_artifacts.kind", "=", SPENDING_CANDIDATE_KIND).execute();
    },
    async updateArtifact(artifactId, payload, confidence, updatedAt) {
      await db2.updateTable("extraction_artifacts").set({
        payload,
        confidence,
        updated_at: updatedAt
      }).where("id", "=", artifactId).execute();
    }
  };
}
async function reevaluatePendingWithTemplate(store, template, now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (template.kind !== "approve" || !template.enabled) return 0;
  const spendTemplate = toSpendParsingTemplate(template);
  if (!spendTemplate) return 0;
  const extractor = new TemplateSpendingExtractor(spendTemplate);
  const pending = await store.listPendingArtifacts(template.mailbox_id);
  let updated = 0;
  for (const row of pending) {
    const email = rowToEmailMessage2(row);
    if (!extractor.canHandle(email)) continue;
    const arts = extractor.extract(email);
    const art = arts[0];
    if (!art) continue;
    await store.updateArtifact(
      row.artifact_id,
      art.payload,
      art.confidence,
      now
    );
    updated += 1;
  }
  return updated;
}
function toSpendParsingTemplate(template) {
  const extractors = parseSpendTemplateExtractors(template.extractors);
  if (!extractors) return null;
  return {
    id: template.id,
    matchFromPattern: template.match_from_pattern,
    matchSubjectRegex: template.match_subject_regex,
    extractors,
    enabled: template.enabled
  };
}
function rowToEmailMessage2(row) {
  const receivedAt = row.received_at instanceof Date ? row.received_at : new Date(row.received_at);
  return {
    id: row.provider_message_id,
    rfcMessageId: row.rfc_message_id,
    from: row.from_address,
    subject: row.subject,
    receivedAt,
    textBody: resolveTextBody(row.text_body, row.html_body),
    htmlBody: row.html_body
  };
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

// src/services/sync_progress.ts
function computeSyncProgressPercent(input) {
  if (!input.active) return null;
  const now = input.now ?? /* @__PURE__ */ new Date();
  const windowEnd = input.syncUntil ?? (input.syncSince != null ? now : null);
  let windowStart = input.syncSince;
  if (windowStart == null && input.syncUntil != null) {
    windowStart = input.oldestSyncedAt;
  }
  if (windowStart == null || windowEnd == null) return null;
  const spanMs = windowEnd.getTime() - windowStart.getTime();
  if (spanMs <= 0) return 100;
  const frontier = input.oldestSyncedAt ?? windowEnd;
  const progressedMs = windowEnd.getTime() - frontier.getTime();
  const raw = progressedMs / spanMs * 100;
  return Math.max(0, Math.min(100, raw));
}

// src/graphql/validation.ts
import { ServiceError } from "@getcronit/pylon";
var PROVIDERS = /* @__PURE__ */ new Set(["fixture", "gmail"]);
var ARTIFACT_STATUSES = /* @__PURE__ */ new Set(["pending", "accepted", "rejected"]);
var TEMPLATE_KINDS = /* @__PURE__ */ new Set(["approve", "reject"]);
var InvalidMailboxError = class extends ServiceError {
  constructor(message) {
    super(message, {
      code: "INVALID_MAILBOX_INPUT",
      statusCode: 400
    });
    this.name = "InvalidMailboxError";
  }
};
var DOMAIN_FILTER_HELP = "Allowed patterns: shop.com, user@shop.com (wildcards are not allowed)";
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
    if (!isValidDomainFilterPattern(p)) {
      throw new InvalidMailboxError(
        describeInvalidDomainFilter(raw)
      );
    }
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  if (out.length === 0) {
    throw new InvalidMailboxError("domain filters are required");
  }
  return out;
}
function isValidDomainFilterPattern(pattern) {
  if (pattern.includes("*")) return false;
  if (pattern.includes("@")) {
    const at = pattern.lastIndexOf("@");
    if (at <= 0 || at === pattern.length - 1) return false;
    const local = pattern.slice(0, at);
    const domain = pattern.slice(at + 1);
    if (!local || local.includes("@")) return false;
    return isValidLiteralDomain(domain);
  }
  return isValidLiteralDomain(pattern);
}
function isValidLiteralDomain(domain) {
  if (domain.includes("*")) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain);
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
    return isValidLiteralDomain(rest);
  }
  if (domain.includes("*")) return false;
  return isValidLiteralDomain(domain);
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
function validateTemplateKind(kind) {
  const trimmed = kind.trim().toLowerCase();
  if (!TEMPLATE_KINDS.has(trimmed)) {
    throw new InvalidMailboxError(
      `kind must be one of: ${[...TEMPLATE_KINDS].join(", ")}`
    );
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
function describeInvalidDomainFilter(raw) {
  const p = raw.trim().toLowerCase();
  const prefix = `invalid domain filter "${raw}"`;
  if (!p) {
    return `${prefix}: pattern is empty. ${DOMAIN_FILTER_HELP}`;
  }
  if (p.includes("*")) {
    let candidate = p.replaceAll("*", "").replace(/^@/, "").replace(/^\./, "");
    if (candidate.includes("@")) {
      candidate = candidate.slice(candidate.lastIndexOf("@") + 1);
    }
    if (isValidLiteralDomain(candidate)) {
      return `${prefix}: wildcards are not allowed; use "${candidate}" for that domain and its subdomains. ${DOMAIN_FILTER_HELP}`;
    }
    return `${prefix}: wildcards are not allowed. ${DOMAIN_FILTER_HELP}`;
  }
  if (!p.includes(".") && !p.includes("@")) {
    return `${prefix}: must include a domain with a dot (e.g. "shop.com"). ` + DOMAIN_FILTER_HELP;
  }
  return `${prefix}. ${DOMAIN_FILTER_HELP}`;
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
function validateOptionalSyncDate(value, field) {
  if (value === null || value === void 0) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new InvalidMailboxError(`${field} must be a valid ISO date`);
  }
  return new Date(ms).toISOString();
}
function validateSyncDateRange(since, until) {
  if (since && until && Date.parse(since) > Date.parse(until)) {
    throw new InvalidMailboxError("since must be less than or equal to until");
  }
  return { since, until };
}
function clampArtifactPage(page, pageSize) {
  const p = typeof page === "number" && Number.isFinite(page) ? page : 1;
  const size = typeof pageSize === "number" && Number.isFinite(pageSize) ? pageSize : 20;
  const safePage = Math.max(1, Math.floor(p));
  const safeSize = Math.min(100, Math.max(1, Math.floor(size)));
  return {
    page: safePage,
    pageSize: safeSize,
    offset: (safePage - 1) * safeSize
  };
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
function toDateOrNull(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
    sync_since: asIsoTimestampOrNull(row.sync_since ?? null),
    sync_until: asIsoTimestampOrNull(row.sync_until ?? null),
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
  let extractors = null;
  if (row.extractors != null) {
    extractors = typeof row.extractors === "string" ? row.extractors : JSON.stringify(row.extractors);
  }
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    user_id: row.user_id,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled,
    match_from_pattern: row.match_from_pattern,
    match_subject_regex: row.match_subject_regex,
    extractors,
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
  async messages(mailboxId, excludeMatchingTemplates) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const rows = await db.selectFrom("messages").selectAll().where("mailbox_id", "=", mailboxId).orderBy("received_at", "desc").execute();
    const mapped = rows.map(mapMessage);
    if (!excludeMatchingTemplates) return mapped;
    const templates = await db.selectFrom("parsing_templates").select(["match_from_pattern", "match_subject_regex", "enabled"]).where("mailbox_id", "=", mailboxId).where("enabled", "=", true).execute();
    const specs = templates.map((t) => ({
      matchFromPattern: t.match_from_pattern,
      matchSubjectRegex: t.match_subject_regex,
      enabled: t.enabled
    }));
    return mapped.filter(
      (m) => !messageMatchesAnyTemplate(
        { from: m.from_address, subject: m.subject },
        specs
      )
    );
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
  async extractionArtifacts(mailboxId, status, page, pageSize) {
    const userId = requireUserId();
    const { page: safePage, pageSize: safeSize, offset } = clampArtifactPage(
      page,
      pageSize
    );
    const statusFilter = status != null && status !== "" ? validateArtifactStatus(status) : null;
    let countQ = db.selectFrom("extraction_artifacts").innerJoin("messages", "messages.id", "extraction_artifacts.message_id").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").select((eb) => eb.fn.countAll().as("count")).where("mailboxes.user_id", "=", userId);
    if (mailboxId != null) {
      countQ = countQ.where("messages.mailbox_id", "=", mailboxId);
    }
    if (statusFilter != null) {
      countQ = countQ.where("extraction_artifacts.status", "=", statusFilter);
    }
    const countRow = await countQ.executeTakeFirstOrThrow();
    const totalCount = Number(countRow.count);
    let listQ = db.selectFrom("extraction_artifacts").innerJoin("messages", "messages.id", "extraction_artifacts.message_id").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").selectAll("extraction_artifacts").where("mailboxes.user_id", "=", userId);
    if (mailboxId != null) {
      listQ = listQ.where("messages.mailbox_id", "=", mailboxId);
    }
    if (statusFilter != null) {
      listQ = listQ.where("extraction_artifacts.status", "=", statusFilter);
    }
    const rows = await listQ.orderBy("extraction_artifacts.id", "desc").limit(safeSize).offset(offset).execute();
    return {
      items: rows.map(mapArtifact),
      totalCount,
      page: safePage,
      pageSize: safeSize
    };
  },
  async syncRuns(mailboxId) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const rows = await db.selectFrom("sync_runs").selectAll().where("mailbox_id", "=", mailboxId).orderBy("id", "desc").limit(50).execute();
    return rows.map(mapSyncRun);
  },
  async syncStatus(mailboxId) {
    const userId = requireUserId();
    const mailbox = await requireOwnedMailbox(userId, mailboxId);
    const syncSince = toDateOrNull(mailbox.sync_since);
    const syncUntil = toDateOrNull(mailbox.sync_until);
    const active = mailbox.sync_requested;
    let oldestQ = db.selectFrom("messages").select((eb) => eb.fn.min("received_at").as("oldest")).where("mailbox_id", "=", mailboxId);
    if (syncSince != null) {
      oldestQ = oldestQ.where("received_at", ">=", syncSince.toISOString());
    }
    if (syncUntil != null) {
      oldestQ = oldestQ.where("received_at", "<=", syncUntil.toISOString());
    }
    const oldestRow = await oldestQ.executeTakeFirst();
    const oldestSyncedAt = toDateOrNull(
      oldestRow?.oldest ?? null
    );
    const pendingRow = await db.selectFrom("extraction_artifacts").innerJoin("messages", "messages.id", "extraction_artifacts.message_id").select((eb) => eb.fn.countAll().as("count")).where("messages.mailbox_id", "=", mailboxId).where("extraction_artifacts.status", "=", "pending").executeTakeFirstOrThrow();
    const errorRow = await db.selectFrom("sync_runs").select("error_text").where("mailbox_id", "=", mailboxId).where("error_text", "is not", null).orderBy("id", "desc").limit(1).executeTakeFirst();
    return {
      active,
      syncSince: asIsoTimestampOrNull(mailbox.sync_since),
      syncUntil: asIsoTimestampOrNull(mailbox.sync_until),
      progressPercent: computeSyncProgressPercent({
        active,
        syncSince,
        syncUntil,
        oldestSyncedAt
      }),
      spendingsFound: Number(pendingRow.count),
      oldestSyncedAt: asIsoTimestampOrNull(oldestSyncedAt),
      errorText: errorRow?.error_text ?? null
    };
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
    const rawFilters = input.domainFilters ?? [];
    const patterns = rawFilters.length === 0 ? [] : validateDomainPatterns(rawFilters);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const values = {
      user_id: userId,
      provider,
      label,
      enabled: input.enabled ?? true,
      sync_cursor: null,
      sync_requested: patterns.length > 0,
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
  async clearInbox(mailboxId) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const row = await clearInboxData(
      createKyselyInboxOpsStore(db),
      mailboxId
    );
    return mapMailbox(row);
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
  async triggerSync(mailboxId, since, until) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    const filterCount = await db.selectFrom("domain_filters").select((eb) => eb.fn.countAll().as("count")).where("mailbox_id", "=", mailboxId).executeTakeFirstOrThrow();
    if (Number(filterCount.count) < 1) {
      throw new InvalidMailboxError(
        "domain filters are required before sync"
      );
    }
    const range = validateSyncDateRange(
      validateOptionalSyncDate(since, "since"),
      validateOptionalSyncDate(until, "until")
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.updateTable("mailboxes").set({
      sync_requested: true,
      sync_since: range.since,
      sync_until: range.until,
      sync_backfill_cursor: null,
      updated_at: now
    }).where("id", "=", mailboxId).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return mapMailbox(row);
  },
  async rejectAllPendingArtifacts(mailboxId) {
    const userId = requireUserId();
    await requireOwnedMailbox(userId, mailboxId);
    return await rejectAllPendingArtifacts(
      createKyselyInboxOpsStore(db),
      mailboxId
    );
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
    const kind = validateTemplateKind(input.kind ?? "approve");
    const name = validateTemplateName(input.name);
    const matchFromPattern = validateMatchFromPattern(input.matchFromPattern);
    const matchSubjectRegex = validateSubjectRegex(input.matchSubjectRegex);
    let extractors = null;
    if (kind === "approve") {
      if (input.extractorsJson == null || !input.extractorsJson.trim()) {
        throw new InvalidMailboxError(
          "extractorsJson is required for approve templates"
        );
      }
      extractors = parseExtractorsJson(input.extractorsJson);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (input.sourceMessageId != null) {
      const msg = await db.selectFrom("messages").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").select("messages.id").where("messages.id", "=", input.sourceMessageId).where("mailboxes.user_id", "=", userId).where("messages.mailbox_id", "=", input.mailboxId).executeTakeFirst();
      if (!msg) throw new InvalidMailboxError("source message not found");
    }
    const row = await db.insertInto("parsing_templates").values({
      mailbox_id: input.mailboxId,
      user_id: userId,
      name,
      kind,
      enabled: input.enabled ?? true,
      match_from_pattern: matchFromPattern,
      match_subject_regex: matchSubjectRegex,
      extractors,
      source_message_id: input.sourceMessageId ?? null,
      version: 1,
      created_at: now,
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
    await applyTemplatesToMailbox(
      createKyselyApplyTemplatesStore(db),
      input.mailboxId,
      now
    );
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
      if (existing.kind === "reject") {
        throw new InvalidMailboxError(
          "reject templates cannot have extractors"
        );
      }
      patch.extractors = parseExtractorsJson(input.extractorsJson);
    }
    if (input.enabled != null) patch.enabled = input.enabled;
    const row = await db.updateTable("parsing_templates").set(patch).where("id", "=", input.id).returningAll().executeTakeFirstOrThrow();
    await applyTemplatesToMailbox(
      createKyselyApplyTemplatesStore(db),
      existing.mailbox_id,
      now
    );
    return mapParsingTemplate(row);
  },
  async deleteParsingTemplate(id) {
    const userId = requireUserId();
    const result = await db.deleteFrom("parsing_templates").where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  },
  async generateParsingTemplate(input) {
    const userId = requireUserId();
    const decision = validateTemplateKind(input.decision);
    const message = await db.selectFrom("messages").innerJoin("mailboxes", "mailboxes.id", "messages.mailbox_id").select([
      "messages.id",
      "messages.mailbox_id",
      "messages.from_address",
      "messages.subject",
      "messages.text_body"
    ]).where("messages.id", "=", input.messageId).where("mailboxes.user_id", "=", userId).executeTakeFirst();
    if (!message) throw new InvalidMailboxError("message not found");
    if (!message.text_body?.trim()) {
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
    const aiInput = {
      from: message.from_address,
      subject: message.subject,
      textBody: message.text_body,
      hints: input.hints
    };
    let matchFromPattern;
    let matchSubjectRegex;
    let extractors = null;
    let nameSuggestion;
    try {
      if (decision === "reject") {
        const aiOut = await generateEmailRejectTemplate(aiInput);
        matchFromPattern = validateMatchFromPattern(aiOut.matchFromPattern);
        matchSubjectRegex = validateSubjectRegex(aiOut.matchSubjectRegex);
        nameSuggestion = aiOut.nameSuggestion || "Ignored email type";
      } else {
        const aiOut = await generateEmailSpendTemplate(aiInput);
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
        nameSuggestion = aiOut.nameSuggestion || "Spending template";
      }
    } catch (err) {
      if (err instanceof InvalidMailboxError && err.message === genericFailMessage) {
        throw err;
      }
      if (err instanceof AiClientError || err instanceof InvalidMailboxError) {
        failTemplateGeneration(err.message, { messageId: message.id });
      }
      throw err;
    }
    const name = validateTemplateName(
      input.name?.trim() || nameSuggestion
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.insertInto("parsing_templates").values({
      mailbox_id: message.mailbox_id,
      user_id: userId,
      name,
      kind: decision,
      enabled: true,
      match_from_pattern: matchFromPattern,
      match_subject_regex: matchSubjectRegex,
      extractors,
      source_message_id: message.id,
      version: 1,
      created_at: now,
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
    await applyTemplatesToMailbox(
      createKyselyApplyTemplatesStore(db),
      message.mailbox_id,
      now
    );
    const reevaluatedCount = await reevaluatePendingWithTemplate(
      createKyselyTemplateReevaluateStore(db),
      {
        id: row.id,
        mailbox_id: row.mailbox_id,
        kind: row.kind,
        enabled: row.enabled,
        match_from_pattern: row.match_from_pattern,
        match_subject_regex: row.match_subject_regex,
        extractors: row.extractors
      },
      now
    );
    return {
      template: mapParsingTemplate(row),
      reevaluatedCount
    };
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
  typeDefs: "input CreateMailboxInputInput {\n	provider: String!\n	label: String!\n	enabled: Boolean\n	domainFilters: [String!]\n	oauthTokensJson: String\n}\ninput UpdateMailboxInputInput {\n	id: Number!\n	label: String!\n}\ninput SetDomainFiltersInputInput {\n	mailboxId: Number!\n	patterns: [String!]!\n}\ninput UpdateArtifactStatusInputInput {\n	artifactId: Number!\n	status: String!\n	categoryId: Number\n}\ninput ConnectGmailInputInput {\n	mailboxId: Number!\n	accessToken: String!\n	refreshToken: String\n	expiresAtMs: Number\n}\ninput StartGmailOAuthInputInput {\n	mailboxId: Number!\n	returnTo: String!\n}\ninput CreateParsingTemplateInputInput {\n	mailboxId: Number!\n	name: String!\n	kind: String\n	matchFromPattern: String!\n	matchSubjectRegex: String\n	extractorsJson: String\n	enabled: Boolean\n	sourceMessageId: Number\n}\ninput UpdateParsingTemplateInputInput {\n	id: Number!\n	name: String\n	matchFromPattern: String\n	matchSubjectRegex: String\n	extractorsJson: String\n	enabled: Boolean\n}\ninput GenerateParsingTemplateInputInput {\n	messageId: Number!\n	decision: String!\n	name: String\n	hints: String\n}\ntype Query {\nmailboxes: [Mailbox!]!\ndomainFilters(mailboxId: Number!): [DomainFilter!]!\nmessages(mailboxId: Number!, excludeMatchingTemplates: Boolean): [Message!]!\nmessage(id: Number!): Message\nsourceMessageForExpense(expenseId: Number!): Message\nextractionArtifacts(mailboxId: Number, status: String, page: Number, pageSize: Number): ExtractionArtifactPage!\nsyncRuns(mailboxId: Number!): [SyncRun!]!\nsyncStatus(mailboxId: Number!): MailboxSyncStatus!\nparsingTemplates(mailboxId: Number!): [ParsingTemplate!]!\n}\ntype Mailbox {\nid: Number!\nuser_id: Number!\nprovider: String!\nlabel: String!\nenabled: Boolean!\nsync_cursor: String\nsync_requested: Boolean!\nsync_since: String\nsync_until: String\nlast_synced_at: String\ncreated_at: String!\nupdated_at: String!\n}\ntype DomainFilter {\nid: Number!\nmailbox_id: Number!\npattern: String!\ncreated_at: String!\n}\ntype Message {\nid: Number!\nmailbox_id: Number!\nprovider_message_id: String!\nrfc_message_id: String!\nfrom_address: String!\nsubject: String!\nreceived_at: String!\ntext_body: String\nhtml_body: String\ncreated_at: String!\n}\ntype ExtractionArtifactPage {\nitems: [ExtractionArtifact!]!\ntotalCount: Number!\npage: Number!\npageSize: Number!\n}\ntype ExtractionArtifact {\nid: Number!\nmessage_id: Number!\nkind: String!\npayload: String!\nconfidence: Number!\nstatus: String!\npublished_expense_id: Number\ncreated_at: String!\nupdated_at: String!\n}\ntype SyncRun {\nid: Number!\nmailbox_id: Number!\nstarted_at: String!\nfinished_at: String\nfetched_count: Number!\nextracted_count: Number!\nerror_text: String\n}\ntype MailboxSyncStatus {\nactive: Boolean!\nsyncSince: String\nsyncUntil: String\nprogressPercent: Number\nspendingsFound: Number!\noldestSyncedAt: String\nerrorText: String\n}\ntype ParsingTemplate {\nid: Number!\nmailbox_id: Number!\nuser_id: Number!\nname: String!\nkind: String!\nenabled: Boolean!\nmatch_from_pattern: String!\nmatch_subject_regex: String\nextractors: String\nsource_message_id: Number\nversion: Number!\ncreated_at: String!\nupdated_at: String!\n}\ntype Mutation {\ncreateMailbox(input: CreateMailboxInputInput!): Mailbox!\nupdateMailbox(input: UpdateMailboxInputInput!): Mailbox!\ndeleteMailbox(id: Number!): Boolean!\nclearInbox(mailboxId: Number!): Mailbox!\nsetDomainFilters(input: SetDomainFiltersInputInput!): [DomainFilter!]!\ntriggerSync(mailboxId: Number!, since: String, until: String): Mailbox!\nrejectAllPendingArtifacts(mailboxId: Number!): Number!\nupdateArtifactStatus(input: UpdateArtifactStatusInputInput!): ExtractionArtifact!\nconnectGmail(input: ConnectGmailInputInput!): Mailbox!\nstartGmailOAuth(input: StartGmailOAuthInputInput!): StartGmailOAuthPayload!\ncreateParsingTemplate(input: CreateParsingTemplateInputInput!): ParsingTemplate!\nupdateParsingTemplate(input: UpdateParsingTemplateInputInput!): ParsingTemplate!\ndeleteParsingTemplate(id: Number!): Boolean!\ngenerateParsingTemplate(input: GenerateParsingTemplateInputInput!): GenerateParsingTemplatePayload!\n}\ntype StartGmailOAuthPayload {\nauthorizationUrl: String!\n}\ntype GenerateParsingTemplatePayload {\ntemplate: ParsingTemplate!\nreevaluatedCount: Number!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vLi4vLi4vbGlicy9tYWlsYm94X2tpdC90eXBlcy50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2RvbWFpbl9maWx0ZXIudHMiLCAiLi4vLi4vLi4vbGlicy9tYWlsYm94X2tpdC90ZW1wbGF0ZV9tYXRjaC50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2V4dHJhY3Rvci50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2h0bWxfdG9fcGxhaW5fdGV4dC50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2V4dHJhY3RvcnMvdGVtcGxhdGVfc3BlbmRpbmdfZXh0cmFjdG9yLnRzIiwgIi4uLy4uLy4uL2xpYnMvbWFpbGJveF9raXQvdGVtcGxhdGVfZXh0cmFjdC50cyIsICIuLi9zcmMvZGIvdHlwZXMvc2NoZW1hLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL2NyZWF0ZV9reXNlbHkudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvZW52LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3NzbC50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL3NlcnZpY2VzL2FpX2NsaWVudC50cyIsICIuLi9zcmMvc2VydmljZXMvYXBwbHlfdGVtcGxhdGVzLnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9pbmJveF9vcHMudHMiLCAiLi4vc3JjL3NlcnZpY2VzL3RlbXBsYXRlX3JlZXZhbHVhdGUudHMiLCAiLi4vc3JjL2dyYXBocWwvdGltZXN0YW1wcy50cyIsICIuLi9zcmMvc2VydmljZXMvbWVzc2FnZV9sb29rdXBzLnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9zcGVuZG1hbmFnZXJfZXhwZW5zZV9zaW5rLnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9nbWFpbF9vYXV0aC50cyIsICIuLi9zcmMvc2VydmljZXMvc3luY19wcm9ncmVzcy50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2F1dGgvdmVyaWZ5LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B5bG9uL21pZGRsZXdhcmUudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvdXNlcnMudHMiLCAiLi4vc3JjL2RiL3VzZXJzLnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9nbWFpbF9vYXV0aF9jYWxsYmFjay50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHJlc29sdmVycyB9IGZyb20gJy4vZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzJ1xuaW1wb3J0IHsgY29yc01pZGRsZXdhcmUgfSBmcm9tICdkZW5vX2FwaV9raXQvYXV0aC92ZXJpZnkudHMnXG5pbXBvcnQge1xuICBjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUsXG4gIGhlYWx0aE1pZGRsZXdhcmUsXG59IGZyb20gJ2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciB9IGZyb20gJy4vZGIvdXNlcnMudHMnXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgeyBoYW5kbGVHbWFpbE9BdXRoQ2FsbGJhY2sgfSBmcm9tICcuL3NlcnZpY2VzL2dtYWlsX29hdXRoX2NhbGxiYWNrLnRzJ1xuXG5hcHAudXNlKGNvcnNNaWRkbGV3YXJlKVxuYXBwLnVzZShoZWFsdGhNaWRkbGV3YXJlKVxuXG4vKiogUHVibGljIEdvb2dsZSBPQXV0aCByZWRpcmVjdCAoYXV0aCBpcyBzaWduZWQgYHN0YXRlYCkuICovXG5hcHAudXNlKGFzeW5jIChjdHgsIG5leHQpID0+IHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoY3R4LnJlcS51cmwpXG4gIGlmICh1cmwucGF0aG5hbWUgPT09ICcvb2F1dGgvZ21haWwvY2FsbGJhY2snICYmIGN0eC5yZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgIHJldHVybiBoYW5kbGVHbWFpbE9BdXRoQ2FsbGJhY2sodXJsLCB7IGRiIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcbn0pXG5cbmFwcC51c2UoY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlKHJlc29sdmVMb2NhbFVzZXIpKVxuXG5leHBvcnQgY29uc3QgZ3JhcGhxbCA9IHtcbiAgLi4ucmVzb2x2ZXJzLFxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJpbnB1dCBDcmVhdGVNYWlsYm94SW5wdXRJbnB1dCB7XFxuXFx0cHJvdmlkZXI6IFN0cmluZyFcXG5cXHRsYWJlbDogU3RyaW5nIVxcblxcdGVuYWJsZWQ6IEJvb2xlYW5cXG5cXHRkb21haW5GaWx0ZXJzOiBbU3RyaW5nIV1cXG5cXHRvYXV0aFRva2Vuc0pzb246IFN0cmluZ1xcbn1cXG5pbnB1dCBVcGRhdGVNYWlsYm94SW5wdXRJbnB1dCB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRsYWJlbDogU3RyaW5nIVxcbn1cXG5pbnB1dCBTZXREb21haW5GaWx0ZXJzSW5wdXRJbnB1dCB7XFxuXFx0bWFpbGJveElkOiBOdW1iZXIhXFxuXFx0cGF0dGVybnM6IFtTdHJpbmchXSFcXG59XFxuaW5wdXQgVXBkYXRlQXJ0aWZhY3RTdGF0dXNJbnB1dElucHV0IHtcXG5cXHRhcnRpZmFjdElkOiBOdW1iZXIhXFxuXFx0c3RhdHVzOiBTdHJpbmchXFxuXFx0Y2F0ZWdvcnlJZDogTnVtYmVyXFxufVxcbmlucHV0IENvbm5lY3RHbWFpbElucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdGFjY2Vzc1Rva2VuOiBTdHJpbmchXFxuXFx0cmVmcmVzaFRva2VuOiBTdHJpbmdcXG5cXHRleHBpcmVzQXRNczogTnVtYmVyXFxufVxcbmlucHV0IFN0YXJ0R21haWxPQXV0aElucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdHJldHVyblRvOiBTdHJpbmchXFxufVxcbmlucHV0IENyZWF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdG5hbWU6IFN0cmluZyFcXG5cXHRraW5kOiBTdHJpbmdcXG5cXHRtYXRjaEZyb21QYXR0ZXJuOiBTdHJpbmchXFxuXFx0bWF0Y2hTdWJqZWN0UmVnZXg6IFN0cmluZ1xcblxcdGV4dHJhY3RvcnNKc29uOiBTdHJpbmdcXG5cXHRlbmFibGVkOiBCb29sZWFuXFxuXFx0c291cmNlTWVzc2FnZUlkOiBOdW1iZXJcXG59XFxuaW5wdXQgVXBkYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXRJbnB1dCB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRuYW1lOiBTdHJpbmdcXG5cXHRtYXRjaEZyb21QYXR0ZXJuOiBTdHJpbmdcXG5cXHRtYXRjaFN1YmplY3RSZWdleDogU3RyaW5nXFxuXFx0ZXh0cmFjdG9yc0pzb246IFN0cmluZ1xcblxcdGVuYWJsZWQ6IEJvb2xlYW5cXG59XFxuaW5wdXQgR2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0IHtcXG5cXHRtZXNzYWdlSWQ6IE51bWJlciFcXG5cXHRkZWNpc2lvbjogU3RyaW5nIVxcblxcdG5hbWU6IFN0cmluZ1xcblxcdGhpbnRzOiBTdHJpbmdcXG59XFxudHlwZSBRdWVyeSB7XFxubWFpbGJveGVzOiBbTWFpbGJveCFdIVxcbmRvbWFpbkZpbHRlcnMobWFpbGJveElkOiBOdW1iZXIhKTogW0RvbWFpbkZpbHRlciFdIVxcbm1lc3NhZ2VzKG1haWxib3hJZDogTnVtYmVyISwgZXhjbHVkZU1hdGNoaW5nVGVtcGxhdGVzOiBCb29sZWFuKTogW01lc3NhZ2UhXSFcXG5tZXNzYWdlKGlkOiBOdW1iZXIhKTogTWVzc2FnZVxcbnNvdXJjZU1lc3NhZ2VGb3JFeHBlbnNlKGV4cGVuc2VJZDogTnVtYmVyISk6IE1lc3NhZ2VcXG5leHRyYWN0aW9uQXJ0aWZhY3RzKG1haWxib3hJZDogTnVtYmVyLCBzdGF0dXM6IFN0cmluZywgcGFnZTogTnVtYmVyLCBwYWdlU2l6ZTogTnVtYmVyKTogRXh0cmFjdGlvbkFydGlmYWN0UGFnZSFcXG5zeW5jUnVucyhtYWlsYm94SWQ6IE51bWJlciEpOiBbU3luY1J1biFdIVxcbnN5bmNTdGF0dXMobWFpbGJveElkOiBOdW1iZXIhKTogTWFpbGJveFN5bmNTdGF0dXMhXFxucGFyc2luZ1RlbXBsYXRlcyhtYWlsYm94SWQ6IE51bWJlciEpOiBbUGFyc2luZ1RlbXBsYXRlIV0hXFxufVxcbnR5cGUgTWFpbGJveCB7XFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxucHJvdmlkZXI6IFN0cmluZyFcXG5sYWJlbDogU3RyaW5nIVxcbmVuYWJsZWQ6IEJvb2xlYW4hXFxuc3luY19jdXJzb3I6IFN0cmluZ1xcbnN5bmNfcmVxdWVzdGVkOiBCb29sZWFuIVxcbnN5bmNfc2luY2U6IFN0cmluZ1xcbnN5bmNfdW50aWw6IFN0cmluZ1xcbmxhc3Rfc3luY2VkX2F0OiBTdHJpbmdcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxudXBkYXRlZF9hdDogU3RyaW5nIVxcbn1cXG50eXBlIERvbWFpbkZpbHRlciB7XFxuaWQ6IE51bWJlciFcXG5tYWlsYm94X2lkOiBOdW1iZXIhXFxucGF0dGVybjogU3RyaW5nIVxcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBNZXNzYWdlIHtcXG5pZDogTnVtYmVyIVxcbm1haWxib3hfaWQ6IE51bWJlciFcXG5wcm92aWRlcl9tZXNzYWdlX2lkOiBTdHJpbmchXFxucmZjX21lc3NhZ2VfaWQ6IFN0cmluZyFcXG5mcm9tX2FkZHJlc3M6IFN0cmluZyFcXG5zdWJqZWN0OiBTdHJpbmchXFxucmVjZWl2ZWRfYXQ6IFN0cmluZyFcXG50ZXh0X2JvZHk6IFN0cmluZ1xcbmh0bWxfYm9keTogU3RyaW5nXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbn1cXG50eXBlIEV4dHJhY3Rpb25BcnRpZmFjdFBhZ2Uge1xcbml0ZW1zOiBbRXh0cmFjdGlvbkFydGlmYWN0IV0hXFxudG90YWxDb3VudDogTnVtYmVyIVxcbnBhZ2U6IE51bWJlciFcXG5wYWdlU2l6ZTogTnVtYmVyIVxcbn1cXG50eXBlIEV4dHJhY3Rpb25BcnRpZmFjdCB7XFxuaWQ6IE51bWJlciFcXG5tZXNzYWdlX2lkOiBOdW1iZXIhXFxua2luZDogU3RyaW5nIVxcbnBheWxvYWQ6IFN0cmluZyFcXG5jb25maWRlbmNlOiBOdW1iZXIhXFxuc3RhdHVzOiBTdHJpbmchXFxucHVibGlzaGVkX2V4cGVuc2VfaWQ6IE51bWJlclxcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgU3luY1J1biB7XFxuaWQ6IE51bWJlciFcXG5tYWlsYm94X2lkOiBOdW1iZXIhXFxuc3RhcnRlZF9hdDogU3RyaW5nIVxcbmZpbmlzaGVkX2F0OiBTdHJpbmdcXG5mZXRjaGVkX2NvdW50OiBOdW1iZXIhXFxuZXh0cmFjdGVkX2NvdW50OiBOdW1iZXIhXFxuZXJyb3JfdGV4dDogU3RyaW5nXFxufVxcbnR5cGUgTWFpbGJveFN5bmNTdGF0dXMge1xcbmFjdGl2ZTogQm9vbGVhbiFcXG5zeW5jU2luY2U6IFN0cmluZ1xcbnN5bmNVbnRpbDogU3RyaW5nXFxucHJvZ3Jlc3NQZXJjZW50OiBOdW1iZXJcXG5zcGVuZGluZ3NGb3VuZDogTnVtYmVyIVxcbm9sZGVzdFN5bmNlZEF0OiBTdHJpbmdcXG5lcnJvclRleHQ6IFN0cmluZ1xcbn1cXG50eXBlIFBhcnNpbmdUZW1wbGF0ZSB7XFxuaWQ6IE51bWJlciFcXG5tYWlsYm94X2lkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5raW5kOiBTdHJpbmchXFxuZW5hYmxlZDogQm9vbGVhbiFcXG5tYXRjaF9mcm9tX3BhdHRlcm46IFN0cmluZyFcXG5tYXRjaF9zdWJqZWN0X3JlZ2V4OiBTdHJpbmdcXG5leHRyYWN0b3JzOiBTdHJpbmdcXG5zb3VyY2VfbWVzc2FnZV9pZDogTnVtYmVyXFxudmVyc2lvbjogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgTXV0YXRpb24ge1xcbmNyZWF0ZU1haWxib3goaW5wdXQ6IENyZWF0ZU1haWxib3hJbnB1dElucHV0ISk6IE1haWxib3ghXFxudXBkYXRlTWFpbGJveChpbnB1dDogVXBkYXRlTWFpbGJveElucHV0SW5wdXQhKTogTWFpbGJveCFcXG5kZWxldGVNYWlsYm94KGlkOiBOdW1iZXIhKTogQm9vbGVhbiFcXG5jbGVhckluYm94KG1haWxib3hJZDogTnVtYmVyISk6IE1haWxib3ghXFxuc2V0RG9tYWluRmlsdGVycyhpbnB1dDogU2V0RG9tYWluRmlsdGVyc0lucHV0SW5wdXQhKTogW0RvbWFpbkZpbHRlciFdIVxcbnRyaWdnZXJTeW5jKG1haWxib3hJZDogTnVtYmVyISwgc2luY2U6IFN0cmluZywgdW50aWw6IFN0cmluZyk6IE1haWxib3ghXFxucmVqZWN0QWxsUGVuZGluZ0FydGlmYWN0cyhtYWlsYm94SWQ6IE51bWJlciEpOiBOdW1iZXIhXFxudXBkYXRlQXJ0aWZhY3RTdGF0dXMoaW5wdXQ6IFVwZGF0ZUFydGlmYWN0U3RhdHVzSW5wdXRJbnB1dCEpOiBFeHRyYWN0aW9uQXJ0aWZhY3QhXFxuY29ubmVjdEdtYWlsKGlucHV0OiBDb25uZWN0R21haWxJbnB1dElucHV0ISk6IE1haWxib3ghXFxuc3RhcnRHbWFpbE9BdXRoKGlucHV0OiBTdGFydEdtYWlsT0F1dGhJbnB1dElucHV0ISk6IFN0YXJ0R21haWxPQXV0aFBheWxvYWQhXFxuY3JlYXRlUGFyc2luZ1RlbXBsYXRlKGlucHV0OiBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0ISk6IFBhcnNpbmdUZW1wbGF0ZSFcXG51cGRhdGVQYXJzaW5nVGVtcGxhdGUoaW5wdXQ6IFVwZGF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQhKTogUGFyc2luZ1RlbXBsYXRlIVxcbmRlbGV0ZVBhcnNpbmdUZW1wbGF0ZShpZDogTnVtYmVyISk6IEJvb2xlYW4hXFxuZ2VuZXJhdGVQYXJzaW5nVGVtcGxhdGUoaW5wdXQ6IEdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXRJbnB1dCEpOiBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZVBheWxvYWQhXFxufVxcbnR5cGUgU3RhcnRHbWFpbE9BdXRoUGF5bG9hZCB7XFxuYXV0aG9yaXphdGlvblVybDogU3RyaW5nIVxcbn1cXG50eXBlIEdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlUGF5bG9hZCB7XFxudGVtcGxhdGU6IFBhcnNpbmdUZW1wbGF0ZSFcXG5yZWV2YWx1YXRlZENvdW50OiBOdW1iZXIhXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcblwiLFxuICAgICAgICBncmFwaHFsLFxuICAgICAgICByZXNvbHZlcnM6IHt9LFxuICAgICAgICBjb25maWc6IF9faW50ZXJuYWxQeWxvbkNvbmZpZ1xuICAgICAgfSkpXG4gICAgICAiLCAiaW1wb3J0IHsgZ2V0Q29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQge1xuICBTUEVORElOR19DQU5ESURBVEVfS0lORCxcbiAgbWVzc2FnZU1hdGNoZXNBbnlUZW1wbGF0ZSxcbiAgcGFyc2VTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyxcbiAgdHlwZSBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQsXG59IGZyb20gJ21haWxib3hfa2l0L21vZC50cydcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7IE5ld01haWxib3ggfSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQge1xuICBBaUNsaWVudEVycm9yLFxuICBnZW5lcmF0ZUVtYWlsUmVqZWN0VGVtcGxhdGUsXG4gIGdlbmVyYXRlRW1haWxTcGVuZFRlbXBsYXRlLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9haV9jbGllbnQudHMnXG5pbXBvcnQge1xuICBhcHBseVRlbXBsYXRlc1RvTWFpbGJveCxcbiAgY3JlYXRlS3lzZWx5QXBwbHlUZW1wbGF0ZXNTdG9yZSxcbn0gZnJvbSAnLi4vLi4vc2VydmljZXMvYXBwbHlfdGVtcGxhdGVzLnRzJ1xuaW1wb3J0IHtcbiAgY2xlYXJJbmJveERhdGEsXG4gIGNyZWF0ZUt5c2VseUluYm94T3BzU3RvcmUsXG4gIHJlamVjdEFsbFBlbmRpbmdBcnRpZmFjdHMgYXMgcmVqZWN0QWxsUGVuZGluZ0FydGlmYWN0c09wLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9pbmJveF9vcHMudHMnXG5pbXBvcnQge1xuICBjcmVhdGVLeXNlbHlUZW1wbGF0ZVJlZXZhbHVhdGVTdG9yZSxcbiAgcmVldmFsdWF0ZVBlbmRpbmdXaXRoVGVtcGxhdGUsXG59IGZyb20gJy4uLy4uL3NlcnZpY2VzL3RlbXBsYXRlX3JlZXZhbHVhdGUudHMnXG5pbXBvcnQge1xuICBjcmVhdGVLeXNlbHlNZXNzYWdlTG9va3VwU3RvcmUsXG4gIGZpbmRPd25lZE1lc3NhZ2UsXG4gIGZpbmRTb3VyY2VNZXNzYWdlRm9yRXhwZW5zZSxcbn0gZnJvbSAnLi4vLi4vc2VydmljZXMvbWVzc2FnZV9sb29rdXBzLnRzJ1xuaW1wb3J0IHtcbiAgU3BlbmRtYW5hZ2VyU2lua0Vycm9yLFxuICBwdWJsaXNoRXhwZW5zZVRvU3BlbmRtYW5hZ2VyLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9zcGVuZG1hbmFnZXJfZXhwZW5zZV9zaW5rLnRzJ1xuaW1wb3J0IHtcbiAgR21haWxPQXV0aEVycm9yLFxuICBidWlsZEdvb2dsZUF1dGhvcml6ZVVybCxcbiAgZmV0Y2hHbWFpbEVtYWlsQWRkcmVzcyxcbiAgaXNSZXR1cm5Ub0FsbG93ZWQsXG4gIGxvYWRHbWFpbE9BdXRoQ29uZmlnLFxuICBzaWduT0F1dGhTdGF0ZSxcbn0gZnJvbSAnLi4vLi4vc2VydmljZXMvZ21haWxfb2F1dGgudHMnXG5pbXBvcnQgeyBhc0lzb1RpbWVzdGFtcCwgYXNJc29UaW1lc3RhbXBPck51bGwgfSBmcm9tICcuLi90aW1lc3RhbXBzLnRzJ1xuaW1wb3J0IHsgY29tcHV0ZVN5bmNQcm9ncmVzc1BlcmNlbnQgfSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9zeW5jX3Byb2dyZXNzLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBDb25uZWN0R21haWxJbnB1dCxcbiAgQ3JlYXRlTWFpbGJveElucHV0LFxuICBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgR2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgU2V0RG9tYWluRmlsdGVyc0lucHV0LFxuICBTdGFydEdtYWlsT0F1dGhJbnB1dCxcbiAgVXBkYXRlQXJ0aWZhY3RTdGF0dXNJbnB1dCxcbiAgVXBkYXRlTWFpbGJveElucHV0LFxuICBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbn0gZnJvbSAnLi4vdHlwZXMudHMnXG5pbXBvcnQge1xuICBJbnZhbGlkTWFpbGJveEVycm9yLFxuICBjbGFtcEFydGlmYWN0UGFnZSxcbiAgdmFsaWRhdGVBcnRpZmFjdFN0YXR1cyxcbiAgdmFsaWRhdGVDYXRlZ29yeUlkLFxuICB2YWxpZGF0ZURvbWFpblBhdHRlcm5zLFxuICB2YWxpZGF0ZUxhYmVsLFxuICB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4sXG4gIHZhbGlkYXRlT3B0aW9uYWxTeW5jRGF0ZSxcbiAgdmFsaWRhdGVQcm92aWRlcixcbiAgdmFsaWRhdGVTdWJqZWN0UmVnZXgsXG4gIHZhbGlkYXRlU3luY0RhdGVSYW5nZSxcbiAgdmFsaWRhdGVUZW1wbGF0ZUtpbmQsXG4gIHZhbGlkYXRlVGVtcGxhdGVOYW1lLFxufSBmcm9tICcuLi92YWxpZGF0aW9uLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVBdXRob3JpemF0aW9uSGVhZGVyKCk6IHN0cmluZyB7XG4gIGNvbnN0IGN0eCA9IGdldENvbnRleHQoKVxuICBjb25zdCBoZWFkZXIgPSBjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpXG4gIGlmICghaGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWlzc2luZyBBdXRob3JpemF0aW9uIGJlYXJlciB0b2tlbicpXG4gIH1cbiAgcmV0dXJuIGhlYWRlclxufVxuXG4vKiogTmFtZWQgcmV0dXJuIHNoYXBlcyBzbyBQeWxvbiBlbWl0cyBHcmFwaFFMIG9iamVjdCB0eXBlcyAobm90IGBBbnkhYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIE1haWxib3gge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBwcm92aWRlcjogc3RyaW5nXG4gIGxhYmVsOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBzeW5jX2N1cnNvcjogc3RyaW5nIHwgbnVsbFxuICBzeW5jX3JlcXVlc3RlZDogYm9vbGVhblxuICBzeW5jX3NpbmNlOiBzdHJpbmcgfCBudWxsXG4gIHN5bmNfdW50aWw6IHN0cmluZyB8IG51bGxcbiAgbGFzdF9zeW5jZWRfYXQ6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IHN0cmluZ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIERvbWFpbkZpbHRlciB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHBhdHRlcm46IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNZXNzYWdlIHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBzdHJpbmdcbiAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keTogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBFeHRyYWN0aW9uQXJ0aWZhY3Qge1xuICBpZDogbnVtYmVyXG4gIG1lc3NhZ2VfaWQ6IG51bWJlclxuICBraW5kOiBzdHJpbmdcbiAgcGF5bG9hZDogc3RyaW5nXG4gIGNvbmZpZGVuY2U6IG51bWJlclxuICBzdGF0dXM6IHN0cmluZ1xuICBwdWJsaXNoZWRfZXhwZW5zZV9pZDogbnVtYmVyIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBzdHJpbmdcbiAgdXBkYXRlZF9hdDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdGlvbkFydGlmYWN0UGFnZSB7XG4gIGl0ZW1zOiBFeHRyYWN0aW9uQXJ0aWZhY3RbXVxuICB0b3RhbENvdW50OiBudW1iZXJcbiAgcGFnZTogbnVtYmVyXG4gIHBhZ2VTaXplOiBudW1iZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTeW5jUnVuIHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgc3RhcnRlZF9hdDogc3RyaW5nXG4gIGZpbmlzaGVkX2F0OiBzdHJpbmcgfCBudWxsXG4gIGZldGNoZWRfY291bnQ6IG51bWJlclxuICBleHRyYWN0ZWRfY291bnQ6IG51bWJlclxuICBlcnJvcl90ZXh0OiBzdHJpbmcgfCBudWxsXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2luZ1RlbXBsYXRlIHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICBraW5kOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBtYXRjaF9mcm9tX3BhdHRlcm46IHN0cmluZ1xuICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IHN0cmluZyB8IG51bGxcbiAgc291cmNlX21lc3NhZ2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdmVyc2lvbjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGFydEdtYWlsT0F1dGhQYXlsb2FkIHtcbiAgYXV0aG9yaXphdGlvblVybDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVQYXlsb2FkIHtcbiAgdGVtcGxhdGU6IFBhcnNpbmdUZW1wbGF0ZVxuICByZWV2YWx1YXRlZENvdW50OiBudW1iZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNYWlsYm94U3luY1N0YXR1cyB7XG4gIGFjdGl2ZTogYm9vbGVhblxuICBzeW5jU2luY2U6IHN0cmluZyB8IG51bGxcbiAgc3luY1VudGlsOiBzdHJpbmcgfCBudWxsXG4gIHByb2dyZXNzUGVyY2VudDogbnVtYmVyIHwgbnVsbFxuICBzcGVuZGluZ3NGb3VuZDogbnVtYmVyXG4gIG9sZGVzdFN5bmNlZEF0OiBzdHJpbmcgfCBudWxsXG4gIGVycm9yVGV4dDogc3RyaW5nIHwgbnVsbFxufVxuXG5mdW5jdGlvbiB0b0RhdGVPck51bGwodmFsdWU6IERhdGUgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogRGF0ZSB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiBOdW1iZXIuaXNOYU4odmFsdWUuZ2V0VGltZSgpKSA/IG51bGwgOiB2YWx1ZVxuICB9XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZSh2YWx1ZSlcbiAgcmV0dXJuIE51bWJlci5pc05hTihkLmdldFRpbWUoKSkgPyBudWxsIDogZFxufVxuXG5mdW5jdGlvbiBtYXBNYWlsYm94KHJvdzoge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBwcm92aWRlcjogc3RyaW5nXG4gIGxhYmVsOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBzeW5jX2N1cnNvcjogc3RyaW5nIHwgbnVsbFxuICBzeW5jX3JlcXVlc3RlZDogYm9vbGVhblxuICBzeW5jX3NpbmNlPzogRGF0ZSB8IHN0cmluZyB8IG51bGxcbiAgc3luY191bnRpbD86IERhdGUgfCBzdHJpbmcgfCBudWxsXG4gIGxhc3Rfc3luY2VkX2F0OiBEYXRlIHwgc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pOiBNYWlsYm94IHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIHVzZXJfaWQ6IHJvdy51c2VyX2lkLFxuICAgIHByb3ZpZGVyOiByb3cucHJvdmlkZXIsXG4gICAgbGFiZWw6IHJvdy5sYWJlbCxcbiAgICBlbmFibGVkOiByb3cuZW5hYmxlZCxcbiAgICBzeW5jX2N1cnNvcjogcm93LnN5bmNfY3Vyc29yLFxuICAgIHN5bmNfcmVxdWVzdGVkOiByb3cuc3luY19yZXF1ZXN0ZWQsXG4gICAgc3luY19zaW5jZTogYXNJc29UaW1lc3RhbXBPck51bGwocm93LnN5bmNfc2luY2UgPz8gbnVsbCksXG4gICAgc3luY191bnRpbDogYXNJc29UaW1lc3RhbXBPck51bGwocm93LnN5bmNfdW50aWwgPz8gbnVsbCksXG4gICAgbGFzdF9zeW5jZWRfYXQ6IGFzSXNvVGltZXN0YW1wT3JOdWxsKHJvdy5sYXN0X3N5bmNlZF9hdCksXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICAgIHVwZGF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy51cGRhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBEb21haW5GaWx0ZXIocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHBhdHRlcm46IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KTogRG9tYWluRmlsdGVyIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHBhdHRlcm46IHJvdy5wYXR0ZXJuLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBNZXNzYWdlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwcm92aWRlcl9tZXNzYWdlX2lkOiBzdHJpbmdcbiAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdGV4dF9ib2R5Pzogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk/OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pOiBNZXNzYWdlIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHJvdy5wcm92aWRlcl9tZXNzYWdlX2lkLFxuICAgIHJmY19tZXNzYWdlX2lkOiByb3cucmZjX21lc3NhZ2VfaWQsXG4gICAgZnJvbV9hZGRyZXNzOiByb3cuZnJvbV9hZGRyZXNzLFxuICAgIHN1YmplY3Q6IHJvdy5zdWJqZWN0LFxuICAgIHJlY2VpdmVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cucmVjZWl2ZWRfYXQpLFxuICAgIHRleHRfYm9keTogcm93LnRleHRfYm9keSA/PyBudWxsLFxuICAgIGh0bWxfYm9keTogcm93Lmh0bWxfYm9keSA/PyBudWxsLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBBcnRpZmFjdChyb3c6IHtcbiAgaWQ6IG51bWJlclxuICBtZXNzYWdlX2lkOiBudW1iZXJcbiAga2luZDogc3RyaW5nXG4gIHBheWxvYWQ6IHVua25vd25cbiAgY29uZmlkZW5jZTogbnVtYmVyXG4gIHN0YXR1czogc3RyaW5nXG4gIHB1Ymxpc2hlZF9leHBlbnNlX2lkPzogbnVtYmVyIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pOiBFeHRyYWN0aW9uQXJ0aWZhY3Qge1xuICByZXR1cm4ge1xuICAgIGlkOiByb3cuaWQsXG4gICAgbWVzc2FnZV9pZDogcm93Lm1lc3NhZ2VfaWQsXG4gICAga2luZDogcm93LmtpbmQsXG4gICAgcGF5bG9hZDpcbiAgICAgIHR5cGVvZiByb3cucGF5bG9hZCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyByb3cucGF5bG9hZFxuICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHJvdy5wYXlsb2FkID8/IHt9KSxcbiAgICBjb25maWRlbmNlOiByb3cuY29uZmlkZW5jZSxcbiAgICBzdGF0dXM6IHJvdy5zdGF0dXMsXG4gICAgcHVibGlzaGVkX2V4cGVuc2VfaWQ6IHJvdy5wdWJsaXNoZWRfZXhwZW5zZV9pZCA/PyBudWxsLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgICB1cGRhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cudXBkYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwU3luY1J1bihyb3c6IHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgc3RhcnRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICBmaW5pc2hlZF9hdDogRGF0ZSB8IHN0cmluZyB8IG51bGxcbiAgZmV0Y2hlZF9jb3VudDogbnVtYmVyXG4gIGV4dHJhY3RlZF9jb3VudDogbnVtYmVyXG4gIGVycm9yX3RleHQ6IHN0cmluZyB8IG51bGxcbn0pOiBTeW5jUnVuIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHN0YXJ0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5zdGFydGVkX2F0KSxcbiAgICBmaW5pc2hlZF9hdDogYXNJc29UaW1lc3RhbXBPck51bGwocm93LmZpbmlzaGVkX2F0KSxcbiAgICBmZXRjaGVkX2NvdW50OiByb3cuZmV0Y2hlZF9jb3VudCxcbiAgICBleHRyYWN0ZWRfY291bnQ6IHJvdy5leHRyYWN0ZWRfY291bnQsXG4gICAgZXJyb3JfdGV4dDogcm93LmVycm9yX3RleHQsXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwUGFyc2luZ1RlbXBsYXRlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGtpbmQ6IHN0cmluZ1xuICBlbmFibGVkOiBib29sZWFuXG4gIG1hdGNoX2Zyb21fcGF0dGVybjogc3RyaW5nXG4gIG1hdGNoX3N1YmplY3RfcmVnZXg6IHN0cmluZyB8IG51bGxcbiAgZXh0cmFjdG9yczogdW5rbm93blxuICBzb3VyY2VfbWVzc2FnZV9pZDogbnVtYmVyIHwgbnVsbFxuICB2ZXJzaW9uOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KTogUGFyc2luZ1RlbXBsYXRlIHtcbiAgbGV0IGV4dHJhY3RvcnM6IHN0cmluZyB8IG51bGwgPSBudWxsXG4gIGlmIChyb3cuZXh0cmFjdG9ycyAhPSBudWxsKSB7XG4gICAgZXh0cmFjdG9ycyA9IHR5cGVvZiByb3cuZXh0cmFjdG9ycyA9PT0gJ3N0cmluZydcbiAgICAgID8gcm93LmV4dHJhY3RvcnNcbiAgICAgIDogSlNPTi5zdHJpbmdpZnkocm93LmV4dHJhY3RvcnMpXG4gIH1cbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHVzZXJfaWQ6IHJvdy51c2VyX2lkLFxuICAgIG5hbWU6IHJvdy5uYW1lLFxuICAgIGtpbmQ6IHJvdy5raW5kLFxuICAgIGVuYWJsZWQ6IHJvdy5lbmFibGVkLFxuICAgIG1hdGNoX2Zyb21fcGF0dGVybjogcm93Lm1hdGNoX2Zyb21fcGF0dGVybixcbiAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiByb3cubWF0Y2hfc3ViamVjdF9yZWdleCxcbiAgICBleHRyYWN0b3JzLFxuICAgIHNvdXJjZV9tZXNzYWdlX2lkOiByb3cuc291cmNlX21lc3NhZ2VfaWQsXG4gICAgdmVyc2lvbjogcm93LnZlcnNpb24sXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICAgIHVwZGF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy51cGRhdGVkX2F0KSxcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZDogbnVtYmVyLCBtYWlsYm94SWQ6IG51bWJlcikge1xuICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdtYWlsYm94ZXMnKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC53aGVyZSgnaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gIGlmICghcm93KSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWFpbGJveCBub3QgZm91bmQnKVxuICByZXR1cm4gcm93XG59XG5cbmZ1bmN0aW9uIHBhcnNlRXh0cmFjdG9yc0pzb24ocmF3OiBzdHJpbmcpIHtcbiAgbGV0IHBhcnNlZDogdW5rbm93blxuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KVxuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignZXh0cmFjdG9yc0pzb24gbXVzdCBiZSB2YWxpZCBKU09OJylcbiAgfVxuICBjb25zdCBleHRyYWN0b3JzID0gcGFyc2VTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyhwYXJzZWQpXG4gIGlmICghZXh0cmFjdG9ycykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdleHRyYWN0b3JzSnNvbiBoYXMgaW52YWxpZCBzaGFwZScpXG4gIH1cbiAgcmV0dXJuIGV4dHJhY3RvcnNcbn1cblxuZnVuY3Rpb24gYXNTcGVuZGluZ1BheWxvYWQocGF5bG9hZDogdW5rbm93bik6IFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCB8IG51bGwge1xuICBjb25zdCBvYmogPSB0eXBlb2YgcGF5bG9hZCA9PT0gJ3N0cmluZydcbiAgICA/ICgoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShwYXlsb2FkKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsXG4gICAgICB9XG4gICAgfSkoKVxuICAgIDogcGF5bG9hZFxuICBpZiAob2JqID09PSBudWxsIHx8IHR5cGVvZiBvYmogIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkob2JqKSkgcmV0dXJuIG51bGxcbiAgY29uc3QgcCA9IG9iaiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBpZiAodHlwZW9mIHAuYW1vdW50Q2VudHMgIT09ICdudW1iZXInIHx8IHR5cGVvZiBwLnNwZW50T24gIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICByZXR1cm4ge1xuICAgIGFtb3VudENlbnRzOiBwLmFtb3VudENlbnRzLFxuICAgIGN1cnJlbmN5OiB0eXBlb2YgcC5jdXJyZW5jeSA9PT0gJ3N0cmluZycgPyBwLmN1cnJlbmN5IDogJ1VTRCcsXG4gICAgc3BlbnRPbjogcC5zcGVudE9uLFxuICAgIG1lcmNoYW50OiB0eXBlb2YgcC5tZXJjaGFudCA9PT0gJ3N0cmluZycgPyBwLm1lcmNoYW50IDogbnVsbCxcbiAgICBub3RlOiB0eXBlb2YgcC5ub3RlID09PSAnc3RyaW5nJyA/IHAubm90ZSA6IG51bGwsXG4gICAgc291cmNlU3ViamVjdDogdHlwZW9mIHAuc291cmNlU3ViamVjdCA9PT0gJ3N0cmluZycgPyBwLnNvdXJjZVN1YmplY3QgOiAnJyxcbiAgICBzb3VyY2VGcm9tOiB0eXBlb2YgcC5zb3VyY2VGcm9tID09PSAnc3RyaW5nJyA/IHAuc291cmNlRnJvbSA6ICcnLFxuICAgIHB1Ymxpc2hlZEV4cGVuc2VJZDpcbiAgICAgIHR5cGVvZiBwLnB1Ymxpc2hlZEV4cGVuc2VJZCA9PT0gJ251bWJlcicgPyBwLnB1Ymxpc2hlZEV4cGVuc2VJZCA6IG51bGwsXG4gICAgdGVtcGxhdGVJZDogdHlwZW9mIHAudGVtcGxhdGVJZCA9PT0gJ251bWJlcicgPyBwLnRlbXBsYXRlSWQgOiBudWxsLFxuICB9XG59XG5cbmNvbnN0IFF1ZXJ5ID0ge1xuICBhc3luYyBtYWlsYm94ZXMoKTogUHJvbWlzZTxNYWlsYm94W10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdtYWlsYm94ZXMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBNYWlsYm94KVxuICB9LFxuXG4gIGFzeW5jIGRvbWFpbkZpbHRlcnMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPERvbWFpbkZpbHRlcltdPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIG1haWxib3hJZClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdkb21haW5fZmlsdGVycycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2FzYycpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcERvbWFpbkZpbHRlcilcbiAgfSxcblxuICBhc3luYyBtZXNzYWdlcyhcbiAgICBtYWlsYm94SWQ6IG51bWJlcixcbiAgICBleGNsdWRlTWF0Y2hpbmdUZW1wbGF0ZXM/OiBib29sZWFuLFxuICApOiBQcm9taXNlPE1lc3NhZ2VbXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdyZWNlaXZlZF9hdCcsICdkZXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICBjb25zdCBtYXBwZWQgPSByb3dzLm1hcChtYXBNZXNzYWdlKVxuICAgIGlmICghZXhjbHVkZU1hdGNoaW5nVGVtcGxhdGVzKSByZXR1cm4gbWFwcGVkXG5cbiAgICBjb25zdCB0ZW1wbGF0ZXMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC5zZWxlY3QoWydtYXRjaF9mcm9tX3BhdHRlcm4nLCAnbWF0Y2hfc3ViamVjdF9yZWdleCcsICdlbmFibGVkJ10pXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC53aGVyZSgnZW5hYmxlZCcsICc9JywgdHJ1ZSlcbiAgICAgIC5leGVjdXRlKClcbiAgICBjb25zdCBzcGVjcyA9IHRlbXBsYXRlcy5tYXAoKHQpID0+ICh7XG4gICAgICBtYXRjaEZyb21QYXR0ZXJuOiB0Lm1hdGNoX2Zyb21fcGF0dGVybixcbiAgICAgIG1hdGNoU3ViamVjdFJlZ2V4OiB0Lm1hdGNoX3N1YmplY3RfcmVnZXgsXG4gICAgICBlbmFibGVkOiB0LmVuYWJsZWQsXG4gICAgfSkpXG4gICAgcmV0dXJuIG1hcHBlZC5maWx0ZXIoXG4gICAgICAobSkgPT5cbiAgICAgICAgIW1lc3NhZ2VNYXRjaGVzQW55VGVtcGxhdGUoXG4gICAgICAgICAgeyBmcm9tOiBtLmZyb21fYWRkcmVzcywgc3ViamVjdDogbS5zdWJqZWN0IH0sXG4gICAgICAgICAgc3BlY3MsXG4gICAgICAgICksXG4gICAgKVxuICB9LFxuXG4gIGFzeW5jIG1lc3NhZ2UoaWQ6IG51bWJlcik6IFByb21pc2U8TWVzc2FnZSB8IG51bGw+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICByZXR1cm4gYXdhaXQgZmluZE93bmVkTWVzc2FnZShjcmVhdGVLeXNlbHlNZXNzYWdlTG9va3VwU3RvcmUoZGIpLCB1c2VySWQsIGlkKVxuICB9LFxuXG4gIGFzeW5jIHNvdXJjZU1lc3NhZ2VGb3JFeHBlbnNlKGV4cGVuc2VJZDogbnVtYmVyKTogUHJvbWlzZTxNZXNzYWdlIHwgbnVsbD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIHJldHVybiBhd2FpdCBmaW5kU291cmNlTWVzc2FnZUZvckV4cGVuc2UoXG4gICAgICBjcmVhdGVLeXNlbHlNZXNzYWdlTG9va3VwU3RvcmUoZGIpLFxuICAgICAgdXNlcklkLFxuICAgICAgZXhwZW5zZUlkLFxuICAgIClcbiAgfSxcblxuICBhc3luYyBleHRyYWN0aW9uQXJ0aWZhY3RzKFxuICAgIG1haWxib3hJZD86IG51bWJlciB8IG51bGwsXG4gICAgc3RhdHVzPzogc3RyaW5nIHwgbnVsbCxcbiAgICBwYWdlPzogbnVtYmVyIHwgbnVsbCxcbiAgICBwYWdlU2l6ZT86IG51bWJlciB8IG51bGwsXG4gICk6IFByb21pc2U8RXh0cmFjdGlvbkFydGlmYWN0UGFnZT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHsgcGFnZTogc2FmZVBhZ2UsIHBhZ2VTaXplOiBzYWZlU2l6ZSwgb2Zmc2V0IH0gPSBjbGFtcEFydGlmYWN0UGFnZShcbiAgICAgIHBhZ2UsXG4gICAgICBwYWdlU2l6ZSxcbiAgICApXG4gICAgY29uc3Qgc3RhdHVzRmlsdGVyID1cbiAgICAgIHN0YXR1cyAhPSBudWxsICYmIHN0YXR1cyAhPT0gJydcbiAgICAgICAgPyB2YWxpZGF0ZUFydGlmYWN0U3RhdHVzKHN0YXR1cylcbiAgICAgICAgOiBudWxsXG5cbiAgICBsZXQgY291bnRRID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAuaW5uZXJKb2luKCdtZXNzYWdlcycsICdtZXNzYWdlcy5pZCcsICdleHRyYWN0aW9uX2FydGlmYWN0cy5tZXNzYWdlX2lkJylcbiAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAuc2VsZWN0KChlYikgPT4gZWIuZm4uY291bnRBbGw8bnVtYmVyPigpLmFzKCdjb3VudCcpKVxuICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIGlmIChtYWlsYm94SWQgIT0gbnVsbCkge1xuICAgICAgY291bnRRID0gY291bnRRLndoZXJlKCdtZXNzYWdlcy5tYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgfVxuICAgIGlmIChzdGF0dXNGaWx0ZXIgIT0gbnVsbCkge1xuICAgICAgY291bnRRID0gY291bnRRLndoZXJlKCdleHRyYWN0aW9uX2FydGlmYWN0cy5zdGF0dXMnLCAnPScsIHN0YXR1c0ZpbHRlcilcbiAgICB9XG4gICAgY29uc3QgY291bnRSb3cgPSBhd2FpdCBjb3VudFEuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIGNvbnN0IHRvdGFsQ291bnQgPSBOdW1iZXIoY291bnRSb3cuY291bnQpXG5cbiAgICBsZXQgbGlzdFEgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC5pbm5lckpvaW4oJ21lc3NhZ2VzJywgJ21lc3NhZ2VzLmlkJywgJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLm1lc3NhZ2VfaWQnKVxuICAgICAgLmlubmVySm9pbignbWFpbGJveGVzJywgJ21haWxib3hlcy5pZCcsICdtZXNzYWdlcy5tYWlsYm94X2lkJylcbiAgICAgIC5zZWxlY3RBbGwoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC53aGVyZSgnbWFpbGJveGVzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICBpZiAobWFpbGJveElkICE9IG51bGwpIHtcbiAgICAgIGxpc3RRID0gbGlzdFEud2hlcmUoJ21lc3NhZ2VzLm1haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICB9XG4gICAgaWYgKHN0YXR1c0ZpbHRlciAhPSBudWxsKSB7XG4gICAgICBsaXN0USA9IGxpc3RRLndoZXJlKCdleHRyYWN0aW9uX2FydGlmYWN0cy5zdGF0dXMnLCAnPScsIHN0YXR1c0ZpbHRlcilcbiAgICB9XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGxpc3RRXG4gICAgICAub3JkZXJCeSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuaWQnLCAnZGVzYycpXG4gICAgICAubGltaXQoc2FmZVNpemUpXG4gICAgICAub2Zmc2V0KG9mZnNldClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiB7XG4gICAgICBpdGVtczogcm93cy5tYXAobWFwQXJ0aWZhY3QpLFxuICAgICAgdG90YWxDb3VudCxcbiAgICAgIHBhZ2U6IHNhZmVQYWdlLFxuICAgICAgcGFnZVNpemU6IHNhZmVTaXplLFxuICAgIH1cbiAgfSxcblxuICBhc3luYyBzeW5jUnVucyhtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8U3luY1J1bltdPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIG1haWxib3hJZClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdzeW5jX3J1bnMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdkZXNjJylcbiAgICAgIC5saW1pdCg1MClcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwU3luY1J1bilcbiAgfSxcblxuICBhc3luYyBzeW5jU3RhdHVzKG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxNYWlsYm94U3luY1N0YXR1cz4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG1haWxib3ggPSBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IHN5bmNTaW5jZSA9IHRvRGF0ZU9yTnVsbChtYWlsYm94LnN5bmNfc2luY2UpXG4gICAgY29uc3Qgc3luY1VudGlsID0gdG9EYXRlT3JOdWxsKG1haWxib3guc3luY191bnRpbClcbiAgICBjb25zdCBhY3RpdmUgPSBtYWlsYm94LnN5bmNfcmVxdWVzdGVkXG5cbiAgICBsZXQgb2xkZXN0USA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgLnNlbGVjdCgoZWIpID0+IGViLmZuLm1pbigncmVjZWl2ZWRfYXQnKS5hcygnb2xkZXN0JykpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICBpZiAoc3luY1NpbmNlICE9IG51bGwpIHtcbiAgICAgIG9sZGVzdFEgPSBvbGRlc3RRLndoZXJlKCdyZWNlaXZlZF9hdCcsICc+PScsIHN5bmNTaW5jZS50b0lTT1N0cmluZygpKVxuICAgIH1cbiAgICBpZiAoc3luY1VudGlsICE9IG51bGwpIHtcbiAgICAgIG9sZGVzdFEgPSBvbGRlc3RRLndoZXJlKCdyZWNlaXZlZF9hdCcsICc8PScsIHN5bmNVbnRpbC50b0lTT1N0cmluZygpKVxuICAgIH1cbiAgICBjb25zdCBvbGRlc3RSb3cgPSBhd2FpdCBvbGRlc3RRLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGNvbnN0IG9sZGVzdFN5bmNlZEF0ID0gdG9EYXRlT3JOdWxsKFxuICAgICAgKG9sZGVzdFJvdz8ub2xkZXN0IGFzIERhdGUgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKSA/PyBudWxsLFxuICAgIClcblxuICAgIGNvbnN0IHBlbmRpbmdSb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC5pbm5lckpvaW4oJ21lc3NhZ2VzJywgJ21lc3NhZ2VzLmlkJywgJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLm1lc3NhZ2VfaWQnKVxuICAgICAgLnNlbGVjdCgoZWIpID0+IGViLmZuLmNvdW50QWxsPHN0cmluZz4oKS5hcygnY291bnQnKSlcbiAgICAgIC53aGVyZSgnbWVzc2FnZXMubWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLndoZXJlKCdleHRyYWN0aW9uX2FydGlmYWN0cy5zdGF0dXMnLCAnPScsICdwZW5kaW5nJylcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBjb25zdCBlcnJvclJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnc3luY19ydW5zJylcbiAgICAgIC5zZWxlY3QoJ2Vycm9yX3RleHQnKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAud2hlcmUoJ2Vycm9yX3RleHQnLCAnaXMgbm90JywgbnVsbClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdkZXNjJylcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGl2ZSxcbiAgICAgIHN5bmNTaW5jZTogYXNJc29UaW1lc3RhbXBPck51bGwobWFpbGJveC5zeW5jX3NpbmNlKSxcbiAgICAgIHN5bmNVbnRpbDogYXNJc29UaW1lc3RhbXBPck51bGwobWFpbGJveC5zeW5jX3VudGlsKSxcbiAgICAgIHByb2dyZXNzUGVyY2VudDogY29tcHV0ZVN5bmNQcm9ncmVzc1BlcmNlbnQoe1xuICAgICAgICBhY3RpdmUsXG4gICAgICAgIHN5bmNTaW5jZSxcbiAgICAgICAgc3luY1VudGlsLFxuICAgICAgICBvbGRlc3RTeW5jZWRBdCxcbiAgICAgIH0pLFxuICAgICAgc3BlbmRpbmdzRm91bmQ6IE51bWJlcihwZW5kaW5nUm93LmNvdW50KSxcbiAgICAgIG9sZGVzdFN5bmNlZEF0OiBhc0lzb1RpbWVzdGFtcE9yTnVsbChvbGRlc3RTeW5jZWRBdCksXG4gICAgICBlcnJvclRleHQ6IGVycm9yUm93Py5lcnJvcl90ZXh0ID8/IG51bGwsXG4gICAgfVxuICB9LFxuXG4gIGFzeW5jIHBhcnNpbmdUZW1wbGF0ZXMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPFBhcnNpbmdUZW1wbGF0ZVtdPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIG1haWxib3hJZClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwUGFyc2luZ1RlbXBsYXRlKVxuICB9LFxufVxuXG5jb25zdCBNdXRhdGlvbiA9IHtcbiAgYXN5bmMgY3JlYXRlTWFpbGJveChpbnB1dDogQ3JlYXRlTWFpbGJveElucHV0KTogUHJvbWlzZTxNYWlsYm94PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcHJvdmlkZXIgPSB2YWxpZGF0ZVByb3ZpZGVyKGlucHV0LnByb3ZpZGVyKVxuICAgIGNvbnN0IGxhYmVsID0gdmFsaWRhdGVMYWJlbChpbnB1dC5sYWJlbClcbiAgICAvLyBFbXB0eSBhbGxvd2VkIGF0IGNyZWF0ZSAoZS5nLiBHbWFpbCBPQXV0aCk7IHN5bmMgcmVxdWlyZXMgZmlsdGVycyBsYXRlci5cbiAgICBjb25zdCByYXdGaWx0ZXJzID0gaW5wdXQuZG9tYWluRmlsdGVycyA/PyBbXVxuICAgIGNvbnN0IHBhdHRlcm5zID0gcmF3RmlsdGVycy5sZW5ndGggPT09IDBcbiAgICAgID8gW11cbiAgICAgIDogdmFsaWRhdGVEb21haW5QYXR0ZXJucyhyYXdGaWx0ZXJzKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3QgdmFsdWVzOiBOZXdNYWlsYm94ID0ge1xuICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgcHJvdmlkZXIsXG4gICAgICBsYWJlbCxcbiAgICAgIGVuYWJsZWQ6IGlucHV0LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgIHN5bmNfY3Vyc29yOiBudWxsLFxuICAgICAgc3luY19yZXF1ZXN0ZWQ6IHBhdHRlcm5zLmxlbmd0aCA+IDAsXG4gICAgICBvYXV0aF90b2tlbnNfanNvbjogaW5wdXQub2F1dGhUb2tlbnNKc29uID8/IG51bGwsXG4gICAgICBsYXN0X3N5bmNlZF9hdDogbnVsbCxcbiAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICB9XG5cbiAgICBjb25zdCBtYWlsYm94ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdtYWlsYm94ZXMnKVxuICAgICAgLnZhbHVlcyh2YWx1ZXMpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBpZiAocGF0dGVybnMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2RvbWFpbl9maWx0ZXJzJylcbiAgICAgICAgLnZhbHVlcyhcbiAgICAgICAgICBwYXR0ZXJucy5tYXAoKHBhdHRlcm4pID0+ICh7XG4gICAgICAgICAgICBtYWlsYm94X2lkOiBtYWlsYm94LmlkLFxuICAgICAgICAgICAgcGF0dGVybixcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KSksXG4gICAgICAgIClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgIH1cblxuICAgIHJldHVybiBtYXBNYWlsYm94KG1haWxib3gpXG4gIH0sXG5cbiAgYXN5bmMgdXBkYXRlTWFpbGJveChpbnB1dDogVXBkYXRlTWFpbGJveElucHV0KTogUHJvbWlzZTxNYWlsYm94PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIGlucHV0LmlkKVxuICAgIGNvbnN0IGxhYmVsID0gdmFsaWRhdGVMYWJlbChpbnB1dC5sYWJlbClcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdtYWlsYm94ZXMnKVxuICAgICAgLnNldCh7IGxhYmVsLCB1cGRhdGVkX2F0OiBub3cgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcE1haWxib3gocm93KVxuICB9LFxuXG4gIGFzeW5jIGRlbGV0ZU1haWxib3goaWQ6IG51bWJlcik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnbWFpbGJveGVzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgcmV0dXJuIE51bWJlcihyZXN1bHQubnVtRGVsZXRlZFJvd3MgPz8gMCkgPiAwXG4gIH0sXG5cbiAgYXN5bmMgY2xlYXJJbmJveChtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8TWFpbGJveD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgY2xlYXJJbmJveERhdGEoXG4gICAgICBjcmVhdGVLeXNlbHlJbmJveE9wc1N0b3JlKGRiKSxcbiAgICAgIG1haWxib3hJZCxcbiAgICApXG4gICAgcmV0dXJuIG1hcE1haWxib3gocm93KVxuICB9LFxuXG4gIGFzeW5jIHNldERvbWFpbkZpbHRlcnMoaW5wdXQ6IFNldERvbWFpbkZpbHRlcnNJbnB1dCk6IFByb21pc2U8RG9tYWluRmlsdGVyW10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGNvbnN0IHBhdHRlcm5zID0gdmFsaWRhdGVEb21haW5QYXR0ZXJucyhpbnB1dC5wYXR0ZXJucylcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBpZiAocGF0dGVybnMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2RvbWFpbl9maWx0ZXJzJylcbiAgICAgICAgLnZhbHVlcyhcbiAgICAgICAgICBwYXR0ZXJucy5tYXAoKHBhdHRlcm4pID0+ICh7XG4gICAgICAgICAgICBtYWlsYm94X2lkOiBpbnB1dC5tYWlsYm94SWQsXG4gICAgICAgICAgICBwYXR0ZXJuLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIGlucHV0Lm1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBEb21haW5GaWx0ZXIpXG4gIH0sXG5cbiAgYXN5bmMgdHJpZ2dlclN5bmMoXG4gICAgbWFpbGJveElkOiBudW1iZXIsXG4gICAgc2luY2U/OiBzdHJpbmcgfCBudWxsLFxuICAgIHVudGlsPzogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTxNYWlsYm94PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIG1haWxib3hJZClcbiAgICBjb25zdCBmaWx0ZXJDb3VudCA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLnNlbGVjdCgoZWIpID0+IGViLmZuLmNvdW50QWxsPHN0cmluZz4oKS5hcygnY291bnQnKSlcbiAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICBpZiAoTnVtYmVyKGZpbHRlckNvdW50LmNvdW50KSA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgICAnZG9tYWluIGZpbHRlcnMgYXJlIHJlcXVpcmVkIGJlZm9yZSBzeW5jJyxcbiAgICAgIClcbiAgICB9XG4gICAgY29uc3QgcmFuZ2UgPSB2YWxpZGF0ZVN5bmNEYXRlUmFuZ2UoXG4gICAgICB2YWxpZGF0ZU9wdGlvbmFsU3luY0RhdGUoc2luY2UsICdzaW5jZScpLFxuICAgICAgdmFsaWRhdGVPcHRpb25hbFN5bmNEYXRlKHVudGlsLCAndW50aWwnKSxcbiAgICApXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnbWFpbGJveGVzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBzeW5jX3JlcXVlc3RlZDogdHJ1ZSxcbiAgICAgICAgc3luY19zaW5jZTogcmFuZ2Uuc2luY2UsXG4gICAgICAgIHN5bmNfdW50aWw6IHJhbmdlLnVudGlsLFxuICAgICAgICBzeW5jX2JhY2tmaWxsX2N1cnNvcjogbnVsbCxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBNYWlsYm94KHJvdylcbiAgfSxcblxuICBhc3luYyByZWplY3RBbGxQZW5kaW5nQXJ0aWZhY3RzKG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIHJldHVybiBhd2FpdCByZWplY3RBbGxQZW5kaW5nQXJ0aWZhY3RzT3AoXG4gICAgICBjcmVhdGVLeXNlbHlJbmJveE9wc1N0b3JlKGRiKSxcbiAgICAgIG1haWxib3hJZCxcbiAgICApXG4gIH0sXG5cbiAgYXN5bmMgdXBkYXRlQXJ0aWZhY3RTdGF0dXMoXG4gICAgaW5wdXQ6IFVwZGF0ZUFydGlmYWN0U3RhdHVzSW5wdXQsXG4gICk6IFByb21pc2U8RXh0cmFjdGlvbkFydGlmYWN0PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgc3RhdHVzID0gdmFsaWRhdGVBcnRpZmFjdFN0YXR1cyhpbnB1dC5zdGF0dXMpXG4gICAgY29uc3Qgb3duZWQgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC5pbm5lckpvaW4oJ21lc3NhZ2VzJywgJ21lc3NhZ2VzLmlkJywgJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLm1lc3NhZ2VfaWQnKVxuICAgICAgLmlubmVySm9pbignbWFpbGJveGVzJywgJ21haWxib3hlcy5pZCcsICdtZXNzYWdlcy5tYWlsYm94X2lkJylcbiAgICAgIC5zZWxlY3RBbGwoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgIC53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuaWQnLCAnPScsIGlucHV0LmFydGlmYWN0SWQpXG4gICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIW93bmVkKSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignYXJ0aWZhY3Qgbm90IGZvdW5kJylcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgaWYgKHN0YXR1cyA9PT0gJ3JlamVjdGVkJykge1xuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXMsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gICAgfVxuXG4gICAgaWYgKHN0YXR1cyA9PT0gJ2FjY2VwdGVkJykge1xuICAgICAgaWYgKG93bmVkLmtpbmQgPT09IFNQRU5ESU5HX0NBTkRJREFURV9LSU5EKSB7XG4gICAgICAgIGlmIChvd25lZC5wdWJsaXNoZWRfZXhwZW5zZV9pZCAhPSBudWxsKSB7XG4gICAgICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAgICAgLnNldCh7IHN0YXR1czogJ2FjY2VwdGVkJywgdXBkYXRlZF9hdDogbm93IH0pXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjYXRlZ29yeUlkID0gdmFsaWRhdGVDYXRlZ29yeUlkKGlucHV0LmNhdGVnb3J5SWQpXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGFzU3BlbmRpbmdQYXlsb2FkKG93bmVkLnBheWxvYWQpXG4gICAgICAgIGlmICghY2FuZGlkYXRlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2FydGlmYWN0IHBheWxvYWQgaXMgbm90IGEgc3BlbmRpbmcgY2FuZGlkYXRlJylcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcHVibGlzaGVkID0gYXdhaXQgcHVibGlzaEV4cGVuc2VUb1NwZW5kbWFuYWdlcihcbiAgICAgICAgICAgIGNhbmRpZGF0ZSxcbiAgICAgICAgICAgIGNhdGVnb3J5SWQsXG4gICAgICAgICAgICByZXF1aXJlQXV0aG9yaXphdGlvbkhlYWRlcigpLFxuICAgICAgICAgIClcbiAgICAgICAgICBjb25zdCBuZXh0UGF5bG9hZCA9IHtcbiAgICAgICAgICAgIC4uLmNhbmRpZGF0ZSxcbiAgICAgICAgICAgIHB1Ymxpc2hlZEV4cGVuc2VJZDogcHVibGlzaGVkLmV4cGVuc2VJZCxcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAgICAgLnNldCh7XG4gICAgICAgICAgICAgIHN0YXR1czogJ2FjY2VwdGVkJyxcbiAgICAgICAgICAgICAgcHVibGlzaGVkX2V4cGVuc2VfaWQ6IHB1Ymxpc2hlZC5leHBlbnNlSWQsXG4gICAgICAgICAgICAgIHBheWxvYWQ6IG5leHRQYXlsb2FkLFxuICAgICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgICAgICByZXR1cm4gbWFwQXJ0aWZhY3Qocm93KVxuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgU3BlbmRtYW5hZ2VyU2lua0Vycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgICAgICAgICAgYGZhaWxlZCB0byBwdWJsaXNoIGV4cGVuc2U6ICR7ZXJyLm1lc3NhZ2V9YCxcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgZXJyXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXM6ICdhY2NlcHRlZCcsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gICAgfVxuXG4gICAgLy8gcGVuZGluZyAvIG90aGVyXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgLnNldCh7IHN0YXR1cywgdXBkYXRlZF9hdDogbm93IH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gIH0sXG5cbiAgYXN5bmMgY29ubmVjdEdtYWlsKGlucHV0OiBDb25uZWN0R21haWxJbnB1dCk6IFByb21pc2U8TWFpbGJveD4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG1haWxib3ggPSBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQubWFpbGJveElkKVxuICAgIGlmIChtYWlsYm94LnByb3ZpZGVyICE9PSAnZ21haWwnKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWFpbGJveCBwcm92aWRlciBpcyBub3QgZ21haWwnKVxuICAgIH1cbiAgICBpZiAoIWlucHV0LmFjY2Vzc1Rva2VuLnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2FjY2Vzc1Rva2VuIGlzIHJlcXVpcmVkJylcbiAgICB9XG5cbiAgICBjb25zdCBhY2Nlc3NUb2tlbiA9IGlucHV0LmFjY2Vzc1Rva2VuLnRyaW0oKVxuICAgIGNvbnN0IHRva2VucyA9IHtcbiAgICAgIGFjY2Vzc1Rva2VuLFxuICAgICAgcmVmcmVzaFRva2VuOiBpbnB1dC5yZWZyZXNoVG9rZW4gPz8gbnVsbCxcbiAgICAgIGV4cGlyZXNBdE1zOiBpbnB1dC5leHBpcmVzQXRNcyA/PyBudWxsLFxuICAgIH1cbiAgICBjb25zdCBlbWFpbCA9IGF3YWl0IGZldGNoR21haWxFbWFpbEFkZHJlc3MoeyBhY2Nlc3NUb2tlbiB9KVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ21haWxib3hlcycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgb2F1dGhfdG9rZW5zX2pzb246IEpTT04uc3RyaW5naWZ5KHRva2VucyksXG4gICAgICAgIC4uLihlbWFpbCA/IHsgbGFiZWw6IGVtYWlsIH0gOiB7fSksXG4gICAgICAgIHN5bmNfcmVxdWVzdGVkOiB0cnVlLFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgbWFpbGJveC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gbWFwTWFpbGJveChyb3cpXG4gIH0sXG5cbiAgYXN5bmMgc3RhcnRHbWFpbE9BdXRoKFxuICAgIGlucHV0OiBTdGFydEdtYWlsT0F1dGhJbnB1dCxcbiAgKTogUHJvbWlzZTxTdGFydEdtYWlsT0F1dGhQYXlsb2FkPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgbWFpbGJveCA9IGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgaWYgKG1haWxib3gucHJvdmlkZXIgIT09ICdnbWFpbCcpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtYWlsYm94IHByb3ZpZGVyIGlzIG5vdCBnbWFpbCcpXG4gICAgfVxuXG4gICAgY29uc3QgcmV0dXJuVG8gPSBpbnB1dC5yZXR1cm5Ubz8udHJpbSgpID8/ICcnXG4gICAgaWYgKCFyZXR1cm5Ubykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3JldHVyblRvIGlzIHJlcXVpcmVkJylcbiAgICB9XG5cbiAgICBsZXQgY29uZmlnXG4gICAgdHJ5IHtcbiAgICAgIGNvbmZpZyA9IGxvYWRHbWFpbE9BdXRoQ29uZmlnKClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBHbWFpbE9BdXRoRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoZXJyLm1lc3NhZ2UpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG5cbiAgICBpZiAoIWlzUmV0dXJuVG9BbGxvd2VkKHJldHVyblRvLCBjb25maWcucmV0dXJuVG9BbGxvd2xpc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcigncmV0dXJuVG8gaXMgbm90IGFsbG93ZWQnKVxuICAgIH1cblxuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgc2lnbk9BdXRoU3RhdGUoXG4gICAgICB7IHVzZXJJZCwgbWFpbGJveElkOiBtYWlsYm94LmlkLCByZXR1cm5UbyB9LFxuICAgICAgY29uZmlnLmNsaWVudFNlY3JldCxcbiAgICApXG4gICAgY29uc3QgYXV0aG9yaXphdGlvblVybCA9IGJ1aWxkR29vZ2xlQXV0aG9yaXplVXJsKHtcbiAgICAgIGNsaWVudElkOiBjb25maWcuY2xpZW50SWQsXG4gICAgICByZWRpcmVjdFVyaTogY29uZmlnLnJlZGlyZWN0VXJpLFxuICAgICAgc3RhdGUsXG4gICAgfSlcbiAgICByZXR1cm4geyBhdXRob3JpemF0aW9uVXJsIH1cbiAgfSxcblxuICBhc3luYyBjcmVhdGVQYXJzaW5nVGVtcGxhdGUoXG4gICAgaW5wdXQ6IENyZWF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxuICApOiBQcm9taXNlPFBhcnNpbmdUZW1wbGF0ZT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgY29uc3Qga2luZCA9IHZhbGlkYXRlVGVtcGxhdGVLaW5kKGlucHV0LmtpbmQgPz8gJ2FwcHJvdmUnKVxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZVRlbXBsYXRlTmFtZShpbnB1dC5uYW1lKVxuICAgIGNvbnN0IG1hdGNoRnJvbVBhdHRlcm4gPSB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4oaW5wdXQubWF0Y2hGcm9tUGF0dGVybilcbiAgICBjb25zdCBtYXRjaFN1YmplY3RSZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGlucHV0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgIGxldCBleHRyYWN0b3JzOiBSZXR1cm5UeXBlPHR5cGVvZiBwYXJzZUV4dHJhY3RvcnNKc29uPiB8IG51bGwgPSBudWxsXG4gICAgaWYgKGtpbmQgPT09ICdhcHByb3ZlJykge1xuICAgICAgaWYgKGlucHV0LmV4dHJhY3RvcnNKc29uID09IG51bGwgfHwgIWlucHV0LmV4dHJhY3RvcnNKc29uLnRyaW0oKSkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgICAgICAnZXh0cmFjdG9yc0pzb24gaXMgcmVxdWlyZWQgZm9yIGFwcHJvdmUgdGVtcGxhdGVzJyxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgZXh0cmFjdG9ycyA9IHBhcnNlRXh0cmFjdG9yc0pzb24oaW5wdXQuZXh0cmFjdG9yc0pzb24pXG4gICAgfVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgaWYgKGlucHV0LnNvdXJjZU1lc3NhZ2VJZCAhPSBudWxsKSB7XG4gICAgICBjb25zdCBtc2cgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgICAuc2VsZWN0KCdtZXNzYWdlcy5pZCcpXG4gICAgICAgIC53aGVyZSgnbWVzc2FnZXMuaWQnLCAnPScsIGlucHV0LnNvdXJjZU1lc3NhZ2VJZClcbiAgICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAud2hlcmUoJ21lc3NhZ2VzLm1haWxib3hfaWQnLCAnPScsIGlucHV0Lm1haWxib3hJZClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgaWYgKCFtc2cpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdzb3VyY2UgbWVzc2FnZSBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIG1haWxib3hfaWQ6IGlucHV0Lm1haWxib3hJZCxcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBraW5kLFxuICAgICAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIG1hdGNoX2Zyb21fcGF0dGVybjogbWF0Y2hGcm9tUGF0dGVybixcbiAgICAgICAgbWF0Y2hfc3ViamVjdF9yZWdleDogbWF0Y2hTdWJqZWN0UmVnZXgsXG4gICAgICAgIGV4dHJhY3RvcnMsXG4gICAgICAgIHNvdXJjZV9tZXNzYWdlX2lkOiBpbnB1dC5zb3VyY2VNZXNzYWdlSWQgPz8gbnVsbCxcbiAgICAgICAgdmVyc2lvbjogMSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgYXdhaXQgYXBwbHlUZW1wbGF0ZXNUb01haWxib3goXG4gICAgICBjcmVhdGVLeXNlbHlBcHBseVRlbXBsYXRlc1N0b3JlKGRiKSxcbiAgICAgIGlucHV0Lm1haWxib3hJZCxcbiAgICAgIG5vdyxcbiAgICApXG4gICAgcmV0dXJuIG1hcFBhcnNpbmdUZW1wbGF0ZShyb3cpXG4gIH0sXG5cbiAgYXN5bmMgdXBkYXRlUGFyc2luZ1RlbXBsYXRlKFxuICAgIGlucHV0OiBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgKTogUHJvbWlzZTxQYXJzaW5nVGVtcGxhdGU+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghZXhpc3RpbmcpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCd0ZW1wbGF0ZSBub3QgZm91bmQnKVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3QgcGF0Y2g6IHtcbiAgICAgIG5hbWU/OiBzdHJpbmdcbiAgICAgIG1hdGNoX2Zyb21fcGF0dGVybj86IHN0cmluZ1xuICAgICAgbWF0Y2hfc3ViamVjdF9yZWdleD86IHN0cmluZyB8IG51bGxcbiAgICAgIGV4dHJhY3RvcnM/OiBSZXR1cm5UeXBlPHR5cGVvZiBwYXJzZUV4dHJhY3RvcnNKc29uPiB8IG51bGxcbiAgICAgIGVuYWJsZWQ/OiBib29sZWFuXG4gICAgICB2ZXJzaW9uOiBudW1iZXJcbiAgICAgIHVwZGF0ZWRfYXQ6IHN0cmluZ1xuICAgIH0gPSB7XG4gICAgICB2ZXJzaW9uOiBleGlzdGluZy52ZXJzaW9uICsgMSxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICB9XG5cbiAgICBpZiAoaW5wdXQubmFtZSAhPSBudWxsKSBwYXRjaC5uYW1lID0gdmFsaWRhdGVUZW1wbGF0ZU5hbWUoaW5wdXQubmFtZSlcbiAgICBpZiAoaW5wdXQubWF0Y2hGcm9tUGF0dGVybiAhPSBudWxsKSB7XG4gICAgICBwYXRjaC5tYXRjaF9mcm9tX3BhdHRlcm4gPSB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4oaW5wdXQubWF0Y2hGcm9tUGF0dGVybilcbiAgICB9XG4gICAgaWYgKGlucHV0Lm1hdGNoU3ViamVjdFJlZ2V4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdGNoLm1hdGNoX3N1YmplY3RfcmVnZXggPSB2YWxpZGF0ZVN1YmplY3RSZWdleChpbnB1dC5tYXRjaFN1YmplY3RSZWdleClcbiAgICB9XG4gICAgaWYgKGlucHV0LmV4dHJhY3RvcnNKc29uICE9IG51bGwpIHtcbiAgICAgIGlmIChleGlzdGluZy5raW5kID09PSAncmVqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgICAgICAncmVqZWN0IHRlbXBsYXRlcyBjYW5ub3QgaGF2ZSBleHRyYWN0b3JzJyxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgcGF0Y2guZXh0cmFjdG9ycyA9IHBhcnNlRXh0cmFjdG9yc0pzb24oaW5wdXQuZXh0cmFjdG9yc0pzb24pXG4gICAgfVxuICAgIGlmIChpbnB1dC5lbmFibGVkICE9IG51bGwpIHBhdGNoLmVuYWJsZWQgPSBpbnB1dC5lbmFibGVkXG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAuc2V0KHBhdGNoKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBhd2FpdCBhcHBseVRlbXBsYXRlc1RvTWFpbGJveChcbiAgICAgIGNyZWF0ZUt5c2VseUFwcGx5VGVtcGxhdGVzU3RvcmUoZGIpLFxuICAgICAgZXhpc3RpbmcubWFpbGJveF9pZCxcbiAgICAgIG5vdyxcbiAgICApXG4gICAgcmV0dXJuIG1hcFBhcnNpbmdUZW1wbGF0ZShyb3cpXG4gIH0sXG5cbiAgYXN5bmMgZGVsZXRlUGFyc2luZ1RlbXBsYXRlKGlkOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgcmV0dXJuIE51bWJlcihyZXN1bHQubnVtRGVsZXRlZFJvd3MgPz8gMCkgPiAwXG4gIH0sXG5cbiAgYXN5bmMgZ2VuZXJhdGVQYXJzaW5nVGVtcGxhdGUoXG4gICAgaW5wdXQ6IEdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXQsXG4gICk6IFByb21pc2U8R2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVQYXlsb2FkPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZGVjaXNpb24gPSB2YWxpZGF0ZVRlbXBsYXRlS2luZChpbnB1dC5kZWNpc2lvbilcbiAgICBjb25zdCBtZXNzYWdlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdtZXNzYWdlcycpXG4gICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgLnNlbGVjdChbXG4gICAgICAgICdtZXNzYWdlcy5pZCcsXG4gICAgICAgICdtZXNzYWdlcy5tYWlsYm94X2lkJyxcbiAgICAgICAgJ21lc3NhZ2VzLmZyb21fYWRkcmVzcycsXG4gICAgICAgICdtZXNzYWdlcy5zdWJqZWN0JyxcbiAgICAgICAgJ21lc3NhZ2VzLnRleHRfYm9keScsXG4gICAgICBdKVxuICAgICAgLndoZXJlKCdtZXNzYWdlcy5pZCcsICc9JywgaW5wdXQubWVzc2FnZUlkKVxuICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFtZXNzYWdlKSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWVzc2FnZSBub3QgZm91bmQnKVxuICAgIGlmICghbWVzc2FnZS50ZXh0X2JvZHk/LnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICAgICdtZXNzYWdlIGhhcyBubyBzdG9yZWQgYm9keTsgcmUtc3luYyBhZnRlciB1cGdyYWRpbmcgbWFpbGJveCcsXG4gICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgZ2VuZXJpY0ZhaWxNZXNzYWdlID0gJ1RlbXBsYXRlIGdlbmVyYXRpb24gZmFpbGVkLiBQbGVhc2UgdHJ5IGFnYWluLidcbiAgICBjb25zdCBmYWlsVGVtcGxhdGVHZW5lcmF0aW9uID0gKHJlYXNvbjogc3RyaW5nLCBkZXRhaWxzPzogdW5rbm93bik6IG5ldmVyID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICdbbWFpbGJveC1hcGldIHRlbXBsYXRlIGdlbmVyYXRpb24gZmFpbGVkOicsXG4gICAgICAgIHJlYXNvbixcbiAgICAgICAgZGV0YWlscyA/PyAnJyxcbiAgICAgIClcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKGdlbmVyaWNGYWlsTWVzc2FnZSlcbiAgICB9XG5cbiAgICBjb25zdCBhaUlucHV0ID0ge1xuICAgICAgZnJvbTogbWVzc2FnZS5mcm9tX2FkZHJlc3MsXG4gICAgICBzdWJqZWN0OiBtZXNzYWdlLnN1YmplY3QsXG4gICAgICB0ZXh0Qm9keTogbWVzc2FnZS50ZXh0X2JvZHksXG4gICAgICBoaW50czogaW5wdXQuaGludHMsXG4gICAgfVxuXG4gICAgbGV0IG1hdGNoRnJvbVBhdHRlcm46IHN0cmluZ1xuICAgIGxldCBtYXRjaFN1YmplY3RSZWdleDogc3RyaW5nIHwgbnVsbFxuICAgIGxldCBleHRyYWN0b3JzOlxuICAgICAgfCBOb25OdWxsYWJsZTxSZXR1cm5UeXBlPHR5cGVvZiBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzPj5cbiAgICAgIHwgbnVsbCA9IG51bGxcbiAgICBsZXQgbmFtZVN1Z2dlc3Rpb246IHN0cmluZ1xuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChkZWNpc2lvbiA9PT0gJ3JlamVjdCcpIHtcbiAgICAgICAgY29uc3QgYWlPdXQgPSBhd2FpdCBnZW5lcmF0ZUVtYWlsUmVqZWN0VGVtcGxhdGUoYWlJbnB1dClcbiAgICAgICAgbWF0Y2hGcm9tUGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihhaU91dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgICAgICBtYXRjaFN1YmplY3RSZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGFpT3V0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgICAgICBuYW1lU3VnZ2VzdGlvbiA9IGFpT3V0Lm5hbWVTdWdnZXN0aW9uIHx8ICdJZ25vcmVkIGVtYWlsIHR5cGUnXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBhaU91dCA9IGF3YWl0IGdlbmVyYXRlRW1haWxTcGVuZFRlbXBsYXRlKGFpSW5wdXQpXG4gICAgICAgIG1hdGNoRnJvbVBhdHRlcm4gPSB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4oYWlPdXQubWF0Y2hGcm9tUGF0dGVybilcbiAgICAgICAgbWF0Y2hTdWJqZWN0UmVnZXggPSB2YWxpZGF0ZVN1YmplY3RSZWdleChhaU91dC5tYXRjaFN1YmplY3RSZWdleClcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyhhaU91dC5leHRyYWN0b3JzKVxuICAgICAgICBpZiAoIXBhcnNlZCkge1xuICAgICAgICAgIGZhaWxUZW1wbGF0ZUdlbmVyYXRpb24oJ0FJIHJldHVybmVkIGludmFsaWQgZXh0cmFjdG9ycycsIHtcbiAgICAgICAgICAgIG1lc3NhZ2VJZDogbWVzc2FnZS5pZCxcbiAgICAgICAgICAgIGV4dHJhY3RvcnM6IGFpT3V0LmV4dHJhY3RvcnMsXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICBleHRyYWN0b3JzID0gcGFyc2VkXG4gICAgICAgIG5hbWVTdWdnZXN0aW9uID0gYWlPdXQubmFtZVN1Z2dlc3Rpb24gfHwgJ1NwZW5kaW5nIHRlbXBsYXRlJ1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKFxuICAgICAgICBlcnIgaW5zdGFuY2VvZiBJbnZhbGlkTWFpbGJveEVycm9yICYmXG4gICAgICAgIGVyci5tZXNzYWdlID09PSBnZW5lcmljRmFpbE1lc3NhZ2VcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBlcnJcbiAgICAgIH1cbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBBaUNsaWVudEVycm9yIHx8IGVyciBpbnN0YW5jZW9mIEludmFsaWRNYWlsYm94RXJyb3IpIHtcbiAgICAgICAgZmFpbFRlbXBsYXRlR2VuZXJhdGlvbihlcnIubWVzc2FnZSwgeyBtZXNzYWdlSWQ6IG1lc3NhZ2UuaWQgfSlcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cblxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZVRlbXBsYXRlTmFtZShcbiAgICAgIGlucHV0Lm5hbWU/LnRyaW0oKSB8fCBuYW1lU3VnZ2VzdGlvbixcbiAgICApXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICBtYWlsYm94X2lkOiBtZXNzYWdlLm1haWxib3hfaWQsXG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAga2luZDogZGVjaXNpb24sXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIG1hdGNoX2Zyb21fcGF0dGVybjogbWF0Y2hGcm9tUGF0dGVybixcbiAgICAgICAgbWF0Y2hfc3ViamVjdF9yZWdleDogbWF0Y2hTdWJqZWN0UmVnZXgsXG4gICAgICAgIGV4dHJhY3RvcnMsXG4gICAgICAgIHNvdXJjZV9tZXNzYWdlX2lkOiBtZXNzYWdlLmlkLFxuICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0pXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBhd2FpdCBhcHBseVRlbXBsYXRlc1RvTWFpbGJveChcbiAgICAgIGNyZWF0ZUt5c2VseUFwcGx5VGVtcGxhdGVzU3RvcmUoZGIpLFxuICAgICAgbWVzc2FnZS5tYWlsYm94X2lkLFxuICAgICAgbm93LFxuICAgIClcblxuICAgIGNvbnN0IHJlZXZhbHVhdGVkQ291bnQgPSBhd2FpdCByZWV2YWx1YXRlUGVuZGluZ1dpdGhUZW1wbGF0ZShcbiAgICAgIGNyZWF0ZUt5c2VseVRlbXBsYXRlUmVldmFsdWF0ZVN0b3JlKGRiKSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IHJvdy5pZCxcbiAgICAgICAgbWFpbGJveF9pZDogcm93Lm1haWxib3hfaWQsXG4gICAgICAgIGtpbmQ6IHJvdy5raW5kLFxuICAgICAgICBlbmFibGVkOiByb3cuZW5hYmxlZCxcbiAgICAgICAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiByb3cubWF0Y2hfZnJvbV9wYXR0ZXJuLFxuICAgICAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiByb3cubWF0Y2hfc3ViamVjdF9yZWdleCxcbiAgICAgICAgZXh0cmFjdG9yczogcm93LmV4dHJhY3RvcnMsXG4gICAgICB9LFxuICAgICAgbm93LFxuICAgIClcblxuICAgIHJldHVybiB7XG4gICAgICB0ZW1wbGF0ZTogbWFwUGFyc2luZ1RlbXBsYXRlKHJvdyksXG4gICAgICByZWV2YWx1YXRlZENvdW50LFxuICAgIH1cbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IHJlc29sdmVycyA9IHsgUXVlcnksIE11dGF0aW9uIH1cbiIsICIvKiogTm9ybWFsaXplZCBlbWFpbCB1c2VkIGJ5IHRoZSBleHRyYWN0IHBpcGVsaW5lLiAqL1xuZXhwb3J0IGludGVyZmFjZSBFbWFpbE1lc3NhZ2Uge1xuICAvKiogUHJvdmlkZXItc3BlY2lmaWMgaWQgKEdtYWlsIG1lc3NhZ2UgaWQsIGZpeHR1cmUgaWQsIGV0Yy4pLiAqL1xuICBpZDogc3RyaW5nXG4gIC8qKiBSRkMgNTMyMiBNZXNzYWdlLUlEIHdoZW4gYXZhaWxhYmxlOyB1c2VkIGZvciBpZGVtcG90ZW5jeS4gKi9cbiAgcmZjTWVzc2FnZUlkOiBzdHJpbmdcbiAgZnJvbTogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZEF0OiBEYXRlXG4gIHRleHRCb2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxCb2R5OiBzdHJpbmcgfCBudWxsXG59XG5cbi8qKiBPcGFxdWUgc3luYyBjdXJzb3IgcmV0dXJuZWQgYnkgYSBNYWlsYm94UHJvdmlkZXIuICovXG5leHBvcnQgdHlwZSBTeW5jQ3Vyc29yID0gc3RyaW5nIHwgbnVsbFxuXG5leHBvcnQgaW50ZXJmYWNlIExpc3RNZXNzYWdlc1Jlc3VsdCB7XG4gIG1lc3NhZ2VzOiBFbWFpbE1lc3NhZ2VbXVxuICAvKiogQ3Vyc29yIHRvIHBlcnNpc3QgYWZ0ZXIgYSBzdWNjZXNzZnVsIHN5bmMuICovXG4gIG5leHRDdXJzb3I6IFN5bmNDdXJzb3Jcbn1cblxuZXhwb3J0IHR5cGUgQXJ0aWZhY3RTdGF0dXMgPSAncGVuZGluZycgfCAnYWNjZXB0ZWQnIHwgJ3JlamVjdGVkJ1xuXG4vKiogRG9tYWluLWFnbm9zdGljIGV4dHJhY3Rpb24gcmVzdWx0IChub3QgYSBzcGVuZG1hbmFnZXIgZXhwZW5zZSkuICovXG5leHBvcnQgaW50ZXJmYWNlIEV4dHJhY3Rpb25BcnRpZmFjdCB7XG4gIGtpbmQ6IHN0cmluZ1xuICBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBjb25maWRlbmNlOiBudW1iZXJcbn1cblxuLyoqIFBheWxvYWQgc2hhcGUgZm9yIFNwZW5kaW5nRXh0cmFjdG9yIChga2luZDogXCJzcGVuZGluZy5jYW5kaWRhdGVcImApLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQge1xuICBhbW91bnRDZW50czogbnVtYmVyXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgc3BlbnRPbjogc3RyaW5nXG4gIG1lcmNoYW50OiBzdHJpbmcgfCBudWxsXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgc291cmNlU3ViamVjdDogc3RyaW5nXG4gIHNvdXJjZUZyb206IHN0cmluZ1xuICAvKiogU2V0IHdoZW4gcHVibGlzaGVkIHRvIHNwZW5kbWFuYWdlci4gKi9cbiAgcHVibGlzaGVkRXhwZW5zZUlkPzogbnVtYmVyIHwgbnVsbFxuICAvKiogUGFyc2luZyB0ZW1wbGF0ZSBpZCB3aGVuIGV4dHJhY3RlZCB2aWEgYSB0ZW1wbGF0ZS4gKi9cbiAgdGVtcGxhdGVJZD86IG51bWJlciB8IG51bGxcbn1cblxuZXhwb3J0IGNvbnN0IFNQRU5ESU5HX0NBTkRJREFURV9LSU5EID0gJ3NwZW5kaW5nLmNhbmRpZGF0ZScgYXMgY29uc3RcblxuLyoqIERldGVybWluaXN0aWMgZmllbGQgZXh0cmFjdG9yIHVzZWQgYnkgcGFyc2luZyB0ZW1wbGF0ZXMuICovXG5leHBvcnQgdHlwZSBGaWVsZEV4dHJhY3RvciA9XG4gIHwge1xuICAgIHNvdXJjZTogJ3N1YmplY3QnIHwgJ3RleHQnIHwgJ2h0bWxfdGV4dCdcbiAgICByZWdleDogc3RyaW5nXG4gICAgZ3JvdXA6IG51bWJlclxuICB9XG4gIHwgeyBzb3VyY2U6ICdmcm9tX2RvbWFpbicgfVxuICB8IHsgc291cmNlOiAnY29uc3RhbnQnOyB2YWx1ZTogc3RyaW5nIH1cblxuLyoqXG4gKiBMb2NhbGUtYWdub3N0aWMgZGF0ZSBleHRyYWN0b3I6IGNhcHR1cmUgbnVtZXJpYyB5ZWFyL21vbnRoL2RheSBncm91cHNcbiAqIGFuZCBjb21wb3NlIFlZWVktTU0tREQgYXQgZXh0cmFjdCB0aW1lLlxuICovXG5leHBvcnQgdHlwZSBEYXRlUGFydHNFeHRyYWN0b3IgPSB7XG4gIHNvdXJjZTogJ3N1YmplY3QnIHwgJ3RleHQnIHwgJ2h0bWxfdGV4dCdcbiAgcmVnZXg6IHN0cmluZ1xuICB5ZWFyR3JvdXA6IG51bWJlclxuICBtb250aEdyb3VwOiBudW1iZXJcbiAgZGF5R3JvdXA6IG51bWJlclxufVxuXG4vKipcbiAqIERldGVjdCBpbmJvdW5kIHZzIG91dGJvdW5kIG1vbmV5IGZsb3cuIFdoZW4gdGhlIGNhcHR1cmUgbWF0Y2hlcyBhblxuICogaW5ib3VuZCBrZXl3b3JkLCBUZW1wbGF0ZVNwZW5kaW5nRXh0cmFjdG9yIHNraXBzIHRoZSBtZXNzYWdlLlxuICovXG5leHBvcnQgdHlwZSBEaXJlY3Rpb25FeHRyYWN0b3IgPSB7XG4gIHNvdXJjZTogJ3N1YmplY3QnIHwgJ3RleHQnIHwgJ2h0bWxfdGV4dCdcbiAgcmVnZXg6IHN0cmluZ1xuICBncm91cDogbnVtYmVyXG4gIGluYm91bmRNYXRjaGVzOiBzdHJpbmdbXVxuICBvdXRib3VuZE1hdGNoZXM6IHN0cmluZ1tdXG59XG5cbi8qKiBGaWVsZCBtYXAgc3RvcmVkIGluIGBwYXJzaW5nX3RlbXBsYXRlcy5leHRyYWN0b3JzYCBKU09OQi4gKi9cbmV4cG9ydCB0eXBlIFNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzID0ge1xuICBhbW91bnQ6IEZpZWxkRXh0cmFjdG9yXG4gIGN1cnJlbmN5PzogRmllbGRFeHRyYWN0b3IgfCBudWxsXG4gIC8qKiBMZWdhY3kgc2luZ2xlLWdyb3VwIEZpZWxkRXh0cmFjdG9yIG9yIHByZWZlcnJlZCBkYXRlLXBhcnRzIHNoYXBlLiAqL1xuICBzcGVudE9uPzogRmllbGRFeHRyYWN0b3IgfCBEYXRlUGFydHNFeHRyYWN0b3IgfCBudWxsXG4gIG1lcmNoYW50PzogRmllbGRFeHRyYWN0b3IgfCBudWxsXG4gIG5vdGU/OiBGaWVsZEV4dHJhY3RvciB8IG51bGxcbiAgZGlyZWN0aW9uPzogRGlyZWN0aW9uRXh0cmFjdG9yIHwgbnVsbFxufVxuXG4vKiogUnVudGltZSBkZWZpbml0aW9uIGZvciBhIG1haWxib3ggcGFyc2luZyB0ZW1wbGF0ZS4gKi9cbmV4cG9ydCB0eXBlIFNwZW5kUGFyc2luZ1RlbXBsYXRlID0ge1xuICBpZDogbnVtYmVyXG4gIG1hdGNoRnJvbVBhdHRlcm46IHN0cmluZ1xuICBtYXRjaFN1YmplY3RSZWdleD86IHN0cmluZyB8IG51bGxcbiAgZXh0cmFjdG9yczogU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnNcbiAgZW5hYmxlZD86IGJvb2xlYW5cbn1cbiIsICIvKipcbiAqIE9wdGlvbmFsIGFsbG93bGlzdCBvZiBzZW5kZXIgZG9tYWlucyBvciBmdWxsIGVtYWlsIGFkZHJlc3Nlcy5cbiAqIEVtcHR5IC8gdW5kZWZpbmVkIGxpc3QgPSByZWplY3QgYWxsIChmaWx0ZXJzIGFyZSByZXF1aXJlZCBmb3Igc3luYykuXG4gKlxuICogUGF0dGVybiBncmFtbWFyOlxuICogLSBgdXNlckBzaG9wLmNvbWAgXHUyMDE0IGV4YWN0IGFkZHJlc3NcbiAqIC0gYHNob3AuY29tYCBcdTIwMTQgYXBleCArIHN1YmRvbWFpbnNcbiAqIC0gYCouc2hvcC5jb21gIFx1MjAxNCBzdWJkb21haW5zIG9ubHkgKG5vdCBhcGV4KTsgbGVnYWN5IC8gdGVtcGxhdGUgcGF0dGVybnNcbiAqIC0gYCpAc2hvcC5jb21gIFx1MjAxNCBhbnkgbG9jYWwtcGFydCBhdCB0aGF0IGV4YWN0IGRvbWFpblxuICogLSBgKkAqLnNob3AuY29tYCBcdTIwMTQgYW55IGxvY2FsLXBhcnQgYXQgYSBzdWJkb21haW4gb2Ygc2hvcC5jb21cbiAqXG4gKiBEb21haW4gZmlsdGVycyBubyBsb25nZXIgYWNjZXB0IHdpbGRjYXJkcyBhdCB0aGUgQVBJOyBtYXRjaGluZyBzdGlsbFxuICogc3VwcG9ydHMgdGhlbSBmb3IgcGFyc2luZy10ZW1wbGF0ZSBgbWF0Y2hGcm9tUGF0dGVybmAgYW5kIGxlZ2FjeSByb3dzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWF0Y2hlc0RvbWFpbkZpbHRlcihcbiAgZnJvbUFkZHJlc3M6IHN0cmluZyxcbiAgcGF0dGVybnM6IHJlYWRvbmx5IHN0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IGJvb2xlYW4ge1xuICBpZiAoIXBhdHRlcm5zIHx8IHBhdHRlcm5zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgY29uc3Qgbm9ybWFsaXplZEZyb20gPSBub3JtYWxpemVGcm9tKGZyb21BZGRyZXNzKVxuICBpZiAoIW5vcm1hbGl6ZWRGcm9tKSByZXR1cm4gZmFsc2VcblxuICBmb3IgKGNvbnN0IHJhdyBvZiBwYXR0ZXJucykge1xuICAgIGNvbnN0IHBhdHRlcm4gPSByYXcudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICBpZiAoIXBhdHRlcm4pIGNvbnRpbnVlXG4gICAgaWYgKG1hdGNoZXNTaW5nbGVQYXR0ZXJuKG5vcm1hbGl6ZWRGcm9tLCBwYXR0ZXJuKSkgcmV0dXJuIHRydWVcbiAgfVxuICByZXR1cm4gZmFsc2Vcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbHRlck1lc3NhZ2VzQnlEb21haW48VCBleHRlbmRzIHsgZnJvbTogc3RyaW5nIH0+KFxuICBtZXNzYWdlczogcmVhZG9ubHkgVFtdLFxuICBwYXR0ZXJuczogcmVhZG9ubHkgc3RyaW5nW10gfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogVFtdIHtcbiAgaWYgKCFwYXR0ZXJucyB8fCBwYXR0ZXJucy5sZW5ndGggPT09IDApIHJldHVybiBbXVxuICByZXR1cm4gbWVzc2FnZXMuZmlsdGVyKChtKSA9PiBtYXRjaGVzRG9tYWluRmlsdGVyKG0uZnJvbSwgcGF0dGVybnMpKVxufVxuXG4vKiogVHJ1ZSB3aGVuIGBmcm9tQWRkcmVzc2AgbWF0Y2hlcyBhIHNpbmdsZSBhbGxvd2xpc3QgLyB0ZW1wbGF0ZSBwYXR0ZXJuLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hdGNoZXNGcm9tUGF0dGVybihcbiAgZnJvbUFkZHJlc3M6IHN0cmluZyxcbiAgcGF0dGVybjogc3RyaW5nLFxuKTogYm9vbGVhbiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRGcm9tID0gbm9ybWFsaXplRnJvbShmcm9tQWRkcmVzcylcbiAgaWYgKCFub3JtYWxpemVkRnJvbSkgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IHAgPSBwYXR0ZXJuLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGlmICghcCkgcmV0dXJuIGZhbHNlXG4gIHJldHVybiBtYXRjaGVzU2luZ2xlUGF0dGVybihub3JtYWxpemVkRnJvbSwgcClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUZyb20oXG4gIGZyb206IHN0cmluZyxcbik6IHsgZW1haWw6IHN0cmluZzsgbG9jYWw6IHN0cmluZzsgZG9tYWluOiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCB0cmltbWVkID0gZnJvbS50cmltKClcbiAgLy8gXCJOYW1lIDx1c2VyQGRvbWFpbi5jb20+XCIgb3IgYmFyZSBcInVzZXJAZG9tYWluLmNvbVwiXG4gIGNvbnN0IGFuZ2xlID0gdHJpbW1lZC5tYXRjaCgvPChbXj5dKyk+LylcbiAgY29uc3QgZW1haWwgPSAoYW5nbGU/LlsxXSA/PyB0cmltbWVkKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICBjb25zdCBhdCA9IGVtYWlsLmxhc3RJbmRleE9mKCdAJylcbiAgaWYgKGF0IDw9IDAgfHwgYXQgPT09IGVtYWlsLmxlbmd0aCAtIDEpIHJldHVybiBudWxsXG4gIGNvbnN0IGxvY2FsID0gZW1haWwuc2xpY2UoMCwgYXQpXG4gIGNvbnN0IGRvbWFpbiA9IGVtYWlsLnNsaWNlKGF0ICsgMSlcbiAgaWYgKCFkb21haW4uaW5jbHVkZXMoJy4nKSkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIHsgZW1haWwsIGxvY2FsLCBkb21haW4gfVxufVxuXG5mdW5jdGlvbiBtYXRjaGVzU2luZ2xlUGF0dGVybihcbiAgZnJvbTogeyBlbWFpbDogc3RyaW5nOyBsb2NhbDogc3RyaW5nOyBkb21haW46IHN0cmluZyB9LFxuICBwYXR0ZXJuOiBzdHJpbmcsXG4pOiBib29sZWFuIHtcbiAgaWYgKHBhdHRlcm4uaW5jbHVkZXMoJ0AnKSkge1xuICAgIHJldHVybiBtYXRjaGVzQWRkcmVzc1BhdHRlcm4oZnJvbSwgcGF0dGVybilcbiAgfVxuICByZXR1cm4gbWF0Y2hlc0RvbWFpblBhdHRlcm4oZnJvbS5kb21haW4sIHBhdHRlcm4pXG59XG5cbmZ1bmN0aW9uIG1hdGNoZXNBZGRyZXNzUGF0dGVybihcbiAgZnJvbTogeyBlbWFpbDogc3RyaW5nOyBsb2NhbDogc3RyaW5nOyBkb21haW46IHN0cmluZyB9LFxuICBwYXR0ZXJuOiBzdHJpbmcsXG4pOiBib29sZWFuIHtcbiAgY29uc3QgYXQgPSBwYXR0ZXJuLmxhc3RJbmRleE9mKCdAJylcbiAgaWYgKGF0IDw9IDAgfHwgYXQgPT09IHBhdHRlcm4ubGVuZ3RoIC0gMSkgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IGxvY2FsUGF0ID0gcGF0dGVybi5zbGljZSgwLCBhdClcbiAgY29uc3QgZG9tYWluUGF0ID0gcGF0dGVybi5zbGljZShhdCArIDEpXG5cbiAgaWYgKGxvY2FsUGF0ICE9PSAnKicgJiYgbG9jYWxQYXQgIT09IGZyb20ubG9jYWwpIHJldHVybiBmYWxzZVxuICAvLyBBZGRyZXNzLWZvcm0gZG9tYWluIHNpZGU6IGV4YWN0IGFwZXgsIG9yIGV4cGxpY2l0ICouc3ViZG9tYWluIHBhdHRlcm4uXG4gIC8vIChgKkBzaG9wLmNvbWAgZG9lcyBub3QgbWF0Y2ggbWFpbC5zaG9wLmNvbTsgdXNlIGAqQCouc2hvcC5jb21gIGZvciB0aGF0LilcbiAgaWYgKGRvbWFpblBhdC5zdGFydHNXaXRoKCcqLicpKSB7XG4gICAgcmV0dXJuIG1hdGNoZXNEb21haW5QYXR0ZXJuKGZyb20uZG9tYWluLCBkb21haW5QYXQpXG4gIH1cbiAgcmV0dXJuIGZyb20uZG9tYWluID09PSBkb21haW5QYXRcbn1cblxuZnVuY3Rpb24gbWF0Y2hlc0RvbWFpblBhdHRlcm4oZG9tYWluOiBzdHJpbmcsIHBhdHRlcm46IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5zdGFydHNXaXRoKCcqLicpKSB7XG4gICAgY29uc3Qgc3VmZml4ID0gcGF0dGVybi5zbGljZSgyKVxuICAgIGlmICghc3VmZml4LmluY2x1ZGVzKCcuJykpIHJldHVybiBmYWxzZVxuICAgIC8vIFN1YmRvbWFpbnMgb25seSBcdTIwMTQgbm90IHRoZSBhcGV4IGl0c2VsZi5cbiAgICByZXR1cm4gZG9tYWluLmVuZHNXaXRoKGAuJHtzdWZmaXh9YClcbiAgfVxuICByZXR1cm4gZG9tYWluID09PSBwYXR0ZXJuIHx8IGRvbWFpbi5lbmRzV2l0aChgLiR7cGF0dGVybn1gKVxufVxuIiwgImltcG9ydCB7IG1hdGNoZXNGcm9tUGF0dGVybiB9IGZyb20gJy4vZG9tYWluX2ZpbHRlci50cydcblxuLyoqIE1pbmltYWwgdGVtcGxhdGUgbWF0Y2ggZmllbGRzIChmcm9tIHBhdHRlcm4gKyBvcHRpb25hbCBzdWJqZWN0IHJlZ2V4KS4gKi9cbmV4cG9ydCB0eXBlIFRlbXBsYXRlTWF0Y2hTcGVjID0ge1xuICBtYXRjaEZyb21QYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hTdWJqZWN0UmVnZXg/OiBzdHJpbmcgfCBudWxsXG4gIC8qKiBXaGVuIGV4cGxpY2l0bHkgZmFsc2UsIG5ldmVyIG1hdGNoZXMuIFVuZGVmaW5lZC90cnVlID0gZW5hYmxlZC4gKi9cbiAgZW5hYmxlZD86IGJvb2xlYW5cbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgbWVzc2FnZSBmaXRzIGEgcGFyc2luZyB0ZW1wbGF0ZSdzIG1hdGNoIHJ1bGVzXG4gKiAoZnJvbSBwYXR0ZXJuICsgb3B0aW9uYWwgc3ViamVjdCByZWdleCkuIERvZXMgbm90IHJlcXVpcmUgYSBzdWNjZXNzZnVsIGV4dHJhY3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXNzYWdlTWF0Y2hlc1RlbXBsYXRlKFxuICBtZXNzYWdlOiB7IGZyb206IHN0cmluZzsgc3ViamVjdDogc3RyaW5nIH0sXG4gIHRlbXBsYXRlOiBUZW1wbGF0ZU1hdGNoU3BlYyxcbik6IGJvb2xlYW4ge1xuICBpZiAodGVtcGxhdGUuZW5hYmxlZCA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuICBpZiAoIW1hdGNoZXNGcm9tUGF0dGVybihtZXNzYWdlLmZyb20sIHRlbXBsYXRlLm1hdGNoRnJvbVBhdHRlcm4pKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgY29uc3Qgc3ViamVjdFJlID0gdGVtcGxhdGUubWF0Y2hTdWJqZWN0UmVnZXg/LnRyaW0oKVxuICBpZiAoc3ViamVjdFJlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGlmICghbmV3IFJlZ0V4cChzdWJqZWN0UmUsICdpJykudGVzdChtZXNzYWdlLnN1YmplY3QpKSByZXR1cm4gZmFsc2VcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKiogVHJ1ZSB3aGVuIGFueSBlbmFibGVkIHRlbXBsYXRlIG1hdGNoZXMgdGhlIG1lc3NhZ2UuICovXG5leHBvcnQgZnVuY3Rpb24gbWVzc2FnZU1hdGNoZXNBbnlUZW1wbGF0ZShcbiAgbWVzc2FnZTogeyBmcm9tOiBzdHJpbmc7IHN1YmplY3Q6IHN0cmluZyB9LFxuICB0ZW1wbGF0ZXM6IHJlYWRvbmx5IFRlbXBsYXRlTWF0Y2hTcGVjW10sXG4pOiBib29sZWFuIHtcbiAgcmV0dXJuIHRlbXBsYXRlcy5zb21lKCh0KSA9PiBtZXNzYWdlTWF0Y2hlc1RlbXBsYXRlKG1lc3NhZ2UsIHQpKVxufVxuIiwgImltcG9ydCB0eXBlIHsgRW1haWxNZXNzYWdlLCBFeHRyYWN0aW9uQXJ0aWZhY3QgfSBmcm9tICcuL3R5cGVzLnRzJ1xuXG4vKipcbiAqIFBsdWdnYWJsZSBleHRyYWN0b3IuIEltcGxlbWVudGF0aW9ucyBtdXN0IG5vdCBkZXBlbmQgb24gc3BlbmRtYW5hZ2VyIHR5cGVzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEV4dHJhY3RvciB7XG4gIHJlYWRvbmx5IGtpbmQ6IHN0cmluZ1xuICBjYW5IYW5kbGUobWVzc2FnZTogRW1haWxNZXNzYWdlKTogYm9vbGVhblxuICBleHRyYWN0KG1lc3NhZ2U6IEVtYWlsTWVzc2FnZSk6IEV4dHJhY3Rpb25BcnRpZmFjdFtdXG59XG5cbmV4cG9ydCB0eXBlIEV4dHJhY3RvclBpcGVsaW5lT3B0aW9ucyA9IHtcbiAgLyoqXG4gICAqIFdoZW4gdHJ1ZSwgc3RvcCBhZnRlciB0aGUgZmlyc3QgZXh0cmFjdG9yIHRoYXQgcmV0dXJucyBhcnRpZmFjdHMuXG4gICAqIFVzZWQgc28gdGVtcGxhdGVzIHdpbiBvdmVyIHRoZSBoZXVyaXN0aWMgZmFsbGJhY2suXG4gICAqL1xuICBmaXJzdE1hdGNoT25seT86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGNsYXNzIEV4dHJhY3RvclBpcGVsaW5lIHtcbiAgcHJpdmF0ZSByZWFkb25seSBmaXJzdE1hdGNoT25seTogYm9vbGVhblxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZXh0cmFjdG9yczogcmVhZG9ubHkgRXh0cmFjdG9yW10sXG4gICAgb3B0aW9ucz86IEV4dHJhY3RvclBpcGVsaW5lT3B0aW9ucyxcbiAgKSB7XG4gICAgdGhpcy5maXJzdE1hdGNoT25seSA9IG9wdGlvbnM/LmZpcnN0TWF0Y2hPbmx5ID8/IGZhbHNlXG4gIH1cblxuICBydW4obWVzc2FnZTogRW1haWxNZXNzYWdlKTogRXh0cmFjdGlvbkFydGlmYWN0W10ge1xuICAgIGNvbnN0IG91dDogRXh0cmFjdGlvbkFydGlmYWN0W10gPSBbXVxuICAgIGZvciAoY29uc3QgZXh0cmFjdG9yIG9mIHRoaXMuZXh0cmFjdG9ycykge1xuICAgICAgaWYgKCFleHRyYWN0b3IuY2FuSGFuZGxlKG1lc3NhZ2UpKSBjb250aW51ZVxuICAgICAgY29uc3QgYXJ0cyA9IGV4dHJhY3Rvci5leHRyYWN0KG1lc3NhZ2UpXG4gICAgICBpZiAoYXJ0cy5sZW5ndGggPT09IDApIGNvbnRpbnVlXG4gICAgICBvdXQucHVzaCguLi5hcnRzKVxuICAgICAgaWYgKHRoaXMuZmlyc3RNYXRjaE9ubHkpIHJldHVybiBvdXRcbiAgICB9XG4gICAgcmV0dXJuIG91dFxuICB9XG59XG4iLCAiLyoqXG4gKiBDb252ZXJ0IGVtYWlsIEhUTUwgKE91dGxvb2svdGFibGUgbGF5b3V0cywgTGF0aW4gZW50aXRpZXMpIGludG8gcmVhZGFibGUgcGxhaW4gdGV4dC5cbiAqIFVzZWQgYXQgc3luYyB0aW1lIGZvciBwZXJzaXN0ZW5jZSBhbmQgYnkgZXh0cmFjdG9ycyBmb3IgdGhlIGBodG1sX3RleHRgIHNvdXJjZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGh0bWxUb1BsYWluVGV4dChodG1sOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcbiAgaWYgKCFodG1sKSByZXR1cm4gJydcblxuICBsZXQgcyA9IGh0bWxcblxuICAvLyBDb21tZW50cyAoaW5jbC4gT3V0bG9vayA8IS0tW2lmIC4uLl0+IFx1MjAyNiA8IVtlbmRpZl0tLT4pXG4gIHMgPSBzLnJlcGxhY2UoLzwhLS1bXFxzXFxTXSo/LS0+L2csICcnKVxuXG4gIC8vIE5vbi1jb250ZW50IGJsb2Nrc1xuICBzID0gcy5yZXBsYWNlKC88c2NyaXB0W1xcc1xcU10qPzxcXC9zY3JpcHQ+L2dpLCAnJylcbiAgcyA9IHMucmVwbGFjZSgvPHN0eWxlW1xcc1xcU10qPzxcXC9zdHlsZT4vZ2ksICcnKVxuICBzID0gcy5yZXBsYWNlKC88aGVhZFtcXHNcXFNdKj88XFwvaGVhZD4vZ2ksICcnKVxuICBzID0gcy5yZXBsYWNlKC88bm9zY3JpcHRbXFxzXFxTXSo/PFxcL25vc2NyaXB0Pi9naSwgJycpXG5cbiAgLy8gU29mdCBsaW5lIGJyZWFrcyAvIGJsb2NrIGVuZHMgXHUyMTkyIG5ld2xpbmVzXG4gIHMgPSBzLnJlcGxhY2UoLzxiclxccypcXC8/Pi9naSwgJ1xcbicpXG4gIHMgPSBzLnJlcGxhY2UoLzxcXC8ocHxkaXZ8dHJ8aFsxLTZdfGxpfGJsb2NrcXVvdGUpXFxzKj4vZ2ksICdcXG4nKVxuICAvLyBUYWJsZSBjZWxsczoga2VlcCB3b3JkcyBmcm9tIGFkamFjZW50IGNlbGxzIHNlcGFyYXRlZFxuICBzID0gcy5yZXBsYWNlKC88XFwvdGRcXHMqPi9naSwgJyAnKVxuICBzID0gcy5yZXBsYWNlKC88XFwvdGhcXHMqPi9naSwgJyAnKVxuXG4gIC8vIERyb3AgcmVtYWluaW5nIHRhZ3NcbiAgcyA9IHMucmVwbGFjZSgvPFtePl0rPi9nLCAnJylcblxuICBzID0gZGVjb2RlSHRtbEVudGl0aWVzKHMpXG5cbiAgLy8gTm9ybWFsaXplIHdoaXRlc3BhY2VcbiAgcyA9IHNcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLm1hcCgobGluZSkgPT4gbGluZS5yZXBsYWNlKC9bIFxcdFxcZlxcdl0rL2csICcgJykudHJpbSgpKVxuICAgIC5qb2luKCdcXG4nKVxuICBzID0gcy5yZXBsYWNlKC9cXG57Myx9L2csICdcXG5cXG4nKVxuICByZXR1cm4gcy50cmltKClcbn1cblxuLyoqIFRydWUgd2hlbiBhIHN0b3JlZCBib2R5IGxvb2tzIGxpa2UgcmF3IEhUTUwgcmF0aGVyIHRoYW4gcGxhaW4gdGV4dC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb29rc0xpa2VIdG1sKHZhbHVlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9eXFxzKig8IURPQ1RZUEVcXGJ8PGh0bWxcXGJ8PGhlYWRcXGJ8PGJvZHlcXGJ8PGRpdlxcYnw8dGFibGVcXGJ8PHBcXGJ8PGJyXFxifDxzcGFuXFxiKS9pXG4gICAgLnRlc3QodmFsdWUpXG59XG5cbi8qKlxuICogUHJlZmVyIGdlbnVpbmUgcGxhaW4gTUlNRSB0ZXh0OyBvdGhlcndpc2UgZXh0cmFjdCBmcm9tIEhUTUwgKGluY2wuIEhUTUxcbiAqIGR1cGxpY2F0ZWQgaW50byB0aGUgdGV4dCBwYXJ0KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUZXh0Qm9keShcbiAgdGV4dEJvZHk6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsXG4gIGh0bWxCb2R5OiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHRleHQgPSB0ZXh0Qm9keT8udHJpbSgpXG4gIGlmICh0ZXh0ICYmICFsb29rc0xpa2VIdG1sKHRleHQpKSByZXR1cm4gdGV4dFxuXG4gIGNvbnN0IGZyb21IdG1sID0gaHRtbFRvUGxhaW5UZXh0KGh0bWxCb2R5KVxuICBpZiAoZnJvbUh0bWwpIHJldHVybiBmcm9tSHRtbFxuXG4gIGlmICh0ZXh0KSB7XG4gICAgY29uc3Qgc3RyaXBwZWQgPSBodG1sVG9QbGFpblRleHQodGV4dClcbiAgICBpZiAoc3RyaXBwZWQpIHJldHVybiBzdHJpcHBlZFxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuY29uc3QgTkFNRURfRU5USVRJRVM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIGFtcDogJyYnLFxuICBsdDogJzwnLFxuICBndDogJz4nLFxuICBxdW90OiAnXCInLFxuICBhcG9zOiBcIidcIixcbiAgbmJzcDogJyAnLFxuICAvLyBDb21tb24gTGF0aW4gYWNjZW50cyBpbiBNWCAvIEVTIGJhbmsgZW1haWxzXG4gIGFhY3V0ZTogJ1x1MDBFMScsXG4gIGVhY3V0ZTogJ1x1MDBFOScsXG4gIGlhY3V0ZTogJ1x1MDBFRCcsXG4gIG9hY3V0ZTogJ1x1MDBGMycsXG4gIHVhY3V0ZTogJ1x1MDBGQScsXG4gIG50aWxkZTogJ1x1MDBGMScsXG4gIEFhY3V0ZTogJ1x1MDBDMScsXG4gIEVhY3V0ZTogJ1x1MDBDOScsXG4gIElhY3V0ZTogJ1x1MDBDRCcsXG4gIE9hY3V0ZTogJ1x1MDBEMycsXG4gIFVhY3V0ZTogJ1x1MDBEQScsXG4gIE50aWxkZTogJ1x1MDBEMScsXG4gIHV1bWw6ICdcdTAwRkMnLFxuICBVdW1sOiAnXHUwMERDJyxcbiAgaWV4Y2w6ICdcdTAwQTEnLFxuICBpcXVlc3Q6ICdcdTAwQkYnLFxuICBjb3B5OiAnXHUwMEE5JyxcbiAgcmVnOiAnXHUwMEFFJyxcbiAgdHJhZGU6ICdcdTIxMjInLFxuICBtZGFzaDogJ1x1MjAxNCcsXG4gIG5kYXNoOiAnXHUyMDEzJyxcbiAgaGVsbGlwOiAnXHUyMDI2JyxcbiAgbGFxdW86ICdcdTAwQUInLFxuICByYXF1bzogJ1x1MDBCQicsXG59XG5cbmZ1bmN0aW9uIGRlY29kZUh0bWxFbnRpdGllcyhzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcy5yZXBsYWNlKFxuICAgIC8mKCN4P1swLTlhLWZdK3xbYS16XSspOy9naSxcbiAgICAobWF0Y2gsIGVudGl0eTogc3RyaW5nKSA9PiB7XG4gICAgICBpZiAoZW50aXR5WzBdID09PSAnIycpIHtcbiAgICAgICAgY29uc3QgaGV4ID0gZW50aXR5WzFdID09PSAneCcgfHwgZW50aXR5WzFdID09PSAnWCdcbiAgICAgICAgY29uc3QgY29kZSA9IGhleFxuICAgICAgICAgID8gTnVtYmVyLnBhcnNlSW50KGVudGl0eS5zbGljZSgyKSwgMTYpXG4gICAgICAgICAgOiBOdW1iZXIucGFyc2VJbnQoZW50aXR5LnNsaWNlKDEpLCAxMClcbiAgICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZShjb2RlKSAmJiBjb2RlID49IDApIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgcmV0dXJuIFN0cmluZy5mcm9tQ29kZVBvaW50KGNvZGUpXG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICByZXR1cm4gbWF0Y2hcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG1hdGNoXG4gICAgICB9XG4gICAgICByZXR1cm4gTkFNRURfRU5USVRJRVNbZW50aXR5XSA/PyBtYXRjaFxuICAgIH0sXG4gIClcbn1cbiIsICJpbXBvcnQgeyBub3JtYWxpemVGcm9tIH0gZnJvbSAnLi4vZG9tYWluX2ZpbHRlci50cydcbmltcG9ydCB0eXBlIHsgRXh0cmFjdG9yIH0gZnJvbSAnLi4vZXh0cmFjdG9yLnRzJ1xuaW1wb3J0IHsgaHRtbFRvUGxhaW5UZXh0LCByZXNvbHZlVGV4dEJvZHkgfSBmcm9tICcuLi9odG1sX3RvX3BsYWluX3RleHQudHMnXG5pbXBvcnQgeyBtZXNzYWdlTWF0Y2hlc1RlbXBsYXRlIH0gZnJvbSAnLi4vdGVtcGxhdGVfbWF0Y2gudHMnXG5pbXBvcnQge1xuICBTUEVORElOR19DQU5ESURBVEVfS0lORCxcbiAgdHlwZSBEYXRlUGFydHNFeHRyYWN0b3IsXG4gIHR5cGUgRGlyZWN0aW9uRXh0cmFjdG9yLFxuICB0eXBlIEVtYWlsTWVzc2FnZSxcbiAgdHlwZSBFeHRyYWN0aW9uQXJ0aWZhY3QsXG4gIHR5cGUgRmllbGRFeHRyYWN0b3IsXG4gIHR5cGUgU3BlbmRQYXJzaW5nVGVtcGxhdGUsXG4gIHR5cGUgU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMsXG4gIHR5cGUgU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkLFxufSBmcm9tICcuLi90eXBlcy50cydcblxuLyoqXG4gKiBEZXRlcm1pbmlzdGljIHNwZW5kaW5nIGV4dHJhY3RvciBkcml2ZW4gYnkgYSB1c2VyL0FJLWdlbmVyYXRlZCB0ZW1wbGF0ZS5cbiAqIE5vIExMTSBjYWxscyBcdTIwMTQgcmVnZXggLyBjb25zdGFudCAvIGZyb21fZG9tYWluIG9ubHkuXG4gKi9cbmV4cG9ydCBjbGFzcyBUZW1wbGF0ZVNwZW5kaW5nRXh0cmFjdG9yIGltcGxlbWVudHMgRXh0cmFjdG9yIHtcbiAgcmVhZG9ubHkga2luZCA9IFNQRU5ESU5HX0NBTkRJREFURV9LSU5EXG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB0ZW1wbGF0ZTogU3BlbmRQYXJzaW5nVGVtcGxhdGUpIHt9XG5cbiAgZ2V0IHRlbXBsYXRlSWQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy50ZW1wbGF0ZS5pZFxuICB9XG5cbiAgY2FuSGFuZGxlKG1lc3NhZ2U6IEVtYWlsTWVzc2FnZSk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBtZXNzYWdlTWF0Y2hlc1RlbXBsYXRlKG1lc3NhZ2UsIHRoaXMudGVtcGxhdGUpXG4gIH1cblxuICBleHRyYWN0KG1lc3NhZ2U6IEVtYWlsTWVzc2FnZSk6IEV4dHJhY3Rpb25BcnRpZmFjdFtdIHtcbiAgICBjb25zdCBzb3VyY2VzID0gYnVpbGRTb3VyY2VzKG1lc3NhZ2UpXG5cbiAgICBpZiAodGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLmRpcmVjdGlvbikge1xuICAgICAgY29uc3QgZmxvdyA9IGNsYXNzaWZ5RGlyZWN0aW9uKFxuICAgICAgICB0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMuZGlyZWN0aW9uLFxuICAgICAgICBzb3VyY2VzLFxuICAgICAgKVxuICAgICAgaWYgKGZsb3cgPT09ICdpbmJvdW5kJykgcmV0dXJuIFtdXG4gICAgfVxuXG4gICAgY29uc3QgYW1vdW50UmF3ID0gYXBwbHlGaWVsZCh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMuYW1vdW50LCBzb3VyY2VzKVxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gcGFyc2VNb25leVRvQ2VudHMoYW1vdW50UmF3KVxuICAgIGlmIChhbW91bnRDZW50cyA9PT0gbnVsbCkgcmV0dXJuIFtdXG5cbiAgICBjb25zdCBjdXJyZW5jeVJhdyA9IHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5jdXJyZW5jeVxuICAgICAgPyBhcHBseUZpZWxkKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5jdXJyZW5jeSwgc291cmNlcylcbiAgICAgIDogbnVsbFxuICAgIGNvbnN0IGN1cnJlbmN5ID0gbm9ybWFsaXplQ3VycmVuY3koY3VycmVuY3lSYXcpID8/ICdVU0QnXG5cbiAgICBjb25zdCBzcGVudE9uID1cbiAgICAgIHJlc29sdmVTcGVudE9uKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5zcGVudE9uLCBzb3VyY2VzKSA/P1xuICAgICAgdG9EYXRlU3RyaW5nKG1lc3NhZ2UucmVjZWl2ZWRBdClcblxuICAgIGNvbnN0IG1lcmNoYW50ID0gdGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLm1lcmNoYW50XG4gICAgICA/IGFwcGx5RmllbGQodGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLm1lcmNoYW50LCBzb3VyY2VzKVxuICAgICAgOiBudWxsXG5cbiAgICBjb25zdCBub3RlID0gdGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLm5vdGVcbiAgICAgID8gYXBwbHlGaWVsZCh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMubm90ZSwgc291cmNlcylcbiAgICAgIDogbWVzc2FnZS5zdWJqZWN0LnNsaWNlKDAsIDIwMCkgfHwgbnVsbFxuXG4gICAgY29uc3QgcGF5bG9hZDogU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkID0ge1xuICAgICAgYW1vdW50Q2VudHMsXG4gICAgICBjdXJyZW5jeSxcbiAgICAgIHNwZW50T24sXG4gICAgICBtZXJjaGFudDogbWVyY2hhbnQ/LnRyaW0oKSA/IG1lcmNoYW50LnRyaW0oKS5zbGljZSgwLCAxMjApIDogbnVsbCxcbiAgICAgIG5vdGU6IG5vdGU/LnRyaW0oKSA/IG5vdGUudHJpbSgpLnNsaWNlKDAsIDIwMCkgOiBudWxsLFxuICAgICAgc291cmNlU3ViamVjdDogbWVzc2FnZS5zdWJqZWN0LFxuICAgICAgc291cmNlRnJvbTogbWVzc2FnZS5mcm9tLFxuICAgICAgdGVtcGxhdGVJZDogdGhpcy50ZW1wbGF0ZS5pZCxcbiAgICB9XG5cbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiBTUEVORElOR19DQU5ESURBVEVfS0lORCxcbiAgICAgICAgcGF5bG9hZDogeyAuLi5wYXlsb2FkIH0sXG4gICAgICAgIGNvbmZpZGVuY2U6IDAuOSxcbiAgICAgIH0sXG4gICAgXVxuICB9XG59XG5cbnR5cGUgU291cmNlcyA9IHtcbiAgc3ViamVjdDogc3RyaW5nXG4gIHRleHQ6IHN0cmluZ1xuICBodG1sX3RleHQ6IHN0cmluZ1xuICBmcm9tX2RvbWFpbjogc3RyaW5nIHwgbnVsbFxufVxuXG5mdW5jdGlvbiBidWlsZFNvdXJjZXMobWVzc2FnZTogRW1haWxNZXNzYWdlKTogU291cmNlcyB7XG4gIGNvbnN0IGZyb20gPSBub3JtYWxpemVGcm9tKG1lc3NhZ2UuZnJvbSlcbiAgLy8gU2FtZSBwbGFpbiB0ZXh0IGFzIHJlc29sdmVUZXh0Qm9keSAvIHN0b3JlZCBtZXNzYWdlcy50ZXh0X2JvZHkgKG5vdCByYXcgTUlNRSkuXG4gIGNvbnN0IHRleHQgPSByZXNvbHZlVGV4dEJvZHkobWVzc2FnZS50ZXh0Qm9keSwgbWVzc2FnZS5odG1sQm9keSkgPz8gJydcbiAgY29uc3QgZnJvbUh0bWwgPSBodG1sVG9QbGFpblRleHQobWVzc2FnZS5odG1sQm9keSlcbiAgcmV0dXJuIHtcbiAgICBzdWJqZWN0OiBtZXNzYWdlLnN1YmplY3QgPz8gJycsXG4gICAgdGV4dCxcbiAgICAvLyBQcmVmZXIgZXh0cmFjdGVkIEhUTUw7IGZhbGwgYmFjayB0byBzdG9yZWQgcGxhaW4gdGV4dCAocG9zdC1taWdyYXRpb24pLlxuICAgIGh0bWxfdGV4dDogZnJvbUh0bWwgfHwgdGV4dCxcbiAgICBmcm9tX2RvbWFpbjogZnJvbT8uZG9tYWluID8/IG51bGwsXG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlGaWVsZChcbiAgZXh0cmFjdG9yOiBGaWVsZEV4dHJhY3RvcixcbiAgc291cmNlczogU291cmNlcyxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAoZXh0cmFjdG9yLnNvdXJjZSA9PT0gJ2NvbnN0YW50Jykge1xuICAgIHJldHVybiBleHRyYWN0b3IudmFsdWVcbiAgfVxuICBpZiAoZXh0cmFjdG9yLnNvdXJjZSA9PT0gJ2Zyb21fZG9tYWluJykge1xuICAgIGlmICghc291cmNlcy5mcm9tX2RvbWFpbikgcmV0dXJuIG51bGxcbiAgICBjb25zdCBiYXNlID0gc291cmNlcy5mcm9tX2RvbWFpbi5zcGxpdCgnLicpWzBdXG4gICAgaWYgKCFiYXNlKSByZXR1cm4gbnVsbFxuICAgIHJldHVybiBiYXNlLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgYmFzZS5zbGljZSgxKVxuICB9XG4gIGNvbnN0IGhheXN0YWNrID0gc291cmNlc1tleHRyYWN0b3Iuc291cmNlXVxuICB0cnkge1xuICAgIGNvbnN0IHJlID0gbmV3IFJlZ0V4cChleHRyYWN0b3IucmVnZXgsICdpJylcbiAgICBjb25zdCBtID0gaGF5c3RhY2subWF0Y2gocmUpXG4gICAgY29uc3QgZ3JvdXAgPSBleHRyYWN0b3IuZ3JvdXBcbiAgICBpZiAoIW0gfHwgZ3JvdXAgPCAwIHx8IGdyb3VwID49IG0ubGVuZ3RoKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IHZhbHVlID0gbVtncm91cF1cbiAgICByZXR1cm4gdmFsdWU/LnRyaW0oKSA/IHZhbHVlLnRyaW0oKSA6IG51bGxcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5mdW5jdGlvbiByZXNvbHZlU3BlbnRPbihcbiAgZXh0cmFjdG9yOiBGaWVsZEV4dHJhY3RvciB8IERhdGVQYXJ0c0V4dHJhY3RvciB8IG51bGwgfCB1bmRlZmluZWQsXG4gIHNvdXJjZXM6IFNvdXJjZXMsXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFleHRyYWN0b3IpIHJldHVybiBudWxsXG4gIGlmIChpc0RhdGVQYXJ0c0V4dHJhY3RvcihleHRyYWN0b3IpKSB7XG4gICAgcmV0dXJuIGNvbXBvc2VEYXRlUGFydHMoZXh0cmFjdG9yLCBzb3VyY2VzKVxuICB9XG4gIGNvbnN0IHNwZW50T25SYXcgPSBhcHBseUZpZWxkKGV4dHJhY3Rvciwgc291cmNlcylcbiAgcmV0dXJuIG5vcm1hbGl6ZURhdGUoc3BlbnRPblJhdylcbn1cblxuZnVuY3Rpb24gY29tcG9zZURhdGVQYXJ0cyhcbiAgZXh0cmFjdG9yOiBEYXRlUGFydHNFeHRyYWN0b3IsXG4gIHNvdXJjZXM6IFNvdXJjZXMsXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgaGF5c3RhY2sgPSBzb3VyY2VzW2V4dHJhY3Rvci5zb3VyY2VdXG4gIHRyeSB7XG4gICAgY29uc3QgcmUgPSBuZXcgUmVnRXhwKGV4dHJhY3Rvci5yZWdleCwgJ2knKVxuICAgIGNvbnN0IG0gPSBoYXlzdGFjay5tYXRjaChyZSlcbiAgICBpZiAoIW0pIHJldHVybiBudWxsXG4gICAgY29uc3QgeWVhciA9IE51bWJlcihtW2V4dHJhY3Rvci55ZWFyR3JvdXBdKVxuICAgIGNvbnN0IG1vbnRoID0gTnVtYmVyKG1bZXh0cmFjdG9yLm1vbnRoR3JvdXBdKVxuICAgIGNvbnN0IGRheSA9IE51bWJlcihtW2V4dHJhY3Rvci5kYXlHcm91cF0pXG4gICAgaWYgKFxuICAgICAgIU51bWJlci5pc0ludGVnZXIoeWVhcikgfHxcbiAgICAgICFOdW1iZXIuaXNJbnRlZ2VyKG1vbnRoKSB8fFxuICAgICAgIU51bWJlci5pc0ludGVnZXIoZGF5KVxuICAgICkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgaWYgKHllYXIgPCAyMDAwIHx8IHllYXIgPiAyMTAwKSByZXR1cm4gbnVsbFxuICAgIGlmIChtb250aCA8IDEgfHwgbW9udGggPiAxMikgcmV0dXJuIG51bGxcbiAgICBpZiAoZGF5IDwgMSB8fCBkYXkgPiAzMSkgcmV0dXJuIG51bGxcbiAgICAvLyBTb2Z0IGNhbGVuZGFyIGNoZWNrOiByZWplY3QgZS5nLiBGZWIgMzEgdmlhIERhdGUgVVRDIHJvdW5kLXRyaXAuXG4gICAgY29uc3QgY29tcG9zZWQgPSBgJHt5ZWFyfS0ke3BhZDIobW9udGgpfS0ke3BhZDIoZGF5KX1gXG4gICAgY29uc3QgY2hlY2sgPSBuZXcgRGF0ZShgJHtjb21wb3NlZH1UMDA6MDA6MDAuMDAwWmApXG4gICAgaWYgKFxuICAgICAgTnVtYmVyLmlzTmFOKGNoZWNrLmdldFRpbWUoKSkgfHxcbiAgICAgIGNoZWNrLmdldFVUQ0Z1bGxZZWFyKCkgIT09IHllYXIgfHxcbiAgICAgIGNoZWNrLmdldFVUQ01vbnRoKCkgKyAxICE9PSBtb250aCB8fFxuICAgICAgY2hlY2suZ2V0VVRDRGF0ZSgpICE9PSBkYXlcbiAgICApIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIHJldHVybiBjb21wb3NlZFxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmZ1bmN0aW9uIGNsYXNzaWZ5RGlyZWN0aW9uKFxuICBleHRyYWN0b3I6IERpcmVjdGlvbkV4dHJhY3RvcixcbiAgc291cmNlczogU291cmNlcyxcbik6ICdpbmJvdW5kJyB8ICdvdXRib3VuZCcgfCAndW5rbm93bicge1xuICBjb25zdCBoYXlzdGFjayA9IHNvdXJjZXNbZXh0cmFjdG9yLnNvdXJjZV1cbiAgdHJ5IHtcbiAgICBjb25zdCByZSA9IG5ldyBSZWdFeHAoZXh0cmFjdG9yLnJlZ2V4LCAnaScpXG4gICAgY29uc3QgbSA9IGhheXN0YWNrLm1hdGNoKHJlKVxuICAgIGNvbnN0IGdyb3VwID0gZXh0cmFjdG9yLmdyb3VwXG4gICAgaWYgKCFtIHx8IGdyb3VwIDwgMCB8fCBncm91cCA+PSBtLmxlbmd0aCkgcmV0dXJuICd1bmtub3duJ1xuICAgIGNvbnN0IHJhdyA9IG1bZ3JvdXBdPy50cmltKClcbiAgICBpZiAoIXJhdykgcmV0dXJuICd1bmtub3duJ1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBmb2xkS2V5KHJhdylcbiAgICBpZiAoZXh0cmFjdG9yLmluYm91bmRNYXRjaGVzLnNvbWUoKGspID0+IGZvbGRLZXkoaykgPT09IG5vcm1hbGl6ZWQpKSB7XG4gICAgICByZXR1cm4gJ2luYm91bmQnXG4gICAgfVxuICAgIGlmIChleHRyYWN0b3Iub3V0Ym91bmRNYXRjaGVzLnNvbWUoKGspID0+IGZvbGRLZXkoaykgPT09IG5vcm1hbGl6ZWQpKSB7XG4gICAgICByZXR1cm4gJ291dGJvdW5kJ1xuICAgIH1cbiAgICByZXR1cm4gJ3Vua25vd24nXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAndW5rbm93bidcbiAgfVxufVxuXG4vKiogQ2FzZS1mb2xkICsgc3RyaXAgY29tYmluaW5nIG1hcmtzIHNvIFwiZGVwXHUwMEYzc2l0b1wiIG1hdGNoZXMgXCJkZXBvc2l0b1wiLiAqL1xuZnVuY3Rpb24gZm9sZEtleShzOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc1xuICAgIC5ub3JtYWxpemUoJ05GRCcpXG4gICAgLnJlcGxhY2UoL1xccHtNfS9ndSwgJycpXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAudHJpbSgpXG59XG5cbmZ1bmN0aW9uIHBhcnNlTW9uZXlUb0NlbnRzKHJhdzogc3RyaW5nIHwgbnVsbCk6IG51bWJlciB8IG51bGwge1xuICBpZiAoIXJhdykgcmV0dXJuIG51bGxcbiAgY29uc3QgY2xlYW5lZCA9IHJhdy5yZXBsYWNlKC9bXlxcZC4sLV0vZywgJycpLnJlcGxhY2UoLywvZywgJycpXG4gIGlmICghY2xlYW5lZCkgcmV0dXJuIG51bGxcbiAgY29uc3QgZG9sbGFycyA9IE51bWJlcihjbGVhbmVkKVxuICBpZiAoIU51bWJlci5pc0Zpbml0ZShkb2xsYXJzKSB8fCBkb2xsYXJzIDw9IDApIHJldHVybiBudWxsXG4gIHJldHVybiBNYXRoLnJvdW5kKGRvbGxhcnMgKiAxMDApXG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUN1cnJlbmN5KHJhdzogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIXJhdykgcmV0dXJuIG51bGxcbiAgY29uc3QgbSA9IHJhdy50b1VwcGVyQ2FzZSgpLm1hdGNoKC9cXGIoVVNEfEVVUnxHQlB8TVhOfENBRClcXGIvKVxuICByZXR1cm4gbT8uWzFdID8/IG51bGxcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplRGF0ZShyYXc6IHN0cmluZyB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFyYXcpIHJldHVybiBudWxsXG4gIGNvbnN0IGlzbyA9IHJhdy5tYXRjaCgvXFxiKDIwXFxkezJ9LVxcZHsyfS1cXGR7Mn0pXFxiLylcbiAgaWYgKGlzbz8uWzFdKSByZXR1cm4gaXNvWzFdXG4gIHJldHVybiBudWxsXG59XG5cbmZ1bmN0aW9uIHRvRGF0ZVN0cmluZyhkOiBEYXRlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbn1cblxuZnVuY3Rpb24gcGFkMihuOiBudW1iZXIpOiBzdHJpbmcge1xuICByZXR1cm4gbiA8IDEwID8gYDAke259YCA6IFN0cmluZyhuKVxufVxuXG5mdW5jdGlvbiBpc0RhdGVQYXJ0c0V4dHJhY3RvcihcbiAgcmF3OiBGaWVsZEV4dHJhY3RvciB8IERhdGVQYXJ0c0V4dHJhY3Rvcixcbik6IHJhdyBpcyBEYXRlUGFydHNFeHRyYWN0b3Ige1xuICByZXR1cm4gKFxuICAgICd5ZWFyR3JvdXAnIGluIHJhdyAmJlxuICAgICdtb250aEdyb3VwJyBpbiByYXcgJiZcbiAgICAnZGF5R3JvdXAnIGluIHJhdyAmJlxuICAgIHR5cGVvZiAocmF3IGFzIERhdGVQYXJ0c0V4dHJhY3RvcikueWVhckdyb3VwID09PSAnbnVtYmVyJ1xuICApXG59XG5cbi8qKiBWYWxpZGF0ZSBleHRyYWN0b3JzIEpTT04gc2hhcGUgKHVzZWQgYnkgQVBJICsgQUkgb3V0cHV0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzKFxuICByYXc6IHVua25vd24sXG4pOiBTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyB8IG51bGwge1xuICBpZiAocmF3ID09PSBudWxsIHx8IHR5cGVvZiByYXcgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIG51bGxcbiAgY29uc3Qgb2JqID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGNvbnN0IGFtb3VudCA9IHBhcnNlRmllbGRFeHRyYWN0b3Iob2JqLmFtb3VudClcbiAgaWYgKCFhbW91bnQpIHJldHVybiBudWxsXG5cbiAgY29uc3Qgc3BlbnRPbiA9IHBhcnNlU3BlbnRPbkV4dHJhY3RvcihvYmouc3BlbnRPbilcbiAgaWYgKG9iai5zcGVudE9uICE9PSB1bmRlZmluZWQgJiYgb2JqLnNwZW50T24gIT09IG51bGwgJiYgc3BlbnRPbiA9PT0gbnVsbCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBjb25zdCBkaXJlY3Rpb24gPSBwYXJzZURpcmVjdGlvbkV4dHJhY3RvcihvYmouZGlyZWN0aW9uKVxuICBpZiAoXG4gICAgb2JqLmRpcmVjdGlvbiAhPT0gdW5kZWZpbmVkICYmXG4gICAgb2JqLmRpcmVjdGlvbiAhPT0gbnVsbCAmJlxuICAgIGRpcmVjdGlvbiA9PT0gbnVsbFxuICApIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBhbW91bnQsXG4gICAgY3VycmVuY3k6IHBhcnNlT3B0aW9uYWxGaWVsZChvYmouY3VycmVuY3kpLFxuICAgIHNwZW50T24sXG4gICAgbWVyY2hhbnQ6IHBhcnNlT3B0aW9uYWxGaWVsZChvYmoubWVyY2hhbnQpLFxuICAgIG5vdGU6IHBhcnNlT3B0aW9uYWxGaWVsZChvYmoubm90ZSksXG4gICAgZGlyZWN0aW9uLFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlT3B0aW9uYWxGaWVsZChyYXc6IHVua25vd24pOiBGaWVsZEV4dHJhY3RvciB8IG51bGwge1xuICBpZiAocmF3ID09PSB1bmRlZmluZWQgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4gcGFyc2VGaWVsZEV4dHJhY3RvcihyYXcpXG59XG5cbmZ1bmN0aW9uIHBhcnNlU3BlbnRPbkV4dHJhY3RvcihcbiAgcmF3OiB1bmtub3duLFxuKTogRmllbGRFeHRyYWN0b3IgfCBEYXRlUGFydHNFeHRyYWN0b3IgfCBudWxsIHtcbiAgaWYgKHJhdyA9PT0gdW5kZWZpbmVkIHx8IHJhdyA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiByYXcgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIG51bGxcbiAgY29uc3Qgb2JqID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGlmIChcbiAgICB0eXBlb2Ygb2JqLnllYXJHcm91cCA9PT0gJ251bWJlcicgfHxcbiAgICB0eXBlb2Ygb2JqLm1vbnRoR3JvdXAgPT09ICdudW1iZXInIHx8XG4gICAgdHlwZW9mIG9iai5kYXlHcm91cCA9PT0gJ251bWJlcidcbiAgKSB7XG4gICAgcmV0dXJuIHBhcnNlRGF0ZVBhcnRzRXh0cmFjdG9yKG9iailcbiAgfVxuICByZXR1cm4gcGFyc2VGaWVsZEV4dHJhY3RvcihyYXcpXG59XG5cbmZ1bmN0aW9uIHBhcnNlRGF0ZVBhcnRzRXh0cmFjdG9yKFxuICBvYmo6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuKTogRGF0ZVBhcnRzRXh0cmFjdG9yIHwgbnVsbCB7XG4gIGNvbnN0IHNvdXJjZSA9IG9iai5zb3VyY2VcbiAgaWYgKHNvdXJjZSAhPT0gJ3N1YmplY3QnICYmIHNvdXJjZSAhPT0gJ3RleHQnICYmIHNvdXJjZSAhPT0gJ2h0bWxfdGV4dCcpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG4gIGlmICh0eXBlb2Ygb2JqLnJlZ2V4ICE9PSAnc3RyaW5nJyB8fCAhb2JqLnJlZ2V4KSByZXR1cm4gbnVsbFxuICBpZiAoIWlzTm9uTmVnSW50KG9iai55ZWFyR3JvdXApKSByZXR1cm4gbnVsbFxuICBpZiAoIWlzTm9uTmVnSW50KG9iai5tb250aEdyb3VwKSkgcmV0dXJuIG51bGxcbiAgaWYgKCFpc05vbk5lZ0ludChvYmouZGF5R3JvdXApKSByZXR1cm4gbnVsbFxuICB0cnkge1xuICAgIG5ldyBSZWdFeHAob2JqLnJlZ2V4LCAnaScpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgcmV0dXJuIHtcbiAgICBzb3VyY2UsXG4gICAgcmVnZXg6IG9iai5yZWdleCxcbiAgICB5ZWFyR3JvdXA6IG9iai55ZWFyR3JvdXAsXG4gICAgbW9udGhHcm91cDogb2JqLm1vbnRoR3JvdXAsXG4gICAgZGF5R3JvdXA6IG9iai5kYXlHcm91cCxcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZURpcmVjdGlvbkV4dHJhY3RvcihyYXc6IHVua25vd24pOiBEaXJlY3Rpb25FeHRyYWN0b3IgfCBudWxsIHtcbiAgaWYgKHJhdyA9PT0gdW5kZWZpbmVkIHx8IHJhdyA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiByYXcgIT09ICdvYmplY3QnIHx8IEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIG51bGxcbiAgY29uc3Qgb2JqID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGNvbnN0IHNvdXJjZSA9IG9iai5zb3VyY2VcbiAgaWYgKHNvdXJjZSAhPT0gJ3N1YmplY3QnICYmIHNvdXJjZSAhPT0gJ3RleHQnICYmIHNvdXJjZSAhPT0gJ2h0bWxfdGV4dCcpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG4gIGlmICh0eXBlb2Ygb2JqLnJlZ2V4ICE9PSAnc3RyaW5nJyB8fCAhb2JqLnJlZ2V4KSByZXR1cm4gbnVsbFxuICBpZiAoIWlzTm9uTmVnSW50KG9iai5ncm91cCkpIHJldHVybiBudWxsXG4gIGNvbnN0IGluYm91bmQgPSBwYXJzZVN0cmluZ0xpc3Qob2JqLmluYm91bmRNYXRjaGVzKVxuICBjb25zdCBvdXRib3VuZCA9IHBhcnNlU3RyaW5nTGlzdChvYmoub3V0Ym91bmRNYXRjaGVzKVxuICBpZiAoIWluYm91bmQgfHwgIW91dGJvdW5kKSByZXR1cm4gbnVsbFxuICBpZiAoaW5ib3VuZC5sZW5ndGggPT09IDAgJiYgb3V0Ym91bmQubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuICB0cnkge1xuICAgIG5ldyBSZWdFeHAob2JqLnJlZ2V4LCAnaScpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgcmV0dXJuIHtcbiAgICBzb3VyY2UsXG4gICAgcmVnZXg6IG9iai5yZWdleCxcbiAgICBncm91cDogb2JqLmdyb3VwLFxuICAgIGluYm91bmRNYXRjaGVzOiBpbmJvdW5kLFxuICAgIG91dGJvdW5kTWF0Y2hlczogb3V0Ym91bmQsXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VTdHJpbmdMaXN0KHJhdzogdW5rbm93bik6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGlmICghQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gbnVsbFxuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW11cbiAgZm9yIChjb25zdCBpdGVtIG9mIHJhdykge1xuICAgIGlmICh0eXBlb2YgaXRlbSAhPT0gJ3N0cmluZycpIHJldHVybiBudWxsXG4gICAgY29uc3QgdHJpbW1lZCA9IGl0ZW0udHJpbSgpXG4gICAgaWYgKHRyaW1tZWQpIG91dC5wdXNoKHRyaW1tZWQpXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiBpc05vbk5lZ0ludChyYXc6IHVua25vd24pOiByYXcgaXMgbnVtYmVyIHtcbiAgcmV0dXJuIHR5cGVvZiByYXcgPT09ICdudW1iZXInICYmIE51bWJlci5pc0ludGVnZXIocmF3KSAmJiByYXcgPj0gMFxufVxuXG5mdW5jdGlvbiBwYXJzZUZpZWxkRXh0cmFjdG9yKHJhdzogdW5rbm93bik6IEZpZWxkRXh0cmFjdG9yIHwgbnVsbCB7XG4gIGlmIChyYXcgPT09IG51bGwgfHwgdHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gbnVsbFxuICBjb25zdCBvYmogPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uc3Qgc291cmNlID0gb2JqLnNvdXJjZVxuICBpZiAoc291cmNlID09PSAnZnJvbV9kb21haW4nKSByZXR1cm4geyBzb3VyY2U6ICdmcm9tX2RvbWFpbicgfVxuICBpZiAoc291cmNlID09PSAnY29uc3RhbnQnKSB7XG4gICAgaWYgKHR5cGVvZiBvYmoudmFsdWUgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbFxuICAgIHJldHVybiB7IHNvdXJjZTogJ2NvbnN0YW50JywgdmFsdWU6IG9iai52YWx1ZSB9XG4gIH1cbiAgaWYgKHNvdXJjZSA9PT0gJ3N1YmplY3QnIHx8IHNvdXJjZSA9PT0gJ3RleHQnIHx8IHNvdXJjZSA9PT0gJ2h0bWxfdGV4dCcpIHtcbiAgICBpZiAodHlwZW9mIG9iai5yZWdleCAhPT0gJ3N0cmluZycgfHwgIW9iai5yZWdleCkgcmV0dXJuIG51bGxcbiAgICBpZiAodHlwZW9mIG9iai5ncm91cCAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIob2JqLmdyb3VwKSB8fCBvYmouZ3JvdXAgPCAwKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgICB0cnkge1xuICAgICAgbmV3IFJlZ0V4cChvYmoucmVnZXgsICdpJylcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIHJldHVybiB7IHNvdXJjZSwgcmVnZXg6IG9iai5yZWdleCwgZ3JvdXA6IG9iai5ncm91cCB9XG4gIH1cbiAgcmV0dXJuIG51bGxcbn1cbiIsICJpbXBvcnQgeyBFeHRyYWN0b3JQaXBlbGluZSB9IGZyb20gJy4vZXh0cmFjdG9yLnRzJ1xuaW1wb3J0IHsgVGVtcGxhdGVTcGVuZGluZ0V4dHJhY3RvciB9IGZyb20gJy4vZXh0cmFjdG9ycy90ZW1wbGF0ZV9zcGVuZGluZ19leHRyYWN0b3IudHMnXG5pbXBvcnQge1xuICBtZXNzYWdlTWF0Y2hlc0FueVRlbXBsYXRlLFxuICB0eXBlIFRlbXBsYXRlTWF0Y2hTcGVjLFxufSBmcm9tICcuL3RlbXBsYXRlX21hdGNoLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBFbWFpbE1lc3NhZ2UsXG4gIEV4dHJhY3Rpb25BcnRpZmFjdCxcbiAgU3BlbmRQYXJzaW5nVGVtcGxhdGUsXG59IGZyb20gJy4vdHlwZXMudHMnXG5cbi8qKlxuICogQ2xhc3NpZnkgKyBleHRyYWN0IHNwZW5kaW5nIGNhbmRpZGF0ZXMgZm9yIGEgbWVzc2FnZS5cbiAqXG4gKiBSZWplY3QgdGVtcGxhdGVzIHNob3J0LWNpcmN1aXQgKG5vIGFydGlmYWN0cykuIEFwcHJvdmUgdGVtcGxhdGVzIHJ1biB3aXRoXG4gKiBmaXJzdC1tYXRjaC1vbmx5LiBObyBoZXVyaXN0aWMgZmFsbGJhY2sgXHUyMDE0IG9ubHkgYXBwcm92ZSB0ZW1wbGF0ZXMgcHJvZHVjZVxuICogcmV2aWV3IGl0ZW1zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdFNwZW5kaW5nQ2FuZGlkYXRlcyhcbiAgbWVzc2FnZTogRW1haWxNZXNzYWdlLFxuICBvcHRpb25zOiB7XG4gICAgcmVqZWN0VGVtcGxhdGVzOiByZWFkb25seSBUZW1wbGF0ZU1hdGNoU3BlY1tdXG4gICAgYXBwcm92ZVRlbXBsYXRlczogcmVhZG9ubHkgU3BlbmRQYXJzaW5nVGVtcGxhdGVbXVxuICB9LFxuKTogRXh0cmFjdGlvbkFydGlmYWN0W10ge1xuICBpZiAobWVzc2FnZU1hdGNoZXNBbnlUZW1wbGF0ZShtZXNzYWdlLCBvcHRpb25zLnJlamVjdFRlbXBsYXRlcykpIHtcbiAgICByZXR1cm4gW11cbiAgfVxuICBpZiAob3B0aW9ucy5hcHByb3ZlVGVtcGxhdGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdXG5cbiAgY29uc3QgcGlwZWxpbmUgPSBuZXcgRXh0cmFjdG9yUGlwZWxpbmUoXG4gICAgb3B0aW9ucy5hcHByb3ZlVGVtcGxhdGVzLm1hcCgodCkgPT4gbmV3IFRlbXBsYXRlU3BlbmRpbmdFeHRyYWN0b3IodCkpLFxuICAgIHsgZmlyc3RNYXRjaE9ubHk6IHRydWUgfSxcbiAgKVxuICByZXR1cm4gcGlwZWxpbmUucnVuKG1lc3NhZ2UpXG59XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgbWFpbGJveGVzOiBNYWlsYm94ZXNUYWJsZVxuICBkb21haW5fZmlsdGVyczogRG9tYWluRmlsdGVyc1RhYmxlXG4gIG1lc3NhZ2VzOiBNZXNzYWdlc1RhYmxlXG4gIGV4dHJhY3Rpb25fYXJ0aWZhY3RzOiBFeHRyYWN0aW9uQXJ0aWZhY3RzVGFibGVcbiAgc3luY19ydW5zOiBTeW5jUnVuc1RhYmxlXG4gIHBhcnNpbmdfdGVtcGxhdGVzOiBQYXJzaW5nVGVtcGxhdGVzVGFibGVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBVc2Vyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGVtYWlsOiBzdHJpbmdcbiAgcGFzc3dvcmRfaGFzaDogc3RyaW5nIHwgbnVsbFxuICBhdXRoX3VzZXJfaWQ6IHN0cmluZyB8IG51bGxcbiAgbmFtZTogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBNYWlsYm94ZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgLyoqICdmaXh0dXJlJyB8ICdnbWFpbCcgKi9cbiAgcHJvdmlkZXI6IHN0cmluZ1xuICBsYWJlbDogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgLyoqIE9wYXF1ZSBwcm92aWRlciBzeW5jIGN1cnNvci4gKi9cbiAgc3luY19jdXJzb3I6IHN0cmluZyB8IG51bGxcbiAgLyoqIFdoZW4gdHJ1ZSwgd29ya2VyIHNob3VsZCBzeW5jIEFTQVAuICovXG4gIHN5bmNfcmVxdWVzdGVkOiBib29sZWFuXG4gIC8qKiBPbmUtc2hvdCBiYWNrZmlsbCB3aW5kb3cgc3RhcnQgKGluY2x1c2l2ZSk7IG51bGwgPSBvcGVuIG9yIGluY3JlbWVudGFsLiAqL1xuICBzeW5jX3NpbmNlOiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICAvKiogT25lLXNob3QgYmFja2ZpbGwgd2luZG93IGVuZCAoaW5jbHVzaXZlKTsgbnVsbCA9IG9wZW4gb3IgaW5jcmVtZW50YWwuICovXG4gIHN5bmNfdW50aWw6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsIHN0cmluZyB8IG51bGw+XG4gIC8qKiBQYWdlIGN1cnNvciBmb3IgYW4gaW4tcHJvZ3Jlc3MgYmFja2ZpbGw7IGRvZXMgbm90IHJlcGxhY2Ugc3luY19jdXJzb3IuICovXG4gIHN5bmNfYmFja2ZpbGxfY3Vyc29yOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBKU09OOiB7IGFjY2Vzc1Rva2VuLCByZWZyZXNoVG9rZW4/LCBleHBpcmVzQXRNcz8gfSBmb3IgZ21haWwuICovXG4gIG9hdXRoX3Rva2Vuc19qc29uOiBzdHJpbmcgfCBudWxsXG4gIGxhc3Rfc3luY2VkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRG9tYWluRmlsdGVyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1haWxib3hfaWQ6IG51bWJlclxuICAvKiogRG9tYWluIChhbWF6b24uY29tKSBvciBmdWxsIGFkZHJlc3MgKG5vcmVwbHlAYW1hem9uLmNvbSkuICovXG4gIHBhdHRlcm46IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVzc2FnZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgc3RyaW5nPlxuICBib2R5X2hhc2g6IHN0cmluZyB8IG51bGxcbiAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keTogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdGlvbkFydGlmYWN0c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1lc3NhZ2VfaWQ6IG51bWJlclxuICBraW5kOiBzdHJpbmdcbiAgcGF5bG9hZDogQ29sdW1uVHlwZTx1bmtub3duLCBzdHJpbmcgfCB1bmtub3duLCBzdHJpbmcgfCB1bmtub3duPlxuICBjb25maWRlbmNlOiBudW1iZXJcbiAgLyoqICdwZW5kaW5nJyB8ICdhY2NlcHRlZCcgfCAncmVqZWN0ZWQnICovXG4gIHN0YXR1czogc3RyaW5nXG4gIC8qKiBzcGVuZG1hbmFnZXIgZXhwZW5zZSBpZCBhZnRlciBhY2NlcHQrcHVibGlzaCAqL1xuICBwdWJsaXNoZWRfZXhwZW5zZV9pZDogbnVtYmVyIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2luZ1RlbXBsYXRlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1haWxib3hfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIC8qKiAnYXBwcm92ZScgfCAncmVqZWN0JyAqL1xuICBraW5kOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBtYXRjaF9mcm9tX3BhdHRlcm46IHN0cmluZ1xuICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIC8qKiBOdWxsIGZvciByZWplY3QgdGVtcGxhdGVzIChtYXRjaC1vbmx5KS4gKi9cbiAgZXh0cmFjdG9yczogQ29sdW1uVHlwZTxcbiAgICB1bmtub3duIHwgbnVsbCxcbiAgICBzdHJpbmcgfCB1bmtub3duIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgICBzdHJpbmcgfCB1bmtub3duIHwgbnVsbFxuICA+XG4gIHNvdXJjZV9tZXNzYWdlX2lkOiBudW1iZXIgfCBudWxsXG4gIHZlcnNpb246IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1J1bnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgc3RhcnRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICBmaW5pc2hlZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCwgc3RyaW5nIHwgbnVsbD5cbiAgZmV0Y2hlZF9jb3VudDogbnVtYmVyXG4gIGV4dHJhY3RlZF9jb3VudDogbnVtYmVyXG4gIGVycm9yX3RleHQ6IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IHR5cGUgVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIE1haWxib3ggPSBTZWxlY3RhYmxlPE1haWxib3hlc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3TWFpbGJveCA9IEluc2VydGFibGU8TWFpbGJveGVzVGFibGU+XG5leHBvcnQgdHlwZSBEb21haW5GaWx0ZXIgPSBTZWxlY3RhYmxlPERvbWFpbkZpbHRlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIE1lc3NhZ2UgPSBTZWxlY3RhYmxlPE1lc3NhZ2VzVGFibGU+XG5leHBvcnQgdHlwZSBFeHRyYWN0aW9uQXJ0aWZhY3QgPSBTZWxlY3RhYmxlPEV4dHJhY3Rpb25BcnRpZmFjdHNUYWJsZT5cbmV4cG9ydCB0eXBlIFN5bmNSdW4gPSBTZWxlY3RhYmxlPFN5bmNSdW5zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdTeW5jUnVuID0gSW5zZXJ0YWJsZTxTeW5jUnVuc1RhYmxlPlxuZXhwb3J0IHR5cGUgUGFyc2luZ1RlbXBsYXRlID0gU2VsZWN0YWJsZTxQYXJzaW5nVGVtcGxhdGVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdQYXJzaW5nVGVtcGxhdGUgPSBJbnNlcnRhYmxlPFBhcnNpbmdUZW1wbGF0ZXNUYWJsZT5cbiIsICJpbXBvcnQgeyBQb29sLCB0eXBlcyB9IGZyb20gJ3BnJ1xuaW1wb3J0IHsgS3lzZWx5LCBQb3N0Z3Jlc0RpYWxlY3QgfSBmcm9tICdreXNlbHknXG5pbXBvcnQgeyBlbnYgfSBmcm9tICcuL2Vudi50cydcbmltcG9ydCB7XG4gIGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zLFxuICBzc2xGb3JEYXRhYmFzZVVybCxcbn0gZnJvbSAnLi9zc2wudHMnXG5cbi8vIEtlZXAgUG9zdGdyZXMgYGRhdGVgIGFzIGBZWVlZLU1NLUREYCBzdHJpbmdzLiBUaGUgZGVmYXVsdCBwZyBwYXJzZXIgdHVybnNcbi8vIHRoZW0gaW50byBKUyBEYXRlIG9iamVjdHMsIHdoaWNoIEdyYXBoUUwgdGhlbiBzdHJpbmdpZmllcyBhcyBmdWxsIHRpbWVzdGFtcHNcbi8vIGFuZCBicmVha3MgRmx1dHRlcidzIGRhdGUtb25seSBwYXJzaW5nLlxudHlwZXMuc2V0VHlwZVBhcnNlcih0eXBlcy5idWlsdGlucy5EQVRFLCAodmFsdWU6IHN0cmluZykgPT4gdmFsdWUpXG5cbmV4cG9ydCB0eXBlIENyZWF0ZUt5c2VseU9wdGlvbnMgPSB7XG4gIC8qKiBGYWxsYmFjayB3aGVuIGBQR0RBVEFCQVNFYCAvIGBEQVRBQkFTRV9VUkxgIGFyZSB1bnNldC4gKi9cbiAgZGVmYXVsdERhdGFiYXNlOiBzdHJpbmdcbn1cblxuZnVuY3Rpb24gcG9vbENvbmZpZ0Zyb21FbnYoXG4gIGRlZmF1bHREYXRhYmFzZTogc3RyaW5nLFxuKTogQ29uc3RydWN0b3JQYXJhbWV0ZXJzPHR5cGVvZiBQb29sPlswXSB7XG4gIGNvbnN0IGRhdGFiYXNlVXJsID0gZW52KCdEQVRBQkFTRV9VUkwnKVxuICBpZiAoZGF0YWJhc2VVcmwpIHtcbiAgICBjb25zdCBzc2wgPSBzc2xGb3JEYXRhYmFzZVVybChkYXRhYmFzZVVybClcbiAgICByZXR1cm4ge1xuICAgICAgY29ubmVjdGlvblN0cmluZzogY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMoZGF0YWJhc2VVcmwpLFxuICAgICAgbWF4OiAxMCxcbiAgICAgIC4uLihzc2wgPT09IHVuZGVmaW5lZCA/IHt9IDogeyBzc2wgfSksXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhYmFzZTogZW52KCdQR0RBVEFCQVNFJykgPz8gZGVmYXVsdERhdGFiYXNlLFxuICAgIGhvc3Q6IGVudignUEdIT1NUJykgPz8gJ2xvY2FsaG9zdCcsXG4gICAgdXNlcjogZW52KCdQR1VTRVInKSA/PyAncG9zdGdyZXMnLFxuICAgIHBhc3N3b3JkOiBlbnYoJ1BHUEFTU1dPUkQnKSA/PyAndGVzdDEyMzQnLFxuICAgIHBvcnQ6IE51bWJlcihlbnYoJ1BHUE9SVCcpID8/ICc1NDMyJyksXG4gICAgbWF4OiAxMCxcbiAgfVxufVxuXG4vKiogQ3JlYXRlIGEgS3lzZWx5IGluc3RhbmNlIGZvciB0aGUgZ2l2ZW4gc2NoZW1hIHR5cGUgYW5kIGRlZmF1bHQgREIgbmFtZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVLeXNlbHk8REI+KG9wdGlvbnM6IENyZWF0ZUt5c2VseU9wdGlvbnMpOiBLeXNlbHk8REI+IHtcbiAgY29uc3QgZGlhbGVjdCA9IG5ldyBQb3N0Z3Jlc0RpYWxlY3Qoe1xuICAgIHBvb2w6IG5ldyBQb29sKHBvb2xDb25maWdGcm9tRW52KG9wdGlvbnMuZGVmYXVsdERhdGFiYXNlKSksXG4gIH0pXG4gIHJldHVybiBuZXcgS3lzZWx5PERCPih7IGRpYWxlY3QgfSlcbn1cbiIsICIvKiogUmVhZCBhbiBlbnYgdmFyIGZyb20gTm9kZSBgcHJvY2Vzcy5lbnZgIG9yIERlbm8gKFB5bG9uIGJ1bmRsZXMgcnVuIHVuZGVyIE5vZGUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVudihuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5bbmFtZV0pIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbbmFtZV1cbiAgfVxuICBpZiAodHlwZW9mIERlbm8gIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBEZW5vLmVudj8uZ2V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIERlbm8uZW52LmdldChuYW1lKVxuICB9XG4gIHJldHVybiB1bmRlZmluZWRcbn1cbiIsICIvKiogVExTIG9wdGlvbnMgZm9yIGBwZ2AgZnJvbSBhIFBvc3RncmVzIFVSTC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzc2xGb3JEYXRhYmFzZVVybChcbiAgZGF0YWJhc2VVcmw6IHN0cmluZyxcbik6IGZhbHNlIHwgeyByZWplY3RVbmF1dGhvcml6ZWQ6IGJvb2xlYW4gfSB8IHVuZGVmaW5lZCB7XG4gIGxldCB1cmw6IFVSTFxuICB0cnkge1xuICAgIHVybCA9IG5ldyBVUkwoZGF0YWJhc2VVcmwpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIGNvbnN0IG1vZGUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgnc3NsbW9kZScpPy50b0xvd2VyQ2FzZSgpXG4gIGlmIChtb2RlID09PSAnZGlzYWJsZScpIHJldHVybiBmYWxzZVxuICBpZiAobW9kZSA9PT0gJ3JlcXVpcmUnIHx8IG1vZGUgPT09ICd2ZXJpZnktY2EnIHx8IG1vZGUgPT09ICd2ZXJpZnktZnVsbCcpIHtcbiAgICByZXR1cm4geyByZWplY3RVbmF1dGhvcml6ZWQ6IGZhbHNlIH1cbiAgfVxuXG4gIGNvbnN0IGhvc3QgPSB1cmwuaG9zdG5hbWVcbiAgaWYgKGhvc3QgPT09ICdsb2NhbGhvc3QnIHx8IGhvc3QgPT09ICcxMjcuMC4wLjEnKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHsgcmVqZWN0VW5hdXRob3JpemVkOiBmYWxzZSB9XG59XG5cbi8qKlxuICogU3RyaXAgU1NMIHF1ZXJ5IHBhcmFtcyBmcm9tIGEgUG9zdGdyZXMgVVJMIGJlZm9yZSBwYXNzaW5nIGl0IHRvIGBwZ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyhkYXRhYmFzZVVybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKGRhdGFiYXNlVXJsKVxuICAgIGZvciAoY29uc3Qga2V5IG9mIFtcbiAgICAgICdzc2xtb2RlJyxcbiAgICAgICdzc2wnLFxuICAgICAgJ3NzbHJvb3RjZXJ0JyxcbiAgICAgICdzc2xjZXJ0JyxcbiAgICAgICdzc2xrZXknLFxuICAgIF0pIHtcbiAgICAgIHVybC5zZWFyY2hQYXJhbXMuZGVsZXRlKGtleSlcbiAgICB9XG4gICAgcmV0dXJuIHVybC50b1N0cmluZygpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBkYXRhYmFzZVVybFxuICB9XG59XG4iLCAiaW1wb3J0IHsgRGF0YWJhc2UgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGNyZWF0ZUt5c2VseSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9jcmVhdGVfa3lzZWx5LnRzJ1xuXG5leHBvcnQgeyBlbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvZW52LnRzJ1xuXG5leHBvcnQgY29uc3QgZGIgPSBjcmVhdGVLeXNlbHk8RGF0YWJhc2U+KHtcbiAgZGVmYXVsdERhdGFiYXNlOiAnbWFpbGJveCcsXG59KVxuIiwgImltcG9ydCB7IGVudiBhcyByZWFkRW52IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2Vudi50cydcblxuZXhwb3J0IHR5cGUgR2VuZXJhdGVUZW1wbGF0ZUFpSW5wdXQgPSB7XG4gIGZyb206IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgdGV4dEJvZHk/OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxCb2R5Pzogc3RyaW5nIHwgbnVsbFxuICBoaW50cz86IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IHR5cGUgR2VuZXJhdGVBcHByb3ZlVGVtcGxhdGVBaU91dHB1dCA9IHtcbiAgbWF0Y2hGcm9tUGF0dGVybjogc3RyaW5nXG4gIG1hdGNoU3ViamVjdFJlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIG5hbWVTdWdnZXN0aW9uOiBzdHJpbmdcbn1cblxuZXhwb3J0IHR5cGUgR2VuZXJhdGVSZWplY3RUZW1wbGF0ZUFpT3V0cHV0ID0ge1xuICBtYXRjaEZyb21QYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hTdWJqZWN0UmVnZXg6IHN0cmluZyB8IG51bGxcbiAgbmFtZVN1Z2dlc3Rpb246IHN0cmluZ1xufVxuXG4vKiogQGRlcHJlY2F0ZWQgUHJlZmVyIEdlbmVyYXRlQXBwcm92ZVRlbXBsYXRlQWlPdXRwdXQgKi9cbmV4cG9ydCB0eXBlIEdlbmVyYXRlVGVtcGxhdGVBaU91dHB1dCA9IEdlbmVyYXRlQXBwcm92ZVRlbXBsYXRlQWlPdXRwdXRcblxuZXhwb3J0IHR5cGUgQ2xhc3NpZnlFbWFpbFNwZW5kUmVsZXZhbmNlQWlPdXRwdXQgPSB7XG4gIHVzZWZ1bDogYm9vbGVhblxuICByZWFzb246IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgQWlDbGllbnRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnQWlDbGllbnRFcnJvcidcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBydW5BaVVzZUNhc2U8VD4oXG4gIHVzZUNhc2VJZDogc3RyaW5nLFxuICBpbnB1dDogR2VuZXJhdGVUZW1wbGF0ZUFpSW5wdXQsXG4gIG9wdGlvbnM/OiB7XG4gICAgYmFzZVVybD86IHN0cmluZ1xuICAgIHNlcnZpY2VLZXk/OiBzdHJpbmdcbiAgICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2hcbiAgfSxcbik6IFByb21pc2U8VD4ge1xuICBjb25zdCBiYXNlVXJsID0gKG9wdGlvbnM/LmJhc2VVcmwgPz9cbiAgICByZWFkRW52KCdBSV9BUElfQkFTRV9VUkwnKSA/P1xuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDQnKS5yZXBsYWNlKC9cXC8kLywgJycpXG4gIGNvbnN0IHNlcnZpY2VLZXkgPSBvcHRpb25zPy5zZXJ2aWNlS2V5ID8/IHJlYWRFbnYoJ0FJX1NFUlZJQ0VfS0VZJylcbiAgaWYgKCFzZXJ2aWNlS2V5KSB7XG4gICAgdGhyb3cgbmV3IEFpQ2xpZW50RXJyb3IoJ0FJX1NFUlZJQ0VfS0VZIGlzIG5vdCBjb25maWd1cmVkJylcbiAgfVxuXG4gIGNvbnN0IGZldGNoSW1wbCA9IG9wdGlvbnM/LmZldGNoSW1wbCA/PyBmZXRjaFxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaEltcGwoXG4gICAgYCR7YmFzZVVybH0vdjEvdXNlLWNhc2VzLyR7dXNlQ2FzZUlkfS9ydW5gLFxuICAgIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c2VydmljZUtleX1gLFxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBmcm9tOiBpbnB1dC5mcm9tLFxuICAgICAgICAgIHN1YmplY3Q6IGlucHV0LnN1YmplY3QsXG4gICAgICAgICAgdGV4dEJvZHk6IGlucHV0LnRleHRCb2R5ID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICBodG1sQm9keTogaW5wdXQuaHRtbEJvZHkgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgIGhpbnRzOiBpbnB1dC5oaW50cyA/PyB1bmRlZmluZWQsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9LFxuICApXG5cbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKS5jYXRjaCgoKSA9PiAnJylcbiAgICB0aHJvdyBuZXcgQWlDbGllbnRFcnJvcihcbiAgICAgIGBhaS1hcGkgZXJyb3IgJHtyZXMuc3RhdHVzfTogJHt0ZXh0LnNsaWNlKDAsIDMwMCl9YCxcbiAgICApXG4gIH1cblxuICBjb25zdCBib2R5ID0gYXdhaXQgcmVzLmpzb24oKSBhcyB7IG91dHB1dD86IFQgfVxuICBpZiAoIWJvZHkub3V0cHV0KSB7XG4gICAgdGhyb3cgbmV3IEFpQ2xpZW50RXJyb3IoJ2FpLWFwaSByZXNwb25zZSBtaXNzaW5nIG91dHB1dCcpXG4gIH1cbiAgcmV0dXJuIGJvZHkub3V0cHV0XG59XG5cbi8qKlxuICogQ2FsbCBhaS1hcGkgZ2VuZXJhdGVfZW1haWxfc3BlbmRfdGVtcGxhdGUgdXNlIGNhc2UuXG4gKiBPdmVycmlkYWJsZSBmZXRjaCBmb3IgdGVzdHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUVtYWlsU3BlbmRUZW1wbGF0ZShcbiAgaW5wdXQ6IEdlbmVyYXRlVGVtcGxhdGVBaUlucHV0LFxuICBvcHRpb25zPzoge1xuICAgIGJhc2VVcmw/OiBzdHJpbmdcbiAgICBzZXJ2aWNlS2V5Pzogc3RyaW5nXG4gICAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoXG4gIH0sXG4pOiBQcm9taXNlPEdlbmVyYXRlQXBwcm92ZVRlbXBsYXRlQWlPdXRwdXQ+IHtcbiAgcmV0dXJuIGF3YWl0IHJ1bkFpVXNlQ2FzZTxHZW5lcmF0ZUFwcHJvdmVUZW1wbGF0ZUFpT3V0cHV0PihcbiAgICAnZ2VuZXJhdGVfZW1haWxfc3BlbmRfdGVtcGxhdGUnLFxuICAgIGlucHV0LFxuICAgIG9wdGlvbnMsXG4gIClcbn1cblxuLyoqXG4gKiBDYWxsIGFpLWFwaSBnZW5lcmF0ZV9lbWFpbF9yZWplY3RfdGVtcGxhdGUgdXNlIGNhc2UuXG4gKiBPdmVycmlkYWJsZSBmZXRjaCBmb3IgdGVzdHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUVtYWlsUmVqZWN0VGVtcGxhdGUoXG4gIGlucHV0OiBHZW5lcmF0ZVRlbXBsYXRlQWlJbnB1dCxcbiAgb3B0aW9ucz86IHtcbiAgICBiYXNlVXJsPzogc3RyaW5nXG4gICAgc2VydmljZUtleT86IHN0cmluZ1xuICAgIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaFxuICB9LFxuKTogUHJvbWlzZTxHZW5lcmF0ZVJlamVjdFRlbXBsYXRlQWlPdXRwdXQ+IHtcbiAgcmV0dXJuIGF3YWl0IHJ1bkFpVXNlQ2FzZTxHZW5lcmF0ZVJlamVjdFRlbXBsYXRlQWlPdXRwdXQ+KFxuICAgICdnZW5lcmF0ZV9lbWFpbF9yZWplY3RfdGVtcGxhdGUnLFxuICAgIGlucHV0LFxuICAgIG9wdGlvbnMsXG4gIClcbn1cblxuLyoqXG4gKiBDYWxsIGFpLWFwaSBjbGFzc2lmeV9lbWFpbF9zcGVuZF9yZWxldmFuY2UgdXNlIGNhc2UuXG4gKiBPdmVycmlkYWJsZSBmZXRjaCBmb3IgdGVzdHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjbGFzc2lmeUVtYWlsU3BlbmRSZWxldmFuY2UoXG4gIGlucHV0OiBHZW5lcmF0ZVRlbXBsYXRlQWlJbnB1dCxcbiAgb3B0aW9ucz86IHtcbiAgICBiYXNlVXJsPzogc3RyaW5nXG4gICAgc2VydmljZUtleT86IHN0cmluZ1xuICAgIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaFxuICB9LFxuKTogUHJvbWlzZTxDbGFzc2lmeUVtYWlsU3BlbmRSZWxldmFuY2VBaU91dHB1dD4ge1xuICByZXR1cm4gYXdhaXQgcnVuQWlVc2VDYXNlPENsYXNzaWZ5RW1haWxTcGVuZFJlbGV2YW5jZUFpT3V0cHV0PihcbiAgICAnY2xhc3NpZnlfZW1haWxfc3BlbmRfcmVsZXZhbmNlJyxcbiAgICBpbnB1dCxcbiAgICBvcHRpb25zLFxuICApXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHkgfSBmcm9tICdreXNlbHknXG5pbXBvcnQge1xuICBTUEVORElOR19DQU5ESURBVEVfS0lORCxcbiAgZXh0cmFjdFNwZW5kaW5nQ2FuZGlkYXRlcyxcbiAgbWVzc2FnZU1hdGNoZXNBbnlUZW1wbGF0ZSxcbiAgcGFyc2VTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyxcbiAgcmVzb2x2ZVRleHRCb2R5LFxuICB0eXBlIEVtYWlsTWVzc2FnZSxcbiAgdHlwZSBFeHRyYWN0aW9uQXJ0aWZhY3QsXG4gIHR5cGUgU3BlbmRQYXJzaW5nVGVtcGxhdGUsXG4gIHR5cGUgVGVtcGxhdGVNYXRjaFNwZWMsXG59IGZyb20gJ21haWxib3hfa2l0L21vZC50cydcbmltcG9ydCB0eXBlIHsgRGF0YWJhc2UgfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIEFwcGx5VGVtcGxhdGVzU3RvcmUgPSB7XG4gIGxpc3RFbmFibGVkVGVtcGxhdGVzKG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxcbiAgICBBcnJheTx7XG4gICAgICBpZDogbnVtYmVyXG4gICAgICBraW5kOiBzdHJpbmdcbiAgICAgIGVuYWJsZWQ6IGJvb2xlYW5cbiAgICAgIG1hdGNoX2Zyb21fcGF0dGVybjogc3RyaW5nXG4gICAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBzdHJpbmcgfCBudWxsXG4gICAgICBleHRyYWN0b3JzOiB1bmtub3duXG4gICAgfT5cbiAgPlxuICBsaXN0TWVzc2FnZXMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPFxuICAgIEFycmF5PHtcbiAgICAgIGlkOiBudW1iZXJcbiAgICAgIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICAgICAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICAgICAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgICAgIHN1YmplY3Q6IHN0cmluZ1xuICAgICAgcmVjZWl2ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgICAgIHRleHRfYm9keTogc3RyaW5nIHwgbnVsbFxuICAgICAgaHRtbF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gICAgfT5cbiAgPlxuICBsaXN0QXJ0aWZhY3RTdGF0dXNlcyhtZXNzYWdlSWRzOiBudW1iZXJbXSk6IFByb21pc2U8XG4gICAgQXJyYXk8eyBtZXNzYWdlX2lkOiBudW1iZXI7IHN0YXR1czogc3RyaW5nIH0+XG4gID5cbiAgcmVqZWN0UGVuZGluZ0Zvck1lc3NhZ2VzKFxuICAgIG1lc3NhZ2VJZHM6IG51bWJlcltdLFxuICAgIHVwZGF0ZWRBdDogc3RyaW5nLFxuICApOiBQcm9taXNlPG51bWJlcj5cbiAgaW5zZXJ0QXJ0aWZhY3QoXG4gICAgbWVzc2FnZUlkOiBudW1iZXIsXG4gICAgYXJ0OiBFeHRyYWN0aW9uQXJ0aWZhY3QsXG4gICAgbm93OiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUt5c2VseUFwcGx5VGVtcGxhdGVzU3RvcmUoXG4gIGRiOiBLeXNlbHk8RGF0YWJhc2U+LFxuKTogQXBwbHlUZW1wbGF0ZXNTdG9yZSB7XG4gIHJldHVybiB7XG4gICAgYXN5bmMgbGlzdEVuYWJsZWRUZW1wbGF0ZXMobWFpbGJveElkKSB7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgICAgLnNlbGVjdChbXG4gICAgICAgICAgJ2lkJyxcbiAgICAgICAgICAna2luZCcsXG4gICAgICAgICAgJ2VuYWJsZWQnLFxuICAgICAgICAgICdtYXRjaF9mcm9tX3BhdHRlcm4nLFxuICAgICAgICAgICdtYXRjaF9zdWJqZWN0X3JlZ2V4JyxcbiAgICAgICAgICAnZXh0cmFjdG9ycycsXG4gICAgICAgIF0pXG4gICAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgICAud2hlcmUoJ2VuYWJsZWQnLCAnPScsIHRydWUpXG4gICAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfSxcbiAgICBhc3luYyBsaXN0TWVzc2FnZXMobWFpbGJveElkKSB7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ21lc3NhZ2VzJylcbiAgICAgICAgLnNlbGVjdChbXG4gICAgICAgICAgJ2lkJyxcbiAgICAgICAgICAncHJvdmlkZXJfbWVzc2FnZV9pZCcsXG4gICAgICAgICAgJ3JmY19tZXNzYWdlX2lkJyxcbiAgICAgICAgICAnZnJvbV9hZGRyZXNzJyxcbiAgICAgICAgICAnc3ViamVjdCcsXG4gICAgICAgICAgJ3JlY2VpdmVkX2F0JyxcbiAgICAgICAgICAndGV4dF9ib2R5JyxcbiAgICAgICAgICAnaHRtbF9ib2R5JyxcbiAgICAgICAgXSlcbiAgICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICB9LFxuICAgIGFzeW5jIGxpc3RBcnRpZmFjdFN0YXR1c2VzKG1lc3NhZ2VJZHMpIHtcbiAgICAgIGlmIChtZXNzYWdlSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdXG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgLnNlbGVjdChbJ21lc3NhZ2VfaWQnLCAnc3RhdHVzJ10pXG4gICAgICAgIC53aGVyZSgnbWVzc2FnZV9pZCcsICdpbicsIG1lc3NhZ2VJZHMpXG4gICAgICAgIC53aGVyZSgna2luZCcsICc9JywgU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICB9LFxuICAgIGFzeW5jIHJlamVjdFBlbmRpbmdGb3JNZXNzYWdlcyhtZXNzYWdlSWRzLCB1cGRhdGVkQXQpIHtcbiAgICAgIGlmIChtZXNzYWdlSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuc2V0KHsgc3RhdHVzOiAncmVqZWN0ZWQnLCB1cGRhdGVkX2F0OiB1cGRhdGVkQXQgfSlcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdwZW5kaW5nJylcbiAgICAgICAgLndoZXJlKCdraW5kJywgJz0nLCBTUEVORElOR19DQU5ESURBVEVfS0lORClcbiAgICAgICAgLndoZXJlKCdtZXNzYWdlX2lkJywgJ2luJywgbWVzc2FnZUlkcylcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgcmV0dXJuIE51bWJlcihyZXN1bHQubnVtVXBkYXRlZFJvd3MgPz8gMClcbiAgICB9LFxuICAgIGFzeW5jIGluc2VydEFydGlmYWN0KG1lc3NhZ2VJZCwgYXJ0LCBub3cpIHtcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC5pbnNlcnRJbnRvKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIG1lc3NhZ2VfaWQ6IG1lc3NhZ2VJZCxcbiAgICAgICAgICBraW5kOiBhcnQua2luZCxcbiAgICAgICAgICBwYXlsb2FkOiBhcnQucGF5bG9hZCxcbiAgICAgICAgICBjb25maWRlbmNlOiBhcnQuY29uZmlkZW5jZSxcbiAgICAgICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcbiAgICAgICAgICBwdWJsaXNoZWRfZXhwZW5zZV9pZDogbnVsbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9KVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfSxcbiAgfVxufVxuXG5leHBvcnQgdHlwZSBBcHBseVRlbXBsYXRlc1Jlc3VsdCA9IHtcbiAgcmVqZWN0ZWRQZW5kaW5nOiBudW1iZXJcbiAgaW5zZXJ0ZWRBcnRpZmFjdHM6IG51bWJlclxufVxuXG4vKipcbiAqIFJlLWFwcGx5IGVuYWJsZWQgdGVtcGxhdGVzIHRvIGFsbCBzdG9yZWQgbWVzc2FnZXMgaW4gYSBtYWlsYm94LlxuICogUmVqZWN0IG1hdGNoZXMgZHJvcCBwZW5kaW5nIGNhbmRpZGF0ZXM7IGFwcHJvdmUgbWF0Y2hlcyBpbnNlcnQgcGVuZGluZ1xuICogY2FuZGlkYXRlcyB3aGVuIHRoZSBtZXNzYWdlIGhhcyBubyBwZW5kaW5nL2FjY2VwdGVkIHNwZW5kaW5nIGFydGlmYWN0IHlldC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFwcGx5VGVtcGxhdGVzVG9NYWlsYm94KFxuICBzdG9yZTogQXBwbHlUZW1wbGF0ZXNTdG9yZSxcbiAgbWFpbGJveElkOiBudW1iZXIsXG4gIG5vdzogc3RyaW5nID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuKTogUHJvbWlzZTxBcHBseVRlbXBsYXRlc1Jlc3VsdD4ge1xuICBjb25zdCByb3dzID0gYXdhaXQgc3RvcmUubGlzdEVuYWJsZWRUZW1wbGF0ZXMobWFpbGJveElkKVxuICBjb25zdCByZWplY3RUZW1wbGF0ZXM6IFRlbXBsYXRlTWF0Y2hTcGVjW10gPSBbXVxuICBjb25zdCBhcHByb3ZlVGVtcGxhdGVzOiBTcGVuZFBhcnNpbmdUZW1wbGF0ZVtdID0gW11cblxuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgY29uc3QgbWF0Y2g6IFRlbXBsYXRlTWF0Y2hTcGVjID0ge1xuICAgICAgbWF0Y2hGcm9tUGF0dGVybjogcm93Lm1hdGNoX2Zyb21fcGF0dGVybixcbiAgICAgIG1hdGNoU3ViamVjdFJlZ2V4OiByb3cubWF0Y2hfc3ViamVjdF9yZWdleCxcbiAgICAgIGVuYWJsZWQ6IHJvdy5lbmFibGVkLFxuICAgIH1cbiAgICBpZiAocm93LmtpbmQgPT09ICdyZWplY3QnKSB7XG4gICAgICByZWplY3RUZW1wbGF0ZXMucHVzaChtYXRjaClcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICAgIGNvbnN0IGV4dHJhY3RvcnMgPSBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzKHJvdy5leHRyYWN0b3JzKVxuICAgIGlmICghZXh0cmFjdG9ycykgY29udGludWVcbiAgICBhcHByb3ZlVGVtcGxhdGVzLnB1c2goe1xuICAgICAgaWQ6IHJvdy5pZCxcbiAgICAgIG1hdGNoRnJvbVBhdHRlcm46IHJvdy5tYXRjaF9mcm9tX3BhdHRlcm4sXG4gICAgICBtYXRjaFN1YmplY3RSZWdleDogcm93Lm1hdGNoX3N1YmplY3RfcmVnZXgsXG4gICAgICBleHRyYWN0b3JzLFxuICAgICAgZW5hYmxlZDogcm93LmVuYWJsZWQsXG4gICAgfSlcbiAgfVxuXG4gIGNvbnN0IG1lc3NhZ2VzID0gYXdhaXQgc3RvcmUubGlzdE1lc3NhZ2VzKG1haWxib3hJZClcbiAgaWYgKG1lc3NhZ2VzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB7IHJlamVjdGVkUGVuZGluZzogMCwgaW5zZXJ0ZWRBcnRpZmFjdHM6IDAgfVxuICB9XG5cbiAgY29uc3Qgc3RhdHVzZXMgPSBhd2FpdCBzdG9yZS5saXN0QXJ0aWZhY3RTdGF0dXNlcyhtZXNzYWdlcy5tYXAoKG0pID0+IG0uaWQpKVxuICBjb25zdCBzdGF0dXNCeU1lc3NhZ2UgPSBuZXcgTWFwPG51bWJlciwgU2V0PHN0cmluZz4+KClcbiAgZm9yIChjb25zdCBzIG9mIHN0YXR1c2VzKSB7XG4gICAgbGV0IHNldCA9IHN0YXR1c0J5TWVzc2FnZS5nZXQocy5tZXNzYWdlX2lkKVxuICAgIGlmICghc2V0KSB7XG4gICAgICBzZXQgPSBuZXcgU2V0KClcbiAgICAgIHN0YXR1c0J5TWVzc2FnZS5zZXQocy5tZXNzYWdlX2lkLCBzZXQpXG4gICAgfVxuICAgIHNldC5hZGQocy5zdGF0dXMpXG4gIH1cblxuICBjb25zdCByZWplY3RNZXNzYWdlSWRzOiBudW1iZXJbXSA9IFtdXG4gIGxldCBpbnNlcnRlZEFydGlmYWN0cyA9IDBcblxuICBmb3IgKGNvbnN0IHJvdyBvZiBtZXNzYWdlcykge1xuICAgIGNvbnN0IGVtYWlsID0gcm93VG9FbWFpbE1lc3NhZ2Uocm93KVxuICAgIGlmIChtZXNzYWdlTWF0Y2hlc0FueVRlbXBsYXRlKGVtYWlsLCByZWplY3RUZW1wbGF0ZXMpKSB7XG4gICAgICByZWplY3RNZXNzYWdlSWRzLnB1c2gocm93LmlkKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZyA9IHN0YXR1c0J5TWVzc2FnZS5nZXQocm93LmlkKVxuICAgIGlmIChleGlzdGluZz8uaGFzKCdwZW5kaW5nJykgfHwgZXhpc3Rpbmc/LmhhcygnYWNjZXB0ZWQnKSkgY29udGludWVcblxuICAgIGNvbnN0IGFydHMgPSBleHRyYWN0U3BlbmRpbmdDYW5kaWRhdGVzKGVtYWlsLCB7XG4gICAgICByZWplY3RUZW1wbGF0ZXM6IFtdLFxuICAgICAgYXBwcm92ZVRlbXBsYXRlcyxcbiAgICB9KVxuICAgIGZvciAoY29uc3QgYXJ0IG9mIGFydHMpIHtcbiAgICAgIGF3YWl0IHN0b3JlLmluc2VydEFydGlmYWN0KHJvdy5pZCwgYXJ0LCBub3cpXG4gICAgICBpbnNlcnRlZEFydGlmYWN0cyArPSAxXG4gICAgfVxuICB9XG5cbiAgY29uc3QgcmVqZWN0ZWRQZW5kaW5nID0gYXdhaXQgc3RvcmUucmVqZWN0UGVuZGluZ0Zvck1lc3NhZ2VzKFxuICAgIHJlamVjdE1lc3NhZ2VJZHMsXG4gICAgbm93LFxuICApXG5cbiAgcmV0dXJuIHsgcmVqZWN0ZWRQZW5kaW5nLCBpbnNlcnRlZEFydGlmYWN0cyB9XG59XG5cbmZ1bmN0aW9uIHJvd1RvRW1haWxNZXNzYWdlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gIGZyb21fYWRkcmVzczogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB0ZXh0X2JvZHk6IHN0cmluZyB8IG51bGxcbiAgaHRtbF9ib2R5OiBzdHJpbmcgfCBudWxsXG59KTogRW1haWxNZXNzYWdlIHtcbiAgY29uc3QgcmVjZWl2ZWRBdCA9IHJvdy5yZWNlaXZlZF9hdCBpbnN0YW5jZW9mIERhdGVcbiAgICA/IHJvdy5yZWNlaXZlZF9hdFxuICAgIDogbmV3IERhdGUocm93LnJlY2VpdmVkX2F0KVxuICBjb25zdCB0ZXh0Qm9keSA9IHJlc29sdmVUZXh0Qm9keShyb3cudGV4dF9ib2R5LCByb3cuaHRtbF9ib2R5KVxuICByZXR1cm4ge1xuICAgIGlkOiByb3cucHJvdmlkZXJfbWVzc2FnZV9pZCxcbiAgICByZmNNZXNzYWdlSWQ6IHJvdy5yZmNfbWVzc2FnZV9pZCxcbiAgICBmcm9tOiByb3cuZnJvbV9hZGRyZXNzLFxuICAgIHN1YmplY3Q6IHJvdy5zdWJqZWN0LFxuICAgIHJlY2VpdmVkQXQsXG4gICAgdGV4dEJvZHksXG4gICAgaHRtbEJvZHk6IHJvdy5odG1sX2JvZHksXG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHsgRGF0YWJhc2UsIE1haWxib3hlc1RhYmxlIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHR5cGUgeyBTZWxlY3RhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG5leHBvcnQgdHlwZSBNYWlsYm94Um93ID0gU2VsZWN0YWJsZTxNYWlsYm94ZXNUYWJsZT5cblxuLyoqIE1pbmltYWwgc3RvcmUgc28gY2xlYXIgLyByZWplY3QtYWxsIGNhbiBiZSB1bml0LXRlc3RlZCB3aXRob3V0IFBvc3RncmVzLiAqL1xuZXhwb3J0IHR5cGUgSW5ib3hPcHNTdG9yZSA9IHtcbiAgZGVsZXRlTWVzc2FnZXMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPG51bWJlcj5cbiAgZGVsZXRlU3luY1J1bnMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPG51bWJlcj5cbiAgcmVzZXRNYWlsYm94U3luY1N0YXRlKFxuICAgIG1haWxib3hJZDogbnVtYmVyLFxuICAgIHVwZGF0ZWRBdDogc3RyaW5nLFxuICApOiBQcm9taXNlPE1haWxib3hSb3c+XG4gIHJlamVjdFBlbmRpbmdBcnRpZmFjdHMoXG4gICAgbWFpbGJveElkOiBudW1iZXIsXG4gICAgdXBkYXRlZEF0OiBzdHJpbmcsXG4gICk6IFByb21pc2U8bnVtYmVyPlxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlS3lzZWx5SW5ib3hPcHNTdG9yZShcbiAgZGI6IEt5c2VseTxEYXRhYmFzZT4sXG4pOiBJbmJveE9wc1N0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBhc3luYyBkZWxldGVNZXNzYWdlcyhtYWlsYm94SWQpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAgIC5kZWxldGVGcm9tKCdtZXNzYWdlcycpXG4gICAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICByZXR1cm4gTnVtYmVyKHJlc3VsdC5udW1EZWxldGVkUm93cyA/PyAwKVxuICAgIH0sXG4gICAgYXN5bmMgZGVsZXRlU3luY1J1bnMobWFpbGJveElkKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgICAuZGVsZXRlRnJvbSgnc3luY19ydW5zJylcbiAgICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIHJldHVybiBOdW1iZXIocmVzdWx0Lm51bURlbGV0ZWRSb3dzID8/IDApXG4gICAgfSxcbiAgICBhc3luYyByZXNldE1haWxib3hTeW5jU3RhdGUobWFpbGJveElkLCB1cGRhdGVkQXQpIHtcbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ21haWxib3hlcycpXG4gICAgICAgIC5zZXQoe1xuICAgICAgICAgIHN5bmNfY3Vyc29yOiBudWxsLFxuICAgICAgICAgIHN5bmNfYmFja2ZpbGxfY3Vyc29yOiBudWxsLFxuICAgICAgICAgIHN5bmNfc2luY2U6IG51bGwsXG4gICAgICAgICAgc3luY191bnRpbDogbnVsbCxcbiAgICAgICAgICBzeW5jX3JlcXVlc3RlZDogZmFsc2UsXG4gICAgICAgICAgbGFzdF9zeW5jZWRfYXQ6IG51bGwsXG4gICAgICAgICAgdXBkYXRlZF9hdDogdXBkYXRlZEF0LFxuICAgICAgICB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIH0sXG4gICAgYXN5bmMgcmVqZWN0UGVuZGluZ0FydGlmYWN0cyhtYWlsYm94SWQsIHVwZGF0ZWRBdCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXM6ICdyZWplY3RlZCcsIHVwZGF0ZWRfYXQ6IHVwZGF0ZWRBdCB9KVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ3BlbmRpbmcnKVxuICAgICAgICAud2hlcmUoXG4gICAgICAgICAgJ21lc3NhZ2VfaWQnLFxuICAgICAgICAgICdpbicsXG4gICAgICAgICAgZGJcbiAgICAgICAgICAgIC5zZWxlY3RGcm9tKCdtZXNzYWdlcycpXG4gICAgICAgICAgICAuc2VsZWN0KCdpZCcpXG4gICAgICAgICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZCksXG4gICAgICAgIClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgcmV0dXJuIE51bWJlcihyZXN1bHQubnVtVXBkYXRlZFJvd3MgPz8gMClcbiAgICB9LFxuICB9XG59XG5cbi8qKlxuICogV2lwZSBzeW5jZWQgbWVzc2FnZXMgKGFydGlmYWN0cyBjYXNjYWRlKSwgc3luYyBydW5zLCBhbmQgcmVzZXQgc3luYyBjdXJzb3JzLlxuICogRG9lcyBub3QgcmVtb3ZlIGRvbWFpbiBmaWx0ZXJzLCBwYXJzaW5nIHRlbXBsYXRlcywgb3IgdGhlIG1haWxib3ggaXRzZWxmLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2xlYXJJbmJveERhdGEoXG4gIHN0b3JlOiBJbmJveE9wc1N0b3JlLFxuICBtYWlsYm94SWQ6IG51bWJlcixcbiAgbm93OiBzdHJpbmcgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4pOiBQcm9taXNlPE1haWxib3hSb3c+IHtcbiAgYXdhaXQgc3RvcmUuZGVsZXRlTWVzc2FnZXMobWFpbGJveElkKVxuICBhd2FpdCBzdG9yZS5kZWxldGVTeW5jUnVucyhtYWlsYm94SWQpXG4gIHJldHVybiBhd2FpdCBzdG9yZS5yZXNldE1haWxib3hTeW5jU3RhdGUobWFpbGJveElkLCBub3cpXG59XG5cbi8qKiBSZWplY3QgYWxsIHBlbmRpbmcgZXh0cmFjdGlvbiBhcnRpZmFjdHMgZm9yIGEgbWFpbGJveC4gUmV0dXJucyB1cGRhdGVkIGNvdW50LiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlamVjdEFsbFBlbmRpbmdBcnRpZmFjdHMoXG4gIHN0b3JlOiBJbmJveE9wc1N0b3JlLFxuICBtYWlsYm94SWQ6IG51bWJlcixcbiAgbm93OiBzdHJpbmcgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4pOiBQcm9taXNlPG51bWJlcj4ge1xuICByZXR1cm4gYXdhaXQgc3RvcmUucmVqZWN0UGVuZGluZ0FydGlmYWN0cyhtYWlsYm94SWQsIG5vdylcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7XG4gIFNQRU5ESU5HX0NBTkRJREFURV9LSU5ELFxuICBUZW1wbGF0ZVNwZW5kaW5nRXh0cmFjdG9yLFxuICBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzLFxuICByZXNvbHZlVGV4dEJvZHksXG4gIHR5cGUgRW1haWxNZXNzYWdlLFxuICB0eXBlIFNwZW5kUGFyc2luZ1RlbXBsYXRlLFxuICB0eXBlIFNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzLFxufSBmcm9tICdtYWlsYm94X2tpdC9tb2QudHMnXG5pbXBvcnQgdHlwZSB7IERhdGFiYXNlIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuXG4vKiogVGVtcGxhdGUgZmllbGRzIG5lZWRlZCB0byByZS1leHRyYWN0IHBlbmRpbmcgcmV2aWV3IGFydGlmYWN0cy4gKi9cbmV4cG9ydCB0eXBlIFJlZXZhbHVhdGVUZW1wbGF0ZUlucHV0ID0ge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBraW5kOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBtYXRjaF9mcm9tX3BhdHRlcm46IHN0cmluZ1xuICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IHVua25vd25cbn1cblxuZXhwb3J0IHR5cGUgUGVuZGluZ0FydGlmYWN0Um93ID0ge1xuICBhcnRpZmFjdF9pZDogbnVtYmVyXG4gIG1lc3NhZ2VfaWQ6IG51bWJlclxuICBwcm92aWRlcl9tZXNzYWdlX2lkOiBzdHJpbmdcbiAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keTogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgdHlwZSBUZW1wbGF0ZVJlZXZhbHVhdGVTdG9yZSA9IHtcbiAgbGlzdFBlbmRpbmdBcnRpZmFjdHMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPFBlbmRpbmdBcnRpZmFjdFJvd1tdPlxuICB1cGRhdGVBcnRpZmFjdChcbiAgICBhcnRpZmFjdElkOiBudW1iZXIsXG4gICAgcGF5bG9hZDogdW5rbm93bixcbiAgICBjb25maWRlbmNlOiBudW1iZXIsXG4gICAgdXBkYXRlZEF0OiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUt5c2VseVRlbXBsYXRlUmVldmFsdWF0ZVN0b3JlKFxuICBkYjogS3lzZWx5PERhdGFiYXNlPixcbik6IFRlbXBsYXRlUmVldmFsdWF0ZVN0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBhc3luYyBsaXN0UGVuZGluZ0FydGlmYWN0cyhtYWlsYm94SWQpIHtcbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuaW5uZXJKb2luKFxuICAgICAgICAgICdtZXNzYWdlcycsXG4gICAgICAgICAgJ21lc3NhZ2VzLmlkJyxcbiAgICAgICAgICAnZXh0cmFjdGlvbl9hcnRpZmFjdHMubWVzc2FnZV9pZCcsXG4gICAgICAgIClcbiAgICAgICAgLnNlbGVjdChbXG4gICAgICAgICAgJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLmlkIGFzIGFydGlmYWN0X2lkJyxcbiAgICAgICAgICAnbWVzc2FnZXMuaWQgYXMgbWVzc2FnZV9pZCcsXG4gICAgICAgICAgJ21lc3NhZ2VzLnByb3ZpZGVyX21lc3NhZ2VfaWQnLFxuICAgICAgICAgICdtZXNzYWdlcy5yZmNfbWVzc2FnZV9pZCcsXG4gICAgICAgICAgJ21lc3NhZ2VzLmZyb21fYWRkcmVzcycsXG4gICAgICAgICAgJ21lc3NhZ2VzLnN1YmplY3QnLFxuICAgICAgICAgICdtZXNzYWdlcy5yZWNlaXZlZF9hdCcsXG4gICAgICAgICAgJ21lc3NhZ2VzLnRleHRfYm9keScsXG4gICAgICAgICAgJ21lc3NhZ2VzLmh0bWxfYm9keScsXG4gICAgICAgIF0pXG4gICAgICAgIC53aGVyZSgnbWVzc2FnZXMubWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgICAud2hlcmUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLnN0YXR1cycsICc9JywgJ3BlbmRpbmcnKVxuICAgICAgICAud2hlcmUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLmtpbmQnLCAnPScsIFNQRU5ESU5HX0NBTkRJREFURV9LSU5EKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfSxcbiAgICBhc3luYyB1cGRhdGVBcnRpZmFjdChhcnRpZmFjdElkLCBwYXlsb2FkLCBjb25maWRlbmNlLCB1cGRhdGVkQXQpIHtcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICBwYXlsb2FkLFxuICAgICAgICAgIGNvbmZpZGVuY2UsXG4gICAgICAgICAgdXBkYXRlZF9hdDogdXBkYXRlZEF0LFxuICAgICAgICB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcnRpZmFjdElkKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfSxcbiAgfVxufVxuXG4vKipcbiAqIFJlLXJ1biBhbiBhcHByb3ZlIHRlbXBsYXRlIGFnYWluc3QgcGVuZGluZyBzcGVuZGluZyBjYW5kaWRhdGVzIGluIGl0c1xuICogbWFpbGJveC4gTWF0Y2hpbmcgbWVzc2FnZXMgdGhhdCBleHRyYWN0IHN1Y2Nlc3NmdWxseSBoYXZlIHRoZWlyIHBlbmRpbmdcbiAqIGFydGlmYWN0IHBheWxvYWQvY29uZmlkZW5jZSB1cGRhdGVkIGluIHBsYWNlLiBFeHRyYWN0IG1pc3NlcyBhcmUgbGVmdCBhbG9uZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZXZhbHVhdGVQZW5kaW5nV2l0aFRlbXBsYXRlKFxuICBzdG9yZTogVGVtcGxhdGVSZWV2YWx1YXRlU3RvcmUsXG4gIHRlbXBsYXRlOiBSZWV2YWx1YXRlVGVtcGxhdGVJbnB1dCxcbiAgbm93OiBzdHJpbmcgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4pOiBQcm9taXNlPG51bWJlcj4ge1xuICBpZiAodGVtcGxhdGUua2luZCAhPT0gJ2FwcHJvdmUnIHx8ICF0ZW1wbGF0ZS5lbmFibGVkKSByZXR1cm4gMFxuXG4gIGNvbnN0IHNwZW5kVGVtcGxhdGUgPSB0b1NwZW5kUGFyc2luZ1RlbXBsYXRlKHRlbXBsYXRlKVxuICBpZiAoIXNwZW5kVGVtcGxhdGUpIHJldHVybiAwXG5cbiAgY29uc3QgZXh0cmFjdG9yID0gbmV3IFRlbXBsYXRlU3BlbmRpbmdFeHRyYWN0b3Ioc3BlbmRUZW1wbGF0ZSlcbiAgY29uc3QgcGVuZGluZyA9IGF3YWl0IHN0b3JlLmxpc3RQZW5kaW5nQXJ0aWZhY3RzKHRlbXBsYXRlLm1haWxib3hfaWQpXG4gIGxldCB1cGRhdGVkID0gMFxuXG4gIGZvciAoY29uc3Qgcm93IG9mIHBlbmRpbmcpIHtcbiAgICBjb25zdCBlbWFpbCA9IHJvd1RvRW1haWxNZXNzYWdlKHJvdylcbiAgICBpZiAoIWV4dHJhY3Rvci5jYW5IYW5kbGUoZW1haWwpKSBjb250aW51ZVxuICAgIGNvbnN0IGFydHMgPSBleHRyYWN0b3IuZXh0cmFjdChlbWFpbClcbiAgICBjb25zdCBhcnQgPSBhcnRzWzBdXG4gICAgaWYgKCFhcnQpIGNvbnRpbnVlXG5cbiAgICBhd2FpdCBzdG9yZS51cGRhdGVBcnRpZmFjdChcbiAgICAgIHJvdy5hcnRpZmFjdF9pZCxcbiAgICAgIGFydC5wYXlsb2FkLFxuICAgICAgYXJ0LmNvbmZpZGVuY2UsXG4gICAgICBub3csXG4gICAgKVxuICAgIHVwZGF0ZWQgKz0gMVxuICB9XG5cbiAgcmV0dXJuIHVwZGF0ZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvU3BlbmRQYXJzaW5nVGVtcGxhdGUoXG4gIHRlbXBsYXRlOiBSZWV2YWx1YXRlVGVtcGxhdGVJbnB1dCxcbik6IFNwZW5kUGFyc2luZ1RlbXBsYXRlIHwgbnVsbCB7XG4gIGNvbnN0IGV4dHJhY3RvcnMgPSBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzKHRlbXBsYXRlLmV4dHJhY3RvcnMpXG4gIGlmICghZXh0cmFjdG9ycykgcmV0dXJuIG51bGxcbiAgcmV0dXJuIHtcbiAgICBpZDogdGVtcGxhdGUuaWQsXG4gICAgbWF0Y2hGcm9tUGF0dGVybjogdGVtcGxhdGUubWF0Y2hfZnJvbV9wYXR0ZXJuLFxuICAgIG1hdGNoU3ViamVjdFJlZ2V4OiB0ZW1wbGF0ZS5tYXRjaF9zdWJqZWN0X3JlZ2V4LFxuICAgIGV4dHJhY3RvcnM6IGV4dHJhY3RvcnMgYXMgU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMsXG4gICAgZW5hYmxlZDogdGVtcGxhdGUuZW5hYmxlZCxcbiAgfVxufVxuXG5mdW5jdGlvbiByb3dUb0VtYWlsTWVzc2FnZShyb3c6IHtcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHRleHRfYm9keTogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk6IHN0cmluZyB8IG51bGxcbn0pOiBFbWFpbE1lc3NhZ2Uge1xuICBjb25zdCByZWNlaXZlZEF0ID0gcm93LnJlY2VpdmVkX2F0IGluc3RhbmNlb2YgRGF0ZVxuICAgID8gcm93LnJlY2VpdmVkX2F0XG4gICAgOiBuZXcgRGF0ZShyb3cucmVjZWl2ZWRfYXQpXG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5wcm92aWRlcl9tZXNzYWdlX2lkLFxuICAgIHJmY01lc3NhZ2VJZDogcm93LnJmY19tZXNzYWdlX2lkLFxuICAgIGZyb206IHJvdy5mcm9tX2FkZHJlc3MsXG4gICAgc3ViamVjdDogcm93LnN1YmplY3QsXG4gICAgcmVjZWl2ZWRBdCxcbiAgICB0ZXh0Qm9keTogcmVzb2x2ZVRleHRCb2R5KHJvdy50ZXh0X2JvZHksIHJvdy5odG1sX2JvZHkpLFxuICAgIGh0bWxCb2R5OiByb3cuaHRtbF9ib2R5LFxuICB9XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGFzSXNvVGltZXN0YW1wKHZhbHVlOiBEYXRlIHwgc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKVxuICBpZiAoL15cXGR7MTAsfSQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICBjb25zdCBuID0gTnVtYmVyKHRyaW1tZWQpXG4gICAgY29uc3QgbXMgPSB0cmltbWVkLmxlbmd0aCA8PSAxMCA/IG4gKiAxMDAwIDogblxuICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXNJc29UaW1lc3RhbXBPck51bGwoXG4gIHZhbHVlOiBEYXRlIHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIGFzSXNvVGltZXN0YW1wKHZhbHVlKVxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5IH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBEYXRhYmFzZSB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGFzSXNvVGltZXN0YW1wIH0gZnJvbSAnLi4vZ3JhcGhxbC90aW1lc3RhbXBzLnRzJ1xuXG4vKiogR3JhcGhRTCBNZXNzYWdlIHNoYXBlIChJU08gdGltZXN0YW1wcyBhcyBzdHJpbmdzKS4gKi9cbmV4cG9ydCB0eXBlIE93bmVkTWVzc2FnZSA9IHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBzdHJpbmdcbiAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keTogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IHR5cGUgTWVzc2FnZUpvaW5Sb3cgPSB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gIGZyb21fYWRkcmVzczogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB0ZXh0X2JvZHk6IHN0cmluZyB8IG51bGxcbiAgaHRtbF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn1cblxuLyoqIE1pbmltYWwgc3RvcmUgc28gb3duZXJzaGlwIC8gbWlzc2luZyBwYXRocyBjYW4gYmUgdW5pdC10ZXN0ZWQgd2l0aG91dCBQb3N0Z3Jlcy4gKi9cbmV4cG9ydCB0eXBlIE1lc3NhZ2VMb29rdXBTdG9yZSA9IHtcbiAgZmluZE93bmVkTWVzc2FnZVJvdyhcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBtZXNzYWdlSWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTxNZXNzYWdlSm9pblJvdyB8IHVuZGVmaW5lZD5cbiAgZmluZFNvdXJjZU1lc3NhZ2VSb3coXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgZXhwZW5zZUlkOiBudW1iZXIsXG4gICk6IFByb21pc2U8TWVzc2FnZUpvaW5Sb3cgfCB1bmRlZmluZWQ+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXBPd25lZE1lc3NhZ2Uocm93OiBNZXNzYWdlSm9pblJvdyk6IE93bmVkTWVzc2FnZSB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtYWlsYm94X2lkOiByb3cubWFpbGJveF9pZCxcbiAgICBwcm92aWRlcl9tZXNzYWdlX2lkOiByb3cucHJvdmlkZXJfbWVzc2FnZV9pZCxcbiAgICByZmNfbWVzc2FnZV9pZDogcm93LnJmY19tZXNzYWdlX2lkLFxuICAgIGZyb21fYWRkcmVzczogcm93LmZyb21fYWRkcmVzcyxcbiAgICBzdWJqZWN0OiByb3cuc3ViamVjdCxcbiAgICByZWNlaXZlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnJlY2VpdmVkX2F0KSxcbiAgICB0ZXh0X2JvZHk6IHJvdy50ZXh0X2JvZHkgPz8gbnVsbCxcbiAgICBodG1sX2JvZHk6IHJvdy5odG1sX2JvZHkgPz8gbnVsbCxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUt5c2VseU1lc3NhZ2VMb29rdXBTdG9yZShcbiAgZGI6IEt5c2VseTxEYXRhYmFzZT4sXG4pOiBNZXNzYWdlTG9va3VwU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGFzeW5jIGZpbmRPd25lZE1lc3NhZ2VSb3codXNlcklkLCBtZXNzYWdlSWQpIHtcbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgICAuc2VsZWN0QWxsKCdtZXNzYWdlcycpXG4gICAgICAgIC53aGVyZSgnbWVzc2FnZXMuaWQnLCAnPScsIG1lc3NhZ2VJZClcbiAgICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgfSxcbiAgICBhc3luYyBmaW5kU291cmNlTWVzc2FnZVJvdyh1c2VySWQsIGV4cGVuc2VJZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5pbm5lckpvaW4oXG4gICAgICAgICAgJ21lc3NhZ2VzJyxcbiAgICAgICAgICAnbWVzc2FnZXMuaWQnLFxuICAgICAgICAgICdleHRyYWN0aW9uX2FydGlmYWN0cy5tZXNzYWdlX2lkJyxcbiAgICAgICAgKVxuICAgICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgICAuc2VsZWN0QWxsKCdtZXNzYWdlcycpXG4gICAgICAgIC53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMucHVibGlzaGVkX2V4cGVuc2VfaWQnLCAnPScsIGV4cGVuc2VJZClcbiAgICAgICAgLndoZXJlKCdleHRyYWN0aW9uX2FydGlmYWN0cy5zdGF0dXMnLCAnPScsICdhY2NlcHRlZCcpXG4gICAgICAgIC53aGVyZSgnbWFpbGJveGVzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLm9yZGVyQnkoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLmlkJywgJ2Rlc2MnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgfSxcbiAgfVxufVxuXG4vKiogVXNlci1zY29wZWQgbWVzc2FnZSBieSBpZC4gUmV0dXJucyBudWxsIHdoZW4gbWlzc2luZyBvciBub3Qgb3duZWQuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmluZE93bmVkTWVzc2FnZShcbiAgc3RvcmU6IE1lc3NhZ2VMb29rdXBTdG9yZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIG1lc3NhZ2VJZDogbnVtYmVyLFxuKTogUHJvbWlzZTxPd25lZE1lc3NhZ2UgfCBudWxsPiB7XG4gIGNvbnN0IHJvdyA9IGF3YWl0IHN0b3JlLmZpbmRPd25lZE1lc3NhZ2VSb3codXNlcklkLCBtZXNzYWdlSWQpXG4gIHJldHVybiByb3cgPyBtYXBPd25lZE1lc3NhZ2Uocm93KSA6IG51bGxcbn1cblxuLyoqXG4gKiBSZXZlcnNlIGxvb2t1cDogYWNjZXB0ZWQgYXJ0aWZhY3Qgd2l0aCBwdWJsaXNoZWRfZXhwZW5zZV9pZCBcdTIxOTIgc291cmNlIG1lc3NhZ2UuXG4gKiBSZXR1cm5zIG51bGwgd2hlbiBubyBtYXRjaGluZyBhY2NlcHRlZCBwdWJsaXNoIGV4aXN0cyBmb3IgdGhpcyB1c2VyLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmluZFNvdXJjZU1lc3NhZ2VGb3JFeHBlbnNlKFxuICBzdG9yZTogTWVzc2FnZUxvb2t1cFN0b3JlLFxuICB1c2VySWQ6IG51bWJlcixcbiAgZXhwZW5zZUlkOiBudW1iZXIsXG4pOiBQcm9taXNlPE93bmVkTWVzc2FnZSB8IG51bGw+IHtcbiAgY29uc3Qgcm93ID0gYXdhaXQgc3RvcmUuZmluZFNvdXJjZU1lc3NhZ2VSb3codXNlcklkLCBleHBlbnNlSWQpXG4gIHJldHVybiByb3cgPyBtYXBPd25lZE1lc3NhZ2Uocm93KSA6IG51bGxcbn1cbiIsICJpbXBvcnQgeyBlbnYgYXMgcmVhZEVudiB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMnXG5pbXBvcnQgdHlwZSB7IFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCB9IGZyb20gJ21haWxib3hfa2l0L21vZC50cydcblxuZXhwb3J0IGNsYXNzIFNwZW5kbWFuYWdlclNpbmtFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnU3BlbmRtYW5hZ2VyU2lua0Vycm9yJ1xuICB9XG59XG5cbmV4cG9ydCB0eXBlIFB1Ymxpc2hFeHBlbnNlUmVzdWx0ID0ge1xuICBleHBlbnNlSWQ6IG51bWJlclxufVxuXG4vKipcbiAqIFB1Ymxpc2ggYW4gYWNjZXB0ZWQgc3BlbmRpbmcgY2FuZGlkYXRlIHRvIHNwZW5kbWFuYWdlci1hcGkgdmlhIEdyYXBoUUwsXG4gKiBmb3J3YXJkaW5nIHRoZSBjYWxsZXIncyBTdXBlclRva2VucyBCZWFyZXIgSldULlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHVibGlzaEV4cGVuc2VUb1NwZW5kbWFuYWdlcihcbiAgY2FuZGlkYXRlOiBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQsXG4gIGNhdGVnb3J5SWQ6IG51bWJlcixcbiAgYXV0aG9yaXphdGlvbkhlYWRlcjogc3RyaW5nLFxuICBvcHRpb25zPzoge1xuICAgIGJhc2VVcmw/OiBzdHJpbmdcbiAgICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2hcbiAgfSxcbik6IFByb21pc2U8UHVibGlzaEV4cGVuc2VSZXN1bHQ+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICB0aHJvdyBuZXcgU3BlbmRtYW5hZ2VyU2lua0Vycm9yKCdtaXNzaW5nIEJlYXJlciBhdXRob3JpemF0aW9uJylcbiAgfVxuXG4gIGNvbnN0IGJhc2VVcmwgPSAob3B0aW9ucz8uYmFzZVVybCA/P1xuICAgIHJlYWRFbnYoJ1NQRU5ETUFOQUdFUl9BUElfQkFTRV9VUkwnKSA/P1xuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDInKS5yZXBsYWNlKC9cXC8kLywgJycpXG5cbiAgY29uc3Qgbm90ZSA9IGNhbmRpZGF0ZS5ub3RlPy50cmltKCkgfHxcbiAgICBbY2FuZGlkYXRlLm1lcmNoYW50LCBjYW5kaWRhdGUuc291cmNlU3ViamVjdF0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oJyBcdTIwMTQgJykgfHxcbiAgICBudWxsXG5cbiAgY29uc3QgcXVlcnkgPSBgXG4gICAgbXV0YXRpb24gQ3JlYXRlRXhwZW5zZSgkaW5wdXQ6IENyZWF0ZUV4cGVuc2VJbnB1dElucHV0ISkge1xuICAgICAgY3JlYXRlRXhwZW5zZShhcmdzOiB7IGlucHV0OiAkaW5wdXQgfSkge1xuICAgICAgICBpZFxuICAgICAgfVxuICAgIH1cbiAgYFxuXG4gIGNvbnN0IGZldGNoSW1wbCA9IG9wdGlvbnM/LmZldGNoSW1wbCA/PyBmZXRjaFxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaEltcGwoYCR7YmFzZVVybH0vZ3JhcGhxbGAsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzOiB7XG4gICAgICBBdXRob3JpemF0aW9uOiBhdXRob3JpemF0aW9uSGVhZGVyLFxuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIHF1ZXJ5LFxuICAgICAgdmFyaWFibGVzOiB7XG4gICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgY2F0ZWdvcnlJZCxcbiAgICAgICAgICBhbW91bnRDZW50czogY2FuZGlkYXRlLmFtb3VudENlbnRzLFxuICAgICAgICAgIHNwZW50T246IGNhbmRpZGF0ZS5zcGVudE9uLFxuICAgICAgICAgIGN1cnJlbmN5OiBjYW5kaWRhdGUuY3VycmVuY3ksXG4gICAgICAgICAgbm90ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSksXG4gIH0pXG5cbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKS5jYXRjaCgoKSA9PiAnJylcbiAgICB0aHJvdyBuZXcgU3BlbmRtYW5hZ2VyU2lua0Vycm9yKFxuICAgICAgYHNwZW5kbWFuYWdlciBIVFRQICR7cmVzLnN0YXR1c306ICR7dGV4dC5zbGljZSgwLCAzMDApfWAsXG4gICAgKVxuICB9XG5cbiAgY29uc3QgYm9keSA9IGF3YWl0IHJlcy5qc29uKCkgYXMge1xuICAgIGRhdGE/OiB7IGNyZWF0ZUV4cGVuc2U/OiB7IGlkOiBudW1iZXIgfSB9XG4gICAgZXJyb3JzPzogeyBtZXNzYWdlOiBzdHJpbmcgfVtdXG4gIH1cblxuICBpZiAoYm9keS5lcnJvcnM/Lmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBTcGVuZG1hbmFnZXJTaW5rRXJyb3IoXG4gICAgICBib2R5LmVycm9ycy5tYXAoKGUpID0+IGUubWVzc2FnZSkuam9pbignOyAnKSxcbiAgICApXG4gIH1cblxuICBjb25zdCBpZCA9IGJvZHkuZGF0YT8uY3JlYXRlRXhwZW5zZT8uaWRcbiAgaWYgKHR5cGVvZiBpZCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgU3BlbmRtYW5hZ2VyU2lua0Vycm9yKCdzcGVuZG1hbmFnZXIgcmVzcG9uc2UgbWlzc2luZyBleHBlbnNlIGlkJylcbiAgfVxuICByZXR1cm4geyBleHBlbnNlSWQ6IGlkIH1cbn1cbiIsICIvKiogR21haWwgT0F1dGggYXV0aG9yaXphdGlvbi1jb2RlIGhlbHBlcnMgKHN0YXJ0ICsgY2FsbGJhY2spLiAqL1xuXG5pbXBvcnQgeyBlbnYgYXMgcmVhZEVudiB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMnXG5cbmV4cG9ydCBjb25zdCBHTUFJTF9SRUFET05MWV9TQ09QRSA9XG4gICdodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9hdXRoL2dtYWlsLnJlYWRvbmx5J1xuXG5leHBvcnQgY29uc3QgR09PR0xFX0FVVEhPUklaRV9VUkwgPVxuICAnaHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29tL28vb2F1dGgyL3YyL2F1dGgnXG5cbmV4cG9ydCBjb25zdCBHT09HTEVfVE9LRU5fVVJMID0gJ2h0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuJ1xuXG5jb25zdCBTVEFURV9UVExfU0VDT05EUyA9IDEwICogNjBcblxuZXhwb3J0IGludGVyZmFjZSBHbWFpbE9BdXRoQ29uZmlnIHtcbiAgY2xpZW50SWQ6IHN0cmluZ1xuICBjbGllbnRTZWNyZXQ6IHN0cmluZ1xuICByZWRpcmVjdFVyaTogc3RyaW5nXG4gIHJldHVyblRvQWxsb3dsaXN0OiBzdHJpbmdbXVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdtYWlsT0F1dGhTdGF0ZVBheWxvYWQge1xuICB1c2VySWQ6IG51bWJlclxuICBtYWlsYm94SWQ6IG51bWJlclxuICByZXR1cm5Ubzogc3RyaW5nXG4gIGV4cDogbnVtYmVyXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR21haWxUb2tlblJlc3VsdCB7XG4gIGFjY2Vzc1Rva2VuOiBzdHJpbmdcbiAgcmVmcmVzaFRva2VuOiBzdHJpbmcgfCBudWxsXG4gIGV4cGlyZXNBdE1zOiBudW1iZXIgfCBudWxsXG59XG5cbmV4cG9ydCBjbGFzcyBHbWFpbE9BdXRoRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0dtYWlsT0F1dGhFcnJvcidcbiAgfVxufVxuXG4vKiogTG9hZCBHbWFpbCBPQXV0aCBzZXR0aW5ncyAob21pdCBgZW52YCB0byByZWFkIHByb2Nlc3MvRGVubyB2aWEgZGVub19hcGlfa2l0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkR21haWxPQXV0aENvbmZpZyhcbiAgZW52PzogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPixcbik6IEdtYWlsT0F1dGhDb25maWcge1xuICBjb25zdCBzb3VyY2UgPSBlbnYgPz8ge1xuICAgIEdNQUlMX09BVVRIX0NMSUVOVF9JRDogcmVhZEVudignR01BSUxfT0FVVEhfQ0xJRU5UX0lEJyksXG4gICAgR01BSUxfT0FVVEhfQ0xJRU5UX1NFQ1JFVDogcmVhZEVudignR01BSUxfT0FVVEhfQ0xJRU5UX1NFQ1JFVCcpLFxuICAgIEdNQUlMX09BVVRIX1JFRElSRUNUX1VSSTogcmVhZEVudignR01BSUxfT0FVVEhfUkVESVJFQ1RfVVJJJyksXG4gICAgR01BSUxfT0FVVEhfUkVUVVJOX1RPX0FMTE9XTElTVDogcmVhZEVudignR01BSUxfT0FVVEhfUkVUVVJOX1RPX0FMTE9XTElTVCcpLFxuICB9XG4gIGNvbnN0IGNsaWVudElkID0gc291cmNlLkdNQUlMX09BVVRIX0NMSUVOVF9JRD8udHJpbSgpID8/ICcnXG4gIGNvbnN0IGNsaWVudFNlY3JldCA9IHNvdXJjZS5HTUFJTF9PQVVUSF9DTElFTlRfU0VDUkVUPy50cmltKCkgPz8gJydcbiAgY29uc3QgcmVkaXJlY3RVcmkgPSAoc291cmNlLkdNQUlMX09BVVRIX1JFRElSRUNUX1VSST8udHJpbSgpIHx8XG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMy9vYXV0aC9nbWFpbC9jYWxsYmFjaycpXG4gIGNvbnN0IGFsbG93UmF3ID0gc291cmNlLkdNQUlMX09BVVRIX1JFVFVSTl9UT19BTExPV0xJU1Q/LnRyaW0oKSB8fFxuICAgICdodHRwOi8vbG9jYWxob3N0OjQ0NDUsc3BlbmRtYW5hZ2VyOi8vc2V0dGluZ3MvZW1haWwtaW1wb3J0J1xuICBjb25zdCByZXR1cm5Ub0FsbG93bGlzdCA9IGFsbG93UmF3XG4gICAgLnNwbGl0KCcsJylcbiAgICAubWFwKChzKSA9PiBzLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG5cbiAgaWYgKCFjbGllbnRJZCB8fCAhY2xpZW50U2VjcmV0KSB7XG4gICAgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcihcbiAgICAgICdHTUFJTF9PQVVUSF9DTElFTlRfSUQgYW5kIEdNQUlMX09BVVRIX0NMSUVOVF9TRUNSRVQgYXJlIHJlcXVpcmVkJyxcbiAgICApXG4gIH1cbiAgaWYgKHJldHVyblRvQWxsb3dsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoJ0dNQUlMX09BVVRIX1JFVFVSTl9UT19BTExPV0xJU1QgaXMgZW1wdHknKVxuICB9XG5cbiAgcmV0dXJuIHsgY2xpZW50SWQsIGNsaWVudFNlY3JldCwgcmVkaXJlY3RVcmksIHJldHVyblRvQWxsb3dsaXN0IH1cbn1cblxuLyoqIFRydWUgd2hlbiBgcmV0dXJuVG9gIG9yaWdpbiAob3Igc2NoZW1lIHByZWZpeCkgbWF0Y2hlcyBhbiBhbGxvd2xpc3QgZW50cnkuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZXR1cm5Ub0FsbG93ZWQoXG4gIHJldHVyblRvOiBzdHJpbmcsXG4gIGFsbG93bGlzdDogc3RyaW5nW10sXG4pOiBib29sZWFuIHtcbiAgbGV0IHVybDogVVJMXG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTChyZXR1cm5UbylcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICBpZiAodXJsLnVzZXJuYW1lIHx8IHVybC5wYXNzd29yZCkgcmV0dXJuIGZhbHNlXG4gIGlmICh1cmwuaGFzaCkgcmV0dXJuIGZhbHNlXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBhbGxvd2xpc3QpIHtcbiAgICBpZiAoIWVudHJ5KSBjb250aW51ZVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBhbGxvd2VkID0gbmV3IFVSTChlbnRyeSlcbiAgICAgIGlmICh1cmwucHJvdG9jb2wgPT09IGFsbG93ZWQucHJvdG9jb2wgJiYgdXJsLmhvc3QgPT09IGFsbG93ZWQuaG9zdCkge1xuICAgICAgICAvLyBBbGxvdyBleGFjdCBvcmlnaW4gb3IgYW55IHBhdGggdW5kZXIgdGhhdCBvcmlnaW4uXG4gICAgICAgIGlmICghYWxsb3dlZC5wYXRobmFtZSB8fCBhbGxvd2VkLnBhdGhuYW1lID09PSAnLycpIHJldHVybiB0cnVlXG4gICAgICAgIGNvbnN0IHByZWZpeCA9IGFsbG93ZWQucGF0aG5hbWUuZW5kc1dpdGgoJy8nKVxuICAgICAgICAgID8gYWxsb3dlZC5wYXRobmFtZVxuICAgICAgICAgIDogYCR7YWxsb3dlZC5wYXRobmFtZX0vYFxuICAgICAgICBpZiAoXG4gICAgICAgICAgdXJsLnBhdGhuYW1lID09PSBhbGxvd2VkLnBhdGhuYW1lIHx8XG4gICAgICAgICAgdXJsLnBhdGhuYW1lLnN0YXJ0c1dpdGgocHJlZml4KVxuICAgICAgICApIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDdXN0b20gc2NoZW1lcyB3aXRob3V0IGF1dGhvcml0eSwgZS5nLiBzcGVuZG1hbmFnZXI6Ly9zZXR0aW5ncy8uLi5cbiAgICAgIGlmIChyZXR1cm5UbyA9PT0gZW50cnkgfHwgcmV0dXJuVG8uc3RhcnRzV2l0aChgJHtlbnRyeX1gKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2Vcbn1cblxuZnVuY3Rpb24gYnl0ZXNUb0Jhc2U2NFVybChieXRlczogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIGxldCBiaW4gPSAnJ1xuICBmb3IgKGNvbnN0IGIgb2YgYnl0ZXMpIGJpbiArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGIpXG4gIHJldHVybiBidG9hKGJpbikucmVwbGFjZSgvXFwrL2csICctJykucmVwbGFjZSgvXFwvL2csICdfJykucmVwbGFjZSgvPSskLywgJycpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFVybFRvQnl0ZXMoczogc3RyaW5nKTogVWludDhBcnJheSB7XG4gIGNvbnN0IHBhZGRlZCA9IHMucmVwbGFjZSgvLS9nLCAnKycpLnJlcGxhY2UoL18vZywgJy8nKSArXG4gICAgJz09PScuc2xpY2UoKHMubGVuZ3RoICsgMykgJSA0KVxuICBjb25zdCBiaW4gPSBhdG9iKHBhZGRlZClcbiAgY29uc3Qgb3V0ID0gbmV3IFVpbnQ4QXJyYXkoYmluLmxlbmd0aClcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBiaW4ubGVuZ3RoOyBpKyspIG91dFtpXSA9IGJpbi5jaGFyQ29kZUF0KGkpXG4gIHJldHVybiBvdXRcbn1cblxuYXN5bmMgZnVuY3Rpb24gaG1hY0tleShzZWNyZXQ6IHN0cmluZyk6IFByb21pc2U8Q3J5cHRvS2V5PiB7XG4gIHJldHVybiBjcnlwdG8uc3VidGxlLmltcG9ydEtleShcbiAgICAncmF3JyxcbiAgICBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc2VjcmV0KSxcbiAgICB7IG5hbWU6ICdITUFDJywgaGFzaDogJ1NIQS0yNTYnIH0sXG4gICAgZmFsc2UsXG4gICAgWydzaWduJywgJ3ZlcmlmeSddLFxuICApXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzaWduT0F1dGhTdGF0ZShcbiAgcGF5bG9hZDogT21pdDxHbWFpbE9BdXRoU3RhdGVQYXlsb2FkLCAnZXhwJz4gJiB7IGV4cD86IG51bWJlciB9LFxuICBjbGllbnRTZWNyZXQ6IHN0cmluZyxcbiAgbm93TXM6IG51bWJlciA9IERhdGUubm93KCksXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBib2R5OiBHbWFpbE9BdXRoU3RhdGVQYXlsb2FkID0ge1xuICAgIHVzZXJJZDogcGF5bG9hZC51c2VySWQsXG4gICAgbWFpbGJveElkOiBwYXlsb2FkLm1haWxib3hJZCxcbiAgICByZXR1cm5UbzogcGF5bG9hZC5yZXR1cm5UbyxcbiAgICBleHA6IHBheWxvYWQuZXhwID8/IE1hdGguZmxvb3Iobm93TXMgLyAxMDAwKSArIFNUQVRFX1RUTF9TRUNPTkRTLFxuICB9XG4gIGNvbnN0IHBheWxvYWRCNjQgPSBieXRlc1RvQmFzZTY0VXJsKFxuICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShKU09OLnN0cmluZ2lmeShib2R5KSksXG4gIClcbiAgY29uc3Qga2V5ID0gYXdhaXQgaG1hY0tleShjbGllbnRTZWNyZXQpXG4gIGNvbnN0IHNpZyA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuc2lnbihcbiAgICAnSE1BQycsXG4gICAga2V5LFxuICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShwYXlsb2FkQjY0KSxcbiAgKVxuICByZXR1cm4gYCR7cGF5bG9hZEI2NH0uJHtieXRlc1RvQmFzZTY0VXJsKG5ldyBVaW50OEFycmF5KHNpZykpfWBcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeU9BdXRoU3RhdGUoXG4gIHN0YXRlOiBzdHJpbmcsXG4gIGNsaWVudFNlY3JldDogc3RyaW5nLFxuICBub3dNczogbnVtYmVyID0gRGF0ZS5ub3coKSxcbik6IFByb21pc2U8R21haWxPQXV0aFN0YXRlUGF5bG9hZD4ge1xuICBjb25zdCBwYXJ0cyA9IHN0YXRlLnNwbGl0KCcuJylcbiAgaWYgKHBhcnRzLmxlbmd0aCAhPT0gMiB8fCAhcGFydHNbMF0gfHwgIXBhcnRzWzFdKSB7XG4gICAgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcignaW52YWxpZCBPQXV0aCBzdGF0ZScpXG4gIH1cbiAgY29uc3QgW3BheWxvYWRCNjQsIHNpZ0I2NF0gPSBwYXJ0c1xuICBjb25zdCBrZXkgPSBhd2FpdCBobWFjS2V5KGNsaWVudFNlY3JldClcbiAgY29uc3Qgb2sgPSBhd2FpdCBjcnlwdG8uc3VidGxlLnZlcmlmeShcbiAgICAnSE1BQycsXG4gICAga2V5LFxuICAgIGJhc2U2NFVybFRvQnl0ZXMoc2lnQjY0KSBhcyBCdWZmZXJTb3VyY2UsXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHBheWxvYWRCNjQpLFxuICApXG4gIGlmICghb2spIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoJ2ludmFsaWQgT0F1dGggc3RhdGUgc2lnbmF0dXJlJylcblxuICBsZXQgYm9keTogR21haWxPQXV0aFN0YXRlUGF5bG9hZFxuICB0cnkge1xuICAgIGJvZHkgPSBKU09OLnBhcnNlKFxuICAgICAgbmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJhc2U2NFVybFRvQnl0ZXMocGF5bG9hZEI2NCkpLFxuICAgICkgYXMgR21haWxPQXV0aFN0YXRlUGF5bG9hZFxuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKCdpbnZhbGlkIE9BdXRoIHN0YXRlIHBheWxvYWQnKVxuICB9XG5cbiAgaWYgKFxuICAgIHR5cGVvZiBib2R5LnVzZXJJZCAhPT0gJ251bWJlcicgfHxcbiAgICB0eXBlb2YgYm9keS5tYWlsYm94SWQgIT09ICdudW1iZXInIHx8XG4gICAgdHlwZW9mIGJvZHkucmV0dXJuVG8gIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIGJvZHkuZXhwICE9PSAnbnVtYmVyJ1xuICApIHtcbiAgICB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKCdpbnZhbGlkIE9BdXRoIHN0YXRlIGZpZWxkcycpXG4gIH1cbiAgaWYgKGJvZHkuZXhwIDwgTWF0aC5mbG9vcihub3dNcyAvIDEwMDApKSB7XG4gICAgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcignT0F1dGggc3RhdGUgZXhwaXJlZCcpXG4gIH1cbiAgcmV0dXJuIGJvZHlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkR29vZ2xlQXV0aG9yaXplVXJsKG9wdGlvbnM6IHtcbiAgY2xpZW50SWQ6IHN0cmluZ1xuICByZWRpcmVjdFVyaTogc3RyaW5nXG4gIHN0YXRlOiBzdHJpbmdcbiAgc2NvcGU/OiBzdHJpbmdcbn0pOiBzdHJpbmcge1xuICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICBjbGllbnRfaWQ6IG9wdGlvbnMuY2xpZW50SWQsXG4gICAgcmVkaXJlY3RfdXJpOiBvcHRpb25zLnJlZGlyZWN0VXJpLFxuICAgIHJlc3BvbnNlX3R5cGU6ICdjb2RlJyxcbiAgICBzY29wZTogb3B0aW9ucy5zY29wZSA/PyBHTUFJTF9SRUFET05MWV9TQ09QRSxcbiAgICBhY2Nlc3NfdHlwZTogJ29mZmxpbmUnLFxuICAgIHByb21wdDogJ2NvbnNlbnQnLFxuICAgIGluY2x1ZGVfZ3JhbnRlZF9zY29wZXM6ICd0cnVlJyxcbiAgICBzdGF0ZTogb3B0aW9ucy5zdGF0ZSxcbiAgfSlcbiAgcmV0dXJuIGAke0dPT0dMRV9BVVRIT1JJWkVfVVJMfT8ke3BhcmFtcy50b1N0cmluZygpfWBcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4Y2hhbmdlQXV0aG9yaXphdGlvbkNvZGUob3B0aW9uczoge1xuICBjb2RlOiBzdHJpbmdcbiAgY2xpZW50SWQ6IHN0cmluZ1xuICBjbGllbnRTZWNyZXQ6IHN0cmluZ1xuICByZWRpcmVjdFVyaTogc3RyaW5nXG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaFxuICB0b2tlblVybD86IHN0cmluZ1xufSk6IFByb21pc2U8R21haWxUb2tlblJlc3VsdD4ge1xuICBjb25zdCBmZXRjaEltcGwgPSBvcHRpb25zLmZldGNoSW1wbCA/PyBmZXRjaFxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaEltcGwob3B0aW9ucy50b2tlblVybCA/PyBHT09HTEVfVE9LRU5fVVJMLCB7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcgfSxcbiAgICBib2R5OiBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIGNvZGU6IG9wdGlvbnMuY29kZSxcbiAgICAgIGNsaWVudF9pZDogb3B0aW9ucy5jbGllbnRJZCxcbiAgICAgIGNsaWVudF9zZWNyZXQ6IG9wdGlvbnMuY2xpZW50U2VjcmV0LFxuICAgICAgcmVkaXJlY3RfdXJpOiBvcHRpb25zLnJlZGlyZWN0VXJpLFxuICAgICAgZ3JhbnRfdHlwZTogJ2F1dGhvcml6YXRpb25fY29kZScsXG4gICAgfSksXG4gIH0pXG4gIGlmICghcmVzLm9rKSB7XG4gICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlcy50ZXh0KCkuY2F0Y2goKCkgPT4gJycpXG4gICAgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcihcbiAgICAgIGB0b2tlbiBleGNoYW5nZSBmYWlsZWQgKCR7cmVzLnN0YXR1c30pOiAke3RleHQuc2xpY2UoMCwgMjAwKX1gLFxuICAgIClcbiAgfVxuICBjb25zdCBqc29uID0gYXdhaXQgcmVzLmpzb24oKSBhcyB7XG4gICAgYWNjZXNzX3Rva2VuPzogc3RyaW5nXG4gICAgcmVmcmVzaF90b2tlbj86IHN0cmluZ1xuICAgIGV4cGlyZXNfaW4/OiBudW1iZXJcbiAgfVxuICBpZiAoIWpzb24uYWNjZXNzX3Rva2VuKSB7XG4gICAgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcigndG9rZW4gZXhjaGFuZ2UgbWlzc2luZyBhY2Nlc3NfdG9rZW4nKVxuICB9XG4gIGNvbnN0IGV4cGlyZXNBdE1zID0gdHlwZW9mIGpzb24uZXhwaXJlc19pbiA9PT0gJ251bWJlcidcbiAgICA/IERhdGUubm93KCkgKyBqc29uLmV4cGlyZXNfaW4gKiAxMDAwXG4gICAgOiBudWxsXG4gIHJldHVybiB7XG4gICAgYWNjZXNzVG9rZW46IGpzb24uYWNjZXNzX3Rva2VuLFxuICAgIHJlZnJlc2hUb2tlbjoganNvbi5yZWZyZXNoX3Rva2VuID8/IG51bGwsXG4gICAgZXhwaXJlc0F0TXMsXG4gIH1cbn1cblxuY29uc3QgR01BSUxfUFJPRklMRV9VUkwgPVxuICAnaHR0cHM6Ly9nbWFpbC5nb29nbGVhcGlzLmNvbS9nbWFpbC92MS91c2Vycy9tZS9wcm9maWxlJ1xuXG4vKiogQmVzdC1lZmZvcnQgR21haWwgYWRkcmVzcyBmb3IgbWFpbGJveCBsYWJlbDsgbnVsbCB3aGVuIHVuYXZhaWxhYmxlLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoR21haWxFbWFpbEFkZHJlc3Mob3B0aW9uczoge1xuICBhY2Nlc3NUb2tlbjogc3RyaW5nXG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaFxuICBwcm9maWxlVXJsPzogc3RyaW5nXG59KTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGZldGNoSW1wbCA9IG9wdGlvbnMuZmV0Y2hJbXBsID8/IGZldGNoXG4gIHRyeSB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2hJbXBsKG9wdGlvbnMucHJvZmlsZVVybCA/PyBHTUFJTF9QUk9GSUxFX1VSTCwge1xuICAgICAgaGVhZGVyczogeyBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7b3B0aW9ucy5hY2Nlc3NUb2tlbn1gIH0sXG4gICAgfSlcbiAgICBpZiAoIXJlcy5vaykgcmV0dXJuIG51bGxcbiAgICBjb25zdCBqc29uID0gYXdhaXQgcmVzLmpzb24oKSBhcyB7IGVtYWlsQWRkcmVzcz86IHVua25vd24gfVxuICAgIGlmICh0eXBlb2YganNvbi5lbWFpbEFkZHJlc3MgIT09ICdzdHJpbmcnKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IGVtYWlsID0ganNvbi5lbWFpbEFkZHJlc3MudHJpbSgpXG4gICAgcmV0dXJuIGVtYWlsLmxlbmd0aCA+IDAgJiYgZW1haWwubGVuZ3RoIDw9IDI1NSA/IGVtYWlsIDogbnVsbFxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbi8qKiBBcHBlbmQgZ21haWw9Y29ubmVjdGVkfGVycm9yIHF1ZXJ5IHBhcmFtcyB0byByZXR1cm5Uby4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFJldHVyblJlZGlyZWN0KFxuICByZXR1cm5Ubzogc3RyaW5nLFxuICByZXN1bHQ6IHsgb2s6IHRydWUgfSB8IHsgb2s6IGZhbHNlOyBlcnJvcjogc3RyaW5nIH0sXG4pOiBzdHJpbmcge1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKHJldHVyblRvKVxuICBpZiAocmVzdWx0Lm9rKSB7XG4gICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2dtYWlsJywgJ2Nvbm5lY3RlZCcpXG4gICAgdXJsLnNlYXJjaFBhcmFtcy5kZWxldGUoJ2Vycm9yJylcbiAgfSBlbHNlIHtcbiAgICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnZ21haWwnLCAnZXJyb3InKVxuICAgIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdlcnJvcicsIHJlc3VsdC5lcnJvci5zbGljZSgwLCAyMDApKVxuICB9XG4gIHJldHVybiB1cmwudG9TdHJpbmcoKVxufVxuIiwgIi8qKlxuICogRGF0ZS1iYXNlZCBzeW5jIHByb2dyZXNzOiBiYWNrZmlsbCB3YWxrcyBuZXdlc3QgXHUyMTkyIG9sZGVzdCB3aXRoaW5cbiAqIFtzeW5jX3NpbmNlLCBzeW5jX3VudGlsXSwgc28gdGhlIGZyb250aWVyIGlzIHRoZSBvbGRlc3QgbWVzc2FnZSBzeW5jZWQgc28gZmFyLlxuICovXG5cbmV4cG9ydCB0eXBlIFN5bmNQcm9ncmVzc0lucHV0ID0ge1xuICBhY3RpdmU6IGJvb2xlYW5cbiAgc3luY1NpbmNlOiBEYXRlIHwgbnVsbFxuICBzeW5jVW50aWw6IERhdGUgfCBudWxsXG4gIC8qKiBNSU4ocmVjZWl2ZWRfYXQpIG9mIG1lc3NhZ2VzIGluIHRoZSBzeW5jIHdpbmRvdzsgbnVsbCBiZWZvcmUgYW55IG1lc3NhZ2VzLiAqL1xuICBvbGRlc3RTeW5jZWRBdDogRGF0ZSB8IG51bGxcbiAgbm93PzogRGF0ZVxufVxuXG4vKipcbiAqIFJldHVybnMgMFx1MjAxMzEwMCB3aGlsZSBhIGRhdGVkIHN5bmMgaXMgYWN0aXZlLCBvciBudWxsIHdoZW4gcHJvZ3Jlc3MgY2Fubm90IGJlXG4gKiBlc3RpbWF0ZWQgKGluYWN0aXZlLCBvciBtaXNzaW5nIHVzYWJsZSBkYXRlIGJvdW5kcykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlU3luY1Byb2dyZXNzUGVyY2VudChcbiAgaW5wdXQ6IFN5bmNQcm9ncmVzc0lucHV0LFxuKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICghaW5wdXQuYWN0aXZlKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IG5vdyA9IGlucHV0Lm5vdyA/PyBuZXcgRGF0ZSgpXG4gIGNvbnN0IHdpbmRvd0VuZCA9IGlucHV0LnN5bmNVbnRpbCA/P1xuICAgIChpbnB1dC5zeW5jU2luY2UgIT0gbnVsbCA/IG5vdyA6IG51bGwpXG4gIGxldCB3aW5kb3dTdGFydCA9IGlucHV0LnN5bmNTaW5jZVxuICBpZiAod2luZG93U3RhcnQgPT0gbnVsbCAmJiBpbnB1dC5zeW5jVW50aWwgIT0gbnVsbCkge1xuICAgIHdpbmRvd1N0YXJ0ID0gaW5wdXQub2xkZXN0U3luY2VkQXRcbiAgfVxuICBpZiAod2luZG93U3RhcnQgPT0gbnVsbCB8fCB3aW5kb3dFbmQgPT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICBjb25zdCBzcGFuTXMgPSB3aW5kb3dFbmQuZ2V0VGltZSgpIC0gd2luZG93U3RhcnQuZ2V0VGltZSgpXG4gIGlmIChzcGFuTXMgPD0gMCkgcmV0dXJuIDEwMFxuXG4gIGNvbnN0IGZyb250aWVyID0gaW5wdXQub2xkZXN0U3luY2VkQXQgPz8gd2luZG93RW5kXG4gIGNvbnN0IHByb2dyZXNzZWRNcyA9IHdpbmRvd0VuZC5nZXRUaW1lKCkgLSBmcm9udGllci5nZXRUaW1lKClcbiAgY29uc3QgcmF3ID0gKHByb2dyZXNzZWRNcyAvIHNwYW5NcykgKiAxMDBcbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgcmF3KSlcbn1cbiIsICJpbXBvcnQgeyBTZXJ2aWNlRXJyb3IgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuXG5jb25zdCBQUk9WSURFUlMgPSBuZXcgU2V0KFsnZml4dHVyZScsICdnbWFpbCddKVxuY29uc3QgQVJUSUZBQ1RfU1RBVFVTRVMgPSBuZXcgU2V0KFsncGVuZGluZycsICdhY2NlcHRlZCcsICdyZWplY3RlZCddKVxuY29uc3QgVEVNUExBVEVfS0lORFMgPSBuZXcgU2V0KFsnYXBwcm92ZScsICdyZWplY3QnXSlcblxuLyoqXG4gKiBDbGllbnQtZmFjaW5nIHZhbGlkYXRpb24gZmFpbHVyZS4gRXh0ZW5kcyBQeWxvbiBTZXJ2aWNlRXJyb3IgKEdyYXBoUUxFcnJvcilcbiAqIHNvIEdyYXBoUUwgWW9nYSBkb2VzIG5vdCBtYXNrIHRoZSBtZXNzYWdlIGFzIFwiVW5leHBlY3RlZCBlcnJvci5cIlxuICovXG5leHBvcnQgY2xhc3MgSW52YWxpZE1haWxib3hFcnJvciBleHRlbmRzIFNlcnZpY2VFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UsIHtcbiAgICAgIGNvZGU6ICdJTlZBTElEX01BSUxCT1hfSU5QVVQnLFxuICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgIH0pXG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRNYWlsYm94RXJyb3InXG4gIH1cbn1cblxuY29uc3QgRE9NQUlOX0ZJTFRFUl9IRUxQID1cbiAgJ0FsbG93ZWQgcGF0dGVybnM6IHNob3AuY29tLCB1c2VyQHNob3AuY29tICh3aWxkY2FyZHMgYXJlIG5vdCBhbGxvd2VkKSdcblxuY29uc3QgRlJPTV9QQVRURVJOX0hFTFAgPVxuICAnQWxsb3dlZCBwYXR0ZXJuczogc2hvcC5jb20sICouc2hvcC5jb20sIHVzZXJAc2hvcC5jb20sICpAc2hvcC5jb20sICpAKi5zaG9wLmNvbSdcblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlUHJvdmlkZXIocHJvdmlkZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBwcm92aWRlci50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIVBST1ZJREVSUy5oYXModHJpbW1lZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgIGBwcm92aWRlciBtdXN0IGJlIG9uZSBvZjogJHtbLi4uUFJPVklERVJTXS5qb2luKCcsICcpfWAsXG4gICAgKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUxhYmVsKGxhYmVsOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gbGFiZWwudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2xhYmVsIGlzIHJlcXVpcmVkJylcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbGFiZWwgaXMgdG9vIGxvbmcnKVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG4vKipcbiAqIERvbWFpbiBhbGxvd2xpc3QgZm9yIHN5bmMuIEF0IGxlYXN0IG9uZSBwYXR0ZXJuIHJlcXVpcmVkLlxuICogQWxsb3dlZDogYHNob3AuY29tYCwgYHVzZXJAc2hvcC5jb21gLiBXaWxkY2FyZHMgYXJlIHJlamVjdGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEb21haW5QYXR0ZXJucyhwYXR0ZXJuczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXVxuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgZm9yIChjb25zdCByYXcgb2YgcGF0dGVybnMpIHtcbiAgICBjb25zdCBwID0gcmF3LnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgaWYgKCFwKSBjb250aW51ZVxuICAgIGlmIChwLmxlbmd0aCA+IDI1NSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2RvbWFpbiBmaWx0ZXIgcGF0dGVybiBpcyB0b28gbG9uZycpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZERvbWFpbkZpbHRlclBhdHRlcm4ocCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgICBkZXNjcmliZUludmFsaWREb21haW5GaWx0ZXIocmF3KSxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKHNlZW4uaGFzKHApKSBjb250aW51ZVxuICAgIHNlZW4uYWRkKHApXG4gICAgb3V0LnB1c2gocClcbiAgfVxuICBpZiAob3V0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdkb21haW4gZmlsdGVycyBhcmUgcmVxdWlyZWQnKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuLyoqIExpdGVyYWwgZG9tYWluIG9yIGV4YWN0IGFkZHJlc3MgXHUyMDE0IG5vIHdpbGRjYXJkcy4gKi9cbmZ1bmN0aW9uIGlzVmFsaWREb21haW5GaWx0ZXJQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5pbmNsdWRlcygnKicpKSByZXR1cm4gZmFsc2VcblxuICBpZiAocGF0dGVybi5pbmNsdWRlcygnQCcpKSB7XG4gICAgY29uc3QgYXQgPSBwYXR0ZXJuLmxhc3RJbmRleE9mKCdAJylcbiAgICBpZiAoYXQgPD0gMCB8fCBhdCA9PT0gcGF0dGVybi5sZW5ndGggLSAxKSByZXR1cm4gZmFsc2VcbiAgICBjb25zdCBsb2NhbCA9IHBhdHRlcm4uc2xpY2UoMCwgYXQpXG4gICAgY29uc3QgZG9tYWluID0gcGF0dGVybi5zbGljZShhdCArIDEpXG4gICAgaWYgKCFsb2NhbCB8fCBsb2NhbC5pbmNsdWRlcygnQCcpKSByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gaXNWYWxpZExpdGVyYWxEb21haW4oZG9tYWluKVxuICB9XG4gIHJldHVybiBpc1ZhbGlkTGl0ZXJhbERvbWFpbihwYXR0ZXJuKVxufVxuXG5mdW5jdGlvbiBpc1ZhbGlkTGl0ZXJhbERvbWFpbihkb21haW46IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoZG9tYWluLmluY2x1ZGVzKCcqJykpIHJldHVybiBmYWxzZVxuICByZXR1cm4gL15bYS16MC05XShbYS16MC05LV0qW2EtejAtOV0pPyhcXC5bYS16MC05XShbYS16MC05LV0qW2EtejAtOV0pPykrJC9cbiAgICAudGVzdChkb21haW4pXG59XG5cbi8qKiBUZW1wbGF0ZSBtYXRjaEZyb21QYXR0ZXJuIFx1MjAxNCB3aWxkY2FyZHMgYWxsb3dlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRnJvbVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IHAgPSBwYXR0ZXJuLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGlmICghcCB8fCBwLmxlbmd0aCA+IDI1NSkgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKHAuaW5jbHVkZXMoJ0AnKSkge1xuICAgIGNvbnN0IGF0ID0gcC5sYXN0SW5kZXhPZignQCcpXG4gICAgaWYgKGF0IDw9IDAgfHwgYXQgPT09IHAubGVuZ3RoIC0gMSkgcmV0dXJuIGZhbHNlXG4gICAgY29uc3QgbG9jYWwgPSBwLnNsaWNlKDAsIGF0KVxuICAgIGNvbnN0IGRvbWFpbiA9IHAuc2xpY2UoYXQgKyAxKVxuICAgIGlmIChsb2NhbCAhPT0gJyonICYmIChsb2NhbC5pbmNsdWRlcygnKicpIHx8IGxvY2FsLmluY2x1ZGVzKCdAJykpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gICAgcmV0dXJuIGlzVmFsaWREb21haW5QYXR0ZXJuKGRvbWFpbilcbiAgfVxuICByZXR1cm4gaXNWYWxpZERvbWFpblBhdHRlcm4ocClcbn1cblxuZnVuY3Rpb24gaXNWYWxpZERvbWFpblBhdHRlcm4oZG9tYWluOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKGRvbWFpbi5zdGFydHNXaXRoKCcqLicpKSB7XG4gICAgY29uc3QgcmVzdCA9IGRvbWFpbi5zbGljZSgyKVxuICAgIGlmICghcmVzdCB8fCByZXN0LmluY2x1ZGVzKCcqJykgfHwgIXJlc3QuaW5jbHVkZXMoJy4nKSkgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIGlzVmFsaWRMaXRlcmFsRG9tYWluKHJlc3QpXG4gIH1cbiAgaWYgKGRvbWFpbi5pbmNsdWRlcygnKicpKSByZXR1cm4gZmFsc2VcbiAgcmV0dXJuIGlzVmFsaWRMaXRlcmFsRG9tYWluKGRvbWFpbilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQXJ0aWZhY3RTdGF0dXMoc3RhdHVzOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gc3RhdHVzLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGlmICghQVJUSUZBQ1RfU1RBVFVTRVMuaGFzKHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICBgc3RhdHVzIG11c3QgYmUgb25lIG9mOiAke1suLi5BUlRJRkFDVF9TVEFUVVNFU10uam9pbignLCAnKX1gLFxuICAgIClcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVUZW1wbGF0ZU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3RlbXBsYXRlIG5hbWUgaXMgcmVxdWlyZWQnKVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcigndGVtcGxhdGUgbmFtZSBpcyB0b28gbG9uZycpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuLyoqIE5vcm1hbGl6ZSB0ZW1wbGF0ZSBraW5kIC8gY2xhc3NpZnkgZGVjaXNpb246IGFwcHJvdmUgfCByZWplY3QuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVUZW1wbGF0ZUtpbmQoa2luZDogc3RyaW5nKTogJ2FwcHJvdmUnIHwgJ3JlamVjdCcge1xuICBjb25zdCB0cmltbWVkID0ga2luZC50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIVRFTVBMQVRFX0tJTkRTLmhhcyh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgYGtpbmQgbXVzdCBiZSBvbmUgb2Y6ICR7Wy4uLlRFTVBMQVRFX0tJTkRTXS5qb2luKCcsICcpfWAsXG4gICAgKVxuICB9XG4gIHJldHVybiB0cmltbWVkIGFzICdhcHByb3ZlJyB8ICdyZWplY3QnXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgcCA9IHBhdHRlcm4udHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFpc1ZhbGlkRnJvbVBhdHRlcm4ocCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgIGRlc2NyaWJlSW52YWxpZEZyb21QYXR0ZXJuKHBhdHRlcm4sICdtYXRjaEZyb21QYXR0ZXJuJyksXG4gICAgKVxuICB9XG4gIHJldHVybiBwXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXNjcmliZUludmFsaWREb21haW5GaWx0ZXIocmF3OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwID0gcmF3LnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGNvbnN0IHByZWZpeCA9IGBpbnZhbGlkIGRvbWFpbiBmaWx0ZXIgXCIke3Jhd31cImBcblxuICBpZiAoIXApIHtcbiAgICByZXR1cm4gYCR7cHJlZml4fTogcGF0dGVybiBpcyBlbXB0eS4gJHtET01BSU5fRklMVEVSX0hFTFB9YFxuICB9XG5cbiAgaWYgKHAuaW5jbHVkZXMoJyonKSkge1xuICAgIC8vICouc2hvcC5jb20gLyAqQHNob3AuY29tIC8gKkAqLnNob3AuY29tIFx1MjE5MiBzdWdnZXN0IHNob3AuY29tXG4gICAgbGV0IGNhbmRpZGF0ZSA9IHAucmVwbGFjZUFsbCgnKicsICcnKS5yZXBsYWNlKC9eQC8sICcnKS5yZXBsYWNlKC9eXFwuLywgJycpXG4gICAgaWYgKGNhbmRpZGF0ZS5pbmNsdWRlcygnQCcpKSB7XG4gICAgICBjYW5kaWRhdGUgPSBjYW5kaWRhdGUuc2xpY2UoY2FuZGlkYXRlLmxhc3RJbmRleE9mKCdAJykgKyAxKVxuICAgIH1cbiAgICBpZiAoaXNWYWxpZExpdGVyYWxEb21haW4oY2FuZGlkYXRlKSkge1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgYCR7cHJlZml4fTogd2lsZGNhcmRzIGFyZSBub3QgYWxsb3dlZDsgdXNlIFwiJHtjYW5kaWRhdGV9XCIgYCArXG4gICAgICAgIGBmb3IgdGhhdCBkb21haW4gYW5kIGl0cyBzdWJkb21haW5zLiAke0RPTUFJTl9GSUxURVJfSEVMUH1gXG4gICAgICApXG4gICAgfVxuICAgIHJldHVybiBgJHtwcmVmaXh9OiB3aWxkY2FyZHMgYXJlIG5vdCBhbGxvd2VkLiAke0RPTUFJTl9GSUxURVJfSEVMUH1gXG4gIH1cblxuICBpZiAoIXAuaW5jbHVkZXMoJy4nKSAmJiAhcC5pbmNsdWRlcygnQCcpKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIGAke3ByZWZpeH06IG11c3QgaW5jbHVkZSBhIGRvbWFpbiB3aXRoIGEgZG90IChlLmcuIFwic2hvcC5jb21cIikuIGAgK1xuICAgICAgRE9NQUlOX0ZJTFRFUl9IRUxQXG4gICAgKVxuICB9XG5cbiAgcmV0dXJuIGAke3ByZWZpeH0uICR7RE9NQUlOX0ZJTFRFUl9IRUxQfWBcbn1cblxuLyoqXG4gKiBFeHBsYWlucyB3aHkgYSBmcm9tL2RvbWFpbiBwYXR0ZXJuIGZhaWxlZCB2YWxpZGF0aW9uLCB3aXRoIGEgZml4IGhpbnQgd2hlblxuICogdGhlIG1pc3Rha2UgaXMgcmVjb2duaXphYmxlIChlLmcuIGAqZW52aW8uc2hvcC5jb21gIFx1MjE5MiBgKi5lbnZpby5zaG9wLmNvbWApLlxuICogVXNlZCBmb3IgdGVtcGxhdGUgbWF0Y2hGcm9tUGF0dGVybiAod2lsZGNhcmRzIGFsbG93ZWQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVJbnZhbGlkRnJvbVBhdHRlcm4oXG4gIHJhdzogc3RyaW5nLFxuICBsYWJlbDogc3RyaW5nLFxuKTogc3RyaW5nIHtcbiAgY29uc3QgcCA9IHJhdy50cmltKCkudG9Mb3dlckNhc2UoKVxuICBjb25zdCBwcmVmaXggPSBgaW52YWxpZCAke2xhYmVsfSBcIiR7cmF3fVwiYFxuXG4gIGlmICghcCkge1xuICAgIHJldHVybiBgJHtwcmVmaXh9OiBwYXR0ZXJuIGlzIGVtcHR5LiAke0ZST01fUEFUVEVSTl9IRUxQfWBcbiAgfVxuXG4gIC8vIGAqZW52aW8uc2FudGFuZGVyLmNvbS5teGAgXHUyMDE0IHdpbGRjYXJkIG1pc3NpbmcgdGhlIGRvdCAob3IgQCkuXG4gIGlmIChwLnN0YXJ0c1dpdGgoJyonKSAmJiAhcC5zdGFydHNXaXRoKCcqLicpICYmICFwLnN0YXJ0c1dpdGgoJypAJykpIHtcbiAgICBjb25zdCByZXN0ID0gcC5zbGljZSgxKVxuICAgIGlmIChyZXN0LmluY2x1ZGVzKCcuJykgJiYgIXJlc3QuaW5jbHVkZXMoJyonKSAmJiBpc1ZhbGlkRG9tYWluUGF0dGVybihyZXN0KSkge1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgYCR7cHJlZml4fTogdXNlIFwiKi4ke3Jlc3R9XCIgZm9yIHN1YmRvbWFpbnMgb2YgJHtyZXN0fSwgYCArXG4gICAgICAgIGBvciBcIiR7cmVzdH1cIiBmb3IgdGhhdCBkb21haW4gYW5kIGl0cyBzdWJkb21haW5zLiAke0ZST01fUEFUVEVSTl9IRUxQfWBcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuIChcbiAgICAgIGAke3ByZWZpeH06IHdpbGRjYXJkIG11c3QgYmUgXCIqLmRvbWFpbi50bGRcIiBvciBcIipAZG9tYWluLnRsZFwiLiBgICtcbiAgICAgIEZST01fUEFUVEVSTl9IRUxQXG4gICAgKVxuICB9XG5cbiAgLy8gYCouY29tYCAvIGAqQCpgIFx1MjAxNCBuZWVkcyBhIG11bHRpLXBhcnQgZG9tYWluLlxuICBpZiAoXG4gICAgKHAuc3RhcnRzV2l0aCgnKi4nKSAmJiAhcC5zbGljZSgyKS5pbmNsdWRlcygnLicpKSB8fFxuICAgIChwLmluY2x1ZGVzKCdAJykgJiYgcC5lbmRzV2l0aCgnQConKSlcbiAgKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIGAke3ByZWZpeH06IHdpbGRjYXJkIG5lZWRzIGEgbXVsdGktcGFydCBkb21haW4gYCArXG4gICAgICBgKGUuZy4gXCIqLnNob3AuY29tXCIpLCBub3QgYSBiYXJlIFRMRC4gJHtGUk9NX1BBVFRFUk5fSEVMUH1gXG4gICAgKVxuICB9XG5cbiAgaWYgKCFwLmluY2x1ZGVzKCcuJykgJiYgIXAuaW5jbHVkZXMoJ0AnKSkge1xuICAgIHJldHVybiAoXG4gICAgICBgJHtwcmVmaXh9OiBtdXN0IGluY2x1ZGUgYSBkb21haW4gd2l0aCBhIGRvdCAoZS5nLiBcInNob3AuY29tXCIpLiBgICtcbiAgICAgIEZST01fUEFUVEVSTl9IRUxQXG4gICAgKVxuICB9XG5cbiAgcmV0dXJuIGAke3ByZWZpeH0uICR7RlJPTV9QQVRURVJOX0hFTFB9YFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVTdWJqZWN0UmVnZXgoXG4gIHJlZ2V4OiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChyZWdleCA9PT0gbnVsbCB8fCByZWdleCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuICBjb25zdCB0cmltbWVkID0gcmVnZXgudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgcmV0dXJuIG51bGxcbiAgdHJ5IHtcbiAgICBuZXcgUmVnRXhwKHRyaW1tZWQsICdpJylcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ21hdGNoU3ViamVjdFJlZ2V4IGlzIG5vdCBhIHZhbGlkIHJlZ2V4cCcpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ2F0ZWdvcnlJZChjYXRlZ29yeUlkOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKFxuICAgIHR5cGVvZiBjYXRlZ29yeUlkICE9PSAnbnVtYmVyJyB8fFxuICAgICFOdW1iZXIuaXNJbnRlZ2VyKGNhdGVnb3J5SWQpIHx8XG4gICAgY2F0ZWdvcnlJZCA8IDFcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICAnY2F0ZWdvcnlJZCBpcyByZXF1aXJlZCB3aGVuIGFjY2VwdGluZyBhIHNwZW5kaW5nIGNhbmRpZGF0ZScsXG4gICAgKVxuICB9XG4gIHJldHVybiBjYXRlZ29yeUlkXG59XG5cbi8qKlxuICogUGFyc2Ugb3B0aW9uYWwgSVNPIGRhdGUgc3RyaW5nIGZvciBzeW5jIHJhbmdlLiBFbXB0eS9udWxsIFx1MjE5MiBudWxsLlxuICogUmV0dXJucyBJU08gc3RyaW5nIHN1aXRhYmxlIGZvciB0aW1lc3RhbXB0eiBjb2x1bW5zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVPcHRpb25hbFN5bmNEYXRlKFxuICB2YWx1ZTogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgZmllbGQ6ICdzaW5jZScgfCAndW50aWwnLFxuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbFxuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgcmV0dXJuIG51bGxcbiAgY29uc3QgbXMgPSBEYXRlLnBhcnNlKHRyaW1tZWQpXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKG1zKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKGAke2ZpZWxkfSBtdXN0IGJlIGEgdmFsaWQgSVNPIGRhdGVgKVxuICB9XG4gIHJldHVybiBuZXcgRGF0ZShtcykudG9JU09TdHJpbmcoKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVTeW5jRGF0ZVJhbmdlKFxuICBzaW5jZTogc3RyaW5nIHwgbnVsbCxcbiAgdW50aWw6IHN0cmluZyB8IG51bGwsXG4pOiB7IHNpbmNlOiBzdHJpbmcgfCBudWxsOyB1bnRpbDogc3RyaW5nIHwgbnVsbCB9IHtcbiAgaWYgKHNpbmNlICYmIHVudGlsICYmIERhdGUucGFyc2Uoc2luY2UpID4gRGF0ZS5wYXJzZSh1bnRpbCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignc2luY2UgbXVzdCBiZSBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gdW50aWwnKVxuICB9XG4gIHJldHVybiB7IHNpbmNlLCB1bnRpbCB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjbGFtcEFydGlmYWN0UGFnZShcbiAgcGFnZT86IG51bWJlciB8IG51bGwsXG4gIHBhZ2VTaXplPzogbnVtYmVyIHwgbnVsbCxcbik6IHsgcGFnZTogbnVtYmVyOyBwYWdlU2l6ZTogbnVtYmVyOyBvZmZzZXQ6IG51bWJlciB9IHtcbiAgY29uc3QgcCA9IHR5cGVvZiBwYWdlID09PSAnbnVtYmVyJyAmJiBOdW1iZXIuaXNGaW5pdGUocGFnZSkgPyBwYWdlIDogMVxuICBjb25zdCBzaXplID1cbiAgICB0eXBlb2YgcGFnZVNpemUgPT09ICdudW1iZXInICYmIE51bWJlci5pc0Zpbml0ZShwYWdlU2l6ZSkgPyBwYWdlU2l6ZSA6IDIwXG4gIGNvbnN0IHNhZmVQYWdlID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihwKSlcbiAgY29uc3Qgc2FmZVNpemUgPSBNYXRoLm1pbigxMDAsIE1hdGgubWF4KDEsIE1hdGguZmxvb3Ioc2l6ZSkpKVxuICByZXR1cm4ge1xuICAgIHBhZ2U6IHNhZmVQYWdlLFxuICAgIHBhZ2VTaXplOiBzYWZlU2l6ZSxcbiAgICBvZmZzZXQ6IChzYWZlUGFnZSAtIDEpICogc2FmZVNpemUsXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVSZW1vdGVKV0tTZXQsIGp3dFZlcmlmeSB9IGZyb20gJ2pvc2UnXG5pbXBvcnQgdHlwZSB7IENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuXG5jb25zdCBBVVRIX0FQSV9ET01BSU4gPVxuICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BVVRIX0FQSV9ET01BSU4pIHx8XG4gICdodHRwOi8vbG9jYWxob3N0OjMwMDEnXG5jb25zdCBKV0tTX1VSTCA9IGAke0FVVEhfQVBJX0RPTUFJTn0vYXV0aC9qd3Qvandrcy5qc29uYFxuXG5jb25zdCBqd2tzID0gY3JlYXRlUmVtb3RlSldLU2V0KG5ldyBVUkwoSldLU19VUkwpKVxuXG5leHBvcnQgdHlwZSBWZXJpZmllZEF1dGggPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5QWNjZXNzVG9rZW4oXG4gIGF1dGhvcml6YXRpb25IZWFkZXI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8VmVyaWZpZWRBdXRoIHwgbnVsbD4ge1xuICBpZiAoIWF1dGhvcml6YXRpb25IZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBjb25zdCB0b2tlbiA9IGF1dGhvcml6YXRpb25IZWFkZXIuc2xpY2UoJ0JlYXJlciAnLmxlbmd0aCkudHJpbSgpXG4gIGlmICghdG9rZW4pIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB7IHBheWxvYWQgfSA9IGF3YWl0IGp3dFZlcmlmeSh0b2tlbiwgandrcywge1xuICAgICAgYWxnb3JpdGhtczogWydSUzI1NiddLFxuICAgIH0pXG5cbiAgICBjb25zdCBhdXRoVXNlcklkID0gdHlwZW9mIHBheWxvYWQuc3ViID09PSAnc3RyaW5nJyA/IHBheWxvYWQuc3ViIDogbnVsbFxuICAgIGlmICghYXV0aFVzZXJJZCkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBlbWFpbCA9XG4gICAgICB0eXBlb2YgcGF5bG9hZC5lbWFpbCA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLmVtYWlsIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4geyBhdXRoVXNlcklkLCBlbWFpbCB9XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVuYXV0aG9yaXplZFJlc3BvbnNlKCk6IFJlc3BvbnNlIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVW5hdXRob3JpemVkJyB9KSwge1xuICAgIHN0YXR1czogNDAxLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICB9LFxuICB9KVxufVxuXG4vKiogQ09SUyBwcmVmbGlnaHQgLyBzaW1wbGUgcmVzcG9uc2VzIGZvciBicm93c2VyIEdyYXBoUUwgY2xpZW50cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3JzTWlkZGxld2FyZShjdHg6IENvbnRleHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pIHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtcbiAgICAgIHN0YXR1czogMjA0LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IG5leHQoKVxuXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsICcqJylcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsXG4gICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgKVxuICBjdHgucmVzLmhlYWRlcnMuc2V0KFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJyxcbiAgICAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgKVxufVxuIiwgImltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQge1xuICB1bmF1dGhvcml6ZWRSZXNwb25zZSxcbiAgdmVyaWZ5QWNjZXNzVG9rZW4sXG4gIHR5cGUgVmVyaWZpZWRBdXRoLFxufSBmcm9tICcuLi9hdXRoL3ZlcmlmeS50cydcblxuLyoqIFB1YmxpYyBBTEIgLyBsb2FkLWJhbGFuY2VyIGhlYWx0aCBjaGVjay4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoZWFsdGhNaWRkbGV3YXJlKFxuICBjdHg6IENvbnRleHQsXG4gIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4sXG4pIHtcbiAgY29uc3QgcGF0aCA9IG5ldyBVUkwoY3R4LnJlcS51cmwpLnBhdGhuYW1lXG4gIGlmIChwYXRoID09PSAnL2hlYWx0aCcgJiYgY3R4LnJlcS5tZXRob2QgPT09ICdHRVQnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IG9rOiB0cnVlIH0pLCB7XG4gICAgICBzdGF0dXM6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuICBhd2FpdCBuZXh0KClcbn1cblxuZXhwb3J0IHR5cGUgTG9jYWxVc2VyUmVmID0ge1xuICBpZDogbnVtYmVyXG59XG5cbmV4cG9ydCB0eXBlIFJlc29sdmVMb2NhbFVzZXJGbiA9IChcbiAgaWRlbnRpdHk6IFZlcmlmaWVkQXV0aCxcbikgPT4gUHJvbWlzZTxMb2NhbFVzZXJSZWY+XG5cbi8qKlxuICogUmVxdWlyZSBhIHZhbGlkIEJlYXJlciBKV1Qgb24gYC9ncmFwaHFsYCBhbmQgc2V0IFB5bG9uIGNvbnRleHQgdmFyczpcbiAqIGB1c2VySWRgLCBgYXV0aFVzZXJJZGAsIG9wdGlvbmFsIGBhdXRoRW1haWxgLlxuICpcbiAqIENhbGxlcnMgdGhhdCBuZWVkIGF1dGggZm9yIG90aGVyIHBhdGhzIChlLmcuIFJFU1QgYXNzZXRzKSBzaG91bGQgaGFuZGxlXG4gKiB0aG9zZSBiZWZvcmUgdGhpcyBtaWRkbGV3YXJlIG9yIHVzZSBgdmVyaWZ5QWNjZXNzVG9rZW5gIGRpcmVjdGx5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlKFxuICByZXNvbHZlTG9jYWxVc2VyOiBSZXNvbHZlTG9jYWxVc2VyRm4sXG4pIHtcbiAgcmV0dXJuIGFzeW5jIGZ1bmN0aW9uIGdyYXBoUUxBdXRoTWlkZGxld2FyZShcbiAgICBjdHg6IENvbnRleHQsXG4gICAgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICAgIGF3YWl0IG5leHQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IG5ldyBVUkwoY3R4LnJlcS51cmwpLnBhdGhuYW1lXG5cbiAgICBpZiAoXG4gICAgICBwYXRoID09PSAnL2hlYWx0aCcgfHxcbiAgICAgIChwYXRoICE9PSAnL2dyYXBocWwnICYmICFwYXRoLmVuZHNXaXRoKCcvZ3JhcGhxbCcpKVxuICAgICkge1xuICAgICAgYXdhaXQgbmV4dCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHZlcmlmeUFjY2Vzc1Rva2VuKGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJykpXG4gICAgaWYgKCF2ZXJpZmllZCkge1xuICAgICAgcmV0dXJuIHVuYXV0aG9yaXplZFJlc3BvbnNlKClcbiAgICB9XG5cbiAgICBjb25zdCBsb2NhbFVzZXIgPSBhd2FpdCByZXNvbHZlTG9jYWxVc2VyKHZlcmlmaWVkKVxuXG4gICAgY3R4LnNldCgnYXV0aFVzZXJJZCcsIHZlcmlmaWVkLmF1dGhVc2VySWQpXG4gICAgaWYgKHZlcmlmaWVkLmVtYWlsKSB7XG4gICAgICBjdHguc2V0KCdhdXRoRW1haWwnLCB2ZXJpZmllZC5lbWFpbClcbiAgICB9XG4gICAgY3R4LnNldCgndXNlcklkJywgbG9jYWxVc2VyLmlkKVxuXG4gICAgYXdhaXQgbmV4dCgpXG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IENvbHVtblR5cGUsIEdlbmVyYXRlZCwgS3lzZWx5LCBTZWxlY3RhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG4vKiogTWluaW1hbCB1c2VycyB0YWJsZSBzaGFwZSByZXF1aXJlZCBieSByZXNvbHZlTG9jYWxVc2VyLiAqL1xuZXhwb3J0IGludGVyZmFjZSBVc2Vyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGVtYWlsOiBzdHJpbmdcbiAgcGFzc3dvcmRfaGFzaDogc3RyaW5nIHwgbnVsbFxuICBhdXRoX3VzZXJfaWQ6IHN0cmluZyB8IG51bGxcbiAgbmFtZTogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgVXNlcnNEYXRhYmFzZSA9IHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbn1cblxuZXhwb3J0IHR5cGUgTG9jYWxVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBdXRoSWRlbnRpdHkgPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xuICBuYW1lPzogc3RyaW5nXG59XG5cbi8qKlxuICogUmVzb2x2ZSAob3IgY3JlYXRlKSB0aGUgbG9jYWwgYHVzZXJzYCByb3cgZm9yIGEgU3VwZXJUb2tlbnMgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyPERCIGV4dGVuZHMgVXNlcnNEYXRhYmFzZT4oXG4gIGRiOiBLeXNlbHk8REI+LFxuICBpZGVudGl0eTogQXV0aElkZW50aXR5LFxuKTogUHJvbWlzZTxTZWxlY3RhYmxlPERCWyd1c2VycyddPj4ge1xuICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2F1dGhfdXNlcl9pZCcsICc9JywgaWRlbnRpdHkuYXV0aFVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICBjb25zdCBlbWFpbCA9XG4gICAgaWRlbnRpdHkuZW1haWw/LnRyaW0oKSB8fFxuICAgIGAke2lkZW50aXR5LmF1dGhVc2VySWR9QHVzZXJzLmxvY2FsYFxuICBjb25zdCBuYW1lID1cbiAgICBpZGVudGl0eS5uYW1lPy50cmltKCkgfHxcbiAgICBlbWFpbC5zcGxpdCgnQCcpWzBdIHx8XG4gICAgJ1VzZXInXG5cbiAgLy8gUHJlZmVyIGxpbmtpbmcgYW4gZXhpc3RpbmcgZW1haWwgcm93IChlLmcuIHNlZWRlZCBkZXYgdXNlcikgd2hlbiBwcmVzZW50LlxuICBjb25zdCBieUVtYWlsID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnZW1haWwnLCAnPScsIGVtYWlsKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoYnlFbWFpbCkge1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCd1c2VycycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXV0aF91c2VyX2lkOiBpZGVudGl0eS5hdXRoVXNlcklkLFxuICAgICAgICBuYW1lOiBieUVtYWlsLm5hbWUgfHwgbmFtZSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGJ5RW1haWwuaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gIH1cblxuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygndXNlcnMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZW1haWwsXG4gICAgICBuYW1lLFxuICAgICAgYXV0aF91c2VyX2lkOiBpZGVudGl0eS5hdXRoVXNlcklkLFxuICAgICAgcGFzc3dvcmRfaGFzaDogbnVsbCxcbiAgICB9KVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG4iLCAiaW1wb3J0IHsgZGIgfSBmcm9tICcuL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciBhcyByZXNvbHZlTG9jYWxVc2VyS2l0IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBBdXRoSWRlbnRpdHkgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvdXNlcnMudHMnXG5pbXBvcnQgdHlwZSB7IFVzZXIgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgeyBBdXRoSWRlbnRpdHkgfVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcihpZGVudGl0eTogQXV0aElkZW50aXR5KTogUHJvbWlzZTxVc2VyPiB7XG4gIHJldHVybiByZXNvbHZlTG9jYWxVc2VyS2l0KGRiLCBpZGVudGl0eSlcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHsgRGF0YWJhc2UgfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQge1xuICBHbWFpbE9BdXRoRXJyb3IsXG4gIGJ1aWxkUmV0dXJuUmVkaXJlY3QsXG4gIGV4Y2hhbmdlQXV0aG9yaXphdGlvbkNvZGUsXG4gIGZldGNoR21haWxFbWFpbEFkZHJlc3MsXG4gIGlzUmV0dXJuVG9BbGxvd2VkLFxuICBsb2FkR21haWxPQXV0aENvbmZpZyxcbiAgdmVyaWZ5T0F1dGhTdGF0ZSxcbiAgdHlwZSBHbWFpbE9BdXRoQ29uZmlnLFxufSBmcm9tICcuL2dtYWlsX29hdXRoLnRzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdtYWlsT0F1dGhDYWxsYmFja0RlcHMge1xuICBkYjogS3lzZWx5PERhdGFiYXNlPlxuICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2hcbiAgbm93TXM/OiBudW1iZXJcbiAgbG9hZENvbmZpZz86ICgpID0+IEdtYWlsT0F1dGhDb25maWdcbn1cblxuLyoqXG4gKiBIYW5kbGUgR29vZ2xlIE9BdXRoIHJlZGlyZWN0OiB2ZXJpZnkgc3RhdGUsIGV4Y2hhbmdlIGNvZGUsIHBlcnNpc3QgdG9rZW5zLlxuICogUmV0dXJucyBhIDMwMiBMb2NhdGlvbiB0b3dhcmQgdGhlIEZsdXR0ZXIgcmV0dXJuVG8gVVJMLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlR21haWxPQXV0aENhbGxiYWNrKFxuICByZXF1ZXN0VXJsOiBVUkwsXG4gIGRlcHM6IEdtYWlsT0F1dGhDYWxsYmFja0RlcHMsXG4pOiBQcm9taXNlPFJlc3BvbnNlPiB7XG4gIGNvbnN0IGNvZGUgPSByZXF1ZXN0VXJsLnNlYXJjaFBhcmFtcy5nZXQoJ2NvZGUnKVxuICBjb25zdCBzdGF0ZSA9IHJlcXVlc3RVcmwuc2VhcmNoUGFyYW1zLmdldCgnc3RhdGUnKVxuICBjb25zdCBvYXV0aEVycm9yID0gcmVxdWVzdFVybC5zZWFyY2hQYXJhbXMuZ2V0KCdlcnJvcicpXG5cbiAgbGV0IGNvbmZpZzogR21haWxPQXV0aENvbmZpZ1xuICB0cnkge1xuICAgIGNvbmZpZyA9IChkZXBzLmxvYWRDb25maWcgPz8gbG9hZEdtYWlsT0F1dGhDb25maWcpKClcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiAnb2F1dGhfY29uZmlnX2Vycm9yJ1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoYEdtYWlsIE9BdXRoIG1pc2NvbmZpZ3VyZWQ6ICR7bWVzc2FnZX1gLCB7XG4gICAgICBzdGF0dXM6IDUwMCxcbiAgICB9KVxuICB9XG5cbiAgLy8gQmVzdC1lZmZvcnQgZGVjb2RlIG9mIHJldHVyblRvIGZyb20gc3RhdGUgZm9yIGVycm9yIHJlZGlyZWN0cy5cbiAgbGV0IHJldHVyblRvRmFsbGJhY2s6IHN0cmluZyB8IG51bGwgPSBudWxsXG4gIGlmIChzdGF0ZSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXlsb2FkID0gYXdhaXQgdmVyaWZ5T0F1dGhTdGF0ZShcbiAgICAgICAgc3RhdGUsXG4gICAgICAgIGNvbmZpZy5jbGllbnRTZWNyZXQsXG4gICAgICAgIGRlcHMubm93TXMsXG4gICAgICApXG4gICAgICByZXR1cm5Ub0ZhbGxiYWNrID0gcGF5bG9hZC5yZXR1cm5Ub1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gaWdub3JlIFx1MjAxNCBoYW5kbGVkIGJlbG93XG4gICAgfVxuICB9XG5cbiAgY29uc3QgcmVkaXJlY3RFcnJvciA9IChlcnJvcjogc3RyaW5nLCByZXR1cm5Ubzogc3RyaW5nIHwgbnVsbCkgPT4ge1xuICAgIGlmIChyZXR1cm5UbyAmJiBpc1JldHVyblRvQWxsb3dlZChyZXR1cm5UbywgY29uZmlnLnJldHVyblRvQWxsb3dsaXN0KSkge1xuICAgICAgcmV0dXJuIFJlc3BvbnNlLnJlZGlyZWN0KFxuICAgICAgICBidWlsZFJldHVyblJlZGlyZWN0KHJldHVyblRvLCB7IG9rOiBmYWxzZSwgZXJyb3IgfSksXG4gICAgICAgIDMwMixcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShgR21haWwgT0F1dGggZmFpbGVkOiAke2Vycm9yfWAsIHsgc3RhdHVzOiA0MDAgfSlcbiAgfVxuXG4gIGlmIChvYXV0aEVycm9yKSB7XG4gICAgcmV0dXJuIHJlZGlyZWN0RXJyb3Iob2F1dGhFcnJvciwgcmV0dXJuVG9GYWxsYmFjaylcbiAgfVxuICBpZiAoIWNvZGUgfHwgIXN0YXRlKSB7XG4gICAgcmV0dXJuIHJlZGlyZWN0RXJyb3IoJ21pc3NpbmdfY29kZV9vcl9zdGF0ZScsIHJldHVyblRvRmFsbGJhY2spXG4gIH1cblxuICBsZXQgcGF5bG9hZFxuICB0cnkge1xuICAgIHBheWxvYWQgPSBhd2FpdCB2ZXJpZnlPQXV0aFN0YXRlKHN0YXRlLCBjb25maWcuY2xpZW50U2VjcmV0LCBkZXBzLm5vd01zKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gZXJyIGluc3RhbmNlb2YgR21haWxPQXV0aEVycm9yXG4gICAgICA/IGVyci5tZXNzYWdlXG4gICAgICA6ICdpbnZhbGlkX3N0YXRlJ1xuICAgIHJldHVybiByZWRpcmVjdEVycm9yKG1lc3NhZ2UsIHJldHVyblRvRmFsbGJhY2spXG4gIH1cblxuICBpZiAoIWlzUmV0dXJuVG9BbGxvd2VkKHBheWxvYWQucmV0dXJuVG8sIGNvbmZpZy5yZXR1cm5Ub0FsbG93bGlzdCkpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKCdHbWFpbCBPQXV0aCBmYWlsZWQ6IHJldHVyblRvIGlzIG5vdCBhbGxvd2VkJywge1xuICAgICAgc3RhdHVzOiA0MDAsXG4gICAgfSlcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgdG9rZW5zID0gYXdhaXQgZXhjaGFuZ2VBdXRob3JpemF0aW9uQ29kZSh7XG4gICAgICBjb2RlLFxuICAgICAgY2xpZW50SWQ6IGNvbmZpZy5jbGllbnRJZCxcbiAgICAgIGNsaWVudFNlY3JldDogY29uZmlnLmNsaWVudFNlY3JldCxcbiAgICAgIHJlZGlyZWN0VXJpOiBjb25maWcucmVkaXJlY3RVcmksXG4gICAgICBmZXRjaEltcGw6IGRlcHMuZmV0Y2hJbXBsLFxuICAgIH0pXG5cbiAgICBjb25zdCBtYWlsYm94ID0gYXdhaXQgZGVwcy5kYlxuICAgICAgLnNlbGVjdEZyb20oJ21haWxib3hlcycpXG4gICAgICAuc2VsZWN0KFsnaWQnLCAndXNlcl9pZCcsICdwcm92aWRlciddKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgcGF5bG9hZC5tYWlsYm94SWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIW1haWxib3ggfHwgbWFpbGJveC51c2VyX2lkICE9PSBwYXlsb2FkLnVzZXJJZCkge1xuICAgICAgcmV0dXJuIHJlZGlyZWN0RXJyb3IoJ21haWxib3hfbm90X2ZvdW5kJywgcGF5bG9hZC5yZXR1cm5UbylcbiAgICB9XG4gICAgaWYgKG1haWxib3gucHJvdmlkZXIgIT09ICdnbWFpbCcpIHtcbiAgICAgIHJldHVybiByZWRpcmVjdEVycm9yKCdtYWlsYm94X25vdF9nbWFpbCcsIHBheWxvYWQucmV0dXJuVG8pXG4gICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoXG4gICAgICBkZXBzLm5vd01zID8/IERhdGUubm93KCksXG4gICAgKS50b0lTT1N0cmluZygpXG4gICAgY29uc3QgZW1haWwgPSBhd2FpdCBmZXRjaEdtYWlsRW1haWxBZGRyZXNzKHtcbiAgICAgIGFjY2Vzc1Rva2VuOiB0b2tlbnMuYWNjZXNzVG9rZW4sXG4gICAgICBmZXRjaEltcGw6IGRlcHMuZmV0Y2hJbXBsLFxuICAgIH0pXG4gICAgYXdhaXQgZGVwcy5kYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdtYWlsYm94ZXMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIG9hdXRoX3Rva2Vuc19qc29uOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgYWNjZXNzVG9rZW46IHRva2Vucy5hY2Nlc3NUb2tlbixcbiAgICAgICAgICByZWZyZXNoVG9rZW46IHRva2Vucy5yZWZyZXNoVG9rZW4sXG4gICAgICAgICAgZXhwaXJlc0F0TXM6IHRva2Vucy5leHBpcmVzQXRNcyxcbiAgICAgICAgfSksXG4gICAgICAgIC4uLihlbWFpbCA/IHsgbGFiZWw6IGVtYWlsIH0gOiB7fSksXG4gICAgICAgIHN5bmNfcmVxdWVzdGVkOiB0cnVlLFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgbWFpbGJveC5pZClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiBSZXNwb25zZS5yZWRpcmVjdChcbiAgICAgIGJ1aWxkUmV0dXJuUmVkaXJlY3QocGF5bG9hZC5yZXR1cm5UbywgeyBvazogdHJ1ZSB9KSxcbiAgICAgIDMwMixcbiAgICApXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBHbWFpbE9BdXRoRXJyb3JcbiAgICAgID8gZXJyLm1lc3NhZ2VcbiAgICAgIDogJ3Rva2VuX2V4Y2hhbmdlX2ZhaWxlZCdcbiAgICByZXR1cm4gcmVkaXJlY3RFcnJvcihtZXNzYWdlLCBwYXlsb2FkLnJldHVyblRvKVxuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsU0FBUyxXQUFXOzs7QUNBcEIsU0FBUyxrQkFBa0I7OztBQzhDcEIsSUFBTSwwQkFBMEI7OztBQ05oQyxTQUFTLG1CQUNkLGFBQ0EsU0FDUztBQUNULFFBQU0saUJBQWlCLGNBQWMsV0FB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QUFJLElBQUksSUFBSSxXQUFXLFdBQVc7QUFDaEMsVUFBTSxLQUFLO0FBQ1g7QUFBQSxFQUNGO0FBRUEsUUFBTSxNQUFNLElBQUksSUFBSSxJQUFJLElBQUksR0FBRztBQUMvQixNQUFJLElBQUksYUFBYSwyQkFBMkIsSUFBSSxJQUFJLFdBQVcsT0FBTztBQUN4RSxXQUFPLHlCQUF5QixLQUFLLEVBQUUsR0FBRyxDQUFDO0FBQUEsRUFDN0M7QUFFQSxRQUFNLEtBQUs7QUFDYixDQUFDO0FBRUQsSUFBSSxJQUFJLDRCQUE0QkUsaUJBQWdCLENBQUM7QUFFOUMsSUFBTSxVQUFVO0FBQUEsRUFDckIsR0FBRztBQUNMO0FBRUEsSUFBTyxjQUFRO0FBSVQsSUFBSSx3QkFBd0I7QUFFNUIsSUFBSTtBQUNGLDBCQUF3QjtBQUMxQixRQUFRO0FBRVI7QUFFQSxJQUFJLElBQUksdUJBQXVCO0FBQUEsRUFDN0IsVUFBVTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLFdBQVcsQ0FBQztBQUFBLEVBQ1osUUFBUTtBQUNWLENBQUMsQ0FBQzsiLAogICJuYW1lcyI6IFsiZGIiLCAiZGIiLCAiZGIiLCAicm93VG9FbWFpbE1lc3NhZ2UiLCAiZGIiLCAiZW52IiwgInJvdyIsICJjb25maWciLCAicmVzb2x2ZUxvY2FsVXNlciIsICJkYiIsICJyZXNvbHZlTG9jYWxVc2VyIiwgImNvbmZpZyIsICJwYXlsb2FkIiwgInJlc29sdmVMb2NhbFVzZXIiXQp9Cg==
