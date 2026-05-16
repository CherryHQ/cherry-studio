import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentPropsWithoutRef } from 'react'

import { SkeletonSpan } from '../agent/GenericTools'

/**
 * Format argument value for display in table
 */
export const formatArgValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * Shared argument table component for displaying tool parameters
 * Used by both MCP tools and Agent tools
 */
export function ToolArgsTable({
  args,
  title,
  isStreaming = false
}: {
  args: Record<string, unknown> | unknown[] | null | undefined
  title?: string
  isStreaming?: boolean
}) {
  if (!args) return null

  // Handle both object and array args
  const entries: Array<[string, unknown]> = Array.isArray(args) ? [['arguments', args]] : Object.entries(args)

  if (entries.length === 0 && !isStreaming) return null

  return (
    <ArgsSection>
      {title && <ArgsSectionTitle>{title}</ArgsSectionTitle>}
      <ArgsTable>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <ArgKey>{key}</ArgKey>
              <ArgValue>{formatArgValue(value)}</ArgValue>
            </tr>
          ))}
          {isStreaming && (
            <tr>
              <ArgKey>
                <SkeletonSpan width="60px" />
              </ArgKey>
              <ArgValue>
                <SkeletonSpan width="120px" />
              </ArgValue>
            </tr>
          )}
        </tbody>
      </ArgsTable>
    </ArgsSection>
  )
}

export const ArgsSection = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('py-2 font-(--font-family-mono,monospace) text-xs leading-normal', className)} {...props} />
)

export const ArgsSectionTitle = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-2 font-semibold text-[11px] text-foreground-muted uppercase', className)} {...props} />
)

export const ArgsTable = ({ className, ...props }: ComponentPropsWithoutRef<'table'>) => (
  <table className={cn('w-full border-collapse', className)} {...props} />
)

export const ArgKey = ({ className, ...props }: ComponentPropsWithoutRef<'td'>) => (
  <td
    className={cn('w-[1%] whitespace-nowrap py-1 pr-2 pl-0 align-top font-medium text-primary', className)}
    {...props}
  />
)

export const ArgValue = ({ className, ...props }: ComponentPropsWithoutRef<'td'>) => (
  <td className={cn('whitespace-pre-wrap break-all py-1 text-foreground', className)} {...props} />
)

export const ResponseSection = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('border-border border-t py-2', className)} {...props} />
)
