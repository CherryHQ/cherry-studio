import type {
  LivePartInput,
  MessageObservation,
  NativePartUpdate,
  RuntimePartEdit,
  ObservationPayload,
  ProjectionEvents
} from './contracts'

/** Routes ordered text edits through the same live operations as a native text stream. */
export function textPartUpdates(
  event: Extract<MessageObservation, { type: 'message.parts' }>
): Exclude<NativePartUpdate, { type: 'message.tool-output' }>[] | undefined {
  const updates: Exclude<NativePartUpdate, { type: 'message.tool-output' }>[] = []
  for (const edit of event.changes) {
    const { ref } = event
    const { part } = edit
    switch (edit.type) {
      case 'open':
        updates.push({
          type: 'message.text-open',
          ref,
          part,
          kind: edit.kind,
          ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
        })
        break
      case 'append':
        updates.push({ type: 'message.text-append', ref, part, text: edit.text })
        break
      case 'finish':
        updates.push({
          type: 'message.text-finish',
          ref,
          part,
          ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
        })
        break
      case 'correct':
      case 'put':
        return undefined
      default:
        edit satisfies never
    }
  }
  return updates
}

export function projectionEvents(event: ObservationPayload): ProjectionEvents {
  if (event.type === 'message.parts') return textPartUpdates(event) ?? [event]
  if ('part' in event) return [event]
  return [event]
}

export function partEdits(event: LivePartInput): readonly RuntimePartEdit[] {
  switch (event.type) {
    case 'message.parts':
      return event.changes
    case 'message.text-open':
      return [{ type: 'open', part: event.part, kind: event.kind, providerMetadata: event.providerMetadata }]
    case 'message.text-append':
      return [{ type: 'append', part: event.part, text: event.text }]
    case 'message.text-finish':
      return [
        {
          type: 'finish',
          part: event.part,
          ...(event.providerMetadata && { providerMetadata: event.providerMetadata })
        }
      ]
    case 'message.tool-output':
      return [{ type: 'put', part: event.part, value: event.tool }]
  }
}
