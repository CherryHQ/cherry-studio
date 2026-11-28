import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { FileMetadata } from '@renderer/types/file'

import { paintingGenerate } from '../../model/paintingPipeline'
import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingGeneration } from '../usePaintingGeneration'

vi.mock('../../model/paintingPipeline', () => ({ paintingGenerate: vi.fn() }))

describe('usePaintingGeneration', () => {
  it('retains image options changed while generation was running', async () => {
    MockUseDataApiUtils.resetMocks()
    const resultReady = Promise.withResolvers<FileMetadata[]>()
    vi.mocked(paintingGenerate).mockReturnValueOnce(resultReady.promise)
    const initial: PaintingData = {
      id: 'painting-1',
      providerId: 'openai',
      model: 'gpt-image-1',
      mode: 'generate',
      prompt: 'A garden',
      files: [],
      persistedAt: '2026-11-28T00:00:00Z',
      params: { size: '1024x1024', quality: 'medium' }
    }
    MockUseDataApiUtils.mockMutationSuccess('PATCH', '/paintings/:id', {
      id: initial.id,
      providerId: initial.providerId,
      modelId: initial.model,
      prompt: initial.prompt,
      files: { input: [], output: [] },
      orderKey: 'a0',
      createdAt: initial.persistedAt!,
      updatedAt: initial.persistedAt!
    })
    const { result } = renderHook(() => {
      const [painting, setPainting] = useState(initial)
      const generation = usePaintingGeneration({ painting, onPaintingChange: setPainting })
      return { painting, setPainting, ...generation }
    })
    let generation: Promise<void> | undefined
    act(() => {
      generation = result.current.generate([], () => {})
    })
    await waitFor(() => expect(result.current.generating).toBe(true))

    act(() => result.current.setPainting((painting) => ({ ...painting, params: { size: 'auto', quality: 'high' } })))
    const output = { id: 'generated-image' } as FileMetadata
    await act(async () => {
      resultReady.resolve([output])
      await generation
    })

    expect(result.current.painting.files).toEqual([output])
    expect(result.current.painting.params).toEqual({ size: 'auto', quality: 'high' })
    expect(result.current.generating).toBe(false)
  })
})
