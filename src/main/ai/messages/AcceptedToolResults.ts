import { isDeepStrictEqual } from 'node:util'

import { snapshotToolPart } from '@cherrystudio/agent-runtime'
import { projectMessagePartForRenderer } from '@main/utils/messageOutputProjection'
import type { CherryMessagePart } from '@shared/data/types/message'

/** Results are admitted by actual tool updates; text publication only reuses their compact parts. */
export class AcceptedToolResults {
  private readonly results = new Map<
    string,
    { source: unknown; output: unknown; part: CherryMessagePart; serializedBytes: Buffer }
  >()

  constructor(private readonly topicId: string) {}

  accept(messageId: string, part: Extract<CherryMessagePart, { state: 'output-available' }>): CherryMessagePart {
    const accepted = snapshotToolPart(part)
    const output = accepted.output
    const serialized = JSON.stringify(output) ?? 'null'
    const projected = projectMessagePartForRenderer(accepted, this.topicId, messageId, serialized)
    this.results.set(`${messageId}\0${part.toolCallId}`, {
      source: part.output,
      output,
      part: projected,
      serializedBytes: Buffer.from(serialized)
    })
    return projected
  }

  project(
    messageId: string,
    part: Extract<CherryMessagePart, { state: 'output-available' }>,
    onChange?: () => void
  ): CherryMessagePart {
    const known = this.results.get(`${messageId}\0${part.toolCallId}`)
    if (!known || known.source !== part.output) {
      const projected = this.accept(messageId, part)
      onChange?.()
      return projected
    }
    if (isDeepStrictEqual({ ...part, output: undefined }, { ...known.part, output: undefined })) return known.part
    const projected: CherryMessagePart = {
      ...structuredClone({ ...part, output: undefined }),
      output: 'output' in known.part ? known.part.output : part.output
    }
    known.part = projected
    return projected
  }

  get(
    messageId: string,
    toolCallId: string
  ): { found: true; output: unknown; serializedBytes: Buffer } | { found: false } {
    const entry = this.results.get(`${messageId}\0${toolCallId}`)
    return entry ? { found: true, output: entry.output, serializedBytes: entry.serializedBytes } : { found: false }
  }

  clear(): void {
    this.results.clear()
  }

  remove(messageId: string, toolCallId: string): void {
    this.results.delete(`${messageId}\0${toolCallId}`)
  }
}
