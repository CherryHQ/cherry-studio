import { Button, Kbd, Tooltip, type TooltipProps } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { isMac, platform } from '@renderer/config/constant'
import {
  type CommandId,
  evaluateContextExpr,
  findCommandDefinition,
  findKeybindingRule,
  getCommandShortcutLabel,
  type ResolvedCommandState,
  type SupportedPlatform
} from '@shared/command'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCommandRuntime } from './CommandProvider'
import { useCommandContextReader } from './ContextKeyProvider'

const useCommandContext = useCommandContextReader

function useCommandShortcutLabel(command: CommandId): string {
  const rule = findKeybindingRule(command)
  const [preference] = usePreference(rule?.preferenceKey ?? 'shortcut.topic.create')
  const context = useCommandContext()

  return useMemo(() => {
    if (!rule) {
      return ''
    }

    return getCommandShortcutLabel(command, preference, {
      context,
      isMac,
      platform: platform as SupportedPlatform
    })
  }, [command, context, preference, rule])
}

export function useResolvedCommand(command: CommandId): ResolvedCommandState & { execute: () => void } {
  const { t } = useTranslation()
  const runtime = useCommandRuntime()
  const definition = findCommandDefinition(command)
  const context = useCommandContext()
  const shortcutLabel = useCommandShortcutLabel(command)

  return useMemo(() => {
    const label = definition ? t(definition.titleKey) : command
    const enabled = Boolean(
      definition && runtime.hasHandler(command) && evaluateContextExpr(definition.enablement, context)
    )

    return {
      id: command,
      label,
      enabled,
      shortcutLabel,
      iconKey: definition?.iconKey,
      execute: () => runtime.execute(command)
    }
  }, [command, context, definition, runtime, shortcutLabel, t])
}

export function CommandShortcut({
  command,
  className,
  hiddenWhenUnavailable = true
}: {
  command: CommandId
  className?: string
  hiddenWhenUnavailable?: boolean
}): React.ReactNode {
  const shortcutLabel = useCommandShortcutLabel(command)

  if (!shortcutLabel && hiddenWhenUnavailable) {
    return null
  }

  return (
    <Kbd
      aria-hidden="true"
      className={cn('h-6 min-w-6 rounded-full bg-muted px-2 py-0 text-foreground-secondary', className)}>
      {shortcutLabel}
    </Kbd>
  )
}

export function CommandTooltip({
  command,
  children,
  label,
  ...tooltipProps
}: {
  command: CommandId
  children: React.ReactNode
  label?: React.ReactNode
} & Omit<TooltipProps, 'children' | 'content' | 'title'>): React.ReactNode {
  const resolved = useResolvedCommand(command)
  const tooltipLabel = label ?? resolved.label
  const content = resolved.shortcutLabel ? (
    <span className="inline-flex items-center gap-1.5">
      <span>{tooltipLabel}</span>
      <Kbd
        aria-hidden="true"
        className="h-auto min-w-0 rounded-none bg-transparent p-0 text-inherit shadow-none [font:inherit] [[data-slot=tooltip-content]_&]:bg-transparent [[data-slot=tooltip-content]_&]:text-inherit">
        {resolved.shortcutLabel}
      </Kbd>
    </span>
  ) : (
    tooltipLabel
  )

  return (
    <Tooltip content={content} {...tooltipProps}>
      {children}
    </Tooltip>
  )
}

export function CommandButton({
  command,
  className,
  children
}: {
  command: CommandId
  className?: string
  children?: React.ReactNode
}): React.ReactNode {
  const resolved = useResolvedCommand(command)

  return (
    <CommandTooltip command={command}>
      <Button className={className} disabled={!resolved.enabled} onClick={resolved.execute}>
        {children ?? resolved.label}
      </Button>
    </CommandTooltip>
  )
}
