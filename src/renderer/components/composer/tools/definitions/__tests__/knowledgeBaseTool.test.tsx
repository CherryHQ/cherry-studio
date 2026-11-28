import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import type { KnowledgeBase } from '@shared/data/types/knowledge'

import { COMPOSER_INPUT_MAX_LENGTH, serializeComposerDocument } from '../../../composerDraft'
import { createComposerInputAdapter, insertKnowledgeBaseTokenAtStart } from '../../../composerInputAdapter'
import { createComposerEditorPreset } from '../../../composerPreset'
import { tokenizePromptVariablesInEditor } from '../../../promptVariables'
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

describe('over-limit rejection rollback with the real editor pipeline', () => {
  let editor: Editor | undefined

  afterEach(() => {
    editor?.destroy()
    editor = undefined
  })

  function createEditor() {
    editor = new Editor({
      extensions: createComposerEditorPreset({}),
      content: '',
      onUpdate: ({ editor, transaction }) => {
        tokenizePromptVariablesInEditor(editor, transaction)
      }
    })
    return editor
  }

  const retrievalToken = {
    id: 'knowledge:kb-1',
    kind: 'knowledge' as const,
    label: 'Retrieval · Knowledge One',
    promptText: 'Search Knowledge One.'
  }

  it('converges a rejected over-limit insertion to an unchecked selection, with no re-add loop', () => {
    const currentEditor = createEditor()
    const adapter = createComposerInputAdapter(currentEditor)
    adapter.insertText('x'.repeat(COMPOSER_INPUT_MAX_LENGTH - 10), { tokenizeVariables: false })

    // The picker checked the base, but the real length guard refuses the insertion...
    expect(insertKnowledgeBaseTokenAtStart(currentEditor, retrievalToken)).toBe(false)

    // ...so the runtime reports the ACTUAL editor tokens through onTokensChange (the rollback),
    // and the real reconcile prunes the base the picker had checked (its checkbox derives from
    // selectedKnowledgeBases).
    const actualTokens = serializeComposerDocument(currentEditor).tokens
    expect(actualTokens).toEqual([])
    const base = kb('kb-1', 'Knowledge One')
    expect(runReconcile([...actualTokens], [base], [base])).toEqual([])

    // Convergence: reconciling the pruned state again changes nothing (no re-add loop).
    expect(runReconcile([...actualTokens], [], [base])).toEqual([])
  })

  it('keeps the selection when the real insertion succeeds', () => {
    const currentEditor = createEditor()
    expect(insertKnowledgeBaseTokenAtStart(currentEditor, retrievalToken)).toBe(true)

    const actualTokens = serializeComposerDocument(currentEditor).tokens
    expect(actualTokens.map((token) => token.id)).toEqual(['knowledge:kb-1'])
    const base = kb('kb-1', 'Knowledge One')
    expect(runReconcile([...actualTokens], [base], [base])).toEqual([base])
  })
})
