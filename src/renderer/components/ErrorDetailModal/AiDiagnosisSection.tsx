import { AccordionContent, AccordionItem, AccordionTrigger, Badge, Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import { CircleAlert, CircleCheck, Loader2, Sparkles } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AIDiagnosisSection')

const AiDiagnosisSectionWithStatus = memo(
  ({
    error,
    status,
    onStatusChange,
    diagnosisContext,
    blockId,
    onDiagnosisComplete,
    cachedDiagnosis
  }: {
    error?: SerializedError
    status: 'idle' | 'loading' | 'done' | 'error'
    onStatusChange: (status: 'idle' | 'loading' | 'done' | 'error') => void
    diagnosisContext?: DiagnosisContext
    blockId?: string
    onDiagnosisComplete?: (partId: string, diagnosis: DiagnosisResult) => void | Promise<void>
    cachedDiagnosis?: DiagnosisResult
  }) => {
    const { t, i18n } = useTranslation()
    const [result, setResult] = useState<DiagnosisResult | null>(cachedDiagnosis ?? null)
    const [diagError, setDiagError] = useState<string>('')
    const cancelledRef = useRef(false)

    useEffect(() => {
      cancelledRef.current = false
      return () => {
        cancelledRef.current = true
      }
    }, [])

    const runDiagnosis = useCallback(async () => {
      if (!error) return
      cancelledRef.current = false
      onStatusChange('loading')
      setDiagError('')
      try {
        const { diagnoseError } = await import('@renderer/utils/errorDiagnosis')
        const diagnosis = await diagnoseError(error, i18n.language, diagnosisContext)
        if (cancelledRef.current) return
        setResult(diagnosis)
        onStatusChange('done')
        if (blockId && onDiagnosisComplete) {
          void Promise.resolve()
            .then(() => onDiagnosisComplete(blockId, diagnosis))
            .catch((error) => {
              logger.warn(`Failed to persist diagnosis for ${blockId}:`, { error })
            })
        }
      } catch (err: unknown) {
        if (cancelledRef.current) return
        setDiagError(err instanceof Error ? err.message : t('error.diagnosis.unknown'))
        onStatusChange('error')
      }
    }, [error, i18n.language, onStatusChange, diagnosisContext, blockId, onDiagnosisComplete, t])

    const statusLabel =
      status === 'loading'
        ? t('error.diagnosis.ai_loading')
        : status === 'done'
          ? t('error.diagnosis.ai_done')
          : status === 'error'
            ? t('settings.doctor.status.error')
            : null

    return (
      <AccordionItem
        value="ai-diagnosis"
        className="px-2"
        role={status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
        aria-atomic="true">
        <AccordionTrigger className="py-3 font-normal">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {status === 'loading' ? (
              <span className="inline-flex shrink-0 motion-safe:animate-spin" aria-hidden>
                <Loader2 className="size-4 text-primary" />
              </span>
            ) : status === 'done' ? (
              <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
            ) : status === 'error' ? (
              <CircleAlert className="size-4 shrink-0 text-error" aria-hidden />
            ) : (
              <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="font-medium text-sm">{t('error.diagnosis.ai_result')}</span>
            {statusLabel ? (
              <Badge variant="outline" className="font-normal text-xs">
                {statusLabel}
              </Badge>
            ) : null}
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pb-3">
          {status === 'done' && result ? (
            <div className="space-y-2 text-muted-foreground text-sm leading-6">
              <p>{result.explanation || result.summary}</p>
              {result.steps.length > 0 ? (
                <ol className="space-y-1.5">
                  {result.steps.map((step, index) => (
                    <li key={`${index}-${step.text}`} className="flex gap-2 px-2.5 py-1.5">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs">
                        {index + 1}
                      </span>
                      <span>{step.text}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
          {status === 'error' ? (
            <div className="space-y-2">
              <p className="text-error text-xs">{diagError}</p>
              <Button variant="outline" size="sm" onClick={() => void runDiagnosis()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : null}
          {status === 'idle' ? (
            <Button variant="outline" size="sm" onClick={() => void runDiagnosis()}>
              {t('error.diagnosis.ai_button')}
            </Button>
          ) : null}
        </AccordionContent>
      </AccordionItem>
    )
  }
)

export default AiDiagnosisSectionWithStatus
