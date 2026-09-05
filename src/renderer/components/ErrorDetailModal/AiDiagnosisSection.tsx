import { Badge, Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import { CircleAlert, CircleCheck, Loader2, Sparkles } from 'lucide-react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AIDiagnosisSection')

export interface AiDiagnosisSectionHandle {
  runDiagnosis: () => void
}

const AiDiagnosisSectionWithStatus = memo(
  ({
    error,
    status,
    onStatusChange,
    diagnosisContext,
    blockId,
    onDiagnosisComplete,
    cachedDiagnosis,
    ref
  }: {
    error?: SerializedError
    status: 'idle' | 'loading' | 'done' | 'error'
    onStatusChange: (status: 'idle' | 'loading' | 'done' | 'error') => void
    diagnosisContext?: DiagnosisContext
    blockId?: string
    onDiagnosisComplete?: (partId: string, diagnosis: DiagnosisResult) => void | Promise<void>
    cachedDiagnosis?: DiagnosisResult
    ref?: React.Ref<AiDiagnosisSectionHandle>
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

    useEffect(() => {
      if (status === 'loading' && !cachedDiagnosis) {
        void runDiagnosis()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the host chooses whether the initial state should run
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

    React.useImperativeHandle(ref, () => ({ runDiagnosis }), [runDiagnosis])

    return (
      <div
        className="rounded-xl border border-border bg-background p-4"
        role={status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
        aria-atomic="true">
        <div className="flex flex-wrap items-center gap-2">
          {status === 'loading' ? (
            <Loader2 className="size-4 shrink-0 text-primary motion-safe:animate-spin" aria-hidden />
          ) : status === 'done' ? (
            <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
          ) : status === 'error' ? (
            <CircleAlert className="size-4 shrink-0 text-error" aria-hidden />
          ) : (
            <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <p className="font-medium text-sm">{t('error.diagnosis.ai_button')}</p>
          <Badge variant="outline" className="font-normal text-xs">
            {status === 'loading'
              ? t('error.diagnosis.ai_loading')
              : status === 'done'
                ? t('error.diagnosis.ai_done')
                : status === 'error'
                  ? t('settings.doctor.status.error')
                  : t('settings.doctor.status.pending')}
          </Badge>
        </div>

        {status === 'error' ? (
          <div className="mt-3 space-y-2">
            <p className="text-error text-xs">{diagError}</p>
            <Button variant="outline" size="sm" onClick={() => void runDiagnosis()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}

        {status === 'done' && result ? (
          <div className="mt-3 space-y-2 text-muted-foreground text-sm leading-6">
            <p>{result.explanation || result.summary}</p>
            {result.steps.length > 0 ? (
              <ol className="space-y-1.5">
                {result.steps.map((step, index) => (
                  <li key={`${index}-${step.text}`} className="flex gap-2 rounded-md bg-secondary px-2.5 py-1.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs">
                      {index + 1}
                    </span>
                    <span>{step.text}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }
)

export default AiDiagnosisSectionWithStatus
