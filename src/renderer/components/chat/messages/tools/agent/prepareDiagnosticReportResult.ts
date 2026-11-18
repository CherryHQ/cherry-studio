import { isToolUIPart } from 'ai'
import * as z from 'zod'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'
import {
  DIAGNOSTIC_DESCRIPTION_MAX_BYTES,
  diagnosticDescriptionByteLength,
  normalizeDiagnosticDescription
} from '@shared/utils/diagnostics'

import { buildToolResponseFromPart } from '../toolResponse'

const PREPARE_DIAGNOSTIC_REPORT_TOOL_NAME = 'mcp__assistant__prepare_diagnostic_report'

const prepareDiagnosticReportResultSchema = z.object({ ok: z.literal(true), description: z.string() })

export type PrepareDiagnosticReportResult = Readonly<z.infer<typeof prepareDiagnosticReportResultSchema>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parsePrepareDiagnosticReportResult(value: unknown): PrepareDiagnosticReportResult | undefined {
  if (isRecord(value) && value.isError === true) return undefined

  let candidate: unknown = value
  if (isRecord(value)) {
    candidate = value.structuredContent ?? value
    if (candidate === value && Array.isArray(value.content)) candidate = value.content
  }

  if (Array.isArray(candidate) || typeof candidate === 'string') {
    const text =
      typeof candidate === 'string'
        ? candidate
        : candidate
            .flatMap((item) => {
              const text = isRecord(item) && typeof item.text === 'string' ? item.text : ''
              return text ? [text] : []
            })
            .join('\n')
    try {
      candidate = JSON.parse(text)
    } catch {
      return undefined
    }
  }
  const parsed = prepareDiagnosticReportResultSchema.safeParse(candidate)
  if (!parsed.success || parsed.data.description.trim().length === 0) return undefined

  const description = normalizeDiagnosticDescription(parsed.data.description.trim())
  if (diagnosticDescriptionByteLength(description) > DIAGNOSTIC_DESCRIPTION_MAX_BYTES) return undefined

  return { ok: true, description }
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

export function getPrepareDiagnosticReportResult(
  toolResponse: McpToolResponse | NormalToolResponse
): PrepareDiagnosticReportResult | undefined {
  if (toolResponse.status !== 'done' || !isPrepareDiagnosticReportToolResponse(toolResponse)) return undefined
  return parsePrepareDiagnosticReportResult(toolResponse.response)
}

export function isPrepareDiagnosticReportResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available') return false

  const toolResponse = buildToolResponseFromPart(part)
  if (!toolResponse || !isPrepareDiagnosticReportToolResponse(toolResponse)) return false
  return isDeferredToolOutput(toolResponse.response) || getPrepareDiagnosticReportResult(toolResponse) !== undefined
}
