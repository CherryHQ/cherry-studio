import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import type { ComposerSerializedToken } from '../../../tokens'
import knowledgeBaseTool from '../knowledgeBaseTool'

const kb = (id: string, name = id): KnowledgeBase => ({ id, name }) as KnowledgeBase
const kbToken = (id: string): ComposerSerializedToken => ({
  id: `knowledge:${id}`,
  kind: 'knowledge',
  label: id,
  index: 0,
  textOffset: 0
})

function runReconcile(
  draft: ComposerSerializedToken[],
  prev: KnowledgeBase[],
  selectableKnowledgeBases: KnowledgeBase[] = []
): KnowledgeBase[] {
  const reconcile = knowledgeBaseTool.composer?.tokens?.reconcile
  if (!reconcile) throw new Error('knowledgeBaseTool must contribute tokens.reconcile')
  let result = prev
  const context = {
    state: { selectableKnowledgeBases },
    actions: {
      setSelectedKnowledgeBases: (updater: KnowledgeBase[] | ((p: KnowledgeBase[]) => KnowledgeBase[])) => {
        result = typeof updater === 'function' ? updater(prev) : updater
      }
    }
  } as unknown as Parameters<typeof reconcile>[1]
  reconcile(draft, context)
  return result
}

describe('knowledgeBaseTool token reconcile', () => {
  it('prunes a knowledge base when its token is removed', () => {
    expect(runReconcile([], [kb('a')])).toEqual([])
  })

  it('re-adds a pasted knowledge marker from selectableKnowledgeBases', () => {
    const a = kb('a')
    expect(runReconcile([kbToken('a')], [], [a])).toEqual([a])
  })

  it('does not duplicate an already-selected knowledge base', () => {
    const a = kb('a')
    expect(runReconcile([kbToken('a')], [a], [a])).toEqual([a])
  })

  it('ignores a marker with no matching selectable base', () => {
    expect(runReconcile([kbToken('x')], [], [])).toEqual([])
  })
})
