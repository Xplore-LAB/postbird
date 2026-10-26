#!/usr/bin/env node

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const command = argv.shift() || "help";

function option(name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function flag(name) {
  return argv.includes(name);
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

function dshHome() {
  return path.resolve(option("--dsh-home") || process.env.DSH_HOME || path.join(os.homedir(), ".dsh"));
}

async function profileNames(home) {
  const profilesDir = path.join(home, "profiles");
  let entries;
  try {
    entries = await fsp.readdir(profilesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function selectProfile(home) {
  const requested = option("--profile");
  if (requested && !/^[A-Za-z0-9._-]+$/.test(requested)) {
    throw new Error(`invalid profile name "${requested}"`);
  }
  const available = await profileNames(home);
  if (requested) {
    if (!available.includes(requested)) {
      throw new Error(`DSH profile "${requested}" was not found under ${path.join(home, "profiles")}`);
    }
    return requested;
  }
  if (available.length === 1) return available[0];
  if (available.length === 0) {
    throw new Error(`no DSH profiles found under ${path.join(home, "profiles")}`);
  }
  throw new Error(`multiple DSH profiles found: ${available.join(", ")}. Add --profile <name>.`);
}

function targetDir(home, profile) {
  return path.join(home, "profiles", profile, "node_modules", "@local", "dsh-plugin-office");
}

async function registerPlugin(profileDir, dryRun) {
  const patchPath = path.join(profileDir, "cordis.patch.yml");
  const current = (await exists(patchPath)) ? await fsp.readFile(patchPath, "utf8") : "";
  if (current.includes("@local/dsh-plugin-office")) {
    return { changed: false, patchPath };
  }
  if (/\bid:\s*tool-office\b/.test(current)) {
    throw new Error(`${patchPath} already contains id tool-office with a different package`);
  }

  const block = [
    "",
    "# Postbird: local-first AI office toolkit",
    "- insert:",
    "    - id: tool-office",
    "      name: '@local/dsh-plugin-office'",
    "",
  ].join("\n");

  if (!dryRun) {
    await fsp.mkdir(profileDir, { recursive: true });
    if (current) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await fsp.copyFile(patchPath, `${patchPath}.postbird-${stamp}.bak`);
    }
    await fsp.writeFile(patchPath, current.replace(/\s*$/, "") + block, "utf8");
  }
  return { changed: true, patchPath };
}

async function setup() {
  const home = dshHome();
  const profile = await selectProfile(home);
  const profileDir = path.join(home, "profiles", profile);
  const target = targetDir(home, profile);
  const dryRun = flag("--dry-run");
  const skipDeps = flag("--skip-deps");

  console.log(`Postbird setup for DSH profile: ${profile}`);
  console.log(`Install location: ${target}`);
  if (dryRun) console.log("Dry run enabled. No files will be changed.");

  if (!dryRun && path.resolve(target) !== rootDir) {
    await fsp.mkdir(target, { recursive: true });
    // Skill directories are replaced rather than merged: a renamed or
    // dropped skill must not survive as a stale leftover from the previous
    // version, and the provider scans both directories.
    for (const item of ["skills", "skills-zh"]) {
      await fsp.rm(path.join(target, item), { recursive: true, force: true });
    }
    for (const item of ["lib", "scripts", "skills", "skills-zh", "example", "docs", "package.json", "README.md", "README.en.md", "SKILL.md", "LICENSE", "SECURITY.md"]) {
      const source = path.join(rootDir, item);
      if (await exists(source)) {
        await fsp.cp(source, path.join(target, item), { recursive: true, force: true });
      }
    }
    console.log("✓ Plugin files installed");
  } else if (!dryRun) {
    console.log("✓ Already running from the installed plugin directory");
  }

  if (!dryRun && !skipDeps) {
    const result = spawnSync("npm", ["install", "--omit=dev", "--legacy-peer-deps"], {
      cwd: target,
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) throw new Error(`npm install failed with exit code ${result.status}`);
    console.log("✓ Runtime dependencies installed");
  } else if (skipDeps) {
    console.log("• Dependency installation skipped");
  }

  if (!flag("--no-register")) {
    const registration = await registerPlugin(profileDir, dryRun);
    console.log(registration.changed ? `✓ Registered in ${registration.patchPath}` : "✓ Plugin already registered");
  }

  if (dryRun) {
    console.log("\nDry run complete. Run the same command without --dry-run to install Postbird.");
    return;
  }

  console.log("");
  console.log("Postbird is ready. Restart DSH, then try:");
  console.log('  看看 example/employees.csv 有哪些列，各是什么类型');
  console.log("");
  console.log(`Optional check: npm run doctor -- --profile ${profile}`);
}

function yamlValue(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}:\\s*['\"]?([^'\"#\\n]*)`, "m"));
  return match ? match[1].trim() : "";
}

async function doctor() {
  const home = dshHome();
  const profile = await selectProfile(home);
  const profileDir = path.join(home, "profiles", profile);
  const target = targetDir(home, profile);
  const patchPath = path.join(profileDir, "cordis.patch.yml");
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ ok: major >= 20, label: `Node.js ${process.versions.node}`, required: true });
  checks.push({ ok: await exists(path.join(target, "lib", "index.js")), label: "Plugin files", required: true });

  const patchText = (await exists(patchPath)) ? await fsp.readFile(patchPath, "utf8") : "";
  checks.push({ ok: patchText.includes("@local/dsh-plugin-office"), label: "DSH registration", required: true });

  let packageJson = null;
  try {
    packageJson = JSON.parse(await fsp.readFile(path.join(target, "package.json"), "utf8"));
  } catch {
    packageJson = null;
  }
  const dependencies = Object.keys(packageJson?.dependencies || {});
  const missingDeps = [];
  for (const name of dependencies) {
    if (!(await exists(path.join(target, "node_modules", ...name.split("/"))))) missingDeps.push(name);
  }
  checks.push({
    ok: dependencies.length > 0 && missingDeps.length === 0,
    label: missingDeps.length ? `Runtime dependencies missing: ${missingDeps.join(", ")}` : "Runtime dependencies",
    required: true,
  });

  console.log(`Postbird doctor for DSH profile: ${profile}\n`);
  for (const check of checks) console.log(`${check.ok ? "✓" : "✗"} ${check.label}`);

  const imapUser = yamlValue(patchText, "imapUser");
  const smtpUser = yamlValue(patchText, "smtpUser");
  const fromAddress = yamlValue(patchText, "fromAddress");
  const imapPassEnv = yamlValue(patchText, "imapPassEnv") || "DSH_IMAP_PASS";
  const smtpPassEnv = yamlValue(patchText, "smtpPassEnv") || "DSH_SMTP_PASS";
  const inboxReady = Boolean(imapUser && process.env[imapPassEnv]);
  const sendReady = Boolean(smtpUser && fromAddress && process.env[smtpPassEnv]);

  console.log("");
  console.log("Capabilities");
  console.log(checks.every((check) => check.ok) ? "✓ Documents, slides, spreadsheets, local search, and drafts" : "✗ Local tools need the required fixes above");
  console.log(inboxReady ? "✓ Live inbox access" : `• Live inbox access is optional. Configure imapUser and ${imapPassEnv} when needed.`);
  console.log(sendReady ? "✓ Live email delivery" : `• Live delivery is optional. Configure smtpUser, fromAddress, and ${smtpPassEnv} when needed.`);

  if (checks.some((check) => check.required && !check.ok)) process.exitCode = 1;
}

async function demo() {
  const home = dshHome();
  const profile = await selectProfile(home);
  const target = targetDir(home, profile);
  const pluginPath = path.join(target, "lib", "index.js");
  if (!(await exists(pluginPath))) throw new Error(`Postbird is not installed for profile "${profile}". Run npm run setup first.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.resolve(option("--output") || path.join(process.cwd(), `postbird-demo-${stamp}`));
  await fsp.mkdir(outputDir, { recursive: true });
  const inputFile = path.join(rootDir, "example", "employees.csv");
  await fsp.copyFile(inputFile, path.join(outputDir, "employees.csv"));
  process.env.DSH_OFFICE_HOME = path.join(outputDir, ".postbird-data");

  const { apply, Config } = await import(`${pathToFileURL(pluginPath).href}?demo=${Date.now()}`);
  const tools = [];
  apply({ tools: { register: (tool) => tools.push(tool) } }, Config({}));
  const byName = (name) => {
    const tool = tools.find((item) => item.name === name);
    if (!tool) throw new Error(`installed plugin did not register ${name}`);
    return tool;
  };
  const execution = { signal: undefined };

  const inspect = await byName("office_sheet").execute({ file: "employees.csv", action: "inspect", workDir: outputDir }, execution);
  await byName("office_sheet").execute({
    file: "employees.csv",
    action: "aggregate",
    workDir: outputDir,
    aggregate: { groupBy: ["department"], metrics: [{ fn: "count" }, { column: "salary", fn: "sum" }, { column: "bonus", fn: "avg" }] },
    outputPath: "department-summary.xlsx",
  }, execution);
  const letters = await byName("office_docgen").execute({
    content: [
      { type: "heading", level: 1, text: "{{name}} 的通知" },
      { type: "paragraph", text: "部门：{{department}}" },
      { type: "paragraph", text: "薪资：{{salary}}，奖金：{{bonus}}" },
    ],
    dataFile: "employees.csv",
    outputDir: "letters",
    filenameTemplate: "notice_{{name}}.docx",
    workDir: outputDir,
  }, execution);
  await byName("office_pptx").execute({
    content: [
      { type: "title", title: "Postbird 零配置演示", subtitle: "从一句话到真实文件" },
      { type: "bullets", title: "已完成", items: [`读取 ${inspect.rowCount} 行数据`, "生成部门汇总表", `生成 ${letters.count} 份通知`] },
    ],
    outputPath: "demo-summary.pptx",
    workDir: outputDir,
  }, execution);

  console.log("Postbird demo complete");
  console.log(`✓ Inspected ${inspect.rowCount} rows and ${inspect.columns.length} columns`);
  console.log("✓ Wrote department-summary.xlsx");
  console.log(`✓ Wrote ${letters.count} personalized Word documents`);
  console.log("✓ Wrote demo-summary.pptx");
  console.log(`\nOutput: ${outputDir}`);
}

function help() {
  console.log(`Postbird command line helper

Usage:
  postbird setup [--profile <name>] [--dry-run] [--no-register]
  postbird doctor [--profile <name>]
  postbird demo [--profile <name>] [--output <directory>]

Options:
  --profile <name>   Select a DSH profile. It is automatic when only one exists.
  --dsh-home <path>  Use a custom DSH home directory.
  --dry-run          Show setup actions without changing files.
  --no-register      Install files without editing cordis.patch.yml.
`);
}

try {
  if (command === "setup") await setup();
  else if (command === "doctor") await doctor();
  else if (command === "demo") await demo();
  else if (command === "help" || command === "--help" || command === "-h") help();
  else throw new Error(`unknown command "${command}". Run postbird help.`);
} catch (error) {
  console.error(`Postbird: ${error.message}`);
  process.exitCode = 1;
}
