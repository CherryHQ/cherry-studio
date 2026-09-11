import type React from 'react'

import { Button, Kbd, Tooltip, type TooltipProps } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useResolvedCommand } from '@renderer/hooks/command'
import type { CommandId } from '@shared/utils/command'

export function CommandShortcut({
  command,
  className,
  hiddenWhenUnavailable = true
}: {
  command: CommandId
  className?: string
  hiddenWhenUnavailable?: boolean
}): React.ReactNode {
  const { shortcutLabel } = useResolvedCommand(command)

  if (!shortcutLabel && hiddenWhenUnavailable) {
    return null
  }

  return (
    <Kbd
      aria-hidden="true"
      className={cn('h-6 min-w-6 rounded-full bg-muted px-2 py-0 text-muted-foreground', className)}>
      {shortcutLabel}
    </Kbd>
  )
}

export function CommandHint({ command, className }: { command: CommandId; className?: string }): React.ReactNode {
  const { shortcutLabel } = useResolvedCommand(command)

  if (!shortcutLabel) {
    return null
  }

  return (
    <Kbd
      aria-hidden="true"
      className={cn(
        'shrink-0 rounded-md bg-transparent px-1 py-0 text-[11px] text-foreground-tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
        className
      )}>
      {shortcutLabel}
    </Kbd>
  )
}

/**
 * Label paired with its keycap, for tooltip content.
 *
 * The keycap is `aria-hidden` — the tooltip's own trigger carries `aria-describedby`, so the key
 * names must not be read out separately — and rides on the tooltip's text styles instead of the
 * muted chip styling `CommandShortcut` uses on the composer surface.
 */
export function TooltipLabelWithShortcut({
  label,
  shortcutLabel
}: {
  label: React.ReactNode
  shortcutLabel: string
}): React.ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <Kbd
        aria-hidden="true"
        className="h-auto min-w-0 rounded-none bg-transparent p-0 text-inherit shadow-none [font:inherit] [[data-slot=tooltip-content]_&]:bg-transparent [[data-slot=tooltip-content]_&]:text-inherit">
        {shortcutLabel}
      </Kbd>
    </span>
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
    <TooltipLabelWithShortcut label={tooltipLabel} shortcutLabel={resolved.shortcutLabel} />
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
