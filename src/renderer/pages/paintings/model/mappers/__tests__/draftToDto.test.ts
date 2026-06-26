import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { describe, expect, it } from 'vitest'

import type { ComposerDraft } from '../../composerDraft'
import { draftToCreateDto, draftToInflightCard, draftToUpdateDto } from '../draftToDto'

const makeEntry = (id: string): FileEntry =>
  ({ id, name: `${id}.png`, ext: 'png', size: 10, origin: 'internal' }) as unknown as FileEntry

const makeDraft = (overrides: Partial<ComposerDraft> = {}): ComposerDraft => ({
  sessionId: 's1',
  providerId: 'openai',
  model: 'gpt-image-1',
  mode: 'edit',
  prompt: 'a cat',
  params: { seed: '42', size: '1024x1024' },
  inputFiles: [makeEntry('in-1'), makeEntry('in-2')],
  ...overrides
})

describe('draftToDto', () => {
  // A draft with no targetCardId → create a brand-new card: no output yet, input
  // file ids carried. No status — `generating` is never persisted.
  it('builds a create DTO for a new card without a persisted status', () => {
    const dto = draftToCreateDto(makeDraft(), 'card-1')
    expect(dto).toEqual({
      id: 'card-1',
      providerId: 'openai',
      modelId: 'gpt-image-1',
      prompt: 'a cat',
      files: { output: [], input: ['in-1', 'in-2'] },
      mode: 'edit',
      params: { seed: '42', size: '1024x1024' }
    })
    expect(dto).not.toHaveProperty('status')
  })

  // A draft with targetCardId → update that card in place (retry): same recipe,
  // no id field. Status is left untouched so an interrupted retry stays retry-able.
  it('builds an update DTO for an in-place retry without touching status', () => {
    const dto = draftToUpdateDto(makeDraft())
    expect(dto).toEqual({
      providerId: 'openai',
      modelId: 'gpt-image-1',
      prompt: 'a cat',
      files: { output: [], input: ['in-1', 'in-2'] },
      mode: 'edit',
      params: { seed: '42', size: '1024x1024' }
    })
    expect(dto).not.toHaveProperty('status')
  })

  it('omits modelId when the draft carries no usable model', () => {
    expect(draftToCreateDto(makeDraft({ model: undefined }), 'card-2').modelId).toBeUndefined()
    expect(draftToUpdateDto(makeDraft({ model: '  ' })).modelId).toBeUndefined()
  })

  // The optimistic node + generation input: the draft's recipe with empty output,
  // a `generating` status, and unplaced canvas coords.
  it('builds the in-flight card from a draft', () => {
    expect(draftToInflightCard(makeDraft(), 'card-3')).toEqual({
      id: 'card-3',
      providerId: 'openai',
      model: 'gpt-image-1',
      mode: 'edit',
      prompt: 'a cat',
      params: { seed: '42', size: '1024x1024' },
      inputFiles: [makeEntry('in-1'), makeEntry('in-2')],
      files: [],
      status: 'generating',
      canvasX: null,
      canvasY: null,
      canvasW: null
    })
  })
})
