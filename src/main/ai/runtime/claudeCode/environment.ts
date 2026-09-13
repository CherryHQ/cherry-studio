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
import { isAnthropicOfficialHost } from './contextWindowSuffix'

const logger = loggerService.withContext('ClaudeCodeEnvironment')

export const MIN_AUTO_COMPACT_WINDOW = 100_000
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
// Trust any channel that resolves to the official Anthropic endpoint — a custom
// provider cloned from the preset (or inheriting its endpoint type) reports an
// accurate window when it keeps the official baseUrl. Only a custom baseUrl
// proves an untrusted relay that can overstate the window (e.g. #18894).
// `claude-code` (external-cli) is the second official channel and is trusted alike.
function isTrustedClaudeChannel(provider?: Provider | null): boolean {
  if (provider == null) return false
  // A custom baseUrl confirms an untrusted channel that can overstate the
  // window (e.g. #18894). The preset itself defines `https://api.anthropic.com`,
  // which is merged into every provider's runtime endpointConfigs, so the check
  // must compare against that value rather than merely testing for existence.
  // "Official" reuses the shared host predicate from contextWindowSuffix so
  // suffix selection and compaction safety cannot disagree on the endpoint.
  const rawBaseUrl = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
  if (typeof rawBaseUrl === 'string' && rawBaseUrl.trim() !== '' && !isAnthropicOfficialHost(rawBaseUrl.trim())) {
    return false
  }
  if (isExternalCliProvider(provider)) return true
  if (provider.presetProviderId === 'anthropic' || provider.id === 'anthropic') {
    // An empty-string entry URL is falsy at runtime (getBaseUrl cascade and the
    // warmup `|| baseUrl` fallback), so traffic can still reach a relay — preset
    // trust needs an absent or explicitly official entry. Non-empty here means
    // official, since a custom baseUrl already returned false above.
    if (!Object.prototype.hasOwnProperty.call(provider.endpointConfigs ?? {}, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)) {
      return true
    }
    return typeof rawBaseUrl === 'string' && rawBaseUrl.trim() !== ''
  }
  // Speaking the Anthropic protocol does not prove the official endpoint: an
  // absent entry fails closed, and a URL-less entry still resolves through the
  // getBaseUrl cascade to another entry's host — so only cloud-SDK transports
  // with no URL at all (Bedrock / Vertex) stay trusted without a baseUrl.
  if (provider.defaultChatEndpoint !== ENDPOINT_TYPE.ANTHROPIC_MESSAGES) return false
  if (!Object.prototype.hasOwnProperty.call(provider.endpointConfigs ?? {}, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)) {
    return false
  }
  if (typeof rawBaseUrl === 'string' && rawBaseUrl.trim() !== '') return true
  const adapterFamily = provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.adapterFamily
  return adapterFamily === 'bedrock' || adapterFamily === 'google-vertex-anthropic'
}

/**
 * The context window the Claude Code runtime budgets against: the declared
 * window for trusted channels, the conservative 0.6-margined window for
 * untrusted relays that may overstate it (#18894).
 */
function resolveEffectiveClaudeContextWindow(
  contextWindow: number,
  requestedOutput: number,
  provider?: Provider | null
): number {
  if (isTrustedClaudeChannel(provider)) {
    return contextWindow
  }
  // For tiny windows the 0.6 margin would make the MIN floor even more
  // provider-unsafe (e.g. 100K * 0.6 = 60K - 32K = 28K room vs 68K raw room,
  // both capped to 100K). Skip the margin when the margined room falls below
  // MIN so the overflow magnitude is minimized; large windows where the
  // 256K/128K overstatement is plausible keep the conservative margin.
  const margined = Math.floor(contextWindow * COMPACTION_CLAUDE_SAFETY_MARGIN)
  const marginedRoom = margined - requestedOutput
  const rawRoom = contextWindow - requestedOutput
  // Only skip the conservative margin when BOTH rooms would be below
  // the SDK floor. For a 200K declared window the margined room is 88K
  // (<100K) but the raw room is 168K (>100K): the margin must stay to keep
  // the budget inside a 128K-real provider (100K vs 164K overflow). For a
  // tiny 100K window both rooms are below the floor and the SDK requires
  // 100K either way, so we pick the raw window to minimize overflow
  // magnitude (32K vs 72K). Large windows where the 256K/128K overstatement
  // is plausible keep the margin.
  const shouldSkipMargin = marginedRoom < MIN_AUTO_COMPACT_WINDOW && rawRoom < MIN_AUTO_COMPACT_WINDOW
  return shouldSkipMargin ? contextWindow : margined
}

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
  const isTrustedAnthropic = isTrustedClaudeChannel(provider)
  const effectiveContextWindow = resolveEffectiveClaudeContextWindow(contextWindow, requestedOutput, provider)
  const inputRoom = effectiveContextWindow - requestedOutput
  const budget = Math.floor(inputRoom * (1 - AUTO_COMPACT_ESTIMATE_MARGIN))
  const clamped = Math.min(Math.max(budget, MIN_AUTO_COMPACT_WINDOW), MAX_AUTO_COMPACT_WINDOW)
  if (isTrustedAnthropic) {
    return clamped
  }
  // For untrusted relays the MIN floor must not raise the budget above the
  // safety-adjusted input room (e.g. 100K/60K effective + 32K leaves 28K;
  // returning 100K would overflow the provider). The SDK requires
  // autoCompactWindow >= 100K, so a safety-adjusted room below MIN cannot
  // satisfy both constraints — the SDK floor wins and the margin is partially
  // undone for that tiny window. This only affects windows near the 100K
  // minimum (rare and unlikely to carry the 256K/128K overstatement from
  // #18894); large windows stay capped to their safety-adjusted room.
  const capped = Math.min(clamped, Math.max(inputRoom, 0))
  if (capped < MIN_AUTO_COMPACT_WINDOW) {
    // The safety-adjusted room cannot satisfy the SDK floor (>= 100K), so a
    // bounded window below MIN is SDK-invalid. Emit the MIN floor instead of
    // omitting the window: with the trigger knob fixed at 80% this compacts at
    // 80K input — earlier than any CLI default derived from a >= 100K context
    // pin — so history folds before an overstated provider limit is reached.
    return MIN_AUTO_COMPACT_WINDOW
  }
  return capped
}

/**
 * The per-request output cap the CLI may reserve alongside compacted history.
 * Providers bill input + max_tokens against the limit, so a large output cap on
 * an untrusted channel can outrun the safety-adjusted room even at the trigger
 * point (e.g. 80K trigger history + 128K output against a 153.6K room). Shrink
 * the cap to what fits beside trigger-point history; never below the CLI's own
 * default, which early-turn requests can still use. Trusted channels and
 * default-size caps already fit by construction and pass through untouched.
 */
export function resolveClaudeOutputCap(
  contextWindow: number | undefined,
  requestedOutput: number,
  provider: Provider | null | undefined,
  autoCompactWindow: number | undefined
): number {
  if (
    typeof contextWindow !== 'number' ||
    !Number.isInteger(contextWindow) ||
    autoCompactWindow === undefined ||
    isTrustedClaudeChannel(provider) ||
    requestedOutput <= DEFAULT_REQUESTED_OUTPUT_TOKENS
  ) {
    return requestedOutput
  }
  const effectiveContextWindow = resolveEffectiveClaudeContextWindow(contextWindow, requestedOutput, provider)
  const triggerRoom = Math.floor((autoCompactWindow * AUTO_COMPACT_TRIGGER_PCT) / 100)
  if (triggerRoom + requestedOutput <= effectiveContextWindow) {
    return requestedOutput
  }
  return Math.max(effectiveContextWindow - triggerRoom, DEFAULT_REQUESTED_OUTPUT_TOKENS)
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
