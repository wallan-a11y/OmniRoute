// tests/unit/build/claude-plugin-manifests.test.ts
// Gate tests for the Claude Code plugin marketplace shipped by this repo:
//   - .claude-plugin/marketplace.json          — the marketplace catalog
//   - plugins/<name>/.claude-plugin/plugin.json — one manifest per plugin
//   - plugins/<name>/skills/                    — payload mirrored from skills/
//
// These assert the contract Claude Code enforces when loading a marketplace
// (name/owner/plugins required, kebab-case ids, relative sources starting with
// "./" and resolving to a real directory) plus the repo-local invariant that
// every canonical skill in skills/ lands in exactly one plugin payload.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — .mjs helper has no type declarations; runtime shape is known.
import {
  listSkillIds,
  resolvePlugin,
  planSync,
} from "../../../scripts/skills/sync-plugin-skills.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const MARKETPLACE_PATH = path.join(REPO_ROOT, ".claude-plugin", "marketplace.json");

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Reserved by Anthropic for official marketplaces — a third-party marketplace
// using one of these stops loading as "registered from an untrusted source".
const RESERVED_MARKETPLACE_NAMES = new Set([
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-plugins-official",
  "claude-plugins-community",
  "claude-community",
  "anthropic-marketplace",
  "anthropic-plugins",
  "agent-skills",
  "anthropic-agent-skills",
  "knowledge-work-plugins",
  "life-sciences",
  "claude-for-legal",
  "claude-for-financial-services",
  "financial-services-plugins",
  "first-party-plugins",
  "healthcare",
]);

interface PluginEntry {
  name: string;
  source: string;
  description?: string;
  defaultEnabled?: boolean;
}

interface Marketplace {
  name: string;
  owner?: { name?: string };
  plugins: PluginEntry[];
}

function readMarketplace(): Marketplace {
  return JSON.parse(fs.readFileSync(MARKETPLACE_PATH, "utf8")) as Marketplace;
}

// ---------------------------------------------------------------------------
// marketplace.json
// ---------------------------------------------------------------------------

test("marketplace.json: exists at the repo root under .claude-plugin/", () => {
  assert.ok(
    fs.existsSync(MARKETPLACE_PATH),
    "Claude Code looks for .claude-plugin/marketplace.json at the marketplace root"
  );
});

test("marketplace.json: has the required name/owner/plugins fields", () => {
  const mk = readMarketplace();
  assert.equal(typeof mk.name, "string");
  assert.ok(mk.name.length > 0, "name must not be empty");
  assert.ok(typeof mk.owner === "object" && mk.owner !== null, "owner must be an object");
  assert.equal(typeof mk.owner?.name, "string", "owner.name is required");
  assert.ok(
    Array.isArray(mk.plugins) && mk.plugins.length > 0,
    "plugins must be a non-empty array"
  );
});

test("marketplace.json: name is kebab-case and not an Anthropic-reserved name", () => {
  const mk = readMarketplace();
  assert.match(mk.name, KEBAB_CASE, "marketplace name must be kebab-case with no spaces");
  assert.ok(
    !RESERVED_MARKETPLACE_NAMES.has(mk.name),
    `"${mk.name}" is reserved for official Anthropic marketplaces`
  );
});

test("marketplace.json: plugin names are kebab-case and unique", () => {
  const mk = readMarketplace();
  const seen = new Set<string>();
  for (const entry of mk.plugins) {
    assert.match(entry.name, KEBAB_CASE, `plugin name "${entry.name}" must be kebab-case`);
    assert.ok(!seen.has(entry.name), `duplicate plugin name: ${entry.name}`);
    seen.add(entry.name);
  }
});

test("marketplace.json: every source is a relative path resolving to a real directory", () => {
  const mk = readMarketplace();
  for (const entry of mk.plugins) {
    assert.equal(typeof entry.source, "string", `${entry.name}: source must be a relative path`);
    assert.ok(entry.source.startsWith("./"), `${entry.name}: relative source must start with "./"`);
    assert.ok(!entry.source.includes(".."), `${entry.name}: source must not escape the root`);

    const dir = path.join(REPO_ROOT, entry.source);
    assert.ok(fs.existsSync(dir), `${entry.name}: source directory missing (${entry.source})`);
    assert.ok(fs.statSync(dir).isDirectory(), `${entry.name}: source must be a directory`);
  }
});

// ---------------------------------------------------------------------------
// plugin.json manifests
// ---------------------------------------------------------------------------

test("plugin.json: each plugin ships a manifest whose name matches its entry", () => {
  const mk = readMarketplace();
  for (const entry of mk.plugins) {
    const manifestPath = path.join(REPO_ROOT, entry.source, ".claude-plugin", "plugin.json");
    assert.ok(
      fs.existsSync(manifestPath),
      `${entry.name}: missing ${entry.source}/.claude-plugin/plugin.json`
    );

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: string };
    assert.equal(
      manifest.name,
      entry.name,
      `${entry.name}: plugin.json name must match the marketplace entry name`
    );
  }
});

test("plugin.json: every manifest version matches package.json", () => {
  // Claude Code pins an installed plugin to its manifest `version`, so a stale
  // string here means users never receive updated skills.
  const expected = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"))
    .version as string;
  const mk = readMarketplace();

  for (const entry of mk.plugins) {
    const manifestPath = path.join(REPO_ROOT, entry.source, ".claude-plugin", "plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version?: string };
    assert.equal(
      manifest.version,
      expected,
      `${entry.name}: version must track package.json — run npm run sync:plugin-skills`
    );
  }
});

test("plugin.json: a declared mcpServers path points at a real, parseable config", () => {
  const mk = readMarketplace();
  for (const entry of mk.plugins) {
    const manifestPath = path.join(REPO_ROOT, entry.source, ".claude-plugin", "plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { mcpServers?: unknown };
    if (typeof manifest.mcpServers !== "string") continue;

    const mcpPath = path.join(REPO_ROOT, entry.source, manifest.mcpServers);
    assert.ok(
      fs.existsSync(mcpPath),
      `${entry.name}: mcpServers path missing (${manifest.mcpServers})`
    );

    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    assert.ok(
      mcp.mcpServers && Object.keys(mcp.mcpServers).length > 0,
      `${entry.name}: mcp config must declare at least one server`
    );
  }
});

// ---------------------------------------------------------------------------
// skills payload
// ---------------------------------------------------------------------------

test("routing: every canonical skill in skills/ is claimed by exactly one plugin", () => {
  const unrouted = (listSkillIds() as string[]).filter((id) => resolvePlugin(id) === null);
  assert.deepEqual(
    unrouted,
    [],
    `these skills match no PLUGIN_ROUTES rule and would be dropped from the marketplace: ${unrouted.join(", ")}`
  );
});

test("payload: plugins/*/skills mirrors skills/ exactly (run npm run sync:plugin-skills)", () => {
  const { unrouted, drift } = planSync() as { unrouted: string[]; drift: string[] };
  assert.deepEqual(unrouted, [], `unrouted skills: ${unrouted.join(", ")}`);
  assert.deepEqual(drift, [], `plugin payload drifted from skills/:\n${drift.join("\n")}`);
});

test("payload: every mirrored SKILL.md carries name + description frontmatter", () => {
  const mk = readMarketplace();
  for (const entry of mk.plugins) {
    const skillsDir = path.join(REPO_ROOT, entry.source, "skills");
    if (!fs.existsSync(skillsDir)) continue;

    for (const dir of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const skillPath = path.join(skillsDir, dir.name, "SKILL.md");
      assert.ok(fs.existsSync(skillPath), `${entry.name}/${dir.name}: missing SKILL.md`);

      const body = fs.readFileSync(skillPath, "utf8");
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(body);
      assert.ok(frontmatter, `${entry.name}/${dir.name}: SKILL.md has no YAML frontmatter`);
      assert.match(
        frontmatter[1],
        /^name:\s*\S/m,
        `${entry.name}/${dir.name}: frontmatter needs a name`
      );
      assert.match(
        frontmatter[1],
        /^description:\s*\S/m,
        `${entry.name}/${dir.name}: frontmatter needs a description`
      );
    }
  }
});
