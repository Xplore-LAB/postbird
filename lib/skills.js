// @local/dsh-plugin-office
// Skill provider — exposes Postbird's Agent Skills to DeepSeek Harness.
//
// Why this file exists:
//   DSH's skill loader only discovers skills under ~/.dsh/skills,
//   ~/.agents/skills, <project>/.dsh/skills and <project>/.agents/skills.
//   A plugin's bundled skills/ directory is NOT one of those roots, so
//   shipping skills inside the plugin would otherwise achieve nothing: the
//   model would get the 22 office_* tools but none of the routing
//   instructions that explain how to use them.
//
//   Registering a provider makes the bundled skills first-class residents of
//   the skill registry. One `dsh plugin add` then delivers the tools and
//   their instructions together, and the two can never drift out of sync
//   with the plugin version.
//
// Skill directories, most specific first:
//   skills-zh/  DSH-adapted Chinese skills (frontmatter carries the DSH-only
//               `whenToUse` key and Chinese trigger-style descriptions)
//   skills/     the original English Agent Skills, kept for other agent
//               tools and as the fallback
//   A skill name found in an earlier directory wins, so the Chinese DSH
//   skills shadow their English counterparts.
//
// Contract (see @deepseek-ai/dsh-skill):
//   provider.name            unique string, "runtime" is reserved
//   provider.list(options)   -> Array<candidate> | { candidates, complete }
//   provider.get(candidate)  -> definition | undefined
//   A candidate must carry name / description / invocation / source / rank /
//   provider; a definition must additionally carry `content`.
//   A provider that throws loses its whole catalog, so every per-file
//   failure is caught and reported as a warning instead.

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Provider name; also the `source` label shown in the skill list. */
const PROVIDER_NAME = "postbird";
/**
 * Standard precedence rank for packaged skill providers
 * (BUNDLED_SKILL_RANK in @deepseek-ai/dsh-skill). Lower ranks win, so a
 * user-authored copy under ~/.dsh/skills (rank 400) still overrides these —
 * which is exactly the override semantics we want.
 */
const SKILL_RANK = 600;
/** Plugin root — this file lives in <root>/lib/. */
const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Skill directories, most specific first. */
const SKILL_DIR_NAMES = ["skills-zh", "skills"];
/** DSH skill-name grammar. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------- parsing --

/** Cached `yaml` module; null when the host does not expose a usable one. */
let yamlModule;
let yamlProbeDone = false;

async function loadYaml() {
  if (!yamlProbeDone) {
    yamlProbeDone = true;
    try {
      const mod = await import("yaml");
      // Only a yaml build that actually exposes `parse` is usable. There is
      // an unrelated package also called "yaml" (v0.2.x) whose default export
      // is a tokenizer with no parse function, and it can win the resolution
      // depending on where the plugin is installed from.
      const candidate =
        typeof mod.parse === "function"
          ? mod
          : typeof mod.default?.parse === "function"
            ? mod.default
            : null;
      yamlModule = candidate;
    } catch {
      yamlModule = null;
    }
  }
  return yamlModule;
}

/**
 * Parse a YAML frontmatter block.
 * Prefers the host's `yaml` package; falls back to a small parser that covers
 * the subset this plugin's skill files use (scalars, block sequences, block
 * mappings). The fallback exists so the plugin keeps working in a profile
 * where `yaml` is not resolvable.
 */
async function parseFrontmatter(text) {
  const yaml = await loadYaml();
  if (yaml !== null) {
    try {
      const data = yaml.parse(text);
      if (data !== null && typeof data === "object" && !Array.isArray(data)) return data;
    } catch {
      // fall through to the built-in parser
    }
  }
  return parseYamlSubset(text);
}

/** Split a skill file into its frontmatter text and its body. */
function splitFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return undefined;
  const yamlText = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, "");
  return { yamlText, body };
}

/** Split `key: value`; the value may be empty (nested block follows). */
function splitPair(text) {
  const match = /^([^:]+):(?:\s+(.*))?$/.exec(text);
  if (match === null) throw new Error(`not a mapping entry: ${text}`);
  return { key: match[1].trim(), value: (match[2] ?? "").trim() };
}

/** Convert a YAML scalar token to its JavaScript value. */
function parseScalar(text) {
  if (text === "") return null;
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    return splitFlow(inner).map((item) => parseScalar(item));
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    const inner = text.slice(1, -1).trim();
    const out = {};
    if (inner === "") return out;
    for (const item of splitFlow(inner)) {
      const pair = splitPair(item);
      out[pair.key] = parseScalar(pair.value);
    }
    return out;
  }
  return text.replace(/\s+#.*$/, "").trim();
}

/** Split a flow collection body on commas that are not inside quotes. */
function splitFlow(text) {
  const parts = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (const ch of text) {
    if (quote !== "") {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    if (ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/**
 * Minimal indentation-based YAML parser covering the subset used by these
 * skill files: scalars, block sequences and block mappings.
 */
function parseYamlSubset(text) {
  const lines = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    lines.push({ indent: raw.length - raw.trimStart().length, text: raw.trim() });
  }
  if (lines.length === 0) return {};
  let index = 0;

  function parseBlock(indent) {
    const isSequence = lines[index].text === "-" || lines[index].text.startsWith("- ");
    const container = isSequence ? [] : {};
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new Error(`unexpected indentation: ${line.text}`);
      if (isSequence) {
        if (line.text !== "-" && !line.text.startsWith("- ")) {
          throw new Error(`mixed block at: ${line.text}`);
        }
        const rest = line.text === "-" ? "" : line.text.slice(2).trim();
        index += 1;
        if (rest === "") {
          container.push(
            index < lines.length && lines[index].indent > indent ? parseBlock(lines[index].indent) : null
          );
        } else if (/^[^:\s][^:]*:(\s|$)/.test(rest)) {
          const item = {};
          const pair = splitPair(rest);
          item[pair.key] = pair.value;
          while (index < lines.length && lines[index].indent > indent) {
            const sub = lines[index];
            const subPair = splitPair(sub.text);
            index += 1;
            item[subPair.key] =
              subPair.value === "" && index < lines.length && lines[index].indent > sub.indent
                ? parseBlock(lines[index].indent)
                : subPair.value;
          }
          container.push(item);
        } else {
          container.push(parseScalar(rest));
        }
        continue;
      }
      if (line.text.startsWith("- ")) throw new Error(`mixed block at: ${line.text}`);
      const pair = splitPair(line.text);
      index += 1;
      if (pair.value === "") {
        container[pair.key] =
          index < lines.length && lines[index].indent > indent ? parseBlock(lines[index].indent) : null;
      } else {
        container[pair.key] = parseScalar(pair.value);
      }
    }
    return container;
  }

  return parseBlock(lines[0].indent);
}

// ------------------------------------------------------------ skill files --

/** Directories to scan, most specific first. */
function skillDirs() {
  const override = process.env.DSH_POSTBIRD_SKILLS_DIR;
  if (override !== undefined && override !== "") {
    return override.split(path.delimiter).filter((dir) => dir !== "");
  }
  return SKILL_DIR_NAMES.map((name) => path.join(PLUGIN_ROOT, name));
}

/** Every SKILL.md this plugin ships, in directory order. */
async function skillFiles() {
  const files = [];
  for (const dir of skillDirs()) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, "SKILL.md");
      try {
        await fsp.access(file);
      } catch {
        continue; // directory without a SKILL.md is not a skill
      }
      files.push({ path: file, directory: path.join(dir, entry.name) });
    }
  }
  return files;
}

/** Read and validate one skill file. Returns undefined when it is not usable. */
async function readSkill(file, ctx) {
  let raw;
  try {
    raw = await fsp.readFile(file.path, "utf8");
  } catch (error) {
    ctx?.logger?.warn(`[postbird] skill file ${file.path} ignored: ${errorMessage(error)}`);
    return undefined;
  }
  const split = splitFrontmatter(raw);
  if (split === undefined) {
    ctx?.logger?.warn(`[postbird] skill file ${file.path} ignored: missing YAML frontmatter`);
    return undefined;
  }
  let data;
  try {
    data = await parseFrontmatter(split.yamlText);
  } catch (error) {
    ctx?.logger?.warn(
      `[postbird] skill file ${file.path} ignored: invalid YAML frontmatter: ${errorMessage(error)}`
    );
    return undefined;
  }
  const name = stringField(data, "name");
  const description = stringField(data, "description");
  if (name === undefined || description === undefined) {
    ctx?.logger?.warn(`[postbird] skill file ${file.path} ignored: frontmatter requires name and description`);
    return undefined;
  }
  if (!SKILL_NAME.test(name)) {
    ctx?.logger?.warn(`[postbird] skill file ${file.path} ignored: invalid skill name "${name}"`);
    return undefined;
  }
  let invocation;
  try {
    invocation = parseInvocationPolicy(data);
  } catch (error) {
    ctx?.logger?.warn(
      `[postbird] skill file ${file.path} ignored: invalid invocation frontmatter: ${errorMessage(error)}`
    );
    return undefined;
  }
  const whenToUse = stringField(data, "whenToUse");
  const metadata = optionalMetadata(data);
  return {
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    invocation,
    ...(metadata !== undefined ? { metadata } : {}),
    path: file.path,
    directory: file.directory,
    content: split.body.trim()
  };
}

function stringField(data, key) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalMetadata(data) {
  const value = data.metadata;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  return undefined;
}

/**
 * Resolve the invocation policy. The camelCase keys are rejected on purpose:
 * DSH's own loader throws for them, and silently accepting them here would
 * make the same skill behave differently depending on where it is installed.
 */
function parseInvocationPolicy(data) {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy)) {
      throw new Error(
        `frontmatter field "${legacy}" is unsupported; use "disable-model-invocation" / "user-invocable"`
      );
    }
  }
  const disableModelInvocation = frontmatterBoolean(data, "disable-model-invocation");
  const userInvocable = frontmatterBoolean(data, "user-invocable");
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false
  };
}

function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    switch (value.toLowerCase()) {
      case "true":
      case "yes":
      case "on":
        return true;
      case "false":
      case "no":
      case "off":
        return false;
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`);
}

function errorMessage(error) {
  return String(error);
}

// --------------------------------------------------------------- provider --

/** Provider that maps this plugin's bundled skills into `ctx.skills`. */
export class PostbirdSkillProvider {
  constructor(ctx) {
    this.ctx = ctx;
    this.name = PROVIDER_NAME;
  }

  /** Summaries of every bundled skill, for the skill catalog. */
  async list(options = {}) {
    options.signal?.throwIfAborted();
    const candidates = [];
    const seen = new Set();
    for (const file of await skillFiles()) {
      const parsed = await readSkill(file, this.ctx);
      if (parsed === undefined) continue;
      // Earlier directories win: skills-zh/ shadows skills/.
      if (seen.has(parsed.name)) continue;
      seen.add(parsed.name);
      candidates.push({
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
        invocation: parsed.invocation,
        source: PROVIDER_NAME,
        rank: SKILL_RANK,
        provider: PROVIDER_NAME,
        path: parsed.path,
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
        locator: { path: parsed.path, directory: parsed.directory }
      });
    }
    return candidates;
  }

  /** Full body of one skill, loaded on demand. */
  async get(candidate) {
    const locator = candidate?.locator;
    if (locator === undefined) return undefined;
    const parsed = await readSkill({ path: locator.path, directory: locator.directory }, this.ctx);
    if (parsed === undefined) return undefined;
    return {
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
      invocation: parsed.invocation,
      source: PROVIDER_NAME,
      provider: PROVIDER_NAME,
      resourceBase: { kind: "directory", path: parsed.directory },
      path: parsed.path,
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      content: parsed.content
    };
  }
}

/**
 * Register the bundled skills with DSH's skill registry.
 *
 * The `skills` service is declared in this plugin's `inject` list, so DSH
 * provides it. It can still be absent when the plugin is applied against a
 * hand-built context (the e2e harness does that), and a missing optional
 * service must not take the whole plugin down — so the registration is
 * skipped instead of thrown.
 *
 * @returns the Cordis effect disposer, or undefined when no service is available.
 */
export function registerPostbirdSkills(ctx) {
  if (typeof ctx?.skills?.registerProvider !== "function") return undefined;
  return ctx.skills.registerProvider(() => new PostbirdSkillProvider(ctx));
}

export const POSTBIRD_SKILL_PROVIDER_NAME = PROVIDER_NAME;
export { skillDirs, skillFiles, splitFrontmatter, parseYamlSubset, parseFrontmatter };
