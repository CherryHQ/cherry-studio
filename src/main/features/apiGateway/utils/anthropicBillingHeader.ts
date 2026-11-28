import type { MessageCreateParams, MessageParam } from '@anthropic-ai/sdk/resources/messages'

// Claude Code prepends `x-anthropic-billing-header: ...` to the Anthropic system prompt;
// non-Anthropic relays that check official-client fingerprints reject it with HTTP 400 (#25526).
const LEADING_BILLING_HEADER_PATTERN =
  /^(?:[ \t]*\r?\n)*(?:[ \t]*x-anthropic-billing-header\s*:[^\r\n]*(?:\r?\n|$))+(?:[ \t]*\r?\n)*/i

type AgentInputMessage = MessageParam | { role: 'system'; content: MessageParam['content'] }
type SystemBlock = NonNullable<Exclude<MessageCreateParams['system'], string>>[number]
type MessageContentBlock = Exclude<MessageParam['content'], string>[number]

function stripLeadingBillingHeader(text: string): string {
  return LEADING_BILLING_HEADER_PATTERN.test(text) ? text.replace(LEADING_BILLING_HEADER_PATTERN, '') : text
}

function stripFromBlocks<T extends SystemBlock | MessageContentBlock>(
  blocks: readonly T[]
): { value: T[] | undefined; changed: boolean } {
  let changed = false
  const nextBlocks: T[] = []
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const stripped = stripLeadingBillingHeader(block.text)
      if (stripped !== block.text) {
        changed = true
        if (stripped.length > 0) nextBlocks.push({ ...block, text: stripped })
        continue
      }
    }
    nextBlocks.push(block)
  }

  if (!changed) return { value: [...blocks], changed: false }
  return { value: nextBlocks.length > 0 ? nextBlocks : undefined, changed: true }
}

function stripFromSystem(system: MessageCreateParams['system']): {
  value: MessageCreateParams['system']
  changed: boolean
} {
  if (typeof system === 'string') {
    const stripped = stripLeadingBillingHeader(system)
    if (stripped === system) return { value: system, changed: false }
    return { value: stripped.length > 0 ? stripped : undefined, changed: true }
  }
  if (!Array.isArray(system)) return { value: system, changed: false }
  return stripFromBlocks(system)
}

function stripFromInlineSystemContent(content: MessageParam['content']): {
  value: MessageParam['content'] | undefined
  changed: boolean
} {
  if (typeof content === 'string') {
    const stripped = stripLeadingBillingHeader(content)
    if (stripped === content) return { value: content, changed: false }
    return { value: stripped.length > 0 ? stripped : undefined, changed: true }
  }
  if (!Array.isArray(content)) return { value: content, changed: false }
  return stripFromBlocks(content)
}

/**
 * Remove leading `x-anthropic-billing-header:` lines from Anthropic `system` content
 * when forwarding to non-Anthropic endpoints, leaving user/assistant turns and tools intact.
 */
export function stripAnthropicBillingHeader(params: MessageCreateParams): MessageCreateParams {
  const systemResult = stripFromSystem(params.system)

  let messagesChanged = false
  const inputMessages: AgentInputMessage[] = params.messages
  const nextMessages: AgentInputMessage[] = []
  for (const msg of inputMessages) {
    if (msg.role === 'system') {
      const contentResult = stripFromInlineSystemContent(msg.content)
      if (contentResult.changed) {
        messagesChanged = true
        if (contentResult.value !== undefined) nextMessages.push({ ...msg, content: contentResult.value })
        continue
      }
    }
    nextMessages.push(msg)
  }

  if (!systemResult.changed && !messagesChanged) return params

  return {
    ...params,
    system: systemResult.value,
    ...(messagesChanged ? { messages: nextMessages as MessageCreateParams['messages'] } : {})
  }
}
