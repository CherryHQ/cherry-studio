/**
 * Generate the per-connection dsh `cordis.yml` composition string.
 *
 * The composition is assembled as a typed entry list and serialized with the
 * `yaml` library — indentation and quoting are the serializer's job, never
 * hand-built strings. Everything is inlined as concrete values (no `!!js`
 * tags) — the ONLY env indirections are `apiKeyEnv: CHERRY_DSH_API_KEY` (the
 * secret stays out of the file) and the bridge socket, which the plugin reads
 * from `CHERRY_DSH_BRIDGE_SOCK` directly. Every plugin `name` is resolved to
 * an absolute file URL at generation time: the packaged app runs the
 * composition from a foreign config dir where bare names are not resolvable.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import type { BridgePermissionMode } from '@cherrystudio/dsh-bridge'
import { isWin } from '@main/core/platform'
import { toAsarUnpackedPath } from '@main/utils/asar'
import type { DshApi } from '@shared/ai/dshModelCompatibility'
import { stringify } from 'yaml'

import type { DshModelConfig, DshReasoningEffort } from './modelInjection'

const require_ = createRequire(import.meta.url)

/** Resolve a composition plugin specifier to its packaged on-disk entry. */
export function resolveDshPluginPath(specifier: string): string {
  return toAsarUnpackedPath(require_.resolve(specifier))
}

/** Convert a plugin entry path into the URL form required by Node's ESM loader. */
export function toDshPluginUrl(pluginPath: string, windows = isWin): string {
  return pathToFileURL(pluginPath, { windows }).href
}

/** Resolve the `dsh-jsonrpc-agent` runtime bin spawned via `ELECTRON_RUN_AS_NODE`. */
export function resolveDshRuntimeBinPath(): string {
  return resolveDshPluginPath('@deepseek-ai/dsh-sdk-jsonrpc-demo/bin')
}

export interface DshCompositionInput {
  providerName: string
  api: DshApi
  baseUrl: string
  headers?: Record<string, string>
  /** Connection-frozen reasoning level; absent preserves the provider default. */
  reasoning?: DshReasoningEffort
  modelConfig: DshModelConfig
  workspacePath: string
  /** Cherry-owned DSH home used by the durable attachment store. */
  dshRoot: string
  /** JSONL session-persistence root (`feature.agents.dsh.sessions`). */
  sessionsRoot: string
  permissionMode: BridgePermissionMode
  /** Cherry-materialized system prompt; empty string keeps the spine's native persona. */
  persona: string
  /** A workspace `system.md` replaced the native base — drop the dsh identity sentence. */
  customBase: boolean
  /** Canonical dirs of the agent's enabled Cherry-managed skills (composition customSkillDirs). */
  skillDirs: readonly string[]
  /** Platform override for composition contract tests. */
  platform?: NodeJS.Platform
}

/** One cordis.yml row: a resolved plugin entry plus its optional config block. */
interface DshCompositionEntry {
  id: string
  name: string
  config?: Record<string, unknown>
}

function buildProviderRoute(input: DshCompositionInput): Record<string, unknown> {
  return {
    apiKeyEnv: 'CHERRY_DSH_API_KEY',
    // Google is a catalog-provider reuse: naming its explicit protocol would be rejected by rc.6.
    ...(input.api === 'google-generative-ai' ? {} : { api: input.api }),
    baseURL: input.baseUrl,
    ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}),
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    models: [
      {
        id: input.modelConfig.id,
        ...(input.modelConfig.name ? { name: input.modelConfig.name } : {}),
        contextWindow: input.modelConfig.contextWindow,
        maxTokens: input.modelConfig.maxTokens,
        input: [...input.modelConfig.input],
        reasoningEfforts:
          input.modelConfig.reasoningEfforts === false ? false : { ...input.modelConfig.reasoningEfforts }
      }
    ]
  }
}

function buildSpineConfig(input: DshCompositionInput, isWindows: boolean): Record<string, unknown> {
  return {
    // dsh interpolates {{var}} strictly at render (unknown refs THROW); Cherry text
    // never uses dsh variables, so break every opener instead of crashing turns.
    ...(input.persona ? { persona: input.persona.replaceAll('{{', '{ {') } : {}),
    // A workspace system.md replaces the persona base; drop only the dsh identity
    // sentence — tool-guidance sections stay (mechanics, not persona).
    ...(input.customBase ? { includeHarnessIdentity: false } : {}),
    // AGENTS.md/CLAUDE.md are trusted workspace text — parity with pi's `noContextFiles: false`.
    workspaceContext: { maxBytes: 32768 },
    skills: input.skillDirs.length
      ? {
          enabled: true,
          filesystem: {
            // Fail-closed skill discovery: Cherry owns the root list (pi's noSkills +
            // additionalSkillPaths analogue); membership changes rebuild via the signature.
            includeDefaultRoots: false,
            customSkillDirs: [...input.skillDirs],
            watch: false
          }
        }
      : { enabled: false },
    toolBash: isWindows ? false : { enableRunInBackground: false },
    toolJobs: false
  }
}

export function buildDshCompositionYaml(input: DshCompositionInput): string {
  const isWindows = input.platform === undefined ? isWin : input.platform === 'win32'
  const entry = (id: string, specifier: string, config?: Record<string, unknown>): DshCompositionEntry => ({
    id,
    name: toDshPluginUrl(resolveDshPluginPath(specifier), isWindows),
    ...(config ? { config } : {})
  })

  const entries: DshCompositionEntry[] = [
    entry('sdk-jsonrpc-server', '@deepseek-ai/dsh-sdk-jsonrpc-server', { maxTokensAsSuccess: false }),
    entry('llm', '@deepseek-ai/dsh-llm-pi-ai', { providers: { [input.providerName]: buildProviderRoute(input) } }),
    // Configless = normal mode: 2 retries for empty/rate-limit/server/timeout/transport,
    // 500ms→10s backoff. The provider profile above sets no `retryPolicy` override.
    entry('llm-retry', '@deepseek-ai/dsh-llm-retry'),
    entry('sandbox', '@deepseek-ai/dsh-sandbox-local'),
    entry('sandbox-policy', '@deepseek-ai/dsh-sandbox-policy', {
      mode: input.permissionMode === 'bypassPermissions' ? 'danger-full-access' : 'workspace-write',
      workspaceRoot: input.workspacePath
    }),
    entry('subprocess', '@deepseek-ai/dsh-subprocess-local'),
    entry('shell-executor', isWindows ? '@deepseek-ai/dsh-pwsh-sandbox' : '@deepseek-ai/dsh-bash-sandbox', {
      cwd: input.workspacePath
    }),
    // policy: ask ALWAYS — bypass is expressed by the bridge plugin's allow-all, never `never`.
    entry('approval', '@deepseek-ai/dsh-user-approval', { policy: 'ask' }),
    entry('agent-spine', '@deepseek-ai/dsh-agent-spine-demo', buildSpineConfig(input, isWindows)),
    ...(isWindows
      ? [
          entry('shell-env', '@deepseek-ai/dsh-shell-env', { dshHome: input.dshRoot }),
          entry('tool-pwsh', '@deepseek-ai/dsh-tool-pwsh', { enableRunInBackground: false })
        ]
      : []),
    entry('fs', '@deepseek-ai/dsh-fs-local', { cwd: input.workspacePath }),
    entry('attachments', '@deepseek-ai/dsh-attachment-local', { dshHome: input.dshRoot }),
    entry('tool-fs', '@deepseek-ai/dsh-tool-fs'),
    // Single-active discipline: the composition mounts no background bash/jobs/subagents.
    entry('tool-todo', '@deepseek-ai/dsh-tool-todo', { allowParallelInProgress: false }),
    // token-meter rejects any config key; session-projection carries its contextBreakdown unit.
    entry('token-meter', '@deepseek-ai/dsh-token-meter'),
    entry('session-projection', '@deepseek-ai/dsh-session-projection'),
    // Both configless: pruner defaults match dsh's base bundle (8192/4096/1024 chars);
    // compaction auto-triggers at 80% of contextWindow and summarizes via the routed model.
    entry('tool-result-pruner', '@deepseek-ai/dsh-compaction-tool-result-pruner'),
    entry('compaction-basic', '@deepseek-ai/dsh-compaction-basic'),
    // Slash commands (host-dispatched over the bridge `command` frame): /compact + /goal.
    entry('commands', '@deepseek-ai/dsh-commands'),
    entry('command-compact', '@deepseek-ai/dsh-command-compact'),
    // Goal domain, model-facing goal tools/prompt section, and same-session continuation.
    // Round turns reach the host as autonomous receive-only turns (adapter beginTurn contract);
    // activation disarms on every resume, so restarts never continue a goal unprompted.
    entry('goal', '@deepseek-ai/dsh-goal'),
    entry('tool-goal', '@deepseek-ai/dsh-tool-goal'),
    entry('goal-round-driver', '@deepseek-ai/dsh-goal-round-driver'),
    entry('command-goal', '@deepseek-ai/dsh-command-goal'),
    entry('sessions', '@deepseek-ai/dsh-session-persistence-jsonl', { root: input.sessionsRoot }),
    entry('cherry-bridge', '@cherrystudio/dsh-bridge/plugin')
  ]

  return (
    '# Generated by Cherry Studio for one dsh runtime connection. stdout is JSON-RPC; no stdout loggers.\n' +
    // lineWidth 0: never fold long scalars (personas, file URLs) across lines.
    stringify(entries, { lineWidth: 0 })
  )
}
