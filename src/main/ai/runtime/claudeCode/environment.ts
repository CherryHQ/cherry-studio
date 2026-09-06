/**
 * Claude Code subprocess environment: env-var assembly (model pins, config dir, proxy, user
 * overrides with a blocked list, external-CLI login handling) plus the token-budget math that
 * derives the auto-compact window and per-request output cap from the model catalog.
 */

import { createRequire } from 'node:module'
import path from 'node:path'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { loggerService } from '@logger'
import { COMPACTION_CLAUDE_SAFETY_MARGIN } from '@main/ai/constants'
import { isLinux, isMac, isWin } from '@main/core/platform'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { toAsarUnpackedPath } from '@main/utils/asar'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { autoDiscoverGitBash } from '@main/utils/commandResolver'
import { getShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { ENDPOINT_TYPE, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isExternalCliProvider } from '@shared/utils/provider'

import {
  type Environment,
  hasStaleCherryProxyMarkers,
  mergeAgentLoopbackProxyBypass,
  stripInheritedCherryProxyMarkers
} from './agentProxyEnvironment'

const logger = loggerService.withContext('ClaudeCodeEnvironment')

const MIN_AUTO_COMPACT_WINDOW = 100_000
const MAX_AUTO_COMPACT_WINDOW = 1_000_000
/**
 * Slack between the SDK's local token estimate and the provider's own count.
 * Widen it if 400s reappear while the reported input sits just under budget.
 */
const AUTO_COMPACT_ESTIMATE_MARGIN = 0.02
// The CLI's per-request `max_tokens` ceiling and the value it requests when
// `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is unset. Both measured against the bundled CLI and undocumented,
// so re-measure them on SDK upgrades.
const MAX_REQUESTED_OUTPUT_TOKENS = 128_000
const DEFAULT_REQUESTED_OUTPUT_TOKENS = 32_000
/**
 * Percentage of the auto-compact window at which compaction triggers, passed
 * through `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (integer 1-100, not a 0-1 fraction).
 *
 * The knob only ever lowers the threshold — the CLI ignores values above its own
 * default (https://code.claude.com/docs/en/env-vars). So this is a ceiling, not a
 * setting: compaction starts at 80% of the window *or earlier*, never later. That
 * one-way behavior is what makes a flat default safe to ship for every model.
 *
 * Left at the CLI's default, compaction starts late enough that a turn whose tool
 * results land in one burst can jump the remaining headroom and fail outright —
 * and a failed turn cannot compact its way out, because compaction replays the
 * same oversized history. 80 keeps roughly a fifth of the window as landing room.
 *
 * Deliberate ceiling: one flat percentage for every model. Make it per-model if
 * agents on small windows start compacting too eagerly to make progress.
 */
export const AUTO_COMPACT_TRIGGER_PCT = 80
const require_ = createRequire(import.meta.url)

// Providers bill `input + max_tokens` against the context limit, so history can only occupy
// `contextWindow - requestedOutput`; the floor over-promises models whose real budget is smaller.
// Third-party channels may report a contextWindow larger than the provider's actual limit
// (e.g. #18894: 256K declared / 128K real), causing auto-compaction to trigger too late.
// Apply the conservative safety margin only to untrusted providers; Anthropic-official
// channels report accurate windows and must not lose half their context to a blanket 0.6.
export function resolveAutoCompactWindow(
  contextWindow: number | undefined,
  requestedOutput: number,
  provider?: Provider | null
): number | undefined {
  if (
    typeof contextWindow !== 'number' ||
    !Number.isInteger(contextWindow) ||
    contextWindow < MIN_AUTO_COMPACT_WINDOW
  ) {
    return undefined
  }
  // Only the canonical system Anthropic provider reports an accurate window;
  // a relay must not inherit trust by cloning the preset or merely reusing
  // the endpoint type — a custom baseUrl confirms an untrusted channel that
  // can overstate the window (e.g. #18894).
  const hasCustomAnthropicBaseUrl = Boolean(
    provider?.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl?.trim()
  )
  const isTrustedAnthropic =
    provider != null &&
    provider.id === 'anthropic' &&
    provider.presetProviderId === 'anthropic' &&
    !hasCustomAnthropicBaseUrl
  const effectiveContextWindow = isTrustedAnthropic
    ? contextWindow
    : Math.floor(contextWindow * COMPACTION_CLAUDE_SAFETY_MARGIN)
  const inputRoom = effectiveContextWindow - requestedOutput
  const budget = Math.floor(inputRoom * (1 - AUTO_COMPACT_ESTIMATE_MARGIN))
  const clamped = Math.min(Math.max(budget, MIN_AUTO_COMPACT_WINDOW), MAX_AUTO_COMPACT_WINDOW)
  if (isTrustedAnthropic) {
    return clamped
  }
  // For untrusted relays the MIN clamp must not be raised above the
  // safety-adjusted input room when that room is large, but the SDK
  // rejects windows below MIN, so a tiny safety-adjusted room must still
  // floor rather than produce a sub-MIN window.
  const capped = Math.min(clamped, Math.max(inputRoom, 0))
  return Math.max(capped, MIN_AUTO_COMPACT_WINDOW)
}

// The CLI has no table for third-party models — it would request a generic 32,000 and cap them at
// 128,000 — so their real limit has to come from the catalog. Derived from the primary only: the
// pin is process-wide, but plan and small fall back to the primary unless explicitly changed.
export function resolveRequestedOutputTokens(
  contextWindow: number | undefined,
  maxOutputTokens: number | undefined,
  override: string | undefined
): number {
  const parsedOverride = Number(override)
  if (Number.isInteger(parsedOverride) && parsedOverride > 0) {
    return Math.min(parsedOverride, MAX_REQUESTED_OUTPUT_TOKENS)
  }
  const declared =
    typeof maxOutputTokens === 'number' && Number.isInteger(maxOutputTokens) && maxOutputTokens > 0
      ? maxOutputTokens
      : DEFAULT_REQUESTED_OUTPUT_TOKENS
  // A floored budget still has to leave room for the request; the bound never drops below the CLI's
  // own default, which at the inclusive window floor would otherwise pin a single token.
  const inputRoom =
    typeof contextWindow === 'number' && Number.isInteger(contextWindow)
      ? Math.max(contextWindow - MIN_AUTO_COMPACT_WINDOW, DEFAULT_REQUESTED_OUTPUT_TOKENS)
      : Number.POSITIVE_INFINITY
  return Math.min(declared, MAX_REQUESTED_OUTPUT_TOKENS, inputRoom)
}

export function resolveClaudeExecutablePath(): string {
  const sdkRequire = createRequire(require_.resolve('@anthropic-ai/claude-agent-sdk'))
  const extension = isWin ? '.exe' : ''
  const nativePackages = isLinux
    ? [
        `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`,
        `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`
      ]
    : [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`]

  for (const packageName of nativePackages) {
    try {
      return toAsarUnpackedPath(sdkRequire.resolve(`${packageName}/claude${extension}`))
    } catch {
      // Optional native packages are platform-specific; try the next candidate.
    }
  }

  throw new Error(
    `Claude Code native binary not found for ${process.platform}-${process.arch}. Reinstall @anthropic-ai/claude-agent-sdk with optional dependencies.`
  )
}

export async function getClaudeCodeLoginShellEnvironment(
  currentProxyEnvironment: Environment
): Promise<Record<string, string | undefined>> {
  let loginShellEnv = await getShellEnv()
  if (hasStaleCherryProxyMarkers(loginShellEnv, currentProxyEnvironment)) {
    loginShellEnv = await refreshShellEnv()
  }
  return stripInheritedCherryProxyMarkers(loginShellEnv)
}

export async function buildEnvironment(
  provider: Provider,
  agent: AgentEntity
): Promise<Record<string, string | undefined>> {
  const proxyEnvironment = getProxyEnvironment(process.env)
  const loginShellEnv = await getClaudeCodeLoginShellEnvironment(proxyEnvironment)
  const customGitBashPath = isWin ? autoDiscoverGitBash() : null
  const bunPath = await getBinaryPath('bun')

  // API key and base URL are injected by the agent-session runtime query builder.
  // This function only builds agent-specific env vars.

  // agent.model is UniqueModelId ("providerId::modelId"). DB lookup for
  // apiModelId, fall back to raw if missing.
  if (!agent.model) {
    throw new Error(`buildEnvironment: agent ${agent.id} has no model`)
  }
  const { providerId, modelId: rawModelId } = parseUniqueModelId(agent.model)
  const { providerId: sonnetProviderId, modelId: sonnetModelId } = parseUniqueModelId(agent?.planModel ?? agent.model)
  const { providerId: haikuProviderId, modelId: haikuModelId } = parseUniqueModelId(agent?.smallModel ?? agent.model)
  // Resolve each model id independently: one model missing from the table must not force the others
  // to fall back, and each falls back to its OWN raw id (not the main model's). Common for
  // agent-specific models that aren't in the model table.
  const resolveApiModelId = (providerKey: string, modelKey: string): string => {
    try {
      const model = modelService.getByKey(providerKey, modelKey)
      return model.apiModelId ?? modelKey
    } catch {
      return modelKey
    }
  }
  const apiModelId = resolveApiModelId(providerId, rawModelId)
  const sonnetApiModelId = resolveApiModelId(sonnetProviderId, sonnetModelId)
  const haikuApiModelId = resolveApiModelId(haikuProviderId, haikuModelId)

  const env: Record<string, string | undefined> = {
    ...loginShellEnv,
    ...proxyEnvironment,
    CLAUDE_CODE_USE_BEDROCK: '0',
    CLAUDE_CODE_USE_VERTEX: '0',
    // Umbrella opt-out (telemetry, error reporting, autoupdater, /bug). Not blocked below, so an
    // agent env_var of '' re-enables it. https://code.claude.com/docs/en/env-vars
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL are injected by the runtime query builder,
    // not duplicated here.
    ANTHROPIC_MODEL: apiModelId,
    ANTHROPIC_DEFAULT_OPUS_MODEL: apiModelId,
    ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetApiModelId,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuApiModelId,
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    CLAUDE_CONFIG_DIR: application.getPath('feature.agents.claude.root'),
    ENABLE_TOOL_SEARCH: 'auto',
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    // The stream adapter's background-work release waits for `session_state_changed: idle`
    // (streamAdapter.ts), which the CLI only emits when this flag is set.
    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1',
    CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1',
    CHERRY_STUDIO_BUN_PATH: bunPath,
    CHERRY_STUDIO_SKILLS_DIR: application.getPath('feature.agents.skills'),
    ...(customGitBashPath ? { CLAUDE_CODE_GIT_BASH_PATH: customGitBashPath } : {})
  }

  // Merge user-defined env vars with blocked list
  const userEnvVars = agent.configuration?.env_vars
  if (userEnvVars && typeof userEnvVars === 'object') {
    const BLOCKED_ENV_KEYS = new Set([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_NO_ATTACH_CONSOLE',
      'CLAUDE_CONFIG_DIR',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_GIT_BASH_PATH',
      'ENABLE_TOOL_SEARCH',
      'CHERRY_STUDIO_NODE_PROXY_RULES',
      'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
      'CHERRY_STUDIO_BUN_PATH',
      'CHERRY_STUDIO_SKILLS_DIR',
      'NODE_OPTIONS',
      '__PROTO__',
      'CONSTRUCTOR',
      'PROTOTYPE'
    ])
    for (const [key, value] of Object.entries(userEnvVars)) {
      if (BLOCKED_ENV_KEYS.has(key.toUpperCase())) {
        logger.warn('Blocked user env var override', { key })
      } else if (typeof value === 'string') {
        env[key] = value
      }
    }
  }

  // Claude Code (login) provider: reuse the user's Claude Code CLI subscription
  // login (Claude Pro/Max OAuth) instead of an API key. The Claude Agent SDK
  // falls back to the stored OAuth credential ONLY when no credential is forced
  // via env, so strip every auth channel that could ride in from the login shell
  // or user env_vars (which merged above) and silently override it: the API key
  // / auth token, a base-URL redirect, custom headers (e.g. an inherited
  // Authorization / x-api-key), and a directly-supplied OAuth token. The
  // warm-query builder already skips injecting the API key for this provider.
  // The Agent SDK only falls through to macOS Keychain lookup when CLAUDE_CONFIG_DIR
  // is absent; Cherry's isolated agent config dir would otherwise mask a valid
  // CLI login. Elsewhere credentials live in <CLAUDE_CONFIG_DIR>/.credentials.json,
  // so point at the user's real config dir (their shell's CLAUDE_CONFIG_DIR, or
  // ~/.claude) rather than Cherry's relocated agent config.
  if (isExternalCliProvider(provider)) {
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.ANTHROPIC_BASE_URL
    delete env.ANTHROPIC_CUSTOM_HEADERS
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    if (isMac) {
      delete env.CLAUDE_CONFIG_DIR
    } else {
      env.CLAUDE_CONFIG_DIR = loginShellEnv.CLAUDE_CONFIG_DIR || path.join(application.getPath('sys.home'), '.claude')
    }
  }

  return mergeAgentLoopbackProxyBypass(env)
}
