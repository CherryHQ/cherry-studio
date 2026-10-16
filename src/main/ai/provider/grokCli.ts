import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gte, valid as validSemver } from 'semver'

import { loggerService } from '@logger'

/**
 * Request shaping for the Grok CLI provider (xAI's `cli-chat-proxy.grok.com`
 * Responses endpoint). Kept in its own module — free of the electron/app import
 * graph in `config.ts` — so the body/header coercion can be unit-tested
 * directly.
 *
 * xAI's proxy speaks the OpenAI Responses surface but with stricter edges than
 * the generic adapter emits: it wants `system`/`developer` turns hoisted into
 * top-level `instructions`, requires encrypted reasoning on replay, and does not
 * implement a few OpenAI-only knobs. The pi-xai-oauth extension solves the same
 * path the same way.
 */

const logger = loggerService.withContext('GrokCli')

/** xAI's current minimum Grok CLI version. Bump in source when the floor moves. */
const GROK_VERSION_FLOOR = '1.0.13'

/**
 * Pure selector: pick the best version string to send as `x-grok-client-version`
 * given the contents of `~/.grok/version.json` (or `null` if unreadable).
 *
 * Preference order:
 *  1. `stable_version` (preferred — tracks the user's latest stable CLI)
 *  2. `version` (fallback within the file)
 *  3. `floor` (when the file is absent, malformed, or below floor)
 */
export function pickGrokClientVersion(fileContents: string | null, floor: string = GROK_VERSION_FLOOR): string {
  if (typeof fileContents !== 'string' || fileContents.length === 0) return floor
  let parsed: unknown
  try {
    parsed = JSON.parse(fileContents)
  } catch {
    return floor
  }
  if (!parsed || typeof parsed !== 'object') return floor
  const obj = parsed as { stable_version?: unknown; version?: unknown }
  const candidate =
    typeof obj.stable_version === 'string' ? obj.stable_version : typeof obj.version === 'string' ? obj.version : null
  if (!candidate) return floor
  const trimmed = candidate.trim()
  if (!validSemver(trimmed)) return floor
  if (gte(trimmed, floor)) return trimmed
  logger.warn(`Installed Grok CLI ${trimmed} is below required floor ${floor}; clamping header.`)
  return floor
}

/**
 * Resolve the version string sent as `x-grok-client-version`.
 *
 * Reads `~/.grok/version.json` (the file the Grok CLI itself writes; `~/.grok`
 * is user-owned and same-user readable from the Electron main process). Honors
 * `GROK_CLIENT_VERSION_OVERRIDE` for emergency ops. Falls back to the floor
 * constant on any failure. Result is captured at module load and reused for
 * the lifetime of the process; restart Cherry Studio after updating the Grok
 * CLI to pick up the new version.
 */
export function resolveGrokClientVersion(): string {
  const override = process.env.GROK_CLIENT_VERSION_OVERRIDE?.trim()
  if (override) return override
  const filePath = path.join(os.homedir(), '.grok', 'version.json')
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`Failed to read ${filePath}; using floor ${GROK_VERSION_FLOOR}.`, err as Error)
    }
    return GROK_VERSION_FLOOR
  }
  return pickGrokClientVersion(raw)
}

const GROK_CLIENT_VERSION = resolveGrokClientVersion()

export interface GrokCliCredentials {
  accessToken: string
  /** The request's model id, sent back as the `x-grok-model-override` header. */
  modelId: string
}

/** `grok-cli/grok-build` → `grok-build`; lower-cases and drops any provider prefix. */
export function normalizeGrokModelId(modelId: string): string {
  return (modelId || '').toLowerCase().split('/').pop() || ''
}

function textFromResponsesContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
        return (part as Record<string, string>).text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Rewrite a generic OpenAI Responses payload (parsed object, mutated in place
 * and returned) into the shape xAI's Grok CLI proxy accepts.
 */
export function rewriteGrokCliResponsesBody(json: Record<string, any>): Record<string, any> {
  if (Array.isArray(json.input)) {
    const instructionParts: string[] = []
    json.input = json.input.filter((item: Record<string, any>) => {
      if (!item || typeof item !== 'object') return true
      // Unsigned reasoning from other providers cannot be replayed to the proxy.
      if (item.type === 'reasoning') return typeof item.encrypted_content === 'string' && !!item.encrypted_content
      if (typeof item.content === 'string' && item.content.length === 0) return false
      if (item.role !== 'developer' && item.role !== 'system') return true
      const text = textFromResponsesContent(item.content).trim()
      if (text) instructionParts.push(text)
      return false
    })
    if (instructionParts.length > 0) {
      json.instructions = [json.instructions, ...instructionParts]
        .filter((part) => typeof part === 'string' && part)
        .join('\n\n')
    }
  }

  if (json.response_format && !json.text) {
    json.text = { format: json.response_format }
    delete json.response_format
  }

  const modelId = normalizeGrokModelId(typeof json.model === 'string' ? json.model : '')
  const effort = json.reasoning?.effort
  // Legacy CLI models reject effort; newer models receive the already-resolved effort.
  if (modelId && modelId !== 'grok-build' && modelId !== 'grok-composer-2.5-fast' && effort) {
    json.reasoning = { effort }
  } else {
    delete json.reasoning
  }

  json.store ??= false
  const include = new Set<string>(Array.isArray(json.include) ? json.include : [])
  include.add('reasoning.encrypted_content')
  json.include = [...include]

  // xAI's proxy doesn't implement OpenAI's prompt_cache_retention knob.
  delete json.prompt_cache_retention

  return json
}

/**
 * Build the request headers for a Grok CLI proxy call: the OAuth bearer token
 * plus the Grok-CLI client markers the proxy authenticates against, layered
 * over whatever the SDK already set.
 */
export function buildGrokCliRequestHeaders(base: HeadersInit | undefined, creds: GrokCliCredentials): Headers {
  const headers = new Headers(base)
  headers.set('Authorization', `Bearer ${creds.accessToken}`)
  headers.set('x-grok-client-identifier', 'cherry-studio')
  headers.set('x-grok-client-version', GROK_CLIENT_VERSION)
  headers.set('x-xai-token-auth', 'xai-grok-cli')
  headers.set('x-authenticateresponse', 'authenticate-response')
  headers.set('x-grok-client-mode', 'interactive')
  const modelOverride = normalizeGrokModelId(creds.modelId)
  if (modelOverride) headers.set('x-grok-model-override', modelOverride)
  return headers
}
