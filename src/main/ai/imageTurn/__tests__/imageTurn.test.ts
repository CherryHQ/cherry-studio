import type { UIMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { FileEntry } from '@shared/data/types/file'
import type { ImageGenerationSupport } from '@shared/data/types/model'
import { readCherryMeta } from '@shared/data/types/uiParts'
import type { FileUrlString } from '@shared/types/file'

import { collectImageTurnInput, imageTurnFileParts, imageTurnParamValues } from '../imageTurn'

const filePart = (id: string, mediaType = 'image/png') =>
  ({
    type: 'file',
    mediaType,
    url: `file:///files/${id}.png`,
    providerMetadata: { cherry: { fileEntryId: id } }
  }) as UIMessage['parts'][number]

const message = (role: 'user' | 'assistant', parts: UIMessage['parts']): UIMessage => ({
  id: `${role}-${Math.random()}`,
  role,
  parts
})

const support = (maxInputImages = 2): ImageGenerationSupport =>
  ({
    modes: {
      generate: { supports: { size: { type: 'enum', options: ['1024x1024'], default: '1024x1024' } } },
      edit: { maxInputImages, supports: { size: { type: 'enum', options: ['1024x1024'], default: '512x512' } } }
    }
  }) satisfies ImageGenerationSupport

describe('collectImageTurnInput', () => {
  it('uses the prompt and all supported images from the current user message for an edit', () => {
    const messages = [
      message('assistant', [filePart('older')]),
      message('user', [
        { type: 'text', text: '  Make the sky blue\nKeep the subject ' },
        filePart('a'),
        filePart('b'),
        filePart('c')
      ])
    ]

    expect(collectImageTurnInput(messages, support(2))).toEqual({
      prompt: 'Make the sky blue\nKeep the subject',
      inputImageIds: ['a', 'b'],
      mode: 'edit'
    })
  })

  it('uses the most recent assistant image on the active branch when the user sends no image', () => {
    const messages = [
      message('assistant', [filePart('old')]),
      message('user', [{ type: 'text', text: 'First edit' }]),
      message('assistant', [filePart('newer')]),
      message('user', [{ type: 'text', text: 'Make it warmer' }])
    ]

    expect(collectImageTurnInput(messages, support())).toMatchObject({ mode: 'edit', inputImageIds: ['newer'] })
  })

  it('generates without references when neither the user nor the branch has an image', () => {
    expect(
      collectImageTurnInput(
        [
          message('assistant', [{ type: 'text', text: 'No image' }]),
          message('user', [{ type: 'text', text: 'A red fox' }])
        ],
        support()
      )
    ).toEqual({ prompt: 'A red fox', inputImageIds: [], mode: 'generate' })
  })

  it('generates a new image on later turns for a generate-only model', () => {
    expect(
      collectImageTurnInput(
        [message('assistant', [filePart('previous')]), message('user', [{ type: 'text', text: 'Draw a cat' }])],
        { modes: { generate: { supports: {} } } }
      )
    ).toEqual({
      prompt: 'Draw a cat',
      inputImageIds: [],
      mode: 'generate'
    })
  })

  it('reports an edit-only model instead of sending a request it must reject', () => {
    const user = message('user', [{ type: 'text', text: 'Draw a fox' }])
    expect(() => collectImageTurnInput([user], { modes: { edit: { supports: {} } } })).toThrow(
      'requires an input image'
    )
  })

  it('sends attached images through the generate mode of a generate-only model', () => {
    // Seedream and friends accept references on generate; treating them as an edit request
    // would reject a model the registry itself says reads image input.
    const user = message('user', [{ type: 'text', text: 'Match this palette' }, filePart('ref')])

    expect(collectImageTurnInput([user], { modes: { generate: { maxInputImages: 1, supports: {} } } })).toEqual({
      prompt: 'Match this palette',
      inputImageIds: ['ref'],
      mode: 'generate'
    })
  })

  it('caps generate-mode references with the declared maximum', () => {
    const user = message('user', [{ type: 'text', text: 'Match these' }, filePart('a'), filePart('b'), filePart('c')])

    expect(collectImageTurnInput([user], { modes: { generate: { maxInputImages: 2, supports: {} } } })).toMatchObject({
      inputImageIds: ['a', 'b'],
      mode: 'generate'
    })
  })
})

describe('image turn materialization', () => {
  it('uses only defaults for the selected mode', () => {
    expect(imageTurnParamValues('edit', support())).toEqual({ size: '512x512' })
    expect(imageTurnParamValues('generate', support())).toEqual({ size: '1024x1024' })
  })

  it('returns persisted, addressable image parts with accurate MIME types', () => {
    const files: FileEntry[] = [
      { id: 'a', name: 'result', ext: 'jpg' },
      { id: 'b', name: 'no-extension', ext: null }
    ] as FileEntry[]
    const getUrl = vi.fn((id: string): FileUrlString => `file:///files/${id}`)

    const parts = imageTurnFileParts(files, getUrl)

    expect(parts).toMatchObject([
      { type: 'file', mediaType: 'image/jpeg', filename: 'result.jpg', url: 'file:///files/a' },
      { type: 'file', mediaType: 'image/png', filename: 'no-extension', url: 'file:///files/b' }
    ])
    expect(readCherryMeta(parts[0] as never)).toEqual({ fileEntryId: 'a' })
  })
})
