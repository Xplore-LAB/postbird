import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginName = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name;
const cli = path.join(root, "scripts", "postbird.mjs");
const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "postbird-cli-"));
const profileDir = path.join(temp, "profiles", "test");
await fsp.mkdir(profileDir, { recursive: true });
await fsp.writeFile(path.join(profileDir, "cordis.patch.yml"), "# test profile\n", "utf8");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

const first = run(["setup", "--dsh-home", temp, "--profile", "test", "--skip-deps"]);
assert.equal(first.status, 0, first.stderr);
assert.match(first.stdout, /Plugin files installed/);
const installed = path.join(profileDir, "node_modules", ...pluginName.split("/"));
await fsp.access(path.join(installed, "lib", "index.js"));
await fsp.access(path.join(installed, "scripts", "postbird.mjs"));

const patchPath = path.join(profileDir, "cordis.patch.yml");
const patch1 = await fsp.readFile(patchPath, "utf8");
assert.equal(patch1.split(pluginName).length - 1, 1);

const second = run(["setup", "--dsh-home", temp, "--profile", "test", "--skip-deps"]);
assert.equal(second.status, 0, second.stderr);
const patch2 = await fsp.readFile(patchPath, "utf8");
assert.equal(patch2.split(pluginName).length - 1, 1);
assert.match(second.stdout, /already registered/);

const dryHome = path.join(temp, "dry-home");
await fsp.mkdir(path.join(dryHome, "profiles", "dry"), { recursive: true });
const dry = run(["setup", "--dsh-home", dryHome, "--profile", "dry", "--dry-run"]);
assert.equal(dry.status, 0, dry.stderr);
assert.equal(await exists(path.join(dryHome, "profiles", "dry", "node_modules")), false);

const invalid = run(["setup", "--dsh-home", temp, "--profile", "../bad", "--skip-deps"]);
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /invalid profile name/);

console.log("All Postbird CLI checks passed.");
await fsp.rm(temp, { recursive: true, force: true });

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}
