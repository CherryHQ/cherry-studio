/**
 * Runtime-neutral tools of the in-process `doctor` MCP server.
 *
 * Reads are diagnostic-only; writes are requests the DoctorAgentService either runs (low-risk catalog fixes)
 * or records as proposals the user applies from the System Doctor panel. Every write carries a
 * `summary` the panel shows verbatim, so the model must say exactly what changes and why.
 */

import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
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

export interface DoctorToolResult {
  [key: string]: unknown
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  isError?: boolean
}

export enum ToolErrorCode {
  InvalidParams = -32602
}

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code?: ToolErrorCode
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

export interface DoctorTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: DoctorToolContext) => Promise<DoctorToolResult> | DoctorToolResult
}

const PROBE_TIMEOUT_MS = 15_000
const READ_FILE_MAX_BYTES = 128 * 1024
const READ_FILE_DEFAULT_LINES = 200
/** userData is full of user content (databases, transcripts, cookies), so only these app-state paths are readable. */
const READ_FILE_USERDATA_ALLOWLIST: readonly RegExp[] = [
  /^logs(\/|$)/,
  /^(Data\/)?config\.json$/,
  /^Toolchain(\/|$)/,
  /^Crashpad(\/|$)/
]
const DATA_API_GET_PATHS: readonly RegExp[] = [
  /^\/providers(?:\/[^/]+(?:\/api-keys)?)?$/,
  /^\/models(?:\/[^/]+\/[^/]+)?$/,
  /^\/assistants(?:\/[^/]+)?$/,
  /^\/agents(?:\/[^/]+)?$/,
  /^\/mcp-servers(?:\/[^/]+)?$/
]

export function isDataApiGetPath(path: string): boolean {
  return DATA_API_GET_PATHS.some((pattern) => pattern.test(path))
}

function json(value: unknown): DoctorToolResult {
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
): Promise<DoctorToolResult> {
  const outcome = await application.get('DoctorAgentService').requestWrite(ctx.sessionId, write, summary)
  return { ...json(outcome), ...(outcome.status === 'failed' ? { isError: true } : {}) }
}

const REPORT_TOOL: DoctorTool = {
  name: 'report',
  description:
    'Re-read the System Doctor report this analysis is bound to (same run the user sees). Use after a fix to confirm the finding changed; do not run the Doctor again.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: (_args, ctx) => json(application.get('DoctorAgentService').reportForSession(ctx.sessionId))
}

const DATA_API_TOOL: DoctorTool = {
  name: 'data_api',
  description: `Query Cherry Studio's business data (SQLite) through its internal REST-style Data API. Secrets are redacted in every response.

GET is limited to diagnostic configuration: /providers, /providers/{id}, /providers/{id}/api-keys (presence only), /models?providerId=, /assistants, /assistants/{id}, /agents, /agents/{id}, /mcp-servers, /mcp-servers/{id}.

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
      if (!isDataApiGetPath(path)) throw new ToolError(`GET is not allowed on ${path}`, ToolErrorCode.InvalidParams)
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

const PREFERENCE_TOOL: DoctorTool = {
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
    return requestWrite(
      ctx,
      { kind: 'preference_set', key: parsed.key, value: parsed.value },
      requireString(args, 'summary')
    )
  }
}

const PROBE_ENDPOINT_TOOL: DoctorTool = {
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

const DOCTOR_FIX_TOOL: DoctorTool = {
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
  const [userData, logs] = roots
  const resolved = realOrNearest(path.isAbsolute(requested) ? requested : path.join(userData, requested))
  const relative = path.relative(userData, resolved).split(path.sep).join('/')
  const readable =
    isSameOrInside(resolved, logs) ||
    (isSameOrInside(resolved, userData) && READ_FILE_USERDATA_ALLOWLIST.some((pattern) => pattern.test(relative)))
  if (!readable) {
    throw new ToolError(
      'Access denied: only logs, config.json, Toolchain and Crashpad are readable by the doctor',
      ToolErrorCode.InvalidParams
    )
  }
  if (isBlockedSourceFile(path.basename(resolved))) {
    throw new ToolError('Access denied: cannot read credential files', ToolErrorCode.InvalidParams)
  }
  return resolved
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertOpenedPathIsStillReadable(resolved: string, opened: fs.Stats): void {
  const current = resolveDoctorReadablePath(resolved)
  const currentStat = fs.lstatSync(current)
  if (!sameFileIdentity(opened, currentStat)) {
    throw new ToolError('Access denied: path changed while being opened', ToolErrorCode.InvalidParams)
  }
}

export function openDoctorReadablePath(resolved: string): { handle: number; stat: fs.Stats } {
  const initial = fs.lstatSync(resolved)
  if (initial.isSymbolicLink()) {
    throw new ToolError('Access denied: symbolic links are not readable by the doctor', ToolErrorCode.InvalidParams)
  }
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
  const nonBlock = typeof fs.constants.O_NONBLOCK === 'number' ? fs.constants.O_NONBLOCK : 0
  const handle = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow | nonBlock)
  try {
    const opened = fs.fstatSync(handle)
    if (!sameFileIdentity(initial, opened)) {
      throw new ToolError('Access denied: path changed while being opened', ToolErrorCode.InvalidParams)
    }
    assertOpenedPathIsStillReadable(resolved, opened)
    return { handle, stat: opened }
  } catch (error) {
    fs.closeSync(handle)
    throw error
  }
}

function listOpenedDirectory(resolved: string, handle: number): DoctorToolResult {
  if (process.platform !== 'linux') {
    throw new ToolError('Directory listing is unavailable on this platform', ToolErrorCode.InvalidParams)
  }
  const descriptorPath = `/proc/self/fd/${handle}`
  const entries = fs.readdirSync(descriptorPath, { withFileTypes: true }).map((entry) => {
    const entryStat = entry.isFile() ? fs.lstatSync(path.join(descriptorPath, entry.name)) : undefined
    return {
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
      ...(entryStat?.isFile() ? { size: entryStat.size } : {})
    }
  })
  assertOpenedPathIsStillReadable(resolved, fs.fstatSync(handle))
  return json({ path: resolved, entries })
}

const READ_FILE_TOOL: DoctorTool = {
  name: 'read_file',
  description:
    'Read an app-state file: anything in the log directory, plus userData-relative logs/, config.json, Data/config.json, Toolchain/ (managed tool installs) and Crashpad/ (crash dumps). Everything else in userData (databases, transcripts, cookies, user files) is refused. Linux can also list directories through a stable file descriptor; other platforms refuse directory listing. Relative paths resolve against userData. Files return their LAST `lines` lines (default 200) with secrets redacted.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path, or relative to userData (e.g. "logs" or "Toolchain")' },
      lines: { type: 'number', description: 'How many trailing lines to return (max 2000)' }
    },
    required: ['path'],
    additionalProperties: false
  },
  async handler(args) {
    const resolved = resolveDoctorReadablePath(requireString(args, 'path'))
    let opened: { handle: number; stat: fs.Stats }
    try {
      opened = openDoctorReadablePath(resolved)
    } catch (error) {
      if (error instanceof ToolError) throw error
      return { content: [{ type: 'text', text: `Not found: ${resolved}` }], isError: true }
    }
    try {
      if (opened.stat.isDirectory()) return listOpenedDirectory(resolved, opened.handle)
      if (!opened.stat.isFile()) {
        throw new ToolError('Access denied: path is not a regular file', ToolErrorCode.InvalidParams)
      }
      const lines = Math.min(Math.max(Number(args.lines) || READ_FILE_DEFAULT_LINES, 1), 2000)
      const start = Math.max(0, opened.stat.size - READ_FILE_MAX_BYTES)
      const buffer = Buffer.alloc(opened.stat.size - start)
      fs.readSync(opened.handle, buffer, 0, buffer.length, start)
      assertOpenedPathIsStillReadable(resolved, fs.fstatSync(opened.handle))
      const tail = buffer.toString('utf-8').split('\n').slice(-lines).join('\n')
      return json({ path: resolved, size: opened.stat.size, truncated: start > 0, text: redactSecretText(tail) })
    } finally {
      fs.closeSync(opened.handle)
    }
  }
}

export const DOCTOR_TOOLS: readonly DoctorTool[] = [
  READ_FILE_TOOL,
  REPORT_TOOL,
  DATA_API_TOOL,
  PREFERENCE_TOOL,
  PROBE_ENDPOINT_TOOL,
  DOCTOR_FIX_TOOL
]

export const DOCTOR_TOOL_NAMES = DOCTOR_TOOLS.map((tool) => tool.name)
