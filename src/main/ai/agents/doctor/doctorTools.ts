/**
 * Runtime-neutral tools of the in-process `doctor` MCP server.
 *
 * Reads are open; writes are requests the DoctorAgentService either runs (low-risk catalog fixes)
 * or records as proposals the user applies from the System Doctor panel. Every write carries a
 * `summary` the panel shows verbatim, so the model must say exactly what changes and why.
 */

import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import type { NeutralTool, NeutralToolResult } from '@main/ai/agents/tools/types'
import { ToolError, ToolErrorCode } from '@main/ai/agents/tools/types'
import { isBlockedSourceFile } from '@main/ai/mcp/servers/assistant'
import { isSameOrInside } from '@main/utils/file'
import type { DoctorAgentWrite } from '@shared/types/doctorAgent'
import { isDoctorFixRequest } from '@shared/utils/doctor'
import { redactSecretText } from '@shared/utils/redaction'

import {
  assertNoSecretFields,
  isDataApiPatchPath,
  isPreferenceWritable,
  parsePreferenceWrite,
  PREFERENCE_WRITE_ALLOWLIST,
  queryDataApi,
  redactForModel
} from './doctorWrites'

export interface DoctorToolContext {
  readonly sessionId: string
}

const PROBE_TIMEOUT_MS = 15_000
const READ_FILE_MAX_BYTES = 128 * 1024
const READ_FILE_DEFAULT_LINES = 200
/** User content the doctor never needs; everything else under userData/logs is app state. */
const READ_FILE_BLOCKED_DIRS = [
  'Data/Files',
  'Data/KnowledgeBase',
  'Data/Notes',
  'Data/AgentTranscripts',
  'Data/Memory'
]

function json(value: unknown): NeutralToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolError(`'${key}' is required`, ToolErrorCode.InvalidParams)
  }
  return value
}

function optionalRecord(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolError(`'${key}' must be an object`, ToolErrorCode.InvalidParams)
  }
  return value as Record<string, unknown>
}

async function requestWrite(
  ctx: DoctorToolContext,
  write: DoctorAgentWrite,
  summary: string
): Promise<NeutralToolResult> {
  const outcome = await application.get('DoctorAgentService').requestWrite(ctx.sessionId, write, summary)
  return { ...json(outcome), ...(outcome.status === 'failed' ? { isError: true } : {}) }
}

const REPORT_TOOL: NeutralTool<DoctorToolContext> = {
  name: 'report',
  description:
    'Re-read the System Doctor report this analysis is bound to (same run the user sees). Use after a fix to confirm the finding changed; do not run the Doctor again.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: (_args, ctx) => json(application.get('DoctorAgentService').reportForSession(ctx.sessionId))
}

const DATA_API_TOOL: NeutralTool<DoctorToolContext> = {
  name: 'data_api',
  description: `Query Cherry Studio's business data (SQLite) through its internal REST-style Data API. Secrets are redacted in every response.

GET is open, e.g. /providers, /providers/{id}, /providers/{id}/api-keys (presence only), /models?providerId=, /assistants, /assistants/{id}, /agents, /agents/{id}, /mcp-servers, /mcp-servers/{id}, /topics/{id}, /messages?topicId=, /agent-sessions?agentId=.

PATCH is recorded as a proposal the user applies; allowed only on /providers/{id}, /mcp-servers/{id}, /assistants/{id}, /agents/{id}. Bodies are validated by the same schema the UI uses; a validation error comes back verbatim so you can correct it. Credential fields are refused.`,
  inputSchema: {
    type: 'object',
    properties: {
      method: { type: 'string', enum: ['GET', 'PATCH'] },
      path: { type: 'string', description: 'Route path starting with /, e.g. /providers/openai' },
      query: { type: 'object', description: 'Query parameters for GET', additionalProperties: true },
      body: { type: 'object', description: 'PATCH body', additionalProperties: true },
      summary: {
        type: 'string',
        description: 'PATCH only: one line the user will read, naming the exact change and why'
      }
    },
    required: ['method', 'path'],
    additionalProperties: false
  },
  async handler(args, ctx) {
    const method = requireString(args, 'method')
    const path = requireString(args, 'path')
    if (!path.startsWith('/')) throw new ToolError("'path' must start with /", ToolErrorCode.InvalidParams)
    if (method === 'GET') {
      const result = await queryDataApi({ method: 'GET', path, query: optionalRecord(args, 'query') })
      return { ...json(result), ...(result.error ? { isError: true } : {}) }
    }
    if (method !== 'PATCH') throw new ToolError(`Unsupported method: ${method}`, ToolErrorCode.InvalidParams)
    if (!isDataApiPatchPath(path)) {
      throw new ToolError(`PATCH is not allowed on ${path}`, ToolErrorCode.InvalidParams)
    }
    const body = optionalRecord(args, 'body')
    if (!body || Object.keys(body).length === 0) throw new ToolError("'body' is required", ToolErrorCode.InvalidParams)
    assertNoSecretFields(body)
    return requestWrite(ctx, { kind: 'data_api_patch', path, body }, requireString(args, 'summary'))
  }
}

const PREFERENCE_TOOL: NeutralTool<DoctorToolContext> = {
  name: 'preference',
  description: `Read or change user preferences (the settings store; keys like app.proxy.mode, chat.default_model_id, BootConfig.app.disable_hardware_acceleration).

list: every key and value, secrets redacted. get: one key. set: recorded as a proposal the user applies; allowed keys: ${Array.from(PREFERENCE_WRITE_ALLOWLIST).join(', ')}.`,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'get', 'set'] },
      key: { type: 'string' },
      value: { description: 'set only: the new value, in the type the key expects' },
      summary: { type: 'string', description: 'set only: one line the user will read, naming the change and why' }
    },
    required: ['action'],
    additionalProperties: false
  },
  async handler(args, ctx) {
    const action = requireString(args, 'action')
    const preferences = application.get('PreferenceService')
    if (action === 'list') return json(redactForModel(preferences.getAll()))
    const key = requireString(args, 'key')
    if (action === 'get') {
      const redacted = redactForModel({ [key]: preferences.get(key as never) }) as Record<string, unknown>
      return json({ key, value: redacted[key] })
    }
    if (action !== 'set') throw new ToolError(`Unknown action: ${action}`, ToolErrorCode.InvalidParams)
    if (!isPreferenceWritable(key)) {
      throw new ToolError(`Preference "${key}" is not writable by the doctor`, ToolErrorCode.InvalidParams)
    }
    if (!('value' in args)) throw new ToolError("'value' is required", ToolErrorCode.InvalidParams)
    let parsed: ReturnType<typeof parsePreferenceWrite>
    try {
      parsed = parsePreferenceWrite(key, args.value)
    } catch (error) {
      throw new ToolError(error instanceof Error ? error.message : String(error), ToolErrorCode.InvalidParams)
    }
    return requestWrite(ctx, { kind: 'preference_set', key: parsed.key, value: parsed.value }, requireString(args, 'summary'))
  }
}

const PROBE_ENDPOINT_TOOL: NeutralTool<DoctorToolContext> = {
  name: 'probe_endpoint',
  description:
    'Layered reachability of any URL: DNS, TLS handshake, proxy in use, HTTP status (HEAD, no body). Use it to distinguish a wrong base URL from a blocked network or a proxy problem. Local addresses are fine (Ollama, LM Studio).',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
    required: ['url'],
    additionalProperties: false
  },
  async handler(args) {
    const url = requireString(args, 'url')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new ToolError('Invalid URL', ToolErrorCode.InvalidParams)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ToolError('Only http(s) URLs can be probed', ToolErrorCode.InvalidParams)
    }
    const diagnosis = await application
      .get('NetworkService')
      .diagnoseEndpoint({ id: 'custom', url }, AbortSignal.timeout(PROBE_TIMEOUT_MS))
    return json(diagnosis)
  }
}

const DOCTOR_FIX_TOOL: NeutralTool<DoctorToolContext> = {
  name: 'doctor_fix',
  description:
    'Run a fix the System Doctor catalog declares for a failing check (the report lists them under actions of kind "fix"). Reversible fixes that need no relaunch run immediately and return the re-probed result; others become a proposal the user applies.',
  inputSchema: {
    type: 'object',
    properties: {
      checkId: { type: 'string' },
      fixId: { type: 'string' },
      target: { type: 'string', description: 'Only for targeted fixes such as an MCP server id' },
      summary: { type: 'string', description: 'One line the user will read, naming the fix and why' }
    },
    required: ['checkId', 'fixId', 'summary'],
    additionalProperties: false
  },
  async handler(args, ctx) {
    const binding = application.get('DoctorAgentService').reportBindingForSession(ctx.sessionId)
    const candidate = {
      scope: binding.scope,
      runId: binding.reportRunId,
      checkId: args.checkId,
      fixId: args.fixId,
      ...(typeof args.target === 'string' ? { target: args.target } : {})
    }
    if (!isDoctorFixRequest(candidate)) {
      throw new ToolError('The report declares no such fix for that check', ToolErrorCode.InvalidParams)
    }
    return requestWrite(ctx, { kind: 'doctor_fix', request: candidate }, requireString(args, 'summary'))
  }
}

function realOrNearest(target: string): string {
  let current = target
  const suffix: string[] = []
  while (true) {
    try {
      return path.join(fs.realpathSync(current), ...suffix)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return target
      suffix.unshift(path.basename(current))
      current = parent
    }
  }
}

/** Resolves a doctor-readable path or throws; roots are userData and the log directory. */
export function resolveDoctorReadablePath(requested: string): string {
  const roots = [application.getPath('app.userdata'), application.getPath('app.logs')].map(realOrNearest)
  const resolved = realOrNearest(path.isAbsolute(requested) ? requested : path.join(roots[0], requested))
  const root = roots.find((candidate) => isSameOrInside(resolved, candidate))
  if (!root)
    throw new ToolError('Access denied: path must be inside the app data or log directory', ToolErrorCode.InvalidParams)
  const relative = path.relative(root, resolved).split(path.sep).join('/')
  if (READ_FILE_BLOCKED_DIRS.some((dir) => relative === dir || relative.startsWith(`${dir}/`))) {
    throw new ToolError('Access denied: user content is not readable by the doctor', ToolErrorCode.InvalidParams)
  }
  if (isBlockedSourceFile(path.basename(resolved))) {
    throw new ToolError('Access denied: cannot read credential files', ToolErrorCode.InvalidParams)
  }
  return resolved
}

const READ_FILE_TOOL: NeutralTool<DoctorToolContext> = {
  name: 'read_file',
  description:
    'Read an app-owned file or list a directory inside the app data directory (userData) or the log directory: log files, crash dumps, MCP/Claude runtime settings, cache.json, config.json, Toolchain. Relative paths resolve against userData. Files return their LAST `lines` lines (default 200) with secrets redacted; user content (Files, KnowledgeBase, Notes, transcripts, memory) is refused.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path, or relative to userData (e.g. "logs" or "Data/Mcp")' },
      lines: { type: 'number', description: 'How many trailing lines to return (max 2000)' }
    },
    required: ['path'],
    additionalProperties: false
  },
  async handler(args) {
    const resolved = resolveDoctorReadablePath(requireString(args, 'path'))
    let stat: fs.Stats
    try {
      stat = fs.statSync(resolved)
    } catch {
      return { content: [{ type: 'text', text: `Not found: ${resolved}` }], isError: true }
    }
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((entry) => {
        const size = entry.isFile() ? fs.statSync(path.join(resolved, entry.name)).size : undefined
        return { name: entry.name, kind: entry.isDirectory() ? 'dir' : 'file', ...(size !== undefined ? { size } : {}) }
      })
      return json({ path: resolved, entries })
    }
    const lines = Math.min(Math.max(Number(args.lines) || READ_FILE_DEFAULT_LINES, 1), 2000)
    const start = Math.max(0, stat.size - READ_FILE_MAX_BYTES)
    const handle = fs.openSync(resolved, 'r')
    try {
      const buffer = Buffer.alloc(stat.size - start)
      fs.readSync(handle, buffer, 0, buffer.length, start)
      const tail = buffer.toString('utf-8').split('\n').slice(-lines).join('\n')
      return json({ path: resolved, size: stat.size, truncated: start > 0, text: redactSecretText(tail) })
    } finally {
      fs.closeSync(handle)
    }
  }
}

export const DOCTOR_TOOLS: readonly NeutralTool<DoctorToolContext>[] = [
  READ_FILE_TOOL,
  REPORT_TOOL,
  DATA_API_TOOL,
  PREFERENCE_TOOL,
  PROBE_ENDPOINT_TOOL,
  DOCTOR_FIX_TOOL
]

export const DOCTOR_TOOL_NAMES = DOCTOR_TOOLS.map((tool) => tool.name)
