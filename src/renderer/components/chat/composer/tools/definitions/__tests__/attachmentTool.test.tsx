import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { describe, expect, it } from 'vitest'

import type { ComposerSerializedToken } from '../../../tokens'
import attachmentTool from '../attachmentTool'

const file = (id: string): ComposerAttachment =>
  ({ fileTokenSourceId: `source-${id}`, path: `/tmp/${id}` }) as ComposerAttachment
const fileToken = (id: string): ComposerSerializedToken => ({
  id: `file:source-${id}`,
  kind: 'file',
  label: id,
  index: 0,
  textOffset: 0
})

function runReconcile(draft: ComposerSerializedToken[], prev: ComposerAttachment[]): ComposerAttachment[] {
  const reconcile = attachmentTool.composer?.tokens?.reconcile
  if (!reconcile) throw new Error('attachmentTool must contribute tokens.reconcile')
  let result = prev
  const context = {
    actions: {
      setFiles: (updater: ComposerAttachment[] | ((p: ComposerAttachment[]) => ComposerAttachment[])) => {
        result = typeof updater === 'function' ? updater(prev) : updater
      }
    }
  } as unknown as Parameters<typeof reconcile>[1]
  reconcile(draft, context)
  return result
}

describe('attachmentTool token reconcile', () => {
  it('prunes files whose file token was removed from the draft', () => {
    const kept = file('a')
    const removed = file('b')
    expect(runReconcile([fileToken('a')], [kept, removed])).toEqual([kept])
  })

  it('dedupes files that share a token id', () => {
    const first = file('a')
    const second = file('a')
    expect(runReconcile([fileToken('a')], [first, second])).toEqual([first])
  })

  it('returns the same array reference when nothing changes', () => {
    const prev = [file('a')]
    expect(runReconcile([fileToken('a')], prev)).toBe(prev)
  })

  it('only considers file tokens (a skill-only draft prunes all files)', () => {
    const skillToken: ComposerSerializedToken = { id: 'skill:x', kind: 'skill', label: 'x', index: 0, textOffset: 0 }
    expect(runReconcile([skillToken], [file('a')])).toEqual([])
  })
})
