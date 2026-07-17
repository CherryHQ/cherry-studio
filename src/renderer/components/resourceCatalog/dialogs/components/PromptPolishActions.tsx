import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import { Loader2, Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('PromptPolishActions')
const PROTECTED_PROMPT_TOKEN_PATTERN = /\{\{[^{}\r\n]+\}\}|\$\{[^{}\r\n]+\}/g

const PROMPT_POLISH_SYSTEM_PROMPT = [
  'You are a prompt editor. Improve the supplied prompt without changing its intent or behavior.',
  'Keep the output in the same language as the input.',
  'Preserve all requirements, constraints, Markdown structure, code, URLs, and output-format instructions.',
  'Preserve every placeholder token verbatim, including tokens shaped like {{name}} and ${name}; keep duplicate occurrences.',
  'Return only the polished prompt with no explanation, wrapper, or code fence.'
].join('\n')

const PROMPT_GENERATE_SYSTEM_PROMPT = [
  'You are a prompt writer. Create a useful system prompt from the supplied name or title.',
  'Keep the output in the same language as the input.',
  'Preserve all requirements, constraints, Markdown structure, code, URLs, and output-format instructions.',
  'Preserve every placeholder token verbatim, including tokens shaped like {{name}} and ${name}; keep duplicate occurrences.',
  'Return only the generated prompt with no explanation, wrapper, or code fence.'
].join('\n')

type RestoreState = {
  original: string
  polished: string
}

type PromptPolishActionsProps = {
  value: string
  fallbackSource?: string
  onChange: (value: string) => void
  onPolishingChange?: (polishing: boolean) => void
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
  onChange,
  onPolishingChange,
  disabled = false
}: PromptPolishActionsProps) {
  const { t } = useTranslation()
  const [polishing, setPolishing] = useState(false)
  const [restoreState, setRestoreState] = useState<RestoreState | null>(null)
  const inFlightRef = useRef(false)
  const requestIdRef = useRef(0)
  const valueRef = useRef(value)
  const disabledRef = useRef(disabled)
  const usesFallback = !value.trim()
  const generationSource = usesFallback ? (fallbackSource?.trim() ?? '') : value
  const systemPrompt = usesFallback ? PROMPT_GENERATE_SYSTEM_PROMPT : PROMPT_POLISH_SYSTEM_PROMPT
  const generationSourceRef = useRef(generationSource)
  const onChangeRef = useRef(onChange)
  const onPolishingChangeRef = useRef(onPolishingChange)
  valueRef.current = value
  disabledRef.current = disabled
  generationSourceRef.current = generationSource
  onChangeRef.current = onChange
  onPolishingChangeRef.current = onPolishingChange

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
      if (inFlightRef.current) {
        inFlightRef.current = false
        onPolishingChangeRef.current?.(false)
      }
    }
  }, [])

  useEffect(() => {
    if (restoreState && restoreState.polished !== value) {
      setRestoreState(null)
    }
  }, [restoreState, value])

  const failureToast = {
    title: t('library.config.prompt.polish_failed_title'),
    description: t('library.config.prompt.polish_failed_description')
  }

  const canUndo = restoreState?.polished === value

  const handlePolish = async () => {
    if (disabled || inFlightRef.current || !generationSource) return

    const original = value
    const source = generationSource
    const requestId = requestIdRef.current + 1
    inFlightRef.current = true
    requestIdRef.current = requestId
    setPolishing(true)
    setRestoreState(null)
    onPolishingChangeRef.current?.(true)

    try {
      const polished = await fetchGenerate({
        prompt: systemPrompt,
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
      if (!preservesProtectedPromptTokens(source, polished)) {
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
      logger.error('Failed to polish prompt', cause)
      toast.error(failureToast)
    } finally {
      if (requestIdRef.current === requestId) {
        inFlightRef.current = false
        setPolishing(false)
        onPolishingChangeRef.current?.(false)
      }
    }
  }

  const handleUndo = () => {
    if (!restoreState || !canUndo || disabled || polishing) return

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
            onClick={handleUndo}
            disabled={disabled || polishing}
            className="flex h-6 min-h-0 w-6 items-center justify-center rounded-full p-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-0">
            <Undo2 size={10} />
          </Button>
        </Tooltip>
      ) : null}
      <Tooltip content={t('library.config.prompt.polish')}>
        <Button
          type="button"
          variant="outline"
          aria-label={t('library.config.prompt.polish')}
          onClick={() => void handlePolish()}
          disabled={disabled || polishing || !generationSource}
          className="flex h-6 min-h-0 w-6 items-center justify-center rounded-full p-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
          {polishing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
        </Button>
      </Tooltip>
    </>
  )
}
