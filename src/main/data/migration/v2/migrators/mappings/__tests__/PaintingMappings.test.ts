import { describe, expect, it, vi } from 'vitest'

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => loggerMock)
  }
}))

import { getPaintingFilter, transformLegacyPaintingRecord } from '../PaintingMappings'

describe('PaintingMappings', () => {
  const legacyParentFieldKey = ['parent', 'Id'].join('')

  it('maps DMXAPI edit and merge records into legacy granular modes', () => {
    expect(getPaintingFilter('dmxapi_paintings', { generationMode: 'edit' })).toEqual({
      providerId: 'dmxapi',
      mode: 'edit'
    })
    expect(getPaintingFilter('dmxapi_paintings', { generationMode: 'merge' })).toEqual({
      providerId: 'dmxapi',
      mode: 'merge'
    })
    expect(getPaintingFilter('dmxapi_paintings', { generationMode: 'generation' })).toEqual({
      providerId: 'dmxapi',
      mode: 'generate'
    })
  })

  it('preserves custom provider ids for openai-compatible records', () => {
    const result = transformLegacyPaintingRecord('openai_image_generate', {
      id: 'painting-1',
      providerId: 'my-custom-new-api',
      model: 'gpt-image-1',
      prompt: 'hello'
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        providerId: 'my-custom-new-api',
        modelId: 'my-custom-new-api::gpt-image-1'
      }
    })
  })

  it('warns when openai-compatible records need the legacy new-api fallback', () => {
    const result = transformLegacyPaintingRecord('openai_image_generate', {
      id: 'painting-1',
      model: 'gpt-image-1',
      prompt: 'hello'
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        providerId: 'new-api',
        modelId: 'new-api::gpt-image-1'
      },
      warnings: ['Defaulted missing OpenAI-compatible providerId to new-api']
    })
  })

  it('does not carry the legacy parent field into normalized painting rows', () => {
    const result = transformLegacyPaintingRecord('siliconflow_paintings', {
      id: 'painting-parentless',
      [legacyParentFieldKey]: 'legacy-parent',
      prompt: 'hello'
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 'painting-parentless',
        providerId: 'silicon',
        prompt: 'hello'
      }
    })
    expect(result.ok && legacyParentFieldKey in result.value).toBe(false)
  })

  it('migrates async-task legacy records by prompt and drops the non-persisted task id', () => {
    const ppioResult = transformLegacyPaintingRecord('ppio_edit', {
      id: 'painting-2',
      taskId: 'task-2',
      prompt: 'hello'
    })

    // The frozen-receipt row no longer carries params/taskId — records with a
    // prompt still migrate as slim rows; the legacy async task id is dropped.
    expect(ppioResult).toMatchObject({
      ok: true,
      value: { id: 'painting-2', providerId: 'ppio', prompt: 'hello' }
    })
    expect(ppioResult.ok && 'params' in ppioResult.value).toBe(false)
  })

  it('drops non-recoverable in-memory input image references with warnings', () => {
    const result = transformLegacyPaintingRecord('ppio_edit', {
      id: 'painting-3',
      prompt: 'hello',
      imageFile: 'blob:http://example.com/123'
    })

    expect(result).toMatchObject({
      ok: true,
      files: { input: [] }
    })
    expect(result.warnings).toContain(
      'Dropped legacy input image reference because only an in-memory string/object URL was available'
    )
  })

  it('skips placeholder records when only transient urls exist', () => {
    const result = transformLegacyPaintingRecord('siliconflow_paintings', {
      id: 'painting-4',
      prompt: '',
      urls: ['https://example.com/a.png']
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'empty_placeholder'
    })
  })

  it('does not log legacy record samples during transform', () => {
    transformLegacyPaintingRecord('siliconflow_paintings', {
      id: 'painting-private',
      prompt: 'private file',
      files: [{ id: 'file-1', name: 'local-name.png', path: 'C:/private/local-name.png' }]
    })

    expect(loggerMock.info).not.toHaveBeenCalled()
    expect(loggerMock.debug).not.toHaveBeenCalled()
  })
})
