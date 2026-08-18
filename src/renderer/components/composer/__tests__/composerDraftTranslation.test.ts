import { describe, expect, it, vi } from 'vitest'

import { translateComposerDraft } from '../composerDraftTranslation'
import type { ComposerSerializedDraft } from '../tokens'

describe('translateComposerDraft', () => {
  it('translates user text while preserving token prompt text and rebasing its offset', async () => {
    const draft: ComposerSerializedDraft = {
      text: 'Hello KB world',
      tokens: [
        {
          id: 'knowledge:1',
          kind: 'knowledge',
          label: 'Knowledge base',
          promptText: 'KB',
          index: 0,
          textOffset: 6
        }
      ]
    }
    const translate = vi.fn(async (source: string) => source.replace('Hello', 'Hola').replace('world', 'mundo'))

    await expect(translateComposerDraft(draft, translate)).resolves.toEqual({
      text: 'Hola KB mundo',
      tokens: [expect.objectContaining({ id: 'knowledge:1', index: 0, textOffset: 5, promptText: 'KB' })]
    })
    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate.mock.calls[0][0]).not.toContain('KB')
  })

  it('preserves zero-width file tokens without translating attachment metadata', async () => {
    const draft: ComposerSerializedDraft = {
      text: 'Open this',
      tokens: [
        {
          id: 'file:1',
          kind: 'file',
          label: 'report.pdf',
          index: 0,
          textOffset: 5
        }
      ]
    }

    const translated = await translateComposerDraft(draft, async (source) =>
      source.replace('Open', 'Abrir').replace('this', 'esto')
    )

    expect(translated).toEqual({
      text: 'Abrir esto',
      tokens: [expect.objectContaining({ id: 'file:1', index: 0, textOffset: 6 })]
    })
  })

  it('fails closed when the translation drops token markers', async () => {
    const draft: ComposerSerializedDraft = {
      text: 'Hello KB',
      tokens: [
        {
          id: 'knowledge:1',
          kind: 'knowledge',
          label: 'Knowledge base',
          promptText: 'KB',
          index: 0,
          textOffset: 6
        }
      ]
    }

    await expect(translateComposerDraft(draft, async () => 'Hola')).rejects.toThrow(
      'Translation did not preserve composer token markers'
    )
  })

  it('skips drafts that contain no translatable user text', async () => {
    const translate = vi.fn(async (source: string) => source)
    const draft: ComposerSerializedDraft = {
      text: 'KB  ',
      tokens: [
        {
          id: 'knowledge:1',
          kind: 'knowledge',
          label: 'Knowledge base',
          promptText: 'KB',
          index: 0,
          textOffset: 0
        }
      ]
    }

    await expect(translateComposerDraft(draft, translate)).resolves.toBeNull()
    expect(translate).not.toHaveBeenCalled()
  })
})
