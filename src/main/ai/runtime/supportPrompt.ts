import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'

export const MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS =
  "You are Cherry Support, Cherry Studio's official built-in product support and feedback AI Agent. Be calm, warm, direct, and respectful."

const CONFLICTING_SDK_IDENTITY_MARKERS = [
  'You are Claude Code',
  "Anthropic's official CLI",
  "You are a Claude agent, built on Anthropic's Claude Agent SDK."
] as const
const CHERRY_SUPPORT_IDENTITY_MARKERS = ['official built-in product support', '官方内置的产品支持'] as const
const CHERRY_SUPPORT_IDENTITY_PREFIXES = [
  'You are Cherry Support',
  'You are Cherry Studio',
  'Your sole identity is Cherry Support',
  '你是 Cherry Support',
  '你是 Cherry Studio',
  '你唯一的身份是 Cherry Studio'
] as const

function containsMarker(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => text.includes(marker))
}

function isCherrySupportIdentity(text: string): boolean {
  return text.split('\n').some((line) => {
    const trimmed = line.trimStart()
    return (
      CHERRY_SUPPORT_IDENTITY_PREFIXES.some((prefix) => trimmed.startsWith(prefix)) &&
      containsMarker(trimmed, CHERRY_SUPPORT_IDENTITY_MARKERS)
    )
  })
}

function isConflictingSdkIdentity(text: string): boolean {
  const trimmed = text.trimStart()
  return CONFLICTING_SDK_IDENTITY_MARKERS.some((marker) => trimmed.startsWith(marker)) && !isCherrySupportIdentity(text)
}

function leadingStandingIdentityEnd(texts: readonly string[]): number {
  const cherryIndex = texts.findIndex(isCherrySupportIdentity)
  if (cherryIndex !== -1) return cherryIndex
  const firstInstructionIndex = texts.findIndex((text) => !isConflictingSdkIdentity(text))
  return firstInstructionIndex === -1 ? texts.length : firstInstructionIndex
}

function stripConflictingLeadingLines(section: string): string {
  const lines = section.split('\n')
  let start = 0
  while (start < lines.length && lines[start].trim() === '') start++
  while (start < lines.length && isConflictingSdkIdentity(lines[start])) start++
  return lines.slice(start).join('\n')
}

function stripLeadingConflictingIdentityText(text: string): string | undefined {
  const sections = text.split('\n\n')
  const leadingEnd = leadingStandingIdentityEnd(sections)
  const kept: string[] = []
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]
    if (index > leadingEnd) {
      kept.push(section)
      continue
    }
    if (index < leadingEnd) {
      if (!isConflictingSdkIdentity(section)) kept.push(section)
      continue
    }
    const stripped = stripConflictingLeadingLines(section).trim()
    if (stripped.length > 0) kept.push(stripped)
  }
  const remaining = kept.join('\n\n').trim()
  return remaining.length > 0 ? remaining : undefined
}

/** Replace Claude SDK identity text without weakening Cherry Support's standing identity. */
export function normalizeAnthropicSupportSystemPrompt(params: MessageCreateParams): MessageCreateParams {
  if (typeof params.system === 'string') {
    if (params.system.length === 0) return { ...params, system: MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS }
    const stripped = stripLeadingConflictingIdentityText(params.system)
    const system =
      stripped && isCherrySupportIdentity(stripped)
        ? stripped
        : [MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS, stripped].filter(Boolean).join('\n\n')
    if (system === params.system) return params
    return { ...params, system }
  }
  if (!Array.isArray(params.system)) return { ...params, system: MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS }
  if (params.system.length === 0) {
    return { ...params, system: [{ type: 'text', text: MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS }] }
  }
  const leadingEnd = leadingStandingIdentityEnd(params.system.map((block) => (block.type === 'text' ? block.text : '')))
  const system = params.system.flatMap((block, index) => {
    if (block.type !== 'text') return [block]
    if (index > leadingEnd) return [block]
    const stripped = stripLeadingConflictingIdentityText(block.text)
    if (!stripped) return []
    return stripped === block.text ? [block] : [{ ...block, text: stripped }]
  })
  if (!system.some((block) => block.type === 'text' && isCherrySupportIdentity(block.text))) {
    system.unshift({ type: 'text', text: MINIMAL_CHERRY_SUPPORT_INSTRUCTIONS })
  }
  return system.length === params.system.length && system.every((block, index) => block === params.system?.[index])
    ? params
    : { ...params, system }
}
