import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

export function clipText(value: string, budget: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value)
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(0, budget), { stream: true })
  return { text, truncated: bytes.length > Buffer.byteLength(text) }
}

function toolName(part: CherryMessagePart): string {
  return 'toolName' in part ? part.toolName : part.type.replace(/^tool-/, '')
}

export function reportedArtifacts(part: CherryMessagePart) {
  if (!('toolCallId' in part) || !('input' in part)) return undefined
  const name = toolName(part)
  if (name !== REPORT_ARTIFACTS_TOOL_NAME && !name.endsWith(`__${REPORT_ARTIFACTS_TOOL_NAME}`)) return undefined
  const parsed = reportArtifactsInputSchema.safeParse(part.input)
  return parsed.success ? parsed.data : undefined
}

function fileName(path: string): string {
  return clipText(
    path
      .replace(/[\\/]+$/g, '')
      .split(/[\\/]/)
      .at(-1) ?? '',
    512
  ).text
}

export function partDetails(part: CherryMessagePart) {
  const artifacts = reportedArtifacts(part)
  if (artifacts) return { type: 'artifacts', fields: { artifacts } }
  if (part.type === 'text' || part.type === 'reasoning') return { type: part.type, fields: { text: part.text } }
  if (part.type === 'data-code')
    return { type: 'code', language: clipText(part.data.language, 128).text, fields: { text: part.data.content } }
  if (part.type === 'file')
    return {
      type: 'artifact',
      fields: { artifact: { name: part.filename, mediaType: part.mediaType, source: 'file' } }
    }
  if ('toolCallId' in part)
    return {
      type: 'tool',
      name: clipText(toolName(part), 256).text,
      state: part.state,
      fields: {
        input: part.input,
        output: 'output' in part ? part.output : undefined,
        error: 'errorText' in part ? part.errorText : undefined
      }
    }
  if (part.type === 'data-error')
    return {
      type: 'error',
      fields: { error: { name: part.data.name, code: part.data.code, message: part.data.message } }
    }
  return { type: 'unsupported', kind: part.type, fields: {} }
}

type VisiblePart =
  | { type: 'text' | 'reasoning' | 'code'; partIndex: number; text: string; language?: string }
  | { type: 'artifact'; partIndex: number; artifactIndex?: number; name: string; mediaType?: string }
  | { type: 'error'; partIndex: number; code: string }

export function projectParts(parts: CherryMessagePart[], budget = 64 * 1024) {
  const visible: VisiblePart[] = []
  let detailsAvailable = false
  parts.forEach((part, partIndex) => {
    if (part.type === 'text' || part.type === 'reasoning') {
      visible.push({ type: part.type, partIndex, text: part.text })
    } else if (part.type === 'data-code') {
      visible.push({
        type: 'code',
        partIndex,
        text: part.data.content,
        language: clipText(part.data.language, 128).text
      })
    } else if (part.type === 'file') {
      visible.push({
        type: 'artifact',
        partIndex,
        name: fileName(part.filename ?? ''),
        mediaType: clipText(part.mediaType, 128).text
      })
      detailsAvailable = true
    } else if (part.type === 'data-error') {
      visible.push({ type: 'error', partIndex, code: clipText(part.data.code ?? 'AGENT_ERROR', 128).text })
      detailsAvailable = true
    } else {
      const report = reportedArtifacts(part)
      report?.artifacts.forEach((artifact, artifactIndex) => {
        visible.push({ type: 'artifact', partIndex, artifactIndex, name: fileName(artifact.path) })
      })
      detailsAvailable ||= 'toolCallId' in part
    }
  })

  const selected = visible.slice(-128)
  const lastOutput = visible.findLast((part) => part.type === 'text' || part.type === 'code')
  if (lastOutput && !selected.includes(lastOutput)) selected[0] = lastOutput
  const hasReasoning = selected.some((part) => part.type === 'reasoning')
  const hasText = selected.some((part) => part.type === 'text' || part.type === 'code')
  let reasoningBudget = hasReasoning ? (hasText ? Math.floor(budget / 4) : budget) : 0
  let textBudget = budget - reasoningBudget
  let truncated = visible.length > selected.length
  // Reserve answer space independently and visit newest parts first so earlier steps cannot starve the final answer.
  const projected = selected
    .toReversed()
    .map((part) => {
      if (!('text' in part)) return part
      const value = clipText(part.text, part.type === 'reasoning' ? reasoningBudget : textBudget)
      const used = Buffer.byteLength(value.text)
      if (part.type === 'reasoning') reasoningBudget -= used
      else textBudget -= used
      truncated ||= value.truncated
      return { ...part, ...value, totalBytes: Buffer.byteLength(part.text) }
    })
    .reverse()
  return { parts: projected, truncated, detailsAvailable: detailsAvailable || truncated }
}

export function projectHistoryMessage(message: AgentSessionMessageEntity) {
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    ...projectParts(message.data.parts ?? [])
  }
}

export function projectStreamMessage(message: CherryUIMessage, budget?: number) {
  return { id: message.id, role: message.role, ...projectParts(message.parts, budget) }
}
