// Real DSH registries and native tool execution; SMTP stays on loopback.
// DSH_RUNTIME_ROOT=/path/to/@deepseek-ai/dsh npm run test:dsh-mail
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { pathToFileURL } from "node:url";

if (!process.env.DSH_RUNTIME_ROOT) throw new Error("Set DSH_RUNTIME_ROOT to the installed @deepseek-ai/dsh package directory");
const load = (name) => import(pathToFileURL(path.join(process.env.DSH_RUNTIME_ROOT, "node_modules/@deepseek-ai", name, "lib/index.js")).href);
const [{ Context }, { default: SystemPrompt }, { default: ToolRuntime }, { default: SkillRegistry }] =
  await Promise.all([load("cordis"), load("dsh-system-prompt"), load("dsh-tools"), load("dsh-skill")]);
const root = await fsp.mkdtemp(path.join(os.tmpdir(), "postbird-dsh-mail-"));
process.env.DSH_OFFICE_HOME = root;
const plugin = await import("../lib/index.js");
const messages = [];
let onQueued;
const sockets = new Set();
const server = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => {});
  socket.setEncoding("utf8");
  socket.write("220 localhost Postbird test SMTP\r\n");
  let pending = "", data = false, lines = [];
  socket.on("data", (chunk) => {
    pending += chunk;
    while (pending.includes("\r\n")) {
      const at = pending.indexOf("\r\n");
      const line = pending.slice(0, at); pending = pending.slice(at + 2);
      if (data) {
        if (line === ".") { messages.push(lines.join("\r\n")); lines = []; data = false; socket.write("250 queued locally\r\n"); onQueued?.(); }
        else lines.push(line);
      } else if (/^EHLO/i.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
      else if (/^AUTH PLAIN/i.test(line)) socket.write("235 authenticated\r\n");
      else if (/^RCPT TO:.*reject@/i.test(line)) socket.write("550 recipient rejected by test fixture\r\n");
      else if (/^DATA$/i.test(line)) { data = true; socket.write("354 send data\r\n"); }
      else if (/^QUIT$/i.test(line)) socket.end("221 bye\r\n");
      else socket.write("250 OK\r\n");
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const ctx = new Context();
const fibers = [];
let callId = 0;
const call = (name, args, signal = new AbortController().signal) => ctx.tools.execute({ callId: `mail-${++callId}`, name, arguments: args, signal });
const textOf = (result) => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
const preview = async (args) => {
  const result = await call("office_mail_preview", args);
  assert.equal(result.isError, false, textOf(result));
  return result;
};
try {
  for (const service of [SystemPrompt, ToolRuntime, SkillRegistry]) fibers.push(ctx.plugin(service, {}));
  fibers.push(ctx.plugin(plugin, {
    smtpHost: "127.0.0.1", smtpPort: server.address().port, smtpSecure: false,
    smtpUser: "test@example.invalid", smtpPass: "fixture-only", fromAddress: "test@example.invalid", sendIntervalMs: 0
  }));
  await Promise.all(fibers.map((fiber) => fiber.await()));
  assert.equal(ctx.tools.schemas().filter((tool) => tool.name.startsWith("office_")).length, 22);
  assert.equal((await ctx.skills.list()).filter((skill) => skill.provider === "postbird").length, 4);

  const attachment = path.join(root, "测试附件.txt");
  await fsp.writeFile(attachment, "attachment fixture");
  const single = await preview({ to: "recipient@example.invalid", subject: "Literal {{subject}}", body: "Keep {{body}} intact", attachments: [attachment], workDir: root });
  for (const value of ["recipient@example.invalid", "Literal {{subject}}", "Keep {{body}} intact", "测试附件.txt", "尚未发送", "test@example.invalid"]) assert.ok(textOf(single).includes(value), value);
  const id = single.value.previewId;
  const unconfirmed = await call("office_mail_send", { previewId: id, mode: "send", confirm: false });
  assert.equal(unconfirmed.isError, true);
  assert.equal(messages.length, 0);

  const draft = await call("office_mail_send", { previewId: id, mode: "draft", confirm: true });
  assert.equal(draft.isError, false, textOf(draft));
  assert.ok(textOf(draft).includes("尚未发送"));
  await fsp.access(draft.value.results[0].eml);
  assert.equal(messages.length, 0);

  const sent = await call("office_mail_send", { previewId: id, mode: "send", confirm: true });
  assert.equal(sent.isError, false, textOf(sent));
  assert.equal(sent.value.ok, 1);
  assert.equal(messages.length, 1);
  assert.ok(textOf(sent).includes("Message-ID:"));
  assert.ok(textOf(sent).includes("SMTP 已接受"));
  const duplicate = await call("office_mail_send", { previewId: id, mode: "send", confirm: true });
  assert.equal(duplicate.isError, true);
  assert.equal(messages.length, 1);

  const partial = await preview({ recipients: [{ email: "ok@example.invalid" }, { email: "reject@example.invalid" }], subject: "Partial", body: "Test" });
  const partialSend = await call("office_mail_send", { previewId: partial.value.previewId, mode: "send", confirm: true });
  assert.equal(partialSend.isError, false, textOf(partialSend));
  assert.equal(partialSend.value.ok, 1);
  assert.equal(partialSend.value.failed, 1);
  assert.match(textOf(partialSend), /reject@example.invalid.*失败/);
  assert.match(textOf(partialSend), /550/);
  const log = (await fsp.readFile(path.join(root, "mail/sent-log.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(log.filter((row) => row.mode === "send" && row.ok).length, 2);
  assert.equal(log.filter((row) => row.mode === "send" && !row.ok).length, 1);

  const fullBody = "完整正文".repeat(400);
  const long = await preview({ to: "recipient@example.invalid", subject: "Long body", body: fullBody, maxSamples: 0 });
  assert.ok(textOf(long).includes(fullBody), "native preview must include the complete body");
  const interrupted = await preview({ recipients: [{ email: "first@example.invalid" }, { email: "second@example.invalid" }], subject: "Cancel", body: "Test" });
  const controller = new AbortController();
  onQueued = () => { onQueued = undefined; controller.abort(); };
  const stopped = await call("office_mail_send", { previewId: interrupted.value.previewId, mode: "send", confirm: true }, controller.signal);
  assert.equal(stopped.isError, true);
  assert.equal(messages.length, 3, "cancellation must not send the second message");
  const afterAbort = (await fsp.readFile(path.join(root, "mail/sent-log.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(afterAbort.some((row) => row.previewId === interrupted.value.previewId && row.ok), "completed delivery must be logged before cancellation");
  assert.equal((await call("office_mail_send", { previewId: interrupted.value.previewId, mode: "send", confirm: true })).isError, true);

  for (const args of [
    { to: "x@example.invalid", recipients: [{ email: "y@example.invalid" }], subject: "x", body: "y" },
    { to: "x@example.invalid", subject: "x", subjectTemplate: "y", body: "z" },
    { to: "x@example.invalid", subject: "x", body: " " }
  ]) assert.equal((await call("office_mail_preview", args)).isError, true);
  const expired = await preview({ to: "recipient@example.invalid", subject: "Expiry", body: "Test" });
  const file = path.join(root, "mail/previews", `${expired.value.previewId}.json`);
  const record = JSON.parse(await fsp.readFile(file, "utf8")); record.createdAt = 0;
  await fsp.writeFile(file, JSON.stringify(record));
  assert.equal((await call("office_mail_send", { previewId: expired.value.previewId, mode: "send", confirm: true })).isError, true);
  console.log("PASS: real DSH registries: 22 tools, 4 skills; native full preview, confirmation, EML, loopback SMTP, rejection, audit, cancellation, duplicate guard, validation, expiry");
} finally {
  for (const fiber of fibers.reverse()) await fiber.dispose();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(root, { recursive: true, force: true });
}
