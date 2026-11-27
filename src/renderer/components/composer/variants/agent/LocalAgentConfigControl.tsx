import { ChevronDown, Settings2, ShieldAlert } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { requiresPermissionConfirmation } from '@cherrystudio/agent-runtime/cli'
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  ScrollArea
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { FullAccessConfirmDialog } from '@renderer/components/PermissionModeOption'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { localAgentConfigOptions } from '@renderer/utils/agent/localAgentLabels'
import type { LocalAgentConfigOption } from '@shared/ai/localAgent'

const triggerClass = 'h-7 min-w-0 max-w-64 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground'

type PendingHighRiskSelection = {
  configId: string
  value: string | boolean
}

export function LocalAgentConfigControl({
  sessionId,
  agentName,
  presetId,
  options: nativeOptions = [],
  disabled,
  side = 'top'
}: {
  sessionId: string
  agentName?: string
  presetId?: string
  options?: LocalAgentConfigOption[]
  disabled: boolean
  side?: 'top' | 'bottom'
}) {
  const { t } = useTranslation()
  const options = localAgentConfigOptions(nativeOptions, presetId, t)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingHighRisk, setPendingHighRisk] = useState<PendingHighRiskSelection | null>(null)
  const currentValuesKey = nativeOptions.map((option) => `${option.id}:${String(option.currentValue)}`).join('|')
  useEffect(() => {
    setPendingHighRisk(null)
  }, [currentValuesKey])

  if (!options.length) return null

  const requiresConfirmation = (option: LocalAgentConfigOption, value: string | boolean) => {
    if (option.type === 'boolean') return option.confirmationValue === value
    return requiresPermissionConfirmation(
      option.options
        .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
        .find((choice) => choice.value === value)
    )
  }
  const riskyMode = options.some((option) => requiresConfirmation(option, option.currentValue))
  const single = options.length === 1
  const selectedName = (option: LocalAgentConfigOption) =>
    option.type === 'boolean'
      ? t(option.currentValue ? 'common.enabled' : 'common.disabled')
      : (option.options
          .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
          .find((choice) => choice.value === option.currentValue)?.name ?? option.currentValue)
  const triggerLabel = single
    ? t('local_agents.config_summary', { name: options[0].name, value: selectedName(options[0]) })
    : t('local_agents.configuration')
  const change = async (configId: string, value: string | boolean) => {
    if (disabled || saving) return
    setSaving(true)
    try {
      await ipcApi.request('ai.local_agents.set_config_option', { sessionId, configId, value })
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSaving(false)
    }
  }
  const handleSelectValue = (option: LocalAgentConfigOption, nextValue: string | boolean) => {
    if (disabled || saving || nextValue === option.currentValue) return
    if (requiresConfirmation(option, nextValue)) {
      setMenuOpen(false)
      setPendingHighRisk({ configId: option.id, value: nextValue })
      return
    }
    void change(option.id, nextValue)
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
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(triggerClass, riskyMode && 'text-warning-subtle-foreground')}
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
          side={side}
          align={side === 'bottom' ? 'start' : 'end'}
          alignOffset={single || side === 'bottom' ? 0 : 288}
          className={cn('overflow-hidden p-1.5', single ? 'w-72' : 'w-64')}>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {single ? options[0].name : t('local_agents.configuration')}
          </DropdownMenuLabel>
          {disabled && (
            <p role="status" className="px-2 pb-1.5 text-xs text-muted-foreground">
              {t('local_agents.configuration_read_only')}
            </p>
          )}
          <ScrollArea className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))]">
            {options.map((option) => {
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
                      handleSelectValue(option, option.type === 'boolean' ? value === 'true' : value)
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
              if (single) return <Fragment key={option.id}>{content}</Fragment>
              return (
                <Fragment key={option.id}>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      aria-label={option.name}
                      disabled={saving}
                      className="gap-2 rounded-md py-2 text-xs not-last:mb-1">
                      <span className="shrink-0">{option.name}</span>
                      <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                        {selectedName(option)}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent className="w-72 p-1.5" collisionPadding={8}>
                        <ScrollArea className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))]">
                          {content}
                        </ScrollArea>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </Fragment>
              )
            })}
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>
      <FullAccessConfirmDialog
        open={!!pendingHighRisk}
        onOpenChange={(open) => {
          if (!open) setPendingHighRisk(null)
        }}
        onConfirm={() => {
          if (!pendingHighRisk) return false
          const selected = pendingHighRisk
          setPendingHighRisk(null)
          void change(selected.configId, selected.value)
          return true
        }}
        scopeName={agentName}
        t={t}
      />
    </>
  )
}
