import { Avatar, AvatarFallback, Button, Input, RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { getModelLogo } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { cn } from '@renderer/utils'
import { maskApiKey } from '@renderer/utils/api'
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../components/ProviderSettingsDrawer'
import { drawerClasses } from '../components/ProviderSettingsPrimitives'

interface HealthCheckDrawerProps {
  open: boolean
  title: string
  apiKeys: string[]
  isChecking: boolean
  modelStatuses: ModelWithStatus[]
  onClose: () => void
  onStart: (config: { apiKeys: string[]; isConcurrent: boolean; timeout: number }) => Promise<void>
}

function ToggleButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 font-medium text-[12px] transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border/60 bg-transparent text-foreground/70 hover:bg-accent/40 hover:text-foreground'
      )}>
      {label}
    </button>
  )
}

export default function HealthCheckDrawer({
  open,
  title,
  apiKeys,
  isChecking,
  modelStatuses,
  onClose,
  onStart
}: HealthCheckDrawerProps) {
  const { t } = useTranslation()
  const [selectedKeyIndex, setSelectedKeyIndex] = useState(0)
  const [keyCheckMode, setKeyCheckMode] = useState<'single' | 'all'>('all')
  const [isConcurrent, setIsConcurrent] = useState(true)
  const [timeoutSeconds, setTimeoutSeconds] = useState(15)
  const [isStarting, setIsStarting] = useState(false)

  const progress = useMemo(() => {
    if (!isChecking || modelStatuses.length === 0) {
      return null
    }
    const total = modelStatuses.length
    const done = modelStatuses.filter((s) => !s.checking).length
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
    return { done, total, pct }
  }, [isChecking, modelStatuses])

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedKeyIndex(0)
    setKeyCheckMode('all')
    setIsConcurrent(true)
    setTimeoutSeconds(15)
  }, [open])

  const hasMultipleKeys = apiKeys.length > 1
  const showProgress = progress != null

  const footer = showProgress ? (
    <div className={drawerClasses.footer}>
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </div>
  ) : (
    <div className={drawerClasses.footer}>
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button
        loading={isStarting}
        onClick={async () => {
          setIsStarting(true)
          try {
            const keysToUse =
              keyCheckMode === 'single' ? (apiKeys[selectedKeyIndex] ? [apiKeys[selectedKeyIndex]] : []) : apiKeys
            await onStart({
              apiKeys: keysToUse,
              isConcurrent,
              timeout: timeoutSeconds * 1000
            })
          } finally {
            setIsStarting(false)
          }
        }}>
        {t('settings.models.check.start')}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={title}
      footer={footer}
      size={showProgress ? 'wide' : 'form'}>
      <div className="rounded-xl border border-warning/30 bg-warning/8 p-3 text-[12px] text-foreground/75 leading-[1.45]">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>{t('settings.models.check.disclaimer')}</span>
        </div>
      </div>

      {showProgress && progress ? (
        <div className="space-y-0 rounded-xl border border-border/60 bg-muted/10">
          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
            <span className="font-medium text-[13px] text-foreground/85">
              {t('settings.models.check.pipeline_heading')}
            </span>
            <span className={drawerClasses.healthProgressMeta}>
              {t('settings.models.check.progress_count', { done: progress.done, total: progress.total })}
            </span>
          </div>
          <div
            className={drawerClasses.healthProgressTrack}
            role="progressbar"
            aria-valuenow={progress.pct}
            aria-valuemin={0}
            aria-valuemax={100}>
            <div className={drawerClasses.healthProgressFill} style={{ width: `${progress.pct}%` }} />
          </div>
          <Scrollbar className="max-h-[min(42vh,22rem)] px-2">
            <ul className="divide-y divide-border/50 py-1">
              {modelStatuses.map((row) => {
                const { model, checking, status, latency } = row
                const Icon = getModelLogo(model)
                const pending = !checking && status === HealthStatus.NOT_CHECKED

                let statusCell: ReactNode
                let rightCell: ReactNode

                if (checking) {
                  statusCell = <Loader2 className="size-4 shrink-0 animate-spin text-warning" aria-hidden />
                  rightCell = (
                    <span className="shrink-0 text-[12px] font-medium text-warning">
                      {t('settings.models.check.status_checking')}
                    </span>
                  )
                } else if (pending) {
                  statusCell = (
                    <span className="mx-auto block size-1.5 shrink-0 rounded-full bg-muted-foreground/35" aria-hidden />
                  )
                  rightCell = <span className="shrink-0 text-[12px] text-muted-foreground/50" />
                } else if (status === HealthStatus.SUCCESS) {
                  statusCell = <CheckCircle2 className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
                  rightCell =
                    latency != null ? (
                      <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground/80">
                        {Math.round(latency)}ms
                      </span>
                    ) : (
                      <span className="shrink-0 text-[12px] text-muted-foreground/80">
                        {t('settings.models.check.passed')}
                      </span>
                    )
                } else {
                  statusCell = <XCircle className="size-4 shrink-0 text-destructive/85" aria-hidden />
                  rightCell = (
                    <span className="shrink-0 text-[12px] text-destructive/85">
                      {t('settings.models.check.failed')}
                    </span>
                  )
                }

                return (
                  <li key={model.id} className="flex min-h-[44px] items-center gap-3 px-2 py-2.5">
                    <div className="flex w-5 shrink-0 justify-center">{statusCell}</div>
                    {Icon ? (
                      <Icon.Avatar size={22} />
                    ) : (
                      <Avatar className="size-[22px] shrink-0 rounded-md text-[10px]">
                        <AvatarFallback className="rounded-md">{model.name?.[0]?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground/85">
                      {model.name}
                    </span>
                    <div className="min-w-[4.5rem] shrink-0 text-right">{rightCell}</div>
                  </li>
                )
              })}
            </ul>
          </Scrollbar>
          <p className={cn(drawerClasses.helpText, 'px-4 pb-3 pt-1 text-muted-foreground/75')}>
            {t('settings.models.check.progress_hint')}
          </p>
        </div>
      ) : null}

      <div className={cn('space-y-4', showProgress && 'pointer-events-none opacity-45')}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-[13px] text-foreground/85">{t('settings.models.check.use_all_keys')}</span>
          <div className="flex items-center gap-2">
            <ToggleButton
              active={keyCheckMode === 'single'}
              label={t('settings.models.check.single')}
              onClick={() => setKeyCheckMode('single')}
            />
            <ToggleButton
              active={keyCheckMode === 'all'}
              label={t('settings.models.check.all')}
              onClick={() => setKeyCheckMode('all')}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-[13px] text-foreground/85">
            {t('settings.models.check.enable_concurrent')}
          </span>
          <div className="flex items-center gap-2">
            <ToggleButton
              active={!isConcurrent}
              label={t('settings.models.check.disabled')}
              onClick={() => setIsConcurrent(false)}
            />
            <ToggleButton
              active={isConcurrent}
              label={t('settings.models.check.enabled')}
              onClick={() => setIsConcurrent(true)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-[13px] text-foreground/85">{t('settings.models.check.timeout')}</span>
          <div className="flex w-[112px] items-center gap-2">
            <Input
              type="number"
              min={5}
              max={60}
              value={String(timeoutSeconds)}
              onChange={(event) => setTimeoutSeconds(Math.min(60, Math.max(5, Number(event.target.value) || 15)))}
            />
            <span className="text-[12px] text-muted-foreground/80">s</span>
          </div>
        </div>
      </div>

      {keyCheckMode === 'single' && hasMultipleKeys ? (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
          <div className="font-medium text-[13px] text-foreground/85">{t('settings.models.check.select_api_key')}</div>
          <RadioGroup value={String(selectedKeyIndex)} onValueChange={(value) => setSelectedKeyIndex(Number(value))}>
            {apiKeys.map((key, index) => (
              <label
                key={`${key}-${index}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 hover:bg-accent/30">
                <RadioGroupItem value={String(index)} size="sm" />
                <span className="truncate font-mono text-[12px] text-foreground/70">{maskApiKey(key)}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
      ) : null}
    </ProviderSettingsDrawer>
  )
}
