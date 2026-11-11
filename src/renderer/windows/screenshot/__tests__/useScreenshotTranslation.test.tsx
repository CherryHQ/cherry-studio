import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateText } from '@renderer/utils/translate/translateText'
import { MODEL_CAPABILITY, type Model, ModelSchema } from '@shared/data/types/model'

import { type ScreenshotTranslationOptions, useScreenshotTranslation } from '../hooks/useScreenshotTranslation'
import { getSelectionImageData } from '../utils/mosaic'

vi.mock('@renderer/utils/translate/translateText')
vi.mock('../utils/mosaic')

const MODEL = ModelSchema.parse({
  id: 'openai::chat',
  providerId: 'openai',
  name: 'Chat',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})
const FALLBACK = { ...MODEL, id: 'openai::fallback' as const }
const SELECTION = { x: 10.25, y: 20.75, width: 400, height: 180 }
const KEY = JSON.stringify(['capture', SELECTION.x, SELECTION.y, SELECTION.width, SELECTION.height, 1])
const lines = (count = 2) =>
  Array.from({ length: count }, (_, id) => ({
    text: `This is a complete English sentence about the weather and the beautiful sunshine today. Line number ${id}.`,
    box: { x: 10, y: 10 + id * 40, width: 320, height: 24 }
  }))

function deferred<T = string>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function renderTranslation(overrides: Partial<ScreenshotTranslationOptions> = {}) {
  const options: ScreenshotTranslationOptions = {
    mediaId: 'capture',
    image: new Image(),
    selection: SELECTION,
    phase: 'selected',
    scaleFactor: 1,
    annotationActive: false,
    ocr: {
      status: 'done',
      lines: lines(),
      selectionKey: KEY,
      resultKey: KEY,
      triggerOcr: vi.fn(),
      copyText: vi.fn(),
      resetOcr: vi.fn()
    },
    ...overrides
  }
  return { ...renderHook(useScreenshotTranslation, { initialProps: options }), options }
}

type TranslationResult = ReturnType<typeof renderTranslation>['result']
async function start(result: TranslationResult) {
  await act(async () => result.current.start())
}

describe('useScreenshotTranslation', () => {
  let availableModels: Model[]
  let modelsLoading: boolean
  let modelsError: Error | undefined
  let oversizedMetrics: boolean
  let crop: ImageData

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.screenshot.translate.model_id': MODEL.id,
      'chat.default_model_id': FALLBACK.id,
      'feature.translate.page.target_language': 'zh-cn'
    })
    availableModels = [MODEL, FALLBACK]
    modelsLoading = false
    modelsError = undefined
    oversizedMetrics = false
    mockUseQuery.mockImplementation((path, options) => ({
      data: (options?.enabled === false
        ? undefined
        : path === '/models'
          ? availableModels
          : availableModels.find((model) => path === `/models/${model.id}`)) as never,
      isLoading: modelsLoading && path === '/models',
      isRefreshing: false,
      error: modelsError,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn()
    }))
    vi.mocked(translateText).mockReset().mockResolvedValue('译文')
    crop = { width: 400, height: 180, data: new Uint8ClampedArray(400 * 180 * 4).fill(255), colorSpace: 'srgb' }
    vi.mocked(getSelectionImageData).mockReset().mockReturnValue(crop)
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    const context = {
      font: '',
      measureText: (text: string) => ({
        width: oversizedMetrics ? 100000 : text.length * 8,
        actualBoundingBoxLeft: -1,
        actualBoundingBoxRight: text.length * 8,
        fontBoundingBoxAscent: NaN,
        fontBoundingBoxDescent: NaN
      })
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => vi.restoreAllMocks())

  it('triggers pending OCR exactly once per start and consumes a matching done result', async () => {
    // Regression: rerenders repeatedly request manual OCR, or manual results never enter the queue.
    const hook = renderTranslation()
    hook.options.ocr = { ...hook.options.ocr, status: 'pending', resultKey: null }
    hook.rerender(hook.options)
    await start(hook.result)
    hook.rerender({ ...hook.options })
    expect(hook.options.ocr.triggerOcr).toHaveBeenCalledTimes(1)
    expect(hook.result.current.workState).toBe('preparing')
    expect(translateText).not.toHaveBeenCalled()
    await act(async () =>
      hook.rerender({ ...hook.options, ocr: { ...hook.options.ocr, status: 'done', resultKey: KEY } })
    )
    expect(hook.result.current.workState).toBe('done')
    expect(hook.result.current.counts.translated).toBe(2)
    act(() => hook.result.current.clear())
    hook.rerender(hook.options)
    await start(hook.result)
    expect(hook.options.ocr.triggerOcr).toHaveBeenCalledTimes(2)
  })

  it('never consumes mismatched result keys or OCR owned by another selection', async () => {
    // Regression: stale recognition translates text over an unrelated crop.
    const hook = renderTranslation()
    hook.rerender({ ...hook.options, ocr: { ...hook.options.ocr, resultKey: 'old-selection' } })
    await start(hook.result)
    expect(hook.result.current.workState).toBe('preparing')
    await act(async () =>
      hook.rerender({ ...hook.options, ocr: { ...hook.options.ocr, selectionKey: 'other', resultKey: 'other' } })
    )
    expect(hook.result.current.blocks).toEqual([])
    expect(translateText).not.toHaveBeenCalled()
  })

  it('translates two blocks concurrently and caps a longer queue at two calls', async () => {
    // Regression: serial work wastes a slot, or the third block exceeds the provider cap.
    const jobs = Array.from({ length: 3 }, () => deferred())
    let active = 0
    let peak = 0
    vi.mocked(translateText).mockImplementation((_text) => {
      const job = jobs[Number(_text.match(/number (\d+)/)?.[1])]
      active++
      peak = Math.max(peak, active)
      return job.promise.finally(() => active--)
    })
    const hook = renderTranslation()
    hook.options.ocr.lines = lines(3)
    await start(hook.result)
    expect(active).toBe(2)
    expect(translateText).toHaveBeenCalledTimes(2)
    await act(async () => jobs[0].resolve('第一行'))
    expect(active).toBe(2)
    await act(async () => {
      jobs[1].resolve('第二行')
      jobs[2].resolve('第三行')
    })
    expect(peak).toBe(2)
    expect(hook.result.current.counts.translated).toBe(3)
    expect(hook.result.current.workState).toBe('done')
  })

  it('publishes both results when translations finish out of order', async () => {
    // Regression: a late completion replaces a previously successful sibling.
    const first = deferred()
    const second = deferred()
    vi.mocked(translateText).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderTranslation()
    await start(result)
    await act(async () => second.resolve('第二行'))
    expect(result.current.blocks[1]).toMatchObject({ status: 'succeeded', translatedText: '第二行' })
    expect(result.current.workState).toBe('translating')
    await act(async () => first.resolve('第一行'))
    expect(result.current.blocks.map((block) => block.translatedText)).toEqual(['第一行', '第二行'])
    expect(result.current.workState).toBe('done')
  })

  it('retains successes and reports partial-failure for a translation rejection', async () => {
    // Regression: one provider failure erases successful output or claims completion without failures.
    vi.mocked(translateText).mockRejectedValueOnce(new Error('provider failed'))
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.workState).toBe('partial-failure')
    expect(result.current.blocks[0]).toMatchObject({ status: 'failed', failureStage: 'translation' })
    expect(result.current.blocks[1]).toMatchObject({ status: 'succeeded', translatedText: '译文' })
    expect(result.current.counts).toEqual({ total: 2, translated: 1, failed: 1, skipped: 0 })
  })

  it('retries only the translation failure with exactly one new provider call', async () => {
    // Regression: retry translates successful siblings again or repeats OCR/readback.
    vi.mocked(translateText).mockRejectedValueOnce(new Error('provider failed'))
    const { result, options } = renderTranslation()
    await start(result)
    const success = result.current.blocks[1]
    await act(async () => result.current.retry(0))
    expect(translateText).toHaveBeenCalledTimes(3)
    expect(vi.mocked(translateText).mock.calls[2]).toEqual([
      options.ocr.lines[0].text,
      'zh-cn',
      undefined,
      expect.any(AbortSignal),
      MODEL.id
    ])
    expect(result.current.blocks[1]).toEqual(success)
    expect(result.current.workState).toBe('done')
    expect(getSelectionImageData).toHaveBeenCalledTimes(1)
    expect(options.ocr.triggerOcr).not.toHaveBeenCalled()
  })

  it('retries rendering from saved translated text without a provider call', async () => {
    // Regression: a fitting retry bills for a second translation or loses the stored text.
    oversizedMetrics = true
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.blocks[0]).toMatchObject({
      status: 'failed',
      failureStage: 'rendering',
      reason: 'cannot_fit',
      translatedText: '译文'
    })
    oversizedMetrics = false
    await act(async () => result.current.retry(0))
    expect(translateText).toHaveBeenCalledTimes(2)
    expect(result.current.blocks[0]).toMatchObject({ status: 'succeeded', translatedText: '译文' })
    expect(result.current.blocks[0].drawing).toBeDefined()
    expect(result.current.blocks[1].status).toBe('failed')
  })

  it('ignores duplicate retries while a block is queued or running and shares the two slots', async () => {
    // Regression: retry bypasses the cap or schedules a failed block multiple times.
    const second = deferred()
    const third = deferred()
    const retried = deferred()
    vi.mocked(translateText)
      .mockRejectedValueOnce(new Error('failed'))
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
      .mockReturnValueOnce(retried.promise)
    const hook = renderTranslation()
    hook.options.ocr.lines = lines(3)
    await start(hook.result)
    act(() => {
      hook.result.current.retry(0)
      hook.result.current.retry(0)
    })
    expect(hook.result.current.blocks[0].status).toBe('queued')
    expect(translateText).toHaveBeenCalledTimes(3)
    await act(async () => second.resolve('第二行'))
    act(() => hook.result.current.retry(0))
    expect(hook.result.current.blocks[0].status).toBe('running')
    expect(translateText).toHaveBeenCalledTimes(4)
    await act(async () => {
      third.resolve('第三行')
      retried.resolve('重试')
    })
    expect(hook.result.current.counts.translated).toBe(3)
  })

  it('switches views without discarding results or requesting more translations', async () => {
    // Regression: comparing with the original restarts paid translation work.
    const { result } = renderTranslation()
    await start(result)
    const blocks = result.current.blocks
    act(() => result.current.setView('original'))
    expect(result.current.view).toBe('original')
    act(() => result.current.setView('translated'))
    expect(result.current.view).toBe('translated')
    expect(result.current.blocks).toEqual(blocks)
    expect(translateText).toHaveBeenCalledTimes(2)
  })

  it.each(['selection', 'phase', 'mediaId', 'image', 'scaleFactor'] as const)(
    'aborts on %s change and drops late results',
    async (field) => {
      // Regression: a superseded run publishes into a moved selection or replacement capture.
      const late = deferred()
      vi.mocked(translateText).mockReturnValue(late.promise)
      const hook = renderTranslation()
      await start(hook.result)
      const signals = vi.mocked(translateText).mock.calls.map((call) => call[3])
      const changes = {
        selection: { ...SELECTION, x: 50 },
        phase: 'moving' as const,
        mediaId: 'new',
        image: new Image(),
        scaleFactor: 2
      }
      hook.rerender({ ...hook.options, [field]: changes[field] })
      expect(signals.every((signal) => signal?.aborted)).toBe(true)
      expect(hook.result.current.workState).toBe('idle')
      expect(hook.result.current.view).toBe('original')
      await act(async () => late.resolve('过期'))
      expect(hook.result.current.blocks).toEqual([])
      expect(hook.result.current.workState).toBe('idle')
    }
  )

  it('returns empty and ambiguous_source for all-target-language input', async () => {
    // Regression: target-only text is sent to the provider or misreported as a translation failure.
    MockUsePreferenceUtils.setPreferenceValue('feature.translate.page.target_language', 'en-us')
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.workState).toBe('empty')
    expect(result.current.errorMessage).toBe('ambiguous_source')
    expect(result.current.counts.skipped).toBe(2)
    expect(result.current.blocks.every((block) => block.reason === 'target_language')).toBe(true)
    expect(translateText).not.toHaveBeenCalled()
  })

  it('refuses to start without a usable model and preserves remembered preferences', async () => {
    // Regression: stale or disabled model IDs silently fall through to an arbitrary model.
    availableModels = [{ ...MODEL, isEnabled: false }]
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.modelStatus).toBe('missing')
    expect(result.current.errorMessage).toBe('model_required')
    expect(result.current.workState).toBe('idle')
    expect(translateText).not.toHaveBeenCalled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.screenshot.translate.model_id')).toBe(MODEL.id)
  })

  it('waits for model loading before choosing the remembered model', async () => {
    // Regression: a transient model-list miss is treated as a missing configuration.
    modelsLoading = true
    const hook = renderTranslation()
    await start(hook.result)
    expect(hook.result.current.modelStatus).toBe('loading')
    expect(hook.result.current.errorMessage).toBeNull()
    expect(translateText).not.toHaveBeenCalled()
    modelsLoading = false
    hook.rerender(hook.options)
    await start(hook.result)
    expect(hook.result.current.modelId).toBe(MODEL.id)
    expect(hook.result.current.workState).toBe('done')
  })

  it('falls back to the chat default when the remembered model is non-chat', async () => {
    // Regression: an embedding model is accepted for screenshot translation.
    availableModels = [{ ...MODEL, capabilities: [MODEL_CAPABILITY.EMBEDDING] }, FALLBACK]
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.modelId).toBe(FALLBACK.id)
    expect(vi.mocked(translateText).mock.calls.every((call) => call[4] === FALLBACK.id)).toBe(true)
    expect(result.current.workState).toBe('done')
  })

  it('reports model query failures as configuration errors rather than deleting memory', async () => {
    // Regression: a failed query is interpreted as model deletion.
    modelsError = new Error('offline')
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.modelStatus).toBe('loading')
    expect(result.current.errorMessage).toBe('configuration_failed')
    expect(translateText).not.toHaveBeenCalled()
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.screenshot.translate.model_id')).toBe(MODEL.id)
  })

  it('keeps an explicitly selected model locally and reports a rejected preference write', async () => {
    // Regression: persistence failure silently claims the choice was remembered or reverts the active choice.
    MockUsePreferenceUtils.mockPreferenceError('feature.screenshot.translate.model_id', new Error('write failed'))
    const { result } = renderTranslation()
    await act(async () => result.current.selectModel(FALLBACK.id))
    expect(result.current.modelPersistError).toBe(true)
    expect(result.current.modelId).toBe(FALLBACK.id)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.screenshot.translate.model_id')).toBe(MODEL.id)
    await start(result)
    expect(vi.mocked(translateText).mock.calls.every((call) => call[4] === FALLBACK.id)).toBe(true)
  })

  it.each(['target', 'model', 'clear'] as const)('invalidates active work after %s changes', async (field) => {
    // Regression: configuration changes allow output from the old run to survive.
    const late = deferred()
    vi.mocked(translateText).mockReturnValue(late.promise)
    const hook = renderTranslation()
    await start(hook.result)
    const signals = vi.mocked(translateText).mock.calls.map((call) => call[3])
    await act(async () => {
      if (field === 'target') await hook.result.current.setTargetLanguage('ja-jp')
      else if (field === 'model') await hook.result.current.selectModel(FALLBACK.id)
      else hook.result.current.clear()
    })
    hook.rerender(hook.options)
    expect(signals.every((signal) => signal?.aborted)).toBe(true)
    await act(async () => late.resolve('过期'))
    expect(hook.result.current.blocks).toEqual([])
    expect(hook.result.current.workState).toBe('idle')
    expect(hook.result.current.view).toBe('original')
  })

  it('aborts all controllers on unmount and consumes late rejections', async () => {
    // Regression: a closed overlay leaves requests alive or publishes a late error.
    const late = deferred()
    vi.mocked(translateText).mockReturnValue(late.promise)
    const hook = renderTranslation()
    await start(hook.result)
    const signals = vi.mocked(translateText).mock.calls.map((call) => call[3])
    hook.unmount()
    expect(signals.every((signal) => signal?.aborted)).toBe(true)
    await act(async () => late.reject(new Error('late provider error')))
    expect(translateText).toHaveBeenCalledTimes(2)
  })

  it('only gates start with annotations and lets an existing run complete', async () => {
    // Regression: toggling annotation activity destroys paid in-progress work.
    const late = deferred()
    vi.mocked(translateText).mockReturnValue(late.promise)
    const hook = renderTranslation({ annotationActive: true })
    await start(hook.result)
    expect(hook.result.current.errorMessage).toBe('disabled_while_annotating')
    expect(translateText).not.toHaveBeenCalled()
    hook.rerender({ ...hook.options, annotationActive: false })
    await start(hook.result)
    hook.rerender({ ...hook.options, annotationActive: true })
    expect(vi.mocked(translateText).mock.calls.every((call) => !call[3]?.aborted)).toBe(true)
    await act(async () => late.resolve('译文'))
    expect(hook.result.current.workState).toBe('done')
  })

  it.each(['idle', 'pending', 'unavailable', 'error'] as const)(
    'handles OCR %s without premature provider calls',
    async (status) => {
      // Regression: missing OCR ownership, recognition failure or unavailable OCR starts translation.
      const hook = renderTranslation()
      hook.rerender({
        ...hook.options,
        ocr: { ...hook.options.ocr, status, selectionKey: status === 'idle' ? null : KEY }
      })
      await start(hook.result)
      expect(hook.result.current.errorMessage).toBe(
        { idle: 'selection_too_small', pending: null, unavailable: 'ocr_unavailable', error: 'configuration_failed' }[
          status
        ]
      )
      expect(translateText).not.toHaveBeenCalled()
    }
  )

  it('uses the rounded crop once, waits for fonts, and normalizes the fitted text', async () => {
    // Regression: translation begins before font readiness or draws text different from what was measured.
    const ready = deferred<FontFaceSet>()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: ready.promise } })
    vi.mocked(translateText).mockResolvedValue('  译文\n 第二行  ')
    const hook = renderTranslation()
    await start(hook.result)
    expect(getSelectionImageData).toHaveBeenCalledWith(hook.options.image, SELECTION, 1)
    expect(translateText).not.toHaveBeenCalled()
    expect(hook.result.current.workState).toBe('preparing')
    await act(async () => ready.resolve(document.fonts))
    expect(hook.result.current.blocks[0]).toMatchObject({
      translatedText: '译文 第二行',
      drawing: { background: { r: 255, g: 255, b: 255 }, baselineX: 11 }
    })
    expect(hook.result.current.workState).toBe('done')
  })

  it('discards font preparation completed after clear', async () => {
    // Regression: a late font-ready continuation restarts a cleared run.
    const ready = deferred<FontFaceSet>()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: ready.promise } })
    const { result } = renderTranslation()
    await start(result)
    act(() => result.current.clear())
    await act(async () => ready.resolve(document.fonts))
    expect(translateText).not.toHaveBeenCalled()
    expect(result.current.workState).toBe('idle')
    expect(result.current.blocks).toEqual([])
  })

  it('freezes OCR blocks and readback while waiting for fonts', async () => {
    // Regression: refreshed OCR mutates the source text or causes a second classification/readback.
    const ready = deferred<FontFaceSet>()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: ready.promise } })
    const hook = renderTranslation()
    const sourceTexts = hook.options.ocr.lines.map((line) => line.text)
    await start(hook.result)
    hook.options.ocr.lines[0].text = 'Changed OCR output'
    hook.options.ocr.lines[0].box.width = 1
    hook.rerender({ ...hook.options, ocr: { ...hook.options.ocr, lines: [] } })
    await act(async () => ready.resolve(document.fonts))
    expect(vi.mocked(translateText).mock.calls.map((call) => call[0])).toEqual(sourceTexts)
    expect(hook.result.current.blocks[0].box?.width).toBe(320)
    expect(hook.result.current.counts.translated).toBe(2)
    expect(getSelectionImageData).toHaveBeenCalledTimes(1)
  })

  it.each([new DOMException('Cancelled', 'AbortError'), Object.assign(new Error('Cancelled'), { name: 'AbortError' })])(
    'invalidates the entire run when a provider reports an abort: %s',
    async (error) => {
      // Regression: cancellation is shown as a failed block and the remaining queue keeps running.
      const first = deferred()
      const second = deferred()
      vi.mocked(translateText).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const { result } = renderTranslation()
      await start(result)
      const signals = vi.mocked(translateText).mock.calls.map((call) => call[3])
      await act(async () => first.reject(error))
      expect(signals.every((signal) => signal?.aborted)).toBe(true)
      await act(async () => second.resolve('过期'))
      expect(result.current.workState).toBe('idle')
      expect(result.current.view).toBe('original')
      expect(result.current.blocks).toEqual([])
    }
  )

  it('settles empty OCR without requesting translation', async () => {
    // Regression: an empty OCR result never settles or is sent to the provider.
    const hook = renderTranslation()
    hook.options.ocr.lines = []
    await start(hook.result)
    expect(hook.result.current.workState).toBe('empty')
    expect(hook.result.current.errorMessage).toBe('ambiguous_source')
    expect(hook.result.current.counts.total).toBe(0)
    expect(translateText).not.toHaveBeenCalled()
  })

  it('reports a crop readback failure without requesting translation', async () => {
    // Regression: unavailable image pixels allow provider work that can never be rendered.
    vi.mocked(getSelectionImageData).mockReturnValue(null)
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.workState).toBe('error')
    expect(result.current.errorMessage).toBe('configuration_failed')
    expect(translateText).not.toHaveBeenCalled()
  })

  it('reports all failed and empty translations as partial-failure', async () => {
    // Regression: all-failed work never settles, or empty text is rendered as a successful replacement.
    vi.mocked(translateText).mockResolvedValue(' \n ')
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.workState).toBe('partial-failure')
    expect(result.current.counts.failed).toBe(2)
    expect(result.current.blocks.every((block) => block.failureStage === 'translation')).toBe(true)
  })

  it('keeps original pixels when no background can be sampled', async () => {
    // Regression: a missing sampling ring produces a successful opaque replacement.
    crop.data.fill(0)
    const { result } = renderTranslation()
    await start(result)
    expect(result.current.workState).toBe('partial-failure')
    expect(result.current.blocks[0]).toMatchObject({
      status: 'failed',
      failureStage: 'rendering',
      reason: 'no_background',
      translatedText: '译文'
    })
    expect(result.current.blocks[0].drawing).toBeUndefined()
  })
})
