import { partEdits, type RuntimeMessage } from '@cherrystudio/agent-runtime'

import type { AgentRuntimeEvent } from '../types'

type TextChange = {
  part: number
  type: 'open' | 'append' | 'finish'
  kind: 'text' | 'reasoning'
  text?: string
  providerMetadata?: Extract<RuntimeMessage['parts'][number], { type: 'text' }>['providerMetadata']
}

export function observedParts(events: readonly AgentRuntimeEvent[]) {
  const kinds = new Map<string, TextChange['kind']>()
  const observed: Array<TextChange | RuntimeMessage['parts'][number]> = []
  for (const event of events) {
    if (!('ref' in event)) continue
    for (const edit of partEdits(event)) {
      if (edit.type === 'put') observed.push(edit.value)
      else if (edit.type === 'open') {
        kinds.set(`${event.ref.id}:${edit.part}`, edit.kind)
        observed.push(edit)
      } else if (edit.type === 'append' || edit.type === 'finish') {
        const kind = kinds.get(`${event.ref.id}:${edit.part}`)
        if (!kind && edit.type === 'finish') continue
        if (!kind) throw new Error('Text update before open')
        observed.push({ ...edit, kind })
      }
    }
  }
  return observed
}
