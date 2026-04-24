import { Button, RadioGroup, RadioGroupItem, Switch } from '@cherrystudio/ui'
import { AssistantSelectorV2, type AssistantSelectorV2Item } from '@renderer/components/selectors/v2'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingRow, SettingRowTitle } from '.'

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

const ComponentLabAssistantSelectorSettings: FC = () => {
  const { t } = useTranslation()
  const [multi, setMulti] = useState(false)
  const [selectionType, setSelectionType] = useState<SelectionType>('id')

  // One state slot per API combination so TS matches AssistantSelectorV2 props strictly.
  const [singleId, setSingleId] = useState<string | null>(null)
  const [singleItem, setSingleItem] = useState<AssistantSelectorV2Item | null>(null)
  const [multiIds, setMultiIds] = useState<string[]>([])
  const [multiItems, setMultiItems] = useState<AssistantSelectorV2Item[]>([])

  const [hasLastChange, setHasLastChange] = useState(false)
  const [lastChange, setLastChange] = useState<unknown>(undefined)

  // Reset every slot when the API shape flips so the debug snapshots stay aligned with the mode.
  useEffect(() => {
    setSingleId(null)
    setSingleItem(null)
    setMultiIds([])
    setMultiItems([])
    setHasLastChange(false)
    setLastChange(undefined)
  }, [multi, selectionType])

  const record = useCallback((next: unknown) => {
    setHasLastChange(true)
    setLastChange(next)
  }, [])

  const handleSingleIdChange = useCallback(
    (next: string | null) => {
      record(next)
      setSingleId(next)
    },
    [record]
  )
  const handleSingleItemChange = useCallback(
    (next: AssistantSelectorV2Item | null) => {
      record(next)
      setSingleItem(next)
    },
    [record]
  )
  const handleMultiIdsChange = useCallback(
    (next: string[]) => {
      record(next)
      setMultiIds(next)
    },
    [record]
  )
  const handleMultiItemsChange = useCallback(
    (next: AssistantSelectorV2Item[]) => {
      record(next)
      setMultiItems(next)
    },
    [record]
  )

  const currentValue = useMemo(() => {
    if (multi) return selectionType === 'item' ? multiItems : multiIds
    return selectionType === 'item' ? singleItem : singleId
  }, [multi, multiIds, multiItems, selectionType, singleId, singleItem])

  // Mirror the selector's own query so id-mode trigger labels can resolve id → name.
  // React Query dedupes against the selector's useQuery, so no extra network cost.
  const { data: assistantData } = useQuery('/assistants', { query: { limit: 500 } })
  const idToName = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assistantData?.items ?? []) m.set(a.id, a.name)
    return m
  }, [assistantData])
  const nameForId = useCallback((id: string) => idToName.get(id) ?? id, [idToName])

  const triggerLabel = useMemo(() => {
    const placeholder = t('settings.componentLab.assistantSelector.triggerPlaceholder')
    if (multi) {
      const count = selectionType === 'item' ? multiItems.length : multiIds.length
      return count > 0 ? t('settings.componentLab.assistantSelector.triggerSelectedCount', { count }) : placeholder
    }
    if (selectionType === 'item') return singleItem?.name ?? placeholder
    return singleId ? nameForId(singleId) : placeholder
  }, [multi, multiIds.length, multiItems.length, nameForId, selectionType, singleId, singleItem, t])

  const trigger = (
    <Button variant="outline" className="min-w-[240px] justify-between gap-3 text-left">
      <span className="truncate">{triggerLabel}</span>
    </Button>
  )

  const currentProps = useMemo(() => ({ multi, selectionType }), [multi, selectionType])

  const clear = useCallback(() => {
    if (multi) {
      if (selectionType === 'item') setMultiItems([])
      else setMultiIds([])
    } else {
      if (selectionType === 'item') setSingleItem(null)
      else setSingleId(null)
    }
  }, [multi, selectionType])

  const selectorNode = (() => {
    if (multi && selectionType === 'item') {
      return (
        <AssistantSelectorV2
          trigger={trigger}
          multi
          selectionType="item"
          value={multiItems}
          onChange={handleMultiItemsChange}
        />
      )
    }
    if (multi) {
      return <AssistantSelectorV2 trigger={trigger} multi value={multiIds} onChange={handleMultiIdsChange} />
    }
    if (selectionType === 'item') {
      return (
        <AssistantSelectorV2
          trigger={trigger}
          selectionType="item"
          value={singleItem}
          onChange={handleSingleItemChange}
        />
      )
    }
    return <AssistantSelectorV2 trigger={trigger} value={singleId} onChange={handleSingleIdChange} />
  })()

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <div className="space-y-3 rounded-[12px] border border-border bg-background p-4">
          <div>
            <div className="font-medium text-foreground text-sm">
              {t('settings.componentLab.assistantSelector.configTitle')}
            </div>
            <div className="mt-1 text-muted-foreground text-xs">
              {t('settings.componentLab.assistantSelector.configDescription')}
            </div>
          </div>

          <SettingRow>
            <SettingRowTitle>multi</SettingRowTitle>
            <Switch checked={multi} onCheckedChange={setMulti} />
          </SettingRow>

          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs">selectionType</div>
            <RadioGroup
              className="grid grid-cols-2 gap-2"
              value={selectionType}
              onValueChange={(v) => setSelectionType(v as SelectionType)}>
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-foreground text-xs transition-colors hover:bg-accent/40"
                htmlFor="assistant-selection-type-id">
                <RadioGroupItem id="assistant-selection-type-id" value="id" />
                <span>id</span>
              </label>
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-foreground text-xs transition-colors hover:bg-accent/40"
                htmlFor="assistant-selection-type-item">
                <RadioGroupItem id="assistant-selection-type-item" value="item" />
                <span>item</span>
              </label>
            </RadioGroup>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium text-foreground text-sm">
                {t('settings.componentLab.assistantSelector.previewTitle')}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {t('settings.componentLab.assistantSelector.previewDescription')}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={clear}>
              {t('settings.componentLab.assistantSelector.clearSelection')}
            </Button>
          </div>

          {selectorNode}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <DebugPanel
          title={t('settings.componentLab.assistantSelector.currentProps')}
          value={formatSnapshot(currentProps)}
        />
        <DebugPanel
          title={t('settings.componentLab.assistantSelector.valueProp')}
          value={formatSnapshot(currentValue)}
        />
        <DebugPanel
          title={t('settings.componentLab.assistantSelector.lastOnChange')}
          value={hasLastChange ? formatSnapshot(lastChange) : undefined}
        />
      </div>
    </div>
  )
}

export default ComponentLabAssistantSelectorSettings
