import type { Attributes, AttributeValue, SpanEntity, TokenUsage } from '@mcp-trace/trace-core/types/config'
import type { Attributes as OTelAttributes, AttributeValue as OTelAttributeValue, Link } from '@opentelemetry/api'
import type { TimedEvent } from '@opentelemetry/sdk-trace-base'

export interface ClaudeCodeTraceContext {
  topicId: string
  traceId: string
  modelName?: string
  sessionId: string
  turnId: string
  rootSpanId: string
}

export interface ClaudeCodeOtlpLogEvent {
  traceId: string
  spanId: string
  event: TimedEvent
}

type OtlpAnyValue = {
  stringValue?: string
  boolValue?: boolean
  intValue?: number | string
  doubleValue?: number | string
  arrayValue?: { values?: OtlpAnyValue[] }
  kvlistValue?: { values?: OtlpKeyValue[] }
  bytesValue?: string
}

type OtlpKeyValue = {
  key?: string
  value?: OtlpAnyValue
}

type OtlpSpan = {
  traceId?: string
  spanId?: string
  parentSpanId?: string
  name?: string
  kind?: string | number
  startTimeUnixNano?: string | number
  endTimeUnixNano?: string | number
  attributes?: OtlpKeyValue[]
  events?: Array<{
    timeUnixNano?: string | number
    name?: string
    attributes?: OtlpKeyValue[]
    droppedAttributesCount?: number
  }>
  links?: Array<{
    traceId?: string
    spanId?: string
    attributes?: OtlpKeyValue[]
  }>
  status?: {
    code?: string | number
    message?: string
  }
}

type OtlpLogRecord = {
  traceId?: string
  spanId?: string
  timeUnixNano?: string | number
  observedTimeUnixNano?: string | number
  severityText?: string
  severityNumber?: number
  body?: OtlpAnyValue
  attributes?: OtlpKeyValue[]
}

type TraceContextResolver = (traceId: string) => ClaudeCodeTraceContext | undefined

const KIND_BY_VALUE: Record<string, string> = {
  SPAN_KIND_INTERNAL: 'INTERNAL',
  SPAN_KIND_SERVER: 'SERVER',
  SPAN_KIND_CLIENT: 'CLIENT',
  SPAN_KIND_PRODUCER: 'PRODUCER',
  SPAN_KIND_CONSUMER: 'CONSUMER',
  INTERNAL: 'INTERNAL',
  SERVER: 'SERVER',
  CLIENT: 'CLIENT',
  PRODUCER: 'PRODUCER',
  CONSUMER: 'CONSUMER',
  '0': 'INTERNAL',
  '1': 'INTERNAL',
  '2': 'SERVER',
  '3': 'CLIENT',
  '4': 'PRODUCER',
  '5': 'CONSUMER'
}

const STATUS_BY_VALUE: Record<string, string> = {
  STATUS_CODE_UNSET: 'UNSET',
  STATUS_CODE_OK: 'OK',
  STATUS_CODE_ERROR: 'ERROR',
  UNSET: 'UNSET',
  OK: 'OK',
  ERROR: 'ERROR',
  '0': 'UNSET',
  '1': 'OK',
  '2': 'ERROR'
}

export class ClaudeCodeOtlpAdapter {
  static spansFromPayload(payload: unknown, resolveTraceContext: TraceContextResolver): SpanEntity[] {
    const result: SpanEntity[] = []
    const resourceSpans = arrayFrom((payload as { resourceSpans?: unknown })?.resourceSpans)

    for (const resourceSpan of resourceSpans) {
      const resourceAttributes = prefixAttributes(
        attributesFromKeyValues((resourceSpan as { resource?: { attributes?: OtlpKeyValue[] } }).resource?.attributes),
        'resource.'
      )
      const scopeSpans = arrayFrom((resourceSpan as { scopeSpans?: unknown }).scopeSpans)

      for (const scopeSpan of scopeSpans) {
        const scopeAttributes = prefixAttributes(
          attributesFromKeyValues((scopeSpan as { scope?: { attributes?: OtlpKeyValue[] } }).scope?.attributes),
          'scope.'
        )
        const spans = arrayFrom((scopeSpan as { spans?: unknown }).spans) as OtlpSpan[]

        for (const span of spans) {
          const entity = convertSpan(span, { ...resourceAttributes, ...scopeAttributes }, resolveTraceContext)
          if (entity) result.push(entity)
        }
      }
    }

    return result
  }

  static logEventsFromPayload(payload: unknown): ClaudeCodeOtlpLogEvent[] {
    const result: ClaudeCodeOtlpLogEvent[] = []
    const resourceLogs = arrayFrom((payload as { resourceLogs?: unknown })?.resourceLogs)

    for (const resourceLog of resourceLogs) {
      const resourceAttributes = prefixAttributes(
        attributesFromKeyValues((resourceLog as { resource?: { attributes?: OtlpKeyValue[] } }).resource?.attributes),
        'resource.'
      )
      const scopeLogs = arrayFrom((resourceLog as { scopeLogs?: unknown }).scopeLogs)

      for (const scopeLog of scopeLogs) {
        const scopeAttributes = prefixAttributes(
          attributesFromKeyValues((scopeLog as { scope?: { attributes?: OtlpKeyValue[] } }).scope?.attributes),
          'scope.'
        )
        const logRecords = arrayFrom((scopeLog as { logRecords?: unknown }).logRecords) as OtlpLogRecord[]

        for (const record of logRecords) {
          const event = convertLogRecord(record, { ...resourceAttributes, ...scopeAttributes })
          if (event) result.push(event)
        }
      }
    }

    return result
  }
}

function convertSpan(
  span: OtlpSpan,
  inheritedAttributes: Attributes,
  resolveTraceContext: TraceContextResolver
): SpanEntity | undefined {
  if (!span.traceId || !span.spanId || !isTraceId(span.traceId) || !isSpanId(span.spanId)) return undefined

  const traceId = span.traceId.toLowerCase()
  const spanId = span.spanId.toLowerCase()
  const parentSpanId = span.parentSpanId && isSpanId(span.parentSpanId) ? span.parentSpanId.toLowerCase() : undefined

  const attributes = {
    ...inheritedAttributes,
    ...attributesFromKeyValues(span.attributes)
  }
  const context = resolveTraceContext(traceId)
  const modelName = resolveModelName(attributes, context)
  const usage = resolveUsage(attributes)
  const events = span.events?.map(convertSpanEvent)
  const parentId = parentSpanId ?? (context?.rootSpanId && context.rootSpanId !== spanId ? context.rootSpanId : '')

  return {
    id: spanId,
    traceId,
    parentId,
    name: span.name || 'claude_code.span',
    startTime: unixNanoToMillis(span.startTimeUnixNano),
    endTime: span.endTimeUnixNano === undefined ? null : unixNanoToMillis(span.endTimeUnixNano),
    status: normalizeStatus(span.status?.code),
    kind: normalizeKind(span.kind),
    attributes: {
      ...attributes,
      ...resolveContentAttributes(span.name, attributes, events),
      ...(context
        ? {
            'trace.topicId': context.topicId,
            'trace.modelName': modelName ?? context.modelName ?? '',
            'cs.agent_session_id': context.sessionId,
            'cs.agent_turn_id': context.turnId
          }
        : {})
    },
    isEnd: span.endTimeUnixNano !== undefined,
    events,
    links: span.links?.map(convertLink).filter((link): link is Link => Boolean(link)),
    topicId: context?.topicId,
    modelName,
    ...(usage ? { usage } : {})
  }
}

function convertSpanEvent(event: NonNullable<OtlpSpan['events']>[number]): TimedEvent {
  return {
    name: event.name || 'event',
    time: unixNanoToHrTime(event.timeUnixNano),
    attributes: {
      'otel.signal': 'traces',
      ...otelAttributesFromKeyValues(event.attributes)
    },
    droppedAttributesCount: event.droppedAttributesCount ?? 0
  }
}

function convertLogRecord(record: OtlpLogRecord, inheritedAttributes: Attributes): ClaudeCodeOtlpLogEvent | undefined {
  if (!record.traceId || !record.spanId || !isTraceId(record.traceId) || !isSpanId(record.spanId)) return undefined

  const attributes: OTelAttributes = {
    'otel.signal': 'logs',
    ...toOtelAttributes(inheritedAttributes),
    ...otelAttributesFromKeyValues(record.attributes),
    ...(record.severityText ? { 'log.severity_text': record.severityText } : {}),
    ...(record.severityNumber !== undefined ? { 'log.severity_number': record.severityNumber } : {})
  }
  const body = anyValueToOtelAttributeValue(record.body)
  if (body !== undefined) attributes['log.body'] = body
  const eventName = typeof attributes['event.name'] === 'string' ? attributes['event.name'] : undefined

  return {
    traceId: record.traceId.toLowerCase(),
    spanId: record.spanId.toLowerCase(),
    event: {
      name:
        eventName ?? (record.severityText ? `claude_code.log.${record.severityText.toLowerCase()}` : 'claude_code.log'),
      time: unixNanoToHrTime(record.timeUnixNano ?? record.observedTimeUnixNano),
      attributes,
      droppedAttributesCount: 0
    }
  }
}

function convertLink(link: NonNullable<OtlpSpan['links']>[number]): Link | undefined {
  if (!link.traceId || !link.spanId || !isTraceId(link.traceId) || !isSpanId(link.spanId)) return undefined
  return {
    context: {
      traceId: link.traceId.toLowerCase(),
      spanId: link.spanId.toLowerCase(),
      traceFlags: 1
    },
    attributes: otelAttributesFromKeyValues(link.attributes)
  }
}

function attributesFromKeyValues(items: OtlpKeyValue[] | undefined): Attributes {
  const attrs: Attributes = {}
  for (const item of items ?? []) {
    if (!item.key) continue
    const value = anyValueToAttributeValue(item.value)
    if (value !== undefined) attrs[item.key] = value
  }
  return attrs
}

function prefixAttributes(attributes: Attributes, prefix: string): Attributes {
  const prefixed: Attributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    prefixed[`${prefix}${key}`] = value
  }
  return prefixed
}

function otelAttributesFromKeyValues(items: OtlpKeyValue[] | undefined): OTelAttributes {
  const attrs: OTelAttributes = {}
  for (const item of items ?? []) {
    if (!item.key) continue
    const value = anyValueToOtelAttributeValue(item.value)
    if (value !== undefined) attrs[item.key] = value
  }
  return attrs
}

function toOtelAttributes(attributes: Attributes): OTelAttributes {
  const attrs: OTelAttributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    const otelValue = attributeValueToOtelAttributeValue(value)
    if (otelValue !== undefined) attrs[key] = otelValue
  }
  return attrs
}

function anyValueToAttributeValue(value: OtlpAnyValue | undefined): AttributeValue | undefined {
  if (!value) return undefined
  if (value.stringValue !== undefined) return value.stringValue
  if (value.boolValue !== undefined) return value.boolValue
  if (value.intValue !== undefined) return Number(value.intValue)
  if (value.doubleValue !== undefined) return Number(value.doubleValue)
  if (value.bytesValue !== undefined) return value.bytesValue

  if (value.arrayValue) {
    return (value.arrayValue.values ?? [])
      .map(anyValueToAttributeValue)
      .filter((item): item is Exclude<AttributeValue, undefined> => item !== undefined) as AttributeValue
  }

  if (value.kvlistValue) {
    const result: Record<string, string | number | boolean> = {}
    for (const item of value.kvlistValue.values ?? []) {
      if (!item.key) continue
      const nested = anyValueToAttributeValue(item.value)
      if (typeof nested === 'string' || typeof nested === 'number' || typeof nested === 'boolean') {
        result[item.key] = nested
      }
    }
    return result
  }

  return undefined
}

function anyValueToOtelAttributeValue(value: OtlpAnyValue | undefined): OTelAttributeValue | undefined {
  return attributeValueToOtelAttributeValue(anyValueToAttributeValue(value))
}

function attributeValueToOtelAttributeValue(value: AttributeValue | undefined): OTelAttributeValue | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is string | number | boolean | { [key: string]: string | number | boolean } =>
        item !== undefined && item !== null
    )
    if (items.every((item): item is string => typeof item === 'string')) return items
    if (items.every((item): item is number => typeof item === 'number')) return items
    if (items.every((item): item is boolean => typeof item === 'boolean')) return items
    return JSON.stringify(items)
  }
  return JSON.stringify(value)
}

function resolveModelName(attributes: Attributes, context?: ClaudeCodeTraceContext): string | undefined {
  return (
    getString(attributes, 'model') ??
    getString(attributes, 'gen_ai.request.model') ??
    getString(attributes, 'modelName') ??
    context?.modelName
  )
}

function resolveUsage(attributes: Attributes): TokenUsage | undefined {
  const promptTokens =
    getNumber(attributes, 'input_tokens') ??
    getNumber(attributes, 'gen_ai.usage.input_tokens') ??
    getNumber(attributes, 'usage.input_tokens')
  const completionTokens =
    getNumber(attributes, 'output_tokens') ??
    getNumber(attributes, 'gen_ai.usage.output_tokens') ??
    getNumber(attributes, 'usage.output_tokens')
  const cacheReadTokens = getNumber(attributes, 'cache_read_tokens') ?? getNumber(attributes, 'cache_read_input_tokens')
  const cacheCreationTokens =
    getNumber(attributes, 'cache_creation_tokens') ?? getNumber(attributes, 'cache_creation_input_tokens')

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheCreationTokens === undefined
  ) {
    return undefined
  }

  const prompt = promptTokens ?? 0
  const completion = completionTokens ?? 0
  const promptDetails: Record<string, number> = {}
  if (cacheReadTokens !== undefined) promptDetails.cache_read_tokens = cacheReadTokens
  if (cacheCreationTokens !== undefined) promptDetails.cache_creation_tokens = cacheCreationTokens

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(Object.keys(promptDetails).length > 0 ? { prompt_tokens_details: promptDetails } : {})
  }
}

function resolveContentAttributes(
  spanName: string | undefined,
  attributes: Attributes,
  events: TimedEvent[] | undefined
): Attributes {
  const resolved: Attributes = {}

  if (attributes.inputs === undefined) {
    const inputs = resolveSpanInputs(spanName, attributes, events)
    if (inputs !== undefined) resolved.inputs = inputs
  }

  if (attributes.outputs === undefined) {
    const outputs = resolveSpanOutputs(spanName, attributes, events)
    if (outputs !== undefined) resolved.outputs = outputs
  }

  return resolved
}

function resolveSpanInputs(
  spanName: string | undefined,
  attributes: Attributes,
  events: TimedEvent[] | undefined
): AttributeValue | undefined {
  const direct =
    getAttribute(attributes, 'user_prompt') ??
    getAttribute(attributes, 'tool_input') ??
    getAttribute(attributes, 'tool_parameters') ??
    getEventAttribute(events, ['tool.output'], ['input', 'tool_input', 'tool.input'])

  if (direct !== undefined) return normalizeContentValue(direct)

  if (spanName === 'claude_code.llm_request') {
    return normalizeContentValue(
      pickAttributes(attributes, ['model', 'gen_ai.request.model', 'query_source', 'agent_id'])
    )
  }

  if (spanName === 'claude_code.tool') {
    return normalizeContentValue(
      pickAttributes(attributes, ['tool_name', 'file_path', 'full_command', 'skill_name', 'subagent_type'])
    )
  }

  if (spanName === 'claude_code.hook') {
    return normalizeContentValue(pickAttributes(attributes, ['hook_event', 'hook_name', 'hook_definitions']))
  }

  return normalizeContentValue(
    pickAttributes(attributes, ['new_context', 'system_prompt_preview', 'user_system_prompt', 'interaction.sequence'])
  )
}

function resolveSpanOutputs(
  spanName: string | undefined,
  attributes: Attributes,
  events: TimedEvent[] | undefined
): AttributeValue | undefined {
  const direct =
    getAttribute(attributes, 'response.model_output') ??
    getAttribute(attributes, 'model_output') ??
    getEventAttribute(events, ['tool.output'], ['output', 'tool_output', 'tool.output', 'result'])

  if (direct !== undefined) return normalizeContentValue(direct)

  if (spanName === 'claude_code.llm_request') {
    return normalizeContentValue(
      pickAttributes(attributes, [
        'request_id',
        'gen_ai.response.id',
        'stop_reason',
        'response.has_tool_call',
        'success'
      ])
    )
  }

  if (spanName?.startsWith('claude_code.tool')) {
    return normalizeContentValue(pickAttributes(attributes, ['result_tokens', 'success', 'error', 'duration_ms']))
  }

  return normalizeContentValue(pickAttributes(attributes, ['response.model_output', 'success', 'error']))
}

function getAttribute(attributes: Attributes, key: string): AttributeValue | undefined {
  const value = attributes[key]
  return value === undefined || value === null ? undefined : value
}

function getEventAttribute(
  events: TimedEvent[] | undefined,
  eventNames: string[],
  attributeKeys: string[]
): OTelAttributeValue | undefined {
  for (const event of events ?? []) {
    if (!eventNames.includes(event.name)) continue
    for (const key of attributeKeys) {
      const value = event.attributes?.[key]
      if (value !== undefined) return value
    }
  }
  return undefined
}

function pickAttributes(attributes: Attributes, keys: string[]): Record<string, AttributeValue> | undefined {
  const picked: Record<string, AttributeValue> = {}
  for (const key of keys) {
    const value = getAttribute(attributes, key)
    if (value !== undefined) picked[key] = value
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

function normalizeContentValue(value: unknown): AttributeValue | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

function getString(attributes: Attributes, key: string): string | undefined {
  const value = attributes[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getNumber(attributes: Attributes, key: string): number | undefined {
  const value = attributes[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function normalizeKind(kind: string | number | undefined): string {
  const key = kind === undefined ? 'SPAN_KIND_INTERNAL' : String(kind)
  return KIND_BY_VALUE[key] ?? key.replace(/^SPAN_KIND_/, '') ?? 'INTERNAL'
}

function normalizeStatus(status: string | number | undefined): string {
  const key = status === undefined ? 'STATUS_CODE_UNSET' : String(status)
  return STATUS_BY_VALUE[key] ?? 'UNSET'
}

function unixNanoToMillis(value: string | number | undefined): number {
  if (value === undefined) return Date.now()
  try {
    return Number(BigInt(String(value)) / 1_000_000n)
  } catch {
    return Date.now()
  }
}

function unixNanoToHrTime(value: string | number | undefined): [number, number] {
  if (value === undefined) {
    const now = Date.now()
    return [Math.floor(now / 1000), (now % 1000) * 1_000_000]
  }
  try {
    const nanos = BigInt(String(value))
    return [Number(nanos / 1_000_000_000n), Number(nanos % 1_000_000_000n)]
  } catch {
    const now = Date.now()
    return [Math.floor(now / 1000), (now % 1000) * 1_000_000]
  }
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isTraceId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value) && value !== '00000000000000000000000000000000'
}

function isSpanId(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value) && value !== '0000000000000000'
}
