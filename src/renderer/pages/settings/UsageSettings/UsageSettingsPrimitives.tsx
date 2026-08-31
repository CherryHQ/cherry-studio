import { Avatar, AvatarFallback, EmojiIcon, Skeleton } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { getModelLogoRef } from '@renderer/utils/model'
import { cn } from '@renderer/utils/style'
import type { AiUsageRecordSourceType } from '@shared/data/types/aiUsageRecord'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { useMemo } from 'react'

import { displayModelId } from './usageAnalytics'

const SOURCE_TYPE_FALLBACK = {
  assistant: 'A',
  agent: 'G',
  'mini-app': 'M'
} satisfies Record<AiUsageRecordSourceType, string>

export function UsageModelAvatar({
  modelId,
  providerId,
  size = 18
}: {
  modelId: string | null | undefined
  providerId: string
  size?: number
}) {
  const modelName = displayModelId(modelId)
  const Icon = useIcon(
    useMemo(
      () =>
        modelId ? getModelLogoRef({ id: modelId, name: modelName || modelId, providerId }, providerId) : undefined,
      [modelId, modelName, providerId]
    )
  )

  if (Icon) {
    return <Icon.Avatar size={size} className="shrink-0" />
  }

  return (
    <Avatar className="shrink-0" style={{ width: size, height: size }}>
      <AvatarFallback className="bg-muted font-medium text-[10px] text-muted-foreground">
        {(modelName || providerId || '?').slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

export function UsageModelLabel({
  modelId,
  providerId,
  children,
  size = 18,
  className
}: {
  modelId: string | null | undefined
  providerId: string
  children: ReactNode
  size?: number
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <UsageModelAvatar modelId={modelId} providerId={providerId} size={size} />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

export function UsageSourceLabel({
  sourceType,
  sourceIcon,
  children,
  size = 18,
  className
}: {
  sourceType: AiUsageRecordSourceType | null | undefined
  sourceIcon?: string | null
  children: ReactNode
  size?: number
  className?: string
}) {
  const fallback = sourceType ? SOURCE_TYPE_FALLBACK[sourceType] : '?'

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {sourceIcon ? (
        <EmojiIcon emoji={sourceIcon} size={size} />
      ) : (
        <Avatar className="shrink-0" style={{ width: size, height: size }}>
          <AvatarFallback className="bg-muted font-medium text-[10px] text-muted-foreground">{fallback}</AvatarFallback>
        </Avatar>
      )}
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

export function MetricCell({
  label,
  value,
  helper,
  trendValues,
  delta,
  deltaLabel,
  formatDelta
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
  trendValues: number[]
  delta?: number
  deltaLabel: string
  formatDelta: (value: number) => string
}) {
  const hasTrend = trendValues.some((trendValue) => trendValue > 0)

  return (
    <div className="flex min-h-24 min-w-0 flex-col bg-background p-3 @[640px]/usage:px-4">
      <div className="text-muted-foreground text-xs leading-5">{label}</div>
      <div className="mt-2 flex min-h-8 min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1 text-pretty break-words font-semibold text-foreground text-xl leading-6">
          {value}
        </div>
        {hasTrend && <MetricSparkline values={trendValues} />}
      </div>
      <div className="mt-auto flex min-w-0 flex-col gap-1 pt-2">
        <MetricDelta change={delta} label={deltaLabel} formatDelta={formatDelta} />
        {helper && <div className="min-w-0 text-pretty text-foreground-tertiary text-xs leading-5">{helper}</div>}
      </div>
    </div>
  )
}

export function MetricStripSkeleton() {
  return (
    <div className="grid min-w-0 @[560px]/usage:grid-cols-2 @[900px]/usage:grid-cols-4 grid-cols-1 gap-px bg-border">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="bg-background p-3 @[640px]/usage:px-4">
          <Skeleton className="h-20 rounded-md" />
        </div>
      ))}
    </div>
  )
}

export function MetricSparkline({ values }: { values: number[] }) {
  const recentValues = values.slice(-64)
  const maxValue = Math.max(...recentValues, 0)
  const minValue = Math.min(...recentValues, maxValue)
  const width = 48
  const height = 32
  const xStep = recentValues.length > 1 ? width / (recentValues.length - 1) : width

  const points = recentValues
    .map((value, index) => {
      const ratio = maxValue === minValue ? 0.5 : (value - minValue) / (maxValue - minValue)
      const x = index * xStep
      const y = height - ratio * (height - 4) - 2

      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="flex h-8 w-12 shrink-0 items-center" aria-hidden>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-8 w-full text-primary">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </div>
  )
}

export function MetricDelta({
  change,
  label,
  formatDelta
}: {
  change?: number
  label: string
  formatDelta: (value: number) => string
}) {
  if (change === undefined) {
    return null
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-x-1 text-xs">
      <span
        className={cn(
          'font-medium',
          change > 0 ? 'text-success' : change < 0 ? 'text-error' : 'text-muted-foreground'
        )}>
        {formatDelta(change)}
      </span>
      <span className="text-foreground-tertiary">{label}</span>
    </div>
  )
}

export function InsightCell({ label, value, helper }: { label: string; value: ReactNode; helper?: ReactNode }) {
  return (
    <div className="flex min-h-24 min-w-0 flex-col bg-background p-3 @[640px]/usage:px-4">
      <div className="text-muted-foreground text-xs leading-5">{label}</div>
      <div className="mt-1 min-w-0 break-words font-semibold text-base text-foreground leading-6">{value}</div>
      {helper && (
        <div className="mt-auto min-w-0 break-words pt-1 text-foreground-tertiary text-xs leading-5">{helper}</div>
      )}
    </div>
  )
}

export function UsageResponsiveShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme()

  return (
    <SettingsContentColumn
      theme={theme}
      className="min-w-0 overflow-x-hidden"
      // Wider than form settings so 4-col metrics and the year heatmap fit, but still capped on ultrawide windows.
      innerClassName="min-w-0 w-full max-w-6xl">
      <div className="@container/usage flex min-w-0 flex-col gap-6">{children}</div>
    </SettingsContentColumn>
  )
}

export function UsageSection({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('flex min-w-0 flex-col gap-3', className)}>{children}</section>
}

export function UsagePanel({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background', className)}
      {...props}
    />
  )
}

export function UsagePanelHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('border-border border-b p-3', className)} {...props} />
}

export function UsageSectionTitle({ className, ...props }: ComponentPropsWithoutRef<'h2'>) {
  return <h2 className={cn('font-semibold text-base text-foreground', className)} {...props} />
}

export function UsagePanelTitle({ className, ...props }: ComponentPropsWithoutRef<'h3'>) {
  return <h3 className={cn('font-medium text-foreground text-sm', className)} {...props} />
}

export function UsageControlRow({
  label,
  children,
  className
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1 text-muted-foreground text-xs">{label}</div>
      <div className="-mx-1 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1">{children}</div>
    </div>
  )
}

export function UsageSectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 @[640px]/usage:flex-row flex-col @[640px]/usage:items-start @[640px]/usage:justify-between gap-3">
      {children}
    </div>
  )
}
