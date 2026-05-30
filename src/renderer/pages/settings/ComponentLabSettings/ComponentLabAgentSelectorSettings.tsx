import { Button, RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { AgentSelector, type AgentSelectorItem } from '@renderer/components/ResourceSelector'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '..'

type SelectionType = 'id' | 'item'

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
  const [selectionType, setSelectionType] = useState<SelectionType>('id')
  const [idValue, setIdValue] = useState<string | null>(null)
  const [itemValue, setItemValue] = useState<AgentSelectorItem | null>(null)
  const [hasLastChange, setHasLastChange] = useState(false)
  const [lastChange, setLastChange] = useState<unknown>(undefined)

  useEffect(() => {
    setIdValue(null)
    setItemValue(null)
    setHasLastChange(false)
    setLastChange(undefined)
  }, [selectionType])

  const record = useCallback((next: unknown) => {
    setHasLastChange(true)
    setLastChange(next)
  }, [])

  const handleIdChange = useCallback(
    (next: string | null) => {
      record(next)
      setIdValue(next)
    },
    [record]
  )

  const handleItemChange = useCallback(
    (next: AgentSelectorItem | null) => {
      record(next)
      setItemValue(next)
    },
    [record]
  )

  const currentValue = useMemo(
    () => (selectionType === 'item' ? itemValue : idValue),
    [idValue, itemValue, selectionType]
  )

  // Mirror the selector's query so id-mode trigger labels can resolve id -> name.
  const { data: agentData } = useQuery('/agents', { query: { limit: 500 } })
  const idToName = useMemo(() => {
    const m = new Map<string, string>()
    for (const agent of agentData?.items ?? []) m.set(agent.id, agent.name)
    return m
  }, [agentData])
  const nameForId = useCallback((id: string) => idToName.get(id) ?? id, [idToName])

  const triggerLabel = useMemo(() => {
    const placeholder = t('settings.componentLab.agentSelector.triggerPlaceholder')
    if (selectionType === 'item') return itemValue?.name ?? placeholder
    return idValue ? nameForId(idValue) : placeholder
  }, [idValue, itemValue, nameForId, selectionType, t])

  const trigger = (
    <Button variant="outline" className="min-w-[240px] justify-between gap-3 text-left">
      <span className="truncate">{triggerLabel}</span>
    </Button>
  )

  const currentProps = useMemo(() => ({ selectionType }), [selectionType])

  const clear = useCallback(() => {
    if (selectionType === 'item') setItemValue(null)
    else setIdValue(null)
  }, [selectionType])

  const selectorNode =
    selectionType === 'item' ? (
      <AgentSelector trigger={trigger} selectionType="item" value={itemValue} onChange={handleItemChange} />
    ) : (
      <AgentSelector trigger={trigger} value={idValue} onChange={handleIdChange} />
    )

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <div className="space-y-3 rounded-[12px] border border-border bg-background p-4">
          <div>
            <div className="font-medium text-foreground text-sm">
              {t('settings.componentLab.agentSelector.configTitle')}
            </div>
            <div className="mt-1 text-muted-foreground text-xs">
              {t('settings.componentLab.agentSelector.configDescription')}
            </div>
          </div>

          <SettingRow>
            <SettingRowTitle>multi</SettingRowTitle>
            <div className="text-muted-foreground text-xs">false</div>
          </SettingRow>

          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs">selectionType</div>
            <RadioGroup
              className="grid grid-cols-2 gap-2"
              value={selectionType}
              onValueChange={(v) => setSelectionType(v as SelectionType)}>
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-foreground text-xs transition-colors hover:bg-accent/40"
                htmlFor="agent-selection-type-id">
                <RadioGroupItem id="agent-selection-type-id" value="id" />
                <span>id</span>
              </label>
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-foreground text-xs transition-colors hover:bg-accent/40"
                htmlFor="agent-selection-type-item">
                <RadioGroupItem id="agent-selection-type-item" value="item" />
                <span>item</span>
              </label>
            </RadioGroup>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium text-foreground text-sm">
                {t('settings.componentLab.agentSelector.previewTitle')}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {t('settings.componentLab.agentSelector.previewDescription')}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={clear}>
              {t('settings.componentLab.agentSelector.clearSelection')}
            </Button>
          </div>

          {selectorNode}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <DebugPanel
          title={t('settings.componentLab.agentSelector.currentProps')}
          value={formatSnapshot(currentProps)}
        />
        <DebugPanel title={t('settings.componentLab.agentSelector.valueProp')} value={formatSnapshot(currentValue)} />
        <DebugPanel
          title={t('settings.componentLab.agentSelector.lastOnChange')}
          value={hasLastChange ? formatSnapshot(lastChange) : undefined}
        />
      </div>
    </div>
  )
}

export default ComponentLabAgentSelectorSettings
