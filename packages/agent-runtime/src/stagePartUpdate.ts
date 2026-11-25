import { isToolUIPart } from 'ai'

import { snapshotToolPart } from './acceptedToolPart'
import type { LivePartInput, RuntimePart as Part, RuntimePartEdit } from './contracts'
import { immutable } from './immutable'
import { partEdits } from './textPartUpdates'

export function stagePartUpdate(
  input: LivePartInput,
  read: (index: number) => Part | undefined
): { parts: Map<number, Part>; event: LivePartInput } | undefined {
  if (input.type === 'message.text-append' && !input.text) return
  if (input.type === 'message.tool-output') {
    const before = read(input.part)
    if (
      before?.type !== 'dynamic-tool' ||
      !applyRuntimePartEdit(before, { type: 'put', part: input.part, value: input.tool })
    )
      return
    const tool = snapshotToolPart(input.tool)
    return { parts: new Map([[input.part, tool]]), event: immutable({ ...input, tool }) }
  }
  let event = input
  if (input.type === 'message.parts')
    event = {
      ...input,
      changes: input.changes.map((edit) =>
        edit.type === 'put' && isToolUIPart(edit.value) && edit.value.state === 'output-available'
          ? { ...edit, value: snapshotToolPart(edit.value) }
          : edit
      )
    }
  event = immutable(event)
  const parts = new Map<number, Part>()
  const at = (index: number) => parts.get(index) ?? read(index)
  for (const edit of partEdits(event)) {
    const index = edit.part
    if (!Number.isSafeInteger(index) || index < 0) return
    const old = at(index)
    if (!old && index > 0 && !at(index - 1)) return
    const value = applyRuntimePartEdit(old, edit)
    if (!value) return
    parts.set(index, immutable(value))
  }
  return { parts, event }
}

export function applyRuntimePartEdit(old: Part | undefined, edit: RuntimePartEdit): Part | undefined {
  switch (edit.type) {
    case 'open':
      return old
        ? undefined
        : {
            type: edit.kind,
            text: '',
            state: 'streaming',
            ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
          }
    case 'put':
      if (old && old.type !== edit.value.type) return
      if (
        old?.type === 'dynamic-tool' &&
        edit.value.type === 'dynamic-tool' &&
        (old.toolCallId !== edit.value.toolCallId ||
          (edit.value.state === 'output-available' &&
            edit.value.preliminary &&
            (old.state === 'output-error' ||
              old.state === 'output-denied' ||
              (old.state === 'output-available' && !old.preliminary))))
      )
        return
      return edit.value
    case 'correct':
      return old?.type === edit.kind
        ? {
            type: edit.kind,
            text: edit.text,
            state: edit.state,
            ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
          }
        : undefined
    case 'append':
    case 'finish':
      if ((old?.type !== 'text' && old?.type !== 'reasoning') || old.state !== 'streaming') return
      return edit.type === 'append'
        ? { ...old, text: old.text + edit.text }
        : {
            ...old,
            state: 'done',
            ...(edit.providerMetadata && { providerMetadata: { ...old.providerMetadata, ...edit.providerMetadata } })
          }
    default:
      return edit satisfies never
  }
}
