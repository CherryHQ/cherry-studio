import { LockKeyhole, Settings2 } from 'lucide-react'
import { type ReactElement, type ReactNode, useId, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PortalContainerProvider, Scrollbar, Tabs, TabsContent } from '@cherrystudio/ui'
import { CliModelAvatar } from '@renderer/components/Avatar/CliModelAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { LocalAgentModelTabList } from '@renderer/components/localAgent/LocalAgentModelTabList'
import {
  MODEL_SELECTOR_CONTENT_HEIGHT,
  MODEL_SELECTOR_WIDTH,
  ModelSelectorRow,
  useModelListKeyboardNav
} from '@renderer/components/ModelSelector'
import { SelectorShell } from '@renderer/components/SelectorShell'
import { ModelTag } from '@renderer/components/tags/Model'
import type { LocalAgentModelOption } from '@renderer/hooks/agent/useLocalAgentModelSelection'
import { useLocalAgentModelTabs } from '@renderer/hooks/agent/useLocalAgentModelTabs'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import { getSearchMatchScore } from '@renderer/utils/model'
import { cn } from '@renderer/utils/style'

interface LocalAgentModelSelectorProps {
  trigger: ReactElement
  models: LocalAgentModelOption[]
  value?: string
  disabled?: boolean
  loading?: boolean
  loaded?: boolean
  error?: string
  onOpenSettings?: () => void
  footer?: ReactNode
  configuration?: ReactNode
  side?: 'top' | 'bottom'
  onLoad: () => void | Promise<void>
  onSelect: (value?: string) => Promise<boolean>
}

export function LocalAgentModelSelector({
  trigger,
  models,
  value,
  disabled,
  loading,
  loaded,
  error,
  onOpenSettings,
  footer,
  configuration,
  side = 'bottom',
  onLoad,
  onSelect
}: LocalAgentModelSelectorProps) {
  const { t } = useTranslation()
  const classifiedError = error ? classifyLocalAgentError(error) : undefined
  const regionRestricted = classifiedError?.kind === 'region'
  const authenticationRequired = regionRestricted || classifiedError?.kind === 'authentication'
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [focusedKey, setFocusedKey] = useState('')
  const listboxId = useId()
  const tabs = useLocalAgentModelTabs(models, value)
  const options = tabs.source === 'native' ? [undefined, ...tabs.models] : tabs.models
  const items = options
    .flatMap((model) => {
      const label = model ? model.name || model.id : t('local_agents.follow_cli')
      const score = getSearchMatchScore(searchText, [
        { value: label, weight: 0, allowAbbreviation: true },
        { value: model?.id, weight: 1, allowAbbreviation: true },
        { value: model?.group, weight: 2, allowAbbreviation: false, allowPinyin: true }
      ])
      return score === null ? [] : [{ key: model?.id ?? '__cli_default__', model, label, score }]
    })
    .sort((a, b) => a.score - b.score)
  const activeKey = items.some((item) => item.key === focusedKey)
    ? focusedKey
    : (items.find((item) => item.model?.id === value)?.key ?? items[0]?.key ?? '')
  const groups = new Map<string, typeof items>()
  for (const item of items) {
    const group = item.model?.group ?? ''
    const entries = groups.get(group)
    if (entries) entries.push(item)
    else groups.set(group, [item])
  }
  const optionId = (key: string) => `${listboxId}-${encodeURIComponent(key)}`
  const select = async (next?: string) => {
    if (disabled) return
    if (await onSelect(next)) setOpen(false)
  }
  useModelListKeyboardNav({
    open,
    focusedItemKey: activeKey,
    items: disabled ? [] : [...groups.values()].flat(),
    onClose: () => setOpen(false),
    onFocusItem: setFocusedKey,
    onSelectItem: (item) => void select(item.model?.id)
  })
  useLayoutEffect(() => {
    if (open && activeKey)
      document.getElementById(`${listboxId}-${encodeURIComponent(activeKey)}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeKey, listboxId, open, tabs.source])
  return (
    <Tabs
      value={tabs.source}
      onValueChange={(source) => {
        tabs.setSource(source)
        setSearchText('')
        setFocusedKey('')
      }}
      className="contents">
      <SelectorShell
        trigger={trigger}
        open={open}
        onOpenChange={(next) => {
          if (next) tabs.setSource()
          setSearchText('')
          setFocusedKey('')
          setOpen(next)
          if (next && !loaded && !loading && !disabled) void onLoad()
        }}
        width={MODEL_SELECTOR_WIDTH}
        contentHeight={MODEL_SELECTOR_CONTENT_HEIGHT}
        side={side}
        search={{
          value: searchText,
          onChange: (text) => {
            setSearchText(text)
            setFocusedKey('')
          },
          placeholder: t('models.search.placeholder'),
          ariaControls: listboxId,
          activeDescendant: activeKey ? optionId(activeKey) : undefined,
          onKeyDown: (event) => {
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter'].includes(event.key)) event.preventDefault()
          }
        }}
        filterContent={
          tabs.sources.length > 1 ? (
            <LocalAgentModelTabList
              sources={tabs.sources}
              className="min-h-7 w-full p-0.5 [&>[data-slot=tabs-trigger]]:py-0.5"
            />
          ) : undefined
        }
        bottomAction={
          onOpenSettings
            ? {
                icon: <Settings2 className="size-3.5" />,
                label: t('local_agents.manage_in_code_mate'),
                onClick: () => {
                  setOpen(false)
                  onOpenSettings()
                }
              }
            : undefined
        }>
        {({ contentElement }) => (
          <PortalContainerProvider container={contentElement ?? null}>
            <TabsContent value={tabs.source} className="flex h-full min-h-0 flex-col">
              {configuration && (
                <div className="shrink-0 px-2 py-1" onKeyDown={(event) => event.stopPropagation()}>
                  {configuration}
                </div>
              )}
              {(error || footer || (!loading && loaded && !models.length)) && (
                <div className="shrink-0 space-y-2 border-b border-border-subtle px-3 py-2 text-xs">
                  {error && (
                    <div role="alert" className="flex gap-2">
                      {authenticationRequired && (
                        <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <p className={cn('min-w-0 break-words', !authenticationRequired && 'text-destructive')}>
                        {authenticationRequired
                          ? t(
                              regionRestricted
                                ? 'local_agents.auth_region_unavailable'
                                : 'local_agents.sign_in_required'
                            )
                          : classifiedError?.message}
                      </p>
                    </div>
                  )}
                  {!loading && !error && loaded && !models.length && (
                    <p className="text-muted-foreground">{t('local_agents.models_unavailable')}</p>
                  )}
                  {footer}
                </div>
              )}
              <Scrollbar
                className="min-h-0 flex-1 py-1"
                role="listbox"
                id={listboxId}
                aria-label={t('settings.models.list_title')}>
                {[...groups].map(([group, entries]) => (
                  <div key={group}>
                    {group && (
                      <div className="sticky top-0 z-1 flex h-7 items-center bg-popover px-4 text-[11px] text-muted-foreground">
                        {group}
                      </div>
                    )}
                    {entries.map(({ key, model, label }) => {
                      const selected = model ? value === model.id : !value
                      return (
                        <div key={key} className="px-1 py-0.5" onMouseEnter={() => setFocusedKey(key)}>
                          <ModelSelectorRow
                            selected={selected}
                            focused={activeKey === key}
                            disabled={disabled}
                            showSelectedIndicator={selected}
                            onSelect={() => void select(model?.id)}
                            optionProps={{ id: optionId(key), 'aria-label': label }}
                            leading={
                              model ? (
                                <ModelAvatar model={model} size={24} className="rounded-full border border-border" />
                              ) : (
                                <CliModelAvatar className="size-6 border border-border" />
                              )
                            }
                            trailing={
                              model && /free/i.test(`${model.id} ${model.name}`) ? (
                                <div className="ml-2 flex h-[18px] shrink-0 items-center justify-end gap-1">
                                  <ModelTag
                                    tag="free"
                                    size={9}
                                    showLabel={false}
                                    showTooltip
                                    className="h-full items-center"
                                  />
                                </div>
                              ) : undefined
                            }>
                            <span className="min-w-0 max-w-full truncate" title={model ? label : undefined}>
                              {label}
                            </span>
                          </ModelSelectorRow>
                        </div>
                      )
                    })}
                  </div>
                ))}
                {!items.length && (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t('models.no_matches')}</div>
                )}
              </Scrollbar>
            </TabsContent>
          </PortalContainerProvider>
        )}
      </SelectorShell>
    </Tabs>
  )
}
