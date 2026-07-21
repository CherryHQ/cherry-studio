import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import { Loader2, Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('PromptPolishActions')
const PROTECTED_PROMPT_TOKEN_PATTERN = /\{\{[^{}\r\n]+\}\}|\$\{[^{}\r\n]+\}/g

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
  const [running, setRunning] = useState(false)
  const [restoreState, setRestoreState] = useState<RestoreState | null>(null)
  const inFlightRef = useRef(false)
  const requestIdRef = useRef(0)
  const valueRef = useRef(value)
  const disabledRef = useRef(disabled)
  const usesFallback = !value.trim()
  const generationSource = usesFallback ? (fallbackSource?.trim() ?? '') : value
  const actionLabel = t(usesFallback ? 'library.config.prompt.generate' : 'library.config.prompt.polish')
  const generationSourceRef = useRef(generationSource)
  const onChangeRef = useRef(onChange)

  useLayoutEffect(() => {
    valueRef.current = value
    disabledRef.current = disabled
    generationSourceRef.current = generationSource
    onChangeRef.current = onChange
  }, [disabled, generationSource, onChange, value])

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
    }
  }, [])

  if (restoreState && restoreState.polished !== value) {
    setRestoreState(null)
  }

  const canUndo = restoreState?.polished === value
  const undoDisabled = disabled || running
  const actionDisabled = disabled || running || !generationSource

  const handlePolish = async () => {
    if (disabled || inFlightRef.current || !generationSource) return

    const original = value
    const source = generationSource
    const requestUsesFallback = usesFallback
    const requestSystemPrompt = requestUsesFallback ? emptyValueSystemPrompt : existingValueSystemPrompt
    const failureToast = {
      title: t(
        requestUsesFallback
          ? 'library.config.prompt.generate_failed_title'
          : 'library.config.prompt.polish_failed_title'
      ),
      description: t(
        requestUsesFallback
          ? 'library.config.prompt.generate_failed_description'
          : 'library.config.prompt.polish_failed_description'
      )
    }
    const requestId = requestIdRef.current + 1
    inFlightRef.current = true
    requestIdRef.current = requestId
    setRunning(true)
    setRestoreState(null)

    try {
      const polished = await fetchGenerate({
        prompt: requestSystemPrompt,
        content: source,
        throwOnError: true
      })

      if (
        requestIdRef.current !== requestId ||
        valueRef.current !== original ||
        generationSourceRef.current !== source ||
        disabledRef.current
      ) {
        return
      }
      if (!polished.trim()) {
        toast.error(failureToast)
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

      const cause = error instanceof Error ? error : new Error(String(error))
      logger.error(`Failed to ${requestUsesFallback ? 'generate' : 'polish'} prompt`, cause)
      toast.error(failureToast)
    } finally {
      if (requestIdRef.current === requestId) {
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
            variant="outline"
            aria-label={t('common.undo')}
            aria-disabled={undoDisabled}
            onClick={handleUndo}
            className="flex h-6 min-h-0 w-6 items-center justify-center rounded-full p-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-0 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40">
            <Undo2 size={10} />
          </Button>
        </Tooltip>
      ) : null}
      <Tooltip content={actionLabel}>
        <Button
          type="button"
          variant="outline"
          aria-label={actionLabel}
          aria-disabled={actionDisabled}
          onClick={() => void handlePolish()}
          className="flex h-6 min-h-0 w-6 items-center justify-center rounded-full p-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-0 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40">
          {running ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
        </Button>
      </Tooltip>
    </>
  )
}
