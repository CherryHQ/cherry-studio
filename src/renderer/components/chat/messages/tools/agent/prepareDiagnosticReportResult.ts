import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { isToolUIPart } from 'ai'

import { buildToolResponseFromPart } from '../toolResponse'

const PREPARE_DIAGNOSTIC_REPORT_TOOL_NAME = 'mcp__assistant__prepare_diagnostic_report'

export interface PrepareDiagnosticReportResult {
  readonly ok: true
  readonly description: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function parsePrepareDiagnosticReportResult(value: unknown): PrepareDiagnosticReportResult | undefined {
  if (isRecord(value) && value.isError === true) return undefined

  let candidate: unknown = value
  if (isRecord(value)) {
    candidate = value.structuredContent ?? value
    if (candidate === value && Array.isArray(value.content)) candidate = value.content
  }

  if (Array.isArray(candidate)) {
    candidate = parseJson(
      candidate
        .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
    )
  } else if (typeof candidate === 'string') {
    candidate = parseJson(candidate)
  }

  if (
    !isRecord(candidate) ||
    candidate.ok !== true ||
    typeof candidate.description !== 'string' ||
    candidate.description.trim().length === 0
  ) {
    return undefined
  }

  return { ok: true, description: candidate.description }
}

function isPrepareDiagnosticReportToolResponse(toolResponse: McpToolResponse | NormalToolResponse): boolean {
  const { tool } = toolResponse
  if (tool.name === PREPARE_DIAGNOSTIC_REPORT_TOOL_NAME || tool.id === PREPARE_DIAGNOSTIC_REPORT_TOOL_NAME) return true
  return (
    tool.type === 'mcp' &&
    'serverId' in tool &&
    tool.serverId === 'assistant' &&
    tool.name === 'prepare_diagnostic_report'
  )
}

function resultFromToolResponse(
  toolResponse: McpToolResponse | NormalToolResponse
): PrepareDiagnosticReportResult | undefined {
  if (toolResponse.status !== 'done' || !isPrepareDiagnosticReportToolResponse(toolResponse)) return undefined
  return parsePrepareDiagnosticReportResult(toolResponse.response)
}

export function getPrepareDiagnosticReportResult(
  value: CherryMessagePart | McpToolResponse | NormalToolResponse
): PrepareDiagnosticReportResult | undefined {
  if ('tool' in value) return resultFromToolResponse(value)
  if (isToolUIPart(value)) {
    if (value.state !== 'output-available') return undefined
    const toolResponse = buildToolResponseFromPart(value)
    return toolResponse ? resultFromToolResponse(toolResponse) : undefined
  }
  return undefined
}

export function findLatestPrepareDiagnosticReportResult(
  messages: readonly CherryUIMessage[],
  partsByMessageId: Readonly<Record<string, CherryMessagePart[]>>
): PrepareDiagnosticReportResult | undefined {
  let latest: PrepareDiagnosticReportResult | undefined
  for (const message of messages) {
    const parts = partsByMessageId[message.id] ?? message.parts
    for (const part of parts) latest = getPrepareDiagnosticReportResult(part) ?? latest
  }
  return latest
}
