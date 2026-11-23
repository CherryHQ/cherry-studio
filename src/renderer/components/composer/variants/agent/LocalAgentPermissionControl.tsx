import { ChevronDown, ExternalLink, FolderPen, Hand, Route, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ScrollArea
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { FullAccessConfirmDialog } from '@renderer/components/PermissionModeOption'
import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import {
  isHighRiskLocalOption,
  localAgentConfigOptions,
  localAgentModeOptions,
  resolveUnifiedLocalPermissionModes
} from '@renderer/utils/agent/localAgentLabels'
import type { LocalAgentConfigOption, LocalAgentSelection } from '@shared/ai/localAgent'

const triggerClass = 'h-7 min-w-0 max-w-64 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground'

type PendingHighRiskSelection = {
  kind: 'mode' | 'config'
  configId: string
  value: string | boolean
}

export function LocalAgentPermissionControl({
  sessionId,
  agentId,
  agentName,
  presetId,
  mode,
  securityOptions = [],
  disabled,
  side = 'top'
}: {
  sessionId: string
  agentId?: string
  agentName?: string
  presetId?: string
  mode?: LocalAgentSelection
  securityOptions?: LocalAgentConfigOption[]
  disabled: boolean
  side?: 'top' | 'bottom'
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingHighRisk, setPendingHighRisk] = useState<PendingHighRiskSelection | null>(null)
  const currentValuesKey = [
    mode?.currentValue ?? '',
    ...securityOptions.map((option) => `${option.id}:${String(option.currentValue)}`)
  ].join('|')
  useEffect(() => {
    setPendingHighRisk(null)
  }, [currentValuesKey])

  const findRawChoiceName = (
    kind: 'mode' | 'config',
    configId: string,
    value: string | boolean
  ): string | undefined => {
    if (typeof value === 'boolean') return undefined
    if (kind === 'mode' && mode?.id === configId) {
      return mode.options.find((option) => option.value === value)?.name
    }
    const rawOption = securityOptions.find((option) => option.id === configId)
    if (!rawOption || rawOption.type !== 'select') return undefined
    return rawOption.options
      .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
      .find((choice) => choice.value === value)?.name
  }

  const unifiedMode = resolveUnifiedLocalPermissionModes(mode, t, presetId)
  const localizedSecurityOptions = localAgentConfigOptions(securityOptions, presetId, t)

  const rows: Array<{ kind: 'mode' | 'config'; option: LocalAgentConfigOption }> = []
  if (unifiedMode) {
    rows.push({
      kind: 'mode',
      option: {
        id: unifiedMode.id,
        currentValue: unifiedMode.currentValue,
        type: 'select',
        name: t('local_agents.mode'),
        options: unifiedMode.options
      }
    })
  }
  for (const option of localizedSecurityOptions) {
    if (option.id === mode?.id) continue
    if (
      option.type === 'select' &&
      option.options.flatMap((choice) => ('group' in choice ? choice.options : [choice])).length <= 1
    ) {
      continue
    }
    rows.push({ kind: 'config', option })
  }

  if (!rows.length) return null

  const hasHighRiskSecurity = localizedSecurityOptions.some(
    (option) =>
      option.id !== mode?.id &&
      isHighRiskLocalOption({
        kind: 'config',
        optionId: option.id,
        value: option.currentValue,
        name: findRawChoiceName('config', option.id, option.currentValue)
      })
  )
  const canonicalMode = unifiedMode?.currentCanonicalMode
  const isFullAccess = hasHighRiskSecurity || canonicalMode === 'bypassPermissions'

  const selectedName = (option: LocalAgentConfigOption) =>
    option.type === 'boolean'
      ? t(option.currentValue ? 'common.enabled' : 'common.disabled')
      : (option.options
          .flatMap((choice) => ('group' in choice ? choice.options : [choice]))
          .find((choice) => choice.value === option.currentValue)?.name ?? option.currentValue)

  const fallbackModeLabel =
    mode &&
    (localAgentModeOptions(mode, t, presetId).find((option) => option.value === mode.currentValue)?.name ??
      mode.currentValue)
  const currentModeLabel =
    unifiedMode?.options.find((option) => option.value === unifiedMode.currentValue)?.name ?? fallbackModeLabel
  const highRiskSecuritySummary = rows
    .filter(
      (row) =>
        row.kind === 'config' &&
        isHighRiskLocalOption({
          kind: 'config',
          optionId: row.option.id,
          value: row.option.currentValue,
          name: findRawChoiceName('config', row.option.id, row.option.currentValue)
        })
    )
    .map((row) => selectedName(row.option))

  const hasModeRow = rows.some((row) => row.kind === 'mode')
  const triggerLabel = hasModeRow
    ? [currentModeLabel, ...highRiskSecuritySummary].filter(Boolean).join(' · ')
    : rows.length === 1
      ? t('local_agents.config_summary', { name: rows[0].option.name, value: selectedName(rows[0].option) })
      : highRiskSecuritySummary.join(' · ') || rows.map((row) => selectedName(row.option)).join(' · ')

  const change = async (kind: 'mode' | 'config', configId: string, value: string | boolean) => {
    if (disabled || saving) return
    setSaving(true)
    try {
      if (kind === 'config') await ipcApi.request('ai.local_agents.set_config_option', { sessionId, configId, value })
      else if (typeof value === 'string')
        await ipcApi.request('ai.local_agents.set_mode', { sessionId, configId, value })
    } catch (error) {
      toast.error(String(error))
    } finally {
      setSaving(false)
    }
  }

  const handleSelectValue = (kind: 'mode' | 'config', option: LocalAgentConfigOption, nextValue: string | boolean) => {
    if (disabled || saving || nextValue === option.currentValue) return
    if (kind === 'mode') {
      const selectedOption = unifiedMode?.options.find((choice) => choice.value === nextValue)
      if (selectedOption?.dangerous) {
        setMenuOpen(false)
        setPendingHighRisk({ kind, configId: option.id, value: nextValue })
        return
      }
      void change(kind, option.id, nextValue)
      return
    }
    const rawName = findRawChoiceName(kind, option.id, nextValue)
    if (isHighRiskLocalOption({ kind, optionId: option.id, value: nextValue, name: rawName })) {
      setMenuOpen(false)
      setPendingHighRisk({ kind, configId: option.id, value: nextValue })
      return
    }
    void change(kind, option.id, nextValue)
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

  const icon = isFullAccess ? (
    <ShieldAlert className="lucide-custom size-3.5 shrink-0" />
  ) : canonicalMode === 'plan' ? (
    <Route className="lucide-custom size-3.5 shrink-0" />
  ) : canonicalMode === 'acceptEdits' ? (
    <FolderPen className="lucide-custom size-3.5 shrink-0" />
  ) : canonicalMode === 'auto' ? (
    <ShieldCheck className="lucide-custom size-3.5 shrink-0" />
  ) : (
    <Hand className="lucide-custom size-3.5 shrink-0" />
  )

  const settingsTargetId = presetId ?? agentId

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(triggerClass, isFullAccess && 'text-warning-subtle-foreground')}
            aria-label={t('code.adv.permission_mode')}>
            {icon}
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className="lucide-custom size-3 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={side}
          align={side === 'bottom' ? 'start' : 'end'}
          alignOffset={side === 'bottom' ? 0 : 288}
          className="w-72 overflow-hidden p-1.5">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('code.adv.permission_mode')}
          </DropdownMenuLabel>
          {disabled && (
            <p role="status" className="px-2 pb-1.5 text-xs text-muted-foreground">
              {t('local_agents.configuration_read_only')}
            </p>
          )}
          <ScrollArea className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))]">
            {rows.map(({ kind, option }, index) => {
              const choices =
                option.type === 'boolean'
                  ? [
                      { value: 'true', name: t('common.enabled') },
                      { value: 'false', name: t('common.disabled') }
                    ]
                  : option.options
              const currentValue = String(option.currentValue)
              return (
                <Fragment key={`${kind}:${option.id}`}>
                  {index > 0 && <DropdownMenuSeparator />}
                  {(rows.length > 1 || kind === 'config') && (
                    <DropdownMenuLabel className="text-xs text-muted-foreground">{option.name}</DropdownMenuLabel>
                  )}
                  {option.description && (
                    <p className="px-2 pb-1.5 text-xs text-muted-foreground">{option.description}</p>
                  )}
                  <DropdownMenuRadioGroup
                    value={currentValue}
                    onValueChange={(value) =>
                      handleSelectValue(kind, option, option.type === 'boolean' ? value === 'true' : value)
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
                </Fragment>
              )
            })}
          </ScrollArea>
          <DropdownMenuSeparator />
          <p className="px-2 py-1 text-xs text-muted-foreground">{t('local_agents.permission_session_scope')}</p>
          {settingsTargetId && (
            <DropdownMenuItem
              className="gap-1.5 rounded-md py-1.5 text-xs"
              onSelect={() => openRoute('/settings/local-agents', { id: settingsTargetId })}>
              <ExternalLink className="lucide-custom size-3.5 shrink-0 text-muted-foreground" />
              <span>{t('local_agents.edit_default_settings')}</span>
            </DropdownMenuItem>
          )}
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
          void change(selected.kind, selected.configId, selected.value)
          return true
        }}
        scopeName={agentName}
        t={t}
      />
    </>
  )
}
