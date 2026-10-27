import type { BetaContentBlock, BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages'

import type { ContentItem } from '@cherrystudio/agent-runtime'
import type { ClaudeObservation } from '@cherrystudio/agent-runtime-claude-code'
import type { MessageDecorator } from '@main/ai/agentSession/ThreadMessageProjection'
import { SystemReminderTextFilter } from '@main/ai/steerReminder'

import type { ClaudeCodeStreamAdapter } from './streamAdapter'

type Block = BetaContentBlock | BetaContentBlockParam

/** Rich native blocks captured with the normalized batch, scoped to one thread. */
export class ClaudeMessageMetadata {
  private readonly blocks = new Map<string, Block>()
  readonly items = new Map<string, ContentItem>()
  readonly removed = new Set<string>()

  constructor(private readonly adapter: ClaudeCodeStreamAdapter) {}

  accept(batch: ClaudeObservation): void {
    for (const native of batch.native) {
      const message = native.message
      if (message.type === 'assistant' || message.type === 'user') {
        const body = message.message as { content?: string | Block[] }
        const content =
          typeof body.content === 'string' ? [{ type: 'text' as const, text: body.content }] : body.content
        content?.forEach((block, index) => this.blocks.set(`${message.uuid}:${index}`, block))
      } else if (message.type === 'stream_event' && message.event.type === 'content_block_start') {
        for (const event of batch.events)
          if (event.type === 'item.upsert') this.blocks.set(event.item.ref.id, message.event.content_block)
      }
    }
    for (const event of batch.events) {
      if (event.type === 'snapshot') {
        this.items.clear()
        for (const item of event.items) this.items.set(item.ref.id, item)
      } else if (event.type === 'item.upsert') {
        for (const ref of event.replaces ?? []) this.items.delete(ref.id)
        this.items.set(event.item.ref.id, event.item)
      } else if (event.type === 'item.remove') {
        this.items.delete(event.ref.id)
        this.removed.add(event.ref.id)
      }
    }
    for (const uuid of batch.retracted)
      for (const id of this.blocks.keys()) if (id.startsWith(`${uuid}:`)) this.removed.add(id)
  }

  readonly decorate: MessageDecorator = (message, { item, result }) => {
    const block = this.blocks.get(item.ref.id)
    if (
      item.type === 'tool-call' &&
      block &&
      (block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use')
    )
      return this.adapter.decorateTool(message, block, result && this.blocks.get(result.ref.id))
    if (!block) return message
    if (block.type === 'image' && block.source.type === 'base64')
      return {
        ...message,
        parts: [
          {
            type: 'file',
            mediaType: block.source.media_type,
            url: `data:${block.source.media_type};base64,${block.source.data}`
          }
        ]
      }
    if (block.type === 'document' && block.source.type === 'base64')
      return {
        ...message,
        parts: [
          {
            type: 'file',
            mediaType: block.source.media_type,
            url: `data:${block.source.media_type};base64,${block.source.data}`
          }
        ]
      }
    if ((block.type === 'image' || block.type === 'document') && block.source.type === 'url')
      return {
        ...message,
        parts: [
          { type: 'file', mediaType: block.type === 'image' ? 'image/*' : 'application/pdf', url: block.source.url }
        ]
      }
    if (block.type === 'document' && block.source.type === 'text')
      return {
        ...message,
        parts: [
          {
            type: 'file',
            mediaType: 'text/plain',
            url: `data:text/plain;base64,${Buffer.from(block.source.data).toString('base64')}`
          }
        ]
      }
    if (block.type === 'redacted_thinking')
      return {
        ...message,
        parts: [
          { type: 'reasoning', text: '', state: 'done', providerMetadata: { anthropic: { redactedData: block.data } } }
        ]
      }
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (part.type === 'reasoning' && block.type === 'thinking' && typeof block.signature === 'string')
          return { ...part, providerMetadata: { anthropic: { signature: block.signature } } }
        if (part.type !== 'text') return part
        const filter = new SystemReminderTextFilter()
        const text = filter.write(part.text) + (part.state === 'streaming' ? '' : filter.flush())
        return {
          ...part,
          text,
          ...(block.type === 'text' && block.citations?.length
            ? { providerMetadata: { anthropic: { citations: JSON.parse(JSON.stringify(block.citations)) } } }
            : {})
        }
      })
    }
  }

  archive() {
    const items = [...this.items.values()].filter((item) => !item.ref.id.startsWith('live:'))
    return {
      items,
      aliases: Object.fromEntries(items.map((item) => [item.ref.id, item.ref.id])),
      removed: [...this.removed]
    }
  }
}
