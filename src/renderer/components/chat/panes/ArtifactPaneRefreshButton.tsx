import { Check, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'

export function ArtifactPaneRefreshButton({
  label,
  disabled = false,
  disabledReason,
  onRefresh
}: {
  label: string
  disabled?: boolean
  disabledReason?: string
  onRefresh(): Promise<void>
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (state !== 'success') return
    const timeout = setTimeout(() => setState('idle'), 1800)
    return () => clearTimeout(timeout)
  }, [state])

  const refresh = async () => {
    if (pending.current) return
    pending.current = true
    setState('pending')
    try {
      await onRefresh()
      if (mounted.current) setState('success')
    } catch {
      if (mounted.current) setState('error')
    } finally {
      pending.current = false
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      {state === 'error' && (
        <span role="alert" className="text-xs text-error">
          {t('agent.preview_pane.refresh.failed')}
        </span>
      )}
      {state === 'success' && (
        <span role="status" className="sr-only">
          {t('agent.preview_pane.refresh.done')}
        </span>
      )}
      <Tooltip
        content={disabledReason ?? (state === 'success' ? t('agent.preview_pane.refresh.done') : label)}
        delay={800}>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-busy={state === 'pending'}
            className="text-muted-foreground hover:bg-accent hover:text-foreground"
            disabled={disabled || state === 'pending'}
            onClick={() => void refresh()}>
            {state === 'pending' ? (
              <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden />
            ) : state === 'success' ? (
              <Check size={16} aria-hidden />
            ) : (
              <RefreshCw size={16} aria-hidden />
            )}
          </Button>
        </span>
      </Tooltip>
    </div>
  )
}
