import { Button } from '@cherrystudio/ui/components/primitives/button'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  BookOpenCheck,
  Code2,
  FileQuestion,
  FolderOpen,
  Languages,
  Library,
  NotebookPen,
  Package,
  Puzzle,
  Search,
  ServerOff,
  Sparkles
} from 'lucide-react'
import type { ComponentType } from 'react'

export type EmptyStatePreset =
  | 'no-model'
  | 'no-assistant'
  | 'no-agent'
  | 'no-knowledge'
  | 'no-file'
  | 'no-note'
  | 'no-miniapp'
  | 'no-code-tool'
  | 'no-resource'
  | 'no-translate'
  | 'no-result'
  | 'no-topic'
  | 'no-session'

interface PresetConfig {
  icon: ComponentType<{ size?: number; className?: string }>
}

const PRESET_MAP: Record<EmptyStatePreset, PresetConfig> = {
  'no-model': { icon: ServerOff },
  'no-assistant': { icon: Sparkles },
  'no-agent': { icon: Package },
  'no-knowledge': { icon: BookOpenCheck },
  'no-file': { icon: FolderOpen },
  'no-note': { icon: NotebookPen },
  'no-miniapp': { icon: Puzzle },
  'no-code-tool': { icon: Code2 },
  'no-resource': { icon: Library },
  'no-translate': { icon: Languages },
  'no-result': { icon: Search },
  'no-topic': { icon: FileQuestion },
  'no-session': { icon: FileQuestion }
}

export interface EmptyStateProps {
  preset?: EmptyStatePreset
  icon?: ComponentType<{ size?: number; className?: string }>
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  compact?: boolean
  className?: string
}

export function EmptyState({
  preset,
  icon: IconOverride,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact = false,
  className
}: EmptyStateProps) {
  const config = preset ? PRESET_MAP[preset] : null
  const Icon = IconOverride || config?.icon || FileQuestion
  const buttonSize = compact ? 'sm' : 'default'

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'flex-1 px-6 py-12',
        className
      )}>
      <div
        className={cn(
          'flex items-center justify-center rounded-lg bg-muted text-muted-foreground',
          compact ? 'mb-3 size-10' : 'mb-4 size-14 border border-border'
        )}>
        <Icon size={compact ? 18 : 24} />
      </div>
      {title && (
        <h3 className={cn('text-foreground', compact ? 'mb-1 text-sm' : 'mb-1.5 text-base font-medium')}>{title}</h3>
      )}
      {description && (
        <p
          className={cn(
            'text-muted-foreground',
            compact ? 'mb-3 max-w-xs text-xs' : 'mb-5 max-w-md text-sm leading-relaxed'
          )}>
          {description}
        </p>
      )}
      {(actionLabel || secondaryLabel) && (
        <div className="flex items-center gap-2">
          {actionLabel && onAction && (
            <Button variant="secondary" size={buttonSize} onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button variant="ghost" size={buttonSize} onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
