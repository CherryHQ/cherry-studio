import { Avatar, AvatarFallback, HoverCard, HoverCardContent, HoverCardTrigger, Skeleton } from '@cherrystudio/ui'
import { resolveProviderIconRef, useIcon } from '@cherrystudio/ui/icons'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { getModelLogoRef } from '@renderer/utils/model'
import { cn } from '@renderer/utils/style'
import type { AiUsageRecordSourceType } from '@shared/data/types/aiUsageRecord'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { useMemo } from 'react'

import { displayModelId } from './usageAnalytics'

export function UsageProviderAvatar({
  provider,
  size,
  className
}: {
  provider: { id: string; name: string }
  size?: number
  className?: string
}) {
  // Resolve the built-in brand icon synchronously from the ref; the component
  // itself loads async and the primitive covers the loading window with initials.
  const iconRef = resolveProviderIconRef(provider.id)
  const icon = useIcon(iconRef)

  return (
    <ProviderAvatarPrimitive
      providerId={provider.id}
      providerName={provider.name}
      logo={icon}
      size={size}
      className={className}
    />
  )
}

export function UsageProviderLabel({
  provider,
  children,
  size = 18,
  className
}: {
  provider: { id: string; name: string }
  children?: ReactNode
  size?: number
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <UsageProviderAvatar provider={provider} size={size} className="shrink-0" />
      <span className="min-w-0 break-words">{children ?? provider.name}</span>
    </span>
  )
}

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
  const fallback = sourceType === 'agent' ? 'G' : sourceType === 'assistant' ? 'A' : '?'

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {sourceIcon ? (
        <EmojiIcon emoji={sourceIcon} size={size} fontSize={Math.max(10, Math.round(size * 0.58))} />
      ) : (
        <Avatar className="shrink-0" style={{ width: size, height: size }}>
          <AvatarFallback className="bg-muted font-medium text-[10px] text-muted-foreground">{fallback}</AvatarFallback>
        </Avatar>
      )}
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

export function UsageDistributionHoverCard({
  children,
  label,
  metric,
  share,
  tokens,
  requests,
  cost,
  costCurrency,
  labels
}: {
  children: ReactNode
  label: ReactNode
  metric: string
  share: string
  tokens: string
  requests: number
  cost: string
  costCurrency?: string | null
  labels: {
    share: string
    tokens: string
    requests: string
    cost: string
  }
}) {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-64 p-0">
        <div className="p-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 text-foreground text-sm">{label}</div>
            <div className="shrink-0 rounded-md bg-muted px-2 py-1 font-medium text-foreground text-xs">{metric}</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-border border-t pt-3">
            <div>
              <div className="text-muted-foreground text-xs">{labels.share}</div>
              <div className="mt-0.5 font-medium text-foreground text-sm">{share}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{labels.tokens}</div>
              <div className="mt-0.5 font-medium text-foreground text-sm">{tokens}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{labels.requests}</div>
              <div className="mt-0.5 font-medium text-foreground text-sm">{requests}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">
                {labels.cost}
                {costCurrency ? ` · ${costCurrency}` : ''}
              </div>
              <div className="mt-0.5 font-medium text-foreground text-sm">{cost}</div>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
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
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-2 flex min-h-8 min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1 text-pretty break-words font-semibold text-foreground text-xl leading-6">
          {value}
        </div>
        {hasTrend && <MetricSparkline values={trendValues} />}
      </div>
      <div className="mt-auto flex min-w-0 flex-col gap-1 pt-2">
        <MetricDelta change={delta} label={deltaLabel} formatDelta={formatDelta} />
        {helper && <div className="min-w-0 text-pretty text-muted-foreground text-xs">{helper}</div>}
      </div>
    </div>
  )
}

export function MetricStripSkeleton() {
  return (
    <div className="grid min-w-0 @[560px]/usage:grid-cols-2 @[900px]/usage:grid-cols-4 grid-cols-1 gap-px border-border border-b bg-border">
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
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-8 w-full text-control-accent">
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
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

export function InsightCell({ label, value, helper }: { label: string; value: ReactNode; helper?: ReactNode }) {
  return (
    <div className="min-w-0 bg-background p-3 @[640px]/usage:px-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 min-w-0 break-words font-medium text-foreground text-sm">{value}</div>
      {helper && <div className="mt-1 min-w-0 break-words text-muted-foreground text-xs">{helper}</div>}
    </div>
  )
}

export function UsageResponsiveShell({ children }: { children: ReactNode }) {
  const { theme } = useTheme()

  return (
    <SettingsContentColumn
      theme={theme}
      className="min-w-0 overflow-x-hidden"
      innerClassName="min-w-0 w-full max-w-none">
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

export function UsageControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
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
