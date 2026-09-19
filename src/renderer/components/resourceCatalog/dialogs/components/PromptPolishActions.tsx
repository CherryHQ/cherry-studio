import { Settings2, Sparkles, Undo2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import { getErrorMessage } from '@renderer/utils/error'

const logger = loggerService.withContext('PromptPolishActions')
const PROTECTED_PROMPT_TOKEN_PATTERN = /\{\{[^{}\r\n]+\}\}|\$\{[^{}\r\n]+\}/g
const PROMPT_POLISH_TIMEOUT_MS = 60_000
const DEFAULT_MODEL_SETTINGS_PATH = '/settings/model' as const

type RestoreState = {
  original: string
  polished: string
}

type PromptPolishActionsProps = {
  value: string
  fallbackSource?: string
  emptyValueSystemPrompt: string
  existingValueSystemPrompt: string
  onChange: (value: string) => void
  disabled?: boolean
}

function getProtectedPromptTokens(value: string): string[] {
  return (value.match(PROTECTED_PROMPT_TOKEN_PATTERN) ?? []).sort()
}

function preservesProtectedPromptTokens(original: string, polished: string): boolean {
  const originalTokens = getProtectedPromptTokens(original)
  const polishedTokens = getProtectedPromptTokens(polished)

  return (
    originalTokens.length === polishedTokens.length &&
    originalTokens.every((token, index) => token === polishedTokens[index])
  )
}

export function PromptPolishActions({
  value,
  fallbackSource,
  emptyValueSystemPrompt,
  existingValueSystemPrompt,
  onChange,
  disabled = false
}: PromptPolishActionsProps) {
  const { t } = useTranslation()
  const { defaultModel } = useDefaultModel()
  const [running, setRunning] = useState(false)
  const [restoreState, setRestoreState] = useState<RestoreState | null>(null)
  const inFlightRef = useRef(false)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueRef = useRef(value)
  const disabledRef = useRef(disabled)
  const defaultModelRef = useRef(defaultModel)
  const usesFallback = !value.trim()
  const generationSource = usesFallback ? (fallbackSource?.trim() ?? '') : value
  const modelLabel = defaultModel?.name?.trim() || t('library.config.prompt.no_default_model')
  const actionLabel = t(
    usesFallback ? 'library.config.prompt.generate_with_model' : 'library.config.prompt.polish_with_model',
    { model: modelLabel }
  )
  const cancelLabel = t('library.config.prompt.cancel_with_model', { model: modelLabel })
  const settingsLabel = t('library.config.prompt.open_default_model_settings')
  const generationSourceRef = useRef(generationSource)
  const onChangeRef = useRef(onChange)

  useLayoutEffect(() => {
    valueRef.current = value
    disabledRef.current = disabled
    generationSourceRef.current = generationSource
    onChangeRef.current = onChange
    defaultModelRef.current = defaultModel
  }, [defaultModel, disabled, generationSource, onChange, value])

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      abortControllerRef.current?.abort(new DOMException('Prompt polish cancelled', 'AbortError'))
    }
  }, [])

  if (restoreState && restoreState.polished !== value) {
    setRestoreState(null)
  }

  const canUndo = restoreState?.polished === value
  const undoDisabled = disabled || running
  const actionDisabled = disabled || !generationSource
  const settingsAction = {
    label: settingsLabel,
    onClick: () => openSettingsTab(DEFAULT_MODEL_SETTINGS_PATH)
  }

  const stopActiveRequest = (controller: AbortController, reason: DOMException): boolean => {
    if (abortControllerRef.current !== controller) return false

    requestIdRef.current += 1
    inFlightRef.current = false
    abortControllerRef.current = null
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setRunning(false)
    controller.abort(reason)
    return true
  }

  const handleCancel = () => {
    const controller = abortControllerRef.current
    if (!controller) return
    stopActiveRequest(controller, new DOMException('Prompt polish cancelled', 'AbortError'))
  }

  const handlePolish = async () => {
    if (disabled || inFlightRef.current || !generationSource) return

    const original = value
    const source = generationSource
    const requestUsesFallback = usesFallback
    const requestSystemPrompt = requestUsesFallback ? emptyValueSystemPrompt : existingValueSystemPrompt
    const failureTitle = t(
      requestUsesFallback ? 'library.config.prompt.generate_failed_title' : 'library.config.prompt.polish_failed_title'
    )
    const requestModel = defaultModelRef.current

    if (!requestModel) {
      toast.error({
        title: failureTitle,
        description: t('error.model.not_exists'),
        action: settingsAction
      })
      return
    }

    const requestId = requestIdRef.current + 1
    const controller = new AbortController()
    inFlightRef.current = true
    requestIdRef.current = requestId
    abortControllerRef.current = controller
    setRunning(true)
    setRestoreState(null)
    timeoutRef.current = setTimeout(() => {
      if (stopActiveRequest(controller, new DOMException(t('error.request_timeout'), 'TimeoutError'))) {
        toast.error({ title: failureTitle, description: t('error.request_timeout'), action: settingsAction })
      }
    }, PROMPT_POLISH_TIMEOUT_MS)

    try {
      const polished = await fetchGenerate({
        prompt: requestSystemPrompt,
        content: source,
        model: requestModel,
        throwOnError: true,
        signal: controller.signal
      })

      if (
        requestIdRef.current !== requestId ||
        controller.signal.aborted ||
        valueRef.current !== original ||
        generationSourceRef.current !== source ||
        disabledRef.current
      ) {
        return
      }
      if (!polished.trim()) {
        toast.error({
          title: failureTitle,
          description: t('error.no_response'),
          action: settingsAction
        })
        return
      }
      if (!requestUsesFallback && !preservesProtectedPromptTokens(original, polished)) {
        toast.error({
          title: t('library.config.prompt.polish_variables_changed_title'),
          description: t('library.config.prompt.polish_variables_changed_description')
        })
        return
      }
      if (polished === original) return

      setRestoreState({ original, polished })
      onChangeRef.current(polished)
    } catch (error) {
      if (
        requestIdRef.current !== requestId ||
        valueRef.current !== original ||
        generationSourceRef.current !== source ||
        disabledRef.current
      ) {
        return
      }

      if (controller.signal.aborted) return

      const cause = error instanceof Error ? error : new Error(String(error))
      logger.error(`Failed to ${requestUsesFallback ? 'generate' : 'polish'} prompt`, cause)

      const missingModel = cause.message === t('error.model.not_exists')
      toast.error({
        title: failureTitle,
        description: missingModel ? t('error.model.not_exists') : getErrorMessage(cause),
        action: settingsAction
      })
    } finally {
      if (requestIdRef.current === requestId) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = null
        abortControllerRef.current = null
        inFlightRef.current = false
        setRunning(false)
      }
    }
  }

  const handleUndo = () => {
    if (!restoreState || !canUndo || disabled || running) return

    onChangeRef.current(restoreState.original)
    setRestoreState(null)
  }

  return (
    <>
      {canUndo ? (
        <Tooltip content={t('common.undo')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('common.undo')}
            aria-disabled={undoDisabled}
            onClick={handleUndo}
            className="flex size-6 min-h-0 items-center justify-center rounded-md border border-border-subtle p-0 text-muted-foreground! shadow-none transition-colors hover:bg-accent/50 hover:text-foreground! focus-visible:bg-accent/50 focus-visible:text-foreground! focus-visible:ring-0 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40">
            <Undo2 className="size-3" />
          </Button>
        </Tooltip>
      ) : null}
      <Tooltip content={settingsLabel}>
        <Button
          type="button"
          variant="ghost"
          aria-label={settingsLabel}
          onClick={settingsAction.onClick}
          className="flex size-6 min-h-0 items-center justify-center rounded-md border border-border-subtle p-0 text-muted-foreground! shadow-none transition-colors hover:bg-accent/50 hover:text-foreground! focus-visible:bg-accent/50 focus-visible:text-foreground! focus-visible:ring-0">
          <Settings2 className="size-3" />
        </Button>
      </Tooltip>
      {running ? (
        <Tooltip content={cancelLabel}>
          <Button
            type="button"
            variant="ghost"
            aria-label={cancelLabel}
            onClick={handleCancel}
            className="flex size-6 min-h-0 items-center justify-center rounded-md border border-border-subtle p-0 text-muted-foreground! shadow-none transition-colors hover:bg-accent/50 hover:text-foreground! focus-visible:bg-accent/50 focus-visible:text-foreground! focus-visible:ring-0">
            <X className="size-3" />
          </Button>
        </Tooltip>
      ) : (
        <Tooltip content={actionLabel}>
          <Button
            type="button"
            variant="ghost"
            aria-label={actionLabel}
            aria-disabled={actionDisabled}
            onClick={() => void handlePolish()}
            className="flex size-6 min-h-0 items-center justify-center rounded-md border border-border-subtle p-0 text-muted-foreground! shadow-none transition-colors hover:bg-accent/50 hover:text-foreground! focus-visible:bg-accent/50 focus-visible:text-foreground! focus-visible:ring-0 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40">
            <Sparkles className="size-3" />
          </Button>
        </Tooltip>
      )}
    </>
  )
}
