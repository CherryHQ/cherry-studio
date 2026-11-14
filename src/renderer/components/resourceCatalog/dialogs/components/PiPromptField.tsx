import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { estimateTokenCount } from 'tokenx'

import { Button, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { normalizeAgentLanguageInput } from '@renderer/utils/agent/agentLanguage'
import type { AgentLanguageMode } from '@shared/ai/agentForm'
import type { AgentSystemPromptDraft, AgentSystemPromptPreview } from '@shared/ipc/schemas/agent'

const logger = loggerService.withContext('PiPromptField')
const PREVIEW_DEBOUNCE_MS = 300
const fixedSegmentClassName =
  'whitespace-pre-wrap break-words px-3 font-mono text-[11px] text-muted-foreground leading-5'

/** Everything besides the instructions that changes the assembled prompt. */
export type PiPromptDraft = Omit<AgentSystemPromptDraft, 'instructions' | 'language'> & {
  languageMode: AgentLanguageMode
  languageCustom: string
}

type PiPromptFieldProps = {
  value: string
  onChange: (value: string) => void
  draft: PiPromptDraft
}

/** Mirrors how the edit form saves `configuration.language`; an invalid custom label keeps the inherited one. */
function draftLanguage({ languageMode, languageCustom }: PiPromptDraft): string | null | undefined {
  if (languageMode === 'off') return null
  if (languageMode === 'custom') return normalizeAgentLanguageInput(languageCustom) ?? undefined
  return undefined
}

function usePiPromptPreview(draft: PiPromptDraft, instructions: string) {
  const [preview, setPreview] = useState<AgentSystemPromptPreview | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const instructionsRef = useRef(instructions)
  useEffect(() => {
    instructionsRef.current = instructions
  })
  const { agentId, skillIds, disabledTools, knowledgeBaseIds, mcpServerIds } = draft
  const language = draftLanguage(draft)
  const request: Omit<AgentSystemPromptDraft, 'instructions'> = {
    ...(agentId ? { agentId } : {}),
    ...(language === undefined ? {} : { language }),
    skillIds,
    disabledTools,
    knowledgeBaseIds,
    mcpServerIds
  }
  // The assembly only depends on whether instructions exist; their text sits in the editable slot.
  const requestKey = JSON.stringify([request, Boolean(instructions.trim())])

  useEffect(() => {
    let cancelled = false
    const [nextRequest] = JSON.parse(requestKey) as [Omit<AgentSystemPromptDraft, 'instructions'>]
    const timer = setTimeout(() => {
      ipcApi
        .request('agent.system_prompt.preview', { ...nextRequest, instructions: instructionsRef.current })
        .then((next) => {
          if (cancelled) return
          setPreview(next)
          setFailed(false)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          logger.error('Failed to assemble the Agent system prompt preview', error as Error)
          setFailed(true)
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [requestKey, attempt])

  return { preview, failed, retry: () => setAttempt((count) => count + 1) }
}

/** The full Pi Durable System Prompt: read-only runtime segments around the Agent's own editable instructions. */
export function PiPromptField({ value, onChange, draft }: PiPromptFieldProps) {
  const { t } = useTranslation()
  const { preview, failed, retry } = usePiPromptPreview(draft, value)
  const tokens = preview ? estimateTokenCount(`${preview.before}${value}${preview.after}`) : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-medium text-foreground text-sm leading-none">{t('library.config.prompt.label')}</span>
          <span className="text-muted-foreground text-xs">{t('library.config.agent.prompt.full_hint')}</span>
        </div>
        {tokens !== null ? (
          <span className="shrink-0 text-foreground-tertiary text-xs tabular-nums">
            {t('library.config.agent.prompt.tokens', { tokens: tokens.toLocaleString() })}
          </span>
        ) : null}
      </div>
      <div className="max-h-[460px] overflow-y-auto rounded-xl border border-border-subtle py-3">
        {preview ? (
          <pre className={fixedSegmentClassName}>{preview.before}</pre>
        ) : (
          <p role="status" className="px-3 pb-1 text-muted-foreground text-xs">
            {failed ? t('library.config.agent.prompt.load_failed') : t('library.config.agent.prompt.loading')}
          </p>
        )}
        <div className="mx-2 my-1 rounded-lg bg-accent/40 ring-1 ring-border">
          <Textarea.Input
            value={value}
            rows={5}
            aria-label={t('library.config.agent.prompt.instructions_label')}
            placeholder={t('library.config.agent.prompt.placeholder')}
            onValueChange={onChange}
            className="min-h-28 border-0 bg-transparent font-mono text-[12px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>
        {preview ? <pre className={fixedSegmentClassName}>{preview.after}</pre> : null}
      </div>
      {failed ? (
        <div className="flex items-center gap-2 text-destructive text-xs">
          {preview ? t('library.config.agent.prompt.load_failed') : null}
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={retry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
