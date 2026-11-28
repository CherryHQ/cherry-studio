import { isDeepStrictEqual } from 'node:util'

import type { ItemRef, MessageObservation, RuntimeMessage, RuntimePartEdit } from './contracts'
import { applyRuntimePartEdit } from './stagePartUpdate'

type Part = RuntimeMessage['parts'][number]

/** Converts a native SDK's cumulative source to the smallest update supported by its evidence. */
export function messageObservation(
  ref: ItemRef,
  before: RuntimeMessage | undefined,
  message: RuntimeMessage,
  replaces?: readonly ItemRef[],
  indices?: readonly number[]
): MessageObservation {
  const reconcile = (): MessageObservation => ({ type: 'message.reconcile', message, replaces })
  if (
    !before ||
    replaces?.length ||
    before.role !== message.role ||
    !isDeepStrictEqual(before.metadata, message.metadata) ||
    message.parts.length < before.parts.length
  )
    return reconcile()

  const changes: RuntimePartEdit[] = []
  const changed = indices && new Set(indices)
  if (changed) for (let part = before.parts.length; part < message.parts.length; part++) changed.add(part)
  for (const part of changed ? [...changed].sort((left, right) => left - right) : message.parts.keys()) {
    const old = before.parts[part]
    const next = message.parts[part]
    if (old === next || isDeepStrictEqual(old, next)) continue
    if (!next || (old && old.type !== next.type)) return reconcile()
    if (next.type !== 'text' && next.type !== 'reasoning') {
      if (old?.type === 'dynamic-tool' && next.type === 'dynamic-tool' && old.toolCallId !== next.toolCallId)
        return reconcile()
      changes.push({ type: 'put', part, value: next })
      continue
    }
    if (next.state !== 'streaming' && next.state !== 'done') return reconcile()
    let prefix = ''
    if (old) {
      if (
        (old.type !== 'text' && old.type !== 'reasoning') ||
        old.state !== 'streaming' ||
        !isDeepStrictEqual(old.providerMetadata, next.providerMetadata) ||
        !next.text.startsWith(old.text)
      )
        return reconcile()
      prefix = old.text
    } else
      changes.push({
        type: 'open',
        part,
        kind: next.type,
        ...(next.providerMetadata && { providerMetadata: next.providerMetadata })
      })
    if (next.text.length > prefix.length) changes.push({ type: 'append', part, text: next.text.slice(prefix.length) })
    if (next.state === 'done') changes.push({ type: 'finish', part })
  }
  return { type: 'message.parts', ref, changes }
}

/** Applies one source's edits atomically; a mismatched source needs reconciliation. */
export function applyMessageParts(
  before: RuntimeMessage,
  changes: readonly RuntimePartEdit[]
): RuntimeMessage | undefined {
  if (!changes.length) return before
  const parts = before.parts.slice()
  for (const edit of changes) {
    const { part } = edit
    if (!Number.isSafeInteger(part) || part < 0 || part > parts.length) return
    const next = applyRuntimePartEdit(parts[part], edit)
    if (!next) return
    parts[part] = next
  }
  return { ...before, parts }
}

export function textEdits(
  index: number,
  old: Part | undefined,
  next: Extract<Part, { type: 'text' | 'reasoning' }>
): RuntimePartEdit[] {
  const { type: kind, text, state, providerMetadata } = next
  const changes: RuntimePartEdit[] = []
  let offset = 0
  if (!old) changes.push({ type: 'open', part: index, kind, ...(providerMetadata && { providerMetadata }) })
  else if (old.type === 'text' || old.type === 'reasoning') {
    if (old.type !== kind) return []
    if (
      old.state !== 'streaming' ||
      !text.startsWith(old.text) ||
      !isDeepStrictEqual(providerMetadata, old.providerMetadata)
    )
      return [{ type: 'correct', part: index, kind, text, state, ...(providerMetadata && { providerMetadata }) }]
    offset = old.text.length
  } else return []
  if (text.length > offset) changes.push({ type: 'append', part: index, text: text.slice(offset) })
  if (state === 'done') changes.push({ type: 'finish', part: index })
  return changes
}
