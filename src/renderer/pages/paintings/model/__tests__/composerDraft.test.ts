import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { describe, expect, it } from 'vitest'

import { appendComposerInputFiles, cardToDerivedDraft, type ComposerDraft } from '../composerDraft'
import type { PaintingData } from '../types/paintingData'

const makeEntry = (id: string): FileEntry =>
  ({ id, name: `${id}.png`, ext: 'png', size: 10, origin: 'internal' }) as unknown as FileEntry

const makeDraft = (overrides: Partial<ComposerDraft> = {}): ComposerDraft => ({
  sessionId: 's1',
  providerId: 'openai',
  model: 'gpt-image-1',
  mode: 'edit',
  prompt: 'a cat',
  params: { seed: '42' },
  inputFiles: [makeEntry('in-1')],
  ...overrides
})

const makeSource = (overrides: Partial<PaintingData> = {}): PaintingData => ({
  id: 'card-1',
  providerId: 'openai',
  model: 'gpt-image-1',
  mode: 'edit',
  prompt: 'a cat',
  params: { seed: '42' },
  files: [],
  ...overrides
})

describe('appendComposerInputFiles', () => {
  // "Add to chat": keep the current recipe, just add the image and re-seed.
  it('appends new files, preserves the recipe, and bumps the session', () => {
    const draft = makeDraft()
    const next = appendComposerInputFiles(draft, [makeEntry('in-2')])

    expect(next.inputFiles.map((file) => file.id)).toEqual(['in-1', 'in-2'])
    expect(next.sessionId).not.toBe(draft.sessionId)
    // Prompt / model / params / mode the user is composing are left untouched.
    expect(next.prompt).toBe('a cat')
    expect(next.model).toBe('gpt-image-1')
    expect(next.params).toEqual({ seed: '42' })
    expect(next.mode).toBe('edit')
  })

  it('dedupes by id and returns the same draft when nothing new is added', () => {
    const draft = makeDraft({ inputFiles: [makeEntry('in-1'), makeEntry('in-2')] })
    const next = appendComposerInputFiles(draft, [makeEntry('in-2')])

    expect(next).toBe(draft)
    expect(next.sessionId).toBe('s1')
  })
})

describe('cardToDerivedDraft (regenerate recipe)', () => {
  // "Regenerate": same prompt / model / params, no source image, forks a new card.
  it('carries the source recipe with empty inputs and no retry target', () => {
    const draft = cardToDerivedDraft(makeSource(), 'generate', [])

    expect(draft.mode).toBe('generate')
    expect(draft.inputFiles).toEqual([])
    expect(draft.prompt).toBe('a cat')
    expect(draft.model).toBe('gpt-image-1')
    expect(draft.params).toEqual({ seed: '42' })
    expect(draft.targetCardId).toBeUndefined()
  })
})
