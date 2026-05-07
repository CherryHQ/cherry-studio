import { dbService } from '@renderer/services/db/DbService'
import type { DiagnosisContext, DiagnosisResult } from '@renderer/services/ErrorDiagnosisService'
import { diagnoseError } from '@renderer/services/ErrorDiagnosisService'
import store from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import type { SerializedError } from '@renderer/types/error'
import { CheckCircle, Loader2 } from 'lucide-react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

function persistDiagnosis(blockId: string, diagnosis: DiagnosisResult) {
  const block = store.getState().messageBlocks.entities[blockId]
  const updatedMetadata = { ...block?.metadata, diagnosis }
  store.dispatch(updateOneBlock({ id: blockId, changes: { metadata: updatedMetadata } }))
  void dbService.updateSingleBlock(blockId, { metadata: updatedMetadata })
}

const diagPanelStyle: React.CSSProperties = {
  border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
  background: 'color-mix(in srgb, var(--color-primary) 3%, transparent)'
}

const stepBgStyle: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--color-primary) 4%, transparent)'
}

export interface AIDiagnosisSectionHandle {
  runDiagnosis: () => void
}

const AIDiagnosisSectionWithStatus = memo(
  ({
    error,
    status,
    onStatusChange,
    diagnosisContext,
    blockId,
    cachedDiagnosis,
    ref
  }: {
    error?: SerializedError
    status: 'idle' | 'loading' | 'done' | 'error'
    onStatusChange: (status: 'idle' | 'loading' | 'done' | 'error') => void
    diagnosisContext?: DiagnosisContext
    blockId?: string
    cachedDiagnosis?: DiagnosisResult
    ref?: React.Ref<AIDiagnosisSectionHandle>
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

    // Auto-start diagnosis when section mounts with loading status (first click from parent)
    useEffect(() => {
      if (status === 'loading' && !cachedDiagnosis) {
        void runDiagnosis()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
    }, [])

    const runDiagnosis = useCallback(async () => {
      if (!error) return
      cancelledRef.current = false
      onStatusChange('loading')
      setDiagError('')
      try {
        const diagnosis = await diagnoseError(error, i18n.language, diagnosisContext)
        if (cancelledRef.current) return
        setResult(diagnosis)
        onStatusChange('done')
        if (blockId) {
          persistDiagnosis(blockId, diagnosis)
        }
      } catch (err: unknown) {
        if (cancelledRef.current) return
        setDiagError(err instanceof Error ? err.message : 'Diagnosis failed')
        onStatusChange('error')
      }
    }, [error, i18n.language, onStatusChange, diagnosisContext, blockId])

    React.useImperativeHandle(ref, () => ({ runDiagnosis }), [runDiagnosis])

    return (
      <div className="mt-4 rounded-lg p-3.5 px-4" style={diagPanelStyle}>
        {status === 'loading' && (
          <div className="flex items-center gap-1.5 font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>
            <Loader2 size={14} className="animation-rotate" />
            {t('error.diagnosis.ai_loading')}...
          </div>
        )}
        {status === 'error' && (
          <>
            <div
              className="mb-2.5 flex items-center gap-1.5 font-semibold text-sm"
              style={{ color: 'var(--color-error)' }}>
              {diagError}
            </div>
            <button
              type="button"
              className="cursor-pointer rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              onClick={() => void runDiagnosis()}>
              {t('common.retry')}
            </button>
          </>
        )}
        {status === 'done' && result && (
          <>
            <div
              className="mb-2.5 flex items-center gap-1.5 font-semibold text-sm"
              style={{ color: 'var(--color-primary)' }}>
              <CheckCircle size={14} />
              {t('error.diagnosis.ai_result')}
            </div>
            <div className="text-[13px] leading-[1.7]" style={{ color: 'var(--color-text-2)' }}>
              {result.explanation || result.summary}
            </div>
            {result.steps.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-1.5">
                {result.steps.map((step, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]"
                    style={stepBgStyle}>
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold text-[10px] text-white"
                      style={{ background: 'var(--color-primary)' }}>
                      {i + 1}
                    </span>
                    <span>{step.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }
)

export default AIDiagnosisSectionWithStatus
