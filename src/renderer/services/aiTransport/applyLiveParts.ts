import type { MessageTextChange } from '@renderer/types/message'
import { updatedPartValue, type LivePartPatch, type PartPlacement } from '@shared/ai/messageProjection'
import type { CherryMessagePart } from '@shared/data/types/message'

interface AddressedPart {
  messageId: string
  value: CherryMessagePart
  awaitingText: boolean
  turnOrigin: MessageTextChange['turnOrigin']
}

export function applyLiveParts(
  patches: readonly LivePartPatch[],
  readPart: (id: string) => AddressedPart | undefined,
  readPlacement: (messageId: string) => { turnOrigin: MessageTextChange['turnOrigin'] } | undefined
) {
  const changes = new Map<string, CherryMessagePart>()
  const inserted = new Map<string, AddressedPart & { placement: PartPlacement }>()
  const layout = new Set<string>()
  const text: MessageTextChange[] = []
  const at = (id: string) => inserted.get(id) ?? readPart(id)
  for (const patch of patches) {
    const { partId } = patch
    const slot = at(partId)
    if (patch.type === 'part-open' || patch.type === 'part-add') {
      const placement = patch.type === 'part-open' ? patch : patch.placement
      const row = readPlacement(placement.messageId)
      const after = placement.afterPartId ? at(placement.afterPartId) : undefined
      if (slot || !row || (placement.afterPartId && after?.messageId !== placement.messageId)) return
      const value = updatedPartValue(undefined, patch)!
      inserted.set(partId, {
        messageId: placement.messageId,
        turnOrigin: row.turnOrigin,
        placement,
        awaitingText: patch.type === 'part-open',
        value
      })
      changes.set(partId, value)
      layout.add(partId)
      if (patch.type === 'part-open' && patch.kind === 'text')
        text.push({ type: 'text-open', messageId: placement.messageId, partId, turnOrigin: row.turnOrigin })
      continue
    }
    if (!slot) return
    const before = changes.get(partId) ?? slot.value
    const value = updatedPartValue(before, patch)
    if (!value) return
    if (patch.type === 'part-append' && before.type === 'text')
      text.push({
        type: 'text-append',
        messageId: slot.messageId,
        partId,
        offset: before.text.length,
        text: patch.text,
        turnOrigin: slot.turnOrigin
      })
    if (patch.type === 'part-append' && slot.awaitingText && /\S/.test(patch.text)) layout.add(partId)
    if (patch.type === 'part-correct' && patch.part.type === 'text')
      text.push({
        type: 'text-correct',
        messageId: slot.messageId,
        partId,
        turnOrigin: slot.turnOrigin,
        text: patch.part.text
      })
    if (patch.type === 'part-put') {
      const progress =
        before.type === 'dynamic-tool' &&
        value.type === 'dynamic-tool' &&
        before.toolName === value.toolName &&
        ((before.state === 'output-available' &&
          before.preliminary &&
          value.state === 'output-available' &&
          value.preliminary) ||
          (value.state === 'input-streaming' && before.state === 'input-streaming'))
      if (!progress) layout.add(partId)
    } else if (
      patch.type === 'part-correct' ||
      (patch.type === 'part-finish' &&
        (value.type === 'reasoning' || value.type === 'text') &&
        (!value.text.trim() ||
          patch.providerMetadata !== undefined ||
          (value.type === 'text' && (/^(?:\.{3}|…)$/.test(value.text.trim()) || /[[【]/.test(value.text)))))
    ) {
      layout.add(partId)
    }
    changes.set(partId, value)
  }
  return { changes, layout, inserted, text }
}
