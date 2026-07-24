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
  typeDefs: "input CreateMailboxInputInput {\n	provider: String!\n	label: String!\n	enabled: Boolean\n	domainFilters: [String!]\n	oauthTokensJson: String\n}\ninput UpdateMailboxInputInput {\n	id: Number!\n	label: String!\n}\ninput SetDomainFiltersInputInput {\n	mailboxId: Number!\n	patterns: [String!]!\n}\ninput UpdateArtifactStatusInputInput {\n	artifactId: Number!\n	status: String!\n	categoryId: Number\n}\ninput ConnectGmailInputInput {\n	mailboxId: Number!\n	accessToken: String!\n	refreshToken: String\n	expiresAtMs: Number\n}\ninput StartGmailOAuthInputInput {\n	mailboxId: Number!\n	returnTo: String!\n}\ninput CreateParsingTemplateInputInput {\n	mailboxId: Number!\n	name: String!\n	kind: String\n	matchFromPattern: String!\n	matchSubjectRegex: String\n	extractorsJson: String\n	enabled: Boolean\n	sourceMessageId: Number\n}\ninput UpdateParsingTemplateInputInput {\n	id: Number!\n	name: String\n	matchFromPattern: String\n	matchSubjectRegex: String\n	extractorsJson: String\n	enabled: Boolean\n}\ninput GenerateParsingTemplateInputInput {\n	messageId: Number!\n	decision: String!\n	name: String\n	hints: String\n}\ntype Query {\nmailboxes: [Mailbox!]!\ndomainFilters(mailboxId: Number!): [DomainFilter!]!\nmessages(mailboxId: Number!, excludeMatchingTemplates: Boolean): [Message!]!\nmessage(id: Number!): Message\nsourceMessageForExpense(expenseId: Number!): Message\nextractionArtifacts(mailboxId: Number, status: String, page: Number, pageSize: Number): ExtractionArtifactPage!\nsyncRuns(mailboxId: Number!): [SyncRun!]!\nparsingTemplates(mailboxId: Number!): [ParsingTemplate!]!\n}\ntype Mailbox {\nid: Number!\nuser_id: Number!\nprovider: String!\nlabel: String!\nenabled: Boolean!\nsync_cursor: String\nsync_requested: Boolean!\nsync_since: String\nsync_until: String\nlast_synced_at: String\ncreated_at: String!\nupdated_at: String!\n}\ntype DomainFilter {\nid: Number!\nmailbox_id: Number!\npattern: String!\ncreated_at: String!\n}\ntype Message {\nid: Number!\nmailbox_id: Number!\nprovider_message_id: String!\nrfc_message_id: String!\nfrom_address: String!\nsubject: String!\nreceived_at: String!\ntext_body: String\nhtml_body: String\ncreated_at: String!\n}\ntype ExtractionArtifactPage {\nitems: [ExtractionArtifact!]!\ntotalCount: Number!\npage: Number!\npageSize: Number!\n}\ntype ExtractionArtifact {\nid: Number!\nmessage_id: Number!\nkind: String!\npayload: String!\nconfidence: Number!\nstatus: String!\npublished_expense_id: Number\ncreated_at: String!\nupdated_at: String!\n}\ntype SyncRun {\nid: Number!\nmailbox_id: Number!\nstarted_at: String!\nfinished_at: String\nfetched_count: Number!\nextracted_count: Number!\nerror_text: String\n}\ntype ParsingTemplate {\nid: Number!\nmailbox_id: Number!\nuser_id: Number!\nname: String!\nkind: String!\nenabled: Boolean!\nmatch_from_pattern: String!\nmatch_subject_regex: String\nextractors: String\nsource_message_id: Number\nversion: Number!\ncreated_at: String!\nupdated_at: String!\n}\ntype Mutation {\ncreateMailbox(input: CreateMailboxInputInput!): Mailbox!\nupdateMailbox(input: UpdateMailboxInputInput!): Mailbox!\ndeleteMailbox(id: Number!): Boolean!\nclearInbox(mailboxId: Number!): Mailbox!\nsetDomainFilters(input: SetDomainFiltersInputInput!): [DomainFilter!]!\ntriggerSync(mailboxId: Number!, since: String, until: String): Mailbox!\nrejectAllPendingArtifacts(mailboxId: Number!): Number!\nupdateArtifactStatus(input: UpdateArtifactStatusInputInput!): ExtractionArtifact!\nconnectGmail(input: ConnectGmailInputInput!): Mailbox!\nstartGmailOAuth(input: StartGmailOAuthInputInput!): StartGmailOAuthPayload!\ncreateParsingTemplate(input: CreateParsingTemplateInputInput!): ParsingTemplate!\nupdateParsingTemplate(input: UpdateParsingTemplateInputInput!): ParsingTemplate!\ndeleteParsingTemplate(id: Number!): Boolean!\ngenerateParsingTemplate(input: GenerateParsingTemplateInputInput!): GenerateParsingTemplatePayload!\n}\ntype StartGmailOAuthPayload {\nauthorizationUrl: String!\n}\ntype GenerateParsingTemplatePayload {\ntemplate: ParsingTemplate!\nreevaluatedCount: Number!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vLi4vLi4vbGlicy9tYWlsYm94X2tpdC90eXBlcy50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2RvbWFpbl9maWx0ZXIudHMiLCAiLi4vLi4vLi4vbGlicy9tYWlsYm94X2tpdC90ZW1wbGF0ZV9tYXRjaC50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2V4dHJhY3Rvci50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2h0bWxfdG9fcGxhaW5fdGV4dC50cyIsICIuLi8uLi8uLi9saWJzL21haWxib3hfa2l0L2V4dHJhY3RvcnMvdGVtcGxhdGVfc3BlbmRpbmdfZXh0cmFjdG9yLnRzIiwgIi4uLy4uLy4uL2xpYnMvbWFpbGJveF9raXQvdGVtcGxhdGVfZXh0cmFjdC50cyIsICIuLi9zcmMvZGIvdHlwZXMvc2NoZW1hLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL2NyZWF0ZV9reXNlbHkudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvZW52LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3NzbC50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL3NlcnZpY2VzL2FpX2NsaWVudC50cyIsICIuLi9zcmMvc2VydmljZXMvYXBwbHlfdGVtcGxhdGVzLnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9pbmJveF9vcHMudHMiLCAiLi4vc3JjL3NlcnZpY2VzL3RlbXBsYXRlX3JlZXZhbHVhdGUudHMiLCAiLi4vc3JjL2dyYXBocWwvdGltZXN0YW1wcy50cyIsICIuLi9zcmMvc2VydmljZXMvbWVzc2FnZV9sb29rdXBzLnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9zcGVuZG1hbmFnZXJfZXhwZW5zZV9zaW5rLnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9nbWFpbF9vYXV0aC50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2F1dGgvdmVyaWZ5LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B5bG9uL21pZGRsZXdhcmUudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvdXNlcnMudHMiLCAiLi4vc3JjL2RiL3VzZXJzLnRzIiwgIi4uL3NyYy9zZXJ2aWNlcy9nbWFpbF9vYXV0aF9jYWxsYmFjay50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHJlc29sdmVycyB9IGZyb20gJy4vZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzJ1xuaW1wb3J0IHsgY29yc01pZGRsZXdhcmUgfSBmcm9tICdkZW5vX2FwaV9raXQvYXV0aC92ZXJpZnkudHMnXG5pbXBvcnQge1xuICBjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUsXG4gIGhlYWx0aE1pZGRsZXdhcmUsXG59IGZyb20gJ2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciB9IGZyb20gJy4vZGIvdXNlcnMudHMnXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgeyBoYW5kbGVHbWFpbE9BdXRoQ2FsbGJhY2sgfSBmcm9tICcuL3NlcnZpY2VzL2dtYWlsX29hdXRoX2NhbGxiYWNrLnRzJ1xuXG5hcHAudXNlKGNvcnNNaWRkbGV3YXJlKVxuYXBwLnVzZShoZWFsdGhNaWRkbGV3YXJlKVxuXG4vKiogUHVibGljIEdvb2dsZSBPQXV0aCByZWRpcmVjdCAoYXV0aCBpcyBzaWduZWQgYHN0YXRlYCkuICovXG5hcHAudXNlKGFzeW5jIChjdHgsIG5leHQpID0+IHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoY3R4LnJlcS51cmwpXG4gIGlmICh1cmwucGF0aG5hbWUgPT09ICcvb2F1dGgvZ21haWwvY2FsbGJhY2snICYmIGN0eC5yZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgIHJldHVybiBoYW5kbGVHbWFpbE9BdXRoQ2FsbGJhY2sodXJsLCB7IGRiIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcbn0pXG5cbmFwcC51c2UoY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlKHJlc29sdmVMb2NhbFVzZXIpKVxuXG5leHBvcnQgY29uc3QgZ3JhcGhxbCA9IHtcbiAgLi4ucmVzb2x2ZXJzLFxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJpbnB1dCBDcmVhdGVNYWlsYm94SW5wdXRJbnB1dCB7XFxuXFx0cHJvdmlkZXI6IFN0cmluZyFcXG5cXHRsYWJlbDogU3RyaW5nIVxcblxcdGVuYWJsZWQ6IEJvb2xlYW5cXG5cXHRkb21haW5GaWx0ZXJzOiBbU3RyaW5nIV1cXG5cXHRvYXV0aFRva2Vuc0pzb246IFN0cmluZ1xcbn1cXG5pbnB1dCBVcGRhdGVNYWlsYm94SW5wdXRJbnB1dCB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRsYWJlbDogU3RyaW5nIVxcbn1cXG5pbnB1dCBTZXREb21haW5GaWx0ZXJzSW5wdXRJbnB1dCB7XFxuXFx0bWFpbGJveElkOiBOdW1iZXIhXFxuXFx0cGF0dGVybnM6IFtTdHJpbmchXSFcXG59XFxuaW5wdXQgVXBkYXRlQXJ0aWZhY3RTdGF0dXNJbnB1dElucHV0IHtcXG5cXHRhcnRpZmFjdElkOiBOdW1iZXIhXFxuXFx0c3RhdHVzOiBTdHJpbmchXFxuXFx0Y2F0ZWdvcnlJZDogTnVtYmVyXFxufVxcbmlucHV0IENvbm5lY3RHbWFpbElucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdGFjY2Vzc1Rva2VuOiBTdHJpbmchXFxuXFx0cmVmcmVzaFRva2VuOiBTdHJpbmdcXG5cXHRleHBpcmVzQXRNczogTnVtYmVyXFxufVxcbmlucHV0IFN0YXJ0R21haWxPQXV0aElucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdHJldHVyblRvOiBTdHJpbmchXFxufVxcbmlucHV0IENyZWF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQge1xcblxcdG1haWxib3hJZDogTnVtYmVyIVxcblxcdG5hbWU6IFN0cmluZyFcXG5cXHRraW5kOiBTdHJpbmdcXG5cXHRtYXRjaEZyb21QYXR0ZXJuOiBTdHJpbmchXFxuXFx0bWF0Y2hTdWJqZWN0UmVnZXg6IFN0cmluZ1xcblxcdGV4dHJhY3RvcnNKc29uOiBTdHJpbmdcXG5cXHRlbmFibGVkOiBCb29sZWFuXFxuXFx0c291cmNlTWVzc2FnZUlkOiBOdW1iZXJcXG59XFxuaW5wdXQgVXBkYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXRJbnB1dCB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRuYW1lOiBTdHJpbmdcXG5cXHRtYXRjaEZyb21QYXR0ZXJuOiBTdHJpbmdcXG5cXHRtYXRjaFN1YmplY3RSZWdleDogU3RyaW5nXFxuXFx0ZXh0cmFjdG9yc0pzb246IFN0cmluZ1xcblxcdGVuYWJsZWQ6IEJvb2xlYW5cXG59XFxuaW5wdXQgR2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0IHtcXG5cXHRtZXNzYWdlSWQ6IE51bWJlciFcXG5cXHRkZWNpc2lvbjogU3RyaW5nIVxcblxcdG5hbWU6IFN0cmluZ1xcblxcdGhpbnRzOiBTdHJpbmdcXG59XFxudHlwZSBRdWVyeSB7XFxubWFpbGJveGVzOiBbTWFpbGJveCFdIVxcbmRvbWFpbkZpbHRlcnMobWFpbGJveElkOiBOdW1iZXIhKTogW0RvbWFpbkZpbHRlciFdIVxcbm1lc3NhZ2VzKG1haWxib3hJZDogTnVtYmVyISwgZXhjbHVkZU1hdGNoaW5nVGVtcGxhdGVzOiBCb29sZWFuKTogW01lc3NhZ2UhXSFcXG5tZXNzYWdlKGlkOiBOdW1iZXIhKTogTWVzc2FnZVxcbnNvdXJjZU1lc3NhZ2VGb3JFeHBlbnNlKGV4cGVuc2VJZDogTnVtYmVyISk6IE1lc3NhZ2VcXG5leHRyYWN0aW9uQXJ0aWZhY3RzKG1haWxib3hJZDogTnVtYmVyLCBzdGF0dXM6IFN0cmluZywgcGFnZTogTnVtYmVyLCBwYWdlU2l6ZTogTnVtYmVyKTogRXh0cmFjdGlvbkFydGlmYWN0UGFnZSFcXG5zeW5jUnVucyhtYWlsYm94SWQ6IE51bWJlciEpOiBbU3luY1J1biFdIVxcbnBhcnNpbmdUZW1wbGF0ZXMobWFpbGJveElkOiBOdW1iZXIhKTogW1BhcnNpbmdUZW1wbGF0ZSFdIVxcbn1cXG50eXBlIE1haWxib3gge1xcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbnByb3ZpZGVyOiBTdHJpbmchXFxubGFiZWw6IFN0cmluZyFcXG5lbmFibGVkOiBCb29sZWFuIVxcbnN5bmNfY3Vyc29yOiBTdHJpbmdcXG5zeW5jX3JlcXVlc3RlZDogQm9vbGVhbiFcXG5zeW5jX3NpbmNlOiBTdHJpbmdcXG5zeW5jX3VudGlsOiBTdHJpbmdcXG5sYXN0X3N5bmNlZF9hdDogU3RyaW5nXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBEb21haW5GaWx0ZXIge1xcbmlkOiBOdW1iZXIhXFxubWFpbGJveF9pZDogTnVtYmVyIVxcbnBhdHRlcm46IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgTWVzc2FnZSB7XFxuaWQ6IE51bWJlciFcXG5tYWlsYm94X2lkOiBOdW1iZXIhXFxucHJvdmlkZXJfbWVzc2FnZV9pZDogU3RyaW5nIVxcbnJmY19tZXNzYWdlX2lkOiBTdHJpbmchXFxuZnJvbV9hZGRyZXNzOiBTdHJpbmchXFxuc3ViamVjdDogU3RyaW5nIVxcbnJlY2VpdmVkX2F0OiBTdHJpbmchXFxudGV4dF9ib2R5OiBTdHJpbmdcXG5odG1sX2JvZHk6IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBFeHRyYWN0aW9uQXJ0aWZhY3RQYWdlIHtcXG5pdGVtczogW0V4dHJhY3Rpb25BcnRpZmFjdCFdIVxcbnRvdGFsQ291bnQ6IE51bWJlciFcXG5wYWdlOiBOdW1iZXIhXFxucGFnZVNpemU6IE51bWJlciFcXG59XFxudHlwZSBFeHRyYWN0aW9uQXJ0aWZhY3Qge1xcbmlkOiBOdW1iZXIhXFxubWVzc2FnZV9pZDogTnVtYmVyIVxcbmtpbmQ6IFN0cmluZyFcXG5wYXlsb2FkOiBTdHJpbmchXFxuY29uZmlkZW5jZTogTnVtYmVyIVxcbnN0YXR1czogU3RyaW5nIVxcbnB1Ymxpc2hlZF9leHBlbnNlX2lkOiBOdW1iZXJcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxudXBkYXRlZF9hdDogU3RyaW5nIVxcbn1cXG50eXBlIFN5bmNSdW4ge1xcbmlkOiBOdW1iZXIhXFxubWFpbGJveF9pZDogTnVtYmVyIVxcbnN0YXJ0ZWRfYXQ6IFN0cmluZyFcXG5maW5pc2hlZF9hdDogU3RyaW5nXFxuZmV0Y2hlZF9jb3VudDogTnVtYmVyIVxcbmV4dHJhY3RlZF9jb3VudDogTnVtYmVyIVxcbmVycm9yX3RleHQ6IFN0cmluZ1xcbn1cXG50eXBlIFBhcnNpbmdUZW1wbGF0ZSB7XFxuaWQ6IE51bWJlciFcXG5tYWlsYm94X2lkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5raW5kOiBTdHJpbmchXFxuZW5hYmxlZDogQm9vbGVhbiFcXG5tYXRjaF9mcm9tX3BhdHRlcm46IFN0cmluZyFcXG5tYXRjaF9zdWJqZWN0X3JlZ2V4OiBTdHJpbmdcXG5leHRyYWN0b3JzOiBTdHJpbmdcXG5zb3VyY2VfbWVzc2FnZV9pZDogTnVtYmVyXFxudmVyc2lvbjogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgTXV0YXRpb24ge1xcbmNyZWF0ZU1haWxib3goaW5wdXQ6IENyZWF0ZU1haWxib3hJbnB1dElucHV0ISk6IE1haWxib3ghXFxudXBkYXRlTWFpbGJveChpbnB1dDogVXBkYXRlTWFpbGJveElucHV0SW5wdXQhKTogTWFpbGJveCFcXG5kZWxldGVNYWlsYm94KGlkOiBOdW1iZXIhKTogQm9vbGVhbiFcXG5jbGVhckluYm94KG1haWxib3hJZDogTnVtYmVyISk6IE1haWxib3ghXFxuc2V0RG9tYWluRmlsdGVycyhpbnB1dDogU2V0RG9tYWluRmlsdGVyc0lucHV0SW5wdXQhKTogW0RvbWFpbkZpbHRlciFdIVxcbnRyaWdnZXJTeW5jKG1haWxib3hJZDogTnVtYmVyISwgc2luY2U6IFN0cmluZywgdW50aWw6IFN0cmluZyk6IE1haWxib3ghXFxucmVqZWN0QWxsUGVuZGluZ0FydGlmYWN0cyhtYWlsYm94SWQ6IE51bWJlciEpOiBOdW1iZXIhXFxudXBkYXRlQXJ0aWZhY3RTdGF0dXMoaW5wdXQ6IFVwZGF0ZUFydGlmYWN0U3RhdHVzSW5wdXRJbnB1dCEpOiBFeHRyYWN0aW9uQXJ0aWZhY3QhXFxuY29ubmVjdEdtYWlsKGlucHV0OiBDb25uZWN0R21haWxJbnB1dElucHV0ISk6IE1haWxib3ghXFxuc3RhcnRHbWFpbE9BdXRoKGlucHV0OiBTdGFydEdtYWlsT0F1dGhJbnB1dElucHV0ISk6IFN0YXJ0R21haWxPQXV0aFBheWxvYWQhXFxuY3JlYXRlUGFyc2luZ1RlbXBsYXRlKGlucHV0OiBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dElucHV0ISk6IFBhcnNpbmdUZW1wbGF0ZSFcXG51cGRhdGVQYXJzaW5nVGVtcGxhdGUoaW5wdXQ6IFVwZGF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0SW5wdXQhKTogUGFyc2luZ1RlbXBsYXRlIVxcbmRlbGV0ZVBhcnNpbmdUZW1wbGF0ZShpZDogTnVtYmVyISk6IEJvb2xlYW4hXFxuZ2VuZXJhdGVQYXJzaW5nVGVtcGxhdGUoaW5wdXQ6IEdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXRJbnB1dCEpOiBHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZVBheWxvYWQhXFxufVxcbnR5cGUgU3RhcnRHbWFpbE9BdXRoUGF5bG9hZCB7XFxuYXV0aG9yaXphdGlvblVybDogU3RyaW5nIVxcbn1cXG50eXBlIEdlbmVyYXRlUGFyc2luZ1RlbXBsYXRlUGF5bG9hZCB7XFxudGVtcGxhdGU6IFBhcnNpbmdUZW1wbGF0ZSFcXG5yZWV2YWx1YXRlZENvdW50OiBOdW1iZXIhXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcblwiLFxuICAgICAgICBncmFwaHFsLFxuICAgICAgICByZXNvbHZlcnM6IHt9LFxuICAgICAgICBjb25maWc6IF9faW50ZXJuYWxQeWxvbkNvbmZpZ1xuICAgICAgfSkpXG4gICAgICAiLCAiaW1wb3J0IHsgZ2V0Q29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQge1xuICBTUEVORElOR19DQU5ESURBVEVfS0lORCxcbiAgbWVzc2FnZU1hdGNoZXNBbnlUZW1wbGF0ZSxcbiAgcGFyc2VTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyxcbiAgdHlwZSBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQsXG59IGZyb20gJ21haWxib3hfa2l0L21vZC50cydcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7IE5ld01haWxib3ggfSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQge1xuICBBaUNsaWVudEVycm9yLFxuICBnZW5lcmF0ZUVtYWlsUmVqZWN0VGVtcGxhdGUsXG4gIGdlbmVyYXRlRW1haWxTcGVuZFRlbXBsYXRlLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9haV9jbGllbnQudHMnXG5pbXBvcnQge1xuICBhcHBseVRlbXBsYXRlc1RvTWFpbGJveCxcbiAgY3JlYXRlS3lzZWx5QXBwbHlUZW1wbGF0ZXNTdG9yZSxcbn0gZnJvbSAnLi4vLi4vc2VydmljZXMvYXBwbHlfdGVtcGxhdGVzLnRzJ1xuaW1wb3J0IHtcbiAgY2xlYXJJbmJveERhdGEsXG4gIGNyZWF0ZUt5c2VseUluYm94T3BzU3RvcmUsXG4gIHJlamVjdEFsbFBlbmRpbmdBcnRpZmFjdHMgYXMgcmVqZWN0QWxsUGVuZGluZ0FydGlmYWN0c09wLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9pbmJveF9vcHMudHMnXG5pbXBvcnQge1xuICBjcmVhdGVLeXNlbHlUZW1wbGF0ZVJlZXZhbHVhdGVTdG9yZSxcbiAgcmVldmFsdWF0ZVBlbmRpbmdXaXRoVGVtcGxhdGUsXG59IGZyb20gJy4uLy4uL3NlcnZpY2VzL3RlbXBsYXRlX3JlZXZhbHVhdGUudHMnXG5pbXBvcnQge1xuICBjcmVhdGVLeXNlbHlNZXNzYWdlTG9va3VwU3RvcmUsXG4gIGZpbmRPd25lZE1lc3NhZ2UsXG4gIGZpbmRTb3VyY2VNZXNzYWdlRm9yRXhwZW5zZSxcbn0gZnJvbSAnLi4vLi4vc2VydmljZXMvbWVzc2FnZV9sb29rdXBzLnRzJ1xuaW1wb3J0IHtcbiAgU3BlbmRtYW5hZ2VyU2lua0Vycm9yLFxuICBwdWJsaXNoRXhwZW5zZVRvU3BlbmRtYW5hZ2VyLFxufSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9zcGVuZG1hbmFnZXJfZXhwZW5zZV9zaW5rLnRzJ1xuaW1wb3J0IHtcbiAgR21haWxPQXV0aEVycm9yLFxuICBidWlsZEdvb2dsZUF1dGhvcml6ZVVybCxcbiAgZmV0Y2hHbWFpbEVtYWlsQWRkcmVzcyxcbiAgaXNSZXR1cm5Ub0FsbG93ZWQsXG4gIGxvYWRHbWFpbE9BdXRoQ29uZmlnLFxuICBzaWduT0F1dGhTdGF0ZSxcbn0gZnJvbSAnLi4vLi4vc2VydmljZXMvZ21haWxfb2F1dGgudHMnXG5pbXBvcnQgeyBhc0lzb1RpbWVzdGFtcCwgYXNJc29UaW1lc3RhbXBPck51bGwgfSBmcm9tICcuLi90aW1lc3RhbXBzLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBDb25uZWN0R21haWxJbnB1dCxcbiAgQ3JlYXRlTWFpbGJveElucHV0LFxuICBDcmVhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgR2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgU2V0RG9tYWluRmlsdGVyc0lucHV0LFxuICBTdGFydEdtYWlsT0F1dGhJbnB1dCxcbiAgVXBkYXRlQXJ0aWZhY3RTdGF0dXNJbnB1dCxcbiAgVXBkYXRlTWFpbGJveElucHV0LFxuICBVcGRhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbn0gZnJvbSAnLi4vdHlwZXMudHMnXG5pbXBvcnQge1xuICBJbnZhbGlkTWFpbGJveEVycm9yLFxuICBjbGFtcEFydGlmYWN0UGFnZSxcbiAgdmFsaWRhdGVBcnRpZmFjdFN0YXR1cyxcbiAgdmFsaWRhdGVDYXRlZ29yeUlkLFxuICB2YWxpZGF0ZURvbWFpblBhdHRlcm5zLFxuICB2YWxpZGF0ZUxhYmVsLFxuICB2YWxpZGF0ZU1hdGNoRnJvbVBhdHRlcm4sXG4gIHZhbGlkYXRlT3B0aW9uYWxTeW5jRGF0ZSxcbiAgdmFsaWRhdGVQcm92aWRlcixcbiAgdmFsaWRhdGVTdWJqZWN0UmVnZXgsXG4gIHZhbGlkYXRlU3luY0RhdGVSYW5nZSxcbiAgdmFsaWRhdGVUZW1wbGF0ZUtpbmQsXG4gIHZhbGlkYXRlVGVtcGxhdGVOYW1lLFxufSBmcm9tICcuLi92YWxpZGF0aW9uLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVBdXRob3JpemF0aW9uSGVhZGVyKCk6IHN0cmluZyB7XG4gIGNvbnN0IGN0eCA9IGdldENvbnRleHQoKVxuICBjb25zdCBoZWFkZXIgPSBjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpXG4gIGlmICghaGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignbWlzc2luZyBBdXRob3JpemF0aW9uIGJlYXJlciB0b2tlbicpXG4gIH1cbiAgcmV0dXJuIGhlYWRlclxufVxuXG4vKiogTmFtZWQgcmV0dXJuIHNoYXBlcyBzbyBQeWxvbiBlbWl0cyBHcmFwaFFMIG9iamVjdCB0eXBlcyAobm90IGBBbnkhYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIE1haWxib3gge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBwcm92aWRlcjogc3RyaW5nXG4gIGxhYmVsOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBzeW5jX2N1cnNvcjogc3RyaW5nIHwgbnVsbFxuICBzeW5jX3JlcXVlc3RlZDogYm9vbGVhblxuICBzeW5jX3NpbmNlOiBzdHJpbmcgfCBudWxsXG4gIHN5bmNfdW50aWw6IHN0cmluZyB8IG51bGxcbiAgbGFzdF9zeW5jZWRfYXQ6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IHN0cmluZ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIERvbWFpbkZpbHRlciB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHBhdHRlcm46IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNZXNzYWdlIHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBzdHJpbmdcbiAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keTogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBFeHRyYWN0aW9uQXJ0aWZhY3Qge1xuICBpZDogbnVtYmVyXG4gIG1lc3NhZ2VfaWQ6IG51bWJlclxuICBraW5kOiBzdHJpbmdcbiAgcGF5bG9hZDogc3RyaW5nXG4gIGNvbmZpZGVuY2U6IG51bWJlclxuICBzdGF0dXM6IHN0cmluZ1xuICBwdWJsaXNoZWRfZXhwZW5zZV9pZDogbnVtYmVyIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBzdHJpbmdcbiAgdXBkYXRlZF9hdDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdGlvbkFydGlmYWN0UGFnZSB7XG4gIGl0ZW1zOiBFeHRyYWN0aW9uQXJ0aWZhY3RbXVxuICB0b3RhbENvdW50OiBudW1iZXJcbiAgcGFnZTogbnVtYmVyXG4gIHBhZ2VTaXplOiBudW1iZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTeW5jUnVuIHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgc3RhcnRlZF9hdDogc3RyaW5nXG4gIGZpbmlzaGVkX2F0OiBzdHJpbmcgfCBudWxsXG4gIGZldGNoZWRfY291bnQ6IG51bWJlclxuICBleHRyYWN0ZWRfY291bnQ6IG51bWJlclxuICBlcnJvcl90ZXh0OiBzdHJpbmcgfCBudWxsXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2luZ1RlbXBsYXRlIHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICBraW5kOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBtYXRjaF9mcm9tX3BhdHRlcm46IHN0cmluZ1xuICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IHN0cmluZyB8IG51bGxcbiAgc291cmNlX21lc3NhZ2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdmVyc2lvbjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGFydEdtYWlsT0F1dGhQYXlsb2FkIHtcbiAgYXV0aG9yaXphdGlvblVybDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVQYXlsb2FkIHtcbiAgdGVtcGxhdGU6IFBhcnNpbmdUZW1wbGF0ZVxuICByZWV2YWx1YXRlZENvdW50OiBudW1iZXJcbn1cblxuZnVuY3Rpb24gbWFwTWFpbGJveChyb3c6IHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgcHJvdmlkZXI6IHN0cmluZ1xuICBsYWJlbDogc3RyaW5nXG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgc3luY19jdXJzb3I6IHN0cmluZyB8IG51bGxcbiAgc3luY19yZXF1ZXN0ZWQ6IGJvb2xlYW5cbiAgc3luY19zaW5jZT86IERhdGUgfCBzdHJpbmcgfCBudWxsXG4gIHN5bmNfdW50aWw/OiBEYXRlIHwgc3RyaW5nIHwgbnVsbFxuICBsYXN0X3N5bmNlZF9hdDogRGF0ZSB8IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KTogTWFpbGJveCB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICB1c2VyX2lkOiByb3cudXNlcl9pZCxcbiAgICBwcm92aWRlcjogcm93LnByb3ZpZGVyLFxuICAgIGxhYmVsOiByb3cubGFiZWwsXG4gICAgZW5hYmxlZDogcm93LmVuYWJsZWQsXG4gICAgc3luY19jdXJzb3I6IHJvdy5zeW5jX2N1cnNvcixcbiAgICBzeW5jX3JlcXVlc3RlZDogcm93LnN5bmNfcmVxdWVzdGVkLFxuICAgIHN5bmNfc2luY2U6IGFzSXNvVGltZXN0YW1wT3JOdWxsKHJvdy5zeW5jX3NpbmNlID8/IG51bGwpLFxuICAgIHN5bmNfdW50aWw6IGFzSXNvVGltZXN0YW1wT3JOdWxsKHJvdy5zeW5jX3VudGlsID8/IG51bGwpLFxuICAgIGxhc3Rfc3luY2VkX2F0OiBhc0lzb1RpbWVzdGFtcE9yTnVsbChyb3cubGFzdF9zeW5jZWRfYXQpLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgICB1cGRhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cudXBkYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwRG9tYWluRmlsdGVyKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwYXR0ZXJuOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSk6IERvbWFpbkZpbHRlciB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtYWlsYm94X2lkOiByb3cubWFpbGJveF9pZCxcbiAgICBwYXR0ZXJuOiByb3cucGF0dGVybixcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwTWVzc2FnZShyb3c6IHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHRleHRfYm9keT86IHN0cmluZyB8IG51bGxcbiAgaHRtbF9ib2R5Pzogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KTogTWVzc2FnZSB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtYWlsYm94X2lkOiByb3cubWFpbGJveF9pZCxcbiAgICBwcm92aWRlcl9tZXNzYWdlX2lkOiByb3cucHJvdmlkZXJfbWVzc2FnZV9pZCxcbiAgICByZmNfbWVzc2FnZV9pZDogcm93LnJmY19tZXNzYWdlX2lkLFxuICAgIGZyb21fYWRkcmVzczogcm93LmZyb21fYWRkcmVzcyxcbiAgICBzdWJqZWN0OiByb3cuc3ViamVjdCxcbiAgICByZWNlaXZlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnJlY2VpdmVkX2F0KSxcbiAgICB0ZXh0X2JvZHk6IHJvdy50ZXh0X2JvZHkgPz8gbnVsbCxcbiAgICBodG1sX2JvZHk6IHJvdy5odG1sX2JvZHkgPz8gbnVsbCxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwQXJ0aWZhY3Qocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgbWVzc2FnZV9pZDogbnVtYmVyXG4gIGtpbmQ6IHN0cmluZ1xuICBwYXlsb2FkOiB1bmtub3duXG4gIGNvbmZpZGVuY2U6IG51bWJlclxuICBzdGF0dXM6IHN0cmluZ1xuICBwdWJsaXNoZWRfZXhwZW5zZV9pZD86IG51bWJlciB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KTogRXh0cmFjdGlvbkFydGlmYWN0IHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1lc3NhZ2VfaWQ6IHJvdy5tZXNzYWdlX2lkLFxuICAgIGtpbmQ6IHJvdy5raW5kLFxuICAgIHBheWxvYWQ6XG4gICAgICB0eXBlb2Ygcm93LnBheWxvYWQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gcm93LnBheWxvYWRcbiAgICAgICAgOiBKU09OLnN0cmluZ2lmeShyb3cucGF5bG9hZCA/PyB7fSksXG4gICAgY29uZmlkZW5jZTogcm93LmNvbmZpZGVuY2UsXG4gICAgc3RhdHVzOiByb3cuc3RhdHVzLFxuICAgIHB1Ymxpc2hlZF9leHBlbnNlX2lkOiByb3cucHVibGlzaGVkX2V4cGVuc2VfaWQgPz8gbnVsbCxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gICAgdXBkYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnVwZGF0ZWRfYXQpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcFN5bmNSdW4ocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHN0YXJ0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgZmluaXNoZWRfYXQ6IERhdGUgfCBzdHJpbmcgfCBudWxsXG4gIGZldGNoZWRfY291bnQ6IG51bWJlclxuICBleHRyYWN0ZWRfY291bnQ6IG51bWJlclxuICBlcnJvcl90ZXh0OiBzdHJpbmcgfCBudWxsXG59KTogU3luY1J1biB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtYWlsYm94X2lkOiByb3cubWFpbGJveF9pZCxcbiAgICBzdGFydGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuc3RhcnRlZF9hdCksXG4gICAgZmluaXNoZWRfYXQ6IGFzSXNvVGltZXN0YW1wT3JOdWxsKHJvdy5maW5pc2hlZF9hdCksXG4gICAgZmV0Y2hlZF9jb3VudDogcm93LmZldGNoZWRfY291bnQsXG4gICAgZXh0cmFjdGVkX2NvdW50OiByb3cuZXh0cmFjdGVkX2NvdW50LFxuICAgIGVycm9yX3RleHQ6IHJvdy5lcnJvcl90ZXh0LFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcFBhcnNpbmdUZW1wbGF0ZShyb3c6IHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICBraW5kOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBtYXRjaF9mcm9tX3BhdHRlcm46IHN0cmluZ1xuICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBzdHJpbmcgfCBudWxsXG4gIGV4dHJhY3RvcnM6IHVua25vd25cbiAgc291cmNlX21lc3NhZ2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdmVyc2lvbjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSk6IFBhcnNpbmdUZW1wbGF0ZSB7XG4gIGxldCBleHRyYWN0b3JzOiBzdHJpbmcgfCBudWxsID0gbnVsbFxuICBpZiAocm93LmV4dHJhY3RvcnMgIT0gbnVsbCkge1xuICAgIGV4dHJhY3RvcnMgPSB0eXBlb2Ygcm93LmV4dHJhY3RvcnMgPT09ICdzdHJpbmcnXG4gICAgICA/IHJvdy5leHRyYWN0b3JzXG4gICAgICA6IEpTT04uc3RyaW5naWZ5KHJvdy5leHRyYWN0b3JzKVxuICB9XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBtYWlsYm94X2lkOiByb3cubWFpbGJveF9pZCxcbiAgICB1c2VyX2lkOiByb3cudXNlcl9pZCxcbiAgICBuYW1lOiByb3cubmFtZSxcbiAgICBraW5kOiByb3cua2luZCxcbiAgICBlbmFibGVkOiByb3cuZW5hYmxlZCxcbiAgICBtYXRjaF9mcm9tX3BhdHRlcm46IHJvdy5tYXRjaF9mcm9tX3BhdHRlcm4sXG4gICAgbWF0Y2hfc3ViamVjdF9yZWdleDogcm93Lm1hdGNoX3N1YmplY3RfcmVnZXgsXG4gICAgZXh0cmFjdG9ycyxcbiAgICBzb3VyY2VfbWVzc2FnZV9pZDogcm93LnNvdXJjZV9tZXNzYWdlX2lkLFxuICAgIHZlcnNpb246IHJvdy52ZXJzaW9uLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgICB1cGRhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cudXBkYXRlZF9hdCksXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQ6IG51bWJlciwgbWFpbGJveElkOiBudW1iZXIpIHtcbiAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnbWFpbGJveGVzJylcbiAgICAuc2VsZWN0QWxsKClcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ21haWxib3ggbm90IGZvdW5kJylcbiAgcmV0dXJuIHJvd1xufVxuXG5mdW5jdGlvbiBwYXJzZUV4dHJhY3RvcnNKc29uKHJhdzogc3RyaW5nKSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd25cbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdylcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2V4dHJhY3RvcnNKc29uIG11c3QgYmUgdmFsaWQgSlNPTicpXG4gIH1cbiAgY29uc3QgZXh0cmFjdG9ycyA9IHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMocGFyc2VkKVxuICBpZiAoIWV4dHJhY3RvcnMpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignZXh0cmFjdG9yc0pzb24gaGFzIGludmFsaWQgc2hhcGUnKVxuICB9XG4gIHJldHVybiBleHRyYWN0b3JzXG59XG5cbmZ1bmN0aW9uIGFzU3BlbmRpbmdQYXlsb2FkKHBheWxvYWQ6IHVua25vd24pOiBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQgfCBudWxsIHtcbiAgY29uc3Qgb2JqID0gdHlwZW9mIHBheWxvYWQgPT09ICdzdHJpbmcnXG4gICAgPyAoKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UocGF5bG9hZClcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbFxuICAgICAgfVxuICAgIH0pKClcbiAgICA6IHBheWxvYWRcbiAgaWYgKG9iaiA9PT0gbnVsbCB8fCB0eXBlb2Ygb2JqICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KG9iaikpIHJldHVybiBudWxsXG4gIGNvbnN0IHAgPSBvYmogYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgaWYgKHR5cGVvZiBwLmFtb3VudENlbnRzICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgcC5zcGVudE9uICE9PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgcmV0dXJuIHtcbiAgICBhbW91bnRDZW50czogcC5hbW91bnRDZW50cyxcbiAgICBjdXJyZW5jeTogdHlwZW9mIHAuY3VycmVuY3kgPT09ICdzdHJpbmcnID8gcC5jdXJyZW5jeSA6ICdVU0QnLFxuICAgIHNwZW50T246IHAuc3BlbnRPbixcbiAgICBtZXJjaGFudDogdHlwZW9mIHAubWVyY2hhbnQgPT09ICdzdHJpbmcnID8gcC5tZXJjaGFudCA6IG51bGwsXG4gICAgbm90ZTogdHlwZW9mIHAubm90ZSA9PT0gJ3N0cmluZycgPyBwLm5vdGUgOiBudWxsLFxuICAgIHNvdXJjZVN1YmplY3Q6IHR5cGVvZiBwLnNvdXJjZVN1YmplY3QgPT09ICdzdHJpbmcnID8gcC5zb3VyY2VTdWJqZWN0IDogJycsXG4gICAgc291cmNlRnJvbTogdHlwZW9mIHAuc291cmNlRnJvbSA9PT0gJ3N0cmluZycgPyBwLnNvdXJjZUZyb20gOiAnJyxcbiAgICBwdWJsaXNoZWRFeHBlbnNlSWQ6XG4gICAgICB0eXBlb2YgcC5wdWJsaXNoZWRFeHBlbnNlSWQgPT09ICdudW1iZXInID8gcC5wdWJsaXNoZWRFeHBlbnNlSWQgOiBudWxsLFxuICAgIHRlbXBsYXRlSWQ6IHR5cGVvZiBwLnRlbXBsYXRlSWQgPT09ICdudW1iZXInID8gcC50ZW1wbGF0ZUlkIDogbnVsbCxcbiAgfVxufVxuXG5jb25zdCBRdWVyeSA9IHtcbiAgYXN5bmMgbWFpbGJveGVzKCk6IFByb21pc2U8TWFpbGJveFtdPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnbWFpbGJveGVzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwTWFpbGJveClcbiAgfSxcblxuICBhc3luYyBkb21haW5GaWx0ZXJzKG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxEb21haW5GaWx0ZXJbXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBEb21haW5GaWx0ZXIpXG4gIH0sXG5cbiAgYXN5bmMgbWVzc2FnZXMoXG4gICAgbWFpbGJveElkOiBudW1iZXIsXG4gICAgZXhjbHVkZU1hdGNoaW5nVGVtcGxhdGVzPzogYm9vbGVhbixcbiAgKTogUHJvbWlzZTxNZXNzYWdlW10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ21lc3NhZ2VzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAub3JkZXJCeSgncmVjZWl2ZWRfYXQnLCAnZGVzYycpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgY29uc3QgbWFwcGVkID0gcm93cy5tYXAobWFwTWVzc2FnZSlcbiAgICBpZiAoIWV4Y2x1ZGVNYXRjaGluZ1RlbXBsYXRlcykgcmV0dXJuIG1hcHBlZFxuXG4gICAgY29uc3QgdGVtcGxhdGVzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAuc2VsZWN0KFsnbWF0Y2hfZnJvbV9wYXR0ZXJuJywgJ21hdGNoX3N1YmplY3RfcmVnZXgnLCAnZW5hYmxlZCddKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAud2hlcmUoJ2VuYWJsZWQnLCAnPScsIHRydWUpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgY29uc3Qgc3BlY3MgPSB0ZW1wbGF0ZXMubWFwKCh0KSA9PiAoe1xuICAgICAgbWF0Y2hGcm9tUGF0dGVybjogdC5tYXRjaF9mcm9tX3BhdHRlcm4sXG4gICAgICBtYXRjaFN1YmplY3RSZWdleDogdC5tYXRjaF9zdWJqZWN0X3JlZ2V4LFxuICAgICAgZW5hYmxlZDogdC5lbmFibGVkLFxuICAgIH0pKVxuICAgIHJldHVybiBtYXBwZWQuZmlsdGVyKFxuICAgICAgKG0pID0+XG4gICAgICAgICFtZXNzYWdlTWF0Y2hlc0FueVRlbXBsYXRlKFxuICAgICAgICAgIHsgZnJvbTogbS5mcm9tX2FkZHJlc3MsIHN1YmplY3Q6IG0uc3ViamVjdCB9LFxuICAgICAgICAgIHNwZWNzLFxuICAgICAgICApLFxuICAgIClcbiAgfSxcblxuICBhc3luYyBtZXNzYWdlKGlkOiBudW1iZXIpOiBQcm9taXNlPE1lc3NhZ2UgfCBudWxsPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgcmV0dXJuIGF3YWl0IGZpbmRPd25lZE1lc3NhZ2UoY3JlYXRlS3lzZWx5TWVzc2FnZUxvb2t1cFN0b3JlKGRiKSwgdXNlcklkLCBpZClcbiAgfSxcblxuICBhc3luYyBzb3VyY2VNZXNzYWdlRm9yRXhwZW5zZShleHBlbnNlSWQ6IG51bWJlcik6IFByb21pc2U8TWVzc2FnZSB8IG51bGw+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICByZXR1cm4gYXdhaXQgZmluZFNvdXJjZU1lc3NhZ2VGb3JFeHBlbnNlKFxuICAgICAgY3JlYXRlS3lzZWx5TWVzc2FnZUxvb2t1cFN0b3JlKGRiKSxcbiAgICAgIHVzZXJJZCxcbiAgICAgIGV4cGVuc2VJZCxcbiAgICApXG4gIH0sXG5cbiAgYXN5bmMgZXh0cmFjdGlvbkFydGlmYWN0cyhcbiAgICBtYWlsYm94SWQ/OiBudW1iZXIgfCBudWxsLFxuICAgIHN0YXR1cz86IHN0cmluZyB8IG51bGwsXG4gICAgcGFnZT86IG51bWJlciB8IG51bGwsXG4gICAgcGFnZVNpemU/OiBudW1iZXIgfCBudWxsLFxuICApOiBQcm9taXNlPEV4dHJhY3Rpb25BcnRpZmFjdFBhZ2U+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCB7IHBhZ2U6IHNhZmVQYWdlLCBwYWdlU2l6ZTogc2FmZVNpemUsIG9mZnNldCB9ID0gY2xhbXBBcnRpZmFjdFBhZ2UoXG4gICAgICBwYWdlLFxuICAgICAgcGFnZVNpemUsXG4gICAgKVxuICAgIGNvbnN0IHN0YXR1c0ZpbHRlciA9XG4gICAgICBzdGF0dXMgIT0gbnVsbCAmJiBzdGF0dXMgIT09ICcnXG4gICAgICAgID8gdmFsaWRhdGVBcnRpZmFjdFN0YXR1cyhzdGF0dXMpXG4gICAgICAgIDogbnVsbFxuXG4gICAgbGV0IGNvdW50USA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgLmlubmVySm9pbignbWVzc2FnZXMnLCAnbWVzc2FnZXMuaWQnLCAnZXh0cmFjdGlvbl9hcnRpZmFjdHMubWVzc2FnZV9pZCcpXG4gICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgLnNlbGVjdCgoZWIpID0+IGViLmZuLmNvdW50QWxsPG51bWJlcj4oKS5hcygnY291bnQnKSlcbiAgICAgIC53aGVyZSgnbWFpbGJveGVzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICBpZiAobWFpbGJveElkICE9IG51bGwpIHtcbiAgICAgIGNvdW50USA9IGNvdW50US53aGVyZSgnbWVzc2FnZXMubWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKVxuICAgIH1cbiAgICBpZiAoc3RhdHVzRmlsdGVyICE9IG51bGwpIHtcbiAgICAgIGNvdW50USA9IGNvdW50US53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuc3RhdHVzJywgJz0nLCBzdGF0dXNGaWx0ZXIpXG4gICAgfVxuICAgIGNvbnN0IGNvdW50Um93ID0gYXdhaXQgY291bnRRLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICBjb25zdCB0b3RhbENvdW50ID0gTnVtYmVyKGNvdW50Um93LmNvdW50KVxuXG4gICAgbGV0IGxpc3RRID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAuaW5uZXJKb2luKCdtZXNzYWdlcycsICdtZXNzYWdlcy5pZCcsICdleHRyYWN0aW9uX2FydGlmYWN0cy5tZXNzYWdlX2lkJylcbiAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAuc2VsZWN0QWxsKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgaWYgKG1haWxib3hJZCAhPSBudWxsKSB7XG4gICAgICBsaXN0USA9IGxpc3RRLndoZXJlKCdtZXNzYWdlcy5tYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgfVxuICAgIGlmIChzdGF0dXNGaWx0ZXIgIT0gbnVsbCkge1xuICAgICAgbGlzdFEgPSBsaXN0US53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuc3RhdHVzJywgJz0nLCBzdGF0dXNGaWx0ZXIpXG4gICAgfVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBsaXN0UVxuICAgICAgLm9yZGVyQnkoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLmlkJywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KHNhZmVTaXplKVxuICAgICAgLm9mZnNldChvZmZzZXQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgaXRlbXM6IHJvd3MubWFwKG1hcEFydGlmYWN0KSxcbiAgICAgIHRvdGFsQ291bnQsXG4gICAgICBwYWdlOiBzYWZlUGFnZSxcbiAgICAgIHBhZ2VTaXplOiBzYWZlU2l6ZSxcbiAgICB9XG4gIH0sXG5cbiAgYXN5bmMgc3luY1J1bnMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPFN5bmNSdW5bXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnc3luY19ydW5zJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnZGVzYycpXG4gICAgICAubGltaXQoNTApXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcFN5bmNSdW4pXG4gIH0sXG5cbiAgYXN5bmMgcGFyc2luZ1RlbXBsYXRlcyhtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8UGFyc2luZ1RlbXBsYXRlW10+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdhc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBQYXJzaW5nVGVtcGxhdGUpXG4gIH0sXG59XG5cbmNvbnN0IE11dGF0aW9uID0ge1xuICBhc3luYyBjcmVhdGVNYWlsYm94KGlucHV0OiBDcmVhdGVNYWlsYm94SW5wdXQpOiBQcm9taXNlPE1haWxib3g+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBwcm92aWRlciA9IHZhbGlkYXRlUHJvdmlkZXIoaW5wdXQucHJvdmlkZXIpXG4gICAgY29uc3QgbGFiZWwgPSB2YWxpZGF0ZUxhYmVsKGlucHV0LmxhYmVsKVxuICAgIC8vIEVtcHR5IGFsbG93ZWQgYXQgY3JlYXRlIChlLmcuIEdtYWlsIE9BdXRoKTsgc3luYyByZXF1aXJlcyBmaWx0ZXJzIGxhdGVyLlxuICAgIGNvbnN0IHJhd0ZpbHRlcnMgPSBpbnB1dC5kb21haW5GaWx0ZXJzID8/IFtdXG4gICAgY29uc3QgcGF0dGVybnMgPSByYXdGaWx0ZXJzLmxlbmd0aCA9PT0gMFxuICAgICAgPyBbXVxuICAgICAgOiB2YWxpZGF0ZURvbWFpblBhdHRlcm5zKHJhd0ZpbHRlcnMpXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBjb25zdCB2YWx1ZXM6IE5ld01haWxib3ggPSB7XG4gICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICBwcm92aWRlcixcbiAgICAgIGxhYmVsLFxuICAgICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgc3luY19jdXJzb3I6IG51bGwsXG4gICAgICBzeW5jX3JlcXVlc3RlZDogcGF0dGVybnMubGVuZ3RoID4gMCxcbiAgICAgIG9hdXRoX3Rva2Vuc19qc29uOiBpbnB1dC5vYXV0aFRva2Vuc0pzb24gPz8gbnVsbCxcbiAgICAgIGxhc3Rfc3luY2VkX2F0OiBudWxsLFxuICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgIH1cblxuICAgIGNvbnN0IG1haWxib3ggPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ21haWxib3hlcycpXG4gICAgICAudmFsdWVzKHZhbHVlcylcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIGlmIChwYXR0ZXJucy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBkYlxuICAgICAgICAuaW5zZXJ0SW50bygnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgICAudmFsdWVzKFxuICAgICAgICAgIHBhdHRlcm5zLm1hcCgocGF0dGVybikgPT4gKHtcbiAgICAgICAgICAgIG1haWxib3hfaWQ6IG1haWxib3guaWQsXG4gICAgICAgICAgICBwYXR0ZXJuLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1hcE1haWxib3gobWFpbGJveClcbiAgfSxcblxuICBhc3luYyB1cGRhdGVNYWlsYm94KGlucHV0OiBVcGRhdGVNYWlsYm94SW5wdXQpOiBQcm9taXNlPE1haWxib3g+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgaW5wdXQuaWQpXG4gICAgY29uc3QgbGFiZWwgPSB2YWxpZGF0ZUxhYmVsKGlucHV0LmxhYmVsKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ21haWxib3hlcycpXG4gICAgICAuc2V0KHsgbGFiZWwsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gbWFwTWFpbGJveChyb3cpXG4gIH0sXG5cbiAgYXN5bmMgZGVsZXRlTWFpbGJveChpZDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdtYWlsYm94ZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gTnVtYmVyKHJlc3VsdC5udW1EZWxldGVkUm93cyA/PyAwKSA+IDBcbiAgfSxcblxuICBhc3luYyBjbGVhckluYm94KG1haWxib3hJZDogbnVtYmVyKTogUHJvbWlzZTxNYWlsYm94PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIG1haWxib3hJZClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBjbGVhckluYm94RGF0YShcbiAgICAgIGNyZWF0ZUt5c2VseUluYm94T3BzU3RvcmUoZGIpLFxuICAgICAgbWFpbGJveElkLFxuICAgIClcbiAgICByZXR1cm4gbWFwTWFpbGJveChyb3cpXG4gIH0sXG5cbiAgYXN5bmMgc2V0RG9tYWluRmlsdGVycyhpbnB1dDogU2V0RG9tYWluRmlsdGVyc0lucHV0KTogUHJvbWlzZTxEb21haW5GaWx0ZXJbXT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgY29uc3QgcGF0dGVybnMgPSB2YWxpZGF0ZURvbWFpblBhdHRlcm5zKGlucHV0LnBhdHRlcm5zKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdkb21haW5fZmlsdGVycycpXG4gICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIGlucHV0Lm1haWxib3hJZClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGlmIChwYXR0ZXJucy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBkYlxuICAgICAgICAuaW5zZXJ0SW50bygnZG9tYWluX2ZpbHRlcnMnKVxuICAgICAgICAudmFsdWVzKFxuICAgICAgICAgIHBhdHRlcm5zLm1hcCgocGF0dGVybikgPT4gKHtcbiAgICAgICAgICAgIG1haWxib3hfaWQ6IGlucHV0Lm1haWxib3hJZCxcbiAgICAgICAgICAgIHBhdHRlcm4sXG4gICAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSkpLFxuICAgICAgICApXG4gICAgICAgIC5leGVjdXRlKClcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdkb21haW5fZmlsdGVycycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgaW5wdXQubWFpbGJveElkKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2FzYycpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcERvbWFpbkZpbHRlcilcbiAgfSxcblxuICBhc3luYyB0cmlnZ2VyU3luYyhcbiAgICBtYWlsYm94SWQ6IG51bWJlcixcbiAgICBzaW5jZT86IHN0cmluZyB8IG51bGwsXG4gICAgdW50aWw/OiBzdHJpbmcgfCBudWxsLFxuICApOiBQcm9taXNlPE1haWxib3g+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZXF1aXJlT3duZWRNYWlsYm94KHVzZXJJZCwgbWFpbGJveElkKVxuICAgIGNvbnN0IGZpbHRlckNvdW50ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdkb21haW5fZmlsdGVycycpXG4gICAgICAuc2VsZWN0KChlYikgPT4gZWIuZm4uY291bnRBbGw8c3RyaW5nPigpLmFzKCdjb3VudCcpKVxuICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIGlmIChOdW1iZXIoZmlsdGVyQ291bnQuY291bnQpIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICAgICdkb21haW4gZmlsdGVycyBhcmUgcmVxdWlyZWQgYmVmb3JlIHN5bmMnLFxuICAgICAgKVxuICAgIH1cbiAgICBjb25zdCByYW5nZSA9IHZhbGlkYXRlU3luY0RhdGVSYW5nZShcbiAgICAgIHZhbGlkYXRlT3B0aW9uYWxTeW5jRGF0ZShzaW5jZSwgJ3NpbmNlJyksXG4gICAgICB2YWxpZGF0ZU9wdGlvbmFsU3luY0RhdGUodW50aWwsICd1bnRpbCcpLFxuICAgIClcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdtYWlsYm94ZXMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIHN5bmNfcmVxdWVzdGVkOiB0cnVlLFxuICAgICAgICBzeW5jX3NpbmNlOiByYW5nZS5zaW5jZSxcbiAgICAgICAgc3luY191bnRpbDogcmFuZ2UudW50aWwsXG4gICAgICAgIHN5bmNfYmFja2ZpbGxfY3Vyc29yOiBudWxsLFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgbWFpbGJveElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcE1haWxib3gocm93KVxuICB9LFxuXG4gIGFzeW5jIHJlamVjdEFsbFBlbmRpbmdBcnRpZmFjdHMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBtYWlsYm94SWQpXG4gICAgcmV0dXJuIGF3YWl0IHJlamVjdEFsbFBlbmRpbmdBcnRpZmFjdHNPcChcbiAgICAgIGNyZWF0ZUt5c2VseUluYm94T3BzU3RvcmUoZGIpLFxuICAgICAgbWFpbGJveElkLFxuICAgIClcbiAgfSxcblxuICBhc3luYyB1cGRhdGVBcnRpZmFjdFN0YXR1cyhcbiAgICBpbnB1dDogVXBkYXRlQXJ0aWZhY3RTdGF0dXNJbnB1dCxcbiAgKTogUHJvbWlzZTxFeHRyYWN0aW9uQXJ0aWZhY3Q+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBzdGF0dXMgPSB2YWxpZGF0ZUFydGlmYWN0U3RhdHVzKGlucHV0LnN0YXR1cylcbiAgICBjb25zdCBvd25lZCA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgLmlubmVySm9pbignbWVzc2FnZXMnLCAnbWVzc2FnZXMuaWQnLCAnZXh0cmFjdGlvbl9hcnRpZmFjdHMubWVzc2FnZV9pZCcpXG4gICAgICAuaW5uZXJKb2luKCdtYWlsYm94ZXMnLCAnbWFpbGJveGVzLmlkJywgJ21lc3NhZ2VzLm1haWxib3hfaWQnKVxuICAgICAgLnNlbGVjdEFsbCgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgLndoZXJlKCdleHRyYWN0aW9uX2FydGlmYWN0cy5pZCcsICc9JywgaW5wdXQuYXJ0aWZhY3RJZClcbiAgICAgIC53aGVyZSgnbWFpbGJveGVzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIGlmICghb3duZWQpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdhcnRpZmFjdCBub3QgZm91bmQnKVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBpZiAoc3RhdHVzID09PSAncmVqZWN0ZWQnKSB7XG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgLnNldCh7IHN0YXR1cywgdXBkYXRlZF9hdDogbm93IH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmFydGlmYWN0SWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgcmV0dXJuIG1hcEFydGlmYWN0KHJvdylcbiAgICB9XG5cbiAgICBpZiAoc3RhdHVzID09PSAnYWNjZXB0ZWQnKSB7XG4gICAgICBpZiAob3duZWQua2luZCA9PT0gU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQpIHtcbiAgICAgICAgaWYgKG93bmVkLnB1Ymxpc2hlZF9leHBlbnNlX2lkICE9IG51bGwpIHtcbiAgICAgICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgICAgICAuc2V0KHsgc3RhdHVzOiAnYWNjZXB0ZWQnLCB1cGRhdGVkX2F0OiBub3cgfSlcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmFydGlmYWN0SWQpXG4gICAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICAgICAgcmV0dXJuIG1hcEFydGlmYWN0KHJvdylcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNhdGVnb3J5SWQgPSB2YWxpZGF0ZUNhdGVnb3J5SWQoaW5wdXQuY2F0ZWdvcnlJZClcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gYXNTcGVuZGluZ1BheWxvYWQob3duZWQucGF5bG9hZClcbiAgICAgICAgaWYgKCFjYW5kaWRhdGUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignYXJ0aWZhY3QgcGF5bG9hZCBpcyBub3QgYSBzcGVuZGluZyBjYW5kaWRhdGUnKVxuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwdWJsaXNoZWQgPSBhd2FpdCBwdWJsaXNoRXhwZW5zZVRvU3BlbmRtYW5hZ2VyKFxuICAgICAgICAgICAgY2FuZGlkYXRlLFxuICAgICAgICAgICAgY2F0ZWdvcnlJZCxcbiAgICAgICAgICAgIHJlcXVpcmVBdXRob3JpemF0aW9uSGVhZGVyKCksXG4gICAgICAgICAgKVxuICAgICAgICAgIGNvbnN0IG5leHRQYXlsb2FkID0ge1xuICAgICAgICAgICAgLi4uY2FuZGlkYXRlLFxuICAgICAgICAgICAgcHVibGlzaGVkRXhwZW5zZUlkOiBwdWJsaXNoZWQuZXhwZW5zZUlkLFxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgICAgICAuc2V0KHtcbiAgICAgICAgICAgICAgc3RhdHVzOiAnYWNjZXB0ZWQnLFxuICAgICAgICAgICAgICBwdWJsaXNoZWRfZXhwZW5zZV9pZDogcHVibGlzaGVkLmV4cGVuc2VJZCxcbiAgICAgICAgICAgICAgcGF5bG9hZDogbmV4dFBheWxvYWQsXG4gICAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5hcnRpZmFjdElkKVxuICAgICAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgICAgIHJldHVybiBtYXBBcnRpZmFjdChyb3cpXG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBTcGVuZG1hbmFnZXJTaW5rRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgICAgICAgICBgZmFpbGVkIHRvIHB1Ymxpc2ggZXhwZW5zZTogJHtlcnIubWVzc2FnZX1gLFxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnJcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgLnNldCh7IHN0YXR1czogJ2FjY2VwdGVkJywgdXBkYXRlZF9hdDogbm93IH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmFydGlmYWN0SWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgcmV0dXJuIG1hcEFydGlmYWN0KHJvdylcbiAgICB9XG5cbiAgICAvLyBwZW5kaW5nIC8gb3RoZXJcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAuc2V0KHsgc3RhdHVzLCB1cGRhdGVkX2F0OiBub3cgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmFydGlmYWN0SWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcEFydGlmYWN0KHJvdylcbiAgfSxcblxuICBhc3luYyBjb25uZWN0R21haWwoaW5wdXQ6IENvbm5lY3RHbWFpbElucHV0KTogUHJvbWlzZTxNYWlsYm94PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgbWFpbGJveCA9IGF3YWl0IHJlcXVpcmVPd25lZE1haWxib3godXNlcklkLCBpbnB1dC5tYWlsYm94SWQpXG4gICAgaWYgKG1haWxib3gucHJvdmlkZXIgIT09ICdnbWFpbCcpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtYWlsYm94IHByb3ZpZGVyIGlzIG5vdCBnbWFpbCcpXG4gICAgfVxuICAgIGlmICghaW5wdXQuYWNjZXNzVG9rZW4udHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignYWNjZXNzVG9rZW4gaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGNvbnN0IGFjY2Vzc1Rva2VuID0gaW5wdXQuYWNjZXNzVG9rZW4udHJpbSgpXG4gICAgY29uc3QgdG9rZW5zID0ge1xuICAgICAgYWNjZXNzVG9rZW4sXG4gICAgICByZWZyZXNoVG9rZW46IGlucHV0LnJlZnJlc2hUb2tlbiA/PyBudWxsLFxuICAgICAgZXhwaXJlc0F0TXM6IGlucHV0LmV4cGlyZXNBdE1zID8/IG51bGwsXG4gICAgfVxuICAgIGNvbnN0IGVtYWlsID0gYXdhaXQgZmV0Y2hHbWFpbEVtYWlsQWRkcmVzcyh7IGFjY2Vzc1Rva2VuIH0pXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnbWFpbGJveGVzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBvYXV0aF90b2tlbnNfanNvbjogSlNPTi5zdHJpbmdpZnkodG9rZW5zKSxcbiAgICAgICAgLi4uKGVtYWlsID8geyBsYWJlbDogZW1haWwgfSA6IHt9KSxcbiAgICAgICAgc3luY19yZXF1ZXN0ZWQ6IHRydWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBtYWlsYm94LmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiBtYXBNYWlsYm94KHJvdylcbiAgfSxcblxuICBhc3luYyBzdGFydEdtYWlsT0F1dGgoXG4gICAgaW5wdXQ6IFN0YXJ0R21haWxPQXV0aElucHV0LFxuICApOiBQcm9taXNlPFN0YXJ0R21haWxPQXV0aFBheWxvYWQ+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBtYWlsYm94ID0gYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIGlucHV0Lm1haWxib3hJZClcbiAgICBpZiAobWFpbGJveC5wcm92aWRlciAhPT0gJ2dtYWlsJykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ21haWxib3ggcHJvdmlkZXIgaXMgbm90IGdtYWlsJylcbiAgICB9XG5cbiAgICBjb25zdCByZXR1cm5UbyA9IGlucHV0LnJldHVyblRvPy50cmltKCkgPz8gJydcbiAgICBpZiAoIXJldHVyblRvKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcigncmV0dXJuVG8gaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGxldCBjb25maWdcbiAgICB0cnkge1xuICAgICAgY29uZmlnID0gbG9hZEdtYWlsT0F1dGhDb25maWcoKVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEdtYWlsT0F1dGhFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihlcnIubWVzc2FnZSlcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cblxuICAgIGlmICghaXNSZXR1cm5Ub0FsbG93ZWQocmV0dXJuVG8sIGNvbmZpZy5yZXR1cm5Ub0FsbG93bGlzdCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdyZXR1cm5UbyBpcyBub3QgYWxsb3dlZCcpXG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCBzaWduT0F1dGhTdGF0ZShcbiAgICAgIHsgdXNlcklkLCBtYWlsYm94SWQ6IG1haWxib3guaWQsIHJldHVyblRvIH0sXG4gICAgICBjb25maWcuY2xpZW50U2VjcmV0LFxuICAgIClcbiAgICBjb25zdCBhdXRob3JpemF0aW9uVXJsID0gYnVpbGRHb29nbGVBdXRob3JpemVVcmwoe1xuICAgICAgY2xpZW50SWQ6IGNvbmZpZy5jbGllbnRJZCxcbiAgICAgIHJlZGlyZWN0VXJpOiBjb25maWcucmVkaXJlY3RVcmksXG4gICAgICBzdGF0ZSxcbiAgICB9KVxuICAgIHJldHVybiB7IGF1dGhvcml6YXRpb25VcmwgfVxuICB9LFxuXG4gIGFzeW5jIGNyZWF0ZVBhcnNpbmdUZW1wbGF0ZShcbiAgICBpbnB1dDogQ3JlYXRlUGFyc2luZ1RlbXBsYXRlSW5wdXQsXG4gICk6IFByb21pc2U8UGFyc2luZ1RlbXBsYXRlPiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVxdWlyZU93bmVkTWFpbGJveCh1c2VySWQsIGlucHV0Lm1haWxib3hJZClcbiAgICBjb25zdCBraW5kID0gdmFsaWRhdGVUZW1wbGF0ZUtpbmQoaW5wdXQua2luZCA/PyAnYXBwcm92ZScpXG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlVGVtcGxhdGVOYW1lKGlucHV0Lm5hbWUpXG4gICAgY29uc3QgbWF0Y2hGcm9tUGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihpbnB1dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgIGNvbnN0IG1hdGNoU3ViamVjdFJlZ2V4ID0gdmFsaWRhdGVTdWJqZWN0UmVnZXgoaW5wdXQubWF0Y2hTdWJqZWN0UmVnZXgpXG4gICAgbGV0IGV4dHJhY3RvcnM6IFJldHVyblR5cGU8dHlwZW9mIHBhcnNlRXh0cmFjdG9yc0pzb24+IHwgbnVsbCA9IG51bGxcbiAgICBpZiAoa2luZCA9PT0gJ2FwcHJvdmUnKSB7XG4gICAgICBpZiAoaW5wdXQuZXh0cmFjdG9yc0pzb24gPT0gbnVsbCB8fCAhaW5wdXQuZXh0cmFjdG9yc0pzb24udHJpbSgpKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgICAgICdleHRyYWN0b3JzSnNvbiBpcyByZXF1aXJlZCBmb3IgYXBwcm92ZSB0ZW1wbGF0ZXMnLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICBleHRyYWN0b3JzID0gcGFyc2VFeHRyYWN0b3JzSnNvbihpbnB1dC5leHRyYWN0b3JzSnNvbilcbiAgICB9XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBpZiAoaW5wdXQuc291cmNlTWVzc2FnZUlkICE9IG51bGwpIHtcbiAgICAgIGNvbnN0IG1zZyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdtZXNzYWdlcycpXG4gICAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAgIC5zZWxlY3QoJ21lc3NhZ2VzLmlkJylcbiAgICAgICAgLndoZXJlKCdtZXNzYWdlcy5pZCcsICc9JywgaW5wdXQuc291cmNlTWVzc2FnZUlkKVxuICAgICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgnbWVzc2FnZXMubWFpbGJveF9pZCcsICc9JywgaW5wdXQubWFpbGJveElkKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIW1zZykgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3NvdXJjZSBtZXNzYWdlIG5vdCBmb3VuZCcpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgbWFpbGJveF9pZDogaW5wdXQubWFpbGJveElkLFxuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGtpbmQsXG4gICAgICAgIGVuYWJsZWQ6IGlucHV0LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBtYXRjaEZyb21QYXR0ZXJuLFxuICAgICAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBtYXRjaFN1YmplY3RSZWdleCxcbiAgICAgICAgZXh0cmFjdG9ycyxcbiAgICAgICAgc291cmNlX21lc3NhZ2VfaWQ6IGlucHV0LnNvdXJjZU1lc3NhZ2VJZCA/PyBudWxsLFxuICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0pXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBhd2FpdCBhcHBseVRlbXBsYXRlc1RvTWFpbGJveChcbiAgICAgIGNyZWF0ZUt5c2VseUFwcGx5VGVtcGxhdGVzU3RvcmUoZGIpLFxuICAgICAgaW5wdXQubWFpbGJveElkLFxuICAgICAgbm93LFxuICAgIClcbiAgICByZXR1cm4gbWFwUGFyc2luZ1RlbXBsYXRlKHJvdylcbiAgfSxcblxuICBhc3luYyB1cGRhdGVQYXJzaW5nVGVtcGxhdGUoXG4gICAgaW5wdXQ6IFVwZGF0ZVBhcnNpbmdUZW1wbGF0ZUlucHV0LFxuICApOiBQcm9taXNlPFBhcnNpbmdUZW1wbGF0ZT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdwYXJzaW5nX3RlbXBsYXRlcycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFleGlzdGluZykgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3RlbXBsYXRlIG5vdCBmb3VuZCcpXG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCBwYXRjaDoge1xuICAgICAgbmFtZT86IHN0cmluZ1xuICAgICAgbWF0Y2hfZnJvbV9wYXR0ZXJuPzogc3RyaW5nXG4gICAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4Pzogc3RyaW5nIHwgbnVsbFxuICAgICAgZXh0cmFjdG9ycz86IFJldHVyblR5cGU8dHlwZW9mIHBhcnNlRXh0cmFjdG9yc0pzb24+IHwgbnVsbFxuICAgICAgZW5hYmxlZD86IGJvb2xlYW5cbiAgICAgIHZlcnNpb246IG51bWJlclxuICAgICAgdXBkYXRlZF9hdDogc3RyaW5nXG4gICAgfSA9IHtcbiAgICAgIHZlcnNpb246IGV4aXN0aW5nLnZlcnNpb24gKyAxLFxuICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgIH1cblxuICAgIGlmIChpbnB1dC5uYW1lICE9IG51bGwpIHBhdGNoLm5hbWUgPSB2YWxpZGF0ZVRlbXBsYXRlTmFtZShpbnB1dC5uYW1lKVxuICAgIGlmIChpbnB1dC5tYXRjaEZyb21QYXR0ZXJuICE9IG51bGwpIHtcbiAgICAgIHBhdGNoLm1hdGNoX2Zyb21fcGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihpbnB1dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgIH1cbiAgICBpZiAoaW5wdXQubWF0Y2hTdWJqZWN0UmVnZXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0Y2gubWF0Y2hfc3ViamVjdF9yZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGlucHV0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgIH1cbiAgICBpZiAoaW5wdXQuZXh0cmFjdG9yc0pzb24gIT0gbnVsbCkge1xuICAgICAgaWYgKGV4aXN0aW5nLmtpbmQgPT09ICdyZWplY3QnKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgICAgICdyZWplY3QgdGVtcGxhdGVzIGNhbm5vdCBoYXZlIGV4dHJhY3RvcnMnLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICBwYXRjaC5leHRyYWN0b3JzID0gcGFyc2VFeHRyYWN0b3JzSnNvbihpbnB1dC5leHRyYWN0b3JzSnNvbilcbiAgICB9XG4gICAgaWYgKGlucHV0LmVuYWJsZWQgIT0gbnVsbCkgcGF0Y2guZW5hYmxlZCA9IGlucHV0LmVuYWJsZWRcblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3BhcnNpbmdfdGVtcGxhdGVzJylcbiAgICAgIC5zZXQocGF0Y2gpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIGF3YWl0IGFwcGx5VGVtcGxhdGVzVG9NYWlsYm94KFxuICAgICAgY3JlYXRlS3lzZWx5QXBwbHlUZW1wbGF0ZXNTdG9yZShkYiksXG4gICAgICBleGlzdGluZy5tYWlsYm94X2lkLFxuICAgICAgbm93LFxuICAgIClcbiAgICByZXR1cm4gbWFwUGFyc2luZ1RlbXBsYXRlKHJvdylcbiAgfSxcblxuICBhc3luYyBkZWxldGVQYXJzaW5nVGVtcGxhdGUoaWQ6IG51bWJlcik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gTnVtYmVyKHJlc3VsdC5udW1EZWxldGVkUm93cyA/PyAwKSA+IDBcbiAgfSxcblxuICBhc3luYyBnZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZShcbiAgICBpbnB1dDogR2VuZXJhdGVQYXJzaW5nVGVtcGxhdGVJbnB1dCxcbiAgKTogUHJvbWlzZTxHZW5lcmF0ZVBhcnNpbmdUZW1wbGF0ZVBheWxvYWQ+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBkZWNpc2lvbiA9IHZhbGlkYXRlVGVtcGxhdGVLaW5kKGlucHV0LmRlY2lzaW9uKVxuICAgIGNvbnN0IG1lc3NhZ2UgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ21lc3NhZ2VzJylcbiAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAuc2VsZWN0KFtcbiAgICAgICAgJ21lc3NhZ2VzLmlkJyxcbiAgICAgICAgJ21lc3NhZ2VzLm1haWxib3hfaWQnLFxuICAgICAgICAnbWVzc2FnZXMuZnJvbV9hZGRyZXNzJyxcbiAgICAgICAgJ21lc3NhZ2VzLnN1YmplY3QnLFxuICAgICAgICAnbWVzc2FnZXMudGV4dF9ib2R5JyxcbiAgICAgIF0pXG4gICAgICAud2hlcmUoJ21lc3NhZ2VzLmlkJywgJz0nLCBpbnB1dC5tZXNzYWdlSWQpXG4gICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIW1lc3NhZ2UpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtZXNzYWdlIG5vdCBmb3VuZCcpXG4gICAgaWYgKCFtZXNzYWdlLnRleHRfYm9keT8udHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgICAgJ21lc3NhZ2UgaGFzIG5vIHN0b3JlZCBib2R5OyByZS1zeW5jIGFmdGVyIHVwZ3JhZGluZyBtYWlsYm94JyxcbiAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBnZW5lcmljRmFpbE1lc3NhZ2UgPSAnVGVtcGxhdGUgZ2VuZXJhdGlvbiBmYWlsZWQuIFBsZWFzZSB0cnkgYWdhaW4uJ1xuICAgIGNvbnN0IGZhaWxUZW1wbGF0ZUdlbmVyYXRpb24gPSAocmVhc29uOiBzdHJpbmcsIGRldGFpbHM/OiB1bmtub3duKTogbmV2ZXIgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgJ1ttYWlsYm94LWFwaV0gdGVtcGxhdGUgZ2VuZXJhdGlvbiBmYWlsZWQ6JyxcbiAgICAgICAgcmVhc29uLFxuICAgICAgICBkZXRhaWxzID8/ICcnLFxuICAgICAgKVxuICAgICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoZ2VuZXJpY0ZhaWxNZXNzYWdlKVxuICAgIH1cblxuICAgIGNvbnN0IGFpSW5wdXQgPSB7XG4gICAgICBmcm9tOiBtZXNzYWdlLmZyb21fYWRkcmVzcyxcbiAgICAgIHN1YmplY3Q6IG1lc3NhZ2Uuc3ViamVjdCxcbiAgICAgIHRleHRCb2R5OiBtZXNzYWdlLnRleHRfYm9keSxcbiAgICAgIGhpbnRzOiBpbnB1dC5oaW50cyxcbiAgICB9XG5cbiAgICBsZXQgbWF0Y2hGcm9tUGF0dGVybjogc3RyaW5nXG4gICAgbGV0IG1hdGNoU3ViamVjdFJlZ2V4OiBzdHJpbmcgfCBudWxsXG4gICAgbGV0IGV4dHJhY3RvcnM6XG4gICAgICB8IE5vbk51bGxhYmxlPFJldHVyblR5cGU8dHlwZW9mIHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnM+PlxuICAgICAgfCBudWxsID0gbnVsbFxuICAgIGxldCBuYW1lU3VnZ2VzdGlvbjogc3RyaW5nXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGRlY2lzaW9uID09PSAncmVqZWN0Jykge1xuICAgICAgICBjb25zdCBhaU91dCA9IGF3YWl0IGdlbmVyYXRlRW1haWxSZWplY3RUZW1wbGF0ZShhaUlucHV0KVxuICAgICAgICBtYXRjaEZyb21QYXR0ZXJuID0gdmFsaWRhdGVNYXRjaEZyb21QYXR0ZXJuKGFpT3V0Lm1hdGNoRnJvbVBhdHRlcm4pXG4gICAgICAgIG1hdGNoU3ViamVjdFJlZ2V4ID0gdmFsaWRhdGVTdWJqZWN0UmVnZXgoYWlPdXQubWF0Y2hTdWJqZWN0UmVnZXgpXG4gICAgICAgIG5hbWVTdWdnZXN0aW9uID0gYWlPdXQubmFtZVN1Z2dlc3Rpb24gfHwgJ0lnbm9yZWQgZW1haWwgdHlwZSdcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGFpT3V0ID0gYXdhaXQgZ2VuZXJhdGVFbWFpbFNwZW5kVGVtcGxhdGUoYWlJbnB1dClcbiAgICAgICAgbWF0Y2hGcm9tUGF0dGVybiA9IHZhbGlkYXRlTWF0Y2hGcm9tUGF0dGVybihhaU91dC5tYXRjaEZyb21QYXR0ZXJuKVxuICAgICAgICBtYXRjaFN1YmplY3RSZWdleCA9IHZhbGlkYXRlU3ViamVjdFJlZ2V4KGFpT3V0Lm1hdGNoU3ViamVjdFJlZ2V4KVxuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzKGFpT3V0LmV4dHJhY3RvcnMpXG4gICAgICAgIGlmICghcGFyc2VkKSB7XG4gICAgICAgICAgZmFpbFRlbXBsYXRlR2VuZXJhdGlvbignQUkgcmV0dXJuZWQgaW52YWxpZCBleHRyYWN0b3JzJywge1xuICAgICAgICAgICAgbWVzc2FnZUlkOiBtZXNzYWdlLmlkLFxuICAgICAgICAgICAgZXh0cmFjdG9yczogYWlPdXQuZXh0cmFjdG9ycyxcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICAgIGV4dHJhY3RvcnMgPSBwYXJzZWRcbiAgICAgICAgbmFtZVN1Z2dlc3Rpb24gPSBhaU91dC5uYW1lU3VnZ2VzdGlvbiB8fCAnU3BlbmRpbmcgdGVtcGxhdGUnXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoXG4gICAgICAgIGVyciBpbnN0YW5jZW9mIEludmFsaWRNYWlsYm94RXJyb3IgJiZcbiAgICAgICAgZXJyLm1lc3NhZ2UgPT09IGdlbmVyaWNGYWlsTWVzc2FnZVxuICAgICAgKSB7XG4gICAgICAgIHRocm93IGVyclxuICAgICAgfVxuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEFpQ2xpZW50RXJyb3IgfHwgZXJyIGluc3RhbmNlb2YgSW52YWxpZE1haWxib3hFcnJvcikge1xuICAgICAgICBmYWlsVGVtcGxhdGVHZW5lcmF0aW9uKGVyci5tZXNzYWdlLCB7IG1lc3NhZ2VJZDogbWVzc2FnZS5pZCB9KVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlVGVtcGxhdGVOYW1lKFxuICAgICAgaW5wdXQubmFtZT8udHJpbSgpIHx8IG5hbWVTdWdnZXN0aW9uLFxuICAgIClcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIG1haWxib3hfaWQ6IG1lc3NhZ2UubWFpbGJveF9pZCxcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBraW5kOiBkZWNpc2lvbixcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBtYXRjaEZyb21QYXR0ZXJuLFxuICAgICAgICBtYXRjaF9zdWJqZWN0X3JlZ2V4OiBtYXRjaFN1YmplY3RSZWdleCxcbiAgICAgICAgZXh0cmFjdG9ycyxcbiAgICAgICAgc291cmNlX21lc3NhZ2VfaWQ6IG1lc3NhZ2UuaWQsXG4gICAgICAgIHZlcnNpb246IDEsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIGF3YWl0IGFwcGx5VGVtcGxhdGVzVG9NYWlsYm94KFxuICAgICAgY3JlYXRlS3lzZWx5QXBwbHlUZW1wbGF0ZXNTdG9yZShkYiksXG4gICAgICBtZXNzYWdlLm1haWxib3hfaWQsXG4gICAgICBub3csXG4gICAgKVxuXG4gICAgY29uc3QgcmVldmFsdWF0ZWRDb3VudCA9IGF3YWl0IHJlZXZhbHVhdGVQZW5kaW5nV2l0aFRlbXBsYXRlKFxuICAgICAgY3JlYXRlS3lzZWx5VGVtcGxhdGVSZWV2YWx1YXRlU3RvcmUoZGIpLFxuICAgICAge1xuICAgICAgICBpZDogcm93LmlkLFxuICAgICAgICBtYWlsYm94X2lkOiByb3cubWFpbGJveF9pZCxcbiAgICAgICAga2luZDogcm93LmtpbmQsXG4gICAgICAgIGVuYWJsZWQ6IHJvdy5lbmFibGVkLFxuICAgICAgICBtYXRjaF9mcm9tX3BhdHRlcm46IHJvdy5tYXRjaF9mcm9tX3BhdHRlcm4sXG4gICAgICAgIG1hdGNoX3N1YmplY3RfcmVnZXg6IHJvdy5tYXRjaF9zdWJqZWN0X3JlZ2V4LFxuICAgICAgICBleHRyYWN0b3JzOiByb3cuZXh0cmFjdG9ycyxcbiAgICAgIH0sXG4gICAgICBub3csXG4gICAgKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRlbXBsYXRlOiBtYXBQYXJzaW5nVGVtcGxhdGUocm93KSxcbiAgICAgIHJlZXZhbHVhdGVkQ291bnQsXG4gICAgfVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgcmVzb2x2ZXJzID0geyBRdWVyeSwgTXV0YXRpb24gfVxuIiwgIi8qKiBOb3JtYWxpemVkIGVtYWlsIHVzZWQgYnkgdGhlIGV4dHJhY3QgcGlwZWxpbmUuICovXG5leHBvcnQgaW50ZXJmYWNlIEVtYWlsTWVzc2FnZSB7XG4gIC8qKiBQcm92aWRlci1zcGVjaWZpYyBpZCAoR21haWwgbWVzc2FnZSBpZCwgZml4dHVyZSBpZCwgZXRjLikuICovXG4gIGlkOiBzdHJpbmdcbiAgLyoqIFJGQyA1MzIyIE1lc3NhZ2UtSUQgd2hlbiBhdmFpbGFibGU7IHVzZWQgZm9yIGlkZW1wb3RlbmN5LiAqL1xuICByZmNNZXNzYWdlSWQ6IHN0cmluZ1xuICBmcm9tOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkQXQ6IERhdGVcbiAgdGV4dEJvZHk6IHN0cmluZyB8IG51bGxcbiAgaHRtbEJvZHk6IHN0cmluZyB8IG51bGxcbn1cblxuLyoqIE9wYXF1ZSBzeW5jIGN1cnNvciByZXR1cm5lZCBieSBhIE1haWxib3hQcm92aWRlci4gKi9cbmV4cG9ydCB0eXBlIFN5bmNDdXJzb3IgPSBzdHJpbmcgfCBudWxsXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGlzdE1lc3NhZ2VzUmVzdWx0IHtcbiAgbWVzc2FnZXM6IEVtYWlsTWVzc2FnZVtdXG4gIC8qKiBDdXJzb3IgdG8gcGVyc2lzdCBhZnRlciBhIHN1Y2Nlc3NmdWwgc3luYy4gKi9cbiAgbmV4dEN1cnNvcjogU3luY0N1cnNvclxufVxuXG5leHBvcnQgdHlwZSBBcnRpZmFjdFN0YXR1cyA9ICdwZW5kaW5nJyB8ICdhY2NlcHRlZCcgfCAncmVqZWN0ZWQnXG5cbi8qKiBEb21haW4tYWdub3N0aWMgZXh0cmFjdGlvbiByZXN1bHQgKG5vdCBhIHNwZW5kbWFuYWdlciBleHBlbnNlKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdGlvbkFydGlmYWN0IHtcbiAga2luZDogc3RyaW5nXG4gIHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIGNvbmZpZGVuY2U6IG51bWJlclxufVxuXG4vKiogUGF5bG9hZCBzaGFwZSBmb3IgU3BlbmRpbmdFeHRyYWN0b3IgKGBraW5kOiBcInNwZW5kaW5nLmNhbmRpZGF0ZVwiYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCB7XG4gIGFtb3VudENlbnRzOiBudW1iZXJcbiAgY3VycmVuY3k6IHN0cmluZ1xuICBzcGVudE9uOiBzdHJpbmdcbiAgbWVyY2hhbnQ6IHN0cmluZyB8IG51bGxcbiAgbm90ZTogc3RyaW5nIHwgbnVsbFxuICBzb3VyY2VTdWJqZWN0OiBzdHJpbmdcbiAgc291cmNlRnJvbTogc3RyaW5nXG4gIC8qKiBTZXQgd2hlbiBwdWJsaXNoZWQgdG8gc3BlbmRtYW5hZ2VyLiAqL1xuICBwdWJsaXNoZWRFeHBlbnNlSWQ/OiBudW1iZXIgfCBudWxsXG4gIC8qKiBQYXJzaW5nIHRlbXBsYXRlIGlkIHdoZW4gZXh0cmFjdGVkIHZpYSBhIHRlbXBsYXRlLiAqL1xuICB0ZW1wbGF0ZUlkPzogbnVtYmVyIHwgbnVsbFxufVxuXG5leHBvcnQgY29uc3QgU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQgPSAnc3BlbmRpbmcuY2FuZGlkYXRlJyBhcyBjb25zdFxuXG4vKiogRGV0ZXJtaW5pc3RpYyBmaWVsZCBleHRyYWN0b3IgdXNlZCBieSBwYXJzaW5nIHRlbXBsYXRlcy4gKi9cbmV4cG9ydCB0eXBlIEZpZWxkRXh0cmFjdG9yID1cbiAgfCB7XG4gICAgc291cmNlOiAnc3ViamVjdCcgfCAndGV4dCcgfCAnaHRtbF90ZXh0J1xuICAgIHJlZ2V4OiBzdHJpbmdcbiAgICBncm91cDogbnVtYmVyXG4gIH1cbiAgfCB7IHNvdXJjZTogJ2Zyb21fZG9tYWluJyB9XG4gIHwgeyBzb3VyY2U6ICdjb25zdGFudCc7IHZhbHVlOiBzdHJpbmcgfVxuXG4vKipcbiAqIExvY2FsZS1hZ25vc3RpYyBkYXRlIGV4dHJhY3RvcjogY2FwdHVyZSBudW1lcmljIHllYXIvbW9udGgvZGF5IGdyb3Vwc1xuICogYW5kIGNvbXBvc2UgWVlZWS1NTS1ERCBhdCBleHRyYWN0IHRpbWUuXG4gKi9cbmV4cG9ydCB0eXBlIERhdGVQYXJ0c0V4dHJhY3RvciA9IHtcbiAgc291cmNlOiAnc3ViamVjdCcgfCAndGV4dCcgfCAnaHRtbF90ZXh0J1xuICByZWdleDogc3RyaW5nXG4gIHllYXJHcm91cDogbnVtYmVyXG4gIG1vbnRoR3JvdXA6IG51bWJlclxuICBkYXlHcm91cDogbnVtYmVyXG59XG5cbi8qKlxuICogRGV0ZWN0IGluYm91bmQgdnMgb3V0Ym91bmQgbW9uZXkgZmxvdy4gV2hlbiB0aGUgY2FwdHVyZSBtYXRjaGVzIGFuXG4gKiBpbmJvdW5kIGtleXdvcmQsIFRlbXBsYXRlU3BlbmRpbmdFeHRyYWN0b3Igc2tpcHMgdGhlIG1lc3NhZ2UuXG4gKi9cbmV4cG9ydCB0eXBlIERpcmVjdGlvbkV4dHJhY3RvciA9IHtcbiAgc291cmNlOiAnc3ViamVjdCcgfCAndGV4dCcgfCAnaHRtbF90ZXh0J1xuICByZWdleDogc3RyaW5nXG4gIGdyb3VwOiBudW1iZXJcbiAgaW5ib3VuZE1hdGNoZXM6IHN0cmluZ1tdXG4gIG91dGJvdW5kTWF0Y2hlczogc3RyaW5nW11cbn1cblxuLyoqIEZpZWxkIG1hcCBzdG9yZWQgaW4gYHBhcnNpbmdfdGVtcGxhdGVzLmV4dHJhY3RvcnNgIEpTT05CLiAqL1xuZXhwb3J0IHR5cGUgU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMgPSB7XG4gIGFtb3VudDogRmllbGRFeHRyYWN0b3JcbiAgY3VycmVuY3k/OiBGaWVsZEV4dHJhY3RvciB8IG51bGxcbiAgLyoqIExlZ2FjeSBzaW5nbGUtZ3JvdXAgRmllbGRFeHRyYWN0b3Igb3IgcHJlZmVycmVkIGRhdGUtcGFydHMgc2hhcGUuICovXG4gIHNwZW50T24/OiBGaWVsZEV4dHJhY3RvciB8IERhdGVQYXJ0c0V4dHJhY3RvciB8IG51bGxcbiAgbWVyY2hhbnQ/OiBGaWVsZEV4dHJhY3RvciB8IG51bGxcbiAgbm90ZT86IEZpZWxkRXh0cmFjdG9yIHwgbnVsbFxuICBkaXJlY3Rpb24/OiBEaXJlY3Rpb25FeHRyYWN0b3IgfCBudWxsXG59XG5cbi8qKiBSdW50aW1lIGRlZmluaXRpb24gZm9yIGEgbWFpbGJveCBwYXJzaW5nIHRlbXBsYXRlLiAqL1xuZXhwb3J0IHR5cGUgU3BlbmRQYXJzaW5nVGVtcGxhdGUgPSB7XG4gIGlkOiBudW1iZXJcbiAgbWF0Y2hGcm9tUGF0dGVybjogc3RyaW5nXG4gIG1hdGNoU3ViamVjdFJlZ2V4Pzogc3RyaW5nIHwgbnVsbFxuICBleHRyYWN0b3JzOiBTcGVuZFRlbXBsYXRlRXh0cmFjdG9yc1xuICBlbmFibGVkPzogYm9vbGVhblxufVxuIiwgIi8qKlxuICogT3B0aW9uYWwgYWxsb3dsaXN0IG9mIHNlbmRlciBkb21haW5zIG9yIGZ1bGwgZW1haWwgYWRkcmVzc2VzLlxuICogRW1wdHkgLyB1bmRlZmluZWQgbGlzdCA9IHJlamVjdCBhbGwgKGZpbHRlcnMgYXJlIHJlcXVpcmVkIGZvciBzeW5jKS5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXI6XG4gKiAtIGB1c2VyQHNob3AuY29tYCBcdTIwMTQgZXhhY3QgYWRkcmVzc1xuICogLSBgc2hvcC5jb21gIFx1MjAxNCBhcGV4ICsgc3ViZG9tYWluc1xuICogLSBgKi5zaG9wLmNvbWAgXHUyMDE0IHN1YmRvbWFpbnMgb25seSAobm90IGFwZXgpOyBsZWdhY3kgLyB0ZW1wbGF0ZSBwYXR0ZXJuc1xuICogLSBgKkBzaG9wLmNvbWAgXHUyMDE0IGFueSBsb2NhbC1wYXJ0IGF0IHRoYXQgZXhhY3QgZG9tYWluXG4gKiAtIGAqQCouc2hvcC5jb21gIFx1MjAxNCBhbnkgbG9jYWwtcGFydCBhdCBhIHN1YmRvbWFpbiBvZiBzaG9wLmNvbVxuICpcbiAqIERvbWFpbiBmaWx0ZXJzIG5vIGxvbmdlciBhY2NlcHQgd2lsZGNhcmRzIGF0IHRoZSBBUEk7IG1hdGNoaW5nIHN0aWxsXG4gKiBzdXBwb3J0cyB0aGVtIGZvciBwYXJzaW5nLXRlbXBsYXRlIGBtYXRjaEZyb21QYXR0ZXJuYCBhbmQgbGVnYWN5IHJvd3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXRjaGVzRG9tYWluRmlsdGVyKFxuICBmcm9tQWRkcmVzczogc3RyaW5nLFxuICBwYXR0ZXJuczogcmVhZG9ubHkgc3RyaW5nW10gfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogYm9vbGVhbiB7XG4gIGlmICghcGF0dGVybnMgfHwgcGF0dGVybnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcblxuICBjb25zdCBub3JtYWxpemVkRnJvbSA9IG5vcm1hbGl6ZUZyb20oZnJvbUFkZHJlc3MpXG4gIGlmICghbm9ybWFsaXplZEZyb20pIHJldHVybiBmYWxzZVxuXG4gIGZvciAoY29uc3QgcmF3IG9mIHBhdHRlcm5zKSB7XG4gICAgY29uc3QgcGF0dGVybiA9IHJhdy50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIGlmICghcGF0dGVybikgY29udGludWVcbiAgICBpZiAobWF0Y2hlc1NpbmdsZVBhdHRlcm4obm9ybWFsaXplZEZyb20sIHBhdHRlcm4pKSByZXR1cm4gdHJ1ZVxuICB9XG4gIHJldHVybiBmYWxzZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZmlsdGVyTWVzc2FnZXNCeURvbWFpbjxUIGV4dGVuZHMgeyBmcm9tOiBzdHJpbmcgfT4oXG4gIG1lc3NhZ2VzOiByZWFkb25seSBUW10sXG4gIHBhdHRlcm5zOiByZWFkb25seSBzdHJpbmdbXSB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBUW10ge1xuICBpZiAoIXBhdHRlcm5zIHx8IHBhdHRlcm5zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdXG4gIHJldHVybiBtZXNzYWdlcy5maWx0ZXIoKG0pID0+IG1hdGNoZXNEb21haW5GaWx0ZXIobS5mcm9tLCBwYXR0ZXJucykpXG59XG5cbi8qKiBUcnVlIHdoZW4gYGZyb21BZGRyZXNzYCBtYXRjaGVzIGEgc2luZ2xlIGFsbG93bGlzdCAvIHRlbXBsYXRlIHBhdHRlcm4uICovXG5leHBvcnQgZnVuY3Rpb24gbWF0Y2hlc0Zyb21QYXR0ZXJuKFxuICBmcm9tQWRkcmVzczogc3RyaW5nLFxuICBwYXR0ZXJuOiBzdHJpbmcsXG4pOiBib29sZWFuIHtcbiAgY29uc3Qgbm9ybWFsaXplZEZyb20gPSBub3JtYWxpemVGcm9tKGZyb21BZGRyZXNzKVxuICBpZiAoIW5vcm1hbGl6ZWRGcm9tKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgcCA9IHBhdHRlcm4udHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFwKSByZXR1cm4gZmFsc2VcbiAgcmV0dXJuIG1hdGNoZXNTaW5nbGVQYXR0ZXJuKG5vcm1hbGl6ZWRGcm9tLCBwKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplRnJvbShcbiAgZnJvbTogc3RyaW5nLFxuKTogeyBlbWFpbDogc3RyaW5nOyBsb2NhbDogc3RyaW5nOyBkb21haW46IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHRyaW1tZWQgPSBmcm9tLnRyaW0oKVxuICAvLyBcIk5hbWUgPHVzZXJAZG9tYWluLmNvbT5cIiBvciBiYXJlIFwidXNlckBkb21haW4uY29tXCJcbiAgY29uc3QgYW5nbGUgPSB0cmltbWVkLm1hdGNoKC88KFtePl0rKT4vKVxuICBjb25zdCBlbWFpbCA9IChhbmdsZT8uWzFdID8/IHRyaW1tZWQpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGNvbnN0IGF0ID0gZW1haWwubGFzdEluZGV4T2YoJ0AnKVxuICBpZiAoYXQgPD0gMCB8fCBhdCA9PT0gZW1haWwubGVuZ3RoIC0gMSkgcmV0dXJuIG51bGxcbiAgY29uc3QgbG9jYWwgPSBlbWFpbC5zbGljZSgwLCBhdClcbiAgY29uc3QgZG9tYWluID0gZW1haWwuc2xpY2UoYXQgKyAxKVxuICBpZiAoIWRvbWFpbi5pbmNsdWRlcygnLicpKSByZXR1cm4gbnVsbFxuICByZXR1cm4geyBlbWFpbCwgbG9jYWwsIGRvbWFpbiB9XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXNTaW5nbGVQYXR0ZXJuKFxuICBmcm9tOiB7IGVtYWlsOiBzdHJpbmc7IGxvY2FsOiBzdHJpbmc7IGRvbWFpbjogc3RyaW5nIH0sXG4gIHBhdHRlcm46IHN0cmluZyxcbik6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5pbmNsdWRlcygnQCcpKSB7XG4gICAgcmV0dXJuIG1hdGNoZXNBZGRyZXNzUGF0dGVybihmcm9tLCBwYXR0ZXJuKVxuICB9XG4gIHJldHVybiBtYXRjaGVzRG9tYWluUGF0dGVybihmcm9tLmRvbWFpbiwgcGF0dGVybilcbn1cblxuZnVuY3Rpb24gbWF0Y2hlc0FkZHJlc3NQYXR0ZXJuKFxuICBmcm9tOiB7IGVtYWlsOiBzdHJpbmc7IGxvY2FsOiBzdHJpbmc7IGRvbWFpbjogc3RyaW5nIH0sXG4gIHBhdHRlcm46IHN0cmluZyxcbik6IGJvb2xlYW4ge1xuICBjb25zdCBhdCA9IHBhdHRlcm4ubGFzdEluZGV4T2YoJ0AnKVxuICBpZiAoYXQgPD0gMCB8fCBhdCA9PT0gcGF0dGVybi5sZW5ndGggLSAxKSByZXR1cm4gZmFsc2VcbiAgY29uc3QgbG9jYWxQYXQgPSBwYXR0ZXJuLnNsaWNlKDAsIGF0KVxuICBjb25zdCBkb21haW5QYXQgPSBwYXR0ZXJuLnNsaWNlKGF0ICsgMSlcblxuICBpZiAobG9jYWxQYXQgIT09ICcqJyAmJiBsb2NhbFBhdCAhPT0gZnJvbS5sb2NhbCkgcmV0dXJuIGZhbHNlXG4gIC8vIEFkZHJlc3MtZm9ybSBkb21haW4gc2lkZTogZXhhY3QgYXBleCwgb3IgZXhwbGljaXQgKi5zdWJkb21haW4gcGF0dGVybi5cbiAgLy8gKGAqQHNob3AuY29tYCBkb2VzIG5vdCBtYXRjaCBtYWlsLnNob3AuY29tOyB1c2UgYCpAKi5zaG9wLmNvbWAgZm9yIHRoYXQuKVxuICBpZiAoZG9tYWluUGF0LnN0YXJ0c1dpdGgoJyouJykpIHtcbiAgICByZXR1cm4gbWF0Y2hlc0RvbWFpblBhdHRlcm4oZnJvbS5kb21haW4sIGRvbWFpblBhdClcbiAgfVxuICByZXR1cm4gZnJvbS5kb21haW4gPT09IGRvbWFpblBhdFxufVxuXG5mdW5jdGlvbiBtYXRjaGVzRG9tYWluUGF0dGVybihkb21haW46IHN0cmluZywgcGF0dGVybjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChwYXR0ZXJuLnN0YXJ0c1dpdGgoJyouJykpIHtcbiAgICBjb25zdCBzdWZmaXggPSBwYXR0ZXJuLnNsaWNlKDIpXG4gICAgaWYgKCFzdWZmaXguaW5jbHVkZXMoJy4nKSkgcmV0dXJuIGZhbHNlXG4gICAgLy8gU3ViZG9tYWlucyBvbmx5IFx1MjAxNCBub3QgdGhlIGFwZXggaXRzZWxmLlxuICAgIHJldHVybiBkb21haW4uZW5kc1dpdGgoYC4ke3N1ZmZpeH1gKVxuICB9XG4gIHJldHVybiBkb21haW4gPT09IHBhdHRlcm4gfHwgZG9tYWluLmVuZHNXaXRoKGAuJHtwYXR0ZXJufWApXG59XG4iLCAiaW1wb3J0IHsgbWF0Y2hlc0Zyb21QYXR0ZXJuIH0gZnJvbSAnLi9kb21haW5fZmlsdGVyLnRzJ1xuXG4vKiogTWluaW1hbCB0ZW1wbGF0ZSBtYXRjaCBmaWVsZHMgKGZyb20gcGF0dGVybiArIG9wdGlvbmFsIHN1YmplY3QgcmVnZXgpLiAqL1xuZXhwb3J0IHR5cGUgVGVtcGxhdGVNYXRjaFNwZWMgPSB7XG4gIG1hdGNoRnJvbVBhdHRlcm46IHN0cmluZ1xuICBtYXRjaFN1YmplY3RSZWdleD86IHN0cmluZyB8IG51bGxcbiAgLyoqIFdoZW4gZXhwbGljaXRseSBmYWxzZSwgbmV2ZXIgbWF0Y2hlcy4gVW5kZWZpbmVkL3RydWUgPSBlbmFibGVkLiAqL1xuICBlbmFibGVkPzogYm9vbGVhblxufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBtZXNzYWdlIGZpdHMgYSBwYXJzaW5nIHRlbXBsYXRlJ3MgbWF0Y2ggcnVsZXNcbiAqIChmcm9tIHBhdHRlcm4gKyBvcHRpb25hbCBzdWJqZWN0IHJlZ2V4KS4gRG9lcyBub3QgcmVxdWlyZSBhIHN1Y2Nlc3NmdWwgZXh0cmFjdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lc3NhZ2VNYXRjaGVzVGVtcGxhdGUoXG4gIG1lc3NhZ2U6IHsgZnJvbTogc3RyaW5nOyBzdWJqZWN0OiBzdHJpbmcgfSxcbiAgdGVtcGxhdGU6IFRlbXBsYXRlTWF0Y2hTcGVjLFxuKTogYm9vbGVhbiB7XG4gIGlmICh0ZW1wbGF0ZS5lbmFibGVkID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlXG4gIGlmICghbWF0Y2hlc0Zyb21QYXR0ZXJuKG1lc3NhZ2UuZnJvbSwgdGVtcGxhdGUubWF0Y2hGcm9tUGF0dGVybikpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICBjb25zdCBzdWJqZWN0UmUgPSB0ZW1wbGF0ZS5tYXRjaFN1YmplY3RSZWdleD8udHJpbSgpXG4gIGlmIChzdWJqZWN0UmUpIHtcbiAgICB0cnkge1xuICAgICAgaWYgKCFuZXcgUmVnRXhwKHN1YmplY3RSZSwgJ2knKS50ZXN0KG1lc3NhZ2Uuc3ViamVjdCkpIHJldHVybiBmYWxzZVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlXG59XG5cbi8qKiBUcnVlIHdoZW4gYW55IGVuYWJsZWQgdGVtcGxhdGUgbWF0Y2hlcyB0aGUgbWVzc2FnZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXNzYWdlTWF0Y2hlc0FueVRlbXBsYXRlKFxuICBtZXNzYWdlOiB7IGZyb206IHN0cmluZzsgc3ViamVjdDogc3RyaW5nIH0sXG4gIHRlbXBsYXRlczogcmVhZG9ubHkgVGVtcGxhdGVNYXRjaFNwZWNbXSxcbik6IGJvb2xlYW4ge1xuICByZXR1cm4gdGVtcGxhdGVzLnNvbWUoKHQpID0+IG1lc3NhZ2VNYXRjaGVzVGVtcGxhdGUobWVzc2FnZSwgdCkpXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBFbWFpbE1lc3NhZ2UsIEV4dHJhY3Rpb25BcnRpZmFjdCB9IGZyb20gJy4vdHlwZXMudHMnXG5cbi8qKlxuICogUGx1Z2dhYmxlIGV4dHJhY3Rvci4gSW1wbGVtZW50YXRpb25zIG11c3Qgbm90IGRlcGVuZCBvbiBzcGVuZG1hbmFnZXIgdHlwZXMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRXh0cmFjdG9yIHtcbiAgcmVhZG9ubHkga2luZDogc3RyaW5nXG4gIGNhbkhhbmRsZShtZXNzYWdlOiBFbWFpbE1lc3NhZ2UpOiBib29sZWFuXG4gIGV4dHJhY3QobWVzc2FnZTogRW1haWxNZXNzYWdlKTogRXh0cmFjdGlvbkFydGlmYWN0W11cbn1cblxuZXhwb3J0IHR5cGUgRXh0cmFjdG9yUGlwZWxpbmVPcHRpb25zID0ge1xuICAvKipcbiAgICogV2hlbiB0cnVlLCBzdG9wIGFmdGVyIHRoZSBmaXJzdCBleHRyYWN0b3IgdGhhdCByZXR1cm5zIGFydGlmYWN0cy5cbiAgICogVXNlZCBzbyB0ZW1wbGF0ZXMgd2luIG92ZXIgdGhlIGhldXJpc3RpYyBmYWxsYmFjay5cbiAgICovXG4gIGZpcnN0TWF0Y2hPbmx5PzogYm9vbGVhblxufVxuXG5leHBvcnQgY2xhc3MgRXh0cmFjdG9yUGlwZWxpbmUge1xuICBwcml2YXRlIHJlYWRvbmx5IGZpcnN0TWF0Y2hPbmx5OiBib29sZWFuXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBleHRyYWN0b3JzOiByZWFkb25seSBFeHRyYWN0b3JbXSxcbiAgICBvcHRpb25zPzogRXh0cmFjdG9yUGlwZWxpbmVPcHRpb25zLFxuICApIHtcbiAgICB0aGlzLmZpcnN0TWF0Y2hPbmx5ID0gb3B0aW9ucz8uZmlyc3RNYXRjaE9ubHkgPz8gZmFsc2VcbiAgfVxuXG4gIHJ1bihtZXNzYWdlOiBFbWFpbE1lc3NhZ2UpOiBFeHRyYWN0aW9uQXJ0aWZhY3RbXSB7XG4gICAgY29uc3Qgb3V0OiBFeHRyYWN0aW9uQXJ0aWZhY3RbXSA9IFtdXG4gICAgZm9yIChjb25zdCBleHRyYWN0b3Igb2YgdGhpcy5leHRyYWN0b3JzKSB7XG4gICAgICBpZiAoIWV4dHJhY3Rvci5jYW5IYW5kbGUobWVzc2FnZSkpIGNvbnRpbnVlXG4gICAgICBjb25zdCBhcnRzID0gZXh0cmFjdG9yLmV4dHJhY3QobWVzc2FnZSlcbiAgICAgIGlmIChhcnRzLmxlbmd0aCA9PT0gMCkgY29udGludWVcbiAgICAgIG91dC5wdXNoKC4uLmFydHMpXG4gICAgICBpZiAodGhpcy5maXJzdE1hdGNoT25seSkgcmV0dXJuIG91dFxuICAgIH1cbiAgICByZXR1cm4gb3V0XG4gIH1cbn1cbiIsICIvKipcbiAqIENvbnZlcnQgZW1haWwgSFRNTCAoT3V0bG9vay90YWJsZSBsYXlvdXRzLCBMYXRpbiBlbnRpdGllcykgaW50byByZWFkYWJsZSBwbGFpbiB0ZXh0LlxuICogVXNlZCBhdCBzeW5jIHRpbWUgZm9yIHBlcnNpc3RlbmNlIGFuZCBieSBleHRyYWN0b3JzIGZvciB0aGUgYGh0bWxfdGV4dGAgc291cmNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHRtbFRvUGxhaW5UZXh0KGh0bWw6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpOiBzdHJpbmcge1xuICBpZiAoIWh0bWwpIHJldHVybiAnJ1xuXG4gIGxldCBzID0gaHRtbFxuXG4gIC8vIENvbW1lbnRzIChpbmNsLiBPdXRsb29rIDwhLS1baWYgLi4uXT4gXHUyMDI2IDwhW2VuZGlmXS0tPilcbiAgcyA9IHMucmVwbGFjZSgvPCEtLVtcXHNcXFNdKj8tLT4vZywgJycpXG5cbiAgLy8gTm9uLWNvbnRlbnQgYmxvY2tzXG4gIHMgPSBzLnJlcGxhY2UoLzxzY3JpcHRbXFxzXFxTXSo/PFxcL3NjcmlwdD4vZ2ksICcnKVxuICBzID0gcy5yZXBsYWNlKC88c3R5bGVbXFxzXFxTXSo/PFxcL3N0eWxlPi9naSwgJycpXG4gIHMgPSBzLnJlcGxhY2UoLzxoZWFkW1xcc1xcU10qPzxcXC9oZWFkPi9naSwgJycpXG4gIHMgPSBzLnJlcGxhY2UoLzxub3NjcmlwdFtcXHNcXFNdKj88XFwvbm9zY3JpcHQ+L2dpLCAnJylcblxuICAvLyBTb2Z0IGxpbmUgYnJlYWtzIC8gYmxvY2sgZW5kcyBcdTIxOTIgbmV3bGluZXNcbiAgcyA9IHMucmVwbGFjZSgvPGJyXFxzKlxcLz8+L2dpLCAnXFxuJylcbiAgcyA9IHMucmVwbGFjZSgvPFxcLyhwfGRpdnx0cnxoWzEtNl18bGl8YmxvY2txdW90ZSlcXHMqPi9naSwgJ1xcbicpXG4gIC8vIFRhYmxlIGNlbGxzOiBrZWVwIHdvcmRzIGZyb20gYWRqYWNlbnQgY2VsbHMgc2VwYXJhdGVkXG4gIHMgPSBzLnJlcGxhY2UoLzxcXC90ZFxccyo+L2dpLCAnICcpXG4gIHMgPSBzLnJlcGxhY2UoLzxcXC90aFxccyo+L2dpLCAnICcpXG5cbiAgLy8gRHJvcCByZW1haW5pbmcgdGFnc1xuICBzID0gcy5yZXBsYWNlKC88W14+XSs+L2csICcnKVxuXG4gIHMgPSBkZWNvZGVIdG1sRW50aXRpZXMocylcblxuICAvLyBOb3JtYWxpemUgd2hpdGVzcGFjZVxuICBzID0gc1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAubWFwKChsaW5lKSA9PiBsaW5lLnJlcGxhY2UoL1sgXFx0XFxmXFx2XSsvZywgJyAnKS50cmltKCkpXG4gICAgLmpvaW4oJ1xcbicpXG4gIHMgPSBzLnJlcGxhY2UoL1xcbnszLH0vZywgJ1xcblxcbicpXG4gIHJldHVybiBzLnRyaW0oKVxufVxuXG4vKiogVHJ1ZSB3aGVuIGEgc3RvcmVkIGJvZHkgbG9va3MgbGlrZSByYXcgSFRNTCByYXRoZXIgdGhhbiBwbGFpbiB0ZXh0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvb2tzTGlrZUh0bWwodmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL15cXHMqKDwhRE9DVFlQRVxcYnw8aHRtbFxcYnw8aGVhZFxcYnw8Ym9keVxcYnw8ZGl2XFxifDx0YWJsZVxcYnw8cFxcYnw8YnJcXGJ8PHNwYW5cXGIpL2lcbiAgICAudGVzdCh2YWx1ZSlcbn1cblxuLyoqXG4gKiBQcmVmZXIgZ2VudWluZSBwbGFpbiBNSU1FIHRleHQ7IG90aGVyd2lzZSBleHRyYWN0IGZyb20gSFRNTCAoaW5jbC4gSFRNTFxuICogZHVwbGljYXRlZCBpbnRvIHRoZSB0ZXh0IHBhcnQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRleHRCb2R5KFxuICB0ZXh0Qm9keTogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgaHRtbEJvZHk6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgdGV4dCA9IHRleHRCb2R5Py50cmltKClcbiAgaWYgKHRleHQgJiYgIWxvb2tzTGlrZUh0bWwodGV4dCkpIHJldHVybiB0ZXh0XG5cbiAgY29uc3QgZnJvbUh0bWwgPSBodG1sVG9QbGFpblRleHQoaHRtbEJvZHkpXG4gIGlmIChmcm9tSHRtbCkgcmV0dXJuIGZyb21IdG1sXG5cbiAgaWYgKHRleHQpIHtcbiAgICBjb25zdCBzdHJpcHBlZCA9IGh0bWxUb1BsYWluVGV4dCh0ZXh0KVxuICAgIGlmIChzdHJpcHBlZCkgcmV0dXJuIHN0cmlwcGVkXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG5jb25zdCBOQU1FRF9FTlRJVElFUzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgYW1wOiAnJicsXG4gIGx0OiAnPCcsXG4gIGd0OiAnPicsXG4gIHF1b3Q6ICdcIicsXG4gIGFwb3M6IFwiJ1wiLFxuICBuYnNwOiAnICcsXG4gIC8vIENvbW1vbiBMYXRpbiBhY2NlbnRzIGluIE1YIC8gRVMgYmFuayBlbWFpbHNcbiAgYWFjdXRlOiAnXHUwMEUxJyxcbiAgZWFjdXRlOiAnXHUwMEU5JyxcbiAgaWFjdXRlOiAnXHUwMEVEJyxcbiAgb2FjdXRlOiAnXHUwMEYzJyxcbiAgdWFjdXRlOiAnXHUwMEZBJyxcbiAgbnRpbGRlOiAnXHUwMEYxJyxcbiAgQWFjdXRlOiAnXHUwMEMxJyxcbiAgRWFjdXRlOiAnXHUwMEM5JyxcbiAgSWFjdXRlOiAnXHUwMENEJyxcbiAgT2FjdXRlOiAnXHUwMEQzJyxcbiAgVWFjdXRlOiAnXHUwMERBJyxcbiAgTnRpbGRlOiAnXHUwMEQxJyxcbiAgdXVtbDogJ1x1MDBGQycsXG4gIFV1bWw6ICdcdTAwREMnLFxuICBpZXhjbDogJ1x1MDBBMScsXG4gIGlxdWVzdDogJ1x1MDBCRicsXG4gIGNvcHk6ICdcdTAwQTknLFxuICByZWc6ICdcdTAwQUUnLFxuICB0cmFkZTogJ1x1MjEyMicsXG4gIG1kYXNoOiAnXHUyMDE0JyxcbiAgbmRhc2g6ICdcdTIwMTMnLFxuICBoZWxsaXA6ICdcdTIwMjYnLFxuICBsYXF1bzogJ1x1MDBBQicsXG4gIHJhcXVvOiAnXHUwMEJCJyxcbn1cblxuZnVuY3Rpb24gZGVjb2RlSHRtbEVudGl0aWVzKHM6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzLnJlcGxhY2UoXG4gICAgLyYoI3g/WzAtOWEtZl0rfFthLXpdKyk7L2dpLFxuICAgIChtYXRjaCwgZW50aXR5OiBzdHJpbmcpID0+IHtcbiAgICAgIGlmIChlbnRpdHlbMF0gPT09ICcjJykge1xuICAgICAgICBjb25zdCBoZXggPSBlbnRpdHlbMV0gPT09ICd4JyB8fCBlbnRpdHlbMV0gPT09ICdYJ1xuICAgICAgICBjb25zdCBjb2RlID0gaGV4XG4gICAgICAgICAgPyBOdW1iZXIucGFyc2VJbnQoZW50aXR5LnNsaWNlKDIpLCAxNilcbiAgICAgICAgICA6IE51bWJlci5wYXJzZUludChlbnRpdHkuc2xpY2UoMSksIDEwKVxuICAgICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKGNvZGUpICYmIGNvZGUgPj0gMCkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICByZXR1cm4gU3RyaW5nLmZyb21Db2RlUG9pbnQoY29kZSlcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHJldHVybiBtYXRjaFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbWF0Y2hcbiAgICAgIH1cbiAgICAgIHJldHVybiBOQU1FRF9FTlRJVElFU1tlbnRpdHldID8/IG1hdGNoXG4gICAgfSxcbiAgKVxufVxuIiwgImltcG9ydCB7IG5vcm1hbGl6ZUZyb20gfSBmcm9tICcuLi9kb21haW5fZmlsdGVyLnRzJ1xuaW1wb3J0IHR5cGUgeyBFeHRyYWN0b3IgfSBmcm9tICcuLi9leHRyYWN0b3IudHMnXG5pbXBvcnQgeyBodG1sVG9QbGFpblRleHQsIHJlc29sdmVUZXh0Qm9keSB9IGZyb20gJy4uL2h0bWxfdG9fcGxhaW5fdGV4dC50cydcbmltcG9ydCB7IG1lc3NhZ2VNYXRjaGVzVGVtcGxhdGUgfSBmcm9tICcuLi90ZW1wbGF0ZV9tYXRjaC50cydcbmltcG9ydCB7XG4gIFNQRU5ESU5HX0NBTkRJREFURV9LSU5ELFxuICB0eXBlIERhdGVQYXJ0c0V4dHJhY3RvcixcbiAgdHlwZSBEaXJlY3Rpb25FeHRyYWN0b3IsXG4gIHR5cGUgRW1haWxNZXNzYWdlLFxuICB0eXBlIEV4dHJhY3Rpb25BcnRpZmFjdCxcbiAgdHlwZSBGaWVsZEV4dHJhY3RvcixcbiAgdHlwZSBTcGVuZFBhcnNpbmdUZW1wbGF0ZSxcbiAgdHlwZSBTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyxcbiAgdHlwZSBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuXG4vKipcbiAqIERldGVybWluaXN0aWMgc3BlbmRpbmcgZXh0cmFjdG9yIGRyaXZlbiBieSBhIHVzZXIvQUktZ2VuZXJhdGVkIHRlbXBsYXRlLlxuICogTm8gTExNIGNhbGxzIFx1MjAxNCByZWdleCAvIGNvbnN0YW50IC8gZnJvbV9kb21haW4gb25seS5cbiAqL1xuZXhwb3J0IGNsYXNzIFRlbXBsYXRlU3BlbmRpbmdFeHRyYWN0b3IgaW1wbGVtZW50cyBFeHRyYWN0b3Ige1xuICByZWFkb25seSBraW5kID0gU1BFTkRJTkdfQ0FORElEQVRFX0tJTkRcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHRlbXBsYXRlOiBTcGVuZFBhcnNpbmdUZW1wbGF0ZSkge31cblxuICBnZXQgdGVtcGxhdGVJZCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLnRlbXBsYXRlLmlkXG4gIH1cblxuICBjYW5IYW5kbGUobWVzc2FnZTogRW1haWxNZXNzYWdlKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG1lc3NhZ2VNYXRjaGVzVGVtcGxhdGUobWVzc2FnZSwgdGhpcy50ZW1wbGF0ZSlcbiAgfVxuXG4gIGV4dHJhY3QobWVzc2FnZTogRW1haWxNZXNzYWdlKTogRXh0cmFjdGlvbkFydGlmYWN0W10ge1xuICAgIGNvbnN0IHNvdXJjZXMgPSBidWlsZFNvdXJjZXMobWVzc2FnZSlcblxuICAgIGlmICh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMuZGlyZWN0aW9uKSB7XG4gICAgICBjb25zdCBmbG93ID0gY2xhc3NpZnlEaXJlY3Rpb24oXG4gICAgICAgIHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5kaXJlY3Rpb24sXG4gICAgICAgIHNvdXJjZXMsXG4gICAgICApXG4gICAgICBpZiAoZmxvdyA9PT0gJ2luYm91bmQnKSByZXR1cm4gW11cbiAgICB9XG5cbiAgICBjb25zdCBhbW91bnRSYXcgPSBhcHBseUZpZWxkKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5hbW91bnQsIHNvdXJjZXMpXG4gICAgY29uc3QgYW1vdW50Q2VudHMgPSBwYXJzZU1vbmV5VG9DZW50cyhhbW91bnRSYXcpXG4gICAgaWYgKGFtb3VudENlbnRzID09PSBudWxsKSByZXR1cm4gW11cblxuICAgIGNvbnN0IGN1cnJlbmN5UmF3ID0gdGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLmN1cnJlbmN5XG4gICAgICA/IGFwcGx5RmllbGQodGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLmN1cnJlbmN5LCBzb3VyY2VzKVxuICAgICAgOiBudWxsXG4gICAgY29uc3QgY3VycmVuY3kgPSBub3JtYWxpemVDdXJyZW5jeShjdXJyZW5jeVJhdykgPz8gJ1VTRCdcblxuICAgIGNvbnN0IHNwZW50T24gPVxuICAgICAgcmVzb2x2ZVNwZW50T24odGhpcy50ZW1wbGF0ZS5leHRyYWN0b3JzLnNwZW50T24sIHNvdXJjZXMpID8/XG4gICAgICB0b0RhdGVTdHJpbmcobWVzc2FnZS5yZWNlaXZlZEF0KVxuXG4gICAgY29uc3QgbWVyY2hhbnQgPSB0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMubWVyY2hhbnRcbiAgICAgID8gYXBwbHlGaWVsZCh0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMubWVyY2hhbnQsIHNvdXJjZXMpXG4gICAgICA6IG51bGxcblxuICAgIGNvbnN0IG5vdGUgPSB0aGlzLnRlbXBsYXRlLmV4dHJhY3RvcnMubm90ZVxuICAgICAgPyBhcHBseUZpZWxkKHRoaXMudGVtcGxhdGUuZXh0cmFjdG9ycy5ub3RlLCBzb3VyY2VzKVxuICAgICAgOiBtZXNzYWdlLnN1YmplY3Quc2xpY2UoMCwgMjAwKSB8fCBudWxsXG5cbiAgICBjb25zdCBwYXlsb2FkOiBTcGVuZGluZ0NhbmRpZGF0ZVBheWxvYWQgPSB7XG4gICAgICBhbW91bnRDZW50cyxcbiAgICAgIGN1cnJlbmN5LFxuICAgICAgc3BlbnRPbixcbiAgICAgIG1lcmNoYW50OiBtZXJjaGFudD8udHJpbSgpID8gbWVyY2hhbnQudHJpbSgpLnNsaWNlKDAsIDEyMCkgOiBudWxsLFxuICAgICAgbm90ZTogbm90ZT8udHJpbSgpID8gbm90ZS50cmltKCkuc2xpY2UoMCwgMjAwKSA6IG51bGwsXG4gICAgICBzb3VyY2VTdWJqZWN0OiBtZXNzYWdlLnN1YmplY3QsXG4gICAgICBzb3VyY2VGcm9tOiBtZXNzYWdlLmZyb20sXG4gICAgICB0ZW1wbGF0ZUlkOiB0aGlzLnRlbXBsYXRlLmlkLFxuICAgIH1cblxuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6IFNQRU5ESU5HX0NBTkRJREFURV9LSU5ELFxuICAgICAgICBwYXlsb2FkOiB7IC4uLnBheWxvYWQgfSxcbiAgICAgICAgY29uZmlkZW5jZTogMC45LFxuICAgICAgfSxcbiAgICBdXG4gIH1cbn1cblxudHlwZSBTb3VyY2VzID0ge1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgdGV4dDogc3RyaW5nXG4gIGh0bWxfdGV4dDogc3RyaW5nXG4gIGZyb21fZG9tYWluOiBzdHJpbmcgfCBudWxsXG59XG5cbmZ1bmN0aW9uIGJ1aWxkU291cmNlcyhtZXNzYWdlOiBFbWFpbE1lc3NhZ2UpOiBTb3VyY2VzIHtcbiAgY29uc3QgZnJvbSA9IG5vcm1hbGl6ZUZyb20obWVzc2FnZS5mcm9tKVxuICAvLyBTYW1lIHBsYWluIHRleHQgYXMgcmVzb2x2ZVRleHRCb2R5IC8gc3RvcmVkIG1lc3NhZ2VzLnRleHRfYm9keSAobm90IHJhdyBNSU1FKS5cbiAgY29uc3QgdGV4dCA9IHJlc29sdmVUZXh0Qm9keShtZXNzYWdlLnRleHRCb2R5LCBtZXNzYWdlLmh0bWxCb2R5KSA/PyAnJ1xuICBjb25zdCBmcm9tSHRtbCA9IGh0bWxUb1BsYWluVGV4dChtZXNzYWdlLmh0bWxCb2R5KVxuICByZXR1cm4ge1xuICAgIHN1YmplY3Q6IG1lc3NhZ2Uuc3ViamVjdCA/PyAnJyxcbiAgICB0ZXh0LFxuICAgIC8vIFByZWZlciBleHRyYWN0ZWQgSFRNTDsgZmFsbCBiYWNrIHRvIHN0b3JlZCBwbGFpbiB0ZXh0IChwb3N0LW1pZ3JhdGlvbikuXG4gICAgaHRtbF90ZXh0OiBmcm9tSHRtbCB8fCB0ZXh0LFxuICAgIGZyb21fZG9tYWluOiBmcm9tPy5kb21haW4gPz8gbnVsbCxcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUZpZWxkKFxuICBleHRyYWN0b3I6IEZpZWxkRXh0cmFjdG9yLFxuICBzb3VyY2VzOiBTb3VyY2VzLFxuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChleHRyYWN0b3Iuc291cmNlID09PSAnY29uc3RhbnQnKSB7XG4gICAgcmV0dXJuIGV4dHJhY3Rvci52YWx1ZVxuICB9XG4gIGlmIChleHRyYWN0b3Iuc291cmNlID09PSAnZnJvbV9kb21haW4nKSB7XG4gICAgaWYgKCFzb3VyY2VzLmZyb21fZG9tYWluKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IGJhc2UgPSBzb3VyY2VzLmZyb21fZG9tYWluLnNwbGl0KCcuJylbMF1cbiAgICBpZiAoIWJhc2UpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIGJhc2UuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBiYXNlLnNsaWNlKDEpXG4gIH1cbiAgY29uc3QgaGF5c3RhY2sgPSBzb3VyY2VzW2V4dHJhY3Rvci5zb3VyY2VdXG4gIHRyeSB7XG4gICAgY29uc3QgcmUgPSBuZXcgUmVnRXhwKGV4dHJhY3Rvci5yZWdleCwgJ2knKVxuICAgIGNvbnN0IG0gPSBoYXlzdGFjay5tYXRjaChyZSlcbiAgICBjb25zdCBncm91cCA9IGV4dHJhY3Rvci5ncm91cFxuICAgIGlmICghbSB8fCBncm91cCA8IDAgfHwgZ3JvdXAgPj0gbS5sZW5ndGgpIHJldHVybiBudWxsXG4gICAgY29uc3QgdmFsdWUgPSBtW2dyb3VwXVxuICAgIHJldHVybiB2YWx1ZT8udHJpbSgpID8gdmFsdWUudHJpbSgpIDogbnVsbFxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVTcGVudE9uKFxuICBleHRyYWN0b3I6IEZpZWxkRXh0cmFjdG9yIHwgRGF0ZVBhcnRzRXh0cmFjdG9yIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgc291cmNlczogU291cmNlcyxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWV4dHJhY3RvcikgcmV0dXJuIG51bGxcbiAgaWYgKGlzRGF0ZVBhcnRzRXh0cmFjdG9yKGV4dHJhY3RvcikpIHtcbiAgICByZXR1cm4gY29tcG9zZURhdGVQYXJ0cyhleHRyYWN0b3IsIHNvdXJjZXMpXG4gIH1cbiAgY29uc3Qgc3BlbnRPblJhdyA9IGFwcGx5RmllbGQoZXh0cmFjdG9yLCBzb3VyY2VzKVxuICByZXR1cm4gbm9ybWFsaXplRGF0ZShzcGVudE9uUmF3KVxufVxuXG5mdW5jdGlvbiBjb21wb3NlRGF0ZVBhcnRzKFxuICBleHRyYWN0b3I6IERhdGVQYXJ0c0V4dHJhY3RvcixcbiAgc291cmNlczogU291cmNlcyxcbik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBoYXlzdGFjayA9IHNvdXJjZXNbZXh0cmFjdG9yLnNvdXJjZV1cbiAgdHJ5IHtcbiAgICBjb25zdCByZSA9IG5ldyBSZWdFeHAoZXh0cmFjdG9yLnJlZ2V4LCAnaScpXG4gICAgY29uc3QgbSA9IGhheXN0YWNrLm1hdGNoKHJlKVxuICAgIGlmICghbSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCB5ZWFyID0gTnVtYmVyKG1bZXh0cmFjdG9yLnllYXJHcm91cF0pXG4gICAgY29uc3QgbW9udGggPSBOdW1iZXIobVtleHRyYWN0b3IubW9udGhHcm91cF0pXG4gICAgY29uc3QgZGF5ID0gTnVtYmVyKG1bZXh0cmFjdG9yLmRheUdyb3VwXSlcbiAgICBpZiAoXG4gICAgICAhTnVtYmVyLmlzSW50ZWdlcih5ZWFyKSB8fFxuICAgICAgIU51bWJlci5pc0ludGVnZXIobW9udGgpIHx8XG4gICAgICAhTnVtYmVyLmlzSW50ZWdlcihkYXkpXG4gICAgKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgICBpZiAoeWVhciA8IDIwMDAgfHwgeWVhciA+IDIxMDApIHJldHVybiBudWxsXG4gICAgaWYgKG1vbnRoIDwgMSB8fCBtb250aCA+IDEyKSByZXR1cm4gbnVsbFxuICAgIGlmIChkYXkgPCAxIHx8IGRheSA+IDMxKSByZXR1cm4gbnVsbFxuICAgIC8vIFNvZnQgY2FsZW5kYXIgY2hlY2s6IHJlamVjdCBlLmcuIEZlYiAzMSB2aWEgRGF0ZSBVVEMgcm91bmQtdHJpcC5cbiAgICBjb25zdCBjb21wb3NlZCA9IGAke3llYXJ9LSR7cGFkMihtb250aCl9LSR7cGFkMihkYXkpfWBcbiAgICBjb25zdCBjaGVjayA9IG5ldyBEYXRlKGAke2NvbXBvc2VkfVQwMDowMDowMC4wMDBaYClcbiAgICBpZiAoXG4gICAgICBOdW1iZXIuaXNOYU4oY2hlY2suZ2V0VGltZSgpKSB8fFxuICAgICAgY2hlY2suZ2V0VVRDRnVsbFllYXIoKSAhPT0geWVhciB8fFxuICAgICAgY2hlY2suZ2V0VVRDTW9udGgoKSArIDEgIT09IG1vbnRoIHx8XG4gICAgICBjaGVjay5nZXRVVENEYXRlKCkgIT09IGRheVxuICAgICkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgcmV0dXJuIGNvbXBvc2VkXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZnVuY3Rpb24gY2xhc3NpZnlEaXJlY3Rpb24oXG4gIGV4dHJhY3RvcjogRGlyZWN0aW9uRXh0cmFjdG9yLFxuICBzb3VyY2VzOiBTb3VyY2VzLFxuKTogJ2luYm91bmQnIHwgJ291dGJvdW5kJyB8ICd1bmtub3duJyB7XG4gIGNvbnN0IGhheXN0YWNrID0gc291cmNlc1tleHRyYWN0b3Iuc291cmNlXVxuICB0cnkge1xuICAgIGNvbnN0IHJlID0gbmV3IFJlZ0V4cChleHRyYWN0b3IucmVnZXgsICdpJylcbiAgICBjb25zdCBtID0gaGF5c3RhY2subWF0Y2gocmUpXG4gICAgY29uc3QgZ3JvdXAgPSBleHRyYWN0b3IuZ3JvdXBcbiAgICBpZiAoIW0gfHwgZ3JvdXAgPCAwIHx8IGdyb3VwID49IG0ubGVuZ3RoKSByZXR1cm4gJ3Vua25vd24nXG4gICAgY29uc3QgcmF3ID0gbVtncm91cF0/LnRyaW0oKVxuICAgIGlmICghcmF3KSByZXR1cm4gJ3Vua25vd24nXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGZvbGRLZXkocmF3KVxuICAgIGlmIChleHRyYWN0b3IuaW5ib3VuZE1hdGNoZXMuc29tZSgoaykgPT4gZm9sZEtleShrKSA9PT0gbm9ybWFsaXplZCkpIHtcbiAgICAgIHJldHVybiAnaW5ib3VuZCdcbiAgICB9XG4gICAgaWYgKGV4dHJhY3Rvci5vdXRib3VuZE1hdGNoZXMuc29tZSgoaykgPT4gZm9sZEtleShrKSA9PT0gbm9ybWFsaXplZCkpIHtcbiAgICAgIHJldHVybiAnb3V0Ym91bmQnXG4gICAgfVxuICAgIHJldHVybiAndW5rbm93bidcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd1bmtub3duJ1xuICB9XG59XG5cbi8qKiBDYXNlLWZvbGQgKyBzdHJpcCBjb21iaW5pbmcgbWFya3Mgc28gXCJkZXBcdTAwRjNzaXRvXCIgbWF0Y2hlcyBcImRlcG9zaXRvXCIuICovXG5mdW5jdGlvbiBmb2xkS2V5KHM6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzXG4gICAgLm5vcm1hbGl6ZSgnTkZEJylcbiAgICAucmVwbGFjZSgvXFxwe019L2d1LCAnJylcbiAgICAudG9Mb3dlckNhc2UoKVxuICAgIC50cmltKClcbn1cblxuZnVuY3Rpb24gcGFyc2VNb25leVRvQ2VudHMocmF3OiBzdHJpbmcgfCBudWxsKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICghcmF3KSByZXR1cm4gbnVsbFxuICBjb25zdCBjbGVhbmVkID0gcmF3LnJlcGxhY2UoL1teXFxkLiwtXS9nLCAnJykucmVwbGFjZSgvLC9nLCAnJylcbiAgaWYgKCFjbGVhbmVkKSByZXR1cm4gbnVsbFxuICBjb25zdCBkb2xsYXJzID0gTnVtYmVyKGNsZWFuZWQpXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKGRvbGxhcnMpIHx8IGRvbGxhcnMgPD0gMCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIE1hdGgucm91bmQoZG9sbGFycyAqIDEwMClcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplQ3VycmVuY3kocmF3OiBzdHJpbmcgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghcmF3KSByZXR1cm4gbnVsbFxuICBjb25zdCBtID0gcmF3LnRvVXBwZXJDYXNlKCkubWF0Y2goL1xcYihVU0R8RVVSfEdCUHxNWE58Q0FEKVxcYi8pXG4gIHJldHVybiBtPy5bMV0gPz8gbnVsbFxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVEYXRlKHJhdzogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIXJhdykgcmV0dXJuIG51bGxcbiAgY29uc3QgaXNvID0gcmF3Lm1hdGNoKC9cXGIoMjBcXGR7Mn0tXFxkezJ9LVxcZHsyfSlcXGIvKVxuICBpZiAoaXNvPy5bMV0pIHJldHVybiBpc29bMV1cbiAgcmV0dXJuIG51bGxcbn1cblxuZnVuY3Rpb24gdG9EYXRlU3RyaW5nKGQ6IERhdGUpOiBzdHJpbmcge1xuICByZXR1cm4gZC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxufVxuXG5mdW5jdGlvbiBwYWQyKG46IG51bWJlcik6IHN0cmluZyB7XG4gIHJldHVybiBuIDwgMTAgPyBgMCR7bn1gIDogU3RyaW5nKG4pXG59XG5cbmZ1bmN0aW9uIGlzRGF0ZVBhcnRzRXh0cmFjdG9yKFxuICByYXc6IEZpZWxkRXh0cmFjdG9yIHwgRGF0ZVBhcnRzRXh0cmFjdG9yLFxuKTogcmF3IGlzIERhdGVQYXJ0c0V4dHJhY3RvciB7XG4gIHJldHVybiAoXG4gICAgJ3llYXJHcm91cCcgaW4gcmF3ICYmXG4gICAgJ21vbnRoR3JvdXAnIGluIHJhdyAmJlxuICAgICdkYXlHcm91cCcgaW4gcmF3ICYmXG4gICAgdHlwZW9mIChyYXcgYXMgRGF0ZVBhcnRzRXh0cmFjdG9yKS55ZWFyR3JvdXAgPT09ICdudW1iZXInXG4gIClcbn1cblxuLyoqIFZhbGlkYXRlIGV4dHJhY3RvcnMgSlNPTiBzaGFwZSAodXNlZCBieSBBUEkgKyBBSSBvdXRwdXQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMoXG4gIHJhdzogdW5rbm93bixcbik6IFNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzIHwgbnVsbCB7XG4gIGlmIChyYXcgPT09IG51bGwgfHwgdHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gbnVsbFxuICBjb25zdCBvYmogPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uc3QgYW1vdW50ID0gcGFyc2VGaWVsZEV4dHJhY3RvcihvYmouYW1vdW50KVxuICBpZiAoIWFtb3VudCkgcmV0dXJuIG51bGxcblxuICBjb25zdCBzcGVudE9uID0gcGFyc2VTcGVudE9uRXh0cmFjdG9yKG9iai5zcGVudE9uKVxuICBpZiAob2JqLnNwZW50T24gIT09IHVuZGVmaW5lZCAmJiBvYmouc3BlbnRPbiAhPT0gbnVsbCAmJiBzcGVudE9uID09PSBudWxsKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGNvbnN0IGRpcmVjdGlvbiA9IHBhcnNlRGlyZWN0aW9uRXh0cmFjdG9yKG9iai5kaXJlY3Rpb24pXG4gIGlmIChcbiAgICBvYmouZGlyZWN0aW9uICE9PSB1bmRlZmluZWQgJiZcbiAgICBvYmouZGlyZWN0aW9uICE9PSBudWxsICYmXG4gICAgZGlyZWN0aW9uID09PSBudWxsXG4gICkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGFtb3VudCxcbiAgICBjdXJyZW5jeTogcGFyc2VPcHRpb25hbEZpZWxkKG9iai5jdXJyZW5jeSksXG4gICAgc3BlbnRPbixcbiAgICBtZXJjaGFudDogcGFyc2VPcHRpb25hbEZpZWxkKG9iai5tZXJjaGFudCksXG4gICAgbm90ZTogcGFyc2VPcHRpb25hbEZpZWxkKG9iai5ub3RlKSxcbiAgICBkaXJlY3Rpb24sXG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VPcHRpb25hbEZpZWxkKHJhdzogdW5rbm93bik6IEZpZWxkRXh0cmFjdG9yIHwgbnVsbCB7XG4gIGlmIChyYXcgPT09IHVuZGVmaW5lZCB8fCByYXcgPT09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiBwYXJzZUZpZWxkRXh0cmFjdG9yKHJhdylcbn1cblxuZnVuY3Rpb24gcGFyc2VTcGVudE9uRXh0cmFjdG9yKFxuICByYXc6IHVua25vd24sXG4pOiBGaWVsZEV4dHJhY3RvciB8IERhdGVQYXJ0c0V4dHJhY3RvciB8IG51bGwge1xuICBpZiAocmF3ID09PSB1bmRlZmluZWQgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAodHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gbnVsbFxuICBjb25zdCBvYmogPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgaWYgKFxuICAgIHR5cGVvZiBvYmoueWVhckdyb3VwID09PSAnbnVtYmVyJyB8fFxuICAgIHR5cGVvZiBvYmoubW9udGhHcm91cCA9PT0gJ251bWJlcicgfHxcbiAgICB0eXBlb2Ygb2JqLmRheUdyb3VwID09PSAnbnVtYmVyJ1xuICApIHtcbiAgICByZXR1cm4gcGFyc2VEYXRlUGFydHNFeHRyYWN0b3Iob2JqKVxuICB9XG4gIHJldHVybiBwYXJzZUZpZWxkRXh0cmFjdG9yKHJhdylcbn1cblxuZnVuY3Rpb24gcGFyc2VEYXRlUGFydHNFeHRyYWN0b3IoXG4gIG9iajogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4pOiBEYXRlUGFydHNFeHRyYWN0b3IgfCBudWxsIHtcbiAgY29uc3Qgc291cmNlID0gb2JqLnNvdXJjZVxuICBpZiAoc291cmNlICE9PSAnc3ViamVjdCcgJiYgc291cmNlICE9PSAndGV4dCcgJiYgc291cmNlICE9PSAnaHRtbF90ZXh0Jykge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgaWYgKHR5cGVvZiBvYmoucmVnZXggIT09ICdzdHJpbmcnIHx8ICFvYmoucmVnZXgpIHJldHVybiBudWxsXG4gIGlmICghaXNOb25OZWdJbnQob2JqLnllYXJHcm91cCkpIHJldHVybiBudWxsXG4gIGlmICghaXNOb25OZWdJbnQob2JqLm1vbnRoR3JvdXApKSByZXR1cm4gbnVsbFxuICBpZiAoIWlzTm9uTmVnSW50KG9iai5kYXlHcm91cCkpIHJldHVybiBudWxsXG4gIHRyeSB7XG4gICAgbmV3IFJlZ0V4cChvYmoucmVnZXgsICdpJylcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICByZXR1cm4ge1xuICAgIHNvdXJjZSxcbiAgICByZWdleDogb2JqLnJlZ2V4LFxuICAgIHllYXJHcm91cDogb2JqLnllYXJHcm91cCxcbiAgICBtb250aEdyb3VwOiBvYmoubW9udGhHcm91cCxcbiAgICBkYXlHcm91cDogb2JqLmRheUdyb3VwLFxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlRGlyZWN0aW9uRXh0cmFjdG9yKHJhdzogdW5rbm93bik6IERpcmVjdGlvbkV4dHJhY3RvciB8IG51bGwge1xuICBpZiAocmF3ID09PSB1bmRlZmluZWQgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAodHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gbnVsbFxuICBjb25zdCBvYmogPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgY29uc3Qgc291cmNlID0gb2JqLnNvdXJjZVxuICBpZiAoc291cmNlICE9PSAnc3ViamVjdCcgJiYgc291cmNlICE9PSAndGV4dCcgJiYgc291cmNlICE9PSAnaHRtbF90ZXh0Jykge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgaWYgKHR5cGVvZiBvYmoucmVnZXggIT09ICdzdHJpbmcnIHx8ICFvYmoucmVnZXgpIHJldHVybiBudWxsXG4gIGlmICghaXNOb25OZWdJbnQob2JqLmdyb3VwKSkgcmV0dXJuIG51bGxcbiAgY29uc3QgaW5ib3VuZCA9IHBhcnNlU3RyaW5nTGlzdChvYmouaW5ib3VuZE1hdGNoZXMpXG4gIGNvbnN0IG91dGJvdW5kID0gcGFyc2VTdHJpbmdMaXN0KG9iai5vdXRib3VuZE1hdGNoZXMpXG4gIGlmICghaW5ib3VuZCB8fCAhb3V0Ym91bmQpIHJldHVybiBudWxsXG4gIGlmIChpbmJvdW5kLmxlbmd0aCA9PT0gMCAmJiBvdXRib3VuZC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG4gIHRyeSB7XG4gICAgbmV3IFJlZ0V4cChvYmoucmVnZXgsICdpJylcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICByZXR1cm4ge1xuICAgIHNvdXJjZSxcbiAgICByZWdleDogb2JqLnJlZ2V4LFxuICAgIGdyb3VwOiBvYmouZ3JvdXAsXG4gICAgaW5ib3VuZE1hdGNoZXM6IGluYm91bmQsXG4gICAgb3V0Ym91bmRNYXRjaGVzOiBvdXRib3VuZCxcbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVN0cmluZ0xpc3QocmF3OiB1bmtub3duKTogc3RyaW5nW10gfCBudWxsIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiBudWxsXG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXVxuICBmb3IgKGNvbnN0IGl0ZW0gb2YgcmF3KSB7XG4gICAgaWYgKHR5cGVvZiBpdGVtICE9PSAnc3RyaW5nJykgcmV0dXJuIG51bGxcbiAgICBjb25zdCB0cmltbWVkID0gaXRlbS50cmltKClcbiAgICBpZiAodHJpbW1lZCkgb3V0LnB1c2godHJpbW1lZClcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIGlzTm9uTmVnSW50KHJhdzogdW5rbm93bik6IHJhdyBpcyBudW1iZXIge1xuICByZXR1cm4gdHlwZW9mIHJhdyA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzSW50ZWdlcihyYXcpICYmIHJhdyA+PSAwXG59XG5cbmZ1bmN0aW9uIHBhcnNlRmllbGRFeHRyYWN0b3IocmF3OiB1bmtub3duKTogRmllbGRFeHRyYWN0b3IgfCBudWxsIHtcbiAgaWYgKHJhdyA9PT0gbnVsbCB8fCB0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiBudWxsXG4gIGNvbnN0IG9iaiA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBjb25zdCBzb3VyY2UgPSBvYmouc291cmNlXG4gIGlmIChzb3VyY2UgPT09ICdmcm9tX2RvbWFpbicpIHJldHVybiB7IHNvdXJjZTogJ2Zyb21fZG9tYWluJyB9XG4gIGlmIChzb3VyY2UgPT09ICdjb25zdGFudCcpIHtcbiAgICBpZiAodHlwZW9mIG9iai52YWx1ZSAhPT0gJ3N0cmluZycpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIHsgc291cmNlOiAnY29uc3RhbnQnLCB2YWx1ZTogb2JqLnZhbHVlIH1cbiAgfVxuICBpZiAoc291cmNlID09PSAnc3ViamVjdCcgfHwgc291cmNlID09PSAndGV4dCcgfHwgc291cmNlID09PSAnaHRtbF90ZXh0Jykge1xuICAgIGlmICh0eXBlb2Ygb2JqLnJlZ2V4ICE9PSAnc3RyaW5nJyB8fCAhb2JqLnJlZ2V4KSByZXR1cm4gbnVsbFxuICAgIGlmICh0eXBlb2Ygb2JqLmdyb3VwICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcihvYmouZ3JvdXApIHx8IG9iai5ncm91cCA8IDApIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBuZXcgUmVnRXhwKG9iai5yZWdleCwgJ2knKVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gICAgcmV0dXJuIHsgc291cmNlLCByZWdleDogb2JqLnJlZ2V4LCBncm91cDogb2JqLmdyb3VwIH1cbiAgfVxuICByZXR1cm4gbnVsbFxufVxuIiwgImltcG9ydCB7IEV4dHJhY3RvclBpcGVsaW5lIH0gZnJvbSAnLi9leHRyYWN0b3IudHMnXG5pbXBvcnQgeyBUZW1wbGF0ZVNwZW5kaW5nRXh0cmFjdG9yIH0gZnJvbSAnLi9leHRyYWN0b3JzL3RlbXBsYXRlX3NwZW5kaW5nX2V4dHJhY3Rvci50cydcbmltcG9ydCB7XG4gIG1lc3NhZ2VNYXRjaGVzQW55VGVtcGxhdGUsXG4gIHR5cGUgVGVtcGxhdGVNYXRjaFNwZWMsXG59IGZyb20gJy4vdGVtcGxhdGVfbWF0Y2gudHMnXG5pbXBvcnQgdHlwZSB7XG4gIEVtYWlsTWVzc2FnZSxcbiAgRXh0cmFjdGlvbkFydGlmYWN0LFxuICBTcGVuZFBhcnNpbmdUZW1wbGF0ZSxcbn0gZnJvbSAnLi90eXBlcy50cydcblxuLyoqXG4gKiBDbGFzc2lmeSArIGV4dHJhY3Qgc3BlbmRpbmcgY2FuZGlkYXRlcyBmb3IgYSBtZXNzYWdlLlxuICpcbiAqIFJlamVjdCB0ZW1wbGF0ZXMgc2hvcnQtY2lyY3VpdCAobm8gYXJ0aWZhY3RzKS4gQXBwcm92ZSB0ZW1wbGF0ZXMgcnVuIHdpdGhcbiAqIGZpcnN0LW1hdGNoLW9ubHkuIE5vIGhldXJpc3RpYyBmYWxsYmFjayBcdTIwMTQgb25seSBhcHByb3ZlIHRlbXBsYXRlcyBwcm9kdWNlXG4gKiByZXZpZXcgaXRlbXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0U3BlbmRpbmdDYW5kaWRhdGVzKFxuICBtZXNzYWdlOiBFbWFpbE1lc3NhZ2UsXG4gIG9wdGlvbnM6IHtcbiAgICByZWplY3RUZW1wbGF0ZXM6IHJlYWRvbmx5IFRlbXBsYXRlTWF0Y2hTcGVjW11cbiAgICBhcHByb3ZlVGVtcGxhdGVzOiByZWFkb25seSBTcGVuZFBhcnNpbmdUZW1wbGF0ZVtdXG4gIH0sXG4pOiBFeHRyYWN0aW9uQXJ0aWZhY3RbXSB7XG4gIGlmIChtZXNzYWdlTWF0Y2hlc0FueVRlbXBsYXRlKG1lc3NhZ2UsIG9wdGlvbnMucmVqZWN0VGVtcGxhdGVzKSkge1xuICAgIHJldHVybiBbXVxuICB9XG4gIGlmIChvcHRpb25zLmFwcHJvdmVUZW1wbGF0ZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW11cblxuICBjb25zdCBwaXBlbGluZSA9IG5ldyBFeHRyYWN0b3JQaXBlbGluZShcbiAgICBvcHRpb25zLmFwcHJvdmVUZW1wbGF0ZXMubWFwKCh0KSA9PiBuZXcgVGVtcGxhdGVTcGVuZGluZ0V4dHJhY3Rvcih0KSksXG4gICAgeyBmaXJzdE1hdGNoT25seTogdHJ1ZSB9LFxuICApXG4gIHJldHVybiBwaXBlbGluZS5ydW4obWVzc2FnZSlcbn1cbiIsICJpbXBvcnQgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEluc2VydGFibGUsIFNlbGVjdGFibGUsIFVwZGF0ZWFibGUgfSBmcm9tICdreXNlbHknXG5cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YWJhc2Uge1xuICB1c2VyczogVXNlcnNUYWJsZVxuICBtYWlsYm94ZXM6IE1haWxib3hlc1RhYmxlXG4gIGRvbWFpbl9maWx0ZXJzOiBEb21haW5GaWx0ZXJzVGFibGVcbiAgbWVzc2FnZXM6IE1lc3NhZ2VzVGFibGVcbiAgZXh0cmFjdGlvbl9hcnRpZmFjdHM6IEV4dHJhY3Rpb25BcnRpZmFjdHNUYWJsZVxuICBzeW5jX3J1bnM6IFN5bmNSdW5zVGFibGVcbiAgcGFyc2luZ190ZW1wbGF0ZXM6IFBhcnNpbmdUZW1wbGF0ZXNUYWJsZVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1haWxib3hlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICAvKiogJ2ZpeHR1cmUnIHwgJ2dtYWlsJyAqL1xuICBwcm92aWRlcjogc3RyaW5nXG4gIGxhYmVsOiBzdHJpbmdcbiAgZW5hYmxlZDogYm9vbGVhblxuICAvKiogT3BhcXVlIHByb3ZpZGVyIHN5bmMgY3Vyc29yLiAqL1xuICBzeW5jX2N1cnNvcjogc3RyaW5nIHwgbnVsbFxuICAvKiogV2hlbiB0cnVlLCB3b3JrZXIgc2hvdWxkIHN5bmMgQVNBUC4gKi9cbiAgc3luY19yZXF1ZXN0ZWQ6IGJvb2xlYW5cbiAgLyoqIE9uZS1zaG90IGJhY2tmaWxsIHdpbmRvdyBzdGFydCAoaW5jbHVzaXZlKTsgbnVsbCA9IG9wZW4gb3IgaW5jcmVtZW50YWwuICovXG4gIHN5bmNfc2luY2U6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsIHN0cmluZyB8IG51bGw+XG4gIC8qKiBPbmUtc2hvdCBiYWNrZmlsbCB3aW5kb3cgZW5kIChpbmNsdXNpdmUpOyBudWxsID0gb3BlbiBvciBpbmNyZW1lbnRhbC4gKi9cbiAgc3luY191bnRpbDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCwgc3RyaW5nIHwgbnVsbD5cbiAgLyoqIFBhZ2UgY3Vyc29yIGZvciBhbiBpbi1wcm9ncmVzcyBiYWNrZmlsbDsgZG9lcyBub3QgcmVwbGFjZSBzeW5jX2N1cnNvci4gKi9cbiAgc3luY19iYWNrZmlsbF9jdXJzb3I6IHN0cmluZyB8IG51bGxcbiAgLyoqIEpTT046IHsgYWNjZXNzVG9rZW4sIHJlZnJlc2hUb2tlbj8sIGV4cGlyZXNBdE1zPyB9IGZvciBnbWFpbC4gKi9cbiAgb2F1dGhfdG9rZW5zX2pzb246IHN0cmluZyB8IG51bGxcbiAgbGFzdF9zeW5jZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsIHN0cmluZyB8IG51bGw+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBEb21haW5GaWx0ZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIC8qKiBEb21haW4gKGFtYXpvbi5jb20pIG9yIGZ1bGwgYWRkcmVzcyAobm9yZXBseUBhbWF6b24uY29tKS4gKi9cbiAgcGF0dGVybjogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBNZXNzYWdlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwcm92aWRlcl9tZXNzYWdlX2lkOiBzdHJpbmdcbiAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBzdHJpbmc+XG4gIGJvZHlfaGFzaDogc3RyaW5nIHwgbnVsbFxuICB0ZXh0X2JvZHk6IHN0cmluZyB8IG51bGxcbiAgaHRtbF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBFeHRyYWN0aW9uQXJ0aWZhY3RzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgbWVzc2FnZV9pZDogbnVtYmVyXG4gIGtpbmQ6IHN0cmluZ1xuICBwYXlsb2FkOiBDb2x1bW5UeXBlPHVua25vd24sIHN0cmluZyB8IHVua25vd24sIHN0cmluZyB8IHVua25vd24+XG4gIGNvbmZpZGVuY2U6IG51bWJlclxuICAvKiogJ3BlbmRpbmcnIHwgJ2FjY2VwdGVkJyB8ICdyZWplY3RlZCcgKi9cbiAgc3RhdHVzOiBzdHJpbmdcbiAgLyoqIHNwZW5kbWFuYWdlciBleHBlbnNlIGlkIGFmdGVyIGFjY2VwdCtwdWJsaXNoICovXG4gIHB1Ymxpc2hlZF9leHBlbnNlX2lkOiBudW1iZXIgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYXJzaW5nVGVtcGxhdGVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgLyoqICdhcHByb3ZlJyB8ICdyZWplY3QnICovXG4gIGtpbmQ6IHN0cmluZ1xuICBlbmFibGVkOiBib29sZWFuXG4gIG1hdGNoX2Zyb21fcGF0dGVybjogc3RyaW5nXG4gIG1hdGNoX3N1YmplY3RfcmVnZXg6IHN0cmluZyB8IG51bGxcbiAgLyoqIE51bGwgZm9yIHJlamVjdCB0ZW1wbGF0ZXMgKG1hdGNoLW9ubHkpLiAqL1xuICBleHRyYWN0b3JzOiBDb2x1bW5UeXBlPFxuICAgIHVua25vd24gfCBudWxsLFxuICAgIHN0cmluZyB8IHVua25vd24gfCBudWxsIHwgdW5kZWZpbmVkLFxuICAgIHN0cmluZyB8IHVua25vd24gfCBudWxsXG4gID5cbiAgc291cmNlX21lc3NhZ2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdmVyc2lvbjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBTeW5jUnVuc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBzdGFydGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIGZpbmlzaGVkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICBmZXRjaGVkX2NvdW50OiBudW1iZXJcbiAgZXh0cmFjdGVkX2NvdW50OiBudW1iZXJcbiAgZXJyb3JfdGV4dDogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgdHlwZSBVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTWFpbGJveCA9IFNlbGVjdGFibGU8TWFpbGJveGVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdNYWlsYm94ID0gSW5zZXJ0YWJsZTxNYWlsYm94ZXNUYWJsZT5cbmV4cG9ydCB0eXBlIERvbWFpbkZpbHRlciA9IFNlbGVjdGFibGU8RG9tYWluRmlsdGVyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTWVzc2FnZSA9IFNlbGVjdGFibGU8TWVzc2FnZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEV4dHJhY3Rpb25BcnRpZmFjdCA9IFNlbGVjdGFibGU8RXh0cmFjdGlvbkFydGlmYWN0c1RhYmxlPlxuZXhwb3J0IHR5cGUgU3luY1J1biA9IFNlbGVjdGFibGU8U3luY1J1bnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1N5bmNSdW4gPSBJbnNlcnRhYmxlPFN5bmNSdW5zVGFibGU+XG5leHBvcnQgdHlwZSBQYXJzaW5nVGVtcGxhdGUgPSBTZWxlY3RhYmxlPFBhcnNpbmdUZW1wbGF0ZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1BhcnNpbmdUZW1wbGF0ZSA9IEluc2VydGFibGU8UGFyc2luZ1RlbXBsYXRlc1RhYmxlPlxuIiwgImltcG9ydCB7IFBvb2wsIHR5cGVzIH0gZnJvbSAncGcnXG5pbXBvcnQgeyBLeXNlbHksIFBvc3RncmVzRGlhbGVjdCB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IGVudiB9IGZyb20gJy4vZW52LnRzJ1xuaW1wb3J0IHtcbiAgY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMsXG4gIHNzbEZvckRhdGFiYXNlVXJsLFxufSBmcm9tICcuL3NzbC50cydcblxuLy8gS2VlcCBQb3N0Z3JlcyBgZGF0ZWAgYXMgYFlZWVktTU0tRERgIHN0cmluZ3MuIFRoZSBkZWZhdWx0IHBnIHBhcnNlciB0dXJuc1xuLy8gdGhlbSBpbnRvIEpTIERhdGUgb2JqZWN0cywgd2hpY2ggR3JhcGhRTCB0aGVuIHN0cmluZ2lmaWVzIGFzIGZ1bGwgdGltZXN0YW1wc1xuLy8gYW5kIGJyZWFrcyBGbHV0dGVyJ3MgZGF0ZS1vbmx5IHBhcnNpbmcuXG50eXBlcy5zZXRUeXBlUGFyc2VyKHR5cGVzLmJ1aWx0aW5zLkRBVEUsICh2YWx1ZTogc3RyaW5nKSA9PiB2YWx1ZSlcblxuZXhwb3J0IHR5cGUgQ3JlYXRlS3lzZWx5T3B0aW9ucyA9IHtcbiAgLyoqIEZhbGxiYWNrIHdoZW4gYFBHREFUQUJBU0VgIC8gYERBVEFCQVNFX1VSTGAgYXJlIHVuc2V0LiAqL1xuICBkZWZhdWx0RGF0YWJhc2U6IHN0cmluZ1xufVxuXG5mdW5jdGlvbiBwb29sQ29uZmlnRnJvbUVudihcbiAgZGVmYXVsdERhdGFiYXNlOiBzdHJpbmcsXG4pOiBDb25zdHJ1Y3RvclBhcmFtZXRlcnM8dHlwZW9mIFBvb2w+WzBdIHtcbiAgY29uc3QgZGF0YWJhc2VVcmwgPSBlbnYoJ0RBVEFCQVNFX1VSTCcpXG4gIGlmIChkYXRhYmFzZVVybCkge1xuICAgIGNvbnN0IHNzbCA9IHNzbEZvckRhdGFiYXNlVXJsKGRhdGFiYXNlVXJsKVxuICAgIHJldHVybiB7XG4gICAgICBjb25uZWN0aW9uU3RyaW5nOiBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyhkYXRhYmFzZVVybCksXG4gICAgICBtYXg6IDEwLFxuICAgICAgLi4uKHNzbCA9PT0gdW5kZWZpbmVkID8ge30gOiB7IHNzbCB9KSxcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRhdGFiYXNlOiBlbnYoJ1BHREFUQUJBU0UnKSA/PyBkZWZhdWx0RGF0YWJhc2UsXG4gICAgaG9zdDogZW52KCdQR0hPU1QnKSA/PyAnbG9jYWxob3N0JyxcbiAgICB1c2VyOiBlbnYoJ1BHVVNFUicpID8/ICdwb3N0Z3JlcycsXG4gICAgcGFzc3dvcmQ6IGVudignUEdQQVNTV09SRCcpID8/ICd0ZXN0MTIzNCcsXG4gICAgcG9ydDogTnVtYmVyKGVudignUEdQT1JUJykgPz8gJzU0MzInKSxcbiAgICBtYXg6IDEwLFxuICB9XG59XG5cbi8qKiBDcmVhdGUgYSBLeXNlbHkgaW5zdGFuY2UgZm9yIHRoZSBnaXZlbiBzY2hlbWEgdHlwZSBhbmQgZGVmYXVsdCBEQiBuYW1lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUt5c2VseTxEQj4ob3B0aW9uczogQ3JlYXRlS3lzZWx5T3B0aW9ucyk6IEt5c2VseTxEQj4ge1xuICBjb25zdCBkaWFsZWN0ID0gbmV3IFBvc3RncmVzRGlhbGVjdCh7XG4gICAgcG9vbDogbmV3IFBvb2wocG9vbENvbmZpZ0Zyb21FbnYob3B0aW9ucy5kZWZhdWx0RGF0YWJhc2UpKSxcbiAgfSlcbiAgcmV0dXJuIG5ldyBLeXNlbHk8REI+KHsgZGlhbGVjdCB9KVxufVxuIiwgIi8qKiBSZWFkIGFuIGVudiB2YXIgZnJvbSBOb2RlIGBwcm9jZXNzLmVudmAgb3IgRGVubyAoUHlsb24gYnVuZGxlcyBydW4gdW5kZXIgTm9kZSkuICovXG5leHBvcnQgZnVuY3Rpb24gZW52KG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LltuYW1lXSkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltuYW1lXVxuICB9XG4gIGlmICh0eXBlb2YgRGVubyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIERlbm8uZW52Py5nZXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gRGVuby5lbnYuZ2V0KG5hbWUpXG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZFxufVxuIiwgIi8qKiBUTFMgb3B0aW9ucyBmb3IgYHBnYCBmcm9tIGEgUG9zdGdyZXMgVVJMLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNzbEZvckRhdGFiYXNlVXJsKFxuICBkYXRhYmFzZVVybDogc3RyaW5nLFxuKTogZmFsc2UgfCB7IHJlamVjdFVuYXV0aG9yaXplZDogYm9vbGVhbiB9IHwgdW5kZWZpbmVkIHtcbiAgbGV0IHVybDogVVJMXG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTChkYXRhYmFzZVVybClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgY29uc3QgbW9kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCdzc2xtb2RlJyk/LnRvTG93ZXJDYXNlKClcbiAgaWYgKG1vZGUgPT09ICdkaXNhYmxlJykgcmV0dXJuIGZhbHNlXG4gIGlmIChtb2RlID09PSAncmVxdWlyZScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1jYScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1mdWxsJykge1xuICAgIHJldHVybiB7IHJlamVjdFVuYXV0aG9yaXplZDogZmFsc2UgfVxuICB9XG5cbiAgY29uc3QgaG9zdCA9IHVybC5ob3N0bmFtZVxuICBpZiAoaG9zdCA9PT0gJ2xvY2FsaG9zdCcgfHwgaG9zdCA9PT0gJzEyNy4wLjAuMScpIHJldHVybiB1bmRlZmluZWRcblxuICByZXR1cm4geyByZWplY3RVbmF1dGhvcml6ZWQ6IGZhbHNlIH1cbn1cblxuLyoqXG4gKiBTdHJpcCBTU0wgcXVlcnkgcGFyYW1zIGZyb20gYSBQb3N0Z3JlcyBVUkwgYmVmb3JlIHBhc3NpbmcgaXQgdG8gYHBnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zKGRhdGFiYXNlVXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoZGF0YWJhc2VVcmwpXG4gICAgZm9yIChjb25zdCBrZXkgb2YgW1xuICAgICAgJ3NzbG1vZGUnLFxuICAgICAgJ3NzbCcsXG4gICAgICAnc3Nscm9vdGNlcnQnLFxuICAgICAgJ3NzbGNlcnQnLFxuICAgICAgJ3NzbGtleScsXG4gICAgXSkge1xuICAgICAgdXJsLnNlYXJjaFBhcmFtcy5kZWxldGUoa2V5KVxuICAgIH1cbiAgICByZXR1cm4gdXJsLnRvU3RyaW5nKClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGRhdGFiYXNlVXJsXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBEYXRhYmFzZSB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3JlYXRlS3lzZWx5IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2NyZWF0ZV9reXNlbHkudHMnXG5cbmV4cG9ydCB7IGVudiB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMnXG5cbmV4cG9ydCBjb25zdCBkYiA9IGNyZWF0ZUt5c2VseTxEYXRhYmFzZT4oe1xuICBkZWZhdWx0RGF0YWJhc2U6ICdtYWlsYm94Jyxcbn0pXG4iLCAiaW1wb3J0IHsgZW52IGFzIHJlYWRFbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvZW52LnRzJ1xuXG5leHBvcnQgdHlwZSBHZW5lcmF0ZVRlbXBsYXRlQWlJbnB1dCA9IHtcbiAgZnJvbTogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICB0ZXh0Qm9keT86IHN0cmluZyB8IG51bGxcbiAgaHRtbEJvZHk/OiBzdHJpbmcgfCBudWxsXG4gIGhpbnRzPzogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgdHlwZSBHZW5lcmF0ZUFwcHJvdmVUZW1wbGF0ZUFpT3V0cHV0ID0ge1xuICBtYXRjaEZyb21QYXR0ZXJuOiBzdHJpbmdcbiAgbWF0Y2hTdWJqZWN0UmVnZXg6IHN0cmluZyB8IG51bGxcbiAgZXh0cmFjdG9yczogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgbmFtZVN1Z2dlc3Rpb246IHN0cmluZ1xufVxuXG5leHBvcnQgdHlwZSBHZW5lcmF0ZVJlamVjdFRlbXBsYXRlQWlPdXRwdXQgPSB7XG4gIG1hdGNoRnJvbVBhdHRlcm46IHN0cmluZ1xuICBtYXRjaFN1YmplY3RSZWdleDogc3RyaW5nIHwgbnVsbFxuICBuYW1lU3VnZ2VzdGlvbjogc3RyaW5nXG59XG5cbi8qKiBAZGVwcmVjYXRlZCBQcmVmZXIgR2VuZXJhdGVBcHByb3ZlVGVtcGxhdGVBaU91dHB1dCAqL1xuZXhwb3J0IHR5cGUgR2VuZXJhdGVUZW1wbGF0ZUFpT3V0cHV0ID0gR2VuZXJhdGVBcHByb3ZlVGVtcGxhdGVBaU91dHB1dFxuXG5leHBvcnQgY2xhc3MgQWlDbGllbnRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnQWlDbGllbnRFcnJvcidcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBydW5BaVVzZUNhc2U8VD4oXG4gIHVzZUNhc2VJZDogc3RyaW5nLFxuICBpbnB1dDogR2VuZXJhdGVUZW1wbGF0ZUFpSW5wdXQsXG4gIG9wdGlvbnM/OiB7XG4gICAgYmFzZVVybD86IHN0cmluZ1xuICAgIHNlcnZpY2VLZXk/OiBzdHJpbmdcbiAgICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2hcbiAgfSxcbik6IFByb21pc2U8VD4ge1xuICBjb25zdCBiYXNlVXJsID0gKG9wdGlvbnM/LmJhc2VVcmwgPz9cbiAgICByZWFkRW52KCdBSV9BUElfQkFTRV9VUkwnKSA/P1xuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDQnKS5yZXBsYWNlKC9cXC8kLywgJycpXG4gIGNvbnN0IHNlcnZpY2VLZXkgPSBvcHRpb25zPy5zZXJ2aWNlS2V5ID8/IHJlYWRFbnYoJ0FJX1NFUlZJQ0VfS0VZJylcbiAgaWYgKCFzZXJ2aWNlS2V5KSB7XG4gICAgdGhyb3cgbmV3IEFpQ2xpZW50RXJyb3IoJ0FJX1NFUlZJQ0VfS0VZIGlzIG5vdCBjb25maWd1cmVkJylcbiAgfVxuXG4gIGNvbnN0IGZldGNoSW1wbCA9IG9wdGlvbnM/LmZldGNoSW1wbCA/PyBmZXRjaFxuICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaEltcGwoXG4gICAgYCR7YmFzZVVybH0vdjEvdXNlLWNhc2VzLyR7dXNlQ2FzZUlkfS9ydW5gLFxuICAgIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c2VydmljZUtleX1gLFxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBmcm9tOiBpbnB1dC5mcm9tLFxuICAgICAgICAgIHN1YmplY3Q6IGlucHV0LnN1YmplY3QsXG4gICAgICAgICAgdGV4dEJvZHk6IGlucHV0LnRleHRCb2R5ID8/IHVuZGVmaW5lZCxcbiAgICAgICAgICBodG1sQm9keTogaW5wdXQuaHRtbEJvZHkgPz8gdW5kZWZpbmVkLFxuICAgICAgICAgIGhpbnRzOiBpbnB1dC5oaW50cyA/PyB1bmRlZmluZWQsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9LFxuICApXG5cbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKS5jYXRjaCgoKSA9PiAnJylcbiAgICB0aHJvdyBuZXcgQWlDbGllbnRFcnJvcihcbiAgICAgIGBhaS1hcGkgZXJyb3IgJHtyZXMuc3RhdHVzfTogJHt0ZXh0LnNsaWNlKDAsIDMwMCl9YCxcbiAgICApXG4gIH1cblxuICBjb25zdCBib2R5ID0gYXdhaXQgcmVzLmpzb24oKSBhcyB7IG91dHB1dD86IFQgfVxuICBpZiAoIWJvZHkub3V0cHV0KSB7XG4gICAgdGhyb3cgbmV3IEFpQ2xpZW50RXJyb3IoJ2FpLWFwaSByZXNwb25zZSBtaXNzaW5nIG91dHB1dCcpXG4gIH1cbiAgcmV0dXJuIGJvZHkub3V0cHV0XG59XG5cbi8qKlxuICogQ2FsbCBhaS1hcGkgZ2VuZXJhdGVfZW1haWxfc3BlbmRfdGVtcGxhdGUgdXNlIGNhc2UuXG4gKiBPdmVycmlkYWJsZSBmZXRjaCBmb3IgdGVzdHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUVtYWlsU3BlbmRUZW1wbGF0ZShcbiAgaW5wdXQ6IEdlbmVyYXRlVGVtcGxhdGVBaUlucHV0LFxuICBvcHRpb25zPzoge1xuICAgIGJhc2VVcmw/OiBzdHJpbmdcbiAgICBzZXJ2aWNlS2V5Pzogc3RyaW5nXG4gICAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoXG4gIH0sXG4pOiBQcm9taXNlPEdlbmVyYXRlQXBwcm92ZVRlbXBsYXRlQWlPdXRwdXQ+IHtcbiAgcmV0dXJuIGF3YWl0IHJ1bkFpVXNlQ2FzZTxHZW5lcmF0ZUFwcHJvdmVUZW1wbGF0ZUFpT3V0cHV0PihcbiAgICAnZ2VuZXJhdGVfZW1haWxfc3BlbmRfdGVtcGxhdGUnLFxuICAgIGlucHV0LFxuICAgIG9wdGlvbnMsXG4gIClcbn1cblxuLyoqXG4gKiBDYWxsIGFpLWFwaSBnZW5lcmF0ZV9lbWFpbF9yZWplY3RfdGVtcGxhdGUgdXNlIGNhc2UuXG4gKiBPdmVycmlkYWJsZSBmZXRjaCBmb3IgdGVzdHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUVtYWlsUmVqZWN0VGVtcGxhdGUoXG4gIGlucHV0OiBHZW5lcmF0ZVRlbXBsYXRlQWlJbnB1dCxcbiAgb3B0aW9ucz86IHtcbiAgICBiYXNlVXJsPzogc3RyaW5nXG4gICAgc2VydmljZUtleT86IHN0cmluZ1xuICAgIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaFxuICB9LFxuKTogUHJvbWlzZTxHZW5lcmF0ZVJlamVjdFRlbXBsYXRlQWlPdXRwdXQ+IHtcbiAgcmV0dXJuIGF3YWl0IHJ1bkFpVXNlQ2FzZTxHZW5lcmF0ZVJlamVjdFRlbXBsYXRlQWlPdXRwdXQ+KFxuICAgICdnZW5lcmF0ZV9lbWFpbF9yZWplY3RfdGVtcGxhdGUnLFxuICAgIGlucHV0LFxuICAgIG9wdGlvbnMsXG4gIClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7XG4gIFNQRU5ESU5HX0NBTkRJREFURV9LSU5ELFxuICBleHRyYWN0U3BlbmRpbmdDYW5kaWRhdGVzLFxuICBtZXNzYWdlTWF0Y2hlc0FueVRlbXBsYXRlLFxuICBwYXJzZVNwZW5kVGVtcGxhdGVFeHRyYWN0b3JzLFxuICByZXNvbHZlVGV4dEJvZHksXG4gIHR5cGUgRW1haWxNZXNzYWdlLFxuICB0eXBlIEV4dHJhY3Rpb25BcnRpZmFjdCxcbiAgdHlwZSBTcGVuZFBhcnNpbmdUZW1wbGF0ZSxcbiAgdHlwZSBUZW1wbGF0ZU1hdGNoU3BlYyxcbn0gZnJvbSAnbWFpbGJveF9raXQvbW9kLnRzJ1xuaW1wb3J0IHR5cGUgeyBEYXRhYmFzZSB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgQXBwbHlUZW1wbGF0ZXNTdG9yZSA9IHtcbiAgbGlzdEVuYWJsZWRUZW1wbGF0ZXMobWFpbGJveElkOiBudW1iZXIpOiBQcm9taXNlPFxuICAgIEFycmF5PHtcbiAgICAgIGlkOiBudW1iZXJcbiAgICAgIGtpbmQ6IHN0cmluZ1xuICAgICAgZW5hYmxlZDogYm9vbGVhblxuICAgICAgbWF0Y2hfZnJvbV9wYXR0ZXJuOiBzdHJpbmdcbiAgICAgIG1hdGNoX3N1YmplY3RfcmVnZXg6IHN0cmluZyB8IG51bGxcbiAgICAgIGV4dHJhY3RvcnM6IHVua25vd25cbiAgICB9PlxuICA+XG4gIGxpc3RNZXNzYWdlcyhtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8XG4gICAgQXJyYXk8e1xuICAgICAgaWQ6IG51bWJlclxuICAgICAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gICAgICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gICAgICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICAgICAgc3ViamVjdDogc3RyaW5nXG4gICAgICByZWNlaXZlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICAgICAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gICAgICBodG1sX2JvZHk6IHN0cmluZyB8IG51bGxcbiAgICB9PlxuICA+XG4gIGxpc3RBcnRpZmFjdFN0YXR1c2VzKG1lc3NhZ2VJZHM6IG51bWJlcltdKTogUHJvbWlzZTxcbiAgICBBcnJheTx7IG1lc3NhZ2VfaWQ6IG51bWJlcjsgc3RhdHVzOiBzdHJpbmcgfT5cbiAgPlxuICByZWplY3RQZW5kaW5nRm9yTWVzc2FnZXMoXG4gICAgbWVzc2FnZUlkczogbnVtYmVyW10sXG4gICAgdXBkYXRlZEF0OiBzdHJpbmcsXG4gICk6IFByb21pc2U8bnVtYmVyPlxuICBpbnNlcnRBcnRpZmFjdChcbiAgICBtZXNzYWdlSWQ6IG51bWJlcixcbiAgICBhcnQ6IEV4dHJhY3Rpb25BcnRpZmFjdCxcbiAgICBub3c6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPlxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlS3lzZWx5QXBwbHlUZW1wbGF0ZXNTdG9yZShcbiAgZGI6IEt5c2VseTxEYXRhYmFzZT4sXG4pOiBBcHBseVRlbXBsYXRlc1N0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBhc3luYyBsaXN0RW5hYmxlZFRlbXBsYXRlcyhtYWlsYm94SWQpIHtcbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgncGFyc2luZ190ZW1wbGF0ZXMnKVxuICAgICAgICAuc2VsZWN0KFtcbiAgICAgICAgICAnaWQnLFxuICAgICAgICAgICdraW5kJyxcbiAgICAgICAgICAnZW5hYmxlZCcsXG4gICAgICAgICAgJ21hdGNoX2Zyb21fcGF0dGVybicsXG4gICAgICAgICAgJ21hdGNoX3N1YmplY3RfcmVnZXgnLFxuICAgICAgICAgICdleHRyYWN0b3JzJyxcbiAgICAgICAgXSlcbiAgICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAgIC53aGVyZSgnZW5hYmxlZCcsICc9JywgdHJ1ZSlcbiAgICAgICAgLm9yZGVyQnkoJ2lkJywgJ2FzYycpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICB9LFxuICAgIGFzeW5jIGxpc3RNZXNzYWdlcyhtYWlsYm94SWQpIHtcbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnbWVzc2FnZXMnKVxuICAgICAgICAuc2VsZWN0KFtcbiAgICAgICAgICAnaWQnLFxuICAgICAgICAgICdwcm92aWRlcl9tZXNzYWdlX2lkJyxcbiAgICAgICAgICAncmZjX21lc3NhZ2VfaWQnLFxuICAgICAgICAgICdmcm9tX2FkZHJlc3MnLFxuICAgICAgICAgICdzdWJqZWN0JyxcbiAgICAgICAgICAncmVjZWl2ZWRfYXQnLFxuICAgICAgICAgICd0ZXh0X2JvZHknLFxuICAgICAgICAgICdodG1sX2JvZHknLFxuICAgICAgICBdKVxuICAgICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgIH0sXG4gICAgYXN5bmMgbGlzdEFydGlmYWN0U3RhdHVzZXMobWVzc2FnZUlkcykge1xuICAgICAgaWYgKG1lc3NhZ2VJZHMubGVuZ3RoID09PSAwKSByZXR1cm4gW11cbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMnKVxuICAgICAgICAuc2VsZWN0KFsnbWVzc2FnZV9pZCcsICdzdGF0dXMnXSlcbiAgICAgICAgLndoZXJlKCdtZXNzYWdlX2lkJywgJ2luJywgbWVzc2FnZUlkcylcbiAgICAgICAgLndoZXJlKCdraW5kJywgJz0nLCBTUEVORElOR19DQU5ESURBVEVfS0lORClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgIH0sXG4gICAgYXN5bmMgcmVqZWN0UGVuZGluZ0Zvck1lc3NhZ2VzKG1lc3NhZ2VJZHMsIHVwZGF0ZWRBdCkge1xuICAgICAgaWYgKG1lc3NhZ2VJZHMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXM6ICdyZWplY3RlZCcsIHVwZGF0ZWRfYXQ6IHVwZGF0ZWRBdCB9KVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ3BlbmRpbmcnKVxuICAgICAgICAud2hlcmUoJ2tpbmQnLCAnPScsIFNQRU5ESU5HX0NBTkRJREFURV9LSU5EKVxuICAgICAgICAud2hlcmUoJ21lc3NhZ2VfaWQnLCAnaW4nLCBtZXNzYWdlSWRzKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICByZXR1cm4gTnVtYmVyKHJlc3VsdC5udW1VcGRhdGVkUm93cyA/PyAwKVxuICAgIH0sXG4gICAgYXN5bmMgaW5zZXJ0QXJ0aWZhY3QobWVzc2FnZUlkLCBhcnQsIG5vdykge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgbWVzc2FnZV9pZDogbWVzc2FnZUlkLFxuICAgICAgICAgIGtpbmQ6IGFydC5raW5kLFxuICAgICAgICAgIHBheWxvYWQ6IGFydC5wYXlsb2FkLFxuICAgICAgICAgIGNvbmZpZGVuY2U6IGFydC5jb25maWRlbmNlLFxuICAgICAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxuICAgICAgICAgIHB1Ymxpc2hlZF9leHBlbnNlX2lkOiBudWxsLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0pXG4gICAgICAgIC5leGVjdXRlKClcbiAgICB9LFxuICB9XG59XG5cbmV4cG9ydCB0eXBlIEFwcGx5VGVtcGxhdGVzUmVzdWx0ID0ge1xuICByZWplY3RlZFBlbmRpbmc6IG51bWJlclxuICBpbnNlcnRlZEFydGlmYWN0czogbnVtYmVyXG59XG5cbi8qKlxuICogUmUtYXBwbHkgZW5hYmxlZCB0ZW1wbGF0ZXMgdG8gYWxsIHN0b3JlZCBtZXNzYWdlcyBpbiBhIG1haWxib3guXG4gKiBSZWplY3QgbWF0Y2hlcyBkcm9wIHBlbmRpbmcgY2FuZGlkYXRlczsgYXBwcm92ZSBtYXRjaGVzIGluc2VydCBwZW5kaW5nXG4gKiBjYW5kaWRhdGVzIHdoZW4gdGhlIG1lc3NhZ2UgaGFzIG5vIHBlbmRpbmcvYWNjZXB0ZWQgc3BlbmRpbmcgYXJ0aWZhY3QgeWV0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXBwbHlUZW1wbGF0ZXNUb01haWxib3goXG4gIHN0b3JlOiBBcHBseVRlbXBsYXRlc1N0b3JlLFxuICBtYWlsYm94SWQ6IG51bWJlcixcbiAgbm93OiBzdHJpbmcgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4pOiBQcm9taXNlPEFwcGx5VGVtcGxhdGVzUmVzdWx0PiB7XG4gIGNvbnN0IHJvd3MgPSBhd2FpdCBzdG9yZS5saXN0RW5hYmxlZFRlbXBsYXRlcyhtYWlsYm94SWQpXG4gIGNvbnN0IHJlamVjdFRlbXBsYXRlczogVGVtcGxhdGVNYXRjaFNwZWNbXSA9IFtdXG4gIGNvbnN0IGFwcHJvdmVUZW1wbGF0ZXM6IFNwZW5kUGFyc2luZ1RlbXBsYXRlW10gPSBbXVxuXG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBtYXRjaDogVGVtcGxhdGVNYXRjaFNwZWMgPSB7XG4gICAgICBtYXRjaEZyb21QYXR0ZXJuOiByb3cubWF0Y2hfZnJvbV9wYXR0ZXJuLFxuICAgICAgbWF0Y2hTdWJqZWN0UmVnZXg6IHJvdy5tYXRjaF9zdWJqZWN0X3JlZ2V4LFxuICAgICAgZW5hYmxlZDogcm93LmVuYWJsZWQsXG4gICAgfVxuICAgIGlmIChyb3cua2luZCA9PT0gJ3JlamVjdCcpIHtcbiAgICAgIHJlamVjdFRlbXBsYXRlcy5wdXNoKG1hdGNoKVxuICAgICAgY29udGludWVcbiAgICB9XG4gICAgY29uc3QgZXh0cmFjdG9ycyA9IHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMocm93LmV4dHJhY3RvcnMpXG4gICAgaWYgKCFleHRyYWN0b3JzKSBjb250aW51ZVxuICAgIGFwcHJvdmVUZW1wbGF0ZXMucHVzaCh7XG4gICAgICBpZDogcm93LmlkLFxuICAgICAgbWF0Y2hGcm9tUGF0dGVybjogcm93Lm1hdGNoX2Zyb21fcGF0dGVybixcbiAgICAgIG1hdGNoU3ViamVjdFJlZ2V4OiByb3cubWF0Y2hfc3ViamVjdF9yZWdleCxcbiAgICAgIGV4dHJhY3RvcnMsXG4gICAgICBlbmFibGVkOiByb3cuZW5hYmxlZCxcbiAgICB9KVxuICB9XG5cbiAgY29uc3QgbWVzc2FnZXMgPSBhd2FpdCBzdG9yZS5saXN0TWVzc2FnZXMobWFpbGJveElkKVxuICBpZiAobWVzc2FnZXMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIHsgcmVqZWN0ZWRQZW5kaW5nOiAwLCBpbnNlcnRlZEFydGlmYWN0czogMCB9XG4gIH1cblxuICBjb25zdCBzdGF0dXNlcyA9IGF3YWl0IHN0b3JlLmxpc3RBcnRpZmFjdFN0YXR1c2VzKG1lc3NhZ2VzLm1hcCgobSkgPT4gbS5pZCkpXG4gIGNvbnN0IHN0YXR1c0J5TWVzc2FnZSA9IG5ldyBNYXA8bnVtYmVyLCBTZXQ8c3RyaW5nPj4oKVxuICBmb3IgKGNvbnN0IHMgb2Ygc3RhdHVzZXMpIHtcbiAgICBsZXQgc2V0ID0gc3RhdHVzQnlNZXNzYWdlLmdldChzLm1lc3NhZ2VfaWQpXG4gICAgaWYgKCFzZXQpIHtcbiAgICAgIHNldCA9IG5ldyBTZXQoKVxuICAgICAgc3RhdHVzQnlNZXNzYWdlLnNldChzLm1lc3NhZ2VfaWQsIHNldClcbiAgICB9XG4gICAgc2V0LmFkZChzLnN0YXR1cylcbiAgfVxuXG4gIGNvbnN0IHJlamVjdE1lc3NhZ2VJZHM6IG51bWJlcltdID0gW11cbiAgbGV0IGluc2VydGVkQXJ0aWZhY3RzID0gMFxuXG4gIGZvciAoY29uc3Qgcm93IG9mIG1lc3NhZ2VzKSB7XG4gICAgY29uc3QgZW1haWwgPSByb3dUb0VtYWlsTWVzc2FnZShyb3cpXG4gICAgaWYgKG1lc3NhZ2VNYXRjaGVzQW55VGVtcGxhdGUoZW1haWwsIHJlamVjdFRlbXBsYXRlcykpIHtcbiAgICAgIHJlamVjdE1lc3NhZ2VJZHMucHVzaChyb3cuaWQpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nID0gc3RhdHVzQnlNZXNzYWdlLmdldChyb3cuaWQpXG4gICAgaWYgKGV4aXN0aW5nPy5oYXMoJ3BlbmRpbmcnKSB8fCBleGlzdGluZz8uaGFzKCdhY2NlcHRlZCcpKSBjb250aW51ZVxuXG4gICAgY29uc3QgYXJ0cyA9IGV4dHJhY3RTcGVuZGluZ0NhbmRpZGF0ZXMoZW1haWwsIHtcbiAgICAgIHJlamVjdFRlbXBsYXRlczogW10sXG4gICAgICBhcHByb3ZlVGVtcGxhdGVzLFxuICAgIH0pXG4gICAgZm9yIChjb25zdCBhcnQgb2YgYXJ0cykge1xuICAgICAgYXdhaXQgc3RvcmUuaW5zZXJ0QXJ0aWZhY3Qocm93LmlkLCBhcnQsIG5vdylcbiAgICAgIGluc2VydGVkQXJ0aWZhY3RzICs9IDFcbiAgICB9XG4gIH1cblxuICBjb25zdCByZWplY3RlZFBlbmRpbmcgPSBhd2FpdCBzdG9yZS5yZWplY3RQZW5kaW5nRm9yTWVzc2FnZXMoXG4gICAgcmVqZWN0TWVzc2FnZUlkcyxcbiAgICBub3csXG4gIClcblxuICByZXR1cm4geyByZWplY3RlZFBlbmRpbmcsIGluc2VydGVkQXJ0aWZhY3RzIH1cbn1cblxuZnVuY3Rpb24gcm93VG9FbWFpbE1lc3NhZ2Uocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHRleHRfYm9keTogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk6IHN0cmluZyB8IG51bGxcbn0pOiBFbWFpbE1lc3NhZ2Uge1xuICBjb25zdCByZWNlaXZlZEF0ID0gcm93LnJlY2VpdmVkX2F0IGluc3RhbmNlb2YgRGF0ZVxuICAgID8gcm93LnJlY2VpdmVkX2F0XG4gICAgOiBuZXcgRGF0ZShyb3cucmVjZWl2ZWRfYXQpXG4gIGNvbnN0IHRleHRCb2R5ID0gcmVzb2x2ZVRleHRCb2R5KHJvdy50ZXh0X2JvZHksIHJvdy5odG1sX2JvZHkpXG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5wcm92aWRlcl9tZXNzYWdlX2lkLFxuICAgIHJmY01lc3NhZ2VJZDogcm93LnJmY19tZXNzYWdlX2lkLFxuICAgIGZyb206IHJvdy5mcm9tX2FkZHJlc3MsXG4gICAgc3ViamVjdDogcm93LnN1YmplY3QsXG4gICAgcmVjZWl2ZWRBdCxcbiAgICB0ZXh0Qm9keSxcbiAgICBodG1sQm9keTogcm93Lmh0bWxfYm9keSxcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5IH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBEYXRhYmFzZSwgTWFpbGJveGVzVGFibGUgfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgdHlwZSB7IFNlbGVjdGFibGUgfSBmcm9tICdreXNlbHknXG5cbmV4cG9ydCB0eXBlIE1haWxib3hSb3cgPSBTZWxlY3RhYmxlPE1haWxib3hlc1RhYmxlPlxuXG4vKiogTWluaW1hbCBzdG9yZSBzbyBjbGVhciAvIHJlamVjdC1hbGwgY2FuIGJlIHVuaXQtdGVzdGVkIHdpdGhvdXQgUG9zdGdyZXMuICovXG5leHBvcnQgdHlwZSBJbmJveE9wc1N0b3JlID0ge1xuICBkZWxldGVNZXNzYWdlcyhtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8bnVtYmVyPlxuICBkZWxldGVTeW5jUnVucyhtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8bnVtYmVyPlxuICByZXNldE1haWxib3hTeW5jU3RhdGUoXG4gICAgbWFpbGJveElkOiBudW1iZXIsXG4gICAgdXBkYXRlZEF0OiBzdHJpbmcsXG4gICk6IFByb21pc2U8TWFpbGJveFJvdz5cbiAgcmVqZWN0UGVuZGluZ0FydGlmYWN0cyhcbiAgICBtYWlsYm94SWQ6IG51bWJlcixcbiAgICB1cGRhdGVkQXQ6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxudW1iZXI+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVLeXNlbHlJbmJveE9wc1N0b3JlKFxuICBkYjogS3lzZWx5PERhdGFiYXNlPixcbik6IEluYm94T3BzU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGFzeW5jIGRlbGV0ZU1lc3NhZ2VzKG1haWxib3hJZCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgICAgLmRlbGV0ZUZyb20oJ21lc3NhZ2VzJylcbiAgICAgICAgLndoZXJlKCdtYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIHJldHVybiBOdW1iZXIocmVzdWx0Lm51bURlbGV0ZWRSb3dzID8/IDApXG4gICAgfSxcbiAgICBhc3luYyBkZWxldGVTeW5jUnVucyhtYWlsYm94SWQpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAgIC5kZWxldGVGcm9tKCdzeW5jX3J1bnMnKVxuICAgICAgICAud2hlcmUoJ21haWxib3hfaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgcmV0dXJuIE51bWJlcihyZXN1bHQubnVtRGVsZXRlZFJvd3MgPz8gMClcbiAgICB9LFxuICAgIGFzeW5jIHJlc2V0TWFpbGJveFN5bmNTdGF0ZShtYWlsYm94SWQsIHVwZGF0ZWRBdCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnbWFpbGJveGVzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgc3luY19jdXJzb3I6IG51bGwsXG4gICAgICAgICAgc3luY19iYWNrZmlsbF9jdXJzb3I6IG51bGwsXG4gICAgICAgICAgc3luY19zaW5jZTogbnVsbCxcbiAgICAgICAgICBzeW5jX3VudGlsOiBudWxsLFxuICAgICAgICAgIHN5bmNfcmVxdWVzdGVkOiBmYWxzZSxcbiAgICAgICAgICBsYXN0X3N5bmNlZF9hdDogbnVsbCxcbiAgICAgICAgICB1cGRhdGVkX2F0OiB1cGRhdGVkQXQsXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIG1haWxib3hJZClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgfSxcbiAgICBhc3luYyByZWplY3RQZW5kaW5nQXJ0aWZhY3RzKG1haWxib3hJZCwgdXBkYXRlZEF0KSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgLnNldCh7IHN0YXR1czogJ3JlamVjdGVkJywgdXBkYXRlZF9hdDogdXBkYXRlZEF0IH0pXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAncGVuZGluZycpXG4gICAgICAgIC53aGVyZShcbiAgICAgICAgICAnbWVzc2FnZV9pZCcsXG4gICAgICAgICAgJ2luJyxcbiAgICAgICAgICBkYlxuICAgICAgICAgICAgLnNlbGVjdEZyb20oJ21lc3NhZ2VzJylcbiAgICAgICAgICAgIC5zZWxlY3QoJ2lkJylcbiAgICAgICAgICAgIC53aGVyZSgnbWFpbGJveF9pZCcsICc9JywgbWFpbGJveElkKSxcbiAgICAgICAgKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICByZXR1cm4gTnVtYmVyKHJlc3VsdC5udW1VcGRhdGVkUm93cyA/PyAwKVxuICAgIH0sXG4gIH1cbn1cblxuLyoqXG4gKiBXaXBlIHN5bmNlZCBtZXNzYWdlcyAoYXJ0aWZhY3RzIGNhc2NhZGUpLCBzeW5jIHJ1bnMsIGFuZCByZXNldCBzeW5jIGN1cnNvcnMuXG4gKiBEb2VzIG5vdCByZW1vdmUgZG9tYWluIGZpbHRlcnMsIHBhcnNpbmcgdGVtcGxhdGVzLCBvciB0aGUgbWFpbGJveCBpdHNlbGYuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjbGVhckluYm94RGF0YShcbiAgc3RvcmU6IEluYm94T3BzU3RvcmUsXG4gIG1haWxib3hJZDogbnVtYmVyLFxuICBub3c6IHN0cmluZyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbik6IFByb21pc2U8TWFpbGJveFJvdz4ge1xuICBhd2FpdCBzdG9yZS5kZWxldGVNZXNzYWdlcyhtYWlsYm94SWQpXG4gIGF3YWl0IHN0b3JlLmRlbGV0ZVN5bmNSdW5zKG1haWxib3hJZClcbiAgcmV0dXJuIGF3YWl0IHN0b3JlLnJlc2V0TWFpbGJveFN5bmNTdGF0ZShtYWlsYm94SWQsIG5vdylcbn1cblxuLyoqIFJlamVjdCBhbGwgcGVuZGluZyBleHRyYWN0aW9uIGFydGlmYWN0cyBmb3IgYSBtYWlsYm94LiBSZXR1cm5zIHVwZGF0ZWQgY291bnQuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVqZWN0QWxsUGVuZGluZ0FydGlmYWN0cyhcbiAgc3RvcmU6IEluYm94T3BzU3RvcmUsXG4gIG1haWxib3hJZDogbnVtYmVyLFxuICBub3c6IHN0cmluZyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbik6IFByb21pc2U8bnVtYmVyPiB7XG4gIHJldHVybiBhd2FpdCBzdG9yZS5yZWplY3RQZW5kaW5nQXJ0aWZhY3RzKG1haWxib3hJZCwgbm93KVxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5IH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHtcbiAgU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQsXG4gIFRlbXBsYXRlU3BlbmRpbmdFeHRyYWN0b3IsXG4gIHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMsXG4gIHJlc29sdmVUZXh0Qm9keSxcbiAgdHlwZSBFbWFpbE1lc3NhZ2UsXG4gIHR5cGUgU3BlbmRQYXJzaW5nVGVtcGxhdGUsXG4gIHR5cGUgU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnMsXG59IGZyb20gJ21haWxib3hfa2l0L21vZC50cydcbmltcG9ydCB0eXBlIHsgRGF0YWJhc2UgfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbi8qKiBUZW1wbGF0ZSBmaWVsZHMgbmVlZGVkIHRvIHJlLWV4dHJhY3QgcGVuZGluZyByZXZpZXcgYXJ0aWZhY3RzLiAqL1xuZXhwb3J0IHR5cGUgUmVldmFsdWF0ZVRlbXBsYXRlSW5wdXQgPSB7XG4gIGlkOiBudW1iZXJcbiAgbWFpbGJveF9pZDogbnVtYmVyXG4gIGtpbmQ6IHN0cmluZ1xuICBlbmFibGVkOiBib29sZWFuXG4gIG1hdGNoX2Zyb21fcGF0dGVybjogc3RyaW5nXG4gIG1hdGNoX3N1YmplY3RfcmVnZXg6IHN0cmluZyB8IG51bGxcbiAgZXh0cmFjdG9yczogdW5rbm93blxufVxuXG5leHBvcnQgdHlwZSBQZW5kaW5nQXJ0aWZhY3RSb3cgPSB7XG4gIGFydGlmYWN0X2lkOiBudW1iZXJcbiAgbWVzc2FnZV9pZDogbnVtYmVyXG4gIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICByZmNfbWVzc2FnZV9pZDogc3RyaW5nXG4gIGZyb21fYWRkcmVzczogc3RyaW5nXG4gIHN1YmplY3Q6IHN0cmluZ1xuICByZWNlaXZlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB0ZXh0X2JvZHk6IHN0cmluZyB8IG51bGxcbiAgaHRtbF9ib2R5OiBzdHJpbmcgfCBudWxsXG59XG5cbmV4cG9ydCB0eXBlIFRlbXBsYXRlUmVldmFsdWF0ZVN0b3JlID0ge1xuICBsaXN0UGVuZGluZ0FydGlmYWN0cyhtYWlsYm94SWQ6IG51bWJlcik6IFByb21pc2U8UGVuZGluZ0FydGlmYWN0Um93W10+XG4gIHVwZGF0ZUFydGlmYWN0KFxuICAgIGFydGlmYWN0SWQ6IG51bWJlcixcbiAgICBwYXlsb2FkOiB1bmtub3duLFxuICAgIGNvbmZpZGVuY2U6IG51bWJlcixcbiAgICB1cGRhdGVkQXQ6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPlxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlS3lzZWx5VGVtcGxhdGVSZWV2YWx1YXRlU3RvcmUoXG4gIGRiOiBLeXNlbHk8RGF0YWJhc2U+LFxuKTogVGVtcGxhdGVSZWV2YWx1YXRlU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGFzeW5jIGxpc3RQZW5kaW5nQXJ0aWZhY3RzKG1haWxib3hJZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5pbm5lckpvaW4oXG4gICAgICAgICAgJ21lc3NhZ2VzJyxcbiAgICAgICAgICAnbWVzc2FnZXMuaWQnLFxuICAgICAgICAgICdleHRyYWN0aW9uX2FydGlmYWN0cy5tZXNzYWdlX2lkJyxcbiAgICAgICAgKVxuICAgICAgICAuc2VsZWN0KFtcbiAgICAgICAgICAnZXh0cmFjdGlvbl9hcnRpZmFjdHMuaWQgYXMgYXJ0aWZhY3RfaWQnLFxuICAgICAgICAgICdtZXNzYWdlcy5pZCBhcyBtZXNzYWdlX2lkJyxcbiAgICAgICAgICAnbWVzc2FnZXMucHJvdmlkZXJfbWVzc2FnZV9pZCcsXG4gICAgICAgICAgJ21lc3NhZ2VzLnJmY19tZXNzYWdlX2lkJyxcbiAgICAgICAgICAnbWVzc2FnZXMuZnJvbV9hZGRyZXNzJyxcbiAgICAgICAgICAnbWVzc2FnZXMuc3ViamVjdCcsXG4gICAgICAgICAgJ21lc3NhZ2VzLnJlY2VpdmVkX2F0JyxcbiAgICAgICAgICAnbWVzc2FnZXMudGV4dF9ib2R5JyxcbiAgICAgICAgICAnbWVzc2FnZXMuaHRtbF9ib2R5JyxcbiAgICAgICAgXSlcbiAgICAgICAgLndoZXJlKCdtZXNzYWdlcy5tYWlsYm94X2lkJywgJz0nLCBtYWlsYm94SWQpXG4gICAgICAgIC53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuc3RhdHVzJywgJz0nLCAncGVuZGluZycpXG4gICAgICAgIC53aGVyZSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMua2luZCcsICc9JywgU1BFTkRJTkdfQ0FORElEQVRFX0tJTkQpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICB9LFxuICAgIGFzeW5jIHVwZGF0ZUFydGlmYWN0KGFydGlmYWN0SWQsIHBheWxvYWQsIGNvbmZpZGVuY2UsIHVwZGF0ZWRBdCkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdleHRyYWN0aW9uX2FydGlmYWN0cycpXG4gICAgICAgIC5zZXQoe1xuICAgICAgICAgIHBheWxvYWQsXG4gICAgICAgICAgY29uZmlkZW5jZSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiB1cGRhdGVkQXQsXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFydGlmYWN0SWQpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICB9LFxuICB9XG59XG5cbi8qKlxuICogUmUtcnVuIGFuIGFwcHJvdmUgdGVtcGxhdGUgYWdhaW5zdCBwZW5kaW5nIHNwZW5kaW5nIGNhbmRpZGF0ZXMgaW4gaXRzXG4gKiBtYWlsYm94LiBNYXRjaGluZyBtZXNzYWdlcyB0aGF0IGV4dHJhY3Qgc3VjY2Vzc2Z1bGx5IGhhdmUgdGhlaXIgcGVuZGluZ1xuICogYXJ0aWZhY3QgcGF5bG9hZC9jb25maWRlbmNlIHVwZGF0ZWQgaW4gcGxhY2UuIEV4dHJhY3QgbWlzc2VzIGFyZSBsZWZ0IGFsb25lLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVldmFsdWF0ZVBlbmRpbmdXaXRoVGVtcGxhdGUoXG4gIHN0b3JlOiBUZW1wbGF0ZVJlZXZhbHVhdGVTdG9yZSxcbiAgdGVtcGxhdGU6IFJlZXZhbHVhdGVUZW1wbGF0ZUlucHV0LFxuICBub3c6IHN0cmluZyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbik6IFByb21pc2U8bnVtYmVyPiB7XG4gIGlmICh0ZW1wbGF0ZS5raW5kICE9PSAnYXBwcm92ZScgfHwgIXRlbXBsYXRlLmVuYWJsZWQpIHJldHVybiAwXG5cbiAgY29uc3Qgc3BlbmRUZW1wbGF0ZSA9IHRvU3BlbmRQYXJzaW5nVGVtcGxhdGUodGVtcGxhdGUpXG4gIGlmICghc3BlbmRUZW1wbGF0ZSkgcmV0dXJuIDBcblxuICBjb25zdCBleHRyYWN0b3IgPSBuZXcgVGVtcGxhdGVTcGVuZGluZ0V4dHJhY3RvcihzcGVuZFRlbXBsYXRlKVxuICBjb25zdCBwZW5kaW5nID0gYXdhaXQgc3RvcmUubGlzdFBlbmRpbmdBcnRpZmFjdHModGVtcGxhdGUubWFpbGJveF9pZClcbiAgbGV0IHVwZGF0ZWQgPSAwXG5cbiAgZm9yIChjb25zdCByb3cgb2YgcGVuZGluZykge1xuICAgIGNvbnN0IGVtYWlsID0gcm93VG9FbWFpbE1lc3NhZ2Uocm93KVxuICAgIGlmICghZXh0cmFjdG9yLmNhbkhhbmRsZShlbWFpbCkpIGNvbnRpbnVlXG4gICAgY29uc3QgYXJ0cyA9IGV4dHJhY3Rvci5leHRyYWN0KGVtYWlsKVxuICAgIGNvbnN0IGFydCA9IGFydHNbMF1cbiAgICBpZiAoIWFydCkgY29udGludWVcblxuICAgIGF3YWl0IHN0b3JlLnVwZGF0ZUFydGlmYWN0KFxuICAgICAgcm93LmFydGlmYWN0X2lkLFxuICAgICAgYXJ0LnBheWxvYWQsXG4gICAgICBhcnQuY29uZmlkZW5jZSxcbiAgICAgIG5vdyxcbiAgICApXG4gICAgdXBkYXRlZCArPSAxXG4gIH1cblxuICByZXR1cm4gdXBkYXRlZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9TcGVuZFBhcnNpbmdUZW1wbGF0ZShcbiAgdGVtcGxhdGU6IFJlZXZhbHVhdGVUZW1wbGF0ZUlucHV0LFxuKTogU3BlbmRQYXJzaW5nVGVtcGxhdGUgfCBudWxsIHtcbiAgY29uc3QgZXh0cmFjdG9ycyA9IHBhcnNlU3BlbmRUZW1wbGF0ZUV4dHJhY3RvcnModGVtcGxhdGUuZXh0cmFjdG9ycylcbiAgaWYgKCFleHRyYWN0b3JzKSByZXR1cm4gbnVsbFxuICByZXR1cm4ge1xuICAgIGlkOiB0ZW1wbGF0ZS5pZCxcbiAgICBtYXRjaEZyb21QYXR0ZXJuOiB0ZW1wbGF0ZS5tYXRjaF9mcm9tX3BhdHRlcm4sXG4gICAgbWF0Y2hTdWJqZWN0UmVnZXg6IHRlbXBsYXRlLm1hdGNoX3N1YmplY3RfcmVnZXgsXG4gICAgZXh0cmFjdG9yczogZXh0cmFjdG9ycyBhcyBTcGVuZFRlbXBsYXRlRXh0cmFjdG9ycyxcbiAgICBlbmFibGVkOiB0ZW1wbGF0ZS5lbmFibGVkLFxuICB9XG59XG5cbmZ1bmN0aW9uIHJvd1RvRW1haWxNZXNzYWdlKHJvdzoge1xuICBwcm92aWRlcl9tZXNzYWdlX2lkOiBzdHJpbmdcbiAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdGV4dF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGh0bWxfYm9keTogc3RyaW5nIHwgbnVsbFxufSk6IEVtYWlsTWVzc2FnZSB7XG4gIGNvbnN0IHJlY2VpdmVkQXQgPSByb3cucmVjZWl2ZWRfYXQgaW5zdGFuY2VvZiBEYXRlXG4gICAgPyByb3cucmVjZWl2ZWRfYXRcbiAgICA6IG5ldyBEYXRlKHJvdy5yZWNlaXZlZF9hdClcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LnByb3ZpZGVyX21lc3NhZ2VfaWQsXG4gICAgcmZjTWVzc2FnZUlkOiByb3cucmZjX21lc3NhZ2VfaWQsXG4gICAgZnJvbTogcm93LmZyb21fYWRkcmVzcyxcbiAgICBzdWJqZWN0OiByb3cuc3ViamVjdCxcbiAgICByZWNlaXZlZEF0LFxuICAgIHRleHRCb2R5OiByZXNvbHZlVGV4dEJvZHkocm93LnRleHRfYm9keSwgcm93Lmh0bWxfYm9keSksXG4gICAgaHRtbEJvZHk6IHJvdy5odG1sX2JvZHksXG4gIH1cbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gYXNJc29UaW1lc3RhbXAodmFsdWU6IERhdGUgfCBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpXG4gIGlmICgvXlxcZHsxMCx9JC8udGVzdCh0cmltbWVkKSkge1xuICAgIGNvbnN0IG4gPSBOdW1iZXIodHJpbW1lZClcbiAgICBjb25zdCBtcyA9IHRyaW1tZWQubGVuZ3RoIDw9IDEwID8gbiAqIDEwMDAgOiBuXG4gICAgcmV0dXJuIG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhc0lzb1RpbWVzdGFtcE9yTnVsbChcbiAgdmFsdWU6IERhdGUgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4gYXNJc29UaW1lc3RhbXAodmFsdWUpXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHkgfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7IERhdGFiYXNlIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgYXNJc29UaW1lc3RhbXAgfSBmcm9tICcuLi9ncmFwaHFsL3RpbWVzdGFtcHMudHMnXG5cbi8qKiBHcmFwaFFMIE1lc3NhZ2Ugc2hhcGUgKElTTyB0aW1lc3RhbXBzIGFzIHN0cmluZ3MpLiAqL1xuZXhwb3J0IHR5cGUgT3duZWRNZXNzYWdlID0ge1xuICBpZDogbnVtYmVyXG4gIG1haWxib3hfaWQ6IG51bWJlclxuICBwcm92aWRlcl9tZXNzYWdlX2lkOiBzdHJpbmdcbiAgcmZjX21lc3NhZ2VfaWQ6IHN0cmluZ1xuICBmcm9tX2FkZHJlc3M6IHN0cmluZ1xuICBzdWJqZWN0OiBzdHJpbmdcbiAgcmVjZWl2ZWRfYXQ6IHN0cmluZ1xuICB0ZXh0X2JvZHk6IHN0cmluZyB8IG51bGxcbiAgaHRtbF9ib2R5OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IHN0cmluZ1xufVxuXG5leHBvcnQgdHlwZSBNZXNzYWdlSm9pblJvdyA9IHtcbiAgaWQ6IG51bWJlclxuICBtYWlsYm94X2lkOiBudW1iZXJcbiAgcHJvdmlkZXJfbWVzc2FnZV9pZDogc3RyaW5nXG4gIHJmY19tZXNzYWdlX2lkOiBzdHJpbmdcbiAgZnJvbV9hZGRyZXNzOiBzdHJpbmdcbiAgc3ViamVjdDogc3RyaW5nXG4gIHJlY2VpdmVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHRleHRfYm9keTogc3RyaW5nIHwgbnVsbFxuICBodG1sX2JvZHk6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufVxuXG4vKiogTWluaW1hbCBzdG9yZSBzbyBvd25lcnNoaXAgLyBtaXNzaW5nIHBhdGhzIGNhbiBiZSB1bml0LXRlc3RlZCB3aXRob3V0IFBvc3RncmVzLiAqL1xuZXhwb3J0IHR5cGUgTWVzc2FnZUxvb2t1cFN0b3JlID0ge1xuICBmaW5kT3duZWRNZXNzYWdlUm93KFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIG1lc3NhZ2VJZDogbnVtYmVyLFxuICApOiBQcm9taXNlPE1lc3NhZ2VKb2luUm93IHwgdW5kZWZpbmVkPlxuICBmaW5kU291cmNlTWVzc2FnZVJvdyhcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBleHBlbnNlSWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTxNZXNzYWdlSm9pblJvdyB8IHVuZGVmaW5lZD5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1hcE93bmVkTWVzc2FnZShyb3c6IE1lc3NhZ2VKb2luUm93KTogT3duZWRNZXNzYWdlIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIG1haWxib3hfaWQ6IHJvdy5tYWlsYm94X2lkLFxuICAgIHByb3ZpZGVyX21lc3NhZ2VfaWQ6IHJvdy5wcm92aWRlcl9tZXNzYWdlX2lkLFxuICAgIHJmY19tZXNzYWdlX2lkOiByb3cucmZjX21lc3NhZ2VfaWQsXG4gICAgZnJvbV9hZGRyZXNzOiByb3cuZnJvbV9hZGRyZXNzLFxuICAgIHN1YmplY3Q6IHJvdy5zdWJqZWN0LFxuICAgIHJlY2VpdmVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cucmVjZWl2ZWRfYXQpLFxuICAgIHRleHRfYm9keTogcm93LnRleHRfYm9keSA/PyBudWxsLFxuICAgIGh0bWxfYm9keTogcm93Lmh0bWxfYm9keSA/PyBudWxsLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlS3lzZWx5TWVzc2FnZUxvb2t1cFN0b3JlKFxuICBkYjogS3lzZWx5PERhdGFiYXNlPixcbik6IE1lc3NhZ2VMb29rdXBTdG9yZSB7XG4gIHJldHVybiB7XG4gICAgYXN5bmMgZmluZE93bmVkTWVzc2FnZVJvdyh1c2VySWQsIG1lc3NhZ2VJZCkge1xuICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdtZXNzYWdlcycpXG4gICAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAgIC5zZWxlY3RBbGwoJ21lc3NhZ2VzJylcbiAgICAgICAgLndoZXJlKCdtZXNzYWdlcy5pZCcsICc9JywgbWVzc2FnZUlkKVxuICAgICAgICAud2hlcmUoJ21haWxib3hlcy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICB9LFxuICAgIGFzeW5jIGZpbmRTb3VyY2VNZXNzYWdlUm93KHVzZXJJZCwgZXhwZW5zZUlkKSB7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzJylcbiAgICAgICAgLmlubmVySm9pbihcbiAgICAgICAgICAnbWVzc2FnZXMnLFxuICAgICAgICAgICdtZXNzYWdlcy5pZCcsXG4gICAgICAgICAgJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLm1lc3NhZ2VfaWQnLFxuICAgICAgICApXG4gICAgICAgIC5pbm5lckpvaW4oJ21haWxib3hlcycsICdtYWlsYm94ZXMuaWQnLCAnbWVzc2FnZXMubWFpbGJveF9pZCcpXG4gICAgICAgIC5zZWxlY3RBbGwoJ21lc3NhZ2VzJylcbiAgICAgICAgLndoZXJlKCdleHRyYWN0aW9uX2FydGlmYWN0cy5wdWJsaXNoZWRfZXhwZW5zZV9pZCcsICc9JywgZXhwZW5zZUlkKVxuICAgICAgICAud2hlcmUoJ2V4dHJhY3Rpb25fYXJ0aWZhY3RzLnN0YXR1cycsICc9JywgJ2FjY2VwdGVkJylcbiAgICAgICAgLndoZXJlKCdtYWlsYm94ZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAub3JkZXJCeSgnZXh0cmFjdGlvbl9hcnRpZmFjdHMuaWQnLCAnZGVzYycpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICB9LFxuICB9XG59XG5cbi8qKiBVc2VyLXNjb3BlZCBtZXNzYWdlIGJ5IGlkLiBSZXR1cm5zIG51bGwgd2hlbiBtaXNzaW5nIG9yIG5vdCBvd25lZC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmaW5kT3duZWRNZXNzYWdlKFxuICBzdG9yZTogTWVzc2FnZUxvb2t1cFN0b3JlLFxuICB1c2VySWQ6IG51bWJlcixcbiAgbWVzc2FnZUlkOiBudW1iZXIsXG4pOiBQcm9taXNlPE93bmVkTWVzc2FnZSB8IG51bGw+IHtcbiAgY29uc3Qgcm93ID0gYXdhaXQgc3RvcmUuZmluZE93bmVkTWVzc2FnZVJvdyh1c2VySWQsIG1lc3NhZ2VJZClcbiAgcmV0dXJuIHJvdyA/IG1hcE93bmVkTWVzc2FnZShyb3cpIDogbnVsbFxufVxuXG4vKipcbiAqIFJldmVyc2UgbG9va3VwOiBhY2NlcHRlZCBhcnRpZmFjdCB3aXRoIHB1Ymxpc2hlZF9leHBlbnNlX2lkIFx1MjE5MiBzb3VyY2UgbWVzc2FnZS5cbiAqIFJldHVybnMgbnVsbCB3aGVuIG5vIG1hdGNoaW5nIGFjY2VwdGVkIHB1Ymxpc2ggZXhpc3RzIGZvciB0aGlzIHVzZXIuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmaW5kU291cmNlTWVzc2FnZUZvckV4cGVuc2UoXG4gIHN0b3JlOiBNZXNzYWdlTG9va3VwU3RvcmUsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBleHBlbnNlSWQ6IG51bWJlcixcbik6IFByb21pc2U8T3duZWRNZXNzYWdlIHwgbnVsbD4ge1xuICBjb25zdCByb3cgPSBhd2FpdCBzdG9yZS5maW5kU291cmNlTWVzc2FnZVJvdyh1c2VySWQsIGV4cGVuc2VJZClcbiAgcmV0dXJuIHJvdyA/IG1hcE93bmVkTWVzc2FnZShyb3cpIDogbnVsbFxufVxuIiwgImltcG9ydCB7IGVudiBhcyByZWFkRW52IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2Vudi50cydcbmltcG9ydCB0eXBlIHsgU3BlbmRpbmdDYW5kaWRhdGVQYXlsb2FkIH0gZnJvbSAnbWFpbGJveF9raXQvbW9kLnRzJ1xuXG5leHBvcnQgY2xhc3MgU3BlbmRtYW5hZ2VyU2lua0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdTcGVuZG1hbmFnZXJTaW5rRXJyb3InXG4gIH1cbn1cblxuZXhwb3J0IHR5cGUgUHVibGlzaEV4cGVuc2VSZXN1bHQgPSB7XG4gIGV4cGVuc2VJZDogbnVtYmVyXG59XG5cbi8qKlxuICogUHVibGlzaCBhbiBhY2NlcHRlZCBzcGVuZGluZyBjYW5kaWRhdGUgdG8gc3BlbmRtYW5hZ2VyLWFwaSB2aWEgR3JhcGhRTCxcbiAqIGZvcndhcmRpbmcgdGhlIGNhbGxlcidzIFN1cGVyVG9rZW5zIEJlYXJlciBKV1QuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwdWJsaXNoRXhwZW5zZVRvU3BlbmRtYW5hZ2VyKFxuICBjYW5kaWRhdGU6IFNwZW5kaW5nQ2FuZGlkYXRlUGF5bG9hZCxcbiAgY2F0ZWdvcnlJZDogbnVtYmVyLFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcsXG4gIG9wdGlvbnM/OiB7XG4gICAgYmFzZVVybD86IHN0cmluZ1xuICAgIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaFxuICB9LFxuKTogUHJvbWlzZTxQdWJsaXNoRXhwZW5zZVJlc3VsdD4ge1xuICBpZiAoIWF1dGhvcml6YXRpb25IZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHRocm93IG5ldyBTcGVuZG1hbmFnZXJTaW5rRXJyb3IoJ21pc3NpbmcgQmVhcmVyIGF1dGhvcml6YXRpb24nKVxuICB9XG5cbiAgY29uc3QgYmFzZVVybCA9IChvcHRpb25zPy5iYXNlVXJsID8/XG4gICAgcmVhZEVudignU1BFTkRNQU5BR0VSX0FQSV9CQVNFX1VSTCcpID8/XG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMicpLnJlcGxhY2UoL1xcLyQvLCAnJylcblxuICBjb25zdCBub3RlID0gY2FuZGlkYXRlLm5vdGU/LnRyaW0oKSB8fFxuICAgIFtjYW5kaWRhdGUubWVyY2hhbnQsIGNhbmRpZGF0ZS5zb3VyY2VTdWJqZWN0XS5maWx0ZXIoQm9vbGVhbikuam9pbignIFx1MjAxNCAnKSB8fFxuICAgIG51bGxcblxuICBjb25zdCBxdWVyeSA9IGBcbiAgICBtdXRhdGlvbiBDcmVhdGVFeHBlbnNlKCRpbnB1dDogQ3JlYXRlRXhwZW5zZUlucHV0SW5wdXQhKSB7XG4gICAgICBjcmVhdGVFeHBlbnNlKGFyZ3M6IHsgaW5wdXQ6ICRpbnB1dCB9KSB7XG4gICAgICAgIGlkXG4gICAgICB9XG4gICAgfVxuICBgXG5cbiAgY29uc3QgZmV0Y2hJbXBsID0gb3B0aW9ucz8uZmV0Y2hJbXBsID8/IGZldGNoXG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoSW1wbChgJHtiYXNlVXJsfS9ncmFwaHFsYCwge1xuICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgIEF1dGhvcml6YXRpb246IGF1dGhvcml6YXRpb25IZWFkZXIsXG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgcXVlcnksXG4gICAgICB2YXJpYWJsZXM6IHtcbiAgICAgICAgaW5wdXQ6IHtcbiAgICAgICAgICBjYXRlZ29yeUlkLFxuICAgICAgICAgIGFtb3VudENlbnRzOiBjYW5kaWRhdGUuYW1vdW50Q2VudHMsXG4gICAgICAgICAgc3BlbnRPbjogY2FuZGlkYXRlLnNwZW50T24sXG4gICAgICAgICAgY3VycmVuY3k6IGNhbmRpZGF0ZS5jdXJyZW5jeSxcbiAgICAgICAgICBub3RlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KSxcbiAgfSlcblxuICBpZiAoIXJlcy5vaykge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXMudGV4dCgpLmNhdGNoKCgpID0+ICcnKVxuICAgIHRocm93IG5ldyBTcGVuZG1hbmFnZXJTaW5rRXJyb3IoXG4gICAgICBgc3BlbmRtYW5hZ2VyIEhUVFAgJHtyZXMuc3RhdHVzfTogJHt0ZXh0LnNsaWNlKDAsIDMwMCl9YCxcbiAgICApXG4gIH1cblxuICBjb25zdCBib2R5ID0gYXdhaXQgcmVzLmpzb24oKSBhcyB7XG4gICAgZGF0YT86IHsgY3JlYXRlRXhwZW5zZT86IHsgaWQ6IG51bWJlciB9IH1cbiAgICBlcnJvcnM/OiB7IG1lc3NhZ2U6IHN0cmluZyB9W11cbiAgfVxuXG4gIGlmIChib2R5LmVycm9ycz8ubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFNwZW5kbWFuYWdlclNpbmtFcnJvcihcbiAgICAgIGJvZHkuZXJyb3JzLm1hcCgoZSkgPT4gZS5tZXNzYWdlKS5qb2luKCc7ICcpLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IGlkID0gYm9keS5kYXRhPy5jcmVhdGVFeHBlbnNlPy5pZFxuICBpZiAodHlwZW9mIGlkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBTcGVuZG1hbmFnZXJTaW5rRXJyb3IoJ3NwZW5kbWFuYWdlciByZXNwb25zZSBtaXNzaW5nIGV4cGVuc2UgaWQnKVxuICB9XG4gIHJldHVybiB7IGV4cGVuc2VJZDogaWQgfVxufVxuIiwgIi8qKiBHbWFpbCBPQXV0aCBhdXRob3JpemF0aW9uLWNvZGUgaGVscGVycyAoc3RhcnQgKyBjYWxsYmFjaykuICovXG5cbmltcG9ydCB7IGVudiBhcyByZWFkRW52IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2Vudi50cydcblxuZXhwb3J0IGNvbnN0IEdNQUlMX1JFQURPTkxZX1NDT1BFID1cbiAgJ2h0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL2F1dGgvZ21haWwucmVhZG9ubHknXG5cbmV4cG9ydCBjb25zdCBHT09HTEVfQVVUSE9SSVpFX1VSTCA9XG4gICdodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vby9vYXV0aDIvdjIvYXV0aCdcblxuZXhwb3J0IGNvbnN0IEdPT0dMRV9UT0tFTl9VUkwgPSAnaHR0cHM6Ly9vYXV0aDIuZ29vZ2xlYXBpcy5jb20vdG9rZW4nXG5cbmNvbnN0IFNUQVRFX1RUTF9TRUNPTkRTID0gMTAgKiA2MFxuXG5leHBvcnQgaW50ZXJmYWNlIEdtYWlsT0F1dGhDb25maWcge1xuICBjbGllbnRJZDogc3RyaW5nXG4gIGNsaWVudFNlY3JldDogc3RyaW5nXG4gIHJlZGlyZWN0VXJpOiBzdHJpbmdcbiAgcmV0dXJuVG9BbGxvd2xpc3Q6IHN0cmluZ1tdXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR21haWxPQXV0aFN0YXRlUGF5bG9hZCB7XG4gIHVzZXJJZDogbnVtYmVyXG4gIG1haWxib3hJZDogbnVtYmVyXG4gIHJldHVyblRvOiBzdHJpbmdcbiAgZXhwOiBudW1iZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHbWFpbFRva2VuUmVzdWx0IHtcbiAgYWNjZXNzVG9rZW46IHN0cmluZ1xuICByZWZyZXNoVG9rZW46IHN0cmluZyB8IG51bGxcbiAgZXhwaXJlc0F0TXM6IG51bWJlciB8IG51bGxcbn1cblxuZXhwb3J0IGNsYXNzIEdtYWlsT0F1dGhFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnR21haWxPQXV0aEVycm9yJ1xuICB9XG59XG5cbi8qKiBMb2FkIEdtYWlsIE9BdXRoIHNldHRpbmdzIChvbWl0IGBlbnZgIHRvIHJlYWQgcHJvY2Vzcy9EZW5vIHZpYSBkZW5vX2FwaV9raXQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRHbWFpbE9BdXRoQ29uZmlnKFxuICBlbnY/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+LFxuKTogR21haWxPQXV0aENvbmZpZyB7XG4gIGNvbnN0IHNvdXJjZSA9IGVudiA/PyB7XG4gICAgR01BSUxfT0FVVEhfQ0xJRU5UX0lEOiByZWFkRW52KCdHTUFJTF9PQVVUSF9DTElFTlRfSUQnKSxcbiAgICBHTUFJTF9PQVVUSF9DTElFTlRfU0VDUkVUOiByZWFkRW52KCdHTUFJTF9PQVVUSF9DTElFTlRfU0VDUkVUJyksXG4gICAgR01BSUxfT0FVVEhfUkVESVJFQ1RfVVJJOiByZWFkRW52KCdHTUFJTF9PQVVUSF9SRURJUkVDVF9VUkknKSxcbiAgICBHTUFJTF9PQVVUSF9SRVRVUk5fVE9fQUxMT1dMSVNUOiByZWFkRW52KCdHTUFJTF9PQVVUSF9SRVRVUk5fVE9fQUxMT1dMSVNUJyksXG4gIH1cbiAgY29uc3QgY2xpZW50SWQgPSBzb3VyY2UuR01BSUxfT0FVVEhfQ0xJRU5UX0lEPy50cmltKCkgPz8gJydcbiAgY29uc3QgY2xpZW50U2VjcmV0ID0gc291cmNlLkdNQUlMX09BVVRIX0NMSUVOVF9TRUNSRVQ/LnRyaW0oKSA/PyAnJ1xuICBjb25zdCByZWRpcmVjdFVyaSA9IChzb3VyY2UuR01BSUxfT0FVVEhfUkVESVJFQ1RfVVJJPy50cmltKCkgfHxcbiAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAzL29hdXRoL2dtYWlsL2NhbGxiYWNrJylcbiAgY29uc3QgYWxsb3dSYXcgPSBzb3VyY2UuR01BSUxfT0FVVEhfUkVUVVJOX1RPX0FMTE9XTElTVD8udHJpbSgpIHx8XG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NDQ0NSxzcGVuZG1hbmFnZXI6Ly9zZXR0aW5ncy9lbWFpbC1pbXBvcnQnXG4gIGNvbnN0IHJldHVyblRvQWxsb3dsaXN0ID0gYWxsb3dSYXdcbiAgICAuc3BsaXQoJywnKVxuICAgIC5tYXAoKHMpID0+IHMudHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcblxuICBpZiAoIWNsaWVudElkIHx8ICFjbGllbnRTZWNyZXQpIHtcbiAgICB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKFxuICAgICAgJ0dNQUlMX09BVVRIX0NMSUVOVF9JRCBhbmQgR01BSUxfT0FVVEhfQ0xJRU5UX1NFQ1JFVCBhcmUgcmVxdWlyZWQnLFxuICAgIClcbiAgfVxuICBpZiAocmV0dXJuVG9BbGxvd2xpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcignR01BSUxfT0FVVEhfUkVUVVJOX1RPX0FMTE9XTElTVCBpcyBlbXB0eScpXG4gIH1cblxuICByZXR1cm4geyBjbGllbnRJZCwgY2xpZW50U2VjcmV0LCByZWRpcmVjdFVyaSwgcmV0dXJuVG9BbGxvd2xpc3QgfVxufVxuXG4vKiogVHJ1ZSB3aGVuIGByZXR1cm5Ub2Agb3JpZ2luIChvciBzY2hlbWUgcHJlZml4KSBtYXRjaGVzIGFuIGFsbG93bGlzdCBlbnRyeS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1JldHVyblRvQWxsb3dlZChcbiAgcmV0dXJuVG86IHN0cmluZyxcbiAgYWxsb3dsaXN0OiBzdHJpbmdbXSxcbik6IGJvb2xlYW4ge1xuICBsZXQgdXJsOiBVUkxcbiAgdHJ5IHtcbiAgICB1cmwgPSBuZXcgVVJMKHJldHVyblRvKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIGlmICh1cmwudXNlcm5hbWUgfHwgdXJsLnBhc3N3b3JkKSByZXR1cm4gZmFsc2VcbiAgaWYgKHVybC5oYXNoKSByZXR1cm4gZmFsc2VcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGFsbG93bGlzdCkge1xuICAgIGlmICghZW50cnkpIGNvbnRpbnVlXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFsbG93ZWQgPSBuZXcgVVJMKGVudHJ5KVxuICAgICAgaWYgKHVybC5wcm90b2NvbCA9PT0gYWxsb3dlZC5wcm90b2NvbCAmJiB1cmwuaG9zdCA9PT0gYWxsb3dlZC5ob3N0KSB7XG4gICAgICAgIC8vIEFsbG93IGV4YWN0IG9yaWdpbiBvciBhbnkgcGF0aCB1bmRlciB0aGF0IG9yaWdpbi5cbiAgICAgICAgaWYgKCFhbGxvd2VkLnBhdGhuYW1lIHx8IGFsbG93ZWQucGF0aG5hbWUgPT09ICcvJykgcmV0dXJuIHRydWVcbiAgICAgICAgY29uc3QgcHJlZml4ID0gYWxsb3dlZC5wYXRobmFtZS5lbmRzV2l0aCgnLycpXG4gICAgICAgICAgPyBhbGxvd2VkLnBhdGhuYW1lXG4gICAgICAgICAgOiBgJHthbGxvd2VkLnBhdGhuYW1lfS9gXG4gICAgICAgIGlmIChcbiAgICAgICAgICB1cmwucGF0aG5hbWUgPT09IGFsbG93ZWQucGF0aG5hbWUgfHxcbiAgICAgICAgICB1cmwucGF0aG5hbWUuc3RhcnRzV2l0aChwcmVmaXgpXG4gICAgICAgICkge1xuICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIEN1c3RvbSBzY2hlbWVzIHdpdGhvdXQgYXV0aG9yaXR5LCBlLmcuIHNwZW5kbWFuYWdlcjovL3NldHRpbmdzLy4uLlxuICAgICAgaWYgKHJldHVyblRvID09PSBlbnRyeSB8fCByZXR1cm5Uby5zdGFydHNXaXRoKGAke2VudHJ5fWApKSB7XG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZVxufVxuXG5mdW5jdGlvbiBieXRlc1RvQmFzZTY0VXJsKGJ5dGVzOiBVaW50OEFycmF5KTogc3RyaW5nIHtcbiAgbGV0IGJpbiA9ICcnXG4gIGZvciAoY29uc3QgYiBvZiBieXRlcykgYmluICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYilcbiAgcmV0dXJuIGJ0b2EoYmluKS5yZXBsYWNlKC9cXCsvZywgJy0nKS5yZXBsYWNlKC9cXC8vZywgJ18nKS5yZXBsYWNlKC89KyQvLCAnJylcbn1cblxuZnVuY3Rpb24gYmFzZTY0VXJsVG9CeXRlcyhzOiBzdHJpbmcpOiBVaW50OEFycmF5IHtcbiAgY29uc3QgcGFkZGVkID0gcy5yZXBsYWNlKC8tL2csICcrJykucmVwbGFjZSgvXy9nLCAnLycpICtcbiAgICAnPT09Jy5zbGljZSgocy5sZW5ndGggKyAzKSAlIDQpXG4gIGNvbnN0IGJpbiA9IGF0b2IocGFkZGVkKVxuICBjb25zdCBvdXQgPSBuZXcgVWludDhBcnJheShiaW4ubGVuZ3RoKVxuICBmb3IgKGxldCBpID0gMDsgaSA8IGJpbi5sZW5ndGg7IGkrKykgb3V0W2ldID0gYmluLmNoYXJDb2RlQXQoaSlcbiAgcmV0dXJuIG91dFxufVxuXG5hc3luYyBmdW5jdGlvbiBobWFjS2V5KHNlY3JldDogc3RyaW5nKTogUHJvbWlzZTxDcnlwdG9LZXk+IHtcbiAgcmV0dXJuIGNyeXB0by5zdWJ0bGUuaW1wb3J0S2V5KFxuICAgICdyYXcnLFxuICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzZWNyZXQpLFxuICAgIHsgbmFtZTogJ0hNQUMnLCBoYXNoOiAnU0hBLTI1NicgfSxcbiAgICBmYWxzZSxcbiAgICBbJ3NpZ24nLCAndmVyaWZ5J10sXG4gIClcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNpZ25PQXV0aFN0YXRlKFxuICBwYXlsb2FkOiBPbWl0PEdtYWlsT0F1dGhTdGF0ZVBheWxvYWQsICdleHAnPiAmIHsgZXhwPzogbnVtYmVyIH0sXG4gIGNsaWVudFNlY3JldDogc3RyaW5nLFxuICBub3dNczogbnVtYmVyID0gRGF0ZS5ub3coKSxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGJvZHk6IEdtYWlsT0F1dGhTdGF0ZVBheWxvYWQgPSB7XG4gICAgdXNlcklkOiBwYXlsb2FkLnVzZXJJZCxcbiAgICBtYWlsYm94SWQ6IHBheWxvYWQubWFpbGJveElkLFxuICAgIHJldHVyblRvOiBwYXlsb2FkLnJldHVyblRvLFxuICAgIGV4cDogcGF5bG9hZC5leHAgPz8gTWF0aC5mbG9vcihub3dNcyAvIDEwMDApICsgU1RBVEVfVFRMX1NFQ09ORFMsXG4gIH1cbiAgY29uc3QgcGF5bG9hZEI2NCA9IGJ5dGVzVG9CYXNlNjRVcmwoXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKEpTT04uc3RyaW5naWZ5KGJvZHkpKSxcbiAgKVxuICBjb25zdCBrZXkgPSBhd2FpdCBobWFjS2V5KGNsaWVudFNlY3JldClcbiAgY29uc3Qgc2lnID0gYXdhaXQgY3J5cHRvLnN1YnRsZS5zaWduKFxuICAgICdITUFDJyxcbiAgICBrZXksXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHBheWxvYWRCNjQpLFxuICApXG4gIHJldHVybiBgJHtwYXlsb2FkQjY0fS4ke2J5dGVzVG9CYXNlNjRVcmwobmV3IFVpbnQ4QXJyYXkoc2lnKSl9YFxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5T0F1dGhTdGF0ZShcbiAgc3RhdGU6IHN0cmluZyxcbiAgY2xpZW50U2VjcmV0OiBzdHJpbmcsXG4gIG5vd01zOiBudW1iZXIgPSBEYXRlLm5vdygpLFxuKTogUHJvbWlzZTxHbWFpbE9BdXRoU3RhdGVQYXlsb2FkPiB7XG4gIGNvbnN0IHBhcnRzID0gc3RhdGUuc3BsaXQoJy4nKVxuICBpZiAocGFydHMubGVuZ3RoICE9PSAyIHx8ICFwYXJ0c1swXSB8fCAhcGFydHNbMV0pIHtcbiAgICB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKCdpbnZhbGlkIE9BdXRoIHN0YXRlJylcbiAgfVxuICBjb25zdCBbcGF5bG9hZEI2NCwgc2lnQjY0XSA9IHBhcnRzXG4gIGNvbnN0IGtleSA9IGF3YWl0IGhtYWNLZXkoY2xpZW50U2VjcmV0KVxuICBjb25zdCBvayA9IGF3YWl0IGNyeXB0by5zdWJ0bGUudmVyaWZ5KFxuICAgICdITUFDJyxcbiAgICBrZXksXG4gICAgYmFzZTY0VXJsVG9CeXRlcyhzaWdCNjQpIGFzIEJ1ZmZlclNvdXJjZSxcbiAgICBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUocGF5bG9hZEI2NCksXG4gIClcbiAgaWYgKCFvaykgdGhyb3cgbmV3IEdtYWlsT0F1dGhFcnJvcignaW52YWxpZCBPQXV0aCBzdGF0ZSBzaWduYXR1cmUnKVxuXG4gIGxldCBib2R5OiBHbWFpbE9BdXRoU3RhdGVQYXlsb2FkXG4gIHRyeSB7XG4gICAgYm9keSA9IEpTT04ucGFyc2UoXG4gICAgICBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYmFzZTY0VXJsVG9CeXRlcyhwYXlsb2FkQjY0KSksXG4gICAgKSBhcyBHbWFpbE9BdXRoU3RhdGVQYXlsb2FkXG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoJ2ludmFsaWQgT0F1dGggc3RhdGUgcGF5bG9hZCcpXG4gIH1cblxuICBpZiAoXG4gICAgdHlwZW9mIGJvZHkudXNlcklkICE9PSAnbnVtYmVyJyB8fFxuICAgIHR5cGVvZiBib2R5Lm1haWxib3hJZCAhPT0gJ251bWJlcicgfHxcbiAgICB0eXBlb2YgYm9keS5yZXR1cm5UbyAhPT0gJ3N0cmluZycgfHxcbiAgICB0eXBlb2YgYm9keS5leHAgIT09ICdudW1iZXInXG4gICkge1xuICAgIHRocm93IG5ldyBHbWFpbE9BdXRoRXJyb3IoJ2ludmFsaWQgT0F1dGggc3RhdGUgZmllbGRzJylcbiAgfVxuICBpZiAoYm9keS5leHAgPCBNYXRoLmZsb29yKG5vd01zIC8gMTAwMCkpIHtcbiAgICB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKCdPQXV0aCBzdGF0ZSBleHBpcmVkJylcbiAgfVxuICByZXR1cm4gYm9keVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRHb29nbGVBdXRob3JpemVVcmwob3B0aW9uczoge1xuICBjbGllbnRJZDogc3RyaW5nXG4gIHJlZGlyZWN0VXJpOiBzdHJpbmdcbiAgc3RhdGU6IHN0cmluZ1xuICBzY29wZT86IHN0cmluZ1xufSk6IHN0cmluZyB7XG4gIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgIGNsaWVudF9pZDogb3B0aW9ucy5jbGllbnRJZCxcbiAgICByZWRpcmVjdF91cmk6IG9wdGlvbnMucmVkaXJlY3RVcmksXG4gICAgcmVzcG9uc2VfdHlwZTogJ2NvZGUnLFxuICAgIHNjb3BlOiBvcHRpb25zLnNjb3BlID8/IEdNQUlMX1JFQURPTkxZX1NDT1BFLFxuICAgIGFjY2Vzc190eXBlOiAnb2ZmbGluZScsXG4gICAgcHJvbXB0OiAnY29uc2VudCcsXG4gICAgaW5jbHVkZV9ncmFudGVkX3Njb3BlczogJ3RydWUnLFxuICAgIHN0YXRlOiBvcHRpb25zLnN0YXRlLFxuICB9KVxuICByZXR1cm4gYCR7R09PR0xFX0FVVEhPUklaRV9VUkx9PyR7cGFyYW1zLnRvU3RyaW5nKCl9YFxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXhjaGFuZ2VBdXRob3JpemF0aW9uQ29kZShvcHRpb25zOiB7XG4gIGNvZGU6IHN0cmluZ1xuICBjbGllbnRJZDogc3RyaW5nXG4gIGNsaWVudFNlY3JldDogc3RyaW5nXG4gIHJlZGlyZWN0VXJpOiBzdHJpbmdcbiAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoXG4gIHRva2VuVXJsPzogc3RyaW5nXG59KTogUHJvbWlzZTxHbWFpbFRva2VuUmVzdWx0PiB7XG4gIGNvbnN0IGZldGNoSW1wbCA9IG9wdGlvbnMuZmV0Y2hJbXBsID8/IGZldGNoXG4gIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoSW1wbChvcHRpb25zLnRva2VuVXJsID8/IEdPT0dMRV9UT0tFTl9VUkwsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJyB9LFxuICAgIGJvZHk6IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgY29kZTogb3B0aW9ucy5jb2RlLFxuICAgICAgY2xpZW50X2lkOiBvcHRpb25zLmNsaWVudElkLFxuICAgICAgY2xpZW50X3NlY3JldDogb3B0aW9ucy5jbGllbnRTZWNyZXQsXG4gICAgICByZWRpcmVjdF91cmk6IG9wdGlvbnMucmVkaXJlY3RVcmksXG4gICAgICBncmFudF90eXBlOiAnYXV0aG9yaXphdGlvbl9jb2RlJyxcbiAgICB9KSxcbiAgfSlcbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKS5jYXRjaCgoKSA9PiAnJylcbiAgICB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKFxuICAgICAgYHRva2VuIGV4Y2hhbmdlIGZhaWxlZCAoJHtyZXMuc3RhdHVzfSk6ICR7dGV4dC5zbGljZSgwLCAyMDApfWAsXG4gICAgKVxuICB9XG4gIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpIGFzIHtcbiAgICBhY2Nlc3NfdG9rZW4/OiBzdHJpbmdcbiAgICByZWZyZXNoX3Rva2VuPzogc3RyaW5nXG4gICAgZXhwaXJlc19pbj86IG51bWJlclxuICB9XG4gIGlmICghanNvbi5hY2Nlc3NfdG9rZW4pIHtcbiAgICB0aHJvdyBuZXcgR21haWxPQXV0aEVycm9yKCd0b2tlbiBleGNoYW5nZSBtaXNzaW5nIGFjY2Vzc190b2tlbicpXG4gIH1cbiAgY29uc3QgZXhwaXJlc0F0TXMgPSB0eXBlb2YganNvbi5leHBpcmVzX2luID09PSAnbnVtYmVyJ1xuICAgID8gRGF0ZS5ub3coKSArIGpzb24uZXhwaXJlc19pbiAqIDEwMDBcbiAgICA6IG51bGxcbiAgcmV0dXJuIHtcbiAgICBhY2Nlc3NUb2tlbjoganNvbi5hY2Nlc3NfdG9rZW4sXG4gICAgcmVmcmVzaFRva2VuOiBqc29uLnJlZnJlc2hfdG9rZW4gPz8gbnVsbCxcbiAgICBleHBpcmVzQXRNcyxcbiAgfVxufVxuXG5jb25zdCBHTUFJTF9QUk9GSUxFX1VSTCA9XG4gICdodHRwczovL2dtYWlsLmdvb2dsZWFwaXMuY29tL2dtYWlsL3YxL3VzZXJzL21lL3Byb2ZpbGUnXG5cbi8qKiBCZXN0LWVmZm9ydCBHbWFpbCBhZGRyZXNzIGZvciBtYWlsYm94IGxhYmVsOyBudWxsIHdoZW4gdW5hdmFpbGFibGUuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hHbWFpbEVtYWlsQWRkcmVzcyhvcHRpb25zOiB7XG4gIGFjY2Vzc1Rva2VuOiBzdHJpbmdcbiAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoXG4gIHByb2ZpbGVVcmw/OiBzdHJpbmdcbn0pOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgY29uc3QgZmV0Y2hJbXBsID0gb3B0aW9ucy5mZXRjaEltcGwgPz8gZmV0Y2hcbiAgdHJ5IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaEltcGwob3B0aW9ucy5wcm9maWxlVXJsID8/IEdNQUlMX1BST0ZJTEVfVVJMLCB7XG4gICAgICBoZWFkZXJzOiB7IEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtvcHRpb25zLmFjY2Vzc1Rva2VufWAgfSxcbiAgICB9KVxuICAgIGlmICghcmVzLm9rKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpIGFzIHsgZW1haWxBZGRyZXNzPzogdW5rbm93biB9XG4gICAgaWYgKHR5cGVvZiBqc29uLmVtYWlsQWRkcmVzcyAhPT0gJ3N0cmluZycpIHJldHVybiBudWxsXG4gICAgY29uc3QgZW1haWwgPSBqc29uLmVtYWlsQWRkcmVzcy50cmltKClcbiAgICByZXR1cm4gZW1haWwubGVuZ3RoID4gMCAmJiBlbWFpbC5sZW5ndGggPD0gMjU1ID8gZW1haWwgOiBudWxsXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuLyoqIEFwcGVuZCBnbWFpbD1jb25uZWN0ZWR8ZXJyb3IgcXVlcnkgcGFyYW1zIHRvIHJldHVyblRvLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUmV0dXJuUmVkaXJlY3QoXG4gIHJldHVyblRvOiBzdHJpbmcsXG4gIHJlc3VsdDogeyBvazogdHJ1ZSB9IHwgeyBvazogZmFsc2U7IGVycm9yOiBzdHJpbmcgfSxcbik6IHN0cmluZyB7XG4gIGNvbnN0IHVybCA9IG5ldyBVUkwocmV0dXJuVG8pXG4gIGlmIChyZXN1bHQub2spIHtcbiAgICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnZ21haWwnLCAnY29ubmVjdGVkJylcbiAgICB1cmwuc2VhcmNoUGFyYW1zLmRlbGV0ZSgnZXJyb3InKVxuICB9IGVsc2Uge1xuICAgIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdnbWFpbCcsICdlcnJvcicpXG4gICAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2Vycm9yJywgcmVzdWx0LmVycm9yLnNsaWNlKDAsIDIwMCkpXG4gIH1cbiAgcmV0dXJuIHVybC50b1N0cmluZygpXG59XG4iLCAiaW1wb3J0IHsgU2VydmljZUVycm9yIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcblxuY29uc3QgUFJPVklERVJTID0gbmV3IFNldChbJ2ZpeHR1cmUnLCAnZ21haWwnXSlcbmNvbnN0IEFSVElGQUNUX1NUQVRVU0VTID0gbmV3IFNldChbJ3BlbmRpbmcnLCAnYWNjZXB0ZWQnLCAncmVqZWN0ZWQnXSlcbmNvbnN0IFRFTVBMQVRFX0tJTkRTID0gbmV3IFNldChbJ2FwcHJvdmUnLCAncmVqZWN0J10pXG5cbi8qKlxuICogQ2xpZW50LWZhY2luZyB2YWxpZGF0aW9uIGZhaWx1cmUuIEV4dGVuZHMgUHlsb24gU2VydmljZUVycm9yIChHcmFwaFFMRXJyb3IpXG4gKiBzbyBHcmFwaFFMIFlvZ2EgZG9lcyBub3QgbWFzayB0aGUgbWVzc2FnZSBhcyBcIlVuZXhwZWN0ZWQgZXJyb3IuXCJcbiAqL1xuZXhwb3J0IGNsYXNzIEludmFsaWRNYWlsYm94RXJyb3IgZXh0ZW5kcyBTZXJ2aWNlRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlLCB7XG4gICAgICBjb2RlOiAnSU5WQUxJRF9NQUlMQk9YX0lOUFVUJyxcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICB9KVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkTWFpbGJveEVycm9yJ1xuICB9XG59XG5cbmNvbnN0IERPTUFJTl9GSUxURVJfSEVMUCA9XG4gICdBbGxvd2VkIHBhdHRlcm5zOiBzaG9wLmNvbSwgdXNlckBzaG9wLmNvbSAod2lsZGNhcmRzIGFyZSBub3QgYWxsb3dlZCknXG5cbmNvbnN0IEZST01fUEFUVEVSTl9IRUxQID1cbiAgJ0FsbG93ZWQgcGF0dGVybnM6IHNob3AuY29tLCAqLnNob3AuY29tLCB1c2VyQHNob3AuY29tLCAqQHNob3AuY29tLCAqQCouc2hvcC5jb20nXG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVByb3ZpZGVyKHByb3ZpZGVyOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gcHJvdmlkZXIudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFQUk9WSURFUlMuaGFzKHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICBgcHJvdmlkZXIgbXVzdCBiZSBvbmUgb2Y6ICR7Wy4uLlBST1ZJREVSU10uam9pbignLCAnKX1gLFxuICAgIClcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVMYWJlbChsYWJlbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxhYmVsLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdsYWJlbCBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ2xhYmVsIGlzIHRvbyBsb25nJylcbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuLyoqXG4gKiBEb21haW4gYWxsb3dsaXN0IGZvciBzeW5jLiBBdCBsZWFzdCBvbmUgcGF0dGVybiByZXF1aXJlZC5cbiAqIEFsbG93ZWQ6IGBzaG9wLmNvbWAsIGB1c2VyQHNob3AuY29tYC4gV2lsZGNhcmRzIGFyZSByZWplY3RlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlRG9tYWluUGF0dGVybnMocGF0dGVybnM6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW11cbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gIGZvciAoY29uc3QgcmF3IG9mIHBhdHRlcm5zKSB7XG4gICAgY29uc3QgcCA9IHJhdy50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIGlmICghcCkgY29udGludWVcbiAgICBpZiAocC5sZW5ndGggPiAyNTUpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdkb21haW4gZmlsdGVyIHBhdHRlcm4gaXMgdG9vIGxvbmcnKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWREb21haW5GaWx0ZXJQYXR0ZXJuKHApKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgICAgZGVzY3JpYmVJbnZhbGlkRG9tYWluRmlsdGVyKHJhdyksXG4gICAgICApXG4gICAgfVxuICAgIGlmIChzZWVuLmhhcyhwKSkgY29udGludWVcbiAgICBzZWVuLmFkZChwKVxuICAgIG91dC5wdXNoKHApXG4gIH1cbiAgaWYgKG91dC5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcignZG9tYWluIGZpbHRlcnMgYXJlIHJlcXVpcmVkJylcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbi8qKiBMaXRlcmFsIGRvbWFpbiBvciBleGFjdCBhZGRyZXNzIFx1MjAxNCBubyB3aWxkY2FyZHMuICovXG5mdW5jdGlvbiBpc1ZhbGlkRG9tYWluRmlsdGVyUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKHBhdHRlcm4uaW5jbHVkZXMoJyonKSkgcmV0dXJuIGZhbHNlXG5cbiAgaWYgKHBhdHRlcm4uaW5jbHVkZXMoJ0AnKSkge1xuICAgIGNvbnN0IGF0ID0gcGF0dGVybi5sYXN0SW5kZXhPZignQCcpXG4gICAgaWYgKGF0IDw9IDAgfHwgYXQgPT09IHBhdHRlcm4ubGVuZ3RoIC0gMSkgcmV0dXJuIGZhbHNlXG4gICAgY29uc3QgbG9jYWwgPSBwYXR0ZXJuLnNsaWNlKDAsIGF0KVxuICAgIGNvbnN0IGRvbWFpbiA9IHBhdHRlcm4uc2xpY2UoYXQgKyAxKVxuICAgIGlmICghbG9jYWwgfHwgbG9jYWwuaW5jbHVkZXMoJ0AnKSkgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIGlzVmFsaWRMaXRlcmFsRG9tYWluKGRvbWFpbilcbiAgfVxuICByZXR1cm4gaXNWYWxpZExpdGVyYWxEb21haW4ocGF0dGVybilcbn1cblxuZnVuY3Rpb24gaXNWYWxpZExpdGVyYWxEb21haW4oZG9tYWluOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKGRvbWFpbi5pbmNsdWRlcygnKicpKSByZXR1cm4gZmFsc2VcbiAgcmV0dXJuIC9eW2EtejAtOV0oW2EtejAtOS1dKlthLXowLTldKT8oXFwuW2EtejAtOV0oW2EtejAtOS1dKlthLXowLTldKT8pKyQvXG4gICAgLnRlc3QoZG9tYWluKVxufVxuXG4vKiogVGVtcGxhdGUgbWF0Y2hGcm9tUGF0dGVybiBcdTIwMTQgd2lsZGNhcmRzIGFsbG93ZWQuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZEZyb21QYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBwID0gcGF0dGVybi50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIXAgfHwgcC5sZW5ndGggPiAyNTUpIHJldHVybiBmYWxzZVxuXG4gIGlmIChwLmluY2x1ZGVzKCdAJykpIHtcbiAgICBjb25zdCBhdCA9IHAubGFzdEluZGV4T2YoJ0AnKVxuICAgIGlmIChhdCA8PSAwIHx8IGF0ID09PSBwLmxlbmd0aCAtIDEpIHJldHVybiBmYWxzZVxuICAgIGNvbnN0IGxvY2FsID0gcC5zbGljZSgwLCBhdClcbiAgICBjb25zdCBkb21haW4gPSBwLnNsaWNlKGF0ICsgMSlcbiAgICBpZiAobG9jYWwgIT09ICcqJyAmJiAobG9jYWwuaW5jbHVkZXMoJyonKSB8fCBsb2NhbC5pbmNsdWRlcygnQCcpKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIHJldHVybiBpc1ZhbGlkRG9tYWluUGF0dGVybihkb21haW4pXG4gIH1cbiAgcmV0dXJuIGlzVmFsaWREb21haW5QYXR0ZXJuKHApXG59XG5cbmZ1bmN0aW9uIGlzVmFsaWREb21haW5QYXR0ZXJuKGRvbWFpbjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChkb21haW4uc3RhcnRzV2l0aCgnKi4nKSkge1xuICAgIGNvbnN0IHJlc3QgPSBkb21haW4uc2xpY2UoMilcbiAgICBpZiAoIXJlc3QgfHwgcmVzdC5pbmNsdWRlcygnKicpIHx8ICFyZXN0LmluY2x1ZGVzKCcuJykpIHJldHVybiBmYWxzZVxuICAgIHJldHVybiBpc1ZhbGlkTGl0ZXJhbERvbWFpbihyZXN0KVxuICB9XG4gIGlmIChkb21haW4uaW5jbHVkZXMoJyonKSkgcmV0dXJuIGZhbHNlXG4gIHJldHVybiBpc1ZhbGlkTGl0ZXJhbERvbWFpbihkb21haW4pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFydGlmYWN0U3RhdHVzKHN0YXR1czogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHN0YXR1cy50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIUFSVElGQUNUX1NUQVRVU0VTLmhhcyh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgYHN0YXR1cyBtdXN0IGJlIG9uZSBvZjogJHtbLi4uQVJUSUZBQ1RfU1RBVFVTRVNdLmpvaW4oJywgJyl9YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVGVtcGxhdGVOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCd0ZW1wbGF0ZSBuYW1lIGlzIHJlcXVpcmVkJylcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3RlbXBsYXRlIG5hbWUgaXMgdG9vIGxvbmcnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbi8qKiBOb3JtYWxpemUgdGVtcGxhdGUga2luZCAvIGNsYXNzaWZ5IGRlY2lzaW9uOiBhcHByb3ZlIHwgcmVqZWN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVGVtcGxhdGVLaW5kKGtpbmQ6IHN0cmluZyk6ICdhcHByb3ZlJyB8ICdyZWplY3QnIHtcbiAgY29uc3QgdHJpbW1lZCA9IGtpbmQudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFURU1QTEFURV9LSU5EUy5oYXModHJpbW1lZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihcbiAgICAgIGBraW5kIG11c3QgYmUgb25lIG9mOiAke1suLi5URU1QTEFURV9LSU5EU10uam9pbignLCAnKX1gLFxuICAgIClcbiAgfVxuICByZXR1cm4gdHJpbW1lZCBhcyAnYXBwcm92ZScgfCAncmVqZWN0J1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVNYXRjaEZyb21QYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHAgPSBwYXR0ZXJuLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGlmICghaXNWYWxpZEZyb21QYXR0ZXJuKHApKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoXG4gICAgICBkZXNjcmliZUludmFsaWRGcm9tUGF0dGVybihwYXR0ZXJuLCAnbWF0Y2hGcm9tUGF0dGVybicpLFxuICAgIClcbiAgfVxuICByZXR1cm4gcFxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVJbnZhbGlkRG9tYWluRmlsdGVyKHJhdzogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgcCA9IHJhdy50cmltKCkudG9Mb3dlckNhc2UoKVxuICBjb25zdCBwcmVmaXggPSBgaW52YWxpZCBkb21haW4gZmlsdGVyIFwiJHtyYXd9XCJgXG5cbiAgaWYgKCFwKSB7XG4gICAgcmV0dXJuIGAke3ByZWZpeH06IHBhdHRlcm4gaXMgZW1wdHkuICR7RE9NQUlOX0ZJTFRFUl9IRUxQfWBcbiAgfVxuXG4gIGlmIChwLmluY2x1ZGVzKCcqJykpIHtcbiAgICAvLyAqLnNob3AuY29tIC8gKkBzaG9wLmNvbSAvICpAKi5zaG9wLmNvbSBcdTIxOTIgc3VnZ2VzdCBzaG9wLmNvbVxuICAgIGxldCBjYW5kaWRhdGUgPSBwLnJlcGxhY2VBbGwoJyonLCAnJykucmVwbGFjZSgvXkAvLCAnJykucmVwbGFjZSgvXlxcLi8sICcnKVxuICAgIGlmIChjYW5kaWRhdGUuaW5jbHVkZXMoJ0AnKSkge1xuICAgICAgY2FuZGlkYXRlID0gY2FuZGlkYXRlLnNsaWNlKGNhbmRpZGF0ZS5sYXN0SW5kZXhPZignQCcpICsgMSlcbiAgICB9XG4gICAgaWYgKGlzVmFsaWRMaXRlcmFsRG9tYWluKGNhbmRpZGF0ZSkpIHtcbiAgICAgIHJldHVybiAoXG4gICAgICAgIGAke3ByZWZpeH06IHdpbGRjYXJkcyBhcmUgbm90IGFsbG93ZWQ7IHVzZSBcIiR7Y2FuZGlkYXRlfVwiIGAgK1xuICAgICAgICBgZm9yIHRoYXQgZG9tYWluIGFuZCBpdHMgc3ViZG9tYWlucy4gJHtET01BSU5fRklMVEVSX0hFTFB9YFxuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm4gYCR7cHJlZml4fTogd2lsZGNhcmRzIGFyZSBub3QgYWxsb3dlZC4gJHtET01BSU5fRklMVEVSX0hFTFB9YFxuICB9XG5cbiAgaWYgKCFwLmluY2x1ZGVzKCcuJykgJiYgIXAuaW5jbHVkZXMoJ0AnKSkge1xuICAgIHJldHVybiAoXG4gICAgICBgJHtwcmVmaXh9OiBtdXN0IGluY2x1ZGUgYSBkb21haW4gd2l0aCBhIGRvdCAoZS5nLiBcInNob3AuY29tXCIpLiBgICtcbiAgICAgIERPTUFJTl9GSUxURVJfSEVMUFxuICAgIClcbiAgfVxuXG4gIHJldHVybiBgJHtwcmVmaXh9LiAke0RPTUFJTl9GSUxURVJfSEVMUH1gXG59XG5cbi8qKlxuICogRXhwbGFpbnMgd2h5IGEgZnJvbS9kb21haW4gcGF0dGVybiBmYWlsZWQgdmFsaWRhdGlvbiwgd2l0aCBhIGZpeCBoaW50IHdoZW5cbiAqIHRoZSBtaXN0YWtlIGlzIHJlY29nbml6YWJsZSAoZS5nLiBgKmVudmlvLnNob3AuY29tYCBcdTIxOTIgYCouZW52aW8uc2hvcC5jb21gKS5cbiAqIFVzZWQgZm9yIHRlbXBsYXRlIG1hdGNoRnJvbVBhdHRlcm4gKHdpbGRjYXJkcyBhbGxvd2VkKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlSW52YWxpZEZyb21QYXR0ZXJuKFxuICByYXc6IHN0cmluZyxcbiAgbGFiZWw6IHN0cmluZyxcbik6IHN0cmluZyB7XG4gIGNvbnN0IHAgPSByYXcudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgY29uc3QgcHJlZml4ID0gYGludmFsaWQgJHtsYWJlbH0gXCIke3Jhd31cImBcblxuICBpZiAoIXApIHtcbiAgICByZXR1cm4gYCR7cHJlZml4fTogcGF0dGVybiBpcyBlbXB0eS4gJHtGUk9NX1BBVFRFUk5fSEVMUH1gXG4gIH1cblxuICAvLyBgKmVudmlvLnNhbnRhbmRlci5jb20ubXhgIFx1MjAxNCB3aWxkY2FyZCBtaXNzaW5nIHRoZSBkb3QgKG9yIEApLlxuICBpZiAocC5zdGFydHNXaXRoKCcqJykgJiYgIXAuc3RhcnRzV2l0aCgnKi4nKSAmJiAhcC5zdGFydHNXaXRoKCcqQCcpKSB7XG4gICAgY29uc3QgcmVzdCA9IHAuc2xpY2UoMSlcbiAgICBpZiAocmVzdC5pbmNsdWRlcygnLicpICYmICFyZXN0LmluY2x1ZGVzKCcqJykgJiYgaXNWYWxpZERvbWFpblBhdHRlcm4ocmVzdCkpIHtcbiAgICAgIHJldHVybiAoXG4gICAgICAgIGAke3ByZWZpeH06IHVzZSBcIiouJHtyZXN0fVwiIGZvciBzdWJkb21haW5zIG9mICR7cmVzdH0sIGAgK1xuICAgICAgICBgb3IgXCIke3Jlc3R9XCIgZm9yIHRoYXQgZG9tYWluIGFuZCBpdHMgc3ViZG9tYWlucy4gJHtGUk9NX1BBVFRFUk5fSEVMUH1gXG4gICAgICApXG4gICAgfVxuICAgIHJldHVybiAoXG4gICAgICBgJHtwcmVmaXh9OiB3aWxkY2FyZCBtdXN0IGJlIFwiKi5kb21haW4udGxkXCIgb3IgXCIqQGRvbWFpbi50bGRcIi4gYCArXG4gICAgICBGUk9NX1BBVFRFUk5fSEVMUFxuICAgIClcbiAgfVxuXG4gIC8vIGAqLmNvbWAgLyBgKkAqYCBcdTIwMTQgbmVlZHMgYSBtdWx0aS1wYXJ0IGRvbWFpbi5cbiAgaWYgKFxuICAgIChwLnN0YXJ0c1dpdGgoJyouJykgJiYgIXAuc2xpY2UoMikuaW5jbHVkZXMoJy4nKSkgfHxcbiAgICAocC5pbmNsdWRlcygnQCcpICYmIHAuZW5kc1dpdGgoJ0AqJykpXG4gICkge1xuICAgIHJldHVybiAoXG4gICAgICBgJHtwcmVmaXh9OiB3aWxkY2FyZCBuZWVkcyBhIG11bHRpLXBhcnQgZG9tYWluIGAgK1xuICAgICAgYChlLmcuIFwiKi5zaG9wLmNvbVwiKSwgbm90IGEgYmFyZSBUTEQuICR7RlJPTV9QQVRURVJOX0hFTFB9YFxuICAgIClcbiAgfVxuXG4gIGlmICghcC5pbmNsdWRlcygnLicpICYmICFwLmluY2x1ZGVzKCdAJykpIHtcbiAgICByZXR1cm4gKFxuICAgICAgYCR7cHJlZml4fTogbXVzdCBpbmNsdWRlIGEgZG9tYWluIHdpdGggYSBkb3QgKGUuZy4gXCJzaG9wLmNvbVwiKS4gYCArXG4gICAgICBGUk9NX1BBVFRFUk5fSEVMUFxuICAgIClcbiAgfVxuXG4gIHJldHVybiBgJHtwcmVmaXh9LiAke0ZST01fUEFUVEVSTl9IRUxQfWBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3ViamVjdFJlZ2V4KFxuICByZWdleDogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAocmVnZXggPT09IG51bGwgfHwgcmVnZXggPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGxcbiAgY29uc3QgdHJpbW1lZCA9IHJlZ2V4LnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHJldHVybiBudWxsXG4gIHRyeSB7XG4gICAgbmV3IFJlZ0V4cCh0cmltbWVkLCAnaScpXG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKCdtYXRjaFN1YmplY3RSZWdleCBpcyBub3QgYSB2YWxpZCByZWdleHAnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNhdGVnb3J5SWQoY2F0ZWdvcnlJZDogdW5rbm93bik6IG51bWJlciB7XG4gIGlmIChcbiAgICB0eXBlb2YgY2F0ZWdvcnlJZCAhPT0gJ251bWJlcicgfHxcbiAgICAhTnVtYmVyLmlzSW50ZWdlcihjYXRlZ29yeUlkKSB8fFxuICAgIGNhdGVnb3J5SWQgPCAxXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkTWFpbGJveEVycm9yKFxuICAgICAgJ2NhdGVnb3J5SWQgaXMgcmVxdWlyZWQgd2hlbiBhY2NlcHRpbmcgYSBzcGVuZGluZyBjYW5kaWRhdGUnLFxuICAgIClcbiAgfVxuICByZXR1cm4gY2F0ZWdvcnlJZFxufVxuXG4vKipcbiAqIFBhcnNlIG9wdGlvbmFsIElTTyBkYXRlIHN0cmluZyBmb3Igc3luYyByYW5nZS4gRW1wdHkvbnVsbCBcdTIxOTIgbnVsbC5cbiAqIFJldHVybnMgSVNPIHN0cmluZyBzdWl0YWJsZSBmb3IgdGltZXN0YW1wdHogY29sdW1ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlT3B0aW9uYWxTeW5jRGF0ZShcbiAgdmFsdWU6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsXG4gIGZpZWxkOiAnc2luY2UnIHwgJ3VudGlsJyxcbik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGxcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHJldHVybiBudWxsXG4gIGNvbnN0IG1zID0gRGF0ZS5wYXJzZSh0cmltbWVkKVxuICBpZiAoIU51bWJlci5pc0Zpbml0ZShtcykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZE1haWxib3hFcnJvcihgJHtmaWVsZH0gbXVzdCBiZSBhIHZhbGlkIElTTyBkYXRlYClcbiAgfVxuICByZXR1cm4gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3luY0RhdGVSYW5nZShcbiAgc2luY2U6IHN0cmluZyB8IG51bGwsXG4gIHVudGlsOiBzdHJpbmcgfCBudWxsLFxuKTogeyBzaW5jZTogc3RyaW5nIHwgbnVsbDsgdW50aWw6IHN0cmluZyB8IG51bGwgfSB7XG4gIGlmIChzaW5jZSAmJiB1bnRpbCAmJiBEYXRlLnBhcnNlKHNpbmNlKSA+IERhdGUucGFyc2UodW50aWwpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRNYWlsYm94RXJyb3IoJ3NpbmNlIG11c3QgYmUgbGVzcyB0aGFuIG9yIGVxdWFsIHRvIHVudGlsJylcbiAgfVxuICByZXR1cm4geyBzaW5jZSwgdW50aWwgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY2xhbXBBcnRpZmFjdFBhZ2UoXG4gIHBhZ2U/OiBudW1iZXIgfCBudWxsLFxuICBwYWdlU2l6ZT86IG51bWJlciB8IG51bGwsXG4pOiB7IHBhZ2U6IG51bWJlcjsgcGFnZVNpemU6IG51bWJlcjsgb2Zmc2V0OiBudW1iZXIgfSB7XG4gIGNvbnN0IHAgPSB0eXBlb2YgcGFnZSA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzRmluaXRlKHBhZ2UpID8gcGFnZSA6IDFcbiAgY29uc3Qgc2l6ZSA9XG4gICAgdHlwZW9mIHBhZ2VTaXplID09PSAnbnVtYmVyJyAmJiBOdW1iZXIuaXNGaW5pdGUocGFnZVNpemUpID8gcGFnZVNpemUgOiAyMFxuICBjb25zdCBzYWZlUGFnZSA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IocCkpXG4gIGNvbnN0IHNhZmVTaXplID0gTWF0aC5taW4oMTAwLCBNYXRoLm1heCgxLCBNYXRoLmZsb29yKHNpemUpKSlcbiAgcmV0dXJuIHtcbiAgICBwYWdlOiBzYWZlUGFnZSxcbiAgICBwYWdlU2l6ZTogc2FmZVNpemUsXG4gICAgb2Zmc2V0OiAoc2FmZVBhZ2UgLSAxKSAqIHNhZmVTaXplLFxuICB9XG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVtb3RlSldLU2V0LCBqd3RWZXJpZnkgfSBmcm9tICdqb3NlJ1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcblxuY29uc3QgQVVUSF9BUElfRE9NQUlOID1cbiAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVVUSF9BUElfRE9NQUlOKSB8fFxuICAnaHR0cDovL2xvY2FsaG9zdDozMDAxJ1xuY29uc3QgSldLU19VUkwgPSBgJHtBVVRIX0FQSV9ET01BSU59L2F1dGgvand0L2p3a3MuanNvbmBcblxuY29uc3QgandrcyA9IGNyZWF0ZVJlbW90ZUpXS1NldChuZXcgVVJMKEpXS1NfVVJMKSlcblxuZXhwb3J0IHR5cGUgVmVyaWZpZWRBdXRoID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUFjY2Vzc1Rva2VuKFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4pOiBQcm9taXNlPFZlcmlmaWVkQXV0aCB8IG51bGw+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBhdXRob3JpemF0aW9uSGVhZGVyLnNsaWNlKCdCZWFyZXIgJy5sZW5ndGgpLnRyaW0oKVxuICBpZiAoIXRva2VuKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBwYXlsb2FkIH0gPSBhd2FpdCBqd3RWZXJpZnkodG9rZW4sIGp3a3MsIHtcbiAgICAgIGFsZ29yaXRobXM6IFsnUlMyNTYnXSxcbiAgICB9KVxuXG4gICAgY29uc3QgYXV0aFVzZXJJZCA9IHR5cGVvZiBwYXlsb2FkLnN1YiA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLnN1YiA6IG51bGxcbiAgICBpZiAoIWF1dGhVc2VySWQpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgZW1haWwgPVxuICAgICAgdHlwZW9mIHBheWxvYWQuZW1haWwgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5lbWFpbCA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHsgYXV0aFVzZXJJZCwgZW1haWwgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpOiBSZXNwb25zZSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1VuYXV0aG9yaXplZCcgfSksIHtcbiAgICBzdGF0dXM6IDQwMSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgfSxcbiAgfSlcbn1cblxuLyoqIENPUlMgcHJlZmxpZ2h0IC8gc2ltcGxlIHJlc3BvbnNlcyBmb3IgYnJvd3NlciBHcmFwaFFMIGNsaWVudHMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29yc01pZGRsZXdhcmUoY3R4OiBDb250ZXh0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7XG4gICAgICBzdGF0dXM6IDIwNCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcblxuICBjdHgucmVzLmhlYWRlcnMuc2V0KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLFxuICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gIClcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsXG4gICAgJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gIClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHtcbiAgdW5hdXRob3JpemVkUmVzcG9uc2UsXG4gIHZlcmlmeUFjY2Vzc1Rva2VuLFxuICB0eXBlIFZlcmlmaWVkQXV0aCxcbn0gZnJvbSAnLi4vYXV0aC92ZXJpZnkudHMnXG5cbi8qKiBQdWJsaWMgQUxCIC8gbG9hZC1iYWxhbmNlciBoZWFsdGggY2hlY2suICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGVhbHRoTWlkZGxld2FyZShcbiAgY3R4OiBDb250ZXh0LFxuICBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuKSB7XG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuICBpZiAocGF0aCA9PT0gJy9oZWFsdGgnICYmIGN0eC5yZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogdHJ1ZSB9KSwge1xuICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cbiAgYXdhaXQgbmV4dCgpXG59XG5cbmV4cG9ydCB0eXBlIExvY2FsVXNlclJlZiA9IHtcbiAgaWQ6IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBSZXNvbHZlTG9jYWxVc2VyRm4gPSAoXG4gIGlkZW50aXR5OiBWZXJpZmllZEF1dGgsXG4pID0+IFByb21pc2U8TG9jYWxVc2VyUmVmPlxuXG4vKipcbiAqIFJlcXVpcmUgYSB2YWxpZCBCZWFyZXIgSldUIG9uIGAvZ3JhcGhxbGAgYW5kIHNldCBQeWxvbiBjb250ZXh0IHZhcnM6XG4gKiBgdXNlcklkYCwgYGF1dGhVc2VySWRgLCBvcHRpb25hbCBgYXV0aEVtYWlsYC5cbiAqXG4gKiBDYWxsZXJzIHRoYXQgbmVlZCBhdXRoIGZvciBvdGhlciBwYXRocyAoZS5nLiBSRVNUIGFzc2V0cykgc2hvdWxkIGhhbmRsZVxuICogdGhvc2UgYmVmb3JlIHRoaXMgbWlkZGxld2FyZSBvciB1c2UgYHZlcmlmeUFjY2Vzc1Rva2VuYCBkaXJlY3RseS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZShcbiAgcmVzb2x2ZUxvY2FsVXNlcjogUmVzb2x2ZUxvY2FsVXNlckZuLFxuKSB7XG4gIHJldHVybiBhc3luYyBmdW5jdGlvbiBncmFwaFFMQXV0aE1pZGRsZXdhcmUoXG4gICAgY3R4OiBDb250ZXh0LFxuICAgIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4sXG4gICkge1xuICAgIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgICBhd2FpdCBuZXh0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuXG4gICAgaWYgKFxuICAgICAgcGF0aCA9PT0gJy9oZWFsdGgnIHx8XG4gICAgICAocGF0aCAhPT0gJy9ncmFwaHFsJyAmJiAhcGF0aC5lbmRzV2l0aCgnL2dyYXBocWwnKSlcbiAgICApIHtcbiAgICAgIGF3YWl0IG5leHQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlBY2Nlc3NUb2tlbihjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpKVxuICAgIGlmICghdmVyaWZpZWQpIHtcbiAgICAgIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbG9jYWxVc2VyID0gYXdhaXQgcmVzb2x2ZUxvY2FsVXNlcih2ZXJpZmllZClcblxuICAgIGN0eC5zZXQoJ2F1dGhVc2VySWQnLCB2ZXJpZmllZC5hdXRoVXNlcklkKVxuICAgIGlmICh2ZXJpZmllZC5lbWFpbCkge1xuICAgICAgY3R4LnNldCgnYXV0aEVtYWlsJywgdmVyaWZpZWQuZW1haWwpXG4gICAgfVxuICAgIGN0eC5zZXQoJ3VzZXJJZCcsIGxvY2FsVXNlci5pZClcblxuICAgIGF3YWl0IG5leHQoKVxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEt5c2VseSwgU2VsZWN0YWJsZSB9IGZyb20gJ2t5c2VseSdcblxuLyoqIE1pbmltYWwgdXNlcnMgdGFibGUgc2hhcGUgcmVxdWlyZWQgYnkgcmVzb2x2ZUxvY2FsVXNlci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXNlcnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBlbWFpbDogc3RyaW5nXG4gIHBhc3N3b3JkX2hhc2g6IHN0cmluZyB8IG51bGxcbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIFVzZXJzRGF0YWJhc2UgPSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG59XG5cbmV4cG9ydCB0eXBlIExvY2FsVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQXV0aElkZW50aXR5ID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbiAgbmFtZT86IHN0cmluZ1xufVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcjxEQiBleHRlbmRzIFVzZXJzRGF0YWJhc2U+KFxuICBkYjogS3lzZWx5PERCPixcbiAgaWRlbnRpdHk6IEF1dGhJZGVudGl0eSxcbik6IFByb21pc2U8U2VsZWN0YWJsZTxEQlsndXNlcnMnXT4+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdhdXRoX3VzZXJfaWQnLCAnPScsIGlkZW50aXR5LmF1dGhVc2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChleGlzdGluZykge1xuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgY29uc3QgZW1haWwgPVxuICAgIGlkZW50aXR5LmVtYWlsPy50cmltKCkgfHxcbiAgICBgJHtpZGVudGl0eS5hdXRoVXNlcklkfUB1c2Vycy5sb2NhbGBcbiAgY29uc3QgbmFtZSA9XG4gICAgaWRlbnRpdHkubmFtZT8udHJpbSgpIHx8XG4gICAgZW1haWwuc3BsaXQoJ0AnKVswXSB8fFxuICAgICdVc2VyJ1xuXG4gIC8vIFByZWZlciBsaW5raW5nIGFuIGV4aXN0aW5nIGVtYWlsIHJvdyAoZS5nLiBzZWVkZWQgZGV2IHVzZXIpIHdoZW4gcHJlc2VudC5cbiAgY29uc3QgYnlFbWFpbCA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2VtYWlsJywgJz0nLCBlbWFpbClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGJ5RW1haWwpIHtcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgndXNlcnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgICAgbmFtZTogYnlFbWFpbC5uYW1lIHx8IG5hbWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBieUVtYWlsLmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ3VzZXJzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGVtYWlsLFxuICAgICAgbmFtZSxcbiAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgIHBhc3N3b3JkX2hhc2g6IG51bGwsXG4gICAgfSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuIiwgImltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYXRhYmFzZS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgYXMgcmVzb2x2ZUxvY2FsVXNlcktpdCB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cydcbmltcG9ydCB0eXBlIHsgQXV0aElkZW50aXR5IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBVc2VyIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIHsgQXV0aElkZW50aXR5IH1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVMb2NhbFVzZXIoaWRlbnRpdHk6IEF1dGhJZGVudGl0eSk6IFByb21pc2U8VXNlcj4ge1xuICByZXR1cm4gcmVzb2x2ZUxvY2FsVXNlcktpdChkYiwgaWRlbnRpdHkpXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHkgfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7IERhdGFiYXNlIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHtcbiAgR21haWxPQXV0aEVycm9yLFxuICBidWlsZFJldHVyblJlZGlyZWN0LFxuICBleGNoYW5nZUF1dGhvcml6YXRpb25Db2RlLFxuICBmZXRjaEdtYWlsRW1haWxBZGRyZXNzLFxuICBpc1JldHVyblRvQWxsb3dlZCxcbiAgbG9hZEdtYWlsT0F1dGhDb25maWcsXG4gIHZlcmlmeU9BdXRoU3RhdGUsXG4gIHR5cGUgR21haWxPQXV0aENvbmZpZyxcbn0gZnJvbSAnLi9nbWFpbF9vYXV0aC50cydcblxuZXhwb3J0IGludGVyZmFjZSBHbWFpbE9BdXRoQ2FsbGJhY2tEZXBzIHtcbiAgZGI6IEt5c2VseTxEYXRhYmFzZT5cbiAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoXG4gIG5vd01zPzogbnVtYmVyXG4gIGxvYWRDb25maWc/OiAoKSA9PiBHbWFpbE9BdXRoQ29uZmlnXG59XG5cbi8qKlxuICogSGFuZGxlIEdvb2dsZSBPQXV0aCByZWRpcmVjdDogdmVyaWZ5IHN0YXRlLCBleGNoYW5nZSBjb2RlLCBwZXJzaXN0IHRva2Vucy5cbiAqIFJldHVybnMgYSAzMDIgTG9jYXRpb24gdG93YXJkIHRoZSBGbHV0dGVyIHJldHVyblRvIFVSTC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZUdtYWlsT0F1dGhDYWxsYmFjayhcbiAgcmVxdWVzdFVybDogVVJMLFxuICBkZXBzOiBHbWFpbE9BdXRoQ2FsbGJhY2tEZXBzLFxuKTogUHJvbWlzZTxSZXNwb25zZT4ge1xuICBjb25zdCBjb2RlID0gcmVxdWVzdFVybC5zZWFyY2hQYXJhbXMuZ2V0KCdjb2RlJylcbiAgY29uc3Qgc3RhdGUgPSByZXF1ZXN0VXJsLnNlYXJjaFBhcmFtcy5nZXQoJ3N0YXRlJylcbiAgY29uc3Qgb2F1dGhFcnJvciA9IHJlcXVlc3RVcmwuc2VhcmNoUGFyYW1zLmdldCgnZXJyb3InKVxuXG4gIGxldCBjb25maWc6IEdtYWlsT0F1dGhDb25maWdcbiAgdHJ5IHtcbiAgICBjb25maWcgPSAoZGVwcy5sb2FkQ29uZmlnID8/IGxvYWRHbWFpbE9BdXRoQ29uZmlnKSgpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJ29hdXRoX2NvbmZpZ19lcnJvcidcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKGBHbWFpbCBPQXV0aCBtaXNjb25maWd1cmVkOiAke21lc3NhZ2V9YCwge1xuICAgICAgc3RhdHVzOiA1MDAsXG4gICAgfSlcbiAgfVxuXG4gIC8vIEJlc3QtZWZmb3J0IGRlY29kZSBvZiByZXR1cm5UbyBmcm9tIHN0YXRlIGZvciBlcnJvciByZWRpcmVjdHMuXG4gIGxldCByZXR1cm5Ub0ZhbGxiYWNrOiBzdHJpbmcgfCBudWxsID0gbnVsbFxuICBpZiAoc3RhdGUpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGF5bG9hZCA9IGF3YWl0IHZlcmlmeU9BdXRoU3RhdGUoXG4gICAgICAgIHN0YXRlLFxuICAgICAgICBjb25maWcuY2xpZW50U2VjcmV0LFxuICAgICAgICBkZXBzLm5vd01zLFxuICAgICAgKVxuICAgICAgcmV0dXJuVG9GYWxsYmFjayA9IHBheWxvYWQucmV0dXJuVG9cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGlnbm9yZSBcdTIwMTQgaGFuZGxlZCBiZWxvd1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHJlZGlyZWN0RXJyb3IgPSAoZXJyb3I6IHN0cmluZywgcmV0dXJuVG86IHN0cmluZyB8IG51bGwpID0+IHtcbiAgICBpZiAocmV0dXJuVG8gJiYgaXNSZXR1cm5Ub0FsbG93ZWQocmV0dXJuVG8sIGNvbmZpZy5yZXR1cm5Ub0FsbG93bGlzdCkpIHtcbiAgICAgIHJldHVybiBSZXNwb25zZS5yZWRpcmVjdChcbiAgICAgICAgYnVpbGRSZXR1cm5SZWRpcmVjdChyZXR1cm5UbywgeyBvazogZmFsc2UsIGVycm9yIH0pLFxuICAgICAgICAzMDIsXG4gICAgICApXG4gICAgfVxuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoYEdtYWlsIE9BdXRoIGZhaWxlZDogJHtlcnJvcn1gLCB7IHN0YXR1czogNDAwIH0pXG4gIH1cblxuICBpZiAob2F1dGhFcnJvcikge1xuICAgIHJldHVybiByZWRpcmVjdEVycm9yKG9hdXRoRXJyb3IsIHJldHVyblRvRmFsbGJhY2spXG4gIH1cbiAgaWYgKCFjb2RlIHx8ICFzdGF0ZSkge1xuICAgIHJldHVybiByZWRpcmVjdEVycm9yKCdtaXNzaW5nX2NvZGVfb3Jfc3RhdGUnLCByZXR1cm5Ub0ZhbGxiYWNrKVxuICB9XG5cbiAgbGV0IHBheWxvYWRcbiAgdHJ5IHtcbiAgICBwYXlsb2FkID0gYXdhaXQgdmVyaWZ5T0F1dGhTdGF0ZShzdGF0ZSwgY29uZmlnLmNsaWVudFNlY3JldCwgZGVwcy5ub3dNcylcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGVyciBpbnN0YW5jZW9mIEdtYWlsT0F1dGhFcnJvclxuICAgICAgPyBlcnIubWVzc2FnZVxuICAgICAgOiAnaW52YWxpZF9zdGF0ZSdcbiAgICByZXR1cm4gcmVkaXJlY3RFcnJvcihtZXNzYWdlLCByZXR1cm5Ub0ZhbGxiYWNrKVxuICB9XG5cbiAgaWYgKCFpc1JldHVyblRvQWxsb3dlZChwYXlsb2FkLnJldHVyblRvLCBjb25maWcucmV0dXJuVG9BbGxvd2xpc3QpKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZSgnR21haWwgT0F1dGggZmFpbGVkOiByZXR1cm5UbyBpcyBub3QgYWxsb3dlZCcsIHtcbiAgICAgIHN0YXR1czogNDAwLFxuICAgIH0pXG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHRva2VucyA9IGF3YWl0IGV4Y2hhbmdlQXV0aG9yaXphdGlvbkNvZGUoe1xuICAgICAgY29kZSxcbiAgICAgIGNsaWVudElkOiBjb25maWcuY2xpZW50SWQsXG4gICAgICBjbGllbnRTZWNyZXQ6IGNvbmZpZy5jbGllbnRTZWNyZXQsXG4gICAgICByZWRpcmVjdFVyaTogY29uZmlnLnJlZGlyZWN0VXJpLFxuICAgICAgZmV0Y2hJbXBsOiBkZXBzLmZldGNoSW1wbCxcbiAgICB9KVxuXG4gICAgY29uc3QgbWFpbGJveCA9IGF3YWl0IGRlcHMuZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdtYWlsYm94ZXMnKVxuICAgICAgLnNlbGVjdChbJ2lkJywgJ3VzZXJfaWQnLCAncHJvdmlkZXInXSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIHBheWxvYWQubWFpbGJveElkKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFtYWlsYm94IHx8IG1haWxib3gudXNlcl9pZCAhPT0gcGF5bG9hZC51c2VySWQpIHtcbiAgICAgIHJldHVybiByZWRpcmVjdEVycm9yKCdtYWlsYm94X25vdF9mb3VuZCcsIHBheWxvYWQucmV0dXJuVG8pXG4gICAgfVxuICAgIGlmIChtYWlsYm94LnByb3ZpZGVyICE9PSAnZ21haWwnKSB7XG4gICAgICByZXR1cm4gcmVkaXJlY3RFcnJvcignbWFpbGJveF9ub3RfZ21haWwnLCBwYXlsb2FkLnJldHVyblRvKVxuICAgIH1cblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKFxuICAgICAgZGVwcy5ub3dNcyA/PyBEYXRlLm5vdygpLFxuICAgICkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IGVtYWlsID0gYXdhaXQgZmV0Y2hHbWFpbEVtYWlsQWRkcmVzcyh7XG4gICAgICBhY2Nlc3NUb2tlbjogdG9rZW5zLmFjY2Vzc1Rva2VuLFxuICAgICAgZmV0Y2hJbXBsOiBkZXBzLmZldGNoSW1wbCxcbiAgICB9KVxuICAgIGF3YWl0IGRlcHMuZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnbWFpbGJveGVzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBvYXV0aF90b2tlbnNfanNvbjogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGFjY2Vzc1Rva2VuOiB0b2tlbnMuYWNjZXNzVG9rZW4sXG4gICAgICAgICAgcmVmcmVzaFRva2VuOiB0b2tlbnMucmVmcmVzaFRva2VuLFxuICAgICAgICAgIGV4cGlyZXNBdE1zOiB0b2tlbnMuZXhwaXJlc0F0TXMsXG4gICAgICAgIH0pLFxuICAgICAgICAuLi4oZW1haWwgPyB7IGxhYmVsOiBlbWFpbCB9IDoge30pLFxuICAgICAgICBzeW5jX3JlcXVlc3RlZDogdHJ1ZSxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIG1haWxib3guaWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gUmVzcG9uc2UucmVkaXJlY3QoXG4gICAgICBidWlsZFJldHVyblJlZGlyZWN0KHBheWxvYWQucmV0dXJuVG8sIHsgb2s6IHRydWUgfSksXG4gICAgICAzMDIsXG4gICAgKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gZXJyIGluc3RhbmNlb2YgR21haWxPQXV0aEVycm9yXG4gICAgICA/IGVyci5tZXNzYWdlXG4gICAgICA6ICd0b2tlbl9leGNoYW5nZV9mYWlsZWQnXG4gICAgcmV0dXJuIHJlZGlyZWN0RXJyb3IobWVzc2FnZSwgcGF5bG9hZC5yZXR1cm5UbylcbiAgfVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLFNBQVMsV0FBVzs7O0FDQXBCLFNBQVMsa0JBQWtCOzs7QUM4Q3BCLElBQU0sMEJBQTBCOzs7QUNOaEMsU0FBUyxtQkFDZCxhQUNBLFNBQ1M7QUFDVCxRQUFNLGlCQUFpQixjQUFjLFdBQVc7QUFDaEQsTUFBSSxDQUFDLGVBQWdCLFFBQU87QUFDNUIsUUFBTSxJQUFJLFFBQVEsS0FBSyxFQUFFLFlBQVk7QUFDckMsTUFBSSxDQUFDLEVBQUcsUUFBTztBQUNmLFNBQU8scUJBQXFCLGdCQUFnQixDQUFDO0FBQy9DO0FBRU8sU0FBUyxjQUNkLE1BQ3lEO0FBQ3pELFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFFMUIsUUFBTSxRQUFRLFFBQVEsTUFBTSxXQUFXO0FBQ3ZDLFFBQU0sU0FBUyxRQUFRLENBQUMsS0FBSyxTQUFTLEtBQUssRUFBRSxZQUFZO0FBQ3pELFFBQU0sS0FBSyxNQUFNLFlBQVksR0FBRztBQUNoQyxNQUFJLE1BQU0sS0FBSyxPQUFPLE1BQU0sU0FBUyxFQUFHLFFBQU87QUFDL0MsUUFBTSxRQUFRLE1BQU0sTUFBTSxHQUFHLEVBQUU7QUFDL0IsUUFBTSxTQUFTLE1BQU0sTUFBTSxLQUFLLENBQUM7QUFDakMsTUFBSSxDQUFDLE9BQU8sU0FBUyxHQUFHLEVBQUcsUUFBTztBQUNsQyxTQUFPLEVBQUUsT0FBTyxPQUFPLE9BQU87QUFDaEM7QUFFQSxTQUFTLHFCQUNQLE1BQ0EsU0FDUztBQUNULE1BQUksUUFBUSxTQUFTLEdBQUcsR0FBRztBQUN6QixXQUFPLHNCQUFzQixNQUFNLE9BQU87QUFBQSxFQUM1QztBQUNBLFNBQU8scUJBQXFCLEtBQUssUUFBUSxPQUFPO0FBQ2xEO0FBRUEsU0FBUyxzQkFDUCxNQUNBLFNBQ1M7QUFDVCxRQUFNLEtBQUssUUFBUSxZQUFZLEdBQUc7QUFDbEMsTUFBSSxNQUFNLEtBQUssT0FBTyxRQUFRLFNBQVMsRUFBRyxRQUFPO0FBQ2pELFFBQU0sV0FBVyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQ3BDLFFBQU0sWUFBWSxRQUFRLE1BQU0sS0FBSyxDQUFDO0FBRXRDLE1BQUksYUFBYSxPQUFPLGFBQWEsS0FBSyxNQUFPLFFBQU87QUFHeEQsTUFBSSxVQUFVLFdBQVcsSUFBSSxHQUFHO0FBQzlCLFdBQU8scUJBQXFCLEtBQUssUUFBUSxTQUFTO0FBQUEsRUFDcEQ7QUFDQSxTQUFPLEtBQUssV0FBVztBQUN6QjtBQUVBLFNBQVMscUJBQXFCLFFBQWdCLFNBQTBCO0FBQ3RFLE1BQUksUUFBUSxXQUFXLElBQUksR0FBRztBQUM1QixVQUFNLFNBQVMsUUFBUSxNQUFNLENBQUM7QUFDOUIsUUFBSSxDQUFDLE9BQU8sU0FBUyxHQUFHLEVBQUcsUUFBTztBQUVsQyxXQUFPLE9BQU8sU0FBUyxJQUFJLE1BQU0sRUFBRTtBQUFBLEVBQ3JDO0FBQ0EsU0FBTyxXQUFXLFdBQVcsT0FBTyxTQUFTLElBQUksT0FBTyxFQUFFO0FBQzVEOzs7QUN4Rk8sU0FBUyx1QkFDZCxTQUNBLFVBQ1M7QUFDVCxNQUFJLFNBQVMsWUFBWSxNQUFPLFFBQU87QUFDdkMsTUFBSSxDQUFDLG1CQUFtQixRQUFRLE1BQU0sU0FBUyxnQkFBZ0IsR0FBRztBQUNoRSxXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sWUFBWSxTQUFTLG1CQUFtQixLQUFLO0FBQ25ELE1BQUksV0FBVztBQUNiLFFBQUk7QUFDRixVQUFJLENBQUMsSUFBSSxPQUFPLFdBQVcsR0FBRyxFQUFFLEtBQUssUUFBUSxPQUFPLEVBQUcsUUFBTztBQUFBLElBQ2hFLFFBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFHTyxTQUFTLDBCQUNkLFNBQ0EsV0FDUztBQUNULFNBQU8sVUFBVSxLQUFLLENBQUMsTUFBTSx1QkFBdUIsU0FBUyxDQUFDLENBQUM7QUFDakU7OztBQ3BCTyxJQUFNLG9CQUFOLE1BQXdCO0FBQUEsRUFHN0IsWUFDbUIsWUFDakIsU0FDQTtBQUZpQjtBQUdqQixTQUFLLGlCQUFpQixTQUFTLGtCQUFrQjtBQUFBLEVBQ25EO0FBQUEsRUFQaUI7QUFBQSxFQVNqQixJQUFJLFNBQTZDO0FBQy9DLFVBQU0sTUFBNEIsQ0FBQztBQUNuQyxlQUFXLGFBQWEsS0FBSyxZQUFZO0FBQ3ZDLFVBQUksQ0FBQyxVQUFVLFVBQVUsT0FBTyxFQUFHO0FBQ25DLFlBQU0sT0FBTyxVQUFVLFFBQVEsT0FBTztBQUN0QyxVQUFJLEtBQUssV0FBVyxFQUFHO0FBQ3ZCLFVBQUksS0FBSyxHQUFHLElBQUk7QUFDaEIsVUFBSSxLQUFLLGVBQWdCLFFBQU87QUFBQSxJQUNsQztBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0Y7OztBQ3BDTyxTQUFTLGdCQUFnQixNQUF5QztBQUN2RSxNQUFJLENBQUMsS0FBTSxRQUFPO0FBRWxCLE1BQUksSUFBSTtBQUdSLE1BQUksRUFBRSxRQUFRLG9CQUFvQixFQUFFO0FBR3BDLE1BQUksRUFBRSxRQUFRLCtCQUErQixFQUFFO0FBQy9DLE1BQUksRUFBRSxRQUFRLDZCQUE2QixFQUFFO0FBQzdDLE1BQUksRUFBRSxRQUFRLDJCQUEyQixFQUFFO0FBQzNDLE1BQUksRUFBRSxRQUFRLG1DQUFtQyxFQUFFO0FBR25ELE1BQUksRUFBRSxRQUFRLGdCQUFnQixJQUFJO0FBQ2xDLE1BQUksRUFBRSxRQUFRLDRDQUE0QyxJQUFJO0FBRTlELE1BQUksRUFBRSxRQUFRLGVBQWUsR0FBRztBQUNoQyxNQUFJLEVBQUUsUUFBUSxlQUFlLEdBQUc7QUFHaEMsTUFBSSxFQUFFLFFBQVEsWUFBWSxFQUFFO0FBRTVCLE1BQUksbUJBQW1CLENBQUM7QUFHeEIsTUFBSSxFQUNELE1BQU0sSUFBSSxFQUNWLElBQUksQ0FBQyxTQUFTLEtBQUssUUFBUSxlQUFlLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFDckQsS0FBSyxJQUFJO0FBQ1osTUFBSSxFQUFFLFFBQVEsV0FBVyxNQUFNO0FBQy9CLFNBQU8sRUFBRSxLQUFLO0FBQ2hCO0FBR08sU0FBUyxjQUFjLE9BQXdCO0FBQ3BELFNBQU8sZ0ZBQ0osS0FBSyxLQUFLO0FBQ2Y7QUFNTyxTQUFTLGdCQUNkLFVBQ0EsVUFDZTtBQUNmLFFBQU0sT0FBTyxVQUFVLEtBQUs7QUFDNUIsTUFBSSxRQUFRLENBQUMsY0FBYyxJQUFJLEVBQUcsUUFBTztBQUV6QyxRQUFNLFdBQVcsZ0JBQWdCLFFBQVE7QUFDekMsTUFBSSxTQUFVLFFBQU87QUFFckIsTUFBSSxNQUFNO0FBQ1IsVUFBTSxXQUFXLGdCQUFnQixJQUFJO0FBQ3JDLFFBQUksU0FBVSxRQUFPO0FBQUEsRUFDdkI7QUFFQSxTQUFPO0FBQ1Q7QUFFQSxJQUFNLGlCQUF5QztBQUFBLEVBQzdDLEtBQUs7QUFBQSxFQUNMLElBQUk7QUFBQSxFQUNKLElBQUk7QUFBQSxFQUNKLE1BQU07QUFBQSxFQUNOLE1BQU07QUFBQSxFQUNOLE1BQU07QUFBQTtBQUFBLEVBRU4sUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsTUFBTTtBQUFBLEVBQ04sTUFBTTtBQUFBLEVBQ04sT0FBTztBQUFBLEVBQ1AsUUFBUTtBQUFBLEVBQ1IsTUFBTTtBQUFBLEVBQ04sS0FBSztBQUFBLEVBQ0wsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUFBLEVBQ1AsUUFBUTtBQUFBLEVBQ1IsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUNUO0FBRUEsU0FBUyxtQkFBbUIsR0FBbUI7QUFDN0MsU0FBTyxFQUFFO0FBQUEsSUFDUDtBQUFBLElBQ0EsQ0FBQyxPQUFPLFdBQW1CO0FBQ3pCLFVBQUksT0FBTyxDQUFDLE1BQU0sS0FBSztBQUNyQixjQUFNLE1BQU0sT0FBTyxDQUFDLE1BQU0sT0FBTyxPQUFPLENBQUMsTUFBTTtBQUMvQyxjQUFNLE9BQU8sTUFDVCxPQUFPLFNBQVMsT0FBTyxNQUFNLENBQUMsR0FBRyxFQUFFLElBQ25DLE9BQU8sU0FBUyxPQUFPLE1BQU0sQ0FBQyxHQUFHLEVBQUU7QUFDdkMsWUFBSSxPQUFPLFNBQVMsSUFBSSxLQUFLLFFBQVEsR0FBRztBQUN0QyxjQUFJO0FBQ0YsbUJBQU8sT0FBTyxjQUFjLElBQUk7QUFBQSxVQUNsQyxRQUFRO0FBQ04sbUJBQU87QUFBQSxVQUNUO0FBQUEsUUFDRjtBQUNBLGVBQU87QUFBQSxNQUNUO0FBQ0EsYUFBTyxlQUFlLE1BQU0sS0FBSztBQUFBLElBQ25DO0FBQUEsRUFDRjtBQUNGOzs7QUN0R08sSUFBTSw0QkFBTixNQUFxRDtBQUFBLEVBRzFELFlBQTZCLFVBQWdDO0FBQWhDO0FBQUEsRUFBaUM7QUFBQSxFQUZyRCxPQUFPO0FBQUEsRUFJaEIsSUFBSSxhQUFxQjtBQUN2QixXQUFPLEtBQUssU0FBUztBQUFBLEVBQ3ZCO0FBQUEsRUFFQSxVQUFVLFNBQWdDO0FBQ3hDLFdBQU8sdUJBQXVCLFNBQVMsS0FBSyxRQUFRO0FBQUEsRUFDdEQ7QUFBQSxFQUVBLFFBQVEsU0FBNkM7QUFDbkQsVUFBTSxVQUFVLGFBQWEsT0FBTztBQUVwQyxRQUFJLEtBQUssU0FBUyxXQUFXLFdBQVc7QUFDdEMsWUFBTSxPQUFPO0FBQUEsUUFDWCxLQUFLLFNBQVMsV0FBVztBQUFBLFFBQ3pCO0FBQUEsTUFDRjtBQUNBLFVBQUksU0FBUyxVQUFXLFFBQU8sQ0FBQztBQUFBLElBQ2xDO0FBRUEsVUFBTSxZQUFZLFdBQVcsS0FBSyxTQUFTLFdBQVcsUUFBUSxPQUFPO0FBQ3JFLFVBQU0sY0FBYyxrQkFBa0IsU0FBUztBQUMvQyxRQUFJLGdCQUFnQixLQUFNLFFBQU8sQ0FBQztBQUVsQyxVQUFNLGNBQWMsS0FBSyxTQUFTLFdBQVcsV0FDekMsV0FBVyxLQUFLLFNBQVMsV0FBVyxVQUFVLE9BQU8sSUFDckQ7QUFDSixVQUFNLFdBQVcsa0JBQWtCLFdBQVcsS0FBSztBQUVuRCxVQUFNLFVBQ0osZUFBZSxLQUFLLFNBQVMsV0FBVyxTQUFTLE9BQU8sS0FDeEQsYUFBYSxRQUFRLFVBQVU7QUFFakMsVUFBTSxXQUFXLEtBQUssU0FBUyxXQUFXLFdBQ3RDLFdBQVcsS0FBSyxTQUFTLFdBQVcsVUFBVSxPQUFPLElBQ3JEO0FBRUosVUFBTSxPQUFPLEtBQUssU0FBUyxXQUFXLE9BQ2xDLFdBQVcsS0FBSyxTQUFTLFdBQVcsTUFBTSxPQUFPLElBQ2pELFFBQVEsUUFBUSxNQUFNLEdBQUcsR0FBRyxLQUFLO0FBRXJDLFVBQU0sVUFBb0M7QUFBQSxNQUN4QztBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxVQUFVLFVBQVUsS0FBSyxJQUFJLFNBQVMsS0FBSyxFQUFFLE1BQU0sR0FBRyxHQUFHLElBQUk7QUFBQSxNQUM3RCxNQUFNLE1BQU0sS0FBSyxJQUFJLEtBQUssS0FBSyxFQUFFLE1BQU0sR0FBRyxHQUFHLElBQUk7QUFBQSxNQUNqRCxlQUFlLFFBQVE7QUFBQSxNQUN2QixZQUFZLFFBQVE7QUFBQSxNQUNwQixZQUFZLEtBQUssU0FBUztBQUFBLElBQzVCO0FBRUEsV0FBTztBQUFBLE1BQ0w7QUFBQSxRQUNFLE1BQU07QUFBQSxRQUNOLFNBQVMsRUFBRSxHQUFHLFFBQVE7QUFBQSxRQUN0QixZQUFZO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUFTQSxTQUFTLGFBQWEsU0FBZ0M7QUFDcEQsUUFBTSxPQUFPLGNBQWMsUUFBUSxJQUFJO0FBRXZDLFFBQU0sT0FBTyxnQkFBZ0IsUUFBUSxVQUFVLFFBQVEsUUFBUSxLQUFLO0FBQ3BFLFFBQU0sV0FBVyxnQkFBZ0IsUUFBUSxRQUFRO0FBQ2pELFNBQU87QUFBQSxJQUNMLFNBQVMsUUFBUSxXQUFXO0FBQUEsSUFDNUI7QUFBQTtBQUFBLElBRUEsV0FBVyxZQUFZO0FBQUEsSUFDdkIsYUFBYSxNQUFNLFVBQVU7QUFBQSxFQUMvQjtBQUNGO0FBRUEsU0FBUyxXQUNQLFdBQ0EsU0FDZTtBQUNmLE1BQUksVUFBVSxXQUFXLFlBQVk7QUFDbkMsV0FBTyxVQUFVO0FBQUEsRUFDbkI7QUFDQSxNQUFJLFVBQVUsV0FBVyxlQUFlO0FBQ3RDLFFBQUksQ0FBQyxRQUFRLFlBQWEsUUFBTztBQUNqQyxVQUFNLE9BQU8sUUFBUSxZQUFZLE1BQU0sR0FBRyxFQUFFLENBQUM7QUFDN0MsUUFBSSxDQUFDLEtBQU0sUUFBTztBQUNsQixXQUFPLEtBQUssT0FBTyxDQUFDLEVBQUUsWUFBWSxJQUFJLEtBQUssTUFBTSxDQUFDO0FBQUEsRUFDcEQ7QUFDQSxRQUFNLFdBQVcsUUFBUSxVQUFVLE1BQU07QUFDekMsTUFBSTtBQUNGLFVBQU0sS0FBSyxJQUFJLE9BQU8sVUFBVSxPQUFPLEdBQUc7QUFDMUMsVUFBTSxJQUFJLFNBQVMsTUFBTSxFQUFFO0FBQzNCLFVBQU0sUUFBUSxVQUFVO0FBQ3hCLFFBQUksQ0FBQyxLQUFLLFFBQVEsS0FBSyxTQUFTLEVBQUUsT0FBUSxRQUFPO0FBQ2pELFVBQU0sUUFBUSxFQUFFLEtBQUs7QUFDckIsV0FBTyxPQUFPLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSTtBQUFBLEVBQ3hDLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBRUEsU0FBUyxlQUNQLFdBQ0EsU0FDZTtBQUNmLE1BQUksQ0FBQyxVQUFXLFFBQU87QUFDdkIsTUFBSSxxQkFBcUIsU0FBUyxHQUFHO0FBQ25DLFdBQU8saUJBQWlCLFdBQVcsT0FBTztBQUFBLEVBQzVDO0FBQ0EsUUFBTSxhQUFhLFdBQVcsV0FBVyxPQUFPO0FBQ2hELFNBQU8sY0FBYyxVQUFVO0FBQ2pDO0FBRUEsU0FBUyxpQkFDUCxXQUNBLFNBQ2U7QUFDZixRQUFNLFdBQVcsUUFBUSxVQUFVLE1BQU07QUFDekMsTUFBSTtBQUNGLFVBQU0sS0FBSyxJQUFJLE9BQU8sVUFBVSxPQUFPLEdBQUc7QUFDMUMsVUFBTSxJQUFJLFNBQVMsTUFBTSxFQUFFO0FBQzNCLFFBQUksQ0FBQyxFQUFHLFFBQU87QUFDZixVQUFNLE9BQU8sT0FBTyxFQUFFLFVBQVUsU0FBUyxDQUFDO0FBQzFDLFVBQU0sUUFBUSxPQUFPLEVBQUUsVUFBVSxVQUFVLENBQUM7QUFDNUMsVUFBTSxNQUFNLE9BQU8sRUFBRSxVQUFVLFFBQVEsQ0FBQztBQUN4QyxRQUNFLENBQUMsT0FBTyxVQUFVLElBQUksS0FDdEIsQ0FBQyxPQUFPLFVBQVUsS0FBSyxLQUN2QixDQUFDLE9BQU8sVUFBVSxHQUFHLEdBQ3JCO0FBQ0EsYUFBTztBQUFBLElBQ1Q7QUFDQSxRQUFJLE9BQU8sT0FBUSxPQUFPLEtBQU0sUUFBTztBQUN2QyxRQUFJLFFBQVEsS0FBSyxRQUFRLEdBQUksUUFBTztBQUNwQyxRQUFJLE1BQU0sS0FBSyxNQUFNLEdBQUksUUFBTztBQUVoQyxVQUFNLFdBQVcsR0FBRyxJQUFJLElBQUksS0FBSyxLQUFLLENBQUMsSUFBSSxLQUFLLEdBQUcsQ0FBQztBQUNwRCxVQUFNLFFBQVEsb0JBQUksS0FBSyxHQUFHLFFBQVEsZ0JBQWdCO0FBQ2xELFFBQ0UsT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFDLEtBQzVCLE1BQU0sZUFBZSxNQUFNLFFBQzNCLE1BQU0sWUFBWSxJQUFJLE1BQU0sU0FDNUIsTUFBTSxXQUFXLE1BQU0sS0FDdkI7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUNBLFdBQU87QUFBQSxFQUNULFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBRUEsU0FBUyxrQkFDUCxXQUNBLFNBQ29DO0FBQ3BDLFFBQU0sV0FBVyxRQUFRLFVBQVUsTUFBTTtBQUN6QyxNQUFJO0FBQ0YsVUFBTSxLQUFLLElBQUksT0FBTyxVQUFVLE9BQU8sR0FBRztBQUMxQyxVQUFNLElBQUksU0FBUyxNQUFNLEVBQUU7QUFDM0IsVUFBTSxRQUFRLFVBQVU7QUFDeEIsUUFBSSxDQUFDLEtBQUssUUFBUSxLQUFLLFNBQVMsRUFBRSxPQUFRLFFBQU87QUFDakQsVUFBTSxNQUFNLEVBQUUsS0FBSyxHQUFHLEtBQUs7QUFDM0IsUUFBSSxDQUFDLElBQUssUUFBTztBQUNqQixVQUFNLGFBQWEsUUFBUSxHQUFHO0FBQzlCLFFBQUksVUFBVSxlQUFlLEtBQUssQ0FBQyxNQUFNLFFBQVEsQ0FBQyxNQUFNLFVBQVUsR0FBRztBQUNuRSxhQUFPO0FBQUEsSUFDVDtBQUNBLFFBQUksVUFBVSxnQkFBZ0IsS0FBSyxDQUFDLE1BQU0sUUFBUSxDQUFDLE1BQU0sVUFBVSxHQUFHO0FBQ3BFLGFBQU87QUFBQSxJQUNUO0FBQ0EsV0FBTztBQUFBLEVBQ1QsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFHQSxTQUFTLFFBQVEsR0FBbUI7QUFDbEMsU0FBTyxFQUNKLFVBQVUsS0FBSyxFQUNmLFFBQVEsV0FBVyxFQUFFLEVBQ3JCLFlBQVksRUFDWixLQUFLO0FBQ1Y7QUFFQSxTQUFTLGtCQUFrQixLQUFtQztBQUM1RCxNQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2pCLFFBQU0sVUFBVSxJQUFJLFFBQVEsYUFBYSxFQUFFLEVBQUUsUUFBUSxNQUFNLEVBQUU7QUFDN0QsTUFBSSxDQUFDLFFBQVMsUUFBTztBQUNyQixRQUFNLFVBQVUsT0FBTyxPQUFPO0FBQzlCLE1BQUksQ0FBQyxPQUFPLFNBQVMsT0FBTyxLQUFLLFdBQVcsRUFBRyxRQUFPO0FBQ3RELFNBQU8sS0FBSyxNQUFNLFVBQVUsR0FBRztBQUNqQztBQUVBLFNBQVMsa0JBQWtCLEtBQW1DO0FBQzVELE1BQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsUUFBTSxJQUFJLElBQUksWUFBWSxFQUFFLE1BQU0sMkJBQTJCO0FBQzdELFNBQU8sSUFBSSxDQUFDLEtBQUs7QUFDbkI7QUFFQSxTQUFTLGNBQWMsS0FBbUM7QUFDeEQsTUFBSSxDQUFDLElBQUssUUFBTztBQUNqQixRQUFNLE1BQU0sSUFBSSxNQUFNLDJCQUEyQjtBQUNqRCxNQUFJLE1BQU0sQ0FBQyxFQUFHLFFBQU8sSUFBSSxDQUFDO0FBQzFCLFNBQU87QUFDVDtBQUVBLFNBQVMsYUFBYSxHQUFpQjtBQUNyQyxTQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQ3BDO0FBRUEsU0FBUyxLQUFLLEdBQW1CO0FBQy9CLFNBQU8sSUFBSSxLQUFLLElBQUksQ0FBQyxLQUFLLE9BQU8sQ0FBQztBQUNwQztBQUVBLFNBQVMscUJBQ1AsS0FDMkI7QUFDM0IsU0FDRSxlQUFlLE9BQ2YsZ0JBQWdCLE9BQ2hCLGNBQWMsT0FDZCxPQUFRLElBQTJCLGNBQWM7QUFFckQ7QUFHTyxTQUFTLDZCQUNkLEtBQ2dDO0FBQ2hDLE1BQUksUUFBUSxRQUFRLE9BQU8sUUFBUSxZQUFZLE1BQU0sUUFBUSxHQUFHLEVBQUcsUUFBTztBQUMxRSxRQUFNLE1BQU07QUFDWixRQUFNLFNBQVMsb0JBQW9CLElBQUksTUFBTTtBQUM3QyxNQUFJLENBQUMsT0FBUSxRQUFPO0FBRXBCLFFBQU0sVUFBVSxzQkFBc0IsSUFBSSxPQUFPO0FBQ2pELE1BQUksSUFBSSxZQUFZLFVBQWEsSUFBSSxZQUFZLFFBQVEsWUFBWSxNQUFNO0FBQ3pFLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxZQUFZLHdCQUF3QixJQUFJLFNBQVM7QUFDdkQsTUFDRSxJQUFJLGNBQWMsVUFDbEIsSUFBSSxjQUFjLFFBQ2xCLGNBQWMsTUFDZDtBQUNBLFdBQU87QUFBQSxFQUNUO0FBRUEsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLFVBQVUsbUJBQW1CLElBQUksUUFBUTtBQUFBLElBQ3pDO0FBQUEsSUFDQSxVQUFVLG1CQUFtQixJQUFJLFFBQVE7QUFBQSxJQUN6QyxNQUFNLG1CQUFtQixJQUFJLElBQUk7QUFBQSxJQUNqQztBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsbUJBQW1CLEtBQXFDO0FBQy9ELE1BQUksUUFBUSxVQUFhLFFBQVEsS0FBTSxRQUFPO0FBQzlDLFNBQU8sb0JBQW9CLEdBQUc7QUFDaEM7QUFFQSxTQUFTLHNCQUNQLEtBQzRDO0FBQzVDLE1BQUksUUFBUSxVQUFhLFFBQVEsS0FBTSxRQUFPO0FBQzlDLE1BQUksT0FBTyxRQUFRLFlBQVksTUFBTSxRQUFRLEdBQUcsRUFBRyxRQUFPO0FBQzFELFFBQU0sTUFBTTtBQUNaLE1BQ0UsT0FBTyxJQUFJLGNBQWMsWUFDekIsT0FBTyxJQUFJLGVBQWUsWUFDMUIsT0FBTyxJQUFJLGFBQWEsVUFDeEI7QUFDQSxXQUFPLHdCQUF3QixHQUFHO0FBQUEsRUFDcEM7QUFDQSxTQUFPLG9CQUFvQixHQUFHO0FBQ2hDO0FBRUEsU0FBUyx3QkFDUCxLQUMyQjtBQUMzQixRQUFNLFNBQVMsSUFBSTtBQUNuQixNQUFJLFdBQVcsYUFBYSxXQUFXLFVBQVUsV0FBVyxhQUFhO0FBQ3ZFLFdBQU87QUFBQSxFQUNUO0FBQ0EsTUFBSSxPQUFPLElBQUksVUFBVSxZQUFZLENBQUMsSUFBSSxNQUFPLFFBQU87QUFDeEQsTUFBSSxDQUFDLFlBQVksSUFBSSxTQUFTLEVBQUcsUUFBTztBQUN4QyxNQUFJLENBQUMsWUFBWSxJQUFJLFVBQVUsRUFBRyxRQUFPO0FBQ3pDLE1BQUksQ0FBQyxZQUFZLElBQUksUUFBUSxFQUFHLFFBQU87QUFDdkMsTUFBSTtBQUNGLFFBQUksT0FBTyxJQUFJLE9BQU8sR0FBRztBQUFBLEVBQzNCLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQSxPQUFPLElBQUk7QUFBQSxJQUNYLFdBQVcsSUFBSTtBQUFBLElBQ2YsWUFBWSxJQUFJO0FBQUEsSUFDaEIsVUFBVSxJQUFJO0FBQUEsRUFDaEI7QUFDRjtBQUVBLFNBQVMsd0JBQXdCLEtBQXlDO0FBQ3hFLE1BQUksUUFBUSxVQUFhLFFBQVEsS0FBTSxRQUFPO0FBQzlDLE1BQUksT0FBTyxRQUFRLFlBQVksTUFBTSxRQUFRLEdBQUcsRUFBRyxRQUFPO0FBQzFELFFBQU0sTUFBTTtBQUNaLFFBQU0sU0FBUyxJQUFJO0FBQ25CLE1BQUksV0FBVyxhQUFhLFdBQVcsVUFBVSxXQUFXLGFBQWE7QUFDdkUsV0FBTztBQUFBLEVBQ1Q7QUFDQSxNQUFJLE9BQU8sSUFBSSxVQUFVLFlBQVksQ0FBQyxJQUFJLE1BQU8sUUFBTztBQUN4RCxNQUFJLENBQUMsWUFBWSxJQUFJLEtBQUssRUFBRyxRQUFPO0FBQ3BDLFFBQU0sVUFBVSxnQkFBZ0IsSUFBSSxjQUFjO0FBQ2xELFFBQU0sV0FBVyxnQkFBZ0IsSUFBSSxlQUFlO0FBQ3BELE1BQUksQ0FBQyxXQUFXLENBQUMsU0FBVSxRQUFPO0FBQ2xDLE1BQUksUUFBUSxXQUFXLEtBQUssU0FBUyxXQUFXLEVBQUcsUUFBTztBQUMxRCxNQUFJO0FBQ0YsUUFBSSxPQUFPLElBQUksT0FBTyxHQUFHO0FBQUEsRUFDM0IsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLE9BQU8sSUFBSTtBQUFBLElBQ1gsT0FBTyxJQUFJO0FBQUEsSUFDWCxnQkFBZ0I7QUFBQSxJQUNoQixpQkFBaUI7QUFBQSxFQUNuQjtBQUNGO0FBRUEsU0FBUyxnQkFBZ0IsS0FBK0I7QUFDdEQsTUFBSSxDQUFDLE1BQU0sUUFBUSxHQUFHLEVBQUcsUUFBTztBQUNoQyxRQUFNLE1BQWdCLENBQUM7QUFDdkIsYUFBVyxRQUFRLEtBQUs7QUFDdEIsUUFBSSxPQUFPLFNBQVMsU0FBVSxRQUFPO0FBQ3JDLFVBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsUUFBSSxRQUFTLEtBQUksS0FBSyxPQUFPO0FBQUEsRUFDL0I7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLFlBQVksS0FBNkI7QUFDaEQsU0FBTyxPQUFPLFFBQVEsWUFBWSxPQUFPLFVBQVUsR0FBRyxLQUFLLE9BQU87QUFDcEU7QUFFQSxTQUFTLG9CQUFvQixLQUFxQztBQUNoRSxNQUFJLFFBQVEsUUFBUSxPQUFPLFFBQVEsWUFBWSxNQUFNLFFBQVEsR0FBRyxFQUFHLFFBQU87QUFDMUUsUUFBTSxNQUFNO0FBQ1osUUFBTSxTQUFTLElBQUk7QUFDbkIsTUFBSSxXQUFXLGNBQWUsUUFBTyxFQUFFLFFBQVEsY0FBYztBQUM3RCxNQUFJLFdBQVcsWUFBWTtBQUN6QixRQUFJLE9BQU8sSUFBSSxVQUFVLFNBQVUsUUFBTztBQUMxQyxXQUFPLEVBQUUsUUFBUSxZQUFZLE9BQU8sSUFBSSxNQUFNO0FBQUEsRUFDaEQ7QUFDQSxNQUFJLFdBQVcsYUFBYSxXQUFXLFVBQVUsV0FBVyxhQUFhO0FBQ3ZFLFFBQUksT0FBTyxJQUFJLFVBQVUsWUFBWSxDQUFDLElBQUksTUFBTyxRQUFPO0FBQ3hELFFBQUksT0FBTyxJQUFJLFVBQVUsWUFBWSxDQUFDLE9BQU8sVUFBVSxJQUFJLEtBQUssS0FBSyxJQUFJLFFBQVEsR0FBRztBQUNsRixhQUFPO0FBQUEsSUFDVDtBQUNBLFFBQUk7QUFDRixVQUFJLE9BQU8sSUFBSSxPQUFPLEdBQUc7QUFBQSxJQUMzQixRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFDQSxXQUFPLEVBQUUsUUFBUSxPQUFPLElBQUksT0FBTyxPQUFPLElBQUksTUFBTTtBQUFBLEVBQ3REO0FBQ0EsU0FBTztBQUNUOzs7QUNoWU8sU0FBUywwQkFDZCxTQUNBLFNBSXNCO0FBQ3RCLE1BQUksMEJBQTBCLFNBQVMsUUFBUSxlQUFlLEdBQUc7QUFDL0QsV0FBTyxDQUFDO0FBQUEsRUFDVjtBQUNBLE1BQUksUUFBUSxpQkFBaUIsV0FBVyxFQUFHLFFBQU8sQ0FBQztBQUVuRCxRQUFNLFdBQVcsSUFBSTtBQUFBLElBQ25CLFFBQVEsaUJBQWlCLElBQUksQ0FBQyxNQUFNLElBQUksMEJBQTBCLENBQUMsQ0FBQztBQUFBLElBQ3BFLEVBQUUsZ0JBQWdCLEtBQUs7QUFBQSxFQUN6QjtBQUNBLFNBQU8sU0FBUyxJQUFJLE9BQU87QUFDN0I7OztBQ3BDQSxPQUEwRTs7O0FDQTFFLFNBQVMsTUFBTSxhQUFhO0FBQzVCLFNBQVMsUUFBUSx1QkFBdUI7OztBQ0FqQyxTQUFTLElBQUksTUFBa0M7QUFDcEQsTUFBSSxPQUFPLFlBQVksZUFBZSxRQUFRLE1BQU0sSUFBSSxHQUFHO0FBQ3pELFdBQU8sUUFBUSxJQUFJLElBQUk7QUFBQSxFQUN6QjtBQUNBLE1BQUksT0FBTyxTQUFTLGVBQWUsT0FBTyxLQUFLLEtBQUssUUFBUSxZQUFZO0FBQ3RFLFdBQU8sS0FBSyxJQUFJLElBQUksSUFBSTtBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNUOzs7QUNSTyxTQUFTLGtCQUNkLGFBQ3FEO0FBQ3JELE1BQUk7QUFDSixNQUFJO0FBQ0YsVUFBTSxJQUFJLElBQUksV0FBVztBQUFBLEVBQzNCLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sT0FBTyxJQUFJLGFBQWEsSUFBSSxTQUFTLEdBQUcsWUFBWTtBQUMxRCxNQUFJLFNBQVMsVUFBVyxRQUFPO0FBQy9CLE1BQUksU0FBUyxhQUFhLFNBQVMsZUFBZSxTQUFTLGVBQWU7QUFDeEUsV0FBTyxFQUFFLG9CQUFvQixNQUFNO0FBQUEsRUFDckM7QUFFQSxRQUFNLE9BQU8sSUFBSTtBQUNqQixNQUFJLFNBQVMsZUFBZSxTQUFTLFlBQWEsUUFBTztBQUV6RCxTQUFPLEVBQUUsb0JBQW9CLE1BQU07QUFDckM7QUFLTyxTQUFTLGlDQUFpQyxhQUE2QjtBQUM1RSxNQUFJO0FBQ0YsVUFBTSxNQUFNLElBQUksSUFBSSxXQUFXO0FBQy9CLGVBQVcsT0FBTztBQUFBLE1BQ2hCO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0YsR0FBRztBQUNELFVBQUksYUFBYSxPQUFPLEdBQUc7QUFBQSxJQUM3QjtBQUNBLFdBQU8sSUFBSSxTQUFTO0FBQUEsRUFDdEIsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7OztBRi9CQSxNQUFNLGNBQWMsTUFBTSxTQUFTLE1BQU0sQ0FBQyxVQUFrQixLQUFLO0FBT2pFLFNBQVMsa0JBQ1AsaUJBQ3VDO0FBQ3ZDLFFBQU0sY0FBYyxJQUFJLGNBQWM7QUFDdEMsTUFBSSxhQUFhO0FBQ2YsVUFBTSxNQUFNLGtCQUFrQixXQUFXO0FBQ3pDLFdBQU87QUFBQSxNQUNMLGtCQUFrQixpQ0FBaUMsV0FBVztBQUFBLE1BQzlELEtBQUs7QUFBQSxNQUNMLEdBQUksUUFBUSxTQUFZLENBQUMsSUFBSSxFQUFFLElBQUk7QUFBQSxJQUNyQztBQUFBLEVBQ0Y7QUFFQSxTQUFPO0FBQUEsSUFDTCxVQUFVLElBQUksWUFBWSxLQUFLO0FBQUEsSUFDL0IsTUFBTSxJQUFJLFFBQVEsS0FBSztBQUFBLElBQ3ZCLE1BQU0sSUFBSSxRQUFRLEtBQUs7QUFBQSxJQUN2QixVQUFVLElBQUksWUFBWSxLQUFLO0FBQUEsSUFDL0IsTUFBTSxPQUFPLElBQUksUUFBUSxLQUFLLE1BQU07QUFBQSxJQUNwQyxLQUFLO0FBQUEsRUFDUDtBQUNGO0FBR08sU0FBUyxhQUFpQixTQUEwQztBQUN6RSxRQUFNLFVBQVUsSUFBSSxnQkFBZ0I7QUFBQSxJQUNsQyxNQUFNLElBQUksS0FBSyxrQkFBa0IsUUFBUSxlQUFlLENBQUM7QUFBQSxFQUMzRCxDQUFDO0FBQ0QsU0FBTyxJQUFJLE9BQVcsRUFBRSxRQUFRLENBQUM7QUFDbkM7OztBRzFDTyxJQUFNLEtBQUssYUFBdUI7QUFBQSxFQUN2QyxpQkFBaUI7QUFDbkIsQ0FBQzs7O0FDbUJNLElBQU0sZ0JBQU4sY0FBNEIsTUFBTTtBQUFBLEVBQ3ZDLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBRUEsZUFBZSxhQUNiLFdBQ0EsT0FDQSxTQUtZO0FBQ1osUUFBTSxXQUFXLFNBQVMsV0FDeEIsSUFBUSxpQkFBaUIsS0FDekIseUJBQXlCLFFBQVEsT0FBTyxFQUFFO0FBQzVDLFFBQU0sYUFBYSxTQUFTLGNBQWMsSUFBUSxnQkFBZ0I7QUFDbEUsTUFBSSxDQUFDLFlBQVk7QUFDZixVQUFNLElBQUksY0FBYyxrQ0FBa0M7QUFBQSxFQUM1RDtBQUVBLFFBQU0sWUFBWSxTQUFTLGFBQWE7QUFDeEMsUUFBTSxNQUFNLE1BQU07QUFBQSxJQUNoQixHQUFHLE9BQU8saUJBQWlCLFNBQVM7QUFBQSxJQUNwQztBQUFBLE1BQ0UsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ1AsZUFBZSxVQUFVLFVBQVU7QUFBQSxRQUNuQyxnQkFBZ0I7QUFBQSxNQUNsQjtBQUFBLE1BQ0EsTUFBTSxLQUFLLFVBQVU7QUFBQSxRQUNuQixPQUFPO0FBQUEsVUFDTCxNQUFNLE1BQU07QUFBQSxVQUNaLFNBQVMsTUFBTTtBQUFBLFVBQ2YsVUFBVSxNQUFNLFlBQVk7QUFBQSxVQUM1QixVQUFVLE1BQU0sWUFBWTtBQUFBLFVBQzVCLE9BQU8sTUFBTSxTQUFTO0FBQUEsUUFDeEI7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUVBLE1BQUksQ0FBQyxJQUFJLElBQUk7QUFDWCxVQUFNLE9BQU8sTUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLE1BQU0sRUFBRTtBQUM1QyxVQUFNLElBQUk7QUFBQSxNQUNSLGdCQUFnQixJQUFJLE1BQU0sS0FBSyxLQUFLLE1BQU0sR0FBRyxHQUFHLENBQUM7QUFBQSxJQUNuRDtBQUFBLEVBQ0Y7QUFFQSxRQUFNLE9BQU8sTUFBTSxJQUFJLEtBQUs7QUFDNUIsTUFBSSxDQUFDLEtBQUssUUFBUTtBQUNoQixVQUFNLElBQUksY0FBYyxnQ0FBZ0M7QUFBQSxFQUMxRDtBQUNBLFNBQU8sS0FBSztBQUNkO0FBTUEsZUFBc0IsMkJBQ3BCLE9BQ0EsU0FLMEM7QUFDMUMsU0FBTyxNQUFNO0FBQUEsSUFDWDtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUNGO0FBTUEsZUFBc0IsNEJBQ3BCLE9BQ0EsU0FLeUM7QUFDekMsU0FBTyxNQUFNO0FBQUEsSUFDWDtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUNGOzs7QUN0RU8sU0FBUyxnQ0FDZEEsS0FDcUI7QUFDckIsU0FBTztBQUFBLElBQ0wsTUFBTSxxQkFBcUIsV0FBVztBQUNwQyxhQUFPLE1BQU1BLElBQ1YsV0FBVyxtQkFBbUIsRUFDOUIsT0FBTztBQUFBLFFBQ047QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0YsQ0FBQyxFQUNBLE1BQU0sY0FBYyxLQUFLLFNBQVMsRUFDbEMsTUFBTSxXQUFXLEtBQUssSUFBSSxFQUMxQixRQUFRLE1BQU0sS0FBSyxFQUNuQixRQUFRO0FBQUEsSUFDYjtBQUFBLElBQ0EsTUFBTSxhQUFhLFdBQVc7QUFDNUIsYUFBTyxNQUFNQSxJQUNWLFdBQVcsVUFBVSxFQUNyQixPQUFPO0FBQUEsUUFDTjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGLENBQUMsRUFDQSxNQUFNLGNBQWMsS0FBSyxTQUFTLEVBQ2xDLFFBQVE7QUFBQSxJQUNiO0FBQUEsSUFDQSxNQUFNLHFCQUFxQixZQUFZO0FBQ3JDLFVBQUksV0FBVyxXQUFXLEVBQUcsUUFBTyxDQUFDO0FBQ3JDLGFBQU8sTUFBTUEsSUFDVixXQUFXLHNCQUFzQixFQUNqQyxPQUFPLENBQUMsY0FBYyxRQUFRLENBQUMsRUFDL0IsTUFBTSxjQUFjLE1BQU0sVUFBVSxFQUNwQyxNQUFNLFFBQVEsS0FBSyx1QkFBdUIsRUFDMUMsUUFBUTtBQUFBLElBQ2I7QUFBQSxJQUNBLE1BQU0seUJBQXlCLFlBQVksV0FBVztBQUNwRCxVQUFJLFdBQVcsV0FBVyxFQUFHLFFBQU87QUFDcEMsWUFBTSxTQUFTLE1BQU1BLElBQ2xCLFlBQVksc0JBQXNCLEVBQ2xDLElBQUksRUFBRSxRQUFRLFlBQVksWUFBWSxVQUFVLENBQUMsRUFDakQsTUFBTSxVQUFVLEtBQUssU0FBUyxFQUM5QixNQUFNLFFBQVEsS0FBSyx1QkFBdUIsRUFDMUMsTUFBTSxjQUFjLE1BQU0sVUFBVSxFQUNwQyxpQkFBaUI7QUFDcEIsYUFBTyxPQUFPLE9BQU8sa0JBQWtCLENBQUM7QUFBQSxJQUMxQztBQUFBLElBQ0EsTUFBTSxlQUFlLFdBQVcsS0FBSyxLQUFLO0FBQ3hDLFlBQU1BLElBQ0gsV0FBVyxzQkFBc0IsRUFDakMsT0FBTztBQUFBLFFBQ04sWUFBWTtBQUFBLFFBQ1osTUFBTSxJQUFJO0FBQUEsUUFDVixTQUFTLElBQUk7QUFBQSxRQUNiLFlBQVksSUFBSTtBQUFBLFFBQ2hCLFFBQVE7QUFBQSxRQUNSLHNCQUFzQjtBQUFBLFFBQ3RCLFlBQVk7QUFBQSxRQUNaLFlBQVk7QUFBQSxNQUNkLENBQUMsRUFDQSxRQUFRO0FBQUEsSUFDYjtBQUFBLEVBQ0Y7QUFDRjtBQVlBLGVBQXNCLHdCQUNwQixPQUNBLFdBQ0EsT0FBYyxvQkFBSSxLQUFLLEdBQUUsWUFBWSxHQUNOO0FBQy9CLFFBQU0sT0FBTyxNQUFNLE1BQU0scUJBQXFCLFNBQVM7QUFDdkQsUUFBTSxrQkFBdUMsQ0FBQztBQUM5QyxRQUFNLG1CQUEyQyxDQUFDO0FBRWxELGFBQVcsT0FBTyxNQUFNO0FBQ3RCLFVBQU0sUUFBMkI7QUFBQSxNQUMvQixrQkFBa0IsSUFBSTtBQUFBLE1BQ3RCLG1CQUFtQixJQUFJO0FBQUEsTUFDdkIsU0FBUyxJQUFJO0FBQUEsSUFDZjtBQUNBLFFBQUksSUFBSSxTQUFTLFVBQVU7QUFDekIsc0JBQWdCLEtBQUssS0FBSztBQUMxQjtBQUFBLElBQ0Y7QUFDQSxVQUFNLGFBQWEsNkJBQTZCLElBQUksVUFBVTtBQUM5RCxRQUFJLENBQUMsV0FBWTtBQUNqQixxQkFBaUIsS0FBSztBQUFBLE1BQ3BCLElBQUksSUFBSTtBQUFBLE1BQ1Isa0JBQWtCLElBQUk7QUFBQSxNQUN0QixtQkFBbUIsSUFBSTtBQUFBLE1BQ3ZCO0FBQUEsTUFDQSxTQUFTLElBQUk7QUFBQSxJQUNmLENBQUM7QUFBQSxFQUNIO0FBRUEsUUFBTSxXQUFXLE1BQU0sTUFBTSxhQUFhLFNBQVM7QUFDbkQsTUFBSSxTQUFTLFdBQVcsR0FBRztBQUN6QixXQUFPLEVBQUUsaUJBQWlCLEdBQUcsbUJBQW1CLEVBQUU7QUFBQSxFQUNwRDtBQUVBLFFBQU0sV0FBVyxNQUFNLE1BQU0scUJBQXFCLFNBQVMsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7QUFDM0UsUUFBTSxrQkFBa0Isb0JBQUksSUFBeUI7QUFDckQsYUFBVyxLQUFLLFVBQVU7QUFDeEIsUUFBSSxNQUFNLGdCQUFnQixJQUFJLEVBQUUsVUFBVTtBQUMxQyxRQUFJLENBQUMsS0FBSztBQUNSLFlBQU0sb0JBQUksSUFBSTtBQUNkLHNCQUFnQixJQUFJLEVBQUUsWUFBWSxHQUFHO0FBQUEsSUFDdkM7QUFDQSxRQUFJLElBQUksRUFBRSxNQUFNO0FBQUEsRUFDbEI7QUFFQSxRQUFNLG1CQUE2QixDQUFDO0FBQ3BDLE1BQUksb0JBQW9CO0FBRXhCLGFBQVcsT0FBTyxVQUFVO0FBQzFCLFVBQU0sUUFBUSxrQkFBa0IsR0FBRztBQUNuQyxRQUFJLDBCQUEwQixPQUFPLGVBQWUsR0FBRztBQUNyRCx1QkFBaUIsS0FBSyxJQUFJLEVBQUU7QUFDNUI7QUFBQSxJQUNGO0FBRUEsVUFBTSxXQUFXLGdCQUFnQixJQUFJLElBQUksRUFBRTtBQUMzQyxRQUFJLFVBQVUsSUFBSSxTQUFTLEtBQUssVUFBVSxJQUFJLFVBQVUsRUFBRztBQUUzRCxVQUFNLE9BQU8sMEJBQTBCLE9BQU87QUFBQSxNQUM1QyxpQkFBaUIsQ0FBQztBQUFBLE1BQ2xCO0FBQUEsSUFDRixDQUFDO0FBQ0QsZUFBVyxPQUFPLE1BQU07QUFDdEIsWUFBTSxNQUFNLGVBQWUsSUFBSSxJQUFJLEtBQUssR0FBRztBQUMzQywyQkFBcUI7QUFBQSxJQUN2QjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLGtCQUFrQixNQUFNLE1BQU07QUFBQSxJQUNsQztBQUFBLElBQ0E7QUFBQSxFQUNGO0FBRUEsU0FBTyxFQUFFLGlCQUFpQixrQkFBa0I7QUFDOUM7QUFFQSxTQUFTLGtCQUFrQixLQVNWO0FBQ2YsUUFBTSxhQUFhLElBQUksdUJBQXVCLE9BQzFDLElBQUksY0FDSixJQUFJLEtBQUssSUFBSSxXQUFXO0FBQzVCLFFBQU0sV0FBVyxnQkFBZ0IsSUFBSSxXQUFXLElBQUksU0FBUztBQUM3RCxTQUFPO0FBQUEsSUFDTCxJQUFJLElBQUk7QUFBQSxJQUNSLGNBQWMsSUFBSTtBQUFBLElBQ2xCLE1BQU0sSUFBSTtBQUFBLElBQ1YsU0FBUyxJQUFJO0FBQUEsSUFDYjtBQUFBLElBQ0E7QUFBQSxJQUNBLFVBQVUsSUFBSTtBQUFBLEVBQ2hCO0FBQ0Y7OztBQ3ZOTyxTQUFTLDBCQUNkQyxLQUNlO0FBQ2YsU0FBTztBQUFBLElBQ0wsTUFBTSxlQUFlLFdBQVc7QUFDOUIsWUFBTSxTQUFTLE1BQU1BLElBQ2xCLFdBQVcsVUFBVSxFQUNyQixNQUFNLGNBQWMsS0FBSyxTQUFTLEVBQ2xDLGlCQUFpQjtBQUNwQixhQUFPLE9BQU8sT0FBTyxrQkFBa0IsQ0FBQztBQUFBLElBQzFDO0FBQUEsSUFDQSxNQUFNLGVBQWUsV0FBVztBQUM5QixZQUFNLFNBQVMsTUFBTUEsSUFDbEIsV0FBVyxXQUFXLEVBQ3RCLE1BQU0sY0FBYyxLQUFLLFNBQVMsRUFDbEMsaUJBQWlCO0FBQ3BCLGFBQU8sT0FBTyxPQUFPLGtCQUFrQixDQUFDO0FBQUEsSUFDMUM7QUFBQSxJQUNBLE1BQU0sc0JBQXNCLFdBQVcsV0FBVztBQUNoRCxhQUFPLE1BQU1BLElBQ1YsWUFBWSxXQUFXLEVBQ3ZCLElBQUk7QUFBQSxRQUNILGFBQWE7QUFBQSxRQUNiLHNCQUFzQjtBQUFBLFFBQ3RCLFlBQVk7QUFBQSxRQUNaLFlBQVk7QUFBQSxRQUNaLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLFFBQ2hCLFlBQVk7QUFBQSxNQUNkLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxTQUFTLEVBQzFCLGFBQWEsRUFDYix3QkFBd0I7QUFBQSxJQUM3QjtBQUFBLElBQ0EsTUFBTSx1QkFBdUIsV0FBVyxXQUFXO0FBQ2pELFlBQU0sU0FBUyxNQUFNQSxJQUNsQixZQUFZLHNCQUFzQixFQUNsQyxJQUFJLEVBQUUsUUFBUSxZQUFZLFlBQVksVUFBVSxDQUFDLEVBQ2pELE1BQU0sVUFBVSxLQUFLLFNBQVMsRUFDOUI7QUFBQSxRQUNDO0FBQUEsUUFDQTtBQUFBLFFBQ0FBLElBQ0csV0FBVyxVQUFVLEVBQ3JCLE9BQU8sSUFBSSxFQUNYLE1BQU0sY0FBYyxLQUFLLFNBQVM7QUFBQSxNQUN2QyxFQUNDLGlCQUFpQjtBQUNwQixhQUFPLE9BQU8sT0FBTyxrQkFBa0IsQ0FBQztBQUFBLElBQzFDO0FBQUEsRUFDRjtBQUNGO0FBTUEsZUFBc0IsZUFDcEIsT0FDQSxXQUNBLE9BQWMsb0JBQUksS0FBSyxHQUFFLFlBQVksR0FDaEI7QUFDckIsUUFBTSxNQUFNLGVBQWUsU0FBUztBQUNwQyxRQUFNLE1BQU0sZUFBZSxTQUFTO0FBQ3BDLFNBQU8sTUFBTSxNQUFNLHNCQUFzQixXQUFXLEdBQUc7QUFDekQ7QUFHQSxlQUFzQiwwQkFDcEIsT0FDQSxXQUNBLE9BQWMsb0JBQUksS0FBSyxHQUFFLFlBQVksR0FDcEI7QUFDakIsU0FBTyxNQUFNLE1BQU0sdUJBQXVCLFdBQVcsR0FBRztBQUMxRDs7O0FDakRPLFNBQVMsb0NBQ2RDLEtBQ3lCO0FBQ3pCLFNBQU87QUFBQSxJQUNMLE1BQU0scUJBQXFCLFdBQVc7QUFDcEMsYUFBTyxNQUFNQSxJQUNWLFdBQVcsc0JBQXNCLEVBQ2pDO0FBQUEsUUFDQztBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRixFQUNDLE9BQU87QUFBQSxRQUNOO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGLENBQUMsRUFDQSxNQUFNLHVCQUF1QixLQUFLLFNBQVMsRUFDM0MsTUFBTSwrQkFBK0IsS0FBSyxTQUFTLEVBQ25ELE1BQU0sNkJBQTZCLEtBQUssdUJBQXVCLEVBQy9ELFFBQVE7QUFBQSxJQUNiO0FBQUEsSUFDQSxNQUFNLGVBQWUsWUFBWSxTQUFTLFlBQVksV0FBVztBQUMvRCxZQUFNQSxJQUNILFlBQVksc0JBQXNCLEVBQ2xDLElBQUk7QUFBQSxRQUNIO0FBQUEsUUFDQTtBQUFBLFFBQ0EsWUFBWTtBQUFBLE1BQ2QsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLFVBQVUsRUFDM0IsUUFBUTtBQUFBLElBQ2I7QUFBQSxFQUNGO0FBQ0Y7QUFPQSxlQUFzQiw4QkFDcEIsT0FDQSxVQUNBLE9BQWMsb0JBQUksS0FBSyxHQUFFLFlBQVksR0FDcEI7QUFDakIsTUFBSSxTQUFTLFNBQVMsYUFBYSxDQUFDLFNBQVMsUUFBUyxRQUFPO0FBRTdELFFBQU0sZ0JBQWdCLHVCQUF1QixRQUFRO0FBQ3JELE1BQUksQ0FBQyxjQUFlLFFBQU87QUFFM0IsUUFBTSxZQUFZLElBQUksMEJBQTBCLGFBQWE7QUFDN0QsUUFBTSxVQUFVLE1BQU0sTUFBTSxxQkFBcUIsU0FBUyxVQUFVO0FBQ3BFLE1BQUksVUFBVTtBQUVkLGFBQVcsT0FBTyxTQUFTO0FBQ3pCLFVBQU0sUUFBUUMsbUJBQWtCLEdBQUc7QUFDbkMsUUFBSSxDQUFDLFVBQVUsVUFBVSxLQUFLLEVBQUc7QUFDakMsVUFBTSxPQUFPLFVBQVUsUUFBUSxLQUFLO0FBQ3BDLFVBQU0sTUFBTSxLQUFLLENBQUM7QUFDbEIsUUFBSSxDQUFDLElBQUs7QUFFVixVQUFNLE1BQU07QUFBQSxNQUNWLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKLElBQUk7QUFBQSxNQUNKO0FBQUEsSUFDRjtBQUNBLGVBQVc7QUFBQSxFQUNiO0FBRUEsU0FBTztBQUNUO0FBRU8sU0FBUyx1QkFDZCxVQUM2QjtBQUM3QixRQUFNLGFBQWEsNkJBQTZCLFNBQVMsVUFBVTtBQUNuRSxNQUFJLENBQUMsV0FBWSxRQUFPO0FBQ3hCLFNBQU87QUFBQSxJQUNMLElBQUksU0FBUztBQUFBLElBQ2Isa0JBQWtCLFNBQVM7QUFBQSxJQUMzQixtQkFBbUIsU0FBUztBQUFBLElBQzVCO0FBQUEsSUFDQSxTQUFTLFNBQVM7QUFBQSxFQUNwQjtBQUNGO0FBRUEsU0FBU0EsbUJBQWtCLEtBUVY7QUFDZixRQUFNLGFBQWEsSUFBSSx1QkFBdUIsT0FDMUMsSUFBSSxjQUNKLElBQUksS0FBSyxJQUFJLFdBQVc7QUFDNUIsU0FBTztBQUFBLElBQ0wsSUFBSSxJQUFJO0FBQUEsSUFDUixjQUFjLElBQUk7QUFBQSxJQUNsQixNQUFNLElBQUk7QUFBQSxJQUNWLFNBQVMsSUFBSTtBQUFBLElBQ2I7QUFBQSxJQUNBLFVBQVUsZ0JBQWdCLElBQUksV0FBVyxJQUFJLFNBQVM7QUFBQSxJQUN0RCxVQUFVLElBQUk7QUFBQSxFQUNoQjtBQUNGOzs7QUNoS08sU0FBUyxlQUFlLE9BQThCO0FBQzNELE1BQUksaUJBQWlCLEtBQU0sUUFBTyxNQUFNLFlBQVk7QUFDcEQsUUFBTSxVQUFVLE1BQU0sS0FBSztBQUMzQixNQUFJLFlBQVksS0FBSyxPQUFPLEdBQUc7QUFDN0IsVUFBTSxJQUFJLE9BQU8sT0FBTztBQUN4QixVQUFNLEtBQUssUUFBUSxVQUFVLEtBQUssSUFBSSxNQUFPO0FBQzdDLFdBQU8sSUFBSSxLQUFLLEVBQUUsRUFBRSxZQUFZO0FBQUEsRUFDbEM7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLHFCQUNkLE9BQ2U7QUFDZixNQUFJLFNBQVMsS0FBTSxRQUFPO0FBQzFCLFNBQU8sZUFBZSxLQUFLO0FBQzdCOzs7QUMyQk8sU0FBUyxnQkFBZ0IsS0FBbUM7QUFDakUsU0FBTztBQUFBLElBQ0wsSUFBSSxJQUFJO0FBQUEsSUFDUixZQUFZLElBQUk7QUFBQSxJQUNoQixxQkFBcUIsSUFBSTtBQUFBLElBQ3pCLGdCQUFnQixJQUFJO0FBQUEsSUFDcEIsY0FBYyxJQUFJO0FBQUEsSUFDbEIsU0FBUyxJQUFJO0FBQUEsSUFDYixhQUFhLGVBQWUsSUFBSSxXQUFXO0FBQUEsSUFDM0MsV0FBVyxJQUFJLGFBQWE7QUFBQSxJQUM1QixXQUFXLElBQUksYUFBYTtBQUFBLElBQzVCLFlBQVksZUFBZSxJQUFJLFVBQVU7QUFBQSxFQUMzQztBQUNGO0FBRU8sU0FBUywrQkFDZEMsS0FDb0I7QUFDcEIsU0FBTztBQUFBLElBQ0wsTUFBTSxvQkFBb0IsUUFBUSxXQUFXO0FBQzNDLGFBQU8sTUFBTUEsSUFDVixXQUFXLFVBQVUsRUFDckIsVUFBVSxhQUFhLGdCQUFnQixxQkFBcUIsRUFDNUQsVUFBVSxVQUFVLEVBQ3BCLE1BQU0sZUFBZSxLQUFLLFNBQVMsRUFDbkMsTUFBTSxxQkFBcUIsS0FBSyxNQUFNLEVBQ3RDLGlCQUFpQjtBQUFBLElBQ3RCO0FBQUEsSUFDQSxNQUFNLHFCQUFxQixRQUFRLFdBQVc7QUFDNUMsYUFBTyxNQUFNQSxJQUNWLFdBQVcsc0JBQXNCLEVBQ2pDO0FBQUEsUUFDQztBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRixFQUNDLFVBQVUsYUFBYSxnQkFBZ0IscUJBQXFCLEVBQzVELFVBQVUsVUFBVSxFQUNwQixNQUFNLDZDQUE2QyxLQUFLLFNBQVMsRUFDakUsTUFBTSwrQkFBK0IsS0FBSyxVQUFVLEVBQ3BELE1BQU0scUJBQXFCLEtBQUssTUFBTSxFQUN0QyxRQUFRLDJCQUEyQixNQUFNLEVBQ3pDLGlCQUFpQjtBQUFBLElBQ3RCO0FBQUEsRUFDRjtBQUNGO0FBR0EsZUFBc0IsaUJBQ3BCLE9BQ0EsUUFDQSxXQUM4QjtBQUM5QixRQUFNLE1BQU0sTUFBTSxNQUFNLG9CQUFvQixRQUFRLFNBQVM7QUFDN0QsU0FBTyxNQUFNLGdCQUFnQixHQUFHLElBQUk7QUFDdEM7QUFNQSxlQUFzQiw0QkFDcEIsT0FDQSxRQUNBLFdBQzhCO0FBQzlCLFFBQU0sTUFBTSxNQUFNLE1BQU0scUJBQXFCLFFBQVEsU0FBUztBQUM5RCxTQUFPLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSTtBQUN0Qzs7O0FDNUdPLElBQU0sd0JBQU4sY0FBb0MsTUFBTTtBQUFBLEVBQy9DLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBVUEsZUFBc0IsNkJBQ3BCLFdBQ0EsWUFDQSxxQkFDQSxTQUkrQjtBQUMvQixNQUFJLENBQUMscUJBQXFCLFdBQVcsU0FBUyxHQUFHO0FBQy9DLFVBQU0sSUFBSSxzQkFBc0IsOEJBQThCO0FBQUEsRUFDaEU7QUFFQSxRQUFNLFdBQVcsU0FBUyxXQUN4QixJQUFRLDJCQUEyQixLQUNuQyx5QkFBeUIsUUFBUSxPQUFPLEVBQUU7QUFFNUMsUUFBTSxPQUFPLFVBQVUsTUFBTSxLQUFLLEtBQ2hDLENBQUMsVUFBVSxVQUFVLFVBQVUsYUFBYSxFQUFFLE9BQU8sT0FBTyxFQUFFLEtBQUssVUFBSyxLQUN4RTtBQUVGLFFBQU0sUUFBUTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQVFkLFFBQU0sWUFBWSxTQUFTLGFBQWE7QUFDeEMsUUFBTSxNQUFNLE1BQU0sVUFBVSxHQUFHLE9BQU8sWUFBWTtBQUFBLElBQ2hELFFBQVE7QUFBQSxJQUNSLFNBQVM7QUFBQSxNQUNQLGVBQWU7QUFBQSxNQUNmLGdCQUFnQjtBQUFBLElBQ2xCO0FBQUEsSUFDQSxNQUFNLEtBQUssVUFBVTtBQUFBLE1BQ25CO0FBQUEsTUFDQSxXQUFXO0FBQUEsUUFDVCxPQUFPO0FBQUEsVUFDTDtBQUFBLFVBQ0EsYUFBYSxVQUFVO0FBQUEsVUFDdkIsU0FBUyxVQUFVO0FBQUEsVUFDbkIsVUFBVSxVQUFVO0FBQUEsVUFDcEI7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0gsQ0FBQztBQUVELE1BQUksQ0FBQyxJQUFJLElBQUk7QUFDWCxVQUFNLE9BQU8sTUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLE1BQU0sRUFBRTtBQUM1QyxVQUFNLElBQUk7QUFBQSxNQUNSLHFCQUFxQixJQUFJLE1BQU0sS0FBSyxLQUFLLE1BQU0sR0FBRyxHQUFHLENBQUM7QUFBQSxJQUN4RDtBQUFBLEVBQ0Y7QUFFQSxRQUFNLE9BQU8sTUFBTSxJQUFJLEtBQUs7QUFLNUIsTUFBSSxLQUFLLFFBQVEsUUFBUTtBQUN2QixVQUFNLElBQUk7QUFBQSxNQUNSLEtBQUssT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxLQUFLLElBQUk7QUFBQSxJQUM3QztBQUFBLEVBQ0Y7QUFFQSxRQUFNLEtBQUssS0FBSyxNQUFNLGVBQWU7QUFDckMsTUFBSSxPQUFPLE9BQU8sVUFBVTtBQUMxQixVQUFNLElBQUksc0JBQXNCLDBDQUEwQztBQUFBLEVBQzVFO0FBQ0EsU0FBTyxFQUFFLFdBQVcsR0FBRztBQUN6Qjs7O0FDdkZPLElBQU0sdUJBQ1g7QUFFSyxJQUFNLHVCQUNYO0FBRUssSUFBTSxtQkFBbUI7QUFFaEMsSUFBTSxvQkFBb0IsS0FBSztBQXNCeEIsSUFBTSxrQkFBTixjQUE4QixNQUFNO0FBQUEsRUFDekMsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFHTyxTQUFTLHFCQUNkQyxNQUNrQjtBQUNsQixRQUFNLFNBQVNBLFFBQU87QUFBQSxJQUNwQix1QkFBdUIsSUFBUSx1QkFBdUI7QUFBQSxJQUN0RCwyQkFBMkIsSUFBUSwyQkFBMkI7QUFBQSxJQUM5RCwwQkFBMEIsSUFBUSwwQkFBMEI7QUFBQSxJQUM1RCxpQ0FBaUMsSUFBUSxpQ0FBaUM7QUFBQSxFQUM1RTtBQUNBLFFBQU0sV0FBVyxPQUFPLHVCQUF1QixLQUFLLEtBQUs7QUFDekQsUUFBTSxlQUFlLE9BQU8sMkJBQTJCLEtBQUssS0FBSztBQUNqRSxRQUFNLGNBQWUsT0FBTywwQkFBMEIsS0FBSyxLQUN6RDtBQUNGLFFBQU0sV0FBVyxPQUFPLGlDQUFpQyxLQUFLLEtBQzVEO0FBQ0YsUUFBTSxvQkFBb0IsU0FDdkIsTUFBTSxHQUFHLEVBQ1QsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsRUFDbkIsT0FBTyxPQUFPO0FBRWpCLE1BQUksQ0FBQyxZQUFZLENBQUMsY0FBYztBQUM5QixVQUFNLElBQUk7QUFBQSxNQUNSO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxNQUFJLGtCQUFrQixXQUFXLEdBQUc7QUFDbEMsVUFBTSxJQUFJLGdCQUFnQiwwQ0FBMEM7QUFBQSxFQUN0RTtBQUVBLFNBQU8sRUFBRSxVQUFVLGNBQWMsYUFBYSxrQkFBa0I7QUFDbEU7QUFHTyxTQUFTLGtCQUNkLFVBQ0EsV0FDUztBQUNULE1BQUk7QUFDSixNQUFJO0FBQ0YsVUFBTSxJQUFJLElBQUksUUFBUTtBQUFBLEVBQ3hCLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksSUFBSSxZQUFZLElBQUksU0FBVSxRQUFPO0FBQ3pDLE1BQUksSUFBSSxLQUFNLFFBQU87QUFFckIsYUFBVyxTQUFTLFdBQVc7QUFDN0IsUUFBSSxDQUFDLE1BQU87QUFDWixRQUFJO0FBQ0YsWUFBTSxVQUFVLElBQUksSUFBSSxLQUFLO0FBQzdCLFVBQUksSUFBSSxhQUFhLFFBQVEsWUFBWSxJQUFJLFNBQVMsUUFBUSxNQUFNO0FBRWxFLFlBQUksQ0FBQyxRQUFRLFlBQVksUUFBUSxhQUFhLElBQUssUUFBTztBQUMxRCxjQUFNLFNBQVMsUUFBUSxTQUFTLFNBQVMsR0FBRyxJQUN4QyxRQUFRLFdBQ1IsR0FBRyxRQUFRLFFBQVE7QUFDdkIsWUFDRSxJQUFJLGFBQWEsUUFBUSxZQUN6QixJQUFJLFNBQVMsV0FBVyxNQUFNLEdBQzlCO0FBQ0EsaUJBQU87QUFBQSxRQUNUO0FBQUEsTUFDRjtBQUFBLElBQ0YsUUFBUTtBQUVOLFVBQUksYUFBYSxTQUFTLFNBQVMsV0FBVyxHQUFHLEtBQUssRUFBRSxHQUFHO0FBQ3pELGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGlCQUFpQixPQUEyQjtBQUNuRCxNQUFJLE1BQU07QUFDVixhQUFXLEtBQUssTUFBTyxRQUFPLE9BQU8sYUFBYSxDQUFDO0FBQ25ELFNBQU8sS0FBSyxHQUFHLEVBQUUsUUFBUSxPQUFPLEdBQUcsRUFBRSxRQUFRLE9BQU8sR0FBRyxFQUFFLFFBQVEsT0FBTyxFQUFFO0FBQzVFO0FBRUEsU0FBUyxpQkFBaUIsR0FBdUI7QUFDL0MsUUFBTSxTQUFTLEVBQUUsUUFBUSxNQUFNLEdBQUcsRUFBRSxRQUFRLE1BQU0sR0FBRyxJQUNuRCxNQUFNLE9BQU8sRUFBRSxTQUFTLEtBQUssQ0FBQztBQUNoQyxRQUFNLE1BQU0sS0FBSyxNQUFNO0FBQ3ZCLFFBQU0sTUFBTSxJQUFJLFdBQVcsSUFBSSxNQUFNO0FBQ3JDLFdBQVMsSUFBSSxHQUFHLElBQUksSUFBSSxRQUFRLElBQUssS0FBSSxDQUFDLElBQUksSUFBSSxXQUFXLENBQUM7QUFDOUQsU0FBTztBQUNUO0FBRUEsZUFBZSxRQUFRLFFBQW9DO0FBQ3pELFNBQU8sT0FBTyxPQUFPO0FBQUEsSUFDbkI7QUFBQSxJQUNBLElBQUksWUFBWSxFQUFFLE9BQU8sTUFBTTtBQUFBLElBQy9CLEVBQUUsTUFBTSxRQUFRLE1BQU0sVUFBVTtBQUFBLElBQ2hDO0FBQUEsSUFDQSxDQUFDLFFBQVEsUUFBUTtBQUFBLEVBQ25CO0FBQ0Y7QUFFQSxlQUFzQixlQUNwQixTQUNBLGNBQ0EsUUFBZ0IsS0FBSyxJQUFJLEdBQ1I7QUFDakIsUUFBTSxPQUErQjtBQUFBLElBQ25DLFFBQVEsUUFBUTtBQUFBLElBQ2hCLFdBQVcsUUFBUTtBQUFBLElBQ25CLFVBQVUsUUFBUTtBQUFBLElBQ2xCLEtBQUssUUFBUSxPQUFPLEtBQUssTUFBTSxRQUFRLEdBQUksSUFBSTtBQUFBLEVBQ2pEO0FBQ0EsUUFBTSxhQUFhO0FBQUEsSUFDakIsSUFBSSxZQUFZLEVBQUUsT0FBTyxLQUFLLFVBQVUsSUFBSSxDQUFDO0FBQUEsRUFDL0M7QUFDQSxRQUFNLE1BQU0sTUFBTSxRQUFRLFlBQVk7QUFDdEMsUUFBTSxNQUFNLE1BQU0sT0FBTyxPQUFPO0FBQUEsSUFDOUI7QUFBQSxJQUNBO0FBQUEsSUFDQSxJQUFJLFlBQVksRUFBRSxPQUFPLFVBQVU7QUFBQSxFQUNyQztBQUNBLFNBQU8sR0FBRyxVQUFVLElBQUksaUJBQWlCLElBQUksV0FBVyxHQUFHLENBQUMsQ0FBQztBQUMvRDtBQUVBLGVBQXNCLGlCQUNwQixPQUNBLGNBQ0EsUUFBZ0IsS0FBSyxJQUFJLEdBQ1E7QUFDakMsUUFBTSxRQUFRLE1BQU0sTUFBTSxHQUFHO0FBQzdCLE1BQUksTUFBTSxXQUFXLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHO0FBQ2hELFVBQU0sSUFBSSxnQkFBZ0IscUJBQXFCO0FBQUEsRUFDakQ7QUFDQSxRQUFNLENBQUMsWUFBWSxNQUFNLElBQUk7QUFDN0IsUUFBTSxNQUFNLE1BQU0sUUFBUSxZQUFZO0FBQ3RDLFFBQU0sS0FBSyxNQUFNLE9BQU8sT0FBTztBQUFBLElBQzdCO0FBQUEsSUFDQTtBQUFBLElBQ0EsaUJBQWlCLE1BQU07QUFBQSxJQUN2QixJQUFJLFlBQVksRUFBRSxPQUFPLFVBQVU7QUFBQSxFQUNyQztBQUNBLE1BQUksQ0FBQyxHQUFJLE9BQU0sSUFBSSxnQkFBZ0IsK0JBQStCO0FBRWxFLE1BQUk7QUFDSixNQUFJO0FBQ0YsV0FBTyxLQUFLO0FBQUEsTUFDVixJQUFJLFlBQVksRUFBRSxPQUFPLGlCQUFpQixVQUFVLENBQUM7QUFBQSxJQUN2RDtBQUFBLEVBQ0YsUUFBUTtBQUNOLFVBQU0sSUFBSSxnQkFBZ0IsNkJBQTZCO0FBQUEsRUFDekQ7QUFFQSxNQUNFLE9BQU8sS0FBSyxXQUFXLFlBQ3ZCLE9BQU8sS0FBSyxjQUFjLFlBQzFCLE9BQU8sS0FBSyxhQUFhLFlBQ3pCLE9BQU8sS0FBSyxRQUFRLFVBQ3BCO0FBQ0EsVUFBTSxJQUFJLGdCQUFnQiw0QkFBNEI7QUFBQSxFQUN4RDtBQUNBLE1BQUksS0FBSyxNQUFNLEtBQUssTUFBTSxRQUFRLEdBQUksR0FBRztBQUN2QyxVQUFNLElBQUksZ0JBQWdCLHFCQUFxQjtBQUFBLEVBQ2pEO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyx3QkFBd0IsU0FLN0I7QUFDVCxRQUFNLFNBQVMsSUFBSSxnQkFBZ0I7QUFBQSxJQUNqQyxXQUFXLFFBQVE7QUFBQSxJQUNuQixjQUFjLFFBQVE7QUFBQSxJQUN0QixlQUFlO0FBQUEsSUFDZixPQUFPLFFBQVEsU0FBUztBQUFBLElBQ3hCLGFBQWE7QUFBQSxJQUNiLFFBQVE7QUFBQSxJQUNSLHdCQUF3QjtBQUFBLElBQ3hCLE9BQU8sUUFBUTtBQUFBLEVBQ2pCLENBQUM7QUFDRCxTQUFPLEdBQUcsb0JBQW9CLElBQUksT0FBTyxTQUFTLENBQUM7QUFDckQ7QUFFQSxlQUFzQiwwQkFBMEIsU0FPbEI7QUFDNUIsUUFBTSxZQUFZLFFBQVEsYUFBYTtBQUN2QyxRQUFNLE1BQU0sTUFBTSxVQUFVLFFBQVEsWUFBWSxrQkFBa0I7QUFBQSxJQUNoRSxRQUFRO0FBQUEsSUFDUixTQUFTLEVBQUUsZ0JBQWdCLG9DQUFvQztBQUFBLElBQy9ELE1BQU0sSUFBSSxnQkFBZ0I7QUFBQSxNQUN4QixNQUFNLFFBQVE7QUFBQSxNQUNkLFdBQVcsUUFBUTtBQUFBLE1BQ25CLGVBQWUsUUFBUTtBQUFBLE1BQ3ZCLGNBQWMsUUFBUTtBQUFBLE1BQ3RCLFlBQVk7QUFBQSxJQUNkLENBQUM7QUFBQSxFQUNILENBQUM7QUFDRCxNQUFJLENBQUMsSUFBSSxJQUFJO0FBQ1gsVUFBTSxPQUFPLE1BQU0sSUFBSSxLQUFLLEVBQUUsTUFBTSxNQUFNLEVBQUU7QUFDNUMsVUFBTSxJQUFJO0FBQUEsTUFDUiwwQkFBMEIsSUFBSSxNQUFNLE1BQU0sS0FBSyxNQUFNLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFDOUQ7QUFBQSxFQUNGO0FBQ0EsUUFBTSxPQUFPLE1BQU0sSUFBSSxLQUFLO0FBSzVCLE1BQUksQ0FBQyxLQUFLLGNBQWM7QUFDdEIsVUFBTSxJQUFJLGdCQUFnQixxQ0FBcUM7QUFBQSxFQUNqRTtBQUNBLFFBQU0sY0FBYyxPQUFPLEtBQUssZUFBZSxXQUMzQyxLQUFLLElBQUksSUFBSSxLQUFLLGFBQWEsTUFDL0I7QUFDSixTQUFPO0FBQUEsSUFDTCxhQUFhLEtBQUs7QUFBQSxJQUNsQixjQUFjLEtBQUssaUJBQWlCO0FBQUEsSUFDcEM7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxJQUFNLG9CQUNKO0FBR0YsZUFBc0IsdUJBQXVCLFNBSWxCO0FBQ3pCLFFBQU0sWUFBWSxRQUFRLGFBQWE7QUFDdkMsTUFBSTtBQUNGLFVBQU0sTUFBTSxNQUFNLFVBQVUsUUFBUSxjQUFjLG1CQUFtQjtBQUFBLE1BQ25FLFNBQVMsRUFBRSxlQUFlLFVBQVUsUUFBUSxXQUFXLEdBQUc7QUFBQSxJQUM1RCxDQUFDO0FBQ0QsUUFBSSxDQUFDLElBQUksR0FBSSxRQUFPO0FBQ3BCLFVBQU0sT0FBTyxNQUFNLElBQUksS0FBSztBQUM1QixRQUFJLE9BQU8sS0FBSyxpQkFBaUIsU0FBVSxRQUFPO0FBQ2xELFVBQU0sUUFBUSxLQUFLLGFBQWEsS0FBSztBQUNyQyxXQUFPLE1BQU0sU0FBUyxLQUFLLE1BQU0sVUFBVSxNQUFNLFFBQVE7QUFBQSxFQUMzRCxRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUdPLFNBQVMsb0JBQ2QsVUFDQSxRQUNRO0FBQ1IsUUFBTSxNQUFNLElBQUksSUFBSSxRQUFRO0FBQzVCLE1BQUksT0FBTyxJQUFJO0FBQ2IsUUFBSSxhQUFhLElBQUksU0FBUyxXQUFXO0FBQ3pDLFFBQUksYUFBYSxPQUFPLE9BQU87QUFBQSxFQUNqQyxPQUFPO0FBQ0wsUUFBSSxhQUFhLElBQUksU0FBUyxPQUFPO0FBQ3JDLFFBQUksYUFBYSxJQUFJLFNBQVMsT0FBTyxNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUM7QUFBQSxFQUMxRDtBQUNBLFNBQU8sSUFBSSxTQUFTO0FBQ3RCOzs7QUNuVEEsU0FBUyxvQkFBb0I7QUFFN0IsSUFBTSxZQUFZLG9CQUFJLElBQUksQ0FBQyxXQUFXLE9BQU8sQ0FBQztBQUM5QyxJQUFNLG9CQUFvQixvQkFBSSxJQUFJLENBQUMsV0FBVyxZQUFZLFVBQVUsQ0FBQztBQUNyRSxJQUFNLGlCQUFpQixvQkFBSSxJQUFJLENBQUMsV0FBVyxRQUFRLENBQUM7QUFNN0MsSUFBTSxzQkFBTixjQUFrQyxhQUFhO0FBQUEsRUFDcEQsWUFBWSxTQUFpQjtBQUMzQixVQUFNLFNBQVM7QUFBQSxNQUNiLE1BQU07QUFBQSxNQUNOLFlBQVk7QUFBQSxJQUNkLENBQUM7QUFDRCxTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFFQSxJQUFNLHFCQUNKO0FBRUYsSUFBTSxvQkFDSjtBQUVLLFNBQVMsaUJBQWlCLFVBQTBCO0FBQ3pELFFBQU0sVUFBVSxTQUFTLEtBQUssRUFBRSxZQUFZO0FBQzVDLE1BQUksQ0FBQyxVQUFVLElBQUksT0FBTyxHQUFHO0FBQzNCLFVBQU0sSUFBSTtBQUFBLE1BQ1IsNEJBQTRCLENBQUMsR0FBRyxTQUFTLEVBQUUsS0FBSyxJQUFJLENBQUM7QUFBQSxJQUN2RDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLGNBQWMsT0FBdUI7QUFDbkQsUUFBTSxVQUFVLE1BQU0sS0FBSztBQUMzQixNQUFJLENBQUMsUUFBUyxPQUFNLElBQUksb0JBQW9CLG1CQUFtQjtBQUMvRCxNQUFJLFFBQVEsU0FBUyxJQUFLLE9BQU0sSUFBSSxvQkFBb0IsbUJBQW1CO0FBQzNFLFNBQU87QUFDVDtBQU1PLFNBQVMsdUJBQXVCLFVBQThCO0FBQ25FLFFBQU0sTUFBZ0IsQ0FBQztBQUN2QixRQUFNLE9BQU8sb0JBQUksSUFBWTtBQUM3QixhQUFXLE9BQU8sVUFBVTtBQUMxQixVQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsWUFBWTtBQUNqQyxRQUFJLENBQUMsRUFBRztBQUNSLFFBQUksRUFBRSxTQUFTLEtBQUs7QUFDbEIsWUFBTSxJQUFJLG9CQUFvQixtQ0FBbUM7QUFBQSxJQUNuRTtBQUNBLFFBQUksQ0FBQywyQkFBMkIsQ0FBQyxHQUFHO0FBQ2xDLFlBQU0sSUFBSTtBQUFBLFFBQ1IsNEJBQTRCLEdBQUc7QUFBQSxNQUNqQztBQUFBLElBQ0Y7QUFDQSxRQUFJLEtBQUssSUFBSSxDQUFDLEVBQUc7QUFDakIsU0FBSyxJQUFJLENBQUM7QUFDVixRQUFJLEtBQUssQ0FBQztBQUFBLEVBQ1o7QUFDQSxNQUFJLElBQUksV0FBVyxHQUFHO0FBQ3BCLFVBQU0sSUFBSSxvQkFBb0IsNkJBQTZCO0FBQUEsRUFDN0Q7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxTQUFTLDJCQUEyQixTQUEwQjtBQUM1RCxNQUFJLFFBQVEsU0FBUyxHQUFHLEVBQUcsUUFBTztBQUVsQyxNQUFJLFFBQVEsU0FBUyxHQUFHLEdBQUc7QUFDekIsVUFBTSxLQUFLLFFBQVEsWUFBWSxHQUFHO0FBQ2xDLFFBQUksTUFBTSxLQUFLLE9BQU8sUUFBUSxTQUFTLEVBQUcsUUFBTztBQUNqRCxVQUFNLFFBQVEsUUFBUSxNQUFNLEdBQUcsRUFBRTtBQUNqQyxVQUFNLFNBQVMsUUFBUSxNQUFNLEtBQUssQ0FBQztBQUNuQyxRQUFJLENBQUMsU0FBUyxNQUFNLFNBQVMsR0FBRyxFQUFHLFFBQU87QUFDMUMsV0FBTyxxQkFBcUIsTUFBTTtBQUFBLEVBQ3BDO0FBQ0EsU0FBTyxxQkFBcUIsT0FBTztBQUNyQztBQUVBLFNBQVMscUJBQXFCLFFBQXlCO0FBQ3JELE1BQUksT0FBTyxTQUFTLEdBQUcsRUFBRyxRQUFPO0FBQ2pDLFNBQU8sb0VBQ0osS0FBSyxNQUFNO0FBQ2hCO0FBR08sU0FBUyxtQkFBbUIsU0FBMEI7QUFDM0QsUUFBTSxJQUFJLFFBQVEsS0FBSyxFQUFFLFlBQVk7QUFDckMsTUFBSSxDQUFDLEtBQUssRUFBRSxTQUFTLElBQUssUUFBTztBQUVqQyxNQUFJLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFDbkIsVUFBTSxLQUFLLEVBQUUsWUFBWSxHQUFHO0FBQzVCLFFBQUksTUFBTSxLQUFLLE9BQU8sRUFBRSxTQUFTLEVBQUcsUUFBTztBQUMzQyxVQUFNLFFBQVEsRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUMzQixVQUFNLFNBQVMsRUFBRSxNQUFNLEtBQUssQ0FBQztBQUM3QixRQUFJLFVBQVUsUUFBUSxNQUFNLFNBQVMsR0FBRyxLQUFLLE1BQU0sU0FBUyxHQUFHLElBQUk7QUFDakUsYUFBTztBQUFBLElBQ1Q7QUFDQSxXQUFPLHFCQUFxQixNQUFNO0FBQUEsRUFDcEM7QUFDQSxTQUFPLHFCQUFxQixDQUFDO0FBQy9CO0FBRUEsU0FBUyxxQkFBcUIsUUFBeUI7QUFDckQsTUFBSSxPQUFPLFdBQVcsSUFBSSxHQUFHO0FBQzNCLFVBQU0sT0FBTyxPQUFPLE1BQU0sQ0FBQztBQUMzQixRQUFJLENBQUMsUUFBUSxLQUFLLFNBQVMsR0FBRyxLQUFLLENBQUMsS0FBSyxTQUFTLEdBQUcsRUFBRyxRQUFPO0FBQy9ELFdBQU8scUJBQXFCLElBQUk7QUFBQSxFQUNsQztBQUNBLE1BQUksT0FBTyxTQUFTLEdBQUcsRUFBRyxRQUFPO0FBQ2pDLFNBQU8scUJBQXFCLE1BQU07QUFDcEM7QUFFTyxTQUFTLHVCQUF1QixRQUF3QjtBQUM3RCxRQUFNLFVBQVUsT0FBTyxLQUFLLEVBQUUsWUFBWTtBQUMxQyxNQUFJLENBQUMsa0JBQWtCLElBQUksT0FBTyxHQUFHO0FBQ25DLFVBQU0sSUFBSTtBQUFBLE1BQ1IsMEJBQTBCLENBQUMsR0FBRyxpQkFBaUIsRUFBRSxLQUFLLElBQUksQ0FBQztBQUFBLElBQzdEO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMscUJBQXFCLE1BQXNCO0FBQ3pELFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsTUFBSSxDQUFDLFFBQVMsT0FBTSxJQUFJLG9CQUFvQiwyQkFBMkI7QUFDdkUsTUFBSSxRQUFRLFNBQVMsS0FBSztBQUN4QixVQUFNLElBQUksb0JBQW9CLDJCQUEyQjtBQUFBLEVBQzNEO0FBQ0EsU0FBTztBQUNUO0FBR08sU0FBUyxxQkFBcUIsTUFBb0M7QUFDdkUsUUFBTSxVQUFVLEtBQUssS0FBSyxFQUFFLFlBQVk7QUFDeEMsTUFBSSxDQUFDLGVBQWUsSUFBSSxPQUFPLEdBQUc7QUFDaEMsVUFBTSxJQUFJO0FBQUEsTUFDUix3QkFBd0IsQ0FBQyxHQUFHLGNBQWMsRUFBRSxLQUFLLElBQUksQ0FBQztBQUFBLElBQ3hEO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMseUJBQXlCLFNBQXlCO0FBQ2hFLFFBQU0sSUFBSSxRQUFRLEtBQUssRUFBRSxZQUFZO0FBQ3JDLE1BQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHO0FBQzFCLFVBQU0sSUFBSTtBQUFBLE1BQ1IsMkJBQTJCLFNBQVMsa0JBQWtCO0FBQUEsSUFDeEQ7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyw0QkFBNEIsS0FBcUI7QUFDL0QsUUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLFlBQVk7QUFDakMsUUFBTSxTQUFTLDBCQUEwQixHQUFHO0FBRTVDLE1BQUksQ0FBQyxHQUFHO0FBQ04sV0FBTyxHQUFHLE1BQU0sdUJBQXVCLGtCQUFrQjtBQUFBLEVBQzNEO0FBRUEsTUFBSSxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBRW5CLFFBQUksWUFBWSxFQUFFLFdBQVcsS0FBSyxFQUFFLEVBQUUsUUFBUSxNQUFNLEVBQUUsRUFBRSxRQUFRLE9BQU8sRUFBRTtBQUN6RSxRQUFJLFVBQVUsU0FBUyxHQUFHLEdBQUc7QUFDM0Isa0JBQVksVUFBVSxNQUFNLFVBQVUsWUFBWSxHQUFHLElBQUksQ0FBQztBQUFBLElBQzVEO0FBQ0EsUUFBSSxxQkFBcUIsU0FBUyxHQUFHO0FBQ25DLGFBQ0UsR0FBRyxNQUFNLHFDQUFxQyxTQUFTLHlDQUNoQixrQkFBa0I7QUFBQSxJQUU3RDtBQUNBLFdBQU8sR0FBRyxNQUFNLGdDQUFnQyxrQkFBa0I7QUFBQSxFQUNwRTtBQUVBLE1BQUksQ0FBQyxFQUFFLFNBQVMsR0FBRyxLQUFLLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUN4QyxXQUNFLEdBQUcsTUFBTSwyREFDVDtBQUFBLEVBRUo7QUFFQSxTQUFPLEdBQUcsTUFBTSxLQUFLLGtCQUFrQjtBQUN6QztBQU9PLFNBQVMsMkJBQ2QsS0FDQSxPQUNRO0FBQ1IsUUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLFlBQVk7QUFDakMsUUFBTSxTQUFTLFdBQVcsS0FBSyxLQUFLLEdBQUc7QUFFdkMsTUFBSSxDQUFDLEdBQUc7QUFDTixXQUFPLEdBQUcsTUFBTSx1QkFBdUIsaUJBQWlCO0FBQUEsRUFDMUQ7QUFHQSxNQUFJLEVBQUUsV0FBVyxHQUFHLEtBQUssQ0FBQyxFQUFFLFdBQVcsSUFBSSxLQUFLLENBQUMsRUFBRSxXQUFXLElBQUksR0FBRztBQUNuRSxVQUFNLE9BQU8sRUFBRSxNQUFNLENBQUM7QUFDdEIsUUFBSSxLQUFLLFNBQVMsR0FBRyxLQUFLLENBQUMsS0FBSyxTQUFTLEdBQUcsS0FBSyxxQkFBcUIsSUFBSSxHQUFHO0FBQzNFLGFBQ0UsR0FBRyxNQUFNLFlBQVksSUFBSSx1QkFBdUIsSUFBSSxTQUM3QyxJQUFJLHlDQUF5QyxpQkFBaUI7QUFBQSxJQUV6RTtBQUNBLFdBQ0UsR0FBRyxNQUFNLDBEQUNUO0FBQUEsRUFFSjtBQUdBLE1BQ0csRUFBRSxXQUFXLElBQUksS0FBSyxDQUFDLEVBQUUsTUFBTSxDQUFDLEVBQUUsU0FBUyxHQUFHLEtBQzlDLEVBQUUsU0FBUyxHQUFHLEtBQUssRUFBRSxTQUFTLElBQUksR0FDbkM7QUFDQSxXQUNFLEdBQUcsTUFBTSw2RUFDK0IsaUJBQWlCO0FBQUEsRUFFN0Q7QUFFQSxNQUFJLENBQUMsRUFBRSxTQUFTLEdBQUcsS0FBSyxDQUFDLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFDeEMsV0FDRSxHQUFHLE1BQU0sMkRBQ1Q7QUFBQSxFQUVKO0FBRUEsU0FBTyxHQUFHLE1BQU0sS0FBSyxpQkFBaUI7QUFDeEM7QUFFTyxTQUFTLHFCQUNkLE9BQ2U7QUFDZixNQUFJLFVBQVUsUUFBUSxVQUFVLE9BQVcsUUFBTztBQUNsRCxRQUFNLFVBQVUsTUFBTSxLQUFLO0FBQzNCLE1BQUksQ0FBQyxRQUFTLFFBQU87QUFDckIsTUFBSTtBQUNGLFFBQUksT0FBTyxTQUFTLEdBQUc7QUFBQSxFQUN6QixRQUFRO0FBQ04sVUFBTSxJQUFJLG9CQUFvQix5Q0FBeUM7QUFBQSxFQUN6RTtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsbUJBQW1CLFlBQTZCO0FBQzlELE1BQ0UsT0FBTyxlQUFlLFlBQ3RCLENBQUMsT0FBTyxVQUFVLFVBQVUsS0FDNUIsYUFBYSxHQUNiO0FBQ0EsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBTU8sU0FBUyx5QkFDZCxPQUNBLE9BQ2U7QUFDZixNQUFJLFVBQVUsUUFBUSxVQUFVLE9BQVcsUUFBTztBQUNsRCxRQUFNLFVBQVUsTUFBTSxLQUFLO0FBQzNCLE1BQUksQ0FBQyxRQUFTLFFBQU87QUFDckIsUUFBTSxLQUFLLEtBQUssTUFBTSxPQUFPO0FBQzdCLE1BQUksQ0FBQyxPQUFPLFNBQVMsRUFBRSxHQUFHO0FBQ3hCLFVBQU0sSUFBSSxvQkFBb0IsR0FBRyxLQUFLLDJCQUEyQjtBQUFBLEVBQ25FO0FBQ0EsU0FBTyxJQUFJLEtBQUssRUFBRSxFQUFFLFlBQVk7QUFDbEM7QUFFTyxTQUFTLHNCQUNkLE9BQ0EsT0FDZ0Q7QUFDaEQsTUFBSSxTQUFTLFNBQVMsS0FBSyxNQUFNLEtBQUssSUFBSSxLQUFLLE1BQU0sS0FBSyxHQUFHO0FBQzNELFVBQU0sSUFBSSxvQkFBb0IsMkNBQTJDO0FBQUEsRUFDM0U7QUFDQSxTQUFPLEVBQUUsT0FBTyxNQUFNO0FBQ3hCO0FBRU8sU0FBUyxrQkFDZCxNQUNBLFVBQ29EO0FBQ3BELFFBQU0sSUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLFNBQVMsSUFBSSxJQUFJLE9BQU87QUFDckUsUUFBTSxPQUNKLE9BQU8sYUFBYSxZQUFZLE9BQU8sU0FBUyxRQUFRLElBQUksV0FBVztBQUN6RSxRQUFNLFdBQVcsS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLENBQUMsQ0FBQztBQUMxQyxRQUFNLFdBQVcsS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLElBQUksQ0FBQyxDQUFDO0FBQzVELFNBQU87QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLFVBQVU7QUFBQSxJQUNWLFNBQVMsV0FBVyxLQUFLO0FBQUEsRUFDM0I7QUFDRjs7O0FyQmxQQSxTQUFTLGdCQUF3QjtBQUMvQixRQUFNLFNBQVMsV0FBVyxFQUFFLElBQUksUUFBUTtBQUN4QyxNQUFJLE9BQU8sV0FBVyxVQUFVO0FBQzlCLFVBQU0sSUFBSSxNQUFNLGlCQUFpQjtBQUFBLEVBQ25DO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyw2QkFBcUM7QUFDNUMsUUFBTSxNQUFNLFdBQVc7QUFDdkIsUUFBTSxTQUFTLElBQUksSUFBSSxPQUFPLGVBQWU7QUFDN0MsTUFBSSxDQUFDLFFBQVEsV0FBVyxTQUFTLEdBQUc7QUFDbEMsVUFBTSxJQUFJLG9CQUFvQixvQ0FBb0M7QUFBQSxFQUNwRTtBQUNBLFNBQU87QUFDVDtBQTRGQSxTQUFTLFdBQVcsS0FhUjtBQUNWLFNBQU87QUFBQSxJQUNMLElBQUksSUFBSTtBQUFBLElBQ1IsU0FBUyxJQUFJO0FBQUEsSUFDYixVQUFVLElBQUk7QUFBQSxJQUNkLE9BQU8sSUFBSTtBQUFBLElBQ1gsU0FBUyxJQUFJO0FBQUEsSUFDYixhQUFhLElBQUk7QUFBQSxJQUNqQixnQkFBZ0IsSUFBSTtBQUFBLElBQ3BCLFlBQVkscUJBQXFCLElBQUksY0FBYyxJQUFJO0FBQUEsSUFDdkQsWUFBWSxxQkFBcUIsSUFBSSxjQUFjLElBQUk7QUFBQSxJQUN2RCxnQkFBZ0IscUJBQXFCLElBQUksY0FBYztBQUFBLElBQ3ZELFlBQVksZUFBZSxJQUFJLFVBQVU7QUFBQSxJQUN6QyxZQUFZLGVBQWUsSUFBSSxVQUFVO0FBQUEsRUFDM0M7QUFDRjtBQUVBLFNBQVMsZ0JBQWdCLEtBS1I7QUFDZixTQUFPO0FBQUEsSUFDTCxJQUFJLElBQUk7QUFBQSxJQUNSLFlBQVksSUFBSTtBQUFBLElBQ2hCLFNBQVMsSUFBSTtBQUFBLElBQ2IsWUFBWSxlQUFlLElBQUksVUFBVTtBQUFBLEVBQzNDO0FBQ0Y7QUFFQSxTQUFTLFdBQVcsS0FXUjtBQUNWLFNBQU87QUFBQSxJQUNMLElBQUksSUFBSTtBQUFBLElBQ1IsWUFBWSxJQUFJO0FBQUEsSUFDaEIscUJBQXFCLElBQUk7QUFBQSxJQUN6QixnQkFBZ0IsSUFBSTtBQUFBLElBQ3BCLGNBQWMsSUFBSTtBQUFBLElBQ2xCLFNBQVMsSUFBSTtBQUFBLElBQ2IsYUFBYSxlQUFlLElBQUksV0FBVztBQUFBLElBQzNDLFdBQVcsSUFBSSxhQUFhO0FBQUEsSUFDNUIsV0FBVyxJQUFJLGFBQWE7QUFBQSxJQUM1QixZQUFZLGVBQWUsSUFBSSxVQUFVO0FBQUEsRUFDM0M7QUFDRjtBQUVBLFNBQVMsWUFBWSxLQVVFO0FBQ3JCLFNBQU87QUFBQSxJQUNMLElBQUksSUFBSTtBQUFBLElBQ1IsWUFBWSxJQUFJO0FBQUEsSUFDaEIsTUFBTSxJQUFJO0FBQUEsSUFDVixTQUNFLE9BQU8sSUFBSSxZQUFZLFdBQ25CLElBQUksVUFDSixLQUFLLFVBQVUsSUFBSSxXQUFXLENBQUMsQ0FBQztBQUFBLElBQ3RDLFlBQVksSUFBSTtBQUFBLElBQ2hCLFFBQVEsSUFBSTtBQUFBLElBQ1osc0JBQXNCLElBQUksd0JBQXdCO0FBQUEsSUFDbEQsWUFBWSxlQUFlLElBQUksVUFBVTtBQUFBLElBQ3pDLFlBQVksZUFBZSxJQUFJLFVBQVU7QUFBQSxFQUMzQztBQUNGO0FBRUEsU0FBUyxXQUFXLEtBUVI7QUFDVixTQUFPO0FBQUEsSUFDTCxJQUFJLElBQUk7QUFBQSxJQUNSLFlBQVksSUFBSTtBQUFBLElBQ2hCLFlBQVksZUFBZSxJQUFJLFVBQVU7QUFBQSxJQUN6QyxhQUFhLHFCQUFxQixJQUFJLFdBQVc7QUFBQSxJQUNqRCxlQUFlLElBQUk7QUFBQSxJQUNuQixpQkFBaUIsSUFBSTtBQUFBLElBQ3JCLFlBQVksSUFBSTtBQUFBLEVBQ2xCO0FBQ0Y7QUFFQSxTQUFTLG1CQUFtQixLQWNSO0FBQ2xCLE1BQUksYUFBNEI7QUFDaEMsTUFBSSxJQUFJLGNBQWMsTUFBTTtBQUMxQixpQkFBYSxPQUFPLElBQUksZUFBZSxXQUNuQyxJQUFJLGFBQ0osS0FBSyxVQUFVLElBQUksVUFBVTtBQUFBLEVBQ25DO0FBQ0EsU0FBTztBQUFBLElBQ0wsSUFBSSxJQUFJO0FBQUEsSUFDUixZQUFZLElBQUk7QUFBQSxJQUNoQixTQUFTLElBQUk7QUFBQSxJQUNiLE1BQU0sSUFBSTtBQUFBLElBQ1YsTUFBTSxJQUFJO0FBQUEsSUFDVixTQUFTLElBQUk7QUFBQSxJQUNiLG9CQUFvQixJQUFJO0FBQUEsSUFDeEIscUJBQXFCLElBQUk7QUFBQSxJQUN6QjtBQUFBLElBQ0EsbUJBQW1CLElBQUk7QUFBQSxJQUN2QixTQUFTLElBQUk7QUFBQSxJQUNiLFlBQVksZUFBZSxJQUFJLFVBQVU7QUFBQSxJQUN6QyxZQUFZLGVBQWUsSUFBSSxVQUFVO0FBQUEsRUFDM0M7QUFDRjtBQUVBLGVBQWUsb0JBQW9CLFFBQWdCLFdBQW1CO0FBQ3BFLFFBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxXQUFXLEVBQ3RCLFVBQVUsRUFDVixNQUFNLE1BQU0sS0FBSyxTQUFTLEVBQzFCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsaUJBQWlCO0FBQ3BCLE1BQUksQ0FBQyxJQUFLLE9BQU0sSUFBSSxvQkFBb0IsbUJBQW1CO0FBQzNELFNBQU87QUFDVDtBQUVBLFNBQVMsb0JBQW9CLEtBQWE7QUFDeEMsTUFBSTtBQUNKLE1BQUk7QUFDRixhQUFTLEtBQUssTUFBTSxHQUFHO0FBQUEsRUFDekIsUUFBUTtBQUNOLFVBQU0sSUFBSSxvQkFBb0IsbUNBQW1DO0FBQUEsRUFDbkU7QUFDQSxRQUFNLGFBQWEsNkJBQTZCLE1BQU07QUFDdEQsTUFBSSxDQUFDLFlBQVk7QUFDZixVQUFNLElBQUksb0JBQW9CLGtDQUFrQztBQUFBLEVBQ2xFO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxrQkFBa0IsU0FBbUQ7QUFDNUUsUUFBTSxNQUFNLE9BQU8sWUFBWSxZQUMxQixNQUFNO0FBQ1AsUUFBSTtBQUNGLGFBQU8sS0FBSyxNQUFNLE9BQU87QUFBQSxJQUMzQixRQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGLEdBQUcsSUFDRDtBQUNKLE1BQUksUUFBUSxRQUFRLE9BQU8sUUFBUSxZQUFZLE1BQU0sUUFBUSxHQUFHLEVBQUcsUUFBTztBQUMxRSxRQUFNLElBQUk7QUFDVixNQUFJLE9BQU8sRUFBRSxnQkFBZ0IsWUFBWSxPQUFPLEVBQUUsWUFBWSxVQUFVO0FBQ3RFLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUFBLElBQ0wsYUFBYSxFQUFFO0FBQUEsSUFDZixVQUFVLE9BQU8sRUFBRSxhQUFhLFdBQVcsRUFBRSxXQUFXO0FBQUEsSUFDeEQsU0FBUyxFQUFFO0FBQUEsSUFDWCxVQUFVLE9BQU8sRUFBRSxhQUFhLFdBQVcsRUFBRSxXQUFXO0FBQUEsSUFDeEQsTUFBTSxPQUFPLEVBQUUsU0FBUyxXQUFXLEVBQUUsT0FBTztBQUFBLElBQzVDLGVBQWUsT0FBTyxFQUFFLGtCQUFrQixXQUFXLEVBQUUsZ0JBQWdCO0FBQUEsSUFDdkUsWUFBWSxPQUFPLEVBQUUsZUFBZSxXQUFXLEVBQUUsYUFBYTtBQUFBLElBQzlELG9CQUNFLE9BQU8sRUFBRSx1QkFBdUIsV0FBVyxFQUFFLHFCQUFxQjtBQUFBLElBQ3BFLFlBQVksT0FBTyxFQUFFLGVBQWUsV0FBVyxFQUFFLGFBQWE7QUFBQSxFQUNoRTtBQUNGO0FBRUEsSUFBTSxRQUFRO0FBQUEsRUFDWixNQUFNLFlBQWdDO0FBQ3BDLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sT0FBTyxNQUFNLEdBQ2hCLFdBQVcsV0FBVyxFQUN0QixVQUFVLEVBQ1YsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixRQUFRLE1BQU0sS0FBSyxFQUNuQixRQUFRO0FBQ1gsV0FBTyxLQUFLLElBQUksVUFBVTtBQUFBLEVBQzVCO0FBQUEsRUFFQSxNQUFNLGNBQWMsV0FBNEM7QUFDOUQsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxvQkFBb0IsUUFBUSxTQUFTO0FBQzNDLFVBQU0sT0FBTyxNQUFNLEdBQ2hCLFdBQVcsZ0JBQWdCLEVBQzNCLFVBQVUsRUFDVixNQUFNLGNBQWMsS0FBSyxTQUFTLEVBQ2xDLFFBQVEsTUFBTSxLQUFLLEVBQ25CLFFBQVE7QUFDWCxXQUFPLEtBQUssSUFBSSxlQUFlO0FBQUEsRUFDakM7QUFBQSxFQUVBLE1BQU0sU0FDSixXQUNBLDBCQUNvQjtBQUNwQixVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLG9CQUFvQixRQUFRLFNBQVM7QUFDM0MsVUFBTSxPQUFPLE1BQU0sR0FDaEIsV0FBVyxVQUFVLEVBQ3JCLFVBQVUsRUFDVixNQUFNLGNBQWMsS0FBSyxTQUFTLEVBQ2xDLFFBQVEsZUFBZSxNQUFNLEVBQzdCLFFBQVE7QUFDWCxVQUFNLFNBQVMsS0FBSyxJQUFJLFVBQVU7QUFDbEMsUUFBSSxDQUFDLHlCQUEwQixRQUFPO0FBRXRDLFVBQU0sWUFBWSxNQUFNLEdBQ3JCLFdBQVcsbUJBQW1CLEVBQzlCLE9BQU8sQ0FBQyxzQkFBc0IsdUJBQXVCLFNBQVMsQ0FBQyxFQUMvRCxNQUFNLGNBQWMsS0FBSyxTQUFTLEVBQ2xDLE1BQU0sV0FBVyxLQUFLLElBQUksRUFDMUIsUUFBUTtBQUNYLFVBQU0sUUFBUSxVQUFVLElBQUksQ0FBQyxPQUFPO0FBQUEsTUFDbEMsa0JBQWtCLEVBQUU7QUFBQSxNQUNwQixtQkFBbUIsRUFBRTtBQUFBLE1BQ3JCLFNBQVMsRUFBRTtBQUFBLElBQ2IsRUFBRTtBQUNGLFdBQU8sT0FBTztBQUFBLE1BQ1osQ0FBQyxNQUNDLENBQUM7QUFBQSxRQUNDLEVBQUUsTUFBTSxFQUFFLGNBQWMsU0FBUyxFQUFFLFFBQVE7QUFBQSxRQUMzQztBQUFBLE1BQ0Y7QUFBQSxJQUNKO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxRQUFRLElBQXFDO0FBQ2pELFVBQU0sU0FBUyxjQUFjO0FBQzdCLFdBQU8sTUFBTSxpQkFBaUIsK0JBQStCLEVBQUUsR0FBRyxRQUFRLEVBQUU7QUFBQSxFQUM5RTtBQUFBLEVBRUEsTUFBTSx3QkFBd0IsV0FBNEM7QUFDeEUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsV0FBTyxNQUFNO0FBQUEsTUFDWCwrQkFBK0IsRUFBRTtBQUFBLE1BQ2pDO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLG9CQUNKLFdBQ0EsUUFDQSxNQUNBLFVBQ2lDO0FBQ2pDLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sRUFBRSxNQUFNLFVBQVUsVUFBVSxVQUFVLE9BQU8sSUFBSTtBQUFBLE1BQ3JEO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFDQSxVQUFNLGVBQ0osVUFBVSxRQUFRLFdBQVcsS0FDekIsdUJBQXVCLE1BQU0sSUFDN0I7QUFFTixRQUFJLFNBQVMsR0FDVixXQUFXLHNCQUFzQixFQUNqQyxVQUFVLFlBQVksZUFBZSxpQ0FBaUMsRUFDdEUsVUFBVSxhQUFhLGdCQUFnQixxQkFBcUIsRUFDNUQsT0FBTyxDQUFDLE9BQU8sR0FBRyxHQUFHLFNBQWlCLEVBQUUsR0FBRyxPQUFPLENBQUMsRUFDbkQsTUFBTSxxQkFBcUIsS0FBSyxNQUFNO0FBQ3pDLFFBQUksYUFBYSxNQUFNO0FBQ3JCLGVBQVMsT0FBTyxNQUFNLHVCQUF1QixLQUFLLFNBQVM7QUFBQSxJQUM3RDtBQUNBLFFBQUksZ0JBQWdCLE1BQU07QUFDeEIsZUFBUyxPQUFPLE1BQU0sK0JBQStCLEtBQUssWUFBWTtBQUFBLElBQ3hFO0FBQ0EsVUFBTSxXQUFXLE1BQU0sT0FBTyx3QkFBd0I7QUFDdEQsVUFBTSxhQUFhLE9BQU8sU0FBUyxLQUFLO0FBRXhDLFFBQUksUUFBUSxHQUNULFdBQVcsc0JBQXNCLEVBQ2pDLFVBQVUsWUFBWSxlQUFlLGlDQUFpQyxFQUN0RSxVQUFVLGFBQWEsZ0JBQWdCLHFCQUFxQixFQUM1RCxVQUFVLHNCQUFzQixFQUNoQyxNQUFNLHFCQUFxQixLQUFLLE1BQU07QUFDekMsUUFBSSxhQUFhLE1BQU07QUFDckIsY0FBUSxNQUFNLE1BQU0sdUJBQXVCLEtBQUssU0FBUztBQUFBLElBQzNEO0FBQ0EsUUFBSSxnQkFBZ0IsTUFBTTtBQUN4QixjQUFRLE1BQU0sTUFBTSwrQkFBK0IsS0FBSyxZQUFZO0FBQUEsSUFDdEU7QUFDQSxVQUFNLE9BQU8sTUFBTSxNQUNoQixRQUFRLDJCQUEyQixNQUFNLEVBQ3pDLE1BQU0sUUFBUSxFQUNkLE9BQU8sTUFBTSxFQUNiLFFBQVE7QUFFWCxXQUFPO0FBQUEsTUFDTCxPQUFPLEtBQUssSUFBSSxXQUFXO0FBQUEsTUFDM0I7QUFBQSxNQUNBLE1BQU07QUFBQSxNQUNOLFVBQVU7QUFBQSxJQUNaO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxTQUFTLFdBQXVDO0FBQ3BELFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sb0JBQW9CLFFBQVEsU0FBUztBQUMzQyxVQUFNLE9BQU8sTUFBTSxHQUNoQixXQUFXLFdBQVcsRUFDdEIsVUFBVSxFQUNWLE1BQU0sY0FBYyxLQUFLLFNBQVMsRUFDbEMsUUFBUSxNQUFNLE1BQU0sRUFDcEIsTUFBTSxFQUFFLEVBQ1IsUUFBUTtBQUNYLFdBQU8sS0FBSyxJQUFJLFVBQVU7QUFBQSxFQUM1QjtBQUFBLEVBRUEsTUFBTSxpQkFBaUIsV0FBK0M7QUFDcEUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxvQkFBb0IsUUFBUSxTQUFTO0FBQzNDLFVBQU0sT0FBTyxNQUFNLEdBQ2hCLFdBQVcsbUJBQW1CLEVBQzlCLFVBQVUsRUFDVixNQUFNLGNBQWMsS0FBSyxTQUFTLEVBQ2xDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUSxNQUFNLEtBQUssRUFDbkIsUUFBUTtBQUNYLFdBQU8sS0FBSyxJQUFJLGtCQUFrQjtBQUFBLEVBQ3BDO0FBQ0Y7QUFFQSxJQUFNLFdBQVc7QUFBQSxFQUNmLE1BQU0sY0FBYyxPQUE2QztBQUMvRCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFdBQVcsaUJBQWlCLE1BQU0sUUFBUTtBQUNoRCxVQUFNLFFBQVEsY0FBYyxNQUFNLEtBQUs7QUFFdkMsVUFBTSxhQUFhLE1BQU0saUJBQWlCLENBQUM7QUFDM0MsVUFBTSxXQUFXLFdBQVcsV0FBVyxJQUNuQyxDQUFDLElBQ0QsdUJBQXVCLFVBQVU7QUFDckMsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBRW5DLFVBQU0sU0FBcUI7QUFBQSxNQUN6QixTQUFTO0FBQUEsTUFDVDtBQUFBLE1BQ0E7QUFBQSxNQUNBLFNBQVMsTUFBTSxXQUFXO0FBQUEsTUFDMUIsYUFBYTtBQUFBLE1BQ2IsZ0JBQWdCLFNBQVMsU0FBUztBQUFBLE1BQ2xDLG1CQUFtQixNQUFNLG1CQUFtQjtBQUFBLE1BQzVDLGdCQUFnQjtBQUFBLE1BQ2hCLFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxJQUNkO0FBRUEsVUFBTSxVQUFVLE1BQU0sR0FDbkIsV0FBVyxXQUFXLEVBQ3RCLE9BQU8sTUFBTSxFQUNiLGFBQWEsRUFDYix3QkFBd0I7QUFFM0IsUUFBSSxTQUFTLFNBQVMsR0FBRztBQUN2QixZQUFNLEdBQ0gsV0FBVyxnQkFBZ0IsRUFDM0I7QUFBQSxRQUNDLFNBQVMsSUFBSSxDQUFDLGFBQWE7QUFBQSxVQUN6QixZQUFZLFFBQVE7QUFBQSxVQUNwQjtBQUFBLFVBQ0EsWUFBWTtBQUFBLFFBQ2QsRUFBRTtBQUFBLE1BQ0osRUFDQyxRQUFRO0FBQUEsSUFDYjtBQUVBLFdBQU8sV0FBVyxPQUFPO0FBQUEsRUFDM0I7QUFBQSxFQUVBLE1BQU0sY0FBYyxPQUE2QztBQUMvRCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLG9CQUFvQixRQUFRLE1BQU0sRUFBRTtBQUMxQyxVQUFNLFFBQVEsY0FBYyxNQUFNLEtBQUs7QUFDdkMsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLFVBQU0sTUFBTSxNQUFNLEdBQ2YsWUFBWSxXQUFXLEVBQ3ZCLElBQUksRUFBRSxPQUFPLFlBQVksSUFBSSxDQUFDLEVBQzlCLE1BQU0sTUFBTSxLQUFLLE1BQU0sRUFBRSxFQUN6QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLGFBQWEsRUFDYix3QkFBd0I7QUFDM0IsV0FBTyxXQUFXLEdBQUc7QUFBQSxFQUN2QjtBQUFBLEVBRUEsTUFBTSxjQUFjLElBQThCO0FBQ2hELFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sU0FBUyxNQUFNLEdBQ2xCLFdBQVcsV0FBVyxFQUN0QixNQUFNLE1BQU0sS0FBSyxFQUFFLEVBQ25CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsaUJBQWlCO0FBQ3BCLFdBQU8sT0FBTyxPQUFPLGtCQUFrQixDQUFDLElBQUk7QUFBQSxFQUM5QztBQUFBLEVBRUEsTUFBTSxXQUFXLFdBQXFDO0FBQ3BELFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sb0JBQW9CLFFBQVEsU0FBUztBQUMzQyxVQUFNLE1BQU0sTUFBTTtBQUFBLE1BQ2hCLDBCQUEwQixFQUFFO0FBQUEsTUFDNUI7QUFBQSxJQUNGO0FBQ0EsV0FBTyxXQUFXLEdBQUc7QUFBQSxFQUN2QjtBQUFBLEVBRUEsTUFBTSxpQkFBaUIsT0FBdUQ7QUFDNUUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxvQkFBb0IsUUFBUSxNQUFNLFNBQVM7QUFDakQsVUFBTSxXQUFXLHVCQUF1QixNQUFNLFFBQVE7QUFDdEQsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBRW5DLFVBQU0sR0FDSCxXQUFXLGdCQUFnQixFQUMzQixNQUFNLGNBQWMsS0FBSyxNQUFNLFNBQVMsRUFDeEMsUUFBUTtBQUVYLFFBQUksU0FBUyxTQUFTLEdBQUc7QUFDdkIsWUFBTSxHQUNILFdBQVcsZ0JBQWdCLEVBQzNCO0FBQUEsUUFDQyxTQUFTLElBQUksQ0FBQyxhQUFhO0FBQUEsVUFDekIsWUFBWSxNQUFNO0FBQUEsVUFDbEI7QUFBQSxVQUNBLFlBQVk7QUFBQSxRQUNkLEVBQUU7QUFBQSxNQUNKLEVBQ0MsUUFBUTtBQUFBLElBQ2I7QUFFQSxVQUFNLE9BQU8sTUFBTSxHQUNoQixXQUFXLGdCQUFnQixFQUMzQixVQUFVLEVBQ1YsTUFBTSxjQUFjLEtBQUssTUFBTSxTQUFTLEVBQ3hDLFFBQVEsTUFBTSxLQUFLLEVBQ25CLFFBQVE7QUFDWCxXQUFPLEtBQUssSUFBSSxlQUFlO0FBQUEsRUFDakM7QUFBQSxFQUVBLE1BQU0sWUFDSixXQUNBLE9BQ0EsT0FDa0I7QUFDbEIsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxvQkFBb0IsUUFBUSxTQUFTO0FBQzNDLFVBQU0sY0FBYyxNQUFNLEdBQ3ZCLFdBQVcsZ0JBQWdCLEVBQzNCLE9BQU8sQ0FBQyxPQUFPLEdBQUcsR0FBRyxTQUFpQixFQUFFLEdBQUcsT0FBTyxDQUFDLEVBQ25ELE1BQU0sY0FBYyxLQUFLLFNBQVMsRUFDbEMsd0JBQXdCO0FBQzNCLFFBQUksT0FBTyxZQUFZLEtBQUssSUFBSSxHQUFHO0FBQ2pDLFlBQU0sSUFBSTtBQUFBLFFBQ1I7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFVBQU0sUUFBUTtBQUFBLE1BQ1oseUJBQXlCLE9BQU8sT0FBTztBQUFBLE1BQ3ZDLHlCQUF5QixPQUFPLE9BQU87QUFBQSxJQUN6QztBQUNBLFVBQU0sT0FBTSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUNuQyxVQUFNLE1BQU0sTUFBTSxHQUNmLFlBQVksV0FBVyxFQUN2QixJQUFJO0FBQUEsTUFDSCxnQkFBZ0I7QUFBQSxNQUNoQixZQUFZLE1BQU07QUFBQSxNQUNsQixZQUFZLE1BQU07QUFBQSxNQUNsQixzQkFBc0I7QUFBQSxNQUN0QixZQUFZO0FBQUEsSUFDZCxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssU0FBUyxFQUMxQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLGFBQWEsRUFDYix3QkFBd0I7QUFDM0IsV0FBTyxXQUFXLEdBQUc7QUFBQSxFQUN2QjtBQUFBLEVBRUEsTUFBTSwwQkFBMEIsV0FBb0M7QUFDbEUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxvQkFBb0IsUUFBUSxTQUFTO0FBQzNDLFdBQU8sTUFBTTtBQUFBLE1BQ1gsMEJBQTBCLEVBQUU7QUFBQSxNQUM1QjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLHFCQUNKLE9BQzZCO0FBQzdCLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sU0FBUyx1QkFBdUIsTUFBTSxNQUFNO0FBQ2xELFVBQU0sUUFBUSxNQUFNLEdBQ2pCLFdBQVcsc0JBQXNCLEVBQ2pDLFVBQVUsWUFBWSxlQUFlLGlDQUFpQyxFQUN0RSxVQUFVLGFBQWEsZ0JBQWdCLHFCQUFxQixFQUM1RCxVQUFVLHNCQUFzQixFQUNoQyxNQUFNLDJCQUEyQixLQUFLLE1BQU0sVUFBVSxFQUN0RCxNQUFNLHFCQUFxQixLQUFLLE1BQU0sRUFDdEMsaUJBQWlCO0FBRXBCLFFBQUksQ0FBQyxNQUFPLE9BQU0sSUFBSSxvQkFBb0Isb0JBQW9CO0FBRTlELFVBQU0sT0FBTSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUVuQyxRQUFJLFdBQVcsWUFBWTtBQUN6QixZQUFNQyxPQUFNLE1BQU0sR0FDZixZQUFZLHNCQUFzQixFQUNsQyxJQUFJLEVBQUUsUUFBUSxZQUFZLElBQUksQ0FBQyxFQUMvQixNQUFNLE1BQU0sS0FBSyxNQUFNLFVBQVUsRUFDakMsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixhQUFPLFlBQVlBLElBQUc7QUFBQSxJQUN4QjtBQUVBLFFBQUksV0FBVyxZQUFZO0FBQ3pCLFVBQUksTUFBTSxTQUFTLHlCQUF5QjtBQUMxQyxZQUFJLE1BQU0sd0JBQXdCLE1BQU07QUFDdEMsZ0JBQU1BLE9BQU0sTUFBTSxHQUNmLFlBQVksc0JBQXNCLEVBQ2xDLElBQUksRUFBRSxRQUFRLFlBQVksWUFBWSxJQUFJLENBQUMsRUFDM0MsTUFBTSxNQUFNLEtBQUssTUFBTSxVQUFVLEVBQ2pDLGFBQWEsRUFDYix3QkFBd0I7QUFDM0IsaUJBQU8sWUFBWUEsSUFBRztBQUFBLFFBQ3hCO0FBRUEsY0FBTSxhQUFhLG1CQUFtQixNQUFNLFVBQVU7QUFDdEQsY0FBTSxZQUFZLGtCQUFrQixNQUFNLE9BQU87QUFDakQsWUFBSSxDQUFDLFdBQVc7QUFDZCxnQkFBTSxJQUFJLG9CQUFvQiw4Q0FBOEM7QUFBQSxRQUM5RTtBQUVBLFlBQUk7QUFDRixnQkFBTSxZQUFZLE1BQU07QUFBQSxZQUN0QjtBQUFBLFlBQ0E7QUFBQSxZQUNBLDJCQUEyQjtBQUFBLFVBQzdCO0FBQ0EsZ0JBQU0sY0FBYztBQUFBLFlBQ2xCLEdBQUc7QUFBQSxZQUNILG9CQUFvQixVQUFVO0FBQUEsVUFDaEM7QUFDQSxnQkFBTUEsT0FBTSxNQUFNLEdBQ2YsWUFBWSxzQkFBc0IsRUFDbEMsSUFBSTtBQUFBLFlBQ0gsUUFBUTtBQUFBLFlBQ1Isc0JBQXNCLFVBQVU7QUFBQSxZQUNoQyxTQUFTO0FBQUEsWUFDVCxZQUFZO0FBQUEsVUFDZCxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssTUFBTSxVQUFVLEVBQ2pDLGFBQWEsRUFDYix3QkFBd0I7QUFDM0IsaUJBQU8sWUFBWUEsSUFBRztBQUFBLFFBQ3hCLFNBQVMsS0FBSztBQUNaLGNBQUksZUFBZSx1QkFBdUI7QUFDeEMsa0JBQU0sSUFBSTtBQUFBLGNBQ1IsOEJBQThCLElBQUksT0FBTztBQUFBLFlBQzNDO0FBQUEsVUFDRjtBQUNBLGdCQUFNO0FBQUEsUUFDUjtBQUFBLE1BQ0Y7QUFFQSxZQUFNQSxPQUFNLE1BQU0sR0FDZixZQUFZLHNCQUFzQixFQUNsQyxJQUFJLEVBQUUsUUFBUSxZQUFZLFlBQVksSUFBSSxDQUFDLEVBQzNDLE1BQU0sTUFBTSxLQUFLLE1BQU0sVUFBVSxFQUNqQyxhQUFhLEVBQ2Isd0JBQXdCO0FBQzNCLGFBQU8sWUFBWUEsSUFBRztBQUFBLElBQ3hCO0FBR0EsVUFBTSxNQUFNLE1BQU0sR0FDZixZQUFZLHNCQUFzQixFQUNsQyxJQUFJLEVBQUUsUUFBUSxZQUFZLElBQUksQ0FBQyxFQUMvQixNQUFNLE1BQU0sS0FBSyxNQUFNLFVBQVUsRUFDakMsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixXQUFPLFlBQVksR0FBRztBQUFBLEVBQ3hCO0FBQUEsRUFFQSxNQUFNLGFBQWEsT0FBNEM7QUFDN0QsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxVQUFVLE1BQU0sb0JBQW9CLFFBQVEsTUFBTSxTQUFTO0FBQ2pFLFFBQUksUUFBUSxhQUFhLFNBQVM7QUFDaEMsWUFBTSxJQUFJLG9CQUFvQiwrQkFBK0I7QUFBQSxJQUMvRDtBQUNBLFFBQUksQ0FBQyxNQUFNLFlBQVksS0FBSyxHQUFHO0FBQzdCLFlBQU0sSUFBSSxvQkFBb0IseUJBQXlCO0FBQUEsSUFDekQ7QUFFQSxVQUFNLGNBQWMsTUFBTSxZQUFZLEtBQUs7QUFDM0MsVUFBTSxTQUFTO0FBQUEsTUFDYjtBQUFBLE1BQ0EsY0FBYyxNQUFNLGdCQUFnQjtBQUFBLE1BQ3BDLGFBQWEsTUFBTSxlQUFlO0FBQUEsSUFDcEM7QUFDQSxVQUFNLFFBQVEsTUFBTSx1QkFBdUIsRUFBRSxZQUFZLENBQUM7QUFDMUQsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLFVBQU0sTUFBTSxNQUFNLEdBQ2YsWUFBWSxXQUFXLEVBQ3ZCLElBQUk7QUFBQSxNQUNILG1CQUFtQixLQUFLLFVBQVUsTUFBTTtBQUFBLE1BQ3hDLEdBQUksUUFBUSxFQUFFLE9BQU8sTUFBTSxJQUFJLENBQUM7QUFBQSxNQUNoQyxnQkFBZ0I7QUFBQSxNQUNoQixZQUFZO0FBQUEsSUFDZCxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssUUFBUSxFQUFFLEVBQzNCLGFBQWEsRUFDYix3QkFBd0I7QUFDM0IsV0FBTyxXQUFXLEdBQUc7QUFBQSxFQUN2QjtBQUFBLEVBRUEsTUFBTSxnQkFDSixPQUNpQztBQUNqQyxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFVBQVUsTUFBTSxvQkFBb0IsUUFBUSxNQUFNLFNBQVM7QUFDakUsUUFBSSxRQUFRLGFBQWEsU0FBUztBQUNoQyxZQUFNLElBQUksb0JBQW9CLCtCQUErQjtBQUFBLElBQy9EO0FBRUEsVUFBTSxXQUFXLE1BQU0sVUFBVSxLQUFLLEtBQUs7QUFDM0MsUUFBSSxDQUFDLFVBQVU7QUFDYixZQUFNLElBQUksb0JBQW9CLHNCQUFzQjtBQUFBLElBQ3REO0FBRUEsUUFBSUM7QUFDSixRQUFJO0FBQ0YsTUFBQUEsVUFBUyxxQkFBcUI7QUFBQSxJQUNoQyxTQUFTLEtBQUs7QUFDWixVQUFJLGVBQWUsaUJBQWlCO0FBQ2xDLGNBQU0sSUFBSSxvQkFBb0IsSUFBSSxPQUFPO0FBQUEsTUFDM0M7QUFDQSxZQUFNO0FBQUEsSUFDUjtBQUVBLFFBQUksQ0FBQyxrQkFBa0IsVUFBVUEsUUFBTyxpQkFBaUIsR0FBRztBQUMxRCxZQUFNLElBQUksb0JBQW9CLHlCQUF5QjtBQUFBLElBQ3pEO0FBRUEsVUFBTSxRQUFRLE1BQU07QUFBQSxNQUNsQixFQUFFLFFBQVEsV0FBVyxRQUFRLElBQUksU0FBUztBQUFBLE1BQzFDQSxRQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sbUJBQW1CLHdCQUF3QjtBQUFBLE1BQy9DLFVBQVVBLFFBQU87QUFBQSxNQUNqQixhQUFhQSxRQUFPO0FBQUEsTUFDcEI7QUFBQSxJQUNGLENBQUM7QUFDRCxXQUFPLEVBQUUsaUJBQWlCO0FBQUEsRUFDNUI7QUFBQSxFQUVBLE1BQU0sc0JBQ0osT0FDMEI7QUFDMUIsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxvQkFBb0IsUUFBUSxNQUFNLFNBQVM7QUFDakQsVUFBTSxPQUFPLHFCQUFxQixNQUFNLFFBQVEsU0FBUztBQUN6RCxVQUFNLE9BQU8scUJBQXFCLE1BQU0sSUFBSTtBQUM1QyxVQUFNLG1CQUFtQix5QkFBeUIsTUFBTSxnQkFBZ0I7QUFDeEUsVUFBTSxvQkFBb0IscUJBQXFCLE1BQU0saUJBQWlCO0FBQ3RFLFFBQUksYUFBNEQ7QUFDaEUsUUFBSSxTQUFTLFdBQVc7QUFDdEIsVUFBSSxNQUFNLGtCQUFrQixRQUFRLENBQUMsTUFBTSxlQUFlLEtBQUssR0FBRztBQUNoRSxjQUFNLElBQUk7QUFBQSxVQUNSO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFDQSxtQkFBYSxvQkFBb0IsTUFBTSxjQUFjO0FBQUEsSUFDdkQ7QUFDQSxVQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFFbkMsUUFBSSxNQUFNLG1CQUFtQixNQUFNO0FBQ2pDLFlBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxVQUFVLEVBQ3JCLFVBQVUsYUFBYSxnQkFBZ0IscUJBQXFCLEVBQzVELE9BQU8sYUFBYSxFQUNwQixNQUFNLGVBQWUsS0FBSyxNQUFNLGVBQWUsRUFDL0MsTUFBTSxxQkFBcUIsS0FBSyxNQUFNLEVBQ3RDLE1BQU0sdUJBQXVCLEtBQUssTUFBTSxTQUFTLEVBQ2pELGlCQUFpQjtBQUNwQixVQUFJLENBQUMsSUFBSyxPQUFNLElBQUksb0JBQW9CLDBCQUEwQjtBQUFBLElBQ3BFO0FBRUEsVUFBTSxNQUFNLE1BQU0sR0FDZixXQUFXLG1CQUFtQixFQUM5QixPQUFPO0FBQUEsTUFDTixZQUFZLE1BQU07QUFBQSxNQUNsQixTQUFTO0FBQUEsTUFDVDtBQUFBLE1BQ0E7QUFBQSxNQUNBLFNBQVMsTUFBTSxXQUFXO0FBQUEsTUFDMUIsb0JBQW9CO0FBQUEsTUFDcEIscUJBQXFCO0FBQUEsTUFDckI7QUFBQSxNQUNBLG1CQUFtQixNQUFNLG1CQUFtQjtBQUFBLE1BQzVDLFNBQVM7QUFBQSxNQUNULFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxJQUNkLENBQUMsRUFDQSxhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLFVBQU07QUFBQSxNQUNKLGdDQUFnQyxFQUFFO0FBQUEsTUFDbEMsTUFBTTtBQUFBLE1BQ047QUFBQSxJQUNGO0FBQ0EsV0FBTyxtQkFBbUIsR0FBRztBQUFBLEVBQy9CO0FBQUEsRUFFQSxNQUFNLHNCQUNKLE9BQzBCO0FBQzFCLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sV0FBVyxNQUFNLEdBQ3BCLFdBQVcsbUJBQW1CLEVBQzlCLFVBQVUsRUFDVixNQUFNLE1BQU0sS0FBSyxNQUFNLEVBQUUsRUFDekIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixpQkFBaUI7QUFDcEIsUUFBSSxDQUFDLFNBQVUsT0FBTSxJQUFJLG9CQUFvQixvQkFBb0I7QUFFakUsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLFVBQU0sUUFRRjtBQUFBLE1BQ0YsU0FBUyxTQUFTLFVBQVU7QUFBQSxNQUM1QixZQUFZO0FBQUEsSUFDZDtBQUVBLFFBQUksTUFBTSxRQUFRLEtBQU0sT0FBTSxPQUFPLHFCQUFxQixNQUFNLElBQUk7QUFDcEUsUUFBSSxNQUFNLG9CQUFvQixNQUFNO0FBQ2xDLFlBQU0scUJBQXFCLHlCQUF5QixNQUFNLGdCQUFnQjtBQUFBLElBQzVFO0FBQ0EsUUFBSSxNQUFNLHNCQUFzQixRQUFXO0FBQ3pDLFlBQU0sc0JBQXNCLHFCQUFxQixNQUFNLGlCQUFpQjtBQUFBLElBQzFFO0FBQ0EsUUFBSSxNQUFNLGtCQUFrQixNQUFNO0FBQ2hDLFVBQUksU0FBUyxTQUFTLFVBQVU7QUFDOUIsY0FBTSxJQUFJO0FBQUEsVUFDUjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQ0EsWUFBTSxhQUFhLG9CQUFvQixNQUFNLGNBQWM7QUFBQSxJQUM3RDtBQUNBLFFBQUksTUFBTSxXQUFXLEtBQU0sT0FBTSxVQUFVLE1BQU07QUFFakQsVUFBTSxNQUFNLE1BQU0sR0FDZixZQUFZLG1CQUFtQixFQUMvQixJQUFJLEtBQUssRUFDVCxNQUFNLE1BQU0sS0FBSyxNQUFNLEVBQUUsRUFDekIsYUFBYSxFQUNiLHdCQUF3QjtBQUUzQixVQUFNO0FBQUEsTUFDSixnQ0FBZ0MsRUFBRTtBQUFBLE1BQ2xDLFNBQVM7QUFBQSxNQUNUO0FBQUEsSUFDRjtBQUNBLFdBQU8sbUJBQW1CLEdBQUc7QUFBQSxFQUMvQjtBQUFBLEVBRUEsTUFBTSxzQkFBc0IsSUFBOEI7QUFDeEQsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxTQUFTLE1BQU0sR0FDbEIsV0FBVyxtQkFBbUIsRUFDOUIsTUFBTSxNQUFNLEtBQUssRUFBRSxFQUNuQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLGlCQUFpQjtBQUNwQixXQUFPLE9BQU8sT0FBTyxrQkFBa0IsQ0FBQyxJQUFJO0FBQUEsRUFDOUM7QUFBQSxFQUVBLE1BQU0sd0JBQ0osT0FDeUM7QUFDekMsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxXQUFXLHFCQUFxQixNQUFNLFFBQVE7QUFDcEQsVUFBTSxVQUFVLE1BQU0sR0FDbkIsV0FBVyxVQUFVLEVBQ3JCLFVBQVUsYUFBYSxnQkFBZ0IscUJBQXFCLEVBQzVELE9BQU87QUFBQSxNQUNOO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0YsQ0FBQyxFQUNBLE1BQU0sZUFBZSxLQUFLLE1BQU0sU0FBUyxFQUN6QyxNQUFNLHFCQUFxQixLQUFLLE1BQU0sRUFDdEMsaUJBQWlCO0FBRXBCLFFBQUksQ0FBQyxRQUFTLE9BQU0sSUFBSSxvQkFBb0IsbUJBQW1CO0FBQy9ELFFBQUksQ0FBQyxRQUFRLFdBQVcsS0FBSyxHQUFHO0FBQzlCLFlBQU0sSUFBSTtBQUFBLFFBQ1I7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLFVBQU0scUJBQXFCO0FBQzNCLFVBQU0seUJBQXlCLENBQUMsUUFBZ0IsWUFBNkI7QUFDM0UsY0FBUTtBQUFBLFFBQ047QUFBQSxRQUNBO0FBQUEsUUFDQSxXQUFXO0FBQUEsTUFDYjtBQUNBLFlBQU0sSUFBSSxvQkFBb0Isa0JBQWtCO0FBQUEsSUFDbEQ7QUFFQSxVQUFNLFVBQVU7QUFBQSxNQUNkLE1BQU0sUUFBUTtBQUFBLE1BQ2QsU0FBUyxRQUFRO0FBQUEsTUFDakIsVUFBVSxRQUFRO0FBQUEsTUFDbEIsT0FBTyxNQUFNO0FBQUEsSUFDZjtBQUVBLFFBQUk7QUFDSixRQUFJO0FBQ0osUUFBSSxhQUVPO0FBQ1gsUUFBSTtBQUVKLFFBQUk7QUFDRixVQUFJLGFBQWEsVUFBVTtBQUN6QixjQUFNLFFBQVEsTUFBTSw0QkFBNEIsT0FBTztBQUN2RCwyQkFBbUIseUJBQXlCLE1BQU0sZ0JBQWdCO0FBQ2xFLDRCQUFvQixxQkFBcUIsTUFBTSxpQkFBaUI7QUFDaEUseUJBQWlCLE1BQU0sa0JBQWtCO0FBQUEsTUFDM0MsT0FBTztBQUNMLGNBQU0sUUFBUSxNQUFNLDJCQUEyQixPQUFPO0FBQ3RELDJCQUFtQix5QkFBeUIsTUFBTSxnQkFBZ0I7QUFDbEUsNEJBQW9CLHFCQUFxQixNQUFNLGlCQUFpQjtBQUNoRSxjQUFNLFNBQVMsNkJBQTZCLE1BQU0sVUFBVTtBQUM1RCxZQUFJLENBQUMsUUFBUTtBQUNYLGlDQUF1QixrQ0FBa0M7QUFBQSxZQUN2RCxXQUFXLFFBQVE7QUFBQSxZQUNuQixZQUFZLE1BQU07QUFBQSxVQUNwQixDQUFDO0FBQUEsUUFDSDtBQUNBLHFCQUFhO0FBQ2IseUJBQWlCLE1BQU0sa0JBQWtCO0FBQUEsTUFDM0M7QUFBQSxJQUNGLFNBQVMsS0FBSztBQUNaLFVBQ0UsZUFBZSx1QkFDZixJQUFJLFlBQVksb0JBQ2hCO0FBQ0EsY0FBTTtBQUFBLE1BQ1I7QUFDQSxVQUFJLGVBQWUsaUJBQWlCLGVBQWUscUJBQXFCO0FBQ3RFLCtCQUF1QixJQUFJLFNBQVMsRUFBRSxXQUFXLFFBQVEsR0FBRyxDQUFDO0FBQUEsTUFDL0Q7QUFDQSxZQUFNO0FBQUEsSUFDUjtBQUVBLFVBQU0sT0FBTztBQUFBLE1BQ1gsTUFBTSxNQUFNLEtBQUssS0FBSztBQUFBLElBQ3hCO0FBQ0EsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBRW5DLFVBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxtQkFBbUIsRUFDOUIsT0FBTztBQUFBLE1BQ04sWUFBWSxRQUFRO0FBQUEsTUFDcEIsU0FBUztBQUFBLE1BQ1Q7QUFBQSxNQUNBLE1BQU07QUFBQSxNQUNOLFNBQVM7QUFBQSxNQUNULG9CQUFvQjtBQUFBLE1BQ3BCLHFCQUFxQjtBQUFBLE1BQ3JCO0FBQUEsTUFDQSxtQkFBbUIsUUFBUTtBQUFBLE1BQzNCLFNBQVM7QUFBQSxNQUNULFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxJQUNkLENBQUMsRUFDQSxhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLFVBQU07QUFBQSxNQUNKLGdDQUFnQyxFQUFFO0FBQUEsTUFDbEMsUUFBUTtBQUFBLE1BQ1I7QUFBQSxJQUNGO0FBRUEsVUFBTSxtQkFBbUIsTUFBTTtBQUFBLE1BQzdCLG9DQUFvQyxFQUFFO0FBQUEsTUFDdEM7QUFBQSxRQUNFLElBQUksSUFBSTtBQUFBLFFBQ1IsWUFBWSxJQUFJO0FBQUEsUUFDaEIsTUFBTSxJQUFJO0FBQUEsUUFDVixTQUFTLElBQUk7QUFBQSxRQUNiLG9CQUFvQixJQUFJO0FBQUEsUUFDeEIscUJBQXFCLElBQUk7QUFBQSxRQUN6QixZQUFZLElBQUk7QUFBQSxNQUNsQjtBQUFBLE1BQ0E7QUFBQSxJQUNGO0FBRUEsV0FBTztBQUFBLE1BQ0wsVUFBVSxtQkFBbUIsR0FBRztBQUFBLE1BQ2hDO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVPLElBQU0sWUFBWSxFQUFFLE9BQU8sU0FBUzs7O0FzQmpuQzNDLFNBQVMsb0JBQW9CLGlCQUFpQjtBQUc5QyxJQUFNLGtCQUNILE9BQU8sWUFBWSxlQUFlLFFBQVEsS0FBSyxtQkFDaEQ7QUFDRixJQUFNLFdBQVcsR0FBRyxlQUFlO0FBRW5DLElBQU0sT0FBTyxtQkFBbUIsSUFBSSxJQUFJLFFBQVEsQ0FBQztBQU9qRCxlQUFzQixrQkFDcEIscUJBQzhCO0FBQzlCLE1BQUksQ0FBQyxxQkFBcUIsV0FBVyxTQUFTLEdBQUc7QUFDL0MsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFFBQVEsb0JBQW9CLE1BQU0sVUFBVSxNQUFNLEVBQUUsS0FBSztBQUMvRCxNQUFJLENBQUMsT0FBTztBQUNWLFdBQU87QUFBQSxFQUNUO0FBRUEsTUFBSTtBQUNGLFVBQU0sRUFBRSxRQUFRLElBQUksTUFBTSxVQUFVLE9BQU8sTUFBTTtBQUFBLE1BQy9DLFlBQVksQ0FBQyxPQUFPO0FBQUEsSUFDdEIsQ0FBQztBQUVELFVBQU0sYUFBYSxPQUFPLFFBQVEsUUFBUSxXQUFXLFFBQVEsTUFBTTtBQUNuRSxRQUFJLENBQUMsWUFBWTtBQUNmLGFBQU87QUFBQSxJQUNUO0FBRUEsVUFBTSxRQUNKLE9BQU8sUUFBUSxVQUFVLFdBQVcsUUFBUSxRQUFRO0FBRXRELFdBQU8sRUFBRSxZQUFZLE1BQU07QUFBQSxFQUM3QixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUVPLFNBQVMsdUJBQWlDO0FBQy9DLFNBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLE9BQU8sZUFBZSxDQUFDLEdBQUc7QUFBQSxJQUM3RCxRQUFRO0FBQUEsSUFDUixTQUFTO0FBQUEsTUFDUCxnQkFBZ0I7QUFBQSxNQUNoQiwrQkFBK0I7QUFBQSxNQUMvQixnQ0FDRTtBQUFBLE1BQ0YsZ0NBQWdDO0FBQUEsSUFDbEM7QUFBQSxFQUNGLENBQUM7QUFDSDtBQUdBLGVBQXNCLGVBQWUsS0FBYyxNQUEyQjtBQUM1RSxNQUFJLElBQUksSUFBSSxXQUFXLFdBQVc7QUFDaEMsV0FBTyxJQUFJLFNBQVMsTUFBTTtBQUFBLE1BQ3hCLFFBQVE7QUFBQSxNQUNSLFNBQVM7QUFBQSxRQUNQLCtCQUErQjtBQUFBLFFBQy9CLGdDQUNFO0FBQUEsUUFDRixnQ0FBZ0M7QUFBQSxNQUNsQztBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFFQSxRQUFNLEtBQUs7QUFFWCxNQUFJLElBQUksUUFBUSxJQUFJLCtCQUErQixHQUFHO0FBQ3RELE1BQUksSUFBSSxRQUFRO0FBQUEsSUFDZDtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0EsTUFBSSxJQUFJLFFBQVE7QUFBQSxJQUNkO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjs7O0FDNUVBLGVBQXNCLGlCQUNwQixLQUNBLE1BQ0E7QUFDQSxRQUFNLE9BQU8sSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHLEVBQUU7QUFDbEMsTUFBSSxTQUFTLGFBQWEsSUFBSSxJQUFJLFdBQVcsT0FBTztBQUNsRCxXQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsRUFBRSxJQUFJLEtBQUssQ0FBQyxHQUFHO0FBQUEsTUFDaEQsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ1AsZ0JBQWdCO0FBQUEsUUFDaEIsK0JBQStCO0FBQUEsTUFDakM7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQ0EsUUFBTSxLQUFLO0FBQ2I7QUFpQk8sU0FBUyw0QkFDZEMsbUJBQ0E7QUFDQSxTQUFPLGVBQWUsc0JBQ3BCLEtBQ0EsTUFDQTtBQUNBLFFBQUksSUFBSSxJQUFJLFdBQVcsV0FBVztBQUNoQyxZQUFNLEtBQUs7QUFDWDtBQUFBLElBQ0Y7QUFFQSxVQUFNLE9BQU8sSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHLEVBQUU7QUFFbEMsUUFDRSxTQUFTLGFBQ1IsU0FBUyxjQUFjLENBQUMsS0FBSyxTQUFTLFVBQVUsR0FDakQ7QUFDQSxZQUFNLEtBQUs7QUFDWDtBQUFBLElBQ0Y7QUFFQSxVQUFNLFdBQVcsTUFBTSxrQkFBa0IsSUFBSSxJQUFJLE9BQU8sZUFBZSxDQUFDO0FBQ3hFLFFBQUksQ0FBQyxVQUFVO0FBQ2IsYUFBTyxxQkFBcUI7QUFBQSxJQUM5QjtBQUVBLFVBQU0sWUFBWSxNQUFNQSxrQkFBaUIsUUFBUTtBQUVqRCxRQUFJLElBQUksY0FBYyxTQUFTLFVBQVU7QUFDekMsUUFBSSxTQUFTLE9BQU87QUFDbEIsVUFBSSxJQUFJLGFBQWEsU0FBUyxLQUFLO0FBQUEsSUFDckM7QUFDQSxRQUFJLElBQUksVUFBVSxVQUFVLEVBQUU7QUFFOUIsVUFBTSxLQUFLO0FBQUEsRUFDYjtBQUNGOzs7QUNqREEsZUFBc0IsaUJBQ3BCQyxLQUNBLFVBQ2tDO0FBQ2xDLFFBQU0sV0FBVyxNQUFNQSxJQUNwQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxnQkFBZ0IsS0FBSyxTQUFTLFVBQVUsRUFDOUMsVUFBVSxFQUNWLGlCQUFpQjtBQUVwQixNQUFJLFVBQVU7QUFDWixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sUUFDSixTQUFTLE9BQU8sS0FBSyxLQUNyQixHQUFHLFNBQVMsVUFBVTtBQUN4QixRQUFNLE9BQ0osU0FBUyxNQUFNLEtBQUssS0FDcEIsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFDLEtBQ2xCO0FBR0YsUUFBTSxVQUFVLE1BQU1BLElBQ25CLFdBQVcsT0FBTyxFQUNsQixNQUFNLFNBQVMsS0FBSyxLQUFLLEVBQ3pCLFVBQVUsRUFDVixpQkFBaUI7QUFFcEIsTUFBSSxTQUFTO0FBQ1gsV0FBTyxNQUFNQSxJQUNWLFlBQVksT0FBTyxFQUNuQixJQUFJO0FBQUEsTUFDSCxjQUFjLFNBQVM7QUFBQSxNQUN2QixNQUFNLFFBQVEsUUFBUTtBQUFBLE1BQ3RCLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNyQyxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssUUFBUSxFQUFFLEVBQzNCLGFBQWEsRUFDYix3QkFBd0I7QUFBQSxFQUM3QjtBQUVBLFNBQU8sTUFBTUEsSUFDVixXQUFXLE9BQU8sRUFDbEIsT0FBTztBQUFBLElBQ047QUFBQSxJQUNBO0FBQUEsSUFDQSxjQUFjLFNBQVM7QUFBQSxJQUN2QixlQUFlO0FBQUEsRUFDakIsQ0FBQyxFQUNBLGFBQWEsRUFDYix3QkFBd0I7QUFDN0I7OztBQ3pFQSxlQUFzQkMsa0JBQWlCLFVBQXVDO0FBQzVFLFNBQU8saUJBQW9CLElBQUksUUFBUTtBQUN6Qzs7O0FDZUEsZUFBc0IseUJBQ3BCLFlBQ0EsTUFDbUI7QUFDbkIsUUFBTSxPQUFPLFdBQVcsYUFBYSxJQUFJLE1BQU07QUFDL0MsUUFBTSxRQUFRLFdBQVcsYUFBYSxJQUFJLE9BQU87QUFDakQsUUFBTSxhQUFhLFdBQVcsYUFBYSxJQUFJLE9BQU87QUFFdEQsTUFBSUM7QUFDSixNQUFJO0FBQ0YsSUFBQUEsV0FBVSxLQUFLLGNBQWMsc0JBQXNCO0FBQUEsRUFDckQsU0FBUyxLQUFLO0FBQ1osVUFBTSxVQUFVLGVBQWUsUUFBUSxJQUFJLFVBQVU7QUFDckQsV0FBTyxJQUFJLFNBQVMsOEJBQThCLE9BQU8sSUFBSTtBQUFBLE1BQzNELFFBQVE7QUFBQSxJQUNWLENBQUM7QUFBQSxFQUNIO0FBR0EsTUFBSSxtQkFBa0M7QUFDdEMsTUFBSSxPQUFPO0FBQ1QsUUFBSTtBQUNGLFlBQU1DLFdBQVUsTUFBTTtBQUFBLFFBQ3BCO0FBQUEsUUFDQUQsUUFBTztBQUFBLFFBQ1AsS0FBSztBQUFBLE1BQ1A7QUFDQSx5QkFBbUJDLFNBQVE7QUFBQSxJQUM3QixRQUFRO0FBQUEsSUFFUjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLGdCQUFnQixDQUFDLE9BQWUsYUFBNEI7QUFDaEUsUUFBSSxZQUFZLGtCQUFrQixVQUFVRCxRQUFPLGlCQUFpQixHQUFHO0FBQ3JFLGFBQU8sU0FBUztBQUFBLFFBQ2Qsb0JBQW9CLFVBQVUsRUFBRSxJQUFJLE9BQU8sTUFBTSxDQUFDO0FBQUEsUUFDbEQ7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFdBQU8sSUFBSSxTQUFTLHVCQUF1QixLQUFLLElBQUksRUFBRSxRQUFRLElBQUksQ0FBQztBQUFBLEVBQ3JFO0FBRUEsTUFBSSxZQUFZO0FBQ2QsV0FBTyxjQUFjLFlBQVksZ0JBQWdCO0FBQUEsRUFDbkQ7QUFDQSxNQUFJLENBQUMsUUFBUSxDQUFDLE9BQU87QUFDbkIsV0FBTyxjQUFjLHlCQUF5QixnQkFBZ0I7QUFBQSxFQUNoRTtBQUVBLE1BQUk7QUFDSixNQUFJO0FBQ0YsY0FBVSxNQUFNLGlCQUFpQixPQUFPQSxRQUFPLGNBQWMsS0FBSyxLQUFLO0FBQUEsRUFDekUsU0FBUyxLQUFLO0FBQ1osVUFBTSxVQUFVLGVBQWUsa0JBQzNCLElBQUksVUFDSjtBQUNKLFdBQU8sY0FBYyxTQUFTLGdCQUFnQjtBQUFBLEVBQ2hEO0FBRUEsTUFBSSxDQUFDLGtCQUFrQixRQUFRLFVBQVVBLFFBQU8saUJBQWlCLEdBQUc7QUFDbEUsV0FBTyxJQUFJLFNBQVMsK0NBQStDO0FBQUEsTUFDakUsUUFBUTtBQUFBLElBQ1YsQ0FBQztBQUFBLEVBQ0g7QUFFQSxNQUFJO0FBQ0YsVUFBTSxTQUFTLE1BQU0sMEJBQTBCO0FBQUEsTUFDN0M7QUFBQSxNQUNBLFVBQVVBLFFBQU87QUFBQSxNQUNqQixjQUFjQSxRQUFPO0FBQUEsTUFDckIsYUFBYUEsUUFBTztBQUFBLE1BQ3BCLFdBQVcsS0FBSztBQUFBLElBQ2xCLENBQUM7QUFFRCxVQUFNLFVBQVUsTUFBTSxLQUFLLEdBQ3hCLFdBQVcsV0FBVyxFQUN0QixPQUFPLENBQUMsTUFBTSxXQUFXLFVBQVUsQ0FBQyxFQUNwQyxNQUFNLE1BQU0sS0FBSyxRQUFRLFNBQVMsRUFDbEMsaUJBQWlCO0FBRXBCLFFBQUksQ0FBQyxXQUFXLFFBQVEsWUFBWSxRQUFRLFFBQVE7QUFDbEQsYUFBTyxjQUFjLHFCQUFxQixRQUFRLFFBQVE7QUFBQSxJQUM1RDtBQUNBLFFBQUksUUFBUSxhQUFhLFNBQVM7QUFDaEMsYUFBTyxjQUFjLHFCQUFxQixRQUFRLFFBQVE7QUFBQSxJQUM1RDtBQUVBLFVBQU0sTUFBTSxJQUFJO0FBQUEsTUFDZCxLQUFLLFNBQVMsS0FBSyxJQUFJO0FBQUEsSUFDekIsRUFBRSxZQUFZO0FBQ2QsVUFBTSxRQUFRLE1BQU0sdUJBQXVCO0FBQUEsTUFDekMsYUFBYSxPQUFPO0FBQUEsTUFDcEIsV0FBVyxLQUFLO0FBQUEsSUFDbEIsQ0FBQztBQUNELFVBQU0sS0FBSyxHQUNSLFlBQVksV0FBVyxFQUN2QixJQUFJO0FBQUEsTUFDSCxtQkFBbUIsS0FBSyxVQUFVO0FBQUEsUUFDaEMsYUFBYSxPQUFPO0FBQUEsUUFDcEIsY0FBYyxPQUFPO0FBQUEsUUFDckIsYUFBYSxPQUFPO0FBQUEsTUFDdEIsQ0FBQztBQUFBLE1BQ0QsR0FBSSxRQUFRLEVBQUUsT0FBTyxNQUFNLElBQUksQ0FBQztBQUFBLE1BQ2hDLGdCQUFnQjtBQUFBLE1BQ2hCLFlBQVk7QUFBQSxJQUNkLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxRQUFRLEVBQUUsRUFDM0IsUUFBUTtBQUVYLFdBQU8sU0FBUztBQUFBLE1BQ2Qsb0JBQW9CLFFBQVEsVUFBVSxFQUFFLElBQUksS0FBSyxDQUFDO0FBQUEsTUFDbEQ7QUFBQSxJQUNGO0FBQUEsRUFDRixTQUFTLEtBQUs7QUFDWixVQUFNLFVBQVUsZUFBZSxrQkFDM0IsSUFBSSxVQUNKO0FBQ0osV0FBTyxjQUFjLFNBQVMsUUFBUSxRQUFRO0FBQUEsRUFDaEQ7QUFDRjs7O0EzQjNHTSxTQUFRLFdBQVcsOEJBQTZCO0FBMUJ0RCxJQUFJLElBQUksY0FBYztBQUN0QixJQUFJLElBQUksZ0JBQWdCO0FBR3hCLElBQUksSUFBSSxPQUFPLEtBQUssU0FBUztBQUMzQixNQUFJLElBQUksSUFBSSxXQUFXLFdBQVc7QUFDaEMsVUFBTSxLQUFLO0FBQ1g7QUFBQSxFQUNGO0FBRUEsUUFBTSxNQUFNLElBQUksSUFBSSxJQUFJLElBQUksR0FBRztBQUMvQixNQUFJLElBQUksYUFBYSwyQkFBMkIsSUFBSSxJQUFJLFdBQVcsT0FBTztBQUN4RSxXQUFPLHlCQUF5QixLQUFLLEVBQUUsR0FBRyxDQUFDO0FBQUEsRUFDN0M7QUFFQSxRQUFNLEtBQUs7QUFDYixDQUFDO0FBRUQsSUFBSSxJQUFJLDRCQUE0QkUsaUJBQWdCLENBQUM7QUFFOUMsSUFBTSxVQUFVO0FBQUEsRUFDckIsR0FBRztBQUNMO0FBRUEsSUFBTyxjQUFRO0FBSVQsSUFBSSx3QkFBd0I7QUFFNUIsSUFBSTtBQUNGLDBCQUF3QjtBQUMxQixRQUFRO0FBRVI7QUFFQSxJQUFJLElBQUksdUJBQXVCO0FBQUEsRUFDN0IsVUFBVTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLFdBQVcsQ0FBQztBQUFBLEVBQ1osUUFBUTtBQUNWLENBQUMsQ0FBQzsiLAogICJuYW1lcyI6IFsiZGIiLCAiZGIiLCAiZGIiLCAicm93VG9FbWFpbE1lc3NhZ2UiLCAiZGIiLCAiZW52IiwgInJvdyIsICJjb25maWciLCAicmVzb2x2ZUxvY2FsVXNlciIsICJkYiIsICJyZXNvbHZlTG9jYWxVc2VyIiwgImNvbmZpZyIsICJwYXlsb2FkIiwgInJlc29sdmVMb2NhbFVzZXIiXQp9Cg==
