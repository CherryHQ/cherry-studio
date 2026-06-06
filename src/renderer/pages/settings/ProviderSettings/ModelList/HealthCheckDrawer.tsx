import {
  Avatar,
  AvatarFallback,
  Button,
  Input,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  Tooltip
} from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { getModelLogo } from '@renderer/config/models'
import type {
  ModelHealthCheckGenerationOutput,
  ModelHealthCheckSkipReason,
  ModelWithStatus
} from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { cn } from '@renderer/utils'
import { maskApiKey } from '@renderer/utils/api'
import { CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { drawerClasses } from '../primitives/ProviderSettingsPrimitives'
import { healthCheckErrorToDisplayString } from '../utils/healthCheck'

interface HealthCheckDrawerProps {
  open: boolean
  title: string
  apiKeys: string[]
  isChecking: boolean
  modelStatuses: ModelWithStatus[]
  onClose: () => void
  onResetRun: () => void
  onStart: (config: { apiKeys: string[]; isConcurrent: boolean; timeout: number }) => Promise<void>
}

export default function HealthCheckDrawer({
  open,
  title,
  apiKeys,
  isChecking,
  modelStatuses,
  onClose,
  onResetRun,
  onStart
}: HealthCheckDrawerProps) {
  const { t } = useTranslation()
  const [selectedKeyIndex, setSelectedKeyIndex] = useState(0)
  const [keyCheckMode, setKeyCheckMode] = useState<'single' | 'all'>('all')
  const [isConcurrent, setIsConcurrent] = useState(true)
  const [timeoutSeconds, setTimeoutSeconds] = useState(15)
  const [isStarting, setIsStarting] = useState(false)

  const showPipeline = modelStatuses.length > 0

  const progressStats = useMemo(() => {
    if (modelStatuses.length === 0) {
      return null
    }
    const total = modelStatuses.length
    const done = modelStatuses.filter((s) => !s.checking).length
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
    return { done, total, pct }
  }, [modelStatuses])

  const successCount = useMemo(
    () => modelStatuses.filter((s) => s.status === HealthStatus.SUCCESS).length,
    [modelStatuses]
  )
  const failCount = useMemo(() => modelStatuses.filter((s) => s.status === HealthStatus.FAILED).length, [modelStatuses])
  const skippedCount = useMemo(() => modelStatuses.filter((s) => s.kind === 'skipped').length, [modelStatuses])

  const getGenerationOutputText = (output: ModelHealthCheckGenerationOutput) => {
    switch (output) {
      case 'image':
        return t('settings.models.check.generation_output_image')
      case 'video':
        return t('settings.models.check.generation_output_video')
      case 'audio':
        return t('settings.models.check.generation_output_audio')
    }
  }

  const getSkipReasonText = (reason: ModelHealthCheckSkipReason) => {
    switch (reason.kind) {
      case 'generation_cost':
        return t('settings.models.check.skip_reason_generation_cost', {
          output: getGenerationOutputText(reason.output)
        })
      case 'unsupported_probe':
        return t('settings.models.check.skip_reason_unsupported_probe')
    }
  }

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

  const footer = !showPipeline ? (
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
  ) : isChecking ? (
    <div className={drawerClasses.footer}>
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </div>
  ) : (
    <div className={drawerClasses.footer}>
      <Button variant="outline" onClick={onClose}>
        {t('common.close')}
      </Button>
      <Button
        variant="default"
        onClick={() => {
          onResetRun()
        }}>
        {t('settings.models.check.retry')}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer open={open} onClose={onClose} title={title} footer={footer}>
      <p className={cn(drawerClasses.helpText, 'shrink-0')}>{t('settings.models.check.disclaimer')}</p>

      {showPipeline && progressStats ? (
        <div className="flex min-h-0 flex-1 flex-col gap-0">
          {isChecking ? (
            <div className="px-4 pt-3 pb-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-medium text-[13px] text-foreground/85">
                  {t('settings.models.check.pipeline_heading')}
                </span>
                <span className={drawerClasses.healthProgressMeta}>
                  {t('settings.models.check.progress_count', {
                    done: progressStats.done,
                    total: progressStats.total
                  })}
                </span>
              </div>
              <div
                className={drawerClasses.healthProgressTrack}
                role="progressbar"
                aria-valuenow={progressStats.pct}
                aria-valuemin={0}
                aria-valuemax={100}>
                <div className={drawerClasses.healthProgressFill} style={{ width: `${progressStats.pct}%` }} />
              </div>
            </div>
          ) : null}

          {!isChecking && showPipeline ? (
            <div className="mx-4 mt-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-muted/50 px-3.5 py-2.5">
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="flex size-3.5 items-center justify-center rounded-full bg-muted">
                  <CheckCircle2 size={9} className="text-foreground-muted" />
                </div>
                <span className="text-foreground-muted text-xs">
                  {t('settings.models.check.outcome_success_short', { count: successCount })}
                </span>
              </div>
              {failCount > 0 ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="flex size-3.5 items-center justify-center rounded-full bg-destructive/12">
                    <XCircle size={9} className="text-destructive" />
                  </div>
                  <span className="text-destructive/80 text-xs">
                    {t('settings.models.check.outcome_fail_short', { count: failCount })}
                  </span>
                </div>
              ) : null}
              {skippedCount > 0 ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="flex size-3.5 items-center justify-center rounded-full bg-muted">
                    <Info size={9} className="text-foreground-muted" />
                  </div>
                  <span className="text-foreground-muted text-xs">
                    {t('settings.models.check.outcome_skipped_short', { count: skippedCount })}
                  </span>
                </div>
              ) : null}
              <span className="ml-auto shrink-0 text-muted-foreground/60 text-xs">
                {t('settings.models.check.outcome_total', { count: modelStatuses.length })}
              </span>
            </div>
          ) : null}

          <Scrollbar className="max-h-[min(56vh,30rem)] min-h-0 flex-1 px-2 pb-0">
            <ul className="divide-y divide-border/50 pt-1 pb-0">
              {modelStatuses.map((row) => {
                const { model, checking, status, latency, error } = row
                const Icon = getModelLogo(model)
                const pending = !checking && status === HealthStatus.NOT_CHECKED

                let statusCell: ReactNode
                let rightCell: ReactNode

                if (row.kind === 'skipped') {
                  const skipReasonText = getSkipReasonText(row.skipReason)
                  statusCell = <Info className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
                  rightCell = (
                    <Tooltip
                      content={
                        <span className="block max-w-full whitespace-pre-wrap text-left text-[12px] leading-snug">
                          {skipReasonText}
                        </span>
                      }
                      placement="top"
                      classNames={{
                        placeholder: 'block min-w-0 w-full max-w-full overflow-hidden'
                      }}>
                      <span className="block w-full min-w-0 cursor-default truncate text-end text-[12px] text-muted-foreground/80">
                        {t('settings.models.check.status_skipped')}
                      </span>
                    </Tooltip>
                  )
                } else if (checking) {
                  statusCell = <Loader2 className="size-4 shrink-0 animate-spin text-warning" aria-hidden />
                  rightCell = (
                    <span className="shrink-0 font-medium text-[12px] text-warning">
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
                      <span className="shrink-0 text-[12px] text-muted-foreground/80 tabular-nums">
                        {Math.round(latency)}ms
                      </span>
                    ) : (
                      <span className="shrink-0 text-[12px] text-muted-foreground/80">
                        {t('settings.models.check.passed')}
                      </span>
                    )
                } else {
                  statusCell = <XCircle className="size-4 shrink-0 text-destructive/85" aria-hidden />
                  const errText = healthCheckErrorToDisplayString(error)
                  rightCell =
                    errText !== '' ? (
                      <Tooltip
                        content={
                          <span className="block max-w-full whitespace-pre-wrap break-all text-left text-[12px] leading-snug">
                            {errText}
                          </span>
                        }
                        placement="top"
                        classNames={{
                          placeholder: 'block min-w-0 w-full max-w-full overflow-hidden'
                        }}>
                        <span className="block w-full min-w-0 cursor-default truncate text-end text-[12px] text-destructive/85">
                          {errText}
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="shrink-0 text-[12px] text-destructive/85">
                        {t('settings.models.check.failed')}
                      </span>
                    )
                }

                return (
                  <li
                    key={model.id}
                    className={cn(
                      'flex min-h-[44px] min-w-0 items-center gap-3 rounded-lg px-2 py-2.5',
                      status === HealthStatus.FAILED ? 'bg-destructive/[0.03]' : ''
                    )}>
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
                    <div
                      className={cn(
                        'min-w-0 text-end',
                        status === HealthStatus.FAILED
                          ? 'max-w-[min(52%,15rem)] flex-1 basis-0'
                          : 'max-w-[min(42%,14rem)] shrink-0'
                      )}>
                      {rightCell}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Scrollbar>
        </div>
      ) : null}

      {!showPipeline ? (
        <>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-foreground text-sm">{t('settings.models.check.use_all_keys')}</span>
              <SegmentedControl
                size="sm"
                value={keyCheckMode}
                onValueChange={(value) => setKeyCheckMode(value)}
                options={[
                  { value: 'single', label: t('settings.models.check.single') },
                  { value: 'all', label: t('settings.models.check.all') }
                ]}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-foreground text-sm">
                {t('settings.models.check.enable_concurrent')}
              </span>
              <SegmentedControl
                size="sm"
                value={isConcurrent ? 'on' : 'off'}
                onValueChange={(value) => setIsConcurrent(value === 'on')}
                options={[
                  { value: 'off', label: t('settings.models.check.disabled') },
                  { value: 'on', label: t('settings.models.check.enabled') }
                ]}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-foreground text-sm">{t('settings.models.check.timeout')}</span>
              <div className="flex w-[112px] items-center gap-2">
                <Input
                  type="number"
                  min={5}
                  max={60}
                  value={String(timeoutSeconds)}
                  onChange={(event) => setTimeoutSeconds(Math.min(60, Math.max(5, Number(event.target.value) || 15)))}
                />
                <span className="text-foreground-muted text-xs">s</span>
              </div>
            </div>
          </div>

          {keyCheckMode === 'single' && hasMultipleKeys ? (
            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="font-medium text-[13px] text-foreground/85">
                {t('settings.models.check.select_api_key')}
              </div>
              <RadioGroup
                value={String(selectedKeyIndex)}
                onValueChange={(value) => setSelectedKeyIndex(Number(value))}>
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
        </>
      ) : null}
    </ProviderSettingsDrawer>
  )
}
