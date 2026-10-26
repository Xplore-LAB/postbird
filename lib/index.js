// @local/dsh-plugin-office
// Native Cordis plugin for DeepSeek Harness (DSH) — an AI office toolkit.
//
// Registers twenty-two model-facing tools:
//   office_mail_preview — render a mail-merge batch against a recipient table
//                         (CSV/JSON path or inline array), resolve per-recipient
//                         attachments, persist it, return a previewId.
//   office_mail_send    — execute a previously previewed batch. Two-phase by
//                         design: requires a fresh previewId and confirm:true.
//                         mode "draft" writes .eml files (no SMTP needed);
//                         mode "send" delivers over SMTP with pacing + audit.
//   office_docgen       — generate .docx documents from structured content
//                         blocks (heading/paragraph/lists/table/pageBreak) with
//                         {{field}} variables; supports batch mode (one file
//                         per data row) for report letters etc.
//   office_sheet        — spreadsheet pipeline over .csv/.xlsx: inspect
//                         (columns/stats/samples), filter, aggregate
//                         (groupBy + sum/avg/min/max/count), split by column,
//                         with output back to .csv or .xlsx.
//   office_inbox_fetch  — read-only IMAP pull of the newest messages
//                         (envelope + short body snippet + attachment list)
//                         into a local JSONL index. Bodies fetched with
//                         BODY.PEEK; credentials via DSH_IMAP_PASS.
//   office_inbox_triage — deterministic triage of the fetched index into
//                         todo / notice / subscription / personal with rule
//                         evidence per message; semantic refinement is left
//                         to the agent.
//   office_daily_brief — turn indexed mail into a ranked daily focus list,
//                        due-state counts, and a human review queue.
//   office_action_radar — extract actions and explicit deadlines with a
//                         priority score and rule evidence.
//   office_context_reply — group a local thread, surface action signals, and
//                          prepare three drafts that still require review.
//   office_thread_summary — explain a complete mail thread with citations,
//                           optionally re-fetching full text via IMAP PEEK.
//   office_action_extract — turn one message, thread, or pasted notice into
//                           ranked actions with dates and source citations.
//   office_reply_draft — produce one reviewable, tone-aware reply draft from
//                        indexed or full thread context; never sends mail.
//   office_collection_track — track expected people and required materials,
//                             preserve manual corrections, export CSV/XLSX.
//   office_attachment_ask — retrieve cited evidence from local PDF, Office,
//                           text, and image attachment files.
//   office_archive_search — local search over the JSONL index: sender /
//                         subject / time-window / attachment / category
//                         filters. Zero network access.
//   office_archive_export — export matched messages as .eml files (IMAP
//                         read-only re-fetch with PEEK) plus an index.csv
//                         summary into a user-specified directory.
//   office_archive_attach — batch-download attachments of matched messages
//                         into a directory inside workDir; sanitized and
//                         deduped filenames, size/extension filters.
//   office_stats_overview — receive/send overview from the local index and
//                         send audit log: monthly trend, top contacts,
//                         category mix. Purely local.
//   office_stats_track   — job-application ledger (求职台账): auto-detects
//                         applied / written-test / interview / offer signals
//                         from indexed mail (forward-only), accepts manual
//                         corrections, exports CSV.
//   office_inbox_clean   — subscription cleanup advisor: per-sender
//                         frequency table with List-Unsubscribe URLs.
//                         Output-only; never unsubscribes or deletes itself.
//
// Security posture: sending email is an external, irreversible action. The
// plugin refuses to send anything that has not passed through a preview, caps
// recipient/batch sizes via config, throttles per-message pacing, enforces a
// rolling-24h send cap, optionally restricts recipients to an allowlist of
// domains, and logs every delivered message to ~/.dsh/office/mail/sent-log.jsonl.
// Untrusted, data-driven paths (attachment columns, image paths rendered from
// spreadsheet rows) are confined to workDir — no arbitrary-file exfiltration.
// Values rendered into mail headers are stripped of CR/LF (header injection).
// Document and spreadsheet tools write only into user-specified paths and
// refuse to overwrite existing files unless overwrite=true. See SECURITY.md.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { parseCsv, renderTemplate, looksLikeEmail } from "./render.js";
import { generateDocx, sanitizeFilename } from "./docgen.js";
import { registerPostbirdSkills } from "./skills.js";
import { generatePptx } from "./pptgen.js";
import { injectDocx } from "./docx-inject.js";
import {
  readTable, writeTable, inspectColumns, applyFilter, aggregateTable, splitTable
} from "./sheet.js";
import {
  resolveImap, fetchInbox, fetchMessageContents, defaultIndexPath, appendIndex, loadIndex, triageMessages
} from "./inbox.js";
import {
  filterIndex, searchIndex, exportArchive, attachArchive
} from "./archive.js";
import {
  statsOverview, scanLedger, listLedger, updateLedger, TRACK_STATUSES
} from "./stats.js";
import { buildAdvice } from "./clean.js";
import {
  buildDailyBrief, buildActionRadar, buildContextReply, findThread,
  summarizeThread, extractActions, buildReplyDraft
} from "./workflow.js";
import {
  scanCollection, getCollection, updateCollection, collectionRows
} from "./collection.js";
import { inspectAttachment } from "./attachment.js";

const name = "tool-office";
const inject = ["tools", "skills"];

const Config = z.object({
  smtpHost: z.string().default("").description("SMTP host, e.g. smtp.qq.com. Required for mode send."),
  smtpPort: z.number().default(465).description("SMTP port (465 implicit TLS, 587 STARTTLS)."),
  smtpSecure: z.boolean().default(true).description("Use implicit TLS (true for port 465)."),
  smtpUser: z.string().default("").description("SMTP username (usually the full email address)."),
  smtpPass: z.string().default("").description("SMTP password or authorization code. Prefer smtpPassEnv."),
  smtpPassEnv: z.string().default("DSH_SMTP_PASS").description("Env var that holds the password; takes precedence when smtpPass is empty."),
  fromAddress: z.string().default("").description("Envelope From address."),
  fromName: z.string().default("").description("Display name for the From header."),
  replyTo: z.string().default("").description("Optional Reply-To address."),
  maxRecipients: z.number().default(50).description("Hard cap on mail-merge recipients per batch."),
  sendIntervalMs: z.number().default(1500).description("Minimum pacing between two SMTP deliveries."),
  dailySendCap: z.number().default(200).description("Hard cap on messages delivered per rolling 24h window (from the audit log). Anti-abuse / anti-blacklist guard."),
  allowDomains: z.array(z.string()).default([]).description("Optional recipient-domain allowlist, e.g. [\"qq.com\",\"163.com\",\"edu.cn\"]. When non-empty, addresses on other domains are blocked at preview time. Empty = no restriction."),
  previewTtlMinutes: z.number().default(60).description("A preview older than this must be regenerated before sending."),
  maxDocRows: z.number().default(100).description("Hard cap on rows in one office_docgen batch."),
  maxSheetRows: z.number().default(20000).description("Hard cap on rows read by office_sheet."),
  imapHost: z.string().default("").description("IMAP host. Empty = derive from imapUser's domain (qq/163/126/gmail/outlook presets)."),
  imapPort: z.number().default(993).description("IMAP port (implicit TLS, 993)."),
  imapUser: z.string().default("").description("IMAP username (usually the full email address). QQ/163/126 need an authorization code, not the login password."),
  imapPass: z.string().default("").description("IMAP password or authorization code. Prefer imapPassEnv."),
  imapPassEnv: z.string().default("DSH_IMAP_PASS").description("Env var that holds the IMAP password; takes precedence when imapPass is empty."),
  imapMailbox: z.string().default("INBOX").description("Mailbox to fetch from."),
  maxInboxFetch: z.number().default(200).description("Hard cap on messages one office_inbox_fetch may pull."),
  inboxSnippetChars: z.number().default(300).description("Body snippet length stored in the index."),
  maxArchiveMessages: z.number().default(200).description("Hard cap on messages one office_archive_export / office_archive_attach may touch."),
  maxAttachmentMb: z.number().default(25).description("Per-attachment size cap (MB) for office_archive_attach; larger attachments are skipped and reported."),
  maxThreadMessages: z.number().default(50).description("Hard cap on messages re-fetched for one full-context thread operation."),
  maxThreadCharsPerMessage: z.number().default(12000).description("Maximum plain-text characters retained in memory per full-context message."),
  maxAttachmentReadMb: z.number().default(50).description("Hard cap on one local attachment read by office_attachment_ask.")
});

const EMAIL_RE_DESCRIPTION = "one non-empty local part, one @, one domain with a dot";

function dataDir() {
  const home = process.env.DSH_OFFICE_HOME ?? path.join(os.homedir(), ".dsh", "office");
  return path.join(home, "mail");
}

function previewsDir() {
  return path.join(dataDir(), "previews");
}

function auditLogPath() {
  return path.join(dataDir(), "sent-log.jsonl");
}

function ledgerPath() {
  return path.join(dataDir(), "job-track.json");
}

function collectionDir() {
  return path.join(dataDir(), "collections");
}

function resolvePass(cfg) {
  if (cfg.smtpPass) return cfg.smtpPass;
  return process.env[cfg.smtpPassEnv] ?? "";
}

function requireSmtp(cfg) {
  const problems = [];
  if (!cfg.smtpHost) problems.push("smtpHost");
  if (!cfg.smtpUser) problems.push("smtpUser");
  if (!resolvePass(cfg)) problems.push(`smtpPass (or env ${cfg.smtpPassEnv})`);
  if (!cfg.fromAddress) problems.push("fromAddress");
  if (problems.length > 0) {
    throw new Error(`SMTP is not configured: missing ${problems.join(", ")}. Fill the tool-office config in cordis.patch.yml or switch to mode "draft".`);
  }
}

function fromHeader(cfg) {
  return cfg.fromName ? `"${cfg.fromName.replace(/["\\]/g, "")}" <${cfg.fromAddress}>` : cfg.fromAddress;
}

/**
 * Strip CR/LF (and tabs) from a value destined for a mail header. Template
 * values come from untrusted spreadsheet cells; a newline in a subject or a
 * display name would allow header injection (e.g. forged Bcc lines).
 */
function sanitizeHeader(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ");
}

/**
 * True when `p` (absolute, or relative to `base`) resolves to `base` or
 * somewhere inside it. Data-driven paths (attachment columns, image paths
 * rendered from a CSV row) must never escape the working directory —
 * otherwise a crafted spreadsheet cell could exfiltrate ~/.ssh/id_rsa and
 * friends as a mail attachment.
 */
function isInsideDir(base, p) {
  const b = path.resolve(base);
  const q = path.resolve(b, p);
  return q === b || q.startsWith(b + path.sep);
}

/**
 * Count messages actually delivered (mode=send, ok=true) in the rolling
 * 24h window before now, from the append-only audit log. Feeds dailySendCap.
 */
async function countRecentSends() {
  let text;
  try {
    text = await fsp.readFile(auditLogPath(), "utf8");
  } catch {
    return 0;
  }
  const cutoff = Date.now() - 24 * 3600_000;
  let n = 0;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const e = JSON.parse(s);
      if (e.mode === "send" && e.ok === true && new Date(e.ts).getTime() >= cutoff) n++;
    } catch {
      // skip a corrupt line rather than fail the guard
    }
  }
  return n;
}

/**
 * Load recipient rows from inline array or CSV/JSON file, then render and
 * validate every row. Shared by the preview tool (which persists the result)
 * and kept separate from send (which only re-reads persisted previews).
 */
async function buildRows(args, cfg) {
  const base = args.workDir && String(args.workDir).trim() !== "" ? args.workDir : process.cwd();
  let raw;
  if (args.recipientsFile) {
    const abs = path.resolve(base, args.recipientsFile);
    let text;
    try {
      text = await fsp.readFile(abs, "utf8");
    } catch (err) {
      throw new Error(`cannot read recipientsFile ${abs}: ${err.message}`);
    }
    if (abs.endsWith(".json")) {
      try {
        raw = JSON.parse(text);
      } catch (err) {
        throw new Error(`invalid JSON in ${abs}: ${err.message}`);
      }
    } else {
      raw = parseCsv(text);
    }
  } else if (Array.isArray(args.recipients)) {
    raw = args.recipients;
  } else {
    throw new Error('provide exactly one of "recipients" (inline array of objects) or "recipientsFile" (.csv/.json path)');
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("recipient list is empty");
  }
  if (raw.length > cfg.maxRecipients) {
    throw new Error(`recipient count ${raw.length} exceeds the configured cap of ${cfg.maxRecipients}; raise config maxRecipients if this is intentional`);
  }

  const emailColumn = args.emailColumn ?? "email";
  const seenEmails = new Set();
  const rows = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] ?? {};
    const problems = [];
    if (typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`recipient #${i + 1} is not an object`);
    }
    const email = String(row[emailColumn] ?? "").trim();
    if (!email) problems.push(`row ${i + 1}: empty "${emailColumn}"`);
    else if (!looksLikeEmail(email)) problems.push(`row ${i + 1}: "${email}" does not look like an address (${EMAIL_RE_DESCRIPTION})`);
    else if (cfg.allowDomains.length > 0 && !cfg.allowDomains.some((d) => email.toLowerCase().endsWith(`@${d.toLowerCase()}`))) {
      problems.push(`row ${i + 1}: "${email}" is not on a configured allowDomains entry (${cfg.allowDomains.join(", ")})`);
    } else if (seenEmails.has(email.toLowerCase())) {
      problems.push(`row ${i + 1}: duplicate address "${email}" (an earlier row already uses it)`);
    } else {
      seenEmails.add(email.toLowerCase());
    }

    const subject = renderTemplate(args.subjectTemplate, row);
    const body = renderTemplate(args.bodyTemplate, row);
    for (const k of subject.missing) problems.push(`row ${i + 1}: subject references missing field {{${k}}}`);
    for (const k of body.missing) problems.push(`row ${i + 1}: body references missing field {{${k}}}`);

    const attachmentSpecs = [];
    for (const rel of args.attachments ?? []) {
      attachmentSpecs.push({ source: "global", rel });
    }
    if (args.attachmentColumn) {
      const cell = String(row[args.attachmentColumn] ?? "").trim();
      for (const rel of cell.split(";").map((x) => x.trim()).filter(Boolean)) {
        attachmentSpecs.push({ source: "row", rel });
      }
    }
    const attachments = [];
    for (const spec of attachmentSpecs) {
      const abs = path.resolve(base, spec.rel);
      if (!isInsideDir(base, abs)) {
        problems.push(`row ${i + 1}: ${spec.source} attachment escapes workDir: "${spec.rel}" (resolves to ${abs}); attachments must live inside workDir`);
        continue;
      }
      let st;
      try {
        st = await fsp.stat(abs);
      } catch {
        problems.push(`row ${i + 1}: ${spec.source} attachment not found: ${abs}`);
        continue;
      }
      if (!st.isFile()) {
        problems.push(`row ${i + 1}: ${spec.source} attachment is not a file: ${abs}`);
        continue;
      }
      attachments.push(abs);
    }

    const displayName = args.nameColumn ? sanitizeHeader(row[args.nameColumn]) : "";
    rows.push({
      index: i + 1,
      email,
      to: displayName ? `${displayName} <${email}>` : email,
      subject: sanitizeHeader(subject.text),
      body: body.text,
      attachments,
      problems
    });
  }
  return rows;
}

async function persistPreview(args, cfg, rows) {
  const id = `pm_${crypto.randomBytes(6).toString("hex")}`;
  const record = {
    id,
    createdAt: Date.now(),
    bodyIsHtml: args.bodyIsHtml === true,
    replyTo: cfg.replyTo || "",
    rows
  };
  await fsp.mkdir(previewsDir(), { recursive: true });
  await fsp.writeFile(path.join(previewsDir(), `${id}.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

async function loadPreview(previewId, cfg) {
  if (!/^pm_[0-9a-f]+$/.test(String(previewId ?? ""))) {
    throw new Error("previewId must look like pm_<hex>; run office_mail_preview first");
  }
  let text;
  try {
    text = await fsp.readFile(path.join(previewsDir(), `${previewId}.json`), "utf8");
  } catch {
    throw new Error(`no such preview: ${previewId}. Run office_mail_preview first.`);
  }
  const record = JSON.parse(text);
  const ageMs = Date.now() - record.createdAt;
  if (ageMs > cfg.previewTtlMinutes * 60_000) {
    throw new Error(`preview ${previewId} is older than ${cfg.previewTtlMinutes} minutes; regenerate it with office_mail_preview`);
  }
  return record;
}

function previewSample(row) {
  return {
    row: row.index,
    to: row.to,
    subject: row.subject,
    bodyPreview: row.body.length > 1200 ? `${row.body.slice(0, 1200)}…[truncated]` : row.body,
    attachments: row.attachments.map((p) => path.basename(p))
  };
}

function buildMail(record, cfg, row) {
  const mail = {
    from: fromHeader(cfg),
    to: row.to,
    subject: row.subject
  };
  if (record.replyTo) mail.replyTo = record.replyTo;
  if (record.bodyIsHtml) mail.html = row.body;
  else mail.text = row.body;
  if (row.attachments.length > 0) {
    mail.attachments = row.attachments.map((p) => ({ path: p, filename: path.basename(p) }));
  }
  return mail;
}

async function appendAudit(entries) {
  await fsp.mkdir(dataDir(), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fsp.appendFile(auditLogPath(), lines, "utf8");
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

/** Load batch data rows for office_docgen: inline array or CSV/JSON file. */
async function loadDocRows(args, base) {
  if (args.dataFile) {
    const abs = path.resolve(base, args.dataFile);
    let text;
    try {
      text = await fsp.readFile(abs, "utf8");
    } catch (err) {
      throw new Error(`cannot read dataFile ${abs}: ${err.message}`);
    }
    if (abs.endsWith(".json")) return JSON.parse(text);
    return parseCsv(text);
  }
  if (Array.isArray(args.data)) return args.data;
  return null;
}

function applyFn(ctx, config) {
  const cfg = config;

  // Expose this plugin's own Agent Skills to DSH's skill registry.
  // The skill loader only scans ~/.dsh/skills, ~/.agents/skills and the
  // project roots, so a bundled skills/ directory is invisible without this.
  registerPostbirdSkills(ctx);

  async function loadThreadContext(args) {
    const index = await loadIndex(defaultIndexPath());
    const indexedThread = findThread(index, args);
    if ((args.contextMode ?? "indexed") !== "full") {
      return { messages: indexedThread, skipped: [], contextMode: "indexed" };
    }
    const cap = Math.min(Math.max(args.maxMessages ?? cfg.maxThreadMessages, 1), cfg.maxThreadMessages);
    const settings = resolveImap(cfg);
    const fetched = await fetchMessageContents({
      settings,
      entries: indexedThread.slice(-cap),
      maxCharsPerMessage: cfg.maxThreadCharsPerMessage
    });
    return { messages: fetched.messages, skipped: fetched.skipped, contextMode: "full" };
  }

  // ------------------------------------------------------------------ mail --
  ctx.tools.register(defineTool({
    name: "office_mail_preview",
    description:
      "Render a mail-merge batch WITHOUT sending: apply {{field}} placeholders in a subject/body template to every recipient row, resolve per-recipient attachments, and persist the result. Always call this first and show the user the rendered samples and problems; office_mail_send only accepts the previewId this tool returns. Recipients come from an inline array or a CSV/JSON file whose first row (or array items) are objects with an email column. Cells referenced by {{field}} must be non-empty on every row; rows that fail validation are listed as problems and block sending until the preview is regenerated.",
    parameters: {
      subjectTemplate: {
        type: "string",
        required: true,
        description: "Subject line template. Use {{column}} placeholders, e.g. \"{{month}} payroll notice for {{name}}\"."
      },
      bodyTemplate: {
        type: "string",
        required: true,
        description: "Body template. Plain text by default; set bodyIsHtml for HTML."
      },
      bodyIsHtml: {
        type: "boolean",
        description: "Treat bodyTemplate as HTML instead of plain text. Default false."
      },
      recipients: {
        type: "array",
        description: "Inline recipient rows (objects keyed by column name). Exactly one of recipients / recipientsFile.",
        items: { type: "object", additionalProperties: true }
      },
      recipientsFile: {
        type: "string",
        description: "Path to a .csv (header row) or .json (array of objects) recipient table. Relative paths resolve against workDir."
      },
      workDir: {
        type: "string",
        description: "Base directory for resolving recipientsFile and attachment paths. Prefer absolute paths."
      },
      emailColumn: {
        type: "string",
        description: "Column holding the recipient address. Default \"email\"."
      },
      nameColumn: {
        type: "string",
        description: "Optional column holding a display name (rendered as \"Name <addr>\")."
      },
      attachmentColumn: {
        type: "string",
        description: "Optional column whose cell holds one attachment path, or several separated by \";\". Paths resolve against workDir and MUST stay inside it (paths escaping workDir are blocked as row problems)."
      },
      attachments: {
        type: "array",
        description: "Global attachment paths attached to every recipient. Resolve against workDir and must stay inside it.",
        items: { type: "string" }
      },
      maxSamples: {
        type: "integer",
        description: "How many rendered samples to return in full (default 3, max 10)."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          previewId: { type: "string" },
          total: { type: "integer" },
          valid: { type: "integer" },
          invalid: { type: "integer" },
          samples: { type: "array", items: { type: "object", additionalProperties: true } },
          problems: { type: "array", items: { type: "string" } },
          expiresInMinutes: { type: "integer" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Mail-merge preview ${value.previewId}: ${value.valid}/${value.total} rows valid${value.invalid > 0 ? `, ${value.invalid} blocked: ${value.problems.slice(0, 5).join("; ")}` : ""}. Show the samples to the user, then call office_mail_send with this previewId.`
      }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const rows = await buildRows(args, cfg);
      const record = await persistPreview(args, cfg, rows);
      const valid = rows.filter((r) => r.problems.length === 0);
      const invalid = rows.filter((r) => r.problems.length > 0);
      const maxSamples = Math.min(Math.max(args.maxSamples ?? 3, 0), 10);
      return {
        previewId: record.id,
        total: rows.length,
        valid: valid.length,
        invalid: invalid.length,
        samples: valid.slice(0, maxSamples).map(previewSample),
        problems: invalid.flatMap((r) => r.problems),
        expiresInMinutes: cfg.previewTtlMinutes
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Preview mail-merge batch",
      kind: "other",
      rawInput: {
        recipientsFile: args.recipientsFile,
        recipients: Array.isArray(args.recipients) ? `${args.recipients.length} inline rows` : undefined,
        attachmentColumn: args.attachmentColumn
      }
    })
  }));

  ctx.tools.register(defineTool({
    name: "office_mail_send",
    description:
      "Execute a mail-merge batch that was previously rendered by office_mail_preview. Sending email is irreversible, so the workflow is enforced: (1) call office_mail_preview, (2) show the user the rendered samples and get explicit approval, (3) call this tool with the same previewId and confirm=true. mode \"draft\" (default) writes .eml files without any SMTP configuration; mode \"send\" delivers over the configured SMTP account with pacing. A preview expires after the configured TTL and must be regenerated.",
    parameters: {
      previewId: {
        type: "string",
        required: true,
        description: "The previewId returned by office_mail_preview."
      },
      mode: {
        type: "string",
        description: "\"draft\" writes .eml files (default, safe); \"send\" delivers over SMTP.",
        enum: ["draft", "send"]
      },
      confirm: {
        type: "boolean",
        required: true,
        description: "Must be true. Set it only after showing the user the preview and receiving explicit approval."
      },
      draftDir: {
        type: "string",
        description: "Directory for .eml output in draft mode. Default ~/.dsh/office/mail/drafts/<previewId>."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string" },
          total: { type: "integer" },
          ok: { type: "integer" },
          failed: { type: "integer" },
          draftDir: { type: "string" },
          results: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                row: { type: "integer" },
                to: { type: "string" },
                ok: { type: "boolean" },
                messageId: { type: "string" },
                eml: { type: "string" },
                error: { type: "string" }
              }
            }
          }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.mode === "draft"
          ? `Mail-merge draft: ${value.ok}/${value.total} .eml files written to ${value.draftDir}.`
          : `Mail-merge send: ${value.ok}/${value.total} delivered, ${value.failed} failed.`
      }]
    },
    isConcurrencySafe: () => false,
    timeoutMs: 15 * 60_000,
    async execute(args, exec) {
      if (args.confirm !== true) {
        throw new Error("refusing to run: confirm must be true. Show the user the office_mail_preview samples and get explicit approval first.");
      }
      const mode = args.mode ?? "draft";
      const record = await loadPreview(args.previewId, cfg);
      const blocked = record.rows.filter((r) => r.problems.length > 0);
      if (blocked.length > 0) {
        const issues = blocked.flatMap((r) => r.problems).slice(0, 10);
        throw new Error(`preview contains ${blocked.length} invalid row(s); sending is blocked. Fix the data or template and re-run office_mail_preview. First issues: ${issues.join("; ")}`);
      }

      const results = [];
      const audit = [];

      if (mode === "draft") {
        const draftDir = args.draftDir && String(args.draftDir).trim() !== ""
          ? args.draftDir
          : path.join(dataDir(), "drafts", record.id);
        await fsp.mkdir(draftDir, { recursive: true });
        const renderTransport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
        for (const row of record.rows) {
          const info = await renderTransport.sendMail(buildMail(record, cfg, row));
          const file = path.join(draftDir, `row-${String(row.index).padStart(3, "0")}-${row.email.replace(/[^\w.-]/g, "_")}.eml`);
          await fsp.writeFile(file, info.message, "utf8");
          results.push({ row: row.index, to: row.to, ok: true, eml: file });
          audit.push({ ts: new Date().toISOString(), previewId: record.id, mode, to: row.email, subject: row.subject, ok: true, eml: file });
        }
        await appendAudit(audit);
        const ok = results.filter((r) => r.ok).length;
        return { mode, total: results.length, ok, failed: results.length - ok, draftDir, results };
      }

      requireSmtp(cfg);
      const recentSends = await countRecentSends();
      if (recentSends + record.rows.length > cfg.dailySendCap) {
        throw new Error(`daily send cap: ${recentSends} message(s) already delivered in the last 24h and this batch adds ${record.rows.length}, exceeding the configured cap of ${cfg.dailySendCap}. Wait for the window to slide, or raise config dailySendCap deliberately.`);
      }
      const transport = nodemailer.createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        secure: cfg.smtpSecure,
        auth: { user: cfg.smtpUser, pass: resolvePass(cfg) },
        connectionTimeout: 20_000,
        greetingTimeout: 15_000,
        socketTimeout: 60_000
      });
      for (let i = 0; i < record.rows.length; i++) {
        if (exec.signal?.aborted) {
          throw new Error(`aborted by the caller after ${i}/${record.rows.length} messages; the audit log records what already went out`);
        }
        const row = record.rows[i];
        if (i > 0) await sleep(cfg.sendIntervalMs, exec.signal);
        let entry;
        try {
          const info = await transport.sendMail(buildMail(record, cfg, row));
          entry = { row: row.index, to: row.to, ok: true, messageId: info.messageId };
          audit.push({ ts: new Date().toISOString(), previewId: record.id, mode, to: row.email, subject: row.subject, ok: true, messageId: info.messageId });
        } catch (err) {
          entry = { row: row.index, to: row.to, ok: false, error: String(err?.message ?? err) };
          audit.push({ ts: new Date().toISOString(), previewId: record.id, mode, to: row.email, subject: row.subject, ok: false, error: String(err?.message ?? err) });
        }
        results.push(entry);
      }
      transport.close();
      await appendAudit(audit);
      const ok = results.filter((r) => r.ok).length;
      return { mode, total: results.length, ok, failed: results.length - ok, results };
    },
    presentCall: (args) => ({
      card: "generic",
      title: args.mode === "send" ? "Send mail-merge batch" : "Write mail-merge drafts",
      kind: "other",
      rawInput: { previewId: args.previewId, mode: args.mode ?? "draft", confirm: args.confirm }
    })
  }));

  // ---------------------------------------------------------------- docgen --
  ctx.tools.register(defineTool({
    name: "office_docgen",
    description:
      "Generate Word (.docx) documents from structured content blocks with {{field}} variable rendering — the fastest way to turn a plan, a report outline, or per-person records into a real Word file. Blocks: heading (level 1-4), paragraph, bulletList, numberList, table (header + rows), pageBreak. Single mode: pass outputPath and optional variables. Batch mode: pass data/dataFile (CSV/JSON rows) plus outputDir and filenameTemplate to render one document per row (row fields are available as {{field}} alongside variables). All referenced fields must be non-empty, or the whole call fails with a precise error. Existing files are never overwritten unless overwrite=true.",
    parameters: {
      content: {
        type: "array",
        required: true,
        description: "Content blocks, in order. Each block: {type:\"heading\",level,text} | {type:\"paragraph\",text} | {type:\"bulletList\"|\"numberList\",items:[string]} | {type:\"table\",header:[string],rows:[[string]]} | {type:\"pageBreak\"}. Every text surface supports {{field}}.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            type: { type: "string", enum: ["heading", "paragraph", "bulletList", "numberList", "table", "pageBreak"] },
            level: { type: "integer", description: "Heading level 1-4 (heading only)." },
            text: { type: "string" },
            items: { type: "array", items: { type: "string" } },
            header: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "array", items: { type: "string" } } }
          }
        }
      },
      variables: {
        type: "object",
        additionalProperties: true,
        description: "Global variables available as {{field}} in every block."
      },
      outputPath: {
        type: "string",
        description: "Single mode: output .docx path (relative to workDir)."
      },
      dataFile: {
        type: "string",
        description: "Batch mode: .csv/.json file with one object per document (fields become {{field}} variables)."
      },
      data: {
        type: "array",
        description: "Batch mode: inline rows instead of dataFile.",
        items: { type: "object", additionalProperties: true }
      },
      outputDir: {
        type: "string",
        description: "Batch mode: directory for the generated files (relative to workDir)."
      },
      filenameTemplate: {
        type: "string",
        description: "Batch mode: per-file name template, e.g. \"offer_letter_{{name}}.docx\"."
      },
      workDir: {
        type: "string",
        description: "Base directory for resolving paths. Prefer absolute paths."
      },
      overwrite: {
        type: "boolean",
        description: "Allow overwriting existing files. Default false."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          count: { type: "integer" },
          outputDir: { type: "string" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Generated ${value.count} .docx file(s): ${value.files.slice(0, 5).join(", ")}${value.count > 5 ? " …" : ""}.`
      }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const base = args.workDir && String(args.workDir).trim() !== "" ? args.workDir : process.cwd();
      const rows = await loadDocRows(args, base);
      const batch = rows !== null;
      if (batch) {
        if (!Array.isArray(rows) || rows.length === 0) throw new Error("batch data is empty");
        if (rows.length > cfg.maxDocRows) {
          throw new Error(`batch size ${rows.length} exceeds the configured cap of ${cfg.maxDocRows}; raise config maxDocRows if this is intentional`);
        }
        if (!args.outputDir || !args.filenameTemplate) {
          throw new Error('batch mode requires outputDir and filenameTemplate (e.g. "report_{{name}}.docx")');
        }
        const dir = path.resolve(base, args.outputDir);
        await fsp.mkdir(dir, { recursive: true });
        const files = [];
        for (let i = 0; i < rows.length; i++) {
          const vars = { ...(args.variables ?? {}), ...rows[i] };
          const nameRender = renderTemplate(args.filenameTemplate, rows[i]);
          if (nameRender.missing.length > 0) {
            throw new Error(`row ${i + 1}: filenameTemplate references missing field(s) ${nameRender.missing.map((k) => `{{${k}}}`).join(", ")}`);
          }
          const file = path.join(dir, sanitizeFilename(nameRender.text));
          if (!args.overwrite) {
            try {
              await fsp.access(file);
              throw new Error(`${file} already exists; pass overwrite=true to replace it`);
            } catch (err) {
              if (err.code !== "ENOENT") throw err;
            }
          }
          await generateDocx({ blocks: args.content, vars, outPath: file });
          files.push(file);
        }
        return { mode: "batch", count: files.length, files, outputDir: dir };
      }
      if (!args.outputPath) throw new Error('single mode requires outputPath (or use batch mode with data/dataFile + outputDir + filenameTemplate)');
      const file = path.resolve(base, args.outputPath);
      if (!file.toLowerCase().endsWith(".docx")) throw new Error("outputPath must end with .docx");
      if (!args.overwrite) {
        try {
          await fsp.access(file);
          throw new Error(`${file} already exists; pass overwrite=true to replace it`);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      }
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await generateDocx({ blocks: args.content, vars: args.variables ?? {}, outPath: file });
      return { mode: "single", count: 1, files: [file], outputDir: path.dirname(file) };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Generate Word document(s)",
      kind: "other",
      rawInput: {
        blocks: Array.isArray(args.content) ? `${args.content.length} blocks` : undefined,
        batch: Boolean(args.data || args.dataFile),
        outputPath: args.outputPath ?? args.outputDir
      }
    })
  }));

  // ------------------------------------------------------------------ pptx --
  ctx.tools.register(defineTool({
    name: "office_pptx",
    description:
      "Generate PowerPoint (.pptx) decks from structured slide blocks with {{field}} variable rendering. Blocks: title (title + subtitle, a section/title slide), bullets (title + bullet items), content (title + paragraph), table (title + header + rows), image (title + imagePath + caption; local file path, must stay inside workDir). Single mode: pass outputPath and optional variables. Batch mode: pass data/dataFile (CSV/JSON rows) plus outputDir and filenameTemplate to render one deck per row. All referenced fields must be non-empty, or the whole call fails. Existing files are never overwritten unless overwrite=true.",
    parameters: {
      content: {
        type: "array",
        required: true,
        description: "Slide blocks, in order. Each block: {type:\"title\",title,subtitle} | {type:\"bullets\",title,items:[string]} | {type:\"content\",title,text} | {type:\"table\",title,header:[string],rows:[[string]]} | {type:\"image\",title,imagePath,caption}. Every text surface supports {{field}}.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            type: { type: "string", enum: ["title", "bullets", "content", "table", "image"] },
            title: { type: "string" },
            subtitle: { type: "string" },
            text: { type: "string" },
            items: { type: "array", items: { type: "string" } },
            header: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "array", items: { type: "string" } } },
            imagePath: { type: "string" },
            caption: { type: "string" }
          }
        }
      },
      variables: {
        type: "object",
        additionalProperties: true,
        description: "Global variables available as {{field}} in every block."
      },
      outputPath: {
        type: "string",
        description: "Single mode: output .pptx path (relative to workDir)."
      },
      dataFile: {
        type: "string",
        description: "Batch mode: .csv/.json file with one object per deck (fields become {{field}} variables)."
      },
      data: {
        type: "array",
        description: "Batch mode: inline rows instead of dataFile.",
        items: { type: "object", additionalProperties: true }
      },
      outputDir: {
        type: "string",
        description: "Batch mode: directory for the generated files (relative to workDir)."
      },
      filenameTemplate: {
        type: "string",
        description: "Batch mode: per-file name template, e.g. \"summary_{{name}}.pptx\"."
      },
      workDir: {
        type: "string",
        description: "Base directory for resolving paths. Prefer absolute paths."
      },
      overwrite: {
        type: "boolean",
        description: "Allow overwriting existing files. Default false."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          count: { type: "integer" },
          outputDir: { type: "string" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Generated ${value.count} .pptx deck(s): ${value.files.slice(0, 5).join(", ")}${value.count > 5 ? " …" : ""}.`
      }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const base = args.workDir && String(args.workDir).trim() !== "" ? args.workDir : process.cwd();
      const rows = await loadDocRows(args, base);
      const batch = rows !== null;
      if (batch) {
        if (!Array.isArray(rows) || rows.length === 0) throw new Error("batch data is empty");
        if (rows.length > cfg.maxDocRows) {
          throw new Error(`batch size ${rows.length} exceeds the configured cap of ${cfg.maxDocRows}; raise config maxDocRows if this is intentional`);
        }
        if (!args.outputDir || !args.filenameTemplate) {
          throw new Error('batch mode requires outputDir and filenameTemplate (e.g. "summary_{{name}}.pptx")');
        }
        const dir = path.resolve(base, args.outputDir);
        await fsp.mkdir(dir, { recursive: true });
        const files = [];
        for (let i = 0; i < rows.length; i++) {
          const vars = { ...(args.variables ?? {}), ...rows[i] };
          const nameRender = renderTemplate(args.filenameTemplate, rows[i]);
          if (nameRender.missing.length > 0) {
            throw new Error(`row ${i + 1}: filenameTemplate references missing field(s) ${nameRender.missing.map((k) => `{{${k}}}`).join(", ")}`);
          }
          const file = path.join(dir, sanitizeFilename(nameRender.text));
          if (!args.overwrite) {
            try {
              await fsp.access(file);
              throw new Error(`${file} already exists; pass overwrite=true to replace it`);
            } catch (err) {
              if (err.code !== "ENOENT") throw err;
            }
          }
          await generatePptx({ blocks: args.content, vars, outPath: file, baseDir: base });
          files.push(file);
        }
        return { mode: "batch", count: files.length, files, outputDir: dir };
      }
      if (!args.outputPath) throw new Error('single mode requires outputPath (or use batch mode with data/dataFile + outputDir + filenameTemplate)');
      const file = path.resolve(base, args.outputPath);
      if (!file.toLowerCase().endsWith(".pptx")) throw new Error("outputPath must end with .pptx");
      if (!args.overwrite) {
        try {
          await fsp.access(file);
          throw new Error(`${file} already exists; pass overwrite=true to replace it`);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      }
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await generatePptx({ blocks: args.content, vars: args.variables ?? {}, outPath: file, baseDir: base });
      return { mode: "single", count: 1, files: [file], outputDir: path.dirname(file) };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Generate PowerPoint deck(s)",
      kind: "other",
      rawInput: {
        slides: Array.isArray(args.content) ? `${args.content.length} slides` : undefined,
        batch: Boolean(args.data || args.dataFile),
        outputPath: args.outputPath ?? args.outputDir
      }
    })
  }));

  // ------------------------------------------------------------- template --
  ctx.tools.register(defineTool({
    name: "office_template",
    description:
      "Fill an existing .docx template: replace every {{field}} placeholder in the template body with provided values, handling placeholders that Word split across formatting runs. Every placeholder found in the template MUST be provided or the call fails (no half-rendered documents). Single mode: pass outputPath and variables. Batch mode: pass data/dataFile (CSV/JSON rows) plus outputDir and filenameTemplate to render one document per row (row fields merge with variables). Note: placeholders inside headers/footers are not processed in this version.",
    parameters: {
      templateFile: {
        type: "string",
        required: true,
        description: "Path to the .docx template (relative to workDir). Create it in Word by typing {{name}} in one go."
      },
      variables: {
        type: "object",
        additionalProperties: true,
        description: "Values for the template placeholders, single mode."
      },
      dataFile: {
        type: "string",
        description: "Batch mode: .csv/.json file with one object per document (fields become {{field}} values)."
      },
      data: {
        type: "array",
        description: "Batch mode: inline rows instead of dataFile.",
        items: { type: "object", additionalProperties: true }
      },
      outputPath: {
        type: "string",
        description: "Single mode: output .docx path (relative to workDir)."
      },
      outputDir: {
        type: "string",
        description: "Batch mode: directory for the generated files (relative to workDir)."
      },
      filenameTemplate: {
        type: "string",
        description: "Batch mode: per-file name template, e.g. \"contract_{{name}}.docx\"."
      },
      workDir: {
        type: "string",
        description: "Base directory for resolving paths. Prefer absolute paths."
      },
      overwrite: {
        type: "boolean",
        description: "Allow overwriting existing files. Default false."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          count: { type: "integer" },
          tokens: { type: "array", items: { type: "string" } },
          outputDir: { type: "string" }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Filled ${value.count} document(s) from template (${value.tokens.length} placeholder(s) each): ${value.files.slice(0, 5).join(", ")}${value.count > 5 ? " …" : ""}.`
      }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const base = args.workDir && String(args.workDir).trim() !== "" ? args.workDir : process.cwd();
      const templatePath = path.resolve(base, args.templateFile);
      try {
        await fsp.access(templatePath);
      } catch {
        throw new Error(`templateFile not found: ${templatePath}`);
      }
      const rows = await loadDocRows(args, base);
      const batch = rows !== null;
      const guard = async (file) => {
        if (!args.overwrite) {
          try {
            await fsp.access(file);
            throw new Error(`${file} already exists; pass overwrite=true to replace it`);
          } catch (err) {
            if (err.code !== "ENOENT") throw err;
          }
        }
      };

      if (batch) {
        if (!Array.isArray(rows) || rows.length === 0) throw new Error("batch data is empty");
        if (rows.length > cfg.maxDocRows) {
          throw new Error(`batch size ${rows.length} exceeds the configured cap of ${cfg.maxDocRows}; raise config maxDocRows if this is intentional`);
        }
        if (!args.outputDir || !args.filenameTemplate) {
          throw new Error('batch mode requires outputDir and filenameTemplate (e.g. "contract_{{name}}.docx")');
        }
        const dir = path.resolve(base, args.outputDir);
        await fsp.mkdir(dir, { recursive: true });
        const files = [];
        let tokens = [];
        for (let i = 0; i < rows.length; i++) {
          const vars = { ...(args.variables ?? {}), ...rows[i] };
          const nameRender = renderTemplate(args.filenameTemplate, rows[i]);
          if (nameRender.missing.length > 0) {
            throw new Error(`row ${i + 1}: filenameTemplate references missing field(s) ${nameRender.missing.map((k) => `{{${k}}}`).join(", ")}`);
          }
          const file = path.join(dir, sanitizeFilename(nameRender.text));
          await guard(file);
          const res = await injectDocx({ templatePath, outPath: file, vars });
          tokens = res.tokens;
          files.push(file);
        }
        return { mode: "batch", count: files.length, files, tokens, outputDir: dir };
      }

      if (!args.outputPath) throw new Error('single mode requires outputPath (or use batch mode with data/dataFile + outputDir + filenameTemplate)');
      const file = path.resolve(base, args.outputPath);
      if (!file.toLowerCase().endsWith(".docx")) throw new Error("outputPath must end with .docx");
      await guard(file);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const res = await injectDocx({ templatePath, outPath: file, vars: args.variables ?? {} });
      return { mode: "single", count: 1, files: [file], tokens: res.tokens, outputDir: path.dirname(file) };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Fill .docx template",
      kind: "other",
      rawInput: {
        templateFile: args.templateFile,
        batch: Boolean(args.data || args.dataFile),
        outputPath: args.outputPath ?? args.outputDir
      }
    })
  }));

  // ----------------------------------------------------------------- sheet --
  ctx.tools.register(defineTool({
    name: "office_sheet",
    description:
      "Spreadsheet pipeline for .csv and .xlsx files. Always inspect first to learn the columns and row count, then filter / aggregate / split. Actions: \"inspect\" (columns with fill ratio, inferred type, sample rows); \"filter\" (one predicate: column + op eq/ne/gt/gte/lt/lte/contains/notContains/empty/notEmpty + value, matched rows optionally written to outputPath); \"aggregate\" (groupBy columns + metrics sum/avg/min/max/count); \"split\" (one file per distinct value of a column, named <outputPrefix>_<value>.<ext>). Outputs are .csv or .xlsx depending on the outputPath extension. Without outputPath, filter/aggregate return row counts and samples only.",
    parameters: {
      file: {
        type: "string",
        required: true,
        description: "Input .csv or .xlsx path (relative to workDir)."
      },
      workDir: {
        type: "string",
        description: "Base directory for resolving file and output paths. Prefer absolute paths."
      },
      action: {
        type: "string",
        required: true,
        description: "One of inspect, filter, aggregate, split.",
        enum: ["inspect", "filter", "aggregate", "split"]
      },
      filter: {
        type: "object",
        additionalProperties: false,
        description: "Required for action=filter.",
        properties: {
          column: { type: "string" },
          op: { type: "string", enum: ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "notContains", "empty", "notEmpty"] },
          value: { type: "string", description: "Comparison value; numeric for gt/gte/lt/lte." }
        }
      },
      aggregate: {
        type: "object",
        additionalProperties: false,
        description: "Required for action=aggregate.",
        properties: {
          groupBy: { type: "array", items: { type: "string" } },
          metrics: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                column: { type: "string", description: "Metric column; omit for fn=count." },
                fn: { type: "string", enum: ["sum", "avg", "min", "max", "count"] }
              }
            }
          }
        }
      },
      splitBy: {
        type: "string",
        description: "Required for action=split: the column whose distinct values become files."
      },
      outputPath: {
        type: "string",
        description: "filter/aggregate output path (.csv/.xlsx by extension). Omit to preview only."
      },
      outputPrefix: {
        type: "string",
        description: "split mode base path without extension, e.g. out/region → out/region_<value>.csv (extension follows the input file)."
      },
      sampleRows: {
        type: "integer",
        description: "Sample rows to return (default 5, max 20)."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {}
      },
      render: (_args, value) => [{
        type: "text",
        text: value.summary ?? "Spreadsheet operation done."
      }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const base = args.workDir && String(args.workDir).trim() !== "" ? args.workDir : process.cwd();
      const abs = path.resolve(base, args.file);
      let rows;
      try {
        rows = await readTable(abs);
      } catch (err) {
        throw new Error(`cannot read ${abs}: ${err.message}`);
      }
      if (rows.length > cfg.maxSheetRows) {
        throw new Error(`row count ${rows.length} exceeds the configured cap of ${cfg.maxSheetRows}; raise config maxSheetRows if this is intentional`);
      }
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const maxSamples = Math.min(Math.max(args.sampleRows ?? 5, 0), 20);
      const sample = (list) => list.slice(0, maxSamples);

      if (args.action === "inspect") {
        const stats = inspectColumns(columns, rows);
        return {
          summary: `${path.basename(abs)}: ${rows.length} rows, ${columns.length} columns (${stats.filter((c) => c.inferredType === "numeric").length} numeric).`,
          file: abs,
          rowCount: rows.length,
          columns: stats,
          sampleRows: sample(rows)
        };
      }

      if (args.action === "filter") {
        if (!args.filter || !args.filter.column || !args.filter.op) {
          throw new Error("action=filter requires filter: {column, op, value?}");
        }
        if (rows.length > 0 && !columns.includes(args.filter.column)) {
          throw new Error(`filter.column "${args.filter.column}" not found; columns are: ${columns.join(", ")}`);
        }
        const { keep, skipped } = applyFilter(rows, args.filter);
        let outputPath = null;
        if (args.outputPath) {
          outputPath = path.resolve(base, args.outputPath);
          await fsp.mkdir(path.dirname(outputPath), { recursive: true });
          await writeTable(outputPath, columns, keep);
        }
        return {
          summary: `Filter ${args.filter.column} ${args.filter.op} ${args.filter.value ?? ""}: ${keep.length}/${rows.length} rows matched${skipped > 0 ? `, ${skipped} skipped (non-numeric)` : ""}${outputPath ? ` → ${outputPath}` : " (preview only)"}.`,
          matched: keep.length,
          total: rows.length,
          skipped,
          outputPath,
          sampleRows: sample(keep)
        };
      }

      if (args.action === "aggregate") {
        if (!args.aggregate) throw new Error("action=aggregate requires aggregate: {groupBy, metrics}");
        for (const c of args.aggregate.groupBy ?? []) {
          if (rows.length > 0 && !columns.includes(c)) {
            throw new Error(`aggregate.groupBy column "${c}" not found; columns are: ${columns.join(", ")}`);
          }
        }
        const { header, rows: out, skipped } = aggregateTable(rows, args.aggregate);
        let outputPath = null;
        if (args.outputPath) {
          outputPath = path.resolve(base, args.outputPath);
          await fsp.mkdir(path.dirname(outputPath), { recursive: true });
          await writeTable(outputPath, header, out);
        }
        return {
          summary: `Aggregate by ${args.aggregate.groupBy.join(", ")}: ${out.length} group(s)${skipped > 0 ? `, ${skipped} non-numeric value(s) skipped` : ""}${outputPath ? ` → ${outputPath}` : " (preview only)"}.`,
          groups: out.length,
          skipped,
          outputPath,
          rows: out
        };
      }

      if (args.action === "split") {
        if (!args.splitBy) throw new Error("action=split requires splitBy (a column name)");
        if (rows.length > 0 && !columns.includes(args.splitBy)) {
          throw new Error(`splitBy column "${args.splitBy}" not found; columns are: ${columns.join(", ")}`);
        }
        if (!args.outputPrefix) throw new Error("action=split requires outputPrefix, e.g. out/region");
        const groups = splitTable(rows, args.splitBy);
        const ext = abs.toLowerCase().endsWith(".xlsx") ? ".xlsx" : ".csv";
        const prefix = path.resolve(base, args.outputPrefix);
        await fsp.mkdir(path.dirname(prefix), { recursive: true });
        const files = [];
        for (const g of groups) {
          const file = `${prefix}_${sanitizeFilename(g.value)}${ext}`;
          await writeTable(file, columns, g.rows);
          files.push({ value: g.value, rows: g.rows.length, file });
        }
        return {
          summary: `Split by ${args.splitBy}: ${files.length} file(s) under ${path.dirname(prefix)}.`,
          files
        };
      }

      throw new Error(`unknown action "${args.action}"`);
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Spreadsheet ${args.action ?? ""}`.trim(),
      kind: "other",
      rawInput: { file: args.file, action: args.action }
    })
  }));

  // ----------------------------------------------------------------- inbox --
  ctx.tools.register(defineTool({
    name: "office_inbox_fetch",
    description:
      "Read-only IMAP pull of the newest messages in the configured mailbox: date, sender, subject, a short body snippet, and the attachment list (contents are discarded, never stored). Results are appended to the local index (~/.dsh/office/mail/index.jsonl, metadata only) with duplicates skipped; office_inbox_triage and future archive/stats tools read that shared index. IMAP is never written: bodies are fetched with PEEK so \\Seen is not set, and no flags are changed. The IMAP account comes from the tool-office config (imapUser + DSH_IMAP_PASS env); qq/163/126/gmail/outlook hosts are auto-derived from the address, other providers need imapHost. QQ/163/126 require an IMAP authorization code (授权码), not the login password.",
    parameters: {
      limit: {
        type: "integer",
        description: "How many newest messages to pull (default 20, capped by config maxInboxFetch)."
      },
      mailbox: {
        type: "string",
        description: "Mailbox to open. Default INBOX (config imapMailbox)."
      },
      daysBack: {
        type: "integer",
        description: "Only look at messages received within this many days (default 7)."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {}
      },
      render: (_args, value) => [{
        type: "text",
        text: `Inbox fetch: ${value.fetched} message(s) from ${value.mailbox}, ${value.indexedNew} new in the index, ${value.skippedDuplicates} duplicate(s) skipped. Triage them with office_inbox_triage.`
      }]
    },
    isConcurrencySafe: () => false,
    timeoutMs: 10 * 60_000,
    async execute(args) {
      const settings = resolveImap(cfg);
      const limit = Math.min(Math.max(args.limit ?? 20, 1), cfg.maxInboxFetch);
      const mailbox = args.mailbox && String(args.mailbox).trim() !== "" ? args.mailbox : cfg.imapMailbox;
      const daysBack = Math.max(args.daysBack ?? 7, 1);
      const messages = await fetchInbox({
        settings,
        mailbox,
        limit,
        daysBack,
        snippetChars: cfg.inboxSnippetChars
      });
      const { appended, skippedDuplicates } = await appendIndex(messages, defaultIndexPath());
      return {
        mailbox,
        fetched: messages.length,
        indexedNew: appended,
        skippedDuplicates,
        messages: messages.map((m) => ({
          uid: m.uid,
          date: m.date,
          from: m.from.address ? (m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address) : "",
          subject: m.subject,
          snippet: m.snippet,
          attachments: m.attachments,
          seen: m.seen
        }))
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Fetch inbox over IMAP",
      kind: "other",
      rawInput: { limit: args.limit ?? 20, mailbox: args.mailbox ?? "INBOX", daysBack: args.daysBack ?? 7 }
    })
  }));

  ctx.tools.register(defineTool({
    name: "office_inbox_triage",
    description:
      "Triage recently indexed inbox messages into four buckets: todo (time-sensitive: deadlines, interviews, offers, verification codes), notice (informational: announcements, reminders), subscription (bulk: newsletters, notifications, no-reply senders), personal (human 1:1 mail). Deterministic rules classify every message and each verdict carries its evidence; low/medium-confidence items are listed in needsReview — review those semantically and re-bucket if the rules got them wrong. Also emits subscriptionSenders, a per-sender frequency table that will feed the (future) unsubscribe advisor. Data source: the local JSONL index written by office_inbox_fetch; no network access.",
    parameters: {
      sinceHours: {
        type: "integer",
        description: "Only triage messages received within this many hours (default 24)."
      },
      limit: {
        type: "integer",
        description: "Maximum messages to triage, newest first (default 100)."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {}
      },
      render: (_args, value) => [{
        type: "text",
        text: `Inbox triage (${value.windowHours}h, ${value.total} messages): ${value.counts.todo} todo, ${value.counts.notice} notice, ${value.counts.subscription} subscription, ${value.counts.personal} personal; ${value.needsReview.length} need semantic review.`
      }]
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const windowHours = Math.max(args.sinceHours ?? 24, 1);
      const limit = Math.max(args.limit ?? 100, 1);
      const index = await loadIndex(defaultIndexPath());
      const cutoff = Date.now() - windowHours * 3600_000;
      const messages = index.filter((m) => new Date(m.date ?? 0).getTime() >= cutoff).slice(0, limit);
      const result = triageMessages(messages);
      return {
        windowHours,
        total: messages.length,
        counts: result.counts,
        todo: result.buckets.todo,
        notice: result.buckets.notice,
        subscription: result.buckets.subscription,
        personal: result.buckets.personal,
        subscriptionSenders: result.subscriptionSenders,
        needsReview: result.needsReview
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Triage inbox",
      kind: "other",
      rawInput: { sinceHours: args.sinceHours ?? 24, limit: args.limit ?? 100 }
    })
  }));

  // ------------------------------------------------------- inbox workflows --
  ctx.tools.register(defineTool({
    name: "office_daily_brief",
    description:
      "Turn the local inbox index into a concise, explainable daily brief: top actions, today's/overdue/upcoming counts, unread and attachment counts, category mix, and low-confidence items that need human review. Use this when the user asks what matters today or says '帮我开始今天的工作'. Purely local and read-only; it never changes mailbox state or sends mail.",
    parameters: {
      sinceHours: { type: "integer", description: "Only consider messages received within this many hours (default 72)." },
      horizonDays: { type: "integer", description: "Include actions due within this many days, plus anything overdue (default 7)." },
      focusLimit: { type: "integer", description: "Maximum top actions in the brief (default 5, max 20)." }
    },
    output: { schema: { type: "object", additionalProperties: true, properties: {} }, render: (_args, value) => [{
      type: "text",
      text: `${value.headline} ${value.actionCounts.overdue} overdue, ${value.actionCounts.today} due today, ${value.needsReview.length} need review.`
    }] },
    isConcurrencySafe: () => true,
    async execute(args) {
      const sinceHours = Math.max(args.sinceHours ?? 72, 1);
      const index = await loadIndex(defaultIndexPath());
      const cutoff = Date.now() - sinceHours * 3600_000;
      const messages = index.filter((message) => new Date(message.date ?? 0).getTime() >= cutoff);
      return { sinceHours, ...buildDailyBrief(messages, {
        horizonDays: Math.max(args.horizonDays ?? 7, 1),
        focusLimit: Math.min(Math.max(args.focusLimit ?? 5, 1), 20)
      }) };
    },
    presentCall: (args) => ({ card: "generic", title: "Build daily inbox brief", kind: "other", rawInput: {
      sinceHours: args.sinceHours ?? 72, horizonDays: args.horizonDays ?? 7, focusLimit: args.focusLimit ?? 5
    } })
  }));

  ctx.tools.register(defineTool({
    name: "office_action_radar",
    description:
      "Extract and rank actionable work from locally indexed email snippets. Each action includes type, sender, deadline when explicit, overdue/today/upcoming state, priority score, attachments, and the exact rule evidence behind the decision. Use it for deadlines, follow-ups, material collection, course work, administrative requests, and messages awaiting a reply. Purely local and read-only.",
    parameters: {
      sinceHours: { type: "integer", description: "Only consider messages received within this many hours (default 336, 14 days)." },
      horizonDays: { type: "integer", description: "Include actions due within this many days, plus anything overdue (default 14)." },
      limit: { type: "integer", description: "Maximum actions to return (default 50, max 200)." }
    },
    output: { schema: { type: "object", additionalProperties: true, properties: {} }, render: (_args, value) => [{
      type: "text",
      text: `Action radar: ${value.total} action(s), ${value.counts.overdue} overdue, ${value.counts.today} due today, ${value.counts.upcoming} upcoming, ${value.counts.unscheduled} without a date.`
    }] },
    isConcurrencySafe: () => true,
    async execute(args) {
      const sinceHours = Math.max(args.sinceHours ?? 336, 1);
      const index = await loadIndex(defaultIndexPath());
      const cutoff = Date.now() - sinceHours * 3600_000;
      const messages = index.filter((message) => new Date(message.date ?? 0).getTime() >= cutoff);
      return { sinceHours, ...buildActionRadar(messages, {
        horizonDays: Math.max(args.horizonDays ?? 14, 1),
        limit: Math.min(Math.max(args.limit ?? 50, 1), 200)
      }) };
    },
    presentCall: (args) => ({ card: "generic", title: "Scan inbox action radar", kind: "other", rawInput: {
      sinceHours: args.sinceHours ?? 336, horizonDays: args.horizonDays ?? 14, limit: args.limit ?? 50
    } })
  }));

  ctx.tools.register(defineTool({
    name: "office_context_reply",
    description:
      "Prepare a safe context-aware reply package for one locally indexed email. It groups every indexed snippet with the same normalized subject, orders the thread, extracts action signals, and creates concise/formal/warm drafts from optional replyPoints. The drafts are review material only. Show them to the user, let the user edit or choose one, then use office_mail_preview; office_mail_send still requires explicit confirm:true. No mail is sent by this tool.",
    parameters: {
      uid: { type: "integer", description: "UID of the target indexed message. Provide uid or messageId." },
      messageId: { type: "string", description: "Message-ID of the target indexed message. Provide uid or messageId." },
      replyPoints: { type: "array", items: { type: "string" }, description: "Facts or decisions that the reply must include. Maximum 8." },
      language: { type: "string", enum: ["auto", "zh", "en"], description: "Draft language. Default auto from subject/snippet." }
    },
    output: { schema: { type: "object", additionalProperties: true, properties: {} }, render: (_args, value) => [{
      type: "text",
      text: `Reply package ready for ${value.target.to}: ${value.threadLength} message(s) in context, ${value.drafts.length} draft tones. Review before previewing or sending.`
    }] },
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.uid == null && !args.messageId) throw new Error("provide uid or messageId for the email to reply to");
      const index = await loadIndex(defaultIndexPath());
      return buildContextReply(index, args);
    },
    presentCall: (args) => ({ card: "generic", title: "Prepare context-aware reply", kind: "other", rawInput: {
      uid: args.uid, messageId: args.messageId, language: args.language ?? "auto", replyPoints: args.replyPoints?.length ?? 0
    } })
  }));

  ctx.tools.register(defineTool({
    name: "office_thread_summary",
    description:
      "Summarize one complete email thread into participants, timeline, commitments, questions, decisions, attachments, and ranked actions. Every result carries a mail citation. contextMode indexed uses local snippets with zero network access; contextMode full re-fetches selected messages through read-only IMAP BODY.PEEK, keeps full text only in memory, and does not mark messages read or expand the local index.",
    parameters: {
      uid: { type: "integer", description: "UID of any message in the thread. Provide uid, messageId, or subject." },
      messageId: { type: "string", description: "Message-ID of any message in the thread." },
      subject: { type: "string", description: "Subject substring used to find the thread when no ID is available." },
      contextMode: { type: "string", enum: ["indexed", "full"], description: "indexed uses stored snippets; full re-fetches text via read-only IMAP. Default indexed." },
      maxMessages: { type: "integer", description: "Maximum thread messages to re-fetch in full mode; bounded by config." }
    },
    output: { schema: { type: "object", additionalProperties: true, properties: {} }, render: (_args, value) => [{
      type: "text",
      text: `Thread summary: ${value.messageCount} message(s), ${value.actions.length} action(s), ${value.questions.length} open question signal(s), using ${value.contextSource}.`
    }] },
    isConcurrencySafe: () => true,
    timeoutMs: 5 * 60_000,
    async execute(args) {
      if (args.uid == null && !args.messageId && !args.subject) throw new Error("provide uid, messageId, or subject");
      const context = await loadThreadContext(args);
      const result = summarizeThread(context.messages, args);
      return { ...result, skipped: context.skipped };
    },
    presentCall: (args) => ({ card: "generic", title: "Summarize mail thread", kind: "other", rawInput: {
      uid: args.uid, messageId: args.messageId, subject: args.subject, contextMode: args.contextMode ?? "indexed"
    } })
  }));

  ctx.tools.register(defineTool({
    name: "office_action_extract",
    description:
      "Extract concrete tasks, deadlines, responsible parties, attachments, and urgency from one indexed message, a complete indexed thread, or pasted notice text. Returns ranked actions and citations to the exact mail source. Use this for course notices, thesis feedback, funding calls, meeting requests, and administrative instructions. Local and read-only.",
    parameters: {
      uid: { type: "integer", description: "UID of a target indexed message." },
      messageId: { type: "string", description: "Message-ID of a target indexed message." },
      subject: { type: "string", description: "Subject substring used to select an indexed thread or label pasted text." },
      text: { type: "string", description: "Optional pasted notice text. When supplied, no index lookup is required." },
      limit: { type: "integer", description: "Maximum actions to return (default 30, max 100)." }
    },
    output: { schema: { type: "object", additionalProperties: true, properties: {} }, render: (_args, value) => [{
      type: "text",
      text: `Action extraction: ${value.total} action(s) from ${value.scope}; ${value.counts.overdue} overdue and ${value.counts.today} due today.`
    }] },
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.uid == null && !args.messageId && !args.subject && !String(args.text ?? "").trim()) {
        throw new Error("provide uid, messageId, subject, or text");
      }
      const index = await loadIndex(defaultIndexPath());
      return extractActions(index, { ...args, limit: Math.min(Math.max(args.limit ?? 30, 1), 100) });
    },
    presentCall: (args) => ({ card: "generic", title: "Extract actions and deadlines", kind: "other", rawInput: {
      uid: args.uid, messageId: args.messageId, subject: args.subject, pastedText: Boolean(args.text)
    } })
  }));

  ctx.tools.register(defineTool({
    name: "office_reply_draft",
    description:
      "Create one context-aware reply draft in concise, formal, or warm tone. It includes the inspected thread, action signals, and mail citations so the user can verify the wording. indexed mode uses local snippets; full mode reads selected messages via IMAP BODY.PEEK and keeps text only in memory. This tool never sends mail. The user must review the draft, then use office_mail_preview and explicitly confirm office_mail_send.",
    parameters: {
      uid: { type: "integer", description: "UID of the message to reply to. Provide uid or messageId." },
      messageId: { type: "string", description: "Message-ID of the message to reply to." },
      tone: { type: "string", enum: ["concise", "formal", "warm"], description: "Selected draft tone. Default formal." },
      replyPoints: { type: "array", items: { type: "string" }, description: "Confirmed facts or decisions to include. Maximum 8." },
      language: { type: "string", enum: ["auto", "zh", "en"], description: "Draft language. Default auto." },
      contextMode: { type: "string", enum: ["indexed", "full"], description: "indexed uses snippets; full re-fetches the thread read-only." },
      maxMessages: { type: "integer", description: "Maximum messages to re-fetch in full mode; bounded by config." }
    },
    output: { schema: { type: "object", additionalProperties: true, properties: {} }, render: (_args, value) => [{
      type: "text",
      text: `${value.selectedTone} reply draft ready for ${value.target.to}, grounded in ${value.threadLength} message(s). Review it before previewing or sending.`
    }] },
    isConcurrencySafe: () => true,
    timeoutMs: 5 * 60_000,
    async execute(args) {
      if (args.uid == null && !args.messageId) throw new Error("provide uid or messageId for the email to reply to");
      const context = await loadThreadContext(args);
      const result = buildReplyDraft(context.messages, args);
      return { ...result, contextMode: context.contextMode, skipped: context.skipped };
    },
    presentCall: (args) => ({ card: "generic", title: "Draft a grounded reply", kind: "other", rawInput: {
      uid: args.uid, messageId: args.messageId, tone: args.tone ?? "formal", contextMode: args.contextMode ?? "indexed"
    } })
  }));

  ctx.tools.register(defineTool({
    name: "office_collection_track",
    description:
      "Track registrations and material collection for scholarships, student organizations, campus activities, competitions, training, course work, leave forms, or research-group submissions. Roster mode compares a known participant list with indexed mail and reports unmatched submissions. Discover mode starts from a required subject keyword and discovers participants from matching senders, which is useful for open registration without a roster. Both modes detect repeat submissions, compare attachment names with required items, preserve human corrections, and attach source-mail evidence. list reopens the ledger; update records a correction; export writes CSV or XLSX. This tool never selects applicants or sends reminders automatically.",
    parameters: {
      action: { type: "string", enum: ["scan", "list", "update", "export"], description: "Operation to perform. Default scan." },
      collectionId: { type: "string", required: true, description: "Stable ledger ID, for example scholarship-2026." },
      title: { type: "string", description: "Human-readable collection title." },
      subjectKeyword: { type: "string", description: "Only match indexed messages whose subject contains this keyword." },
      participantMode: { type: "string", enum: ["roster", "discover"], description: "roster checks a known list. discover finds participants from matching senders and requires subjectKeyword. Default roster." },
      participants: { type: "array", items: { type: "object", additionalProperties: true }, description: "Expected people as objects containing name and email." },
      participantsFile: { type: "string", description: "CSV or XLSX roster inside workDir with name and email columns." },
      requiredItems: { type: "array", items: { type: "string" }, description: "Required material names. Use | for aliases, for example 成绩单|transcript." },
      daysBack: { type: "integer", description: "Mail look-back window for scan. Default 90 days." },
      participantEmail: { type: "string", description: "Participant to correct when action=update." },
      status: { type: "string", enum: ["pending", "partial", "complete", "exempt"], description: "Human-confirmed status for action=update." },
      note: { type: "string", description: "Optional audit note for action=update." },
      outputPath: { type: "string", description: "CSV or XLSX destination inside workDir for action=export." },
      workDir: { type: "string", description: "Base directory for participantsFile and outputPath." }
    },
    output: { schema: { type: "object", additionalProperties: true, properties: {} }, render: (_args, value) => [{
      type: "text",
      text: value.file && value.rows != null
        ? `Collection exported: ${value.rows} row(s) to ${value.file}.`
        : `Collection ${value.collectionId}: ${value.counts?.complete ?? 0} complete, ${value.counts?.partial ?? 0} partial, ${value.counts?.pending ?? 0} pending.`
    }] },
    isConcurrencySafe: (args) => (args.action ?? "scan") === "list",
    async execute(args) {
      const action = args.action ?? "scan";
      const base = path.resolve(args.workDir || process.cwd());
      if (action === "scan") {
        let participants = args.participants;
        if ((!participants || participants.length === 0) && args.participantsFile) {
          const roster = path.resolve(base, args.participantsFile);
          if (!isInsideDir(base, roster)) throw new Error(`participantsFile escapes workDir: ${args.participantsFile}`);
          participants = await readTable(roster);
        }
        const messages = await loadIndex(defaultIndexPath());
        return scanCollection({
          messages,
          storeDir: collectionDir(),
          collectionId: args.collectionId,
          title: args.title,
          subjectKeyword: args.subjectKeyword,
          participantMode: args.participantMode ?? "roster",
          participants,
          requiredItems: args.requiredItems ?? [],
          daysBack: Math.max(args.daysBack ?? 90, 1)
        });
      }
      if (action === "list") return getCollection({ storeDir: collectionDir(), collectionId: args.collectionId });
      if (action === "update") {
        if (!args.participantEmail || !args.status) throw new Error("participantEmail and status are required for update");
        return updateCollection({
          storeDir: collectionDir(), collectionId: args.collectionId,
          participantEmail: args.participantEmail, status: args.status, note: args.note
        });
      }
      if (action === "export") {
        if (!args.outputPath) throw new Error("outputPath is required for export");
        const file = path.resolve(base, args.outputPath);
        if (!isInsideDir(base, file)) throw new Error(`outputPath escapes workDir: ${args.outputPath}`);
        if (!/[.]csv$|[.]xlsx$/i.test(file)) throw new Error("outputPath must end in .csv or .xlsx");
        const ledger = await getCollection({ storeDir: collectionDir(), collectionId: args.collectionId });
        const rows = collectionRows(ledger);
        const header = ["name", "email", "status", "receivedItems", "missingItems", "messageCount", "lastReceivedAt", "note"];
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await writeTable(file, header, rows);
        return { collectionId: ledger.collectionId, file, rows: rows.length, counts: ledger.counts };
      }
      throw new Error(`unknown action ${action}`);
    },
    presentCall: (args) => ({ card: "generic", title: "Track collected materials", kind: "other", rawInput: {
      action: args.action ?? "scan", collectionId: args.collectionId,
      participantMode: args.participantMode ?? "roster", subjectKeyword: args.subjectKeyword
    } })
  }));

  ctx.tools.register(defineTool({
    name: "office_attachment_ask",
    description:
      "Read a local attachment and return query-relevant evidence with precise citations: PDF page, Word paragraph, PowerPoint slide, Excel sheet and row, or text line range. Supports PDF, DOCX, PPTX, XLSX, CSV, text, JSON, HTML, XML, SVG, and a safe local handoff for raster images. The file must stay inside workDir, is never modified, and is not uploaded by this tool.",
    parameters: {
      file: { type: "string", required: true, description: "Attachment path relative to workDir, or an absolute path inside workDir." },
      query: { type: "string", required: true, description: "Question or keywords used to retrieve relevant evidence." },
      workDir: { type: "string", description: "Allowed base directory. Prefer an absolute path." },
      limit: { type: "integer", description: "Maximum evidence passages. Default 8, max 30." }
    },
    output: { schema: { type: "object", additionalProperties: true, properties: {} }, render: (_args, value) => [{
      type: "text",
      text: value.needsVisionReview
        ? `Image attachment ready for local vision review: ${value.file}.`
        : `Attachment evidence: ${value.evidence.length} relevant passage(s) from ${value.fileName}, with ${value.format} citations.`
    }] },
    isConcurrencySafe: () => true,
    timeoutMs: 5 * 60_000,
    async execute(args) {
      if (!String(args.query ?? "").trim()) throw new Error("query is required");
      return inspectAttachment({
        file: args.file,
        workDir: args.workDir || process.cwd(),
        query: args.query,
        limit: Math.min(Math.max(args.limit ?? 8, 1), 30),
        maxFileMb: cfg.maxAttachmentReadMb
      });
    },
    presentCall: (args) => ({ card: "generic", title: "Ask a local attachment", kind: "other", rawInput: {
      file: args.file, query: args.query, limit: args.limit ?? 8
    } })
  }));

  // ---------------------------------------------------------------- archive --
  const ARCHIVE_FILTER_PROPS = {
    from: { type: "string", description: "Substring match against sender address / name / domain (case-insensitive)." },
    subject: { type: "string", description: "Substring match against the subject (case-insensitive)." },
    sinceDays: { type: "integer", description: "Only messages newer than this many days." },
    untilDays: { type: "integer", description: "Only messages older than this many days (bounds the old edge of the window)." },
    hasAttachment: { type: "boolean", description: "true = only messages with attachments; false = only without." },
    category: { type: "string", enum: ["todo", "notice", "subscription", "personal"], description: "Deterministic triage category to match." }
  };

  ctx.tools.register(defineTool({
    name: "office_archive_search",
    description:
      "Search the local mail index (~/.dsh/office/mail/index.jsonl, written by office_inbox_fetch) by sender, subject keyword, time window, attachment presence, and triage category. Zero network access; works fully offline. Each hit returns date, sender, subject, snippet, attachment names, and the classification evidence. Use this before office_archive_export / office_archive_attach to build the right filter.",
    parameters: {
      from: { type: "string", description: "Substring match against sender address / name / domain." },
      subject: { type: "string", description: "Substring match against the subject." },
      sinceDays: { type: "integer", description: "Only messages newer than this many days." },
      untilDays: { type: "integer", description: "Only messages older than this many days." },
      hasAttachment: { type: "boolean", description: "true = only with attachments; false = only without." },
      category: { type: "string", enum: ["todo", "notice", "subscription", "personal"] },
      limit: { type: "integer", description: "Max hits to return, newest first (default 50)." }
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: {} },
      render: (_args, value) => [{
        type: "text",
        text: `Archive search: ${value.matched} of ${value.totalInIndex} indexed message(s) match; returning ${value.returned}.`
      }]
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const { from, subject, sinceDays, untilDays, hasAttachment, category, ...rest } = args;
      return searchIndex({
        indexPath: defaultIndexPath(),
        filters: { from, subject, sinceDays, untilDays, hasAttachment, category },
        limit: rest.limit ?? 50
      });
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Search mail archive",
      kind: "other",
      rawInput: { from: args.from, subject: args.subject, category: args.category, sinceDays: args.sinceDays }
    })
  }));

  ctx.tools.register(defineTool({
    name: "office_archive_export",
    description:
      "Export matched messages as .eml files into a directory of your choice (handover / backup scenario: package a term of org mail for the next committee). The index holds metadata only, so the full sources are re-fetched over IMAP read-only (BODY.PEEK, \\Seen never set). Also writes index.csv summarizing the export. Run office_archive_search first to build the filter; show the user the match count before exporting. outputDir must live inside workDir; existing files are never overwritten (unique suffixes are added).",
    parameters: {
      from: ARCHIVE_FILTER_PROPS.from,
      subject: ARCHIVE_FILTER_PROPS.subject,
      sinceDays: ARCHIVE_FILTER_PROPS.sinceDays,
      untilDays: ARCHIVE_FILTER_PROPS.untilDays,
      hasAttachment: ARCHIVE_FILTER_PROPS.hasAttachment,
      category: ARCHIVE_FILTER_PROPS.category,
      outputDir: { type: "string", required: true, description: "Directory for the .eml files + index.csv (relative to workDir, must stay inside it)." },
      workDir: { type: "string", description: "Base directory. Prefer absolute paths." },
      limit: { type: "integer", description: "Cap on messages (default and hard cap: config maxArchiveMessages)." }
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: {} },
      render: (_args, value) => [{
        type: "text",
        text: `Archive export: ${value.exported} .eml file(s) written under ${value.outputDir}${value.skipped.length > 0 ? `, ${value.skipped.length} skipped` : ""}; summary in ${value.indexFile}.`
      }]
    },
    isConcurrencySafe: () => false,
    timeoutMs: 15 * 60_000,
    async execute(args) {
      const base = args.workDir && String(args.workDir).trim() !== "" ? args.workDir : process.cwd();
      const dir = path.resolve(base, args.outputDir ?? "");
      if (!args.outputDir || !isInsideDir(base, dir)) {
        throw new Error(`outputDir "${args.outputDir ?? ""}" escapes workDir; exports must be written inside ${base}`);
      }
      const settings = resolveImap(cfg);
      const index = await loadIndex(defaultIndexPath());
      const filters = { from: args.from, subject: args.subject, sinceDays: args.sinceDays, untilDays: args.untilDays, hasAttachment: args.hasAttachment, category: args.category };
      let entries = filterIndex(index, filters);
      const cap = Math.min(Math.max(args.limit ?? cfg.maxArchiveMessages, 1), cfg.maxArchiveMessages);
      if (entries.length > cap) entries = entries.slice(0, cap);
      const result = await exportArchive({ settings, entries, outputDir: dir, maxMessages: cfg.maxArchiveMessages });
      return { ...result, outputDir: dir, matched: entries.length };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Export messages to .eml",
      kind: "other",
      rawInput: { from: args.from, subject: args.subject, outputDir: args.outputDir }
    })
  }));

  ctx.tools.register(defineTool({
    name: "office_archive_attach",
    description:
      "Batch-download attachments of matched messages into a local directory (the core action of the org sign-up scenario: collect all résumé PDFs from a public inbox). Sources are re-fetched over IMAP read-only (BODY.PEEK). Filenames are sanitized and deduped; per-attachment size cap (config maxAttachmentMb) and an optional extension filter protect the disk. Run office_archive_search with hasAttachment:true first and show the user the match count. outputDir must live inside workDir.",
    parameters: {
      from: ARCHIVE_FILTER_PROPS.from,
      subject: ARCHIVE_FILTER_PROPS.subject,
      sinceDays: ARCHIVE_FILTER_PROPS.sinceDays,
      untilDays: ARCHIVE_FILTER_PROPS.untilDays,
      category: ARCHIVE_FILTER_PROPS.category,
      extensions: {
        type: "array",
        description: "Only save these extensions, e.g. [\"pdf\",\"doc\",\"docx\",\"zip\"]. Empty = all.",
        items: { type: "string" }
      },
      outputDir: { type: "string", required: true, description: "Directory for the attachments (relative to workDir, must stay inside it)." },
      workDir: { type: "string", description: "Base directory. Prefer absolute paths." },
      limit: { type: "integer", description: "Cap on messages (default and hard cap: config maxArchiveMessages)." }
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: {} },
      render: (_args, value) => [{
        type: "text",
        text: `Attachment download: ${value.savedCount} file(s) saved under ${value.outputDir}${value.skipped.length > 0 ? `, ${value.skipped.length} skipped` : ""}.`
      }]
    },
    isConcurrencySafe: () => false,
    timeoutMs: 15 * 60_000,
    async execute(args) {
      const base = args.workDir && String(args.workDir).trim() !== "" ? args.workDir : process.cwd();
      const dir = path.resolve(base, args.outputDir ?? "");
      if (!args.outputDir || !isInsideDir(base, dir)) {
        throw new Error(`outputDir "${args.outputDir ?? ""}" escapes workDir; attachments must be written inside ${base}`);
      }
      const settings = resolveImap(cfg);
      const index = await loadIndex(defaultIndexPath());
      const filters = { from: args.from, subject: args.subject, sinceDays: args.sinceDays, untilDays: args.untilDays, hasAttachment: true, category: args.category };
      let entries = filterIndex(index, filters);
      const cap = Math.min(Math.max(args.limit ?? cfg.maxArchiveMessages, 1), cfg.maxArchiveMessages);
      if (entries.length > cap) entries = entries.slice(0, cap);
      const result = await attachArchive({
        settings,
        entries,
        outputDir: dir,
        maxMessages: cfg.maxArchiveMessages,
        maxAttachmentBytes: Math.round(cfg.maxAttachmentMb * 1024 * 1024),
        extensions: (args.extensions ?? []).map((e) => String(e).toLowerCase().replace(/^\./, ""))
      });
      return { ...result, outputDir: dir, matched: entries.length };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Download attachments",
      kind: "other",
      rawInput: { from: args.from, subject: args.subject, extensions: args.extensions, outputDir: args.outputDir }
    })
  }));

  // ------------------------------------------------------------------ stats --
  ctx.tools.register(defineTool({
    name: "office_stats_overview",
    description:
      "Receive/send overview computed purely from local data: the JSONL index (received mail) and the send audit log (sent mail). Returns monthly trend, top senders, top recipients, category mix (todo/notice/subscription/personal), and the subscription share. Zero network requests; open/click tracking is out of scope by design.",
    parameters: {
      monthsBack: { type: "integer", description: "Window in months (default 6)." }
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: {} },
      render: (_args, value) => [{
        type: "text",
        text: `Mail overview (${value.windowMonths} months): ${value.receivedCount} received, ${value.sentCount} sent (${value.sendFailedCount} failed); subscription share ${Math.round(value.subscriptionShare * 100)}%.`
      }]
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      return statsOverview({
        indexPath: defaultIndexPath(),
        sentLogPath: auditLogPath(),
        monthsBack: Math.max(args.monthsBack ?? 6, 1)
      });
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Mail stats overview",
      kind: "other",
      rawInput: { monthsBack: args.monthsBack ?? 6 }
    })
  }));

  ctx.tools.register(defineTool({
    name: "office_stats_track",
    description:
      "Job-application ledger (求职台账) tracked per company: applied → written-test → interview → offer (or rejected). action \"scan\" (default) merges auto-detected signals from indexed mail into the ledger — deterministic keyword matching with forward-only progression, never downgrading; signals from freemail senders (qq/gmail/…) are returned as unattributed for you to assign a company via action=update. action \"list\" reads the ledger; action \"update\" applies a manual correction (company, status, note); action \"export\" writes a CSV (company,status,firstSeen,lastSeen,events,note) that office_sheet can aggregate.",
    parameters: {
      action: { type: "string", description: "scan | list | update | export.", enum: ["scan", "list", "update", "export"] },
      company: { type: "string", description: "update: company key, e.g. \"tencent\" (domain core of the recruiting sender)." },
      status: { type: "string", enum: TRACK_STATUSES, description: "update: one of applied, written-test, interview, offer, rejected." },
      note: { type: "string", description: "update: free-text note (position, interviewer, …)." },
      outputPath: { type: "string", description: "export: CSV path (relative to workDir)." },
      workDir: { type: "string", description: "Base directory for export. Prefer absolute paths." }
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: {} },
      render: (_args, value) => [{
        type: "text",
        text: value.summary ?? "Job ledger updated."
      }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const action = args.action ?? "scan";
      if (action === "scan") {
        const res = await scanLedger({ indexPath: defaultIndexPath(), ledgerPath: ledgerPath() });
        return {
          ...res,
          summary: `Job ledger scan: ${res.signals} signal(s) in ${res.scanned} indexed messages, ${res.merged} merged, ${res.unattributed.length} unattributed (freemail senders — assign a company via action=update), ${res.companies.length} compan(y/ies) tracked.`
        };
      }
      if (action === "list") {
        const res = await listLedger({ ledgerPath: ledgerPath() });
        return { ...res, summary: `Job ledger: ${res.companies.length} compan(y/ies), last updated ${res.updatedAt ?? "never"}.` };
      }
      if (action === "update") {
        const res = await updateLedger({ ledgerPath: ledgerPath(), company: args.company, status: args.status, note: args.note });
        return { ...res, summary: `Ledger updated: ${res.company} → ${res.status}${res.note ? ` (${res.note})` : ""}.` };
      }
      if (action === "export") {
        if (!args.outputPath) throw new Error("action=export requires outputPath (.csv)");
        const base = args.workDir && String(args.workDir).trim() !== "" ? args.workDir : process.cwd();
        const file = path.resolve(base, args.outputPath);
        if (!file.toLowerCase().endsWith(".csv")) throw new Error("export outputPath must end with .csv");
        const { companies } = await listLedger({ ledgerPath: ledgerPath() });
        const header = ["company", "status", "firstSeen", "lastSeen", "events", "note"];
        const rows = companies.map((c) => ({
          company: c.company,
          status: c.status,
          firstSeen: c.firstSeen ?? "",
          lastSeen: c.lastSeen ?? "",
          events: c.events.length,
          note: c.note ?? ""
        }));
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await writeTable(file, header, rows);
        return { summary: `Job ledger exported: ${rows.length} rows → ${file}.`, file, rows: rows.length };
      }
      throw new Error(`unknown action "${action}"`);
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Job-application ledger",
      kind: "other",
      rawInput: { action: args.action ?? "scan", company: args.company, status: args.status }
    })
  }));

  // ------------------------------------------------------------------ clean --
  ctx.tools.register(defineTool({
    name: "office_inbox_clean",
    description:
      "Subscription cleanup advisor — OUTPUT ONLY. Aggregates subscription-classified mail into a per-sender frequency table (ranked by count), enriched with the List-Unsubscribe URL when the sender provided one and an actionable advice text per sender. It never unsubscribes, deletes, moves, or sends anything: present the list to the user, and the user decides what to act on (mailbox client, or the unsubscribe URL). Senders below minCount are summarized as counts only.",
    parameters: {
      minCount: { type: "integer", description: "Only advise on senders with at least this many mails in the window (default 3)." },
      daysBack: { type: "integer", description: "Look-back window in days (default 90)." },
      limit: { type: "integer", description: "Max advised senders (default 20)." }
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: {} },
      render: (_args, value) => [{
        type: "text",
        text: `Cleanup advice: ${value.totalSubscriptionMail} subscription mails from ${value.distinctSenders} sender(s) in ${value.windowDays}d (~${value.estimatedMailPerMonth}/month); ${value.actionableSenders} actionable sender(s), ${value.belowThresholdCount} below threshold.`
      }]
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      return buildAdvice({
        indexPath: defaultIndexPath(),
        minCount: Math.max(args.minCount ?? 3, 1),
        limit: Math.max(args.limit ?? 20, 1),
        daysBack: Math.max(args.daysBack ?? 90, 1)
      });
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Subscription cleanup advice",
      kind: "other",
      rawInput: { minCount: args.minCount ?? 3, daysBack: args.daysBack ?? 90 }
    })
  }));
}

export { Config, applyFn as apply, inject, name };
