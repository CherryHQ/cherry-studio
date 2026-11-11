import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { detectLanguageByFranc } from '@renderer/hooks/translate'
import { useModelById, useModels } from '@renderer/hooks/useModel'
import { isAbortError } from '@renderer/utils/error'
import { translateText } from '@renderer/utils/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { type Model, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'

import type { OverlayPhase, SelectionRect, TranslationBlock, TranslationView, TranslationWorkState } from '../types'
import { fitTranslationText, type TranslationTextMetrics } from '../utils/fitTranslationText'
import { getSelectionImageData } from '../utils/mosaic'
import { sampleTranslationBackground } from '../utils/sampleTranslationBackground'
import { classifyTranslationBlocks } from '../utils/translationBlocks'
import type { useOcr } from './useOcr'

export interface ScreenshotTranslationOptions {
  mediaId: string | null
  image: HTMLImageElement | null
  selection: SelectionRect | null
  phase: OverlayPhase
  scaleFactor: number
  annotationActive: boolean
  ocr: ReturnType<typeof useOcr>
}

export interface ScreenshotTranslation {
  workState: TranslationWorkState
  view: TranslationView
  blocks: readonly TranslationBlock[]
  sourceLangCode: TranslateLangCode | null
  counts: { total: number; translated: number; skipped: number; failed: number }
  modelId: UniqueModelId | null
  modelStatus: 'loading' | 'ready' | 'missing'
  modelPersistError: boolean
  targetLangCode: TranslateLangCode
  errorMessage: string | null
  start: () => void
  clear: () => void
  retry: (blockId: number) => void
  setView: (view: TranslationView) => void
  selectModel: (modelId: UniqueModelId | undefined) => Promise<void>
  setTargetLanguage: (code: TranslateLangCode) => Promise<void>
}

interface Run {
  generation: number
  key: string
  image: HTMLImageElement
  selection: SelectionRect
  scaleFactor: number
  target: TranslateLangCode
  modelId: UniqueModelId
  ocrRequested: boolean
  consumed: boolean
  blocks: TranslationBlock[]
  crop: ImageData | null
  measure?: (text: string, size: number) => TranslationTextMetrics
  controllers: Set<AbortController>
}

interface Result {
  workState: TranslationWorkState
  blocks: readonly TranslationBlock[]
  sourceLangCode: TranslateLangCode | null
  errorMessage: string | null
}

const INITIAL: Result = { workState: 'idle', blocks: [], sourceLangCode: null, errorMessage: null }

function aggregate(blocks: readonly TranslationBlock[]): TranslationWorkState {
  if (blocks.some((block) => block.status === 'queued' || block.status === 'running')) return 'translating'
  return blocks.some((block) => block.status === 'failed') ? 'partial-failure' : 'done'
}

function usable(model: Model | undefined, id: string | null): model is Model {
  return !!model && model.id === id && model.isEnabled && !isNonChatModel(model)
}

export function useScreenshotTranslation(options: ScreenshotTranslationOptions): ScreenshotTranslation {
  const { mediaId, image, selection, phase, scaleFactor, annotationActive, ocr } = options
  const [rememberedId, persistModel] = usePreference('feature.screenshot.translate.model_id')
  const [defaultId] = usePreference('chat.default_model_id')
  const [targetLangCode, persistTarget] = usePreference('feature.translate.page.target_language')
  const [choice, setChoice] = useState<{ id: UniqueModelId | null; remembered: string | null }>()
  const preferredId =
    choice && (rememberedId === choice.remembered || rememberedId === choice.id) ? choice.id : rememberedId
  const parsedId = UniqueModelIdSchema.safeParse(preferredId)
  const parsedDefaultId = UniqueModelIdSchema.safeParse(defaultId)
  const remembered = useModelById(parsedId.success ? parsedId.data : null)
  const fallback = useModelById(parsedDefaultId.success ? parsedDefaultId.data : null)
  const models = useModels()
  const loading = models.isLoading || remembered.isLoading || fallback.isLoading
  const configurationError = models.error || remembered.error || fallback.error
  const resolvedModel = usable(remembered.model, preferredId)
    ? remembered.model
    : usable(fallback.model, defaultId)
      ? fallback.model
      : null
  const modelId = loading || configurationError ? null : (resolvedModel?.id ?? null)
  const modelStatus = loading || configurationError ? 'loading' : modelId ? 'ready' : 'missing'
  const [modelPersistError, setModelPersistError] = useState(false)
  const [result, setResult] = useState<Result>(INITIAL)
  const [view, setView] = useState<TranslationView>('original')
  const generation = useRef(0)
  const runRef = useRef<Run | null>(null)
  const selectionKey =
    mediaId && selection
      ? JSON.stringify([mediaId, selection.x, selection.y, selection.width, selection.height, scaleFactor])
      : null

  const invalidate = useCallback(() => {
    generation.current++
    const run = runRef.current
    runRef.current = null
    run?.controllers.forEach((controller) => controller.abort())
    if (run) {
      run.crop = null
      run.measure = undefined
      run.blocks = []
      run.controllers.clear()
    }
  }, [])

  const clear = useCallback(() => {
    invalidate()
    setResult(INITIAL)
    setView('original')
  }, [invalidate])

  // Reset before asynchronous work can publish into a newly committed selection.
  useLayoutEffect(() => {
    clear()
    return invalidate
  }, [mediaId, image, selectionKey, scaleFactor, phase, targetLangCode, modelId, clear, invalidate])

  const pump = useCallback(
    function pump(run: Run) {
      if (generation.current !== run.generation || !run.crop || !run.measure) return
      while (run.controllers.size < 2) {
        const block = run.blocks.find((candidate) => candidate.status === 'queued')
        if (!block) break
        const controller = new AbortController()
        controller.signal.addEventListener(
          'abort',
          () => {
            if (generation.current === run.generation) clear()
          },
          { once: true }
        )
        run.controllers.add(controller)
        const update = (next: TranslationBlock) => {
          run.blocks = run.blocks.map((candidate) => (candidate.id === next.id ? next : candidate))
        }
        update({ ...block, status: 'running' })
        void (async () => {
          let failureStage: 'translation' | 'rendering' =
            block.failureStage === 'rendering' ? 'rendering' : 'translation'
          let translatedText = block.translatedText
          try {
            if (failureStage === 'translation') {
              translatedText = await translateText(
                block.sourceText,
                run.target,
                undefined,
                controller.signal,
                run.modelId
              )
            }
            if (generation.current !== run.generation) return
            if (!translatedText?.trim()) {
              update({ ...block, status: 'failed', failureStage: 'translation', reason: 'no_text' })
              return
            }
            translatedText = translatedText.replace(/\s+/gu, ' ').trim()
            failureStage = 'rendering'
            const allBoxes = run.blocks.flatMap((candidate) => (candidate.box ? [candidate.box] : []))
            const background = block.box && sampleTranslationBackground(run.crop!, block.box, allBoxes)
            const fitted =
              background && block.box && fitTranslationText(translatedText, block.box, run.scaleFactor, run.measure!)
            update(
              background && fitted
                ? {
                    ...block,
                    status: 'succeeded',
                    translatedText,
                    drawing: { background, ...fitted },
                    failureStage: undefined,
                    reason: undefined
                  }
                : {
                    ...block,
                    status: 'failed',
                    translatedText,
                    failureStage,
                    reason: background ? 'cannot_fit' : 'no_background'
                  }
            )
          } catch (error) {
            if (generation.current !== run.generation) return
            if (isAbortError(error) || (error instanceof Error && error.name === 'AbortError')) {
              clear()
              return
            }
            update({ ...block, status: 'failed', translatedText, failureStage, reason: 'configuration_failed' })
          } finally {
            run.controllers.delete(controller)
            if (generation.current === run.generation) pump(run)
          }
        })()
      }
      setResult((previous) => ({ ...previous, blocks: [...run.blocks], workState: aggregate(run.blocks) }))
    },
    [clear]
  )

  useEffect(() => {
    const run = runRef.current
    if (!run || run.consumed || result.workState !== 'preparing') return
    const fail = (errorMessage: string) => setResult((previous) => ({ ...previous, workState: 'error', errorMessage }))
    if (ocr.status === 'unavailable') return fail('ocr_unavailable')
    if (ocr.status === 'error') return fail('configuration_failed')
    if (ocr.status === 'pending' && !run.ocrRequested) {
      run.ocrRequested = true
      ocr.triggerOcr()
    }
    if (ocr.status !== 'done' || ocr.resultKey !== ocr.selectionKey || ocr.selectionKey !== run.key) return
    run.consumed = true
    void (async () => {
      try {
        const lines = ocr.lines.map((line) => ({ ...line, box: { ...line.box } }))
        const sw = Math.round(run.selection.width * run.scaleFactor)
        const sh = Math.round(run.selection.height * run.scaleFactor)
        const classified = classifyTranslationBlocks(
          lines,
          lines.map((line) => detectLanguageByFranc(line.text)),
          run.target,
          { width: sw, height: sh }
        )
        run.blocks = classified.blocks
        setResult((previous) => ({ ...previous, blocks: [...run.blocks], sourceLangCode: classified.sourceLangCode }))
        if (!run.blocks.some((block) => block.status === 'queued')) {
          setResult((previous) => ({
            ...previous,
            workState: 'empty',
            errorMessage: classified.sourceLangCode ? 'no_eligible_text' : 'ambiguous_source'
          }))
          return
        }
        run.crop = getSelectionImageData(run.image, run.selection, run.scaleFactor)
        const context = document.createElement('canvas').getContext('2d')
        if (!run.crop || !context) return fail('configuration_failed')
        const fontFamily = getComputedStyle(document.body).fontFamily
        await document.fonts.ready
        if (generation.current !== run.generation) return
        run.measure = (text, size) => {
          context.font = `${size}px ${fontFamily}`
          const m = context.measureText(text)
          return {
            width: m.width,
            left: Math.max(0, -m.actualBoundingBoxLeft),
            right: m.actualBoundingBoxRight,
            ascent: Number.isFinite(m.fontBoundingBoxAscent) ? m.fontBoundingBoxAscent : 0.8 * size,
            descent: Number.isFinite(m.fontBoundingBoxDescent) ? m.fontBoundingBoxDescent : 0.2 * size
          }
        }
        pump(run)
      } catch {
        if (generation.current === run.generation) fail('configuration_failed')
      }
    })()
  }, [ocr, result.workState, pump])

  const start = () => {
    if (annotationActive) {
      setResult((previous) => ({ ...previous, errorMessage: 'disabled_while_annotating' }))
      return
    }
    if (!selectionKey || !ocr.selectionKey || ocr.status === 'idle') {
      setResult((previous) => ({ ...previous, errorMessage: 'selection_too_small' }))
      return
    }
    if (configurationError || modelStatus === 'missing') {
      setResult((previous) => ({
        ...previous,
        errorMessage: configurationError ? 'configuration_failed' : 'model_required'
      }))
      return
    }
    if (!modelId || !image || !selection || phase !== 'selected') return
    if (result.workState === 'preparing' || result.workState === 'translating') return
    clear()
    runRef.current = {
      generation: generation.current,
      key: selectionKey,
      image,
      selection: { ...selection },
      scaleFactor,
      target: targetLangCode,
      modelId,
      ocrRequested: false,
      consumed: false,
      blocks: [],
      crop: null,
      controllers: new Set()
    }
    setResult({ ...INITIAL, workState: 'preparing' })
    setView('translated')
  }

  const retry = (blockId: number) => {
    const run = runRef.current
    const block = run?.blocks.find((candidate) => candidate.id === blockId)
    if (!run || generation.current !== run.generation || block?.status !== 'failed') return
    run.blocks = run.blocks.map((candidate) =>
      candidate.id === blockId ? { ...candidate, status: 'queued' } : candidate
    )
    pump(run)
  }

  const selectModel = async (id: UniqueModelId | undefined) => {
    clear()
    setChoice({ id: id ?? null, remembered: rememberedId })
    setModelPersistError(false)
    try {
      await persistModel(id ?? null)
    } catch {
      setModelPersistError(true)
    }
  }

  const setTargetLanguage = async (code: TranslateLangCode) => {
    if (code !== targetLangCode) clear()
    await persistTarget(code)
  }

  return {
    ...result,
    view,
    modelId,
    modelStatus,
    modelPersistError,
    targetLangCode,
    counts: {
      total: result.blocks.length,
      translated: result.blocks.filter((block) => block.status === 'succeeded').length,
      skipped: result.blocks.filter((block) => block.status === 'skipped').length,
      failed: result.blocks.filter((block) => block.status === 'failed').length
    },
    start,
    clear,
    retry,
    setView,
    selectModel,
    setTargetLanguage
  }
}
