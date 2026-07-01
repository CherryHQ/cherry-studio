import { SPAN_NAME_TURN } from '@mcp-trace/trace-core'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ReactNode } from 'react'

import type { TraceNode } from './traceNode'

/**
 * Span-type presentation, table-driven instead of `if (isHttp)`.
 *
 * Every span kind (HTTP request, MCP tool call, model call) declares, as
 * data, its extra detail rows and its tab set. {@link buildSpanView} picks the
 * first matching presenter; `SpanDetail` renders the result generically and
 * knows nothing about span types. Add a kind = add one presenter, touch nothing
 * else.
 */

type Translate = (key: string) => string

/** A detail row: either a plain string value or rich content (e.g. a model logo). */
export interface SpanDetailRow {
  label: string
  value?: string
  content?: ReactNode
}

export interface SpanTab {
  value: string
  label: string
  /** Raw payload for the tab; `SpanDetail` formats it (pretty JSON / text). */
  data: unknown
}

export interface SpanView {
  rows: SpanDetailRow[]
  tabs: SpanTab[]
}

interface SpanPresenter {
  match: (node: TraceNode) => boolean
  build: (node: TraceNode, t: Translate) => SpanView
}

const attrsOf = (node: TraceNode): Record<string, unknown> => (node.attributes ?? {}) as Record<string, unknown>
const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/** Common tab set for spans without bespoke tabs: inputs / outputs / raw. */
function defaultTabs(node: TraceNode, t: Translate): SpanTab[] {
  return [
    { value: 'inputs', label: t('trace.inputs'), data: getSpanInputs(node) },
    { value: 'outputs', label: t('trace.outputs'), data: getSpanOutputs(node) },
    { value: 'raw', label: t('message.tools.raw'), data: rawData(node) }
  ]
}

/** Raw provider HTTP exchange (from the dev http-trace fetch). */
const httpPresenter: SpanPresenter = {
  match: (node) => attrsOf(node).tags === 'HTTP',
  build: (node, t) => {
    const a = attrsOf(node)
    return {
      rows: [
        { label: t('trace.requestMethod'), value: str(a['http.method']) ?? '' },
        { label: t('trace.requestUrl'), value: str(a['http.url']) ?? '' },
        { label: t('trace.responseStatus'), value: [a['http.status'], a['http.statusText']].filter(Boolean).join(' ') }
      ],
      tabs: [
        { value: 'inputs', label: t('trace.inputs'), data: a.inputs },
        { value: 'outputs', label: t('trace.outputs'), data: a.outputs },
        { value: 'requestHeaders', label: t('trace.requestHeaders'), data: a['http.request.headers'] },
        { value: 'responseHeaders', label: t('trace.responseHeaders'), data: a['http.response.headers'] },
        { value: 'raw', label: t('message.tools.raw'), data: rawData(node) }
      ]
    }
  }
}

/** MCP tool call: server identity in the rows, tool arguments as the input. */
const mcpPresenter: SpanPresenter = {
  match: (node) => attrsOf(node).tags === 'MCP',
  build: (node, t) => {
    const a = attrsOf(node)
    const call = parseMcpCall(a.inputs)
    const rows: SpanDetailRow[] = [
      { label: t('trace.serverName'), value: str(call?.server?.name) },
      { label: t('trace.serverType'), value: str(call?.server?.type) },
      { label: t('trace.serverDescription'), value: str(call?.server?.description) }
    ].filter((row) => row.value)
    return {
      rows,
      tabs: [
        { value: 'inputs', label: t('trace.inputs'), data: call ? call.args : getSpanInputs(node) },
        { value: 'outputs', label: t('trace.outputs'), data: getSpanOutputs(node) },
        { value: 'raw', label: t('message.tools.raw'), data: rawData(node) }
      ]
    }
  }
}

/** The `ai.turn` root span: turn boundary plus identity/shape rows. */
const turnPresenter: SpanPresenter = {
  match: (node) => node.name === SPAN_NAME_TURN,
  build: (node, t) => {
    const a = attrsOf(node)
    const rows: SpanDetailRow[] = []
    const model = modelRow(node, t)
    if (model) rows.push(model)
    const agent = str(a['gen_ai.agent.name'])
    if (agent) rows.push({ label: t('trace.agent'), value: agent })
    const operation = str(a['gen_ai.operation.name'])
    if (operation) rows.push({ label: t('trace.operation'), value: operation })
    if (a['cs.tool_calls'] != null) rows.push({ label: t('trace.toolCalls'), value: String(a['cs.tool_calls']) })
    rows.push({ label: t('trace.status'), value: String(node.status ?? '') })
    return {
      rows,
      tabs: [
        { value: 'inputs', label: t('trace.inputs'), data: a.inputs },
        { value: 'outputs', label: t('trace.outputs'), data: a.outputs },
        { value: 'raw', label: t('message.tools.raw'), data: rawData(node) }
      ]
    }
  }
}

/** A real model call (streamText / doStream): shows the model logo + its own token usage. */
const modelPresenter: SpanPresenter = {
  match: (node) => hasModelAttribute(node),
  build: (node, t) => {
    // Each span shows only its OWN provider-reported usage (per-request debug). The turn/message
    // total is owned by the durable `message.stats`, not re-summed across the span tree here.
    const usage = node.usage
    const rows: SpanDetailRow[] = []
    const model = modelRow(node, t)
    if (model) rows.push(model)
    if (usage) {
      const cachedTokens = getTokenDetail(usage, 'prompt_tokens_details', 'cached_tokens')
      const reasoningTokens = getTokenDetail(usage, 'completion_tokens_details', 'reasoning_tokens')
      rows.push({
        label: t('trace.tokenUsage'),
        content: (
          <div className="min-w-0 flex-1">
            <span className="text-destructive">{`↑${usage.prompt_tokens}`}</span>
            <span className="mx-1 text-muted-foreground">/</span>
            <span className="text-success">{`↓${usage.completion_tokens}`}</span>
            {cachedTokens ? (
              <span className="ms-2 text-muted-foreground">{`${t('trace.cachedTokens')} ${cachedTokens}`}</span>
            ) : null}
            {reasoningTokens ? (
              <span className="ms-2 text-muted-foreground">{`${t('trace.reasoningTokens')} ${reasoningTokens}`}</span>
            ) : null}
            <span className="ms-2 text-muted-foreground">{`Σ ${usage.total_tokens}`}</span>
          </div>
        )
      })
    }
    return { rows, tabs: defaultTabs(node, t) }
  }
}

function getTokenDetail(usage: unknown, detailsKey: string, tokenKey: string): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const details = (usage as Record<string, unknown>)[detailsKey]
  if (!details || typeof details !== 'object') return undefined
  const value = (details as Record<string, unknown>)[tokenKey]
  return typeof value === 'number' ? value : undefined
}

/** Fallback for tool-execution / hook / misc spans: no model, just inputs/outputs/raw. */
const genericPresenter: SpanPresenter = {
  match: () => true,
  build: (node, t) => ({ rows: [], tabs: defaultTabs(node, t) })
}

const PRESENTERS: SpanPresenter[] = [httpPresenter, mcpPresenter, turnPresenter, modelPresenter, genericPresenter]

export function buildSpanView(node: TraceNode, t: Translate): SpanView {
  const presenter = PRESENTERS.find((p) => p.match(node)) ?? genericPresenter
  return presenter.build(node, t)
}

/**
 * A model row belongs only on spans that *are* a model call, detected by a real
 * model attribute, NOT the `trace.modelName` every span inherits from its turn.
 */
function hasModelAttribute(node: TraceNode): boolean {
  const a = attrsOf(node)
  return Boolean(a['cs.model_id'] || a['ai.model.id'] || a['gen_ai.request.model'])
}

/** Model logo + name row, shared by the model-call and turn presenters. */
function modelRow(node: TraceNode, t: Translate): SpanDetailRow | undefined {
  const model = resolveSpanModel(node)
  if (!model) return undefined
  return {
    label: t('trace.model'),
    content: (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ModelAvatar model={model} size={16} className="shrink-0" />
        <span className="min-w-0 truncate text-foreground">{model.name}</span>
      </div>
    )
  }
}

/** Resolve a renderable model (id + name + providerId, for the avatar logo) from a span's attributes. */
function resolveSpanModel(node: TraceNode): { id: string; name: string; providerId?: string } | undefined {
  const attrs = attrsOf(node)
  const name = node.modelName ?? str(attrs.modelName) ?? str(attrs['ai.model.id'])
  if (!name) return undefined
  // Cherry's uniqueModelId (`provider::model`) lives on the turn span as `cs.model_id`.
  const uniqueId = attrs['cs.model_id']
  if (typeof uniqueId === 'string') {
    try {
      const { providerId, modelId } = parseUniqueModelId(uniqueId as UniqueModelId)
      if (providerId && modelId) return { id: modelId, name, providerId }
    } catch {
      // Not a uniqueModelId; fall through to the AI SDK attributes.
    }
  }
  // AI SDK provider spans carry `ai.model.provider` / `ai.model.id`.
  return { id: str(attrs['ai.model.id']) ?? name, name, providerId: str(attrs['ai.model.provider']) }
}

interface McpCall {
  server?: { name?: string; type?: string; description?: string }
  name?: string
  args?: unknown
}

/** Parse the MCP span input (`[{ server, name, args }]`) to its single call. */
function parseMcpCall(raw: unknown): McpCall | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw)
    const call = Array.isArray(parsed) ? parsed[0] : parsed
    return call && typeof call === 'object' ? (call as McpCall) : undefined
  } catch {
    return undefined
  }
}

function rawData(node: TraceNode) {
  return {
    id: node.id,
    traceId: node.traceId,
    parentId: node.parentId,
    name: node.name,
    status: node.status,
    kind: node.kind,
    topicId: node.topicId,
    modelName: node.modelName,
    usage: node.usage,
    attributes: node.attributes,
    events: node.events,
    links: node.links
  }
}

function getSpanInputs(node: TraceNode) {
  const attrs = node.attributes ?? {}
  return (
    attrs.inputs ??
    attrs.user_prompt ??
    attrs.tool_input ??
    attrs.tool_parameters ??
    getEventValue(node, ['user_prompt', 'claude_code.user_prompt'], ['prompt', 'log.body']) ??
    getEventValue(node, ['api_request_body', 'claude_code.api_request_body'], ['body', 'body_ref']) ??
    getEventValue(node, ['tool.output'], ['input', 'tool_input', 'tool.input']) ??
    pickAttributes(attrs, [
      'new_context',
      'system_prompt_preview',
      'user_system_prompt',
      'model',
      'gen_ai.request.model',
      'query_source',
      'tool_name',
      'file_path',
      'full_command',
      'skill_name',
      'subagent_type',
      'hook_event',
      'hook_name',
      'hook_definitions'
    ])
  )
}

function getSpanOutputs(node: TraceNode) {
  const attrs = node.attributes ?? {}
  return (
    attrs.outputs ??
    attrs['response.model_output'] ??
    attrs.model_output ??
    getEventValue(node, ['api_response_body', 'claude_code.api_response_body'], ['body', 'body_ref']) ??
    getEventValue(node, ['tool.output'], ['output', 'tool_output', 'tool.output', 'result']) ??
    getEventValue(node, ['tool_result', 'claude_code.tool_result'], ['tool_result', 'result', 'log.body']) ??
    pickAttributes(attrs, [
      'request_id',
      'gen_ai.response.id',
      'stop_reason',
      'response.has_tool_call',
      'result_tokens',
      'success',
      'error',
      'duration_ms'
    ])
  )
}

function getEventValue(node: TraceNode, eventNames: string[], keys: string[]) {
  for (const event of node.events ?? []) {
    if (!eventNames.includes(getEventName(event))) continue
    for (const key of keys) {
      const value = event.attributes?.[key]
      if (value !== undefined) return value
    }
  }
  return undefined
}

function getEventName(event: NonNullable<TraceNode['events']>[number]) {
  const name = event.attributes?.['event.name']
  return typeof name === 'string' ? name : event.name
}

function pickAttributes(attributes: NonNullable<TraceNode['attributes']>, keys: string[]) {
  const picked: Record<string, unknown> = {}
  for (const key of keys) {
    const value = attributes[key]
    if (value !== undefined) picked[key] = value
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}
