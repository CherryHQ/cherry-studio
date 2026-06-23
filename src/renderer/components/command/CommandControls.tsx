import { Button, Kbd, Tooltip, type TooltipProps } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useResolvedCommand } from '@renderer/hooks/command'
import type { CommandId } from '@shared/utils/command'
import type React from 'react'

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
      className={cn('h-6 min-w-6 rounded-full bg-muted px-2 py-0 text-foreground-secondary', className)}>
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
        'shrink-0 rounded-md bg-transparent px-1 py-0 text-[11px] text-foreground-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
        className
      )}>
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
