// End-to-end tests for every @local/dsh-plugin-office tool.
import fsp from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOUNT = process.env.POSTBIRD_TEST_MOUNT
  ? path.resolve(process.env.POSTBIRD_TEST_MOUNT)
  : existsSync(path.join(SOURCE, "node_modules"))
    ? SOURCE
    : path.join(os.homedir(), ".dsh/profiles/web/node_modules/@local/dsh-plugin-office");
const PLUGIN = path.join(MOUNT, "lib/index.js");
const requireFromPlugin = createRequire(pathToFileURL(path.join(MOUNT, "package.json")).href);
const ExcelJS = requireFromPlugin("exceljs");
const { apply, Config } = await import(pathToFileURL(PLUGIN).href);

const tools = [];
const skillProviders = [];
const skillRegistry = {
  registerProvider: (create) => {
    const provider = create({ signal: new AbortController().signal, invalidate: () => {} });
    skillProviders.push(provider);
    return () => {};
  },
};
apply({ tools: { register: (t) => tools.push(t) }, skills: skillRegistry }, Config({}));
const byName = (n) => {
  const t = tools.find((t) => t.name === n);
  if (!t) throw new Error(`tool not registered: ${n}`);
  return t;
};
const mailPreview = byName("office_mail_preview");
const mailSend = byName("office_mail_send");
const docgen = byName("office_docgen");
const sheet = byName("office_sheet");
const exec = { signal: undefined };
let passed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`PASS: ${msg}`); passed++; };

const base = path.join(os.tmpdir(), "officetest");
await fsp.rm(base, { recursive: true, force: true });
await fsp.mkdir(base, { recursive: true });
process.env.DSH_OFFICE_HOME = path.join(base, "postbird-home");

function simplePdf(text) {
  const stream = `BT /F1 16 Tf 72 720 Td (${String(text).replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

// fixtures
await fsp.writeFile(path.join(base, "recipients.csv"),
  "name,email,month,score\nAlice,alice@example.com,September,95\nBob,bob@example.com,September,88\nCarol,carol@example.com,September,76\n", "utf8");
await fsp.writeFile(path.join(base, "employees.csv"),
  "name,department,salary,bonus\nAlice,Engineering,25000,3000\nBob,Engineering,22000,2200\nCarol,Sales,15000,1800\nDave,Sales,17000,1500\nEve,HR,14000,1000\nFrank,Engineering,28000,3500\n", "utf8");

// ── 1. mail regression: preview → draft ──────────────────────────────────
const r1 = await mailPreview.execute({
  subjectTemplate: "{{month}} report for {{name}}",
  bodyTemplate: "Hi {{name}},\n\nYour {{month}} score is {{score}}.",
  recipientsFile: "recipients.csv",
  workDir: base
}, exec);
ok(r1.valid === 3 && r1.invalid === 0, `mail preview 3/3 valid (${r1.previewId})`);
ok(r1.samples[0].subject === "September report for Alice", "mail preview rendered subject");
const r2 = await mailSend.execute({ previewId: r1.previewId, mode: "draft", confirm: true }, exec);
ok(r2.ok === 3 && r2.total === 3, "mail draft wrote 3 .eml files");

// ── 2. docgen single mode ────────────────────────────────────────────────
const blocks = [
  { type: "heading", level: 1, text: "{{title}}" },
  { type: "paragraph", text: "Prepared for {{name}} on {{date}}." },
  { type: "bulletList", items: ["First point about {{name}}", "Second point"] },
  { type: "numberList", items: ["Step one", "Step two"] },
  { type: "table", header: ["Item", "Score"], rows: [["Alpha", "95"], ["Beta", "88"]] },
  { type: "pageBreak" },
  { type: "heading", level: 2, text: "Appendix" },
  { type: "paragraph", text: "End of document." }
];
const r3 = await docgen.execute({
  content: blocks,
  variables: { title: "Quarterly Review", name: "Alice", date: "2026-09-04" },
  outputPath: "reports/single.docx",
  workDir: base
}, exec);
ok(r3.count === 1, "docgen single mode wrote 1 file");
const singlePath = r3.files[0];
const st3 = await fsp.stat(singlePath);
ok(st3.size > 4000, `docx has reasonable size (${st3.size}B)`);
const xml3 = execFileSync("unzip", ["-p", singlePath, "word/document.xml"]).toString();
ok(xml3.includes("Quarterly Review"), "docx contains rendered heading");
ok(xml3.includes("Prepared for Alice"), "docx contains rendered paragraph");
ok(xml3.includes("Alpha"), "docx contains table cell");
ok(!xml3.includes("{{"), "docx has no unrendered placeholders");

// refuse overwrite
let refused = false;
try {
  await docgen.execute({ content: blocks, variables: { title: "x", name: "y", date: "z" }, outputPath: "reports/single.docx", workDir: base }, exec);
} catch (e) { refused = /already exists/.test(e.message); }
ok(refused, "docgen refuses to overwrite without overwrite=true");

// missing variable is a hard error with a precise message
let missingErr = false;
try {
  await docgen.execute({ content: [{ type: "paragraph", text: "Dear {{nickname}}," }], outputPath: "reports/bad.docx", workDir: base }, exec);
} catch (e) { missingErr = /\{\{nickname\}\}/.test(e.message); }
ok(missingErr, "docgen reports missing {{field}} precisely");

// ── 3. docgen batch mode ─────────────────────────────────────────────────
const r4 = await docgen.execute({
  content: [
    { type: "heading", level: 1, text: "Performance letter for {{name}}" },
    { type: "paragraph", text: "Dear {{name}}, your salary is {{salary}}." }
  ],
  dataFile: "employees.csv",
  outputDir: "letters",
  filenameTemplate: "letter_{{name}}.docx",
  workDir: base
}, exec);
ok(r4.count === 6, `docgen batch wrote 6 files (got ${r4.count})`);
const xml4 = execFileSync("unzip", ["-p", path.join(r4.outputDir, "letter_Frank.docx"), "word/document.xml"]).toString();
ok(xml4.includes("your salary is 28000"), "batch docx rendered row data");

// ── 4. sheet inspect ─────────────────────────────────────────────────────
const r5 = await sheet.execute({ file: "employees.csv", action: "inspect", workDir: base }, exec);
ok(r5.rowCount === 6, `sheet inspect rowCount=6 (got ${r5.rowCount})`);
const salaryCol = r5.columns.find((c) => c.column === "salary");
ok(salaryCol.inferredType === "numeric", "sheet inspect infers salary as numeric");
ok(r5.sampleRows.length === 5, "sheet inspect returns sample rows");

// ── 5. sheet filter → csv output, read back ──────────────────────────────
const r6 = await sheet.execute({
  file: "employees.csv", action: "filter", workDir: base,
  filter: { column: "department", op: "eq", value: "Engineering" },
  outputPath: "filtered/eng.csv"
}, exec);
ok(r6.matched === 3, `sheet filter matched 3 (got ${r6.matched})`);
const r6b = await sheet.execute({ file: "filtered/eng.csv", action: "inspect", workDir: base }, exec);
ok(r6b.rowCount === 3, "filtered csv reads back with 3 rows");
const r6c = await sheet.execute({
  file: "employees.csv", action: "filter", workDir: base,
  filter: { column: "salary", op: "gt", value: "16000" },
  outputPath: "filtered/high.csv"
}, exec);
ok(r6c.matched === 4, `numeric gt matched 4 (got ${r6c.matched})`);

// ── 6. sheet aggregate → xlsx output, read back ──────────────────────────
const r7 = await sheet.execute({
  file: "employees.csv", action: "aggregate", workDir: base,
  aggregate: {
    groupBy: ["department"],
    metrics: [
      { fn: "count" },
      { column: "salary", fn: "sum" },
      { column: "bonus", fn: "avg" }
    ]
  },
  outputPath: "agg/departments.xlsx"
}, exec);
ok(r7.groups === 3, `aggregate produced 3 groups (got ${r7.groups})`);
const eng = r7.rows.find((r) => r.department === "Engineering");
ok(eng.count === "3", "Engineering count=3");
ok(eng.sum_salary === "75000", `Engineering sum_salary=75000 (got ${eng.sum_salary})`);
ok(eng.avg_bonus === "2900", `Engineering avg_bonus=2900 (got ${eng.avg_bonus})`);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path.join(base, "agg/departments.xlsx"));
ok(wb.worksheets[0].rowCount === 4, "xlsx aggregate reads back with header+3 rows");

// ── 7. sheet split ───────────────────────────────────────────────────────
const r8 = await sheet.execute({
  file: "employees.csv", action: "split", workDir: base,
  splitBy: "department", outputPrefix: "split/dept"
}, exec);
ok(r8.files.length === 3, `split wrote 3 files (got ${r8.files.length})`);
const r8b = await sheet.execute({ file: "split/dept_Sales.csv", action: "inspect", workDir: base }, exec);
ok(r8b.rowCount === 2, "split Sales file has 2 rows");

// ── 8. unknown column is a precise error ────────────────────────────────
let colErr = false;
try {
  await sheet.execute({ file: "employees.csv", action: "filter", workDir: base, filter: { column: "typo", op: "eq", value: "x" } }, exec);
} catch (e) { colErr = /not found/.test(e.message); }
ok(colErr, "sheet filter rejects unknown column");

// ── 9. pptx single mode ──────────────────────────────────────────────────
const pptxTool = byName("office_pptx");
const templateTool = byName("office_template");
const r9 = await pptxTool.execute({
  content: [
    { type: "title", title: "{{quarter}} Review", subtitle: "Prepared {{date}}" },
    { type: "bullets", title: "Highlights", items: ["Revenue up {{pct}}", "New customers"] },
    { type: "table", title: "Numbers", header: ["Metric", "Value"], rows: [["Growth", "{{pct}}"]] }
  ],
  variables: { quarter: "Q3", date: "2026-09-04", pct: "12%" },
  outputPath: "decks/q3.pptx",
  workDir: base
}, exec);
const listing = execFileSync("unzip", ["-l", r9.files[0]]).toString();
const slideCount = (listing.match(/ppt\/slides\/slide\d+\.xml/g) || []).length;
ok(slideCount === 3, `pptx has 3 slides (got ${slideCount})`);
const s1 = execFileSync("unzip", ["-p", r9.files[0], "ppt/slides/slide1.xml"]).toString();
ok(s1.includes("Q3 Review"), "pptx slide1 contains rendered title");

// ── 10. pptx batch mode ──────────────────────────────────────────────────
const r10 = await pptxTool.execute({
  content: [{ type: "title", title: "{{name}} Team" }],
  data: [{ name: "Alpha" }, { name: "Beta" }],
  outputDir: "decks/batch",
  filenameTemplate: "deck_{{name}}.pptx",
  workDir: base
}, exec);
ok(r10.count === 2, `pptx batch wrote 2 decks (got ${r10.count})`);

// ── 11. template single mode with split-run placeholder ──────────────────
const { Document: TplDocument, Packer: TplPacker, Paragraph: TplParagraph, TextRun: TplTextRun } = requireFromPlugin("docx");
const tplDoc = new TplDocument({
  sections: [{
    children: [
      new TplParagraph({
        children: [
          new TplTextRun("Dear {{"),
          new TplTextRun("name"),
          new TplTextRun("}},")
        ]
      }),
      new TplParagraph({ children: [new TplTextRun("Your salary is {{salary}}.")] })
    ]
  }]
});
const tplBuf = await TplPacker.toBuffer(tplDoc);
await fsp.writeFile(path.join(base, "tpl.docx"), tplBuf);
const r11 = await templateTool.execute({
  templateFile: "tpl.docx",
  variables: { name: "Alice", salary: "25000" },
  outputPath: "filled/alice.docx",
  workDir: base
}, exec);
const xml11 = execFileSync("unzip", ["-p", r11.files[0], "word/document.xml"]).toString();
ok(xml11.includes("Dear Alice,"), "template injected split-run placeholder");
ok(xml11.includes("Your salary is 25000."), "template injected single-run placeholder");
ok(!xml11.includes("{{"), "template output has no leftover placeholders");
ok(r11.tokens.sort().join(",") === "name,salary", `template reports tokens (got ${r11.tokens.join(",")})`);

// ── 12. template batch mode ──────────────────────────────────────────────
const r12 = await templateTool.execute({
  templateFile: "tpl.docx",
  dataFile: "employees.csv",
  outputDir: "filled/batch",
  filenameTemplate: "letter_{{name}}.docx",
  workDir: base
}, exec);
ok(r12.count === 6, `template batch wrote 6 docs (got ${r12.count})`);
const xml12 = execFileSync("unzip", ["-p", path.join(r12.outputDir, "letter_Carol.docx"), "word/document.xml"]).toString();
ok(xml12.includes("Your salary is 15000."), "batch template rendered row data");

// ── 13. template missing token is a precise error ───────────────────────
let tokErr = false;
try {
  await templateTool.execute({
    templateFile: "tpl.docx",
    variables: { name: "Alice" },
    outputPath: "filled/bad.docx",
    workDir: base
  }, exec);
} catch (e) { tokErr = /not provided/.test(e.message) && /\{\{salary\}\}/.test(e.message); }
ok(tokErr, "template reports missing token precisely");

// ── 14. security: attachment path escape is blocked ─────────────────────
await fsp.writeFile(path.join(base, "att.csv"),
  "name,email,att\nMallory,mallory@evil.com,../../../../etc/hosts\nAlice,alice@example.com,ok.txt\n", "utf8");
await fsp.writeFile(path.join(base, "ok.txt"), "fine", "utf8");
const r14 = await mailPreview.execute({
  subjectTemplate: "doc for {{name}}",
  bodyTemplate: "hi {{name}}",
  recipientsFile: "att.csv",
  attachmentColumn: "att",
  workDir: base
}, exec);
ok(r14.invalid === 1, `attachment path escape blocked (invalid=${r14.invalid})`);
ok(r14.problems.some((p) => /escapes workDir/.test(p)), "escape problem is explicit");

// ── 15. security: CRLF header injection is neutralized ──────────────────
const r15 = await mailPreview.execute({
  subjectTemplate: "{{inj}} report",
  bodyTemplate: "hi",
  nameColumn: "name",
  recipients: [{ name: "Alice\nBcc: evil@evil.com", email: "alice@example.com", inj: "Sept\nBcc: evil@evil.com" }],
  workDir: base
}, exec);
ok(r15.valid === 1, "injection row is sanitized, not dropped");
const rec15 = JSON.parse(await fsp.readFile(
  path.join(process.env.DSH_OFFICE_HOME, "mail", "previews", `${r15.previewId}.json`), "utf8"));
ok(!/[\r\n]/.test(rec15.rows[0].subject), "subject has no CR/LF after sanitize");
ok(!/[\r\n]/.test(rec15.rows[0].to), "To header (display name) has no CR/LF after sanitize");

// ── 16. security: duplicate recipients + domain allowlist ───────────────
const r16 = await mailPreview.execute({
  subjectTemplate: "s",
  bodyTemplate: "b",
  recipients: [{ email: "dup@example.com" }, { email: "dup@example.com" }],
  workDir: base
}, exec);
ok(r16.invalid === 1 && r16.problems.some((p) => /duplicate/.test(p)), "duplicate address flagged");

const tools2 = [];
apply({ tools: { register: (t) => tools2.push(t) } }, Config({ allowDomains: ["qq.com"] }));
const preview2 = tools2.find((t) => t.name === "office_mail_preview");
const r16b = await preview2.execute({
  subjectTemplate: "s", bodyTemplate: "b",
  recipients: [{ email: "someone@qq.com" }, { email: "someone@gmail.com" }],
  workDir: base
}, exec);
ok(r16b.invalid === 1 && r16b.problems.some((p) => /allowDomains/.test(p)), "domain allowlist blocks foreign domain");

// ── 17. security: rolling-24h send cap ──────────────────────────────────
const mailDir = path.join(process.env.DSH_OFFICE_HOME, "mail");
await fsp.mkdir(mailDir, { recursive: true });
const now = new Date().toISOString();
await fsp.writeFile(path.join(mailDir, "sent-log.jsonl"),
  `${JSON.stringify({ ts: now, mode: "send", ok: true })}\n${JSON.stringify({ ts: now, mode: "send", ok: true })}\n`, "utf8");
const tools3 = [];
apply({ tools: { register: (t) => tools3.push(t) } }, Config({
  smtpHost: "smtp.example.com", smtpUser: "u", smtpPass: "p", fromAddress: "u@example.com",
  dailySendCap: 3
}));
const preview3 = tools3.find((t) => t.name === "office_mail_preview");
const send3 = tools3.find((t) => t.name === "office_mail_send");
const r17p = await preview3.execute({
  subjectTemplate: "s", bodyTemplate: "b",
  recipients: [{ email: "a@example.com" }, { email: "b@example.com" }],
  workDir: base
}, exec);
let capErr = false;
try {
  await send3.execute({ previewId: r17p.previewId, mode: "send", confirm: true }, exec);
} catch (e) { capErr = /daily send cap/.test(e.message); }
ok(capErr, "rolling-24h send cap blocks the batch (2 recent + 2 batch > cap 3)");

// ── 18. security: pptx imagePath escape is blocked ──────────────────────
let imgErr = false;
try {
  await pptxTool.execute({
    content: [{ type: "image", imagePath: "../../etc/hosts" }],
    outputPath: "decks/escape.pptx",
    workDir: base
  }, exec);
} catch (e) { imgErr = /escapes workDir/.test(e.message); }
ok(imgErr, "pptx imagePath escape blocked");

let unsafeImageErr = false;
try {
  await pptxTool.execute({
    content: [{ type: "image", imagePath: "crafted.icns" }],
    outputPath: "decks/unsafe-image.pptx",
    workDir: base
  }, exec);
} catch (e) { unsafeImageErr = /unsupported image type/.test(e.message); }
ok(unsafeImageErr, "pptx rejects unsupported image parsers before reading the file");

// ── 19. inbox: IMAP presets and config errors ───────────────────────────
const inboxLib = await import(pathToFileURL(path.join(MOUNT, "lib/inbox.js")).href);
const imapOk = inboxLib.resolveImap({ imapUser: "a@qq.com", imapPass: "pw", imapPort: 993 });
ok(imapOk.host === "imap.qq.com" && imapOk.port === 993 && imapOk.user === "a@qq.com", "qq.com preset resolves to imap.qq.com");
ok(inboxLib.resolveImap({ imapUser: "a@gmail.com", imapPass: "pw" }).host === "imap.gmail.com", "gmail preset resolves");
ok(inboxLib.resolveImap({ imapUser: "a@foxmail.com", imapPass: "pw" }).host === "imap.qq.com", "foxmail preset maps to imap.qq.com");
const inboxFetch = byName("office_inbox_fetch");
const inboxTriage = byName("office_inbox_triage");
let imapCfgErr = false;
try {
  await inboxFetch.execute({ limit: 10 }, exec);
} catch (e) { imapCfgErr = /IMAP is not configured/.test(e.message) && /authorization code|授权码/.test(e.message); }
ok(imapCfgErr, "fetch without imapUser fails with the authorization-code hint");
process.env.DSH_IMAP_PASS = "pw";
const tools4 = [];
apply({ tools: { register: (t) => tools4.push(t) } }, Config({ imapUser: "a@example.org", imapPassEnv: "DSH_IMAP_PASS" }));
let presetErr = false;
try {
  await tools4.find((t) => t.name === "office_inbox_fetch").execute({ limit: 10 }, exec);
} catch (e) { presetErr = /no IMAP preset/.test(e.message) && /imapHost/.test(e.message); }
ok(presetErr, "unknown domain asks for explicit imapHost");

// ── 20. inbox: deterministic classification rules ───────────────────────
const msg = (over) => ({
  uid: 1, mailbox: "INBOX", messageId: "m1@x", date: new Date().toISOString(),
  from: { address: "someone@example.com", name: "" }, fromDomain: "example.com",
  subject: "", snippet: "", attachments: [], headers: {}, seen: false,
  fetchedAt: new Date().toISOString(), ...over
});
const cl = (m) => inboxLib.classifyMessage(m);
ok(cl(msg({ headers: { listUnsubscribe: true } })).category === "subscription", "list-unsubscribe header → subscription");
ok(cl(msg({ from: { address: "noreply@service.com", name: "" }, fromDomain: "service.com" })).category === "subscription", "no-reply local part → subscription");
ok(cl(msg({ from: { address: "x@github.com", name: "" }, fromDomain: "github.com" })).category === "subscription", "known bulk domain → subscription");
ok(cl(msg({ subject: "面试通知：请回复确认时间" })).category === "todo", "interview keyword → todo");
ok(cl(msg({ subject: "您的验证码是 123456" })).category === "todo", "verification code → todo");
ok(cl(msg({ subject: "关于2026年国庆放假安排的通知" })).category === "notice", "notice keyword → notice");
ok(cl(msg({ from: { address: "jwc@zju.edu.cn", name: "" }, fromDomain: "zju.edu.cn", subject: "本学期注册安排" })).category === "notice", ".edu.cn sender → notice");
ok(cl(msg({ subject: "Re: 论文修改意见" })).category === "personal", "reply subject → personal");
ok(cl(msg({ subject: "周末爬山吗" })).confidence === "low", "no rule match → personal low confidence");
const both = cl(msg({ subject: "讲座报名截止周五" }));
ok(both.category === "todo", "todo beats notice when both match");

// ── 21. inbox: index append + dedup ─────────────────────────────────────
const idxFile = path.join(base, "index.jsonl");
const entries = [
  msg({ uid: 1, messageId: "a@x" }),
  msg({ uid: 2, messageId: "b@x" })
];
const w1 = await inboxLib.appendIndex(entries, idxFile);
ok(w1.appended === 2 && w1.skippedDuplicates === 0, "index appends 2 new messages");
const w2 = await inboxLib.appendIndex([entries[0], msg({ uid: 3, messageId: "c@x" })], idxFile);
ok(w2.appended === 1 && w2.skippedDuplicates === 1, "index skips the duplicate messageId");
ok((await inboxLib.loadIndex(idxFile)).length === 3, "index reads back 3 entries");

// ── 22. inbox: triage over the shared index (isolated office home) ──────
const offHome = path.join(base, "offhome");
process.env.DSH_OFFICE_HOME = offHome;
const nowTs = new Date().toISOString();
const fixtures = [
  msg({ uid: 1, messageId: "t1@x", from: { address: "hr@tencent.com", name: "Tencent HR" }, fromDomain: "tencent.com", subject: "面试邀请：请回复确认时间" }),
  msg({ uid: 2, messageId: "t2@x", from: { address: "noreply@github.com", name: "GitHub" }, fromDomain: "github.com", subject: "[repo] PR merged" }),
  msg({ uid: 3, messageId: "t3@x", from: { address: "jwc@zju.edu.cn", name: "教务处" }, fromDomain: "zju.edu.cn", subject: "关于国庆放假安排的通知" }),
  msg({ uid: 4, messageId: "t4@x", from: { address: "prof@zju.edu.cn", name: "" }, fromDomain: "zju.edu.cn", subject: "Re: 论文修改意见" }),
  msg({ uid: 5, messageId: "t5@x", from: { address: "friend@qq.com", name: "" }, fromDomain: "qq.com", subject: "周末爬山吗", date: nowTs }),
  msg({ uid: 6, messageId: "t6@x", from: { address: "news@substack.com", name: "" }, fromDomain: "substack.com", subject: "Weekly digest", headers: { listUnsubscribe: true } })
];
const w3 = await inboxLib.appendIndex(fixtures, inboxLib.defaultIndexPath());
ok(w3.appended === 6, "fixtures indexed into isolated office home");
const r22 = await inboxTriage.execute({ sinceHours: 24, limit: 100 }, exec);
ok(r22.total === 6, `triage saw 6 messages (got ${r22.total})`);
ok(r22.counts.todo === 1 && r22.counts.notice === 1 && r22.counts.subscription === 2 && r22.counts.personal === 2,
  `triage buckets 1/1/2/2 (got ${r22.counts.todo}/${r22.counts.notice}/${r22.counts.subscription}/${r22.counts.personal})`);
ok(r22.todo[0].subject.includes("面试邀请") && r22.todo[0].evidence.length > 0, "todo carries evidence");
ok(r22.subscriptionSenders.length === 2 && r22.subscriptionSenders.every((s) => s.count >= 1), "subscription sender table aggregates");
ok(r22.needsReview.length === 2, `low/medium-confidence items flagged for review (got ${r22.needsReview.length})`);
await inboxLib.appendIndex(
  [msg({ uid: 7, messageId: "t7@x", from: { address: "old@qq.com", name: "" }, fromDomain: "qq.com", subject: "五小时前的旧邮件", date: new Date(Date.now() - 5 * 3600_000).toISOString() })],
  inboxLib.defaultIndexPath()
);
const oldTri = await inboxTriage.execute({ sinceHours: 1, limit: 100 }, exec);
ok(oldTri.total === 6, `sinceHours window filters old messages (got ${oldTri.total})`);
// ── 23. archive: local search filters ───────────────────────────────────
const archiveLib = await import(pathToFileURL(path.join(MOUNT, "lib/archive.js")).href);
const archiveSearch = byName("office_archive_search");
await inboxLib.appendIndex(
  [
    msg({
      uid: 8, messageId: "t8@x", from: { address: "hr@qq.com", name: "" }, fromDomain: "qq.com",
      subject: "您的简历已收到，我们近期安排面试", attachments: [{ filename: "resume.pdf", size: 100, contentType: "application/pdf" }]
    }),
    msg({
      uid: 9, messageId: "t9@x", from: { address: "campus@example-corp.com", name: "" }, fromDomain: "example-corp.com",
      subject: "您的简历已收到，进入笔试环节"
    }),
    msg({
      uid: 10, messageId: "t10@x", from: { address: "digest@substack.com", name: "" }, fromDomain: "substack.com",
      subject: "Daily digest", headers: { listUnsubscribe: true, listUnsubscribeUrl: "<https://sub.example.com/u?x=1>" }
    }),
    msg({
      uid: 11, messageId: "t11@x", from: { address: "prof@zju.edu.cn", name: "王教授" }, fromDomain: "zju.edu.cn",
      subject: "论文修改意见", snippet: "请于明天回复确认，并修改第二章。", attachments: [{ filename: "comments.docx", size: 1200, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }]
    }),
    msg({
      uid: 12, messageId: "t12@x", from: { address: "prof@zju.edu.cn", name: "王教授" }, fromDomain: "zju.edu.cn",
      subject: "Re: 论文修改意见", snippet: "请同时提交实验结果，并在回复中说明完成时间。"
    })
  ],
  inboxLib.defaultIndexPath()
);
const s23a = await archiveSearch.execute({ from: "tencent" }, exec);
ok(s23a.matched === 1 && s23a.items[0].category === "todo", "search by sender substring + category");
const s23b = await archiveSearch.execute({ hasAttachment: true }, exec);
ok(s23b.matched === 2 && s23b.items.some((item) => item.attachments.includes("resume.pdf")), "search hasAttachment=true finds indexed attachment mail");
const s23c = await archiveSearch.execute({ category: "subscription" }, exec);
ok(s23c.matched === 3, `search category=subscription finds 3 (got ${s23c.matched})`);
const s23d = await archiveSearch.execute({ subject: "论文" }, exec);
ok(s23d.matched === 3 && s23d.items.every((item) => item.subject.includes("论文修改意见")), "search by subject keyword");
const s23e = await archiveSearch.execute({ from: "nomatch" }, exec);
ok(s23e.matched === 0 && s23e.returned === 0, "search with no hits returns empty");

// ── 24. daily brief, action radar, and context-aware reply ──────────────
const workflowLib = await import(pathToFileURL(path.join(MOUNT, "lib/workflow.js")).href);
const fixedNow = new Date("2026-09-07T09:00:00+08:00");
const fixedDeadline = workflowLib.extractDeadline("请于2026年9月8日前提交材料", fixedNow);
ok(fixedDeadline?.date.startsWith("2026-09-08"), "action radar parses an explicit Chinese deadline");
const relativeDeadline = workflowLib.extractDeadline("请明天回复确认", fixedNow);
ok(new Date(relativeDeadline.date).getDate() === 8, "action radar parses a relative deadline");
ok(workflowLib.normalizeThreadSubject("Re: 回复：论文修改意见") === "论文修改意见", "thread subjects normalize nested reply prefixes");

const dailyBrief = byName("office_daily_brief");
const actionRadar = byName("office_action_radar");
const contextReply = byName("office_context_reply");
const r24a = await dailyBrief.execute({ sinceHours: 24, horizonDays: 7, focusLimit: 3 }, exec);
ok(r24a.totalMessages >= 11 && r24a.focus.length === 3, "daily brief ranks a bounded focus list");
ok(typeof r24a.headline === "string" && r24a.safety.includes("未发送"), "daily brief explains result and safety boundary");
const r24b = await actionRadar.execute({ sinceHours: 24, horizonDays: 14, limit: 20 }, exec);
ok(r24b.actions.some((item) => item.uid === 11 && item.actionType === "reply"), "action radar extracts reply work from a professor email");
ok(r24b.actions.every((item) => item.evidence.length > 0), "every action carries evidence");
const r24c = await contextReply.execute({ uid: 11, replyPoints: ["周三完成第二章修改", "周五补充实验结果"] }, exec);
ok(r24c.threadLength >= 3 && r24c.drafts.length === 3, "context reply groups the thread and creates three tones");
ok(r24c.target.to === "prof@zju.edu.cn" && r24c.requiresUserReview === true, "context reply targets the sender and requires review");
ok(r24c.drafts.every((draft) => draft.body.includes("第二章")), "reply drafts preserve user-provided facts");
let missingReplyTarget = false;
try {
  await contextReply.execute({}, exec);
} catch (error) { missingReplyTarget = /uid or messageId/.test(error.message); }
ok(missingReplyTarget, "context reply requires an explicit target message");

// ── 25. grounded thread, action, and selected-tone reply tools ─────────
ok(tools.filter((tool) => tool.name.startsWith("office_")).length === 22, "all 22 model-facing tools are registered");
const threadSummary = byName("office_thread_summary");
const actionExtract = byName("office_action_extract");
const replyDraft = byName("office_reply_draft");
const r25a = await threadSummary.execute({ uid: 11, contextMode: "indexed" }, exec);
ok(r25a.messageCount >= 3 && r25a.contextSource === "local-index-snippets", "thread summary groups indexed context");
ok(r25a.timeline.every((item) => item.citation.startsWith("mail:")), "thread timeline carries source citations");
ok(r25a.questions.length > 0 && r25a.attachments.some((item) => item.filename === "comments.docx"), "thread summary surfaces questions and attachments");
const r25b = await actionExtract.execute({
  subject: "奖学金通知",
  text: "请于2026年9月8日前提交成绩单和申请表，并回复辅导员确认。"
}, exec);
ok(r25b.scope === "inline-text" && r25b.actions.length > 0, "action extract handles pasted notice text");
ok(r25b.actions.every((item) => item.citation === "mail:inline-input"), "pasted actions retain an explicit source citation");
const r25c = await replyDraft.execute({
  uid: 11,
  tone: "formal",
  replyPoints: ["周三完成第二章修改", "周五补充实验结果"]
}, exec);
ok(r25c.selectedTone === "formal" && r25c.draft.body.includes("第二章"), "reply draft selects tone and preserves confirmed facts");
ok(r25c.requiresUserReview === true && /confirm:true/.test(r25c.nextStep), "reply draft preserves preview and confirmation boundary");

// ── 26. collection tracking with evidence, correction, and export ─────
await inboxLib.appendIndex([
  msg({
    uid: 13, messageId: "alice-scholarship@x", from: { address: "alice@example.com", name: "Alice" },
    subject: "奖学金材料提交", snippet: "提交成绩单和申请表。",
    attachments: [{ filename: "成绩单.pdf" }, { filename: "申请表.docx" }]
  }),
  msg({
    uid: 14, messageId: "bob-scholarship@x", from: { address: "bob@example.com", name: "Bob" },
    subject: "奖学金材料提交", snippet: "先提交申请表，另一项材料稍后补充。",
    attachments: [{ filename: "申请表.docx" }]
  }),
  msg({
    uid: 15, messageId: "dave-scholarship@x", from: { address: "dave@example.com", name: "Dave" },
    subject: "奖学金材料提交", snippet: "提交申请表和成绩单。",
    attachments: [{ filename: "申请表.docx" }, { filename: "成绩单.pdf" }]
  }),
  msg({
    uid: 16, messageId: "chenyu-club-1@x", from: { address: "chenyu@example.edu", name: "陈雨" },
    subject: "天文社招新报名", snippet: "提交报名表和个人陈述。",
    attachments: [{ filename: "报名表.docx" }, { filename: "个人陈述.pdf" }]
  }),
  msg({
    uid: 17, messageId: "chenyu-club-2@x", from: { address: "chenyu@example.edu", name: "陈雨" },
    subject: "天文社招新报名 补充材料", snippet: "补充可参加时间表。",
    attachments: [{ filename: "时间表.xlsx" }]
  }),
  msg({
    uid: 18, messageId: "liming-club@x", from: { address: "liming@example.edu", name: "李明" },
    subject: "天文社招新报名", snippet: "先提交报名表。",
    attachments: [{ filename: "报名表.docx" }]
  })
], inboxLib.defaultIndexPath());
const collectionTrack = byName("office_collection_track");
const collectionScan = await collectionTrack.execute({
  action: "scan", collectionId: "scholarship-2026", title: "2026 奖学金材料",
  subjectKeyword: "奖学金", requiredItems: ["成绩单|transcript", "申请表|application"],
  participants: [
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" },
    { name: "Carol", email: "carol@example.com" }
  ]
}, exec);
ok(collectionScan.counts.complete === 1 && collectionScan.counts.partial === 1 && collectionScan.counts.pending === 1, "collection scan separates complete, partial, and pending participants");
ok(collectionScan.participants.find((person) => person.email === "alice@example.com").evidence[0].citation.startsWith("mail:"), "collection status links to source mail");
ok(collectionScan.unmatchedSubmissions.some((person) => person.email === "dave@example.com"), "roster collection reports submissions from people outside the expected list");
const collectionUpdate = await collectionTrack.execute({
  action: "update", collectionId: "scholarship-2026", participantEmail: "carol@example.com",
  status: "exempt", note: "本学期休学，经人工确认免交"
}, exec);
ok(collectionUpdate.counts.exempt === 1 && collectionUpdate.updated.note.includes("人工确认"), "collection tracker preserves a human correction and note");
const collectionExport = await collectionTrack.execute({
  action: "export", collectionId: "scholarship-2026", outputPath: "collections/scholarship.xlsx", workDir: base
}, exec);
ok(collectionExport.rows === 3 && existsSync(collectionExport.file), "collection ledger exports to XLSX");
const collectionBook = new ExcelJS.Workbook();
await collectionBook.xlsx.readFile(collectionExport.file);
ok(collectionBook.worksheets[0].rowCount === 4, "collection workbook contains header and three participants");
const openRegistration = await collectionTrack.execute({
  action: "scan", collectionId: "astronomy-club-2026", title: "天文社招新报名",
  participantMode: "discover", subjectKeyword: "天文社招新报名",
  requiredItems: ["报名表|application", "个人陈述|statement"]
}, exec);
ok(openRegistration.participantMode === "discover" && openRegistration.totalParticipants === 2, "open registration discovers participants from matching mail without a roster");
ok(openRegistration.counts.complete === 1 && openRegistration.counts.partial === 1, "open registration checks required materials for discovered participants");
ok(openRegistration.resubmissions.length === 1 && openRegistration.resubmissions[0].email === "chenyu@example.edu", "open registration flags repeat submissions for review");
let unscopedDiscoveryBlocked = false;
try {
  await collectionTrack.execute({
    action: "scan", collectionId: "unscoped-open-registration", participantMode: "discover"
  }, exec);
} catch (error) { unscopedDiscoveryBlocked = /subjectKeyword is required/.test(error.message); }
ok(unscopedDiscoveryBlocked, "open registration requires a subject scope before discovering inbox participants");

// ── 27. attachment evidence across Office and PDF formats ──────────────
const attachmentAsk = byName("office_attachment_ask");
const attachmentDocx = await attachmentAsk.execute({ file: path.relative(base, singlePath), query: "Quarterly Review", workDir: base }, exec);
ok(attachmentDocx.evidence.some((item) => /paragraph-1/.test(item.citation)), "Word evidence cites the paragraph");
const attachmentPptx = await attachmentAsk.execute({ file: path.relative(base, r9.files[0]), query: "Highlights", workDir: base }, exec);
ok(attachmentPptx.evidence.some((item) => /slide-2/.test(item.citation)), "PowerPoint evidence cites the slide");
const attachmentXlsx = await attachmentAsk.execute({ file: "agg/departments.xlsx", query: "Engineering", workDir: base }, exec);
ok(attachmentXlsx.evidence.some((item) => /!2$/.test(item.citation)), "Excel evidence cites the sheet and row");
await fsp.writeFile(path.join(base, "deadline.pdf"), simplePdf("Scholarship deadline Friday"));
const attachmentPdf = await attachmentAsk.execute({ file: "deadline.pdf", query: "scholarship deadline", workDir: base }, exec);
ok(attachmentPdf.evidence.some((item) => /page-1/.test(item.citation)), "PDF evidence cites the page");
let attachmentEscape = false;
try {
  await attachmentAsk.execute({ file: "../../etc/hosts", query: "host", workDir: base }, exec);
} catch (error) { attachmentEscape = /escapes workDir/.test(error.message); }
ok(attachmentEscape, "attachment reader blocks paths outside workDir");

// ── 28. archive: export/attach guardrails (no IMAP in tests) ────────────
const archiveExport = byName("office_archive_export");
const archiveAttach = byName("office_archive_attach");
let escErr = false;
try {
  await archiveExport.execute({ outputDir: "../../tmp/escape", workDir: base }, exec);
} catch (e) { escErr = /escapes workDir/.test(e.message); }
ok(escErr, "archive export outputDir escape blocked");
let escErr2 = false;
try {
  await archiveAttach.execute({ outputDir: "../../tmp/escape", workDir: base }, exec);
} catch (e) { escErr2 = /escapes workDir/.test(e.message); }
ok(escErr2, "archive attach outputDir escape blocked");
let imapErr2 = false;
try {
  await archiveExport.execute({ outputDir: "exports", workDir: base }, exec);
} catch (e) { imapErr2 = /IMAP is not configured/.test(e.message); }
ok(imapErr2, "archive export without IMAP config fails with a clear message");
const usedNames = new Set();
const ef1 = archiveLib.emlFilename(fixtures[0], usedNames);
const ef2 = archiveLib.emlFilename(fixtures[0], usedNames);
ok(ef1 !== ef2 && ef2.includes("_2"), "eml filename dedup adds a suffix");

// ── 29. stats: overview from index + send audit log ─────────────────────
const statsTool = byName("office_stats_overview");
await fsp.mkdir(path.join(offHome, "mail"), { recursive: true });
await fsp.appendFile(
  path.join(offHome, "mail", "sent-log.jsonl"),
  [
    { ts: new Date().toISOString(), mode: "send", to: "alice@qq.com", subject: "s1", ok: true },
    { ts: new Date().toISOString(), mode: "send", to: "bob@qq.com", subject: "s2", ok: true },
    { ts: new Date().toISOString(), mode: "send", to: "carol@qq.com", subject: "s3", ok: false, error: "boom" }
  ].map((e) => JSON.stringify(e)).join("\n") + "\n",
  "utf8"
);
const r25 = await statsTool.execute({ monthsBack: 6 }, exec);
ok(r25.sentCount === 2 && r25.sendFailedCount === 1, `overview counts sent/failed (got ${r25.sentCount}/${r25.sendFailedCount})`);
ok(r25.receivedCount >= 10, `overview counts received from the index (got ${r25.receivedCount})`);
ok(r25.byMonth.length >= 1 && r25.byMonth[0].received > 0, "overview builds a monthly trend");
ok(r25.topSenders.some((s) => s.from === "prof@zju.edu.cn"), "overview lists top senders");
ok(r25.topRecipients.some((s) => s.to === "alice@qq.com"), "overview lists top recipients");
ok(r25.subscriptionShare > 0 && r25.subscriptionShare <= 1, "overview computes subscription share");

// ── 30. stats: job-application ledger ───────────────────────────────────
const trackTool = byName("office_stats_track");
const r26a = await trackTool.execute({ action: "scan" }, exec);
const tencent = r26a.companies.find((c) => c.company === "tencent");
ok(tencent && tencent.status === "interview", "scan attributes interview@tencent.com to company tencent");
ok(r26a.companies.some((c) => c.company === "example-corp" && c.status === "written-test"), "scan detects written-test stage");
ok(r26a.unattributed.some((u) => u.from === "hr@qq.com"), "freemail recruiting mail lands in unattributed");
const r26b = await trackTool.execute({ action: "scan" }, exec);
ok(r26b.merged === 0, "re-scan merges nothing (messageId dedup)");
await trackTool.execute({ action: "update", company: "tencent", status: "offer", note: "SP offer, 11 月入职" }, exec);
const r26c = await trackTool.execute({ action: "scan" }, exec);
ok(r26c.companies.find((c) => c.company === "tencent").status === "offer", "auto scan never downgrades a manual offer");
let badStatus = false;
let badStatusMsg = "";
try {
  await trackTool.execute({ action: "update", company: "x", status: "ghosted" }, exec);
} catch (e) { badStatus = /status/i.test(e.message); badStatusMsg = e.message.slice(0, 80); }
ok(badStatus, `manual update rejects an unknown status (${badStatusMsg})`);
const trackCsv = path.join(base, "track.csv");
const r26d = await trackTool.execute({ action: "export", outputPath: "track.csv", workDir: base }, exec);
ok(r26d.rows >= 2, `ledger exports to CSV (got ${r26d.rows} rows)`);
const trackCsvText = await fsp.readFile(trackCsv, "utf8");
ok(trackCsvText.includes("tencent") && trackCsvText.includes("offer"), "exported CSV carries company + status");
const r26e = await trackTool.execute({ action: "list" }, exec);
ok(r26e.companies.length === r26d.rows, "list matches the export row count");

// ── 31. clean: subscription cleanup advisor ─────────────────────────────
const cleanTool = byName("office_inbox_clean");
const r27a = await cleanTool.execute({ minCount: 1, daysBack: 90, limit: 20 }, exec);
ok(r27a.distinctSenders === 3 && r27a.actionableSenders === 3, `advisor aggregates 3 bulk senders (got ${r27a.distinctSenders}/${r27a.actionableSenders})`);
const withUrl = r27a.items.find((i) => i.sender === "digest@substack.com");
ok(withUrl && withUrl.unsubscribe.available === true && withUrl.unsubscribe.url.includes("sub.example.com"), "advisor surfaces the List-Unsubscribe URL");
ok(r27a.items.every((i) => typeof i.advice === "string" && i.advice.length > 0), "every advised sender carries advice text");
ok(r27a.estimatedMailPerMonth > 0, "advisor estimates monthly subscription volume");
const r27b = await cleanTool.execute({ minCount: 5, daysBack: 90 }, exec);
ok(r27b.actionableSenders === 0 && r27b.belowThresholdCount === 3, "minCount threshold filters one-off senders");

// ── 32. skills: the bundled Agent Skills reach DSH's skill registry ────────
ok(skillProviders.length === 1, `one skill provider is registered (got ${skillProviders.length})`);
const skillProvider = skillProviders[0];
ok(skillProvider.name === "postbird", `provider is named postbird (got ${skillProvider.name})`);
const skillCandidates = await skillProvider.list();
const skillNames = skillCandidates.map((c) => c.name).sort();
ok(
  ["postbird-action", "postbird-campus-office", "postbird-delivery", "postbird-evidence"].every((n) =>
    skillNames.includes(n)
  ),
  `all four Chinese skills are offered (got ${skillNames.join(", ")})`,
);
ok(
  skillCandidates.every((c) => c.path.includes("skills-zh")),
  "the DSH Chinese skills take precedence over the English originals"
);
const skillDefinition = await skillProvider.get(skillCandidates[0]);
ok(
  typeof skillDefinition.content === "string" && skillDefinition.content.length > 100,
  "a skill body loads on demand"
);

delete process.env.DSH_OFFICE_HOME;
delete process.env.DSH_IMAP_PASS;

console.log(`\nAll ${passed} checks passed.`);
