import { Button, Input, RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { maskApiKey } from '@renderer/utils/api'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../components/ProviderSettingsDrawer'

interface HealthCheckDrawerProps {
  open: boolean
  title: string
  apiKeys: string[]
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

export default function HealthCheckDrawer({ open, title, apiKeys, onClose, onStart }: HealthCheckDrawerProps) {
  const { t } = useTranslation()
  const [selectedKeyIndex, setSelectedKeyIndex] = useState(0)
  const [keyCheckMode, setKeyCheckMode] = useState<'single' | 'all'>('all')
  const [isConcurrent, setIsConcurrent] = useState(true)
  const [timeoutSeconds, setTimeoutSeconds] = useState(15)
  const [isStarting, setIsStarting] = useState(false)

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

  const footer = (
    <div className="flex items-center justify-end gap-2">
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
    <ProviderSettingsDrawer open={open} onClose={onClose} title={title} footer={footer}>
      <div className="rounded-xl border border-warning/30 bg-warning/8 p-3 text-[12px] text-foreground/75 leading-[1.45]">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>{t('settings.models.check.disclaimer')}</span>
        </div>
      </div>

      <div className="space-y-4">
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
