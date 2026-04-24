import { Button } from '@cherrystudio/ui'
import { AgentSelectorV2 } from '@renderer/components/Selectors'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SelectorValue = string | null

function formatSnapshot(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function DebugPanel({ title, value }: { title: string; value?: string }) {
  return (
    <div className="flex flex-col rounded-[12px] border border-border/70 bg-background p-3">
      <div className="mb-2 font-medium text-foreground text-xs">{title}</div>
      <pre className="min-h-[72px] flex-1 overflow-x-auto rounded-[8px] border border-border/50 bg-muted/30 px-3 py-2 font-mono text-muted-foreground text-xs leading-5">
        {value ?? '—'}
      </pre>
    </div>
  )
}

const ComponentLabAgentSelectorSettings: FC = () => {
  const { t } = useTranslation()
  const [value, setValue] = useState<SelectorValue>(null)
  const [hasLastChange, setHasLastChange] = useState(false)
  const [lastChange, setLastChange] = useState<SelectorValue | undefined>(undefined)

  const handleChange = useCallback((next: string | null) => {
    setHasLastChange(true)
    setLastChange(next)
    setValue(next)
  }, [])

  const triggerLabel = useMemo(() => value ?? t('settings.componentLab.agentSelector.triggerPlaceholder'), [value, t])

  const trigger = (
    <Button variant="outline" className="min-w-[240px] justify-between gap-3 text-left">
      <span className="truncate">{triggerLabel}</span>
    </Button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium text-foreground text-sm">
              {t('settings.componentLab.agentSelector.previewTitle')}
            </div>
            <div className="mt-1 max-w-[560px] text-muted-foreground text-xs leading-5">
              {t('settings.componentLab.agentSelector.emptyShellNotice')}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setValue(null)}>
            {t('settings.componentLab.agentSelector.clearSelection')}
          </Button>
        </div>

        <AgentSelectorV2 trigger={trigger} value={value} onChange={handleChange} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DebugPanel title={t('settings.componentLab.agentSelector.valueProp')} value={formatSnapshot(value)} />
        <DebugPanel
          title={t('settings.componentLab.agentSelector.lastOnChange')}
          value={hasLastChange ? formatSnapshot(lastChange) : undefined}
        />
      </div>
    </div>
  )
}

export default ComponentLabAgentSelectorSettings
