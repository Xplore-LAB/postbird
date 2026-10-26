// Coverage for the bundled-skill provider (lib/skills.js).
//
//   node --test tests/skill-provider.mjs
//
// Verifies the parts a boot test cannot see:
//   1. the provider honours the DSH provider contract (list/get shapes)
//   2. skills-zh/ shadows skills/ for the same skill name
//   3. the built-in fallback parser agrees with a real YAML parser
//   4. a malformed skill file is skipped, not thrown — one bad file must not
//      take the whole catalog down

import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PostbirdSkillProvider,
  skillDirs,
  skillFiles,
  splitFrontmatter,
  parseYamlSubset,
  parseFrontmatter
} from "../lib/skills.js";

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Best-effort: a real YAML parser, if one with `parse` is resolvable. */
async function loadYamlForComparison() {
  const require_ = createRequire(path.join(PLUGIN_ROOT, "lib", "skills.js"));
  let resolved;
  try {
    resolved = require_.resolve("yaml");
  } catch {
    return null;
  }
  const mod = await import(pathToFileURL(resolved).href);
  const candidate =
    typeof mod.parse === "function" ? mod : typeof mod.default?.parse === "function" ? mod.default : null;
  if (candidate === null) return null;
  return { parse: candidate.parse, resolved };
}

const ctx = { logger: { warn: () => {} } };

test("provider exposes a unique, non-reserved name", () => {
  const provider = new PostbirdSkillProvider(ctx);
  assert.equal(provider.name, "postbird");
  assert.notEqual(provider.name, "runtime");
});

test("list() returns the bundled skills with registry-valid candidates", async () => {
  const provider = new PostbirdSkillProvider(ctx);
  const candidates = await provider.list();
  assert.ok(candidates.length >= 4, `expected at least 4 skills, got ${candidates.length}`);
  for (const candidate of candidates) {
    assert.equal(typeof candidate.name, "string");
    assert.match(candidate.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(typeof candidate.description, "string");
    assert.ok(candidate.description.length > 0, `${candidate.name} needs a description`);
    assert.equal(typeof candidate.source, "string");
    assert.equal(typeof candidate.rank, "number");
    assert.ok(Number.isFinite(candidate.rank));
    assert.equal(candidate.provider, "postbird");
    assert.equal(typeof candidate.invocation, "object");
    assert.equal(typeof candidate.invocation.modelInvocable, "boolean");
    assert.equal(typeof candidate.invocation.userInvocable, "boolean");
  }
});

test("the DSH Chinese skills are the ones that get registered", async () => {
  const provider = new PostbirdSkillProvider(ctx);
  const candidates = await provider.list();
  const names = candidates.map((candidate) => candidate.name).sort();
  for (const expected of [
    "postbird-action",
    "postbird-campus-office",
    "postbird-delivery",
    "postbird-evidence"
  ]) {
    assert.ok(names.includes(expected), `missing skill: ${expected}`);
  }
  for (const candidate of candidates) {
    assert.match(candidate.description, /[一-鿿]/, `${candidate.name} description should be Chinese`);
    assert.match(candidate.whenToUse, /[一-鿿]/, `${candidate.name} whenToUse should be Chinese`);
  }
});

test("skills-zh/ shadows skills/ for the same skill name", async () => {
  const dirs = skillDirs();
  const zh = dirs.find((dir) => path.basename(dir) === "skills-zh");
  const en = dirs.find((dir) => path.basename(dir) === "skills");
  if (zh === undefined || en === undefined) return; // single-layout checkout
  const provider = new PostbirdSkillProvider(ctx);
  const candidates = await provider.list();
  for (const candidate of candidates) {
    assert.ok(
      candidate.path.startsWith(zh) || !candidate.path.startsWith(en),
      `${candidate.name} should resolve to skills-zh/`
    );
  }
});

test("get() returns a definition with a body, and undefined for an unknown one", async () => {
  const provider = new PostbirdSkillProvider(ctx);
  const candidates = await provider.list();
  for (const candidate of candidates) {
    const definition = await provider.get(candidate);
    assert.equal(definition.name, candidate.name);
    assert.equal(definition.provider, "postbird");
    assert.equal(typeof definition.content, "string");
    assert.ok(definition.content.length > 100, `${candidate.name} body too short`);
    assert.equal(definition.resourceBase.kind, "directory");
  }
  assert.equal(await provider.get({ locator: { path: "nope.md", directory: "." } }), undefined);
});

test("the fallback parser matches a real YAML parser", async (t) => {
  const yaml = await loadYamlForComparison();
  if (yaml === null) {
    t.skip("no YAML parser with parse() is resolvable in this checkout");
    return;
  }
  for (const file of await skillFiles()) {
    const raw = await fsp.readFile(file.path, "utf8");
    const split = splitFrontmatter(raw);
    const viaYaml = yaml.parse(split.yamlText);
    assert.deepEqual(parseYamlSubset(split.yamlText), viaYaml, `${file.path} fallback differs`);
    assert.deepEqual(await parseFrontmatter(split.yamlText), viaYaml, `${file.path} provider differs`);
    assert.ok(split.body.trim().length > 100, `${file.path} body too short`);
  }
});

test("malformed skill files are skipped instead of breaking the catalog", async () => {
  const tmp = path.join(PLUGIN_ROOT, ".test-skill-dir");
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });

  async function writeSkill(dir, content) {
    const target = path.join(tmp, dir);
    await fsp.mkdir(target, { recursive: true });
    await fsp.writeFile(path.join(target, "SKILL.md"), content, "utf8");
  }

  await writeSkill("a-good", "---\nname: a-good\ndescription: A valid one\n---\n\nbody\n");
  await writeSkill("b-bad-name", "---\nname: Bad_Name\ndescription: x\n---\n\nbody\n");
  await writeSkill("c-no-description", "---\nname: c-no-description\n---\n\nbody\n");
  await writeSkill("d-no-frontmatter", "just a body, no frontmatter\n");
  await writeSkill(
    "e-camel-policy",
    "---\nname: e-camel\ndescription: x\ndisableModelInvocation: true\n---\n\nbody\n"
  );
  await writeSkill("f-another-good", "---\nname: f-another-good\ndescription: Another valid one\n---\n\nbody\n");

  // A child process, so the env override is picked up at module load time.
  const moduleUrl = pathToFileURL(path.join(PLUGIN_ROOT, "lib", "skills.js")).href;
  const script = `
import { PostbirdSkillProvider } from ${JSON.stringify(moduleUrl)};
const warnings = [];
const provider = new PostbirdSkillProvider({ logger: { warn: (m) => warnings.push(m) } });
const candidates = await provider.list();
const definitions = [];
for (const c of candidates) {
  const d = await provider.get(c);
  definitions.push(d ? d.name : null);
}
console.log(JSON.stringify({ names: candidates.map((c) => c.name).sort(), definitions, warnings }));
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, DSH_POSTBIRD_SKILLS_DIR: tmp },
    encoding: "utf8"
  });
  await fsp.rm(tmp, { recursive: true, force: true });

  assert.equal(result.status, 0, result.stderr);
  const probe = JSON.parse(result.stdout.trim());
  assert.deepEqual(probe.names, ["a-good", "f-another-good"]);
  assert.deepEqual(probe.definitions, ["a-good", "f-another-good"]);
  assert.equal(probe.warnings.length, 4, `warnings: ${JSON.stringify(probe.warnings)}`);
  for (const warning of probe.warnings) assert.match(warning, /ignored/);
});
