import fs from 'node:fs'
/**
 * Reads the failed message a doctor analysis is bound to. Everything returned here is headed for a
 * model prompt, so it is redacted and treated as untrusted text.
 */
import path from 'node:path'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { messageService } from '@data/services/MessageService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import { topicService } from '@data/services/TopicService'
import { extractAgentSessionId, isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { conversationPartEvidence } from '@main/ai/messages/conversationEvidence'
import { readConversation } from '@main/ai/messages/readConversation'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import { defangSystemReminderTags, sanitizeUntrustedText } from '@main/ai/untrustedContent'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { Message } from '@shared/data/types/message'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { DoctorAgentIncident } from '@shared/types/doctorAgent'
import type { Serializable } from '@shared/types/serializable'
import { SerializableSchema } from '@shared/utils/serializable'

import { redactForModel } from './doctorWrites'

const BODY_LIMIT = 4 * 1024
const ATTEMPT_MESSAGE_LIMIT = 300
const PART_TEXT_LIMIT = 500
const LOG_LINE_LIMIT = 1000
const LOG_FILES_SCANNED = 4

/** Upper bound on one tool result, so a long conversation cannot flood the doctor's context. */
const OUTPUT_LIMIT = 16 * 1024

/** Request-body keys that carry conversation content; only their counts and roles reach the model. */
const CONTENT_KEYS = new Set(['messages', 'input', 'contents', 'system', 'prompt', 'instructions', 'systemInstruction'])

const ERROR_FIELDS = [
  'name',
  'message',
  'code',
  'statusCode',
  'statusText',
  'url',
  'isRetryable',
  'finishReason',
  'providerId',
  'modelId',
  'toolName',
  'reason',
  'cause'
] as const

export type IncidentMessage = Message | AgentSessionMessageEntity

export function truncateText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}… [${text.length - limit} more chars]` : text
}

/** Redacts secrets, then neutralizes prompt-boundary tricks in every string. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Incident errors, conversation evidence, logs and native transcripts have different shapes; redact all values before neutralizing every model-bound string.
export function untrustedForModel(value: unknown): Serializable {
  const walk = (val: Serializable): Serializable => {
    if (typeof val === 'string') return defangSystemReminderTags(sanitizeUntrustedText(val))

    if (Array.isArray(val)) return val.map(walk)

    if (typeof val === 'object' && val !== null) {
      return Object.fromEntries(Object.entries(val).map(([key, item]) => [key, walk(item)]))
    }

    return val
  }

  return walk(redactForModel(value))
}

/** `readConversation` id: the topic id for chats, the bare session id for Agent sessions. */
export function conversationIdOf(topicId: string): string {
  return isAgentSessionTopic(topicId) ? extractAgentSessionId(topicId) : topicId
}

/** The incident message, or undefined once it was deleted. */
export function readIncidentMessage(incident: DoctorAgentIncident): IncidentMessage | undefined {
  const conversationId = conversationIdOf(incident.topicId)

  try {
    if (temporaryChatService.hasTopic(conversationId)) {
      return temporaryChatService.listMessages(conversationId).find((message) => message.id === incident.messageId)
    }

    const result = readConversation({ sessionId: conversationId, messageId: incident.messageId })

    return 'message' in result ? result.message : undefined
  } catch {
    return undefined
  }
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Stored error extensions are unvalidated; selected fields remain opaque until model-bound redaction.
function projectError(data: Record<string, unknown>) {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Projection limits field names but does not establish types for cause and provider extensions.
  const projected: Partial<Record<(typeof ERROR_FIELDS)[number], unknown>> & {
    responseBody?: string
    attempts?: Array<{ statusCode: unknown; message: string | undefined }>
  } = {}

  for (const field of ERROR_FIELDS) {
    if (data[field] !== undefined && data[field] !== null) projected[field] = data[field]
  }

  if (typeof data.responseBody === 'string') projected.responseBody = truncateText(data.responseBody, BODY_LIMIT)

  if (Array.isArray(data.errors)) {
    projected.attempts = data.errors.map((attempt) => {
      const { statusCode, message } = (attempt ?? {}) as { statusCode?: unknown; message?: unknown }

      return {
        statusCode,
        message: typeof message === 'string' ? truncateText(message, ATTEMPT_MESSAGE_LIMIT) : undefined
      }
    })
  }

  return projected
}

/** Every `data-error` part of the message, projected for the model. */
export function incidentErrors(message: IncidentMessage): Serializable[] {
  return (message.data.parts ?? []).flatMap((part) =>
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Historical message parts are not deep-validated; redaction owns the resulting value contract.
    part.type === 'data-error' ? [untrustedForModel(projectError(part.data as Record<string, unknown>))] : []
  )
}

function conversationKind(incident: DoctorAgentIncident): 'agent' | 'temporary' | 'topic' {
  if (isAgentSessionTopic(incident.topicId)) return 'agent'

  return temporaryChatService.hasTopic(incident.topicId) ? 'temporary' : 'topic'
}

function compactPart(part: Parameters<typeof conversationPartEvidence>[0]): Record<string, string | undefined> | null {
  const evidence = conversationPartEvidence(part)

  if (!evidence) return null

  return Object.fromEntries(
    Object.entries(evidence).map(([key, value]): [string, string | undefined] => {
      if (key === 'type' || key === 'state' || key === 'toolName') return [key, evidence[key]]

      if (value === undefined) return [key, undefined]
      const text = typeof value === 'string' ? value : JSON.stringify(value)

      return [key, truncateText(text, PART_TEXT_LIMIT)]
    })
  )
}

function compactMessage(message: IncidentMessage) {
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    createdAt: message.createdAt,
    modelId: message.modelId,
    parts: (message.data.parts ?? []).map(compactPart).filter((part) => part !== null)
  }
}

/** Where the failed message lives, which Agent or assistant produced it, and its errors. */
export function incidentOverview(incident: DoctorAgentIncident): Serializable {
  const kind = conversationKind(incident)
  const conversationId = conversationIdOf(incident.topicId)
  const message = readIncidentMessage(incident)

  let owner:
    | {
        workspaceType: ReturnType<typeof agentSessionService.getById>['workspace']['type']
        agent: Pick<
          NonNullable<ReturnType<typeof agentService.getAgent>>,
          'id' | 'type' | 'model' | 'mcps' | 'configuration'
        > | null
      }
    | Pick<ReturnType<typeof topicService.getById>, 'assistantId'>
    | { missing: true }
    | undefined

  try {
    if (kind === 'agent') {
      const session = agentSessionService.getById(conversationId)
      const agent = session.agentId ? agentService.getAgent(session.agentId) : null
      owner = {
        workspaceType: session.workspace.type,
        agent: agent && {
          id: agent.id,
          type: agent.type,
          model: agent.model,
          mcps: agent.mcps,
          configuration: agent.configuration
        }
      }
    } else if (kind === 'topic') {
      owner = { assistantId: topicService.getById(conversationId).assistantId }
    }
  } catch {
    owner = { missing: true }
  }

  return untrustedForModel({
    conversation: { kind, id: conversationId },
    owner,
    message: message ? compactMessage(message) : { missing: true },
    errors: message ? incidentErrors(message) : []
  })
}

function precedingMessages(incident: DoctorAgentIncident, count: number): IncidentMessage[] {
  const conversationId = conversationIdOf(incident.topicId)
  const kind = conversationKind(incident)

  if (kind === 'topic') return messageService.getPathToNode(incident.messageId, { last: count + 1 })

  if (kind === 'agent') {
    const { items } = agentSessionMessageService.listSessionMessages(conversationId, {
      messageId: incident.messageId,
      limit: count + 1
    })

    return items[0]?.id === incident.messageId ? items.toReversed() : []
  }

  const chronological = temporaryChatService.listMessages(conversationId)
  const index = chronological.findIndex((message) => message.id === incident.messageId)

  return index < 0 ? [] : chronological.slice(Math.max(0, index - count), index + 1)
}

/** The failed message and the `before` messages leading up to it, oldest first. */
export function incidentMessages(incident: DoctorAgentIncident, before: number): Serializable {
  let messages: ReturnType<typeof compactMessage>[]

  try {
    messages = precedingMessages(incident, before).map(compactMessage)
  } catch {
    messages = []
  }

  while (messages.length > 1 && JSON.stringify(messages).length > OUTPUT_LIMIT) messages.shift()
  const context = { messages }

  if (messages.length === 0) Object.assign(context, { missing: true })

  return untrustedForModel(context)
}

function truncateStrings(value: Serializable): Serializable {
  if (typeof value === 'string') return truncateText(value, LOG_LINE_LIMIT)

  if (Array.isArray(value)) return value.map(truncateStrings)

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncateStrings(item)]))
  }

  return value
}

/**
 * App log entries (oldest first) that name this conversation, from the most recent log files. Entries stay
 * parsed: text redaction on a raw JSON line treats a leading `agentSessionId` key as a secret and eats the line.
 */
export function incidentLogs(incident: DoctorAgentIncident, limit: number): Serializable {
  const ids = new Set([incident.topicId, conversationIdOf(incident.topicId)])
  const logsDir = application.getPath('app.logs')

  const files = fs.existsSync(logsDir)
    ? fs
        .readdirSync(logsDir)
        .filter((name) => name.endsWith('.log'))
        .map((name) => ({ name, mtime: fs.statSync(path.join(logsDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, LOG_FILES_SCANNED)
    : []

  const matches: Record<string, Serializable>[] = []

  for (const file of files) {
    for (const line of fs.readFileSync(path.join(logsDir, file.name), 'utf-8').split('\n')) {
      if (!line.startsWith('{')) continue
      let entry: Serializable

      try {
        entry = SerializableSchema.parse(JSON.parse(line))
      } catch {
        continue
      }

      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue

      if (![entry.topicId, entry.sessionId, entry.agentSessionId].some((id) => typeof id === 'string' && ids.has(id)))
        continue
      matches.push({
        file: file.name,
        ...Object.fromEntries(
          Object.entries(entry).map(([key, value]): [string, Serializable] => [key, truncateStrings(value)])
        )
      })
    }
  }

  matches.sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')))
  let entries = matches.slice(-limit)

  while (entries.length > 1 && JSON.stringify(entries).length > OUTPUT_LIMIT) entries = entries.slice(1)

  return untrustedForModel({ count: matches.length, entries })
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- Stored request values remain opaque until redaction; this projection only bounds content and selected fields.
function requestShape(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- This summary combines runtime content keys with raw parameters; model-bound redaction owns its output contract.
  const shape: Record<string, unknown> = { keys: Object.keys(body) }
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Measuring JSON length does not parse or validate the retained raw parameter values.
  const params: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body)) {
    if (CONTENT_KEYS.has(key)) {
      if (Array.isArray(value)) {
        const roles: Record<string, number> = {}

        for (const item of value) {
          const role = (item as { role?: unknown })?.role

          if (typeof role === 'string') roles[role] = (roles[role] ?? 0) + 1
        }

        shape[key] = { count: value.length, roles }
      } else if (typeof value === 'string') {
        shape[key] = { chars: value.length }
      }
    } else if (key === 'tools' && Array.isArray(value)) {
      shape.tools = value.map((tool) => {
        if (typeof tool !== 'object' || tool === null) return undefined

        if ('name' in tool && typeof tool.name === 'string') return tool.name
        const definition = 'function' in tool ? tool.function : undefined

        if (
          typeof definition === 'object' &&
          definition !== null &&
          'name' in definition &&
          typeof definition.name === 'string'
        ) {
          return definition.name
        }

        return 'type' in tool && typeof tool.type === 'string' ? tool.type : undefined
      })
    } else {
      const text = JSON.stringify(value)
      params[key] = text !== undefined && text.length > PART_TEXT_LIMIT ? truncateText(text, PART_TEXT_LIMIT) : value
    }
  }

  shape.params = params

  return shape
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Historical data-error.url is untyped alongside the current route URL; accept only valid strings when comparing request origins.
function originOf(url: unknown): string | undefined {
  try {
    return typeof url === 'string' ? new URL(url).origin : undefined
  } catch {
    return undefined
  }
}

/** Where the request went (now and at error time) and what it asked for, without any conversation text. */
export function incidentRequest(incident: DoctorAgentIncident): Serializable {
  const message = readIncidentMessage(incident)

  if (!message) return { missing: true }
  let route: { endpointType?: string; baseUrl?: string; optionsNamespace?: string; providerId: string } | undefined

  try {
    if (message.modelId) {
      // Pure resolution only: resolveSdkConfig would advance multi-key rotation and may refresh OAuth.
      const { providerId, modelId } = parseUniqueModelId(message.modelId as UniqueModelId)

      const { endpointType, baseUrl, providerOptionsKey } = resolveEffectiveEndpoint(
        providerService.getByProviderId(providerId),
        modelService.getByKey(providerId, modelId)
      )

      // Renamed: key-name redaction masks any field containing "Key".
      route = { providerId, endpointType, baseUrl, optionsNamespace: providerOptionsKey }
    }
  } catch {
    route = undefined
  }

  const requests = (message.data.parts ?? []).flatMap((part) => {
    if (part.type !== 'data-error') return []
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Historical error parts retain arbitrary requestBodyValues and expose only checked origins plus redacted projections.
    const data = part.data as Record<string, unknown>
    const errorOrigin = originOf(data.url)
    const routeOrigin = originOf(route?.baseUrl)

    return [
      {
        atError: { url: data.url, statusCode: data.statusCode },
        configChangedSinceError: errorOrigin && routeOrigin ? errorOrigin !== routeOrigin : undefined,
        requestShape: requestShape(data.requestBodyValues)
      }
    ]
  })

  return untrustedForModel({ modelId: message.modelId, route: route ?? { unresolved: true }, requests })
}

/** The Agent runtime's own transcript around the failure: API errors, retries, failing tools, hook errors. */
export async function incidentTranscript(incident: DoctorAgentIncident, maxEntries: number): Promise<Serializable> {
  if (conversationKind(incident) !== 'agent') return { unavailable: 'only Agent sessions keep a runtime transcript' }
  const sessionId = conversationIdOf(incident.topicId)
  const session = agentSessionService.getById(sessionId)
  const agent = session.agentId ? agentService.getAgent(session.agentId) : null
  const driver = agent ? runtimeDriverRegistry.getAgentSessionDriver(agent.type) : undefined

  if (!agent || !driver?.readTranscriptEvidence) {
    return { unavailable: `the ${agent?.type ?? 'unknown'} runtime keeps no readable transcript` }
  }

  const message = readIncidentMessage(incident) as AgentSessionMessageEntity | undefined
  // The message's own token survives forks and edits; the session's latest one is the fallback.
  const token = message?.runtimeResumeToken ?? agentSessionMessageService.getNativeSessionId(sessionId)
  const events = token ? await driver.readTranscriptEvidence(token, maxEntries) : undefined

  if (!events) return { unavailable: 'no transcript for this session (Claude-login sessions keep theirs in ~/.claude)' }
  let kept = events

  while (kept.length > 1 && JSON.stringify(kept).length > OUTPUT_LIMIT) kept = kept.slice(1)

  return untrustedForModel({ runtime: agent.type, events: kept })
}
