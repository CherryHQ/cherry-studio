import type { ExportResult, Target, Team } from './types.mjs';
import { identifier, json } from './adapters-codecs.mjs';
import { exportLocal } from './adapters-local.mjs';
import { exportService } from './adapters-services.mjs';
import { bindUiRoles } from './ui-bindings.mjs';

const sources: Record<Target, { source: string; version: string }> = {
  codex: { source: 'https://learn.chatgpt.com/docs/agent-configuration/subagents', version: 'documentation inspected 2026-09-24' },
  claude: { source: 'https://code.claude.com/docs/en/sub-agents', version: 'documentation inspected 2026-09-24' },
  copilot: { source: 'https://docs.github.com/en/copilot/reference/custom-agents-configuration', version: 'documentation inspected 2026-09-24' },
  kimi: { source: 'https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/agents.md', version: 'main documentation inspected 2026-09-24' },
  minimax: { source: 'https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/agent/storage/canonical-agent-config.ts', version: '@minimax-ai/code 0.4.12; source inspected 2026-09-24' },
  opencode: { source: 'https://opencode.ai/docs/agents/', version: 'deployed singular agent schema inspected 2026-09-24' },
  deepseek: { source: 'https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/experimental/agent-team', version: 'master documentation inspected 2026-09-24; experimental' },
  uar: { source: 'https://github.com/Prometheus-AGS/universal-agent-runtime/blob/ba12845138104d3c8c3b8bca8bc7c5be24004e91/src/uar/domain/artifact.rs', version: '1.0.0 / ba12845138104d3c8c3b8bca8bc7c5be24004e91' },
  bossfang: { source: 'crates/librefang-types/src/agent.rs; crates/librefang-hands/src/lib.rs; crates/librefang-api/src/routes/workflows/workflow.rs', version: '2026.7.11 / c719a4d683e4d3fb42e436f812e0193f865c9d2c' },
};

function safePath(path: string): string {
  if (!path || path.includes('\\') || path.startsWith('/') || /[\x00-\x1f\x7f:]/.test(path)) {
    throw new Error(`Unsafe native export path: ${JSON.stringify(path)}`);
  }
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) ||
        /^(?:\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      throw new Error(`Unsafe native export path component: ${JSON.stringify(part)}`);
    }
  }
  return path.normalize('NFC').toLowerCase();
}

/** Pure staging: no filesystem, process, HTTP, registration or execution side effects. */
export function exportTeam(team: Team, target: Target): ExportResult {
  team = bindUiRoles(team);
  if (!Object.hasOwn(sources, target)) throw new Error(`Unsupported export target: ${String(target)}`);
  identifier(team.id, 'Team ID');
  if (!team.roles.length) throw new Error('Export requires at least one role.');
  const roleIds = new Set<string>();
  for (const role of team.roles) {
    const id = identifier(role.id, 'Role ID');
    if (roleIds.has(id)) throw new Error(`Duplicate role ID: ${id}`);
    roleIds.add(id);
  }
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  const paths = new Set<string>();
  const names = new Set<string>();
  const diagnostics = ['Source-verified serialization only; installed native validation and live execution are unverified.'];
  const instructions = ['Review staged artifacts before installation. Export grants no execution or registration authority.'];
  const context = {
    diagnostics, instructions,
    add(path: string, content: string): void {
      const key = safePath(path);
      if (key === 'team-export.json') throw new Error('team-export.json is reserved for the staging receipt.');
      for (const existing of paths) {
        if (key === existing || key.startsWith(`${existing}/`) || existing.startsWith(`${key}/`)) {
          throw new Error(`Native export file collision: ${path}`);
        }
      }
      paths.add(key);
      files[path] = content;
    },
    claimName(value: unknown): string {
      const name = identifier(value, 'Native agent name');
      if (names.has(name)) throw new Error(`Native agent name collision: ${name}`);
      names.add(name);
      return name;
    },
  };
  const native = team.native?.[target];
  if (native && (!native.source?.trim() || !native.version?.trim())) {
    throw new Error('Native configuration requires a nonempty source and version receipt.');
  }
  if (team.skillPolicies || team.modelPolicy || team.roles.some(role => role.modelPolicy)) {
    diagnostics.push('Only explicit model IDs are translated. Resolve tier, skill, capability and price policies with agent-team-models before native invocation.');
  }
  if (target === 'uar' || target === 'bossfang') exportService(team, target, context);
  else exportLocal(team, target, context);
  if (native?.options) context.add('native-options.json', json(native.options));
  const verification: ExportResult['verification'] = { level: 'source-verified', ...sources[target], live: 'unverified' };
  context.add('export-receipt.json', json({
    target, verification, nativeProvenance: native ? { source: native.source, version: native.version } : null,
    nativeOptions: native?.options ?? null,
    roleOverrides: Object.fromEntries(team.roles.filter(role => role.native?.[target]).map(role => [role.id, role.native?.[target]])),
    diagnostics, instructions,
  }));
  for (const [path, content] of Object.entries(native?.files ?? {})) {
    if (['team-export.json', 'export-receipt.json', 'native-options.json'].includes(safePath(path))) {
      throw new Error(`Reserved generated export file: ${path}`);
    }
    context.add(path, content);
  }
  return { target, files, verification, diagnostics, instructions };
}
