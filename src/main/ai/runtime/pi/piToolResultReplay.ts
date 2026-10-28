import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>
type PiContext = Parameters<PiStreamSimple>[1]

export function normalizePiToolResultReplay(context: PiContext): PiContext {
  const replacements = new Map<number, PiContext['messages'][number] | null>()
  let assistant: Extract<PiContext['messages'][number], { role: 'assistant' }> | undefined
  let results: number[] = []

  const finishSegment = () => {
    const calls =
      assistant && assistant.stopReason !== 'error' && assistant.stopReason !== 'aborted'
        ? assistant.content.filter((block) => block.type === 'toolCall')
        : []
    const idCounts = new Map<string, number>()
    for (const call of calls) {
      if (typeof call.id === 'string') idCounts.set(call.id, (idCounts.get(call.id) ?? 0) + 1)
    }
    const answered = new Set<string>()
    const anonymousNames = new Map<string, number>()
    for (const index of results) {
      const result = context.messages[index]
      if (result.role !== 'toolResult') continue
      if (typeof result.toolCallId === 'string') answered.add(result.toolCallId)
      else if (result.toolCallId === undefined && typeof result.toolName === 'string') {
        anonymousNames.set(result.toolName, (anonymousNames.get(result.toolName) ?? 0) + 1)
      }
    }
    const unanswered = calls.filter((call) => !(idCounts.get(call.id) === 1 && answered.has(call.id)))
    for (const index of results) {
      const result = context.messages[index]
      if (result.role !== 'toolResult' || result.toolCallId !== undefined) continue
      const candidates = unanswered.filter((call) => call.name === result.toolName)
      const call = candidates[0]
      replacements.set(
        index,
        typeof result.toolName === 'string' &&
          result.toolName.length > 0 &&
          anonymousNames.get(result.toolName) === 1 &&
          candidates.length === 1 &&
          typeof call.id === 'string' &&
          call.id.length > 0 &&
          idCounts.get(call.id) === 1
          ? { ...result, toolCallId: call.id }
          : null
      )
    }
    results = []
  }

  context.messages.forEach((message, index) => {
    if (message.role === 'assistant' || message.role === 'user') {
      finishSegment()
      assistant = message.role === 'assistant' ? message : undefined
    } else if (message.role === 'toolResult') results.push(index)
  })
  finishSegment()
  if (replacements.size === 0) return context
  const messages = context.messages.flatMap((message, index) => {
    if (!replacements.has(index)) return [message]
    const replacement = replacements.get(index)
    return replacement ? [replacement] : []
  })
  return { ...context, messages }
}

export function withPiToolResultReplay(streamSimple: PiStreamSimple): PiStreamSimple {
  return (model, context, options) => streamSimple(model, normalizePiToolResultReplay(context), options)
}
