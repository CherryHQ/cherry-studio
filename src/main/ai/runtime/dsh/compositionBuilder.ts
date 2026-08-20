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
import { pathToFileURL } from 'node:url'

import { type BridgePermissionMode, resolveDshRuntimeEntry } from '@cherrystudio/dsh-bridge'
import { isWin } from '@main/core/platform'
import { toAsarUnpackedPath } from '@main/utils/asar'
import type { DshApi } from '@shared/ai/dshModelCompatibility'
import { stringify } from 'yaml'

import type { DshModelConfig, DshReasoningEffort } from './modelInjection'

/** Resolve a composition plugin specifier to its packaged on-disk entry. */
export function resolveDshPluginPath(specifier: string): string {
  return toAsarUnpackedPath(resolveDshRuntimeEntry(specifier))
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

// dsh base bundle's plan:policy section, minus its ask_user_question guidance (the
// tool is not mounted here; plan review flows only through exit_plan_mode).
const DSH_PLAN_MODE_SECTION = [
  "You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.",
  'Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.',
  'The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed only to keep the request shape stable. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.',
  'Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.',
  'When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" in prose. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.'
].join('\n\n')

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
    // No background bash and no jobs plane; background work is continuable subagents only.
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
    entry('subagent', '@deepseek-ai/dsh-subagent'),
    entry('subagent-spawn', '@deepseek-ai/dsh-subagent-spawn-in-process', { providerName: 'spawn' }),
    entry('subagent-fork', '@deepseek-ai/dsh-subagent-fork-in-process', { providerName: 'fork' }),
    // send_message + interrupt_agent, plus the durable child catalog behind list_agents.
    entry('tool-subagent-control', '@deepseek-ai/dsh-tool-subagent-control'),
    entry('tool-subagent-list-agents', '@deepseek-ai/dsh-tool-subagent-control/list-agents'),
    // dsh-factory split: spawn children are continuable background-first; fork children
    // stay one-shot foreground (no jobs plane, so run_in_background must stay hidden).
    entry('tool-subagent', '@deepseek-ai/dsh-tool-subagent', {
      provider: 'spawn',
      toolName: 'subagent',
      backgroundMode: 'continuable',
      toolFilter: { deny: ['exit_plan_mode'] }
    }),
    entry('tool-subagent-fork', '@deepseek-ai/dsh-tool-subagent', {
      provider: 'fork',
      toolName: 'subagent_fork',
      backgroundMode: 'one-shot',
      enableRunInBackground: false,
      toolFilter: { deny: ['exit_plan_mode'] }
    }),
    entry('tool-subagent-report', '@deepseek-ai/dsh-tool-subagent-report'),
    // Plan review reaches the host through the bridge's userQuestions provider; plan
    // enforcement itself lives in the bridge policy (dsh plan-mode is guidance-only).
    entry('user-questions', '@deepseek-ai/dsh-user-questions'),
    entry('plan-mode', '@deepseek-ai/dsh-plan-mode', { section: DSH_PLAN_MODE_SECTION }),
    entry('sessions', '@deepseek-ai/dsh-session-persistence-jsonl', { root: input.sessionsRoot }),
    entry('cherry-bridge', '@cherrystudio/dsh-bridge/plugin')
  ]

  return (
    '# Generated by Cherry Studio for one dsh runtime connection. stdout is JSON-RPC; no stdout loggers.\n' +
    // lineWidth 0: never fold long scalars (personas, file URLs) across lines.
    stringify(entries, { lineWidth: 0 })
  )
}
