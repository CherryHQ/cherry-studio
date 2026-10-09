import { ChevronDown, Settings2, ShieldAlert } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  Scrollbar
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { localAgentConfigOptions, localAgentModeOptions } from '@renderer/utils/agent/localAgentLabels'
import { reasoningEffortLabel } from '@renderer/utils/reasoning'
import type { LocalAgentConfigOption, LocalAgentSelection } from '@shared/ai/localAgent'

export function LocalAgentConfigControl({
  sessionId,
  presetId,
  options: nativeOptions = [],
  mode,
  thoughtLevel,
  disabled
}: {
  sessionId: string
  presetId?: string
  options?: LocalAgentConfigOption[]
  mode?: LocalAgentSelection
  thoughtLevel?: LocalAgentSelection
  disabled: boolean
}) {
  const { t } = useTranslation()
  const options = localAgentConfigOptions(nativeOptions, presetId, t)
  const [saving, setSaving] = useState(false)
  const modeOptions = mode ? localAgentModeOptions(mode, t, presetId) : []
  const currentMode = modeOptions.find((option) => option.value === mode?.currentValue)
  const riskyMode = !!mode?.options.some(
    (option) =>
      option.value === mode.currentValue &&
      ['bypass permissions', 'full access', 'bypasspermissions', 'bypass', 'yolo'].includes(option.name.toLowerCase())
  )
  const thoughtOptions = thoughtLevel?.options.map((option) => ({
    ...option,
    name: reasoningEffortLabel(option.value, t, option.name)
  }))
  const summary = [
    currentMode?.name ?? mode?.currentValue,
    thoughtOptions?.find((option) => option.value === thoughtLevel?.currentValue)?.name ?? thoughtLevel?.currentValue
  ]
    .filter(Boolean)
    .join(' · ')
  const selections: Array<{ kind: 'mode' | 'thought'; option: LocalAgentConfigOption }> = []
  if (mode && modeOptions.length > 1)
    selections.push({
      kind: 'mode',
      option: { ...mode, type: 'select', name: t('local_agents.mode'), options: modeOptions }
    })
  if (thoughtLevel && thoughtOptions && thoughtOptions.length > 1)
    selections.push({
      kind: 'thought',
      option: {
        ...thoughtLevel,
        type: 'select',
        name: t('assistants.settings.reasoning_effort.label'),
        options: thoughtOptions
      }
    })
  const rows = [...selections, ...options.map((option) => ({ kind: 'config' as const, option }))]
  if (!rows.length) return null
  const single = rows.length === 1
  const selectedName = (option: LocalAgentConfigOption) =>
    option.type === 'boolean'
      ? t(option.currentValue ? 'common.enabled' : 'common.disabled')
      : (option.options
          .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
          .find((choice) => choice.value === option.currentValue)?.name ?? option.currentValue)
  const triggerLabel = single
    ? t('local_agents.config_summary', { name: rows[0].option.name, value: selectedName(rows[0].option) })
    : summary || t('local_agents.configuration')
  const change = async (kind: 'mode' | 'thought' | 'config', configId: string, value: string | boolean) => {
    if (disabled || saving) return
    setSaving(true)
    try {
      if (kind === 'config') await ipcApi.request('ai.local_agents.set_config_option', { sessionId, configId, value })
      else if (typeof value === 'string')
        await ipcApi.request(kind === 'mode' ? 'ai.local_agents.set_mode' : 'ai.local_agents.set_thought_level', {
          sessionId,
          configId,
          value
        })
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSaving(false)
    }
  }
  const renderChoice = (option: { value: string; name: string; description?: string | null }) => (
    <DropdownMenuRadioItem
      key={option.value}
      value={option.value}
      textValue={option.name}
      disabled={disabled || saving}
      onSelect={(event) => event.preventDefault()}
      className="items-start rounded-md py-2 text-xs not-last:mb-1">
      <div className="min-w-0">
        <div>{option.name}</div>
        {option.description && (
          <div className="mt-0.5 whitespace-normal text-xs text-muted-foreground">{option.description}</div>
        )}
      </div>
    </DropdownMenuRadioItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 min-w-0 max-w-64 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground',
            riskyMode && 'text-warning-subtle-foreground'
          )}
          aria-label={t('local_agents.configuration')}>
          {riskyMode ? (
            <ShieldAlert className="lucide-custom size-3.5 shrink-0" />
          ) : (
            <Settings2 className="lucide-custom size-3.5 shrink-0" />
          )}
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="lucide-custom size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        alignOffset={single ? 0 : 288}
        className={cn('overflow-hidden p-1.5', single ? 'w-72' : 'w-64')}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {single ? rows[0].option.name : t('local_agents.configuration')}
        </DropdownMenuLabel>
        <Scrollbar className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))]">
          {rows.map(({ kind, option }) => {
            const choices =
              option.type === 'boolean'
                ? [
                    { value: 'true', name: t('common.enabled') },
                    { value: 'false', name: t('common.disabled') }
                  ]
                : option.options
            const currentValue = String(option.currentValue)
            const content = (
              <>
                {option.description && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">{option.description}</p>
                )}
                <DropdownMenuRadioGroup
                  value={currentValue}
                  onValueChange={(value) =>
                    void change(kind, option.id, option.type === 'boolean' ? value === 'true' : value)
                  }>
                  {choices.map((choice) =>
                    'group' in choice ? (
                      <Fragment key={choice.group}>
                        <DropdownMenuLabel className="text-xs text-muted-foreground">{choice.name}</DropdownMenuLabel>
                        {choice.options.map(renderChoice)}
                      </Fragment>
                    ) : (
                      renderChoice(choice)
                    )
                  )}
                </DropdownMenuRadioGroup>
              </>
            )
            if (single) return <Fragment key={`${kind}:${option.id}`}>{content}</Fragment>
            return (
              <Fragment key={`${kind}:${option.id}`}>
                {kind === 'config' && option === options[0] && selections.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    aria-label={option.name}
                    disabled={disabled || saving}
                    className="gap-2 rounded-md py-2 text-xs not-last:mb-1">
                    <span className="shrink-0">{option.name}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                      {selectedName(option)}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-72 p-1.5" collisionPadding={8}>
                      <Scrollbar className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))]">
                        {content}
                      </Scrollbar>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </Fragment>
            )
          })}
        </Scrollbar>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
