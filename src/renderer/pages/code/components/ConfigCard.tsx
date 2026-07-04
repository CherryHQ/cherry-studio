import type { Provider } from '@shared/data/types/provider'
import { GripVertical, Pencil } from 'lucide-react'
import type { FC } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

export interface ProviderCardProps {
  provider: Provider
  providerName: string
  modelName?: string
  isCurrent: boolean
  dragging?: boolean
  onConfigure: (provider: Provider) => void
  onToggleCurrent: (provider: Provider) => void
}

/** A single enabled-provider row for a CLI tool.
 * Single-select: clicking the row toggles this provider. */
export const ProviderCard: FC<ProviderCardProps> = ({
  provider,
  providerName,
  modelName,
  isCurrent,
  dragging,
  onConfigure,
  onToggleCurrent
}) => {
  const { t } = useTranslation()

  const handleToggle = () => {
    onToggleCurrent(provider)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    handleToggle()
  }

  const handleConfigure = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onConfigure(provider)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      className={`rounded-xl border p-3.5 transition-colors ${
        dragging
          ? 'border-primary/40 opacity-50'
          : isCurrent
            ? 'border-success/50 bg-success/[0.04]'
            : 'border-border/40 hover:border-border hover:bg-accent/20'
      }`}>
      <div className="flex items-center gap-3">
        <GripVertical
          size={13}
          onClick={(event) => event.stopPropagation()}
          className="shrink-0 cursor-grab text-muted-foreground/25 hover:text-muted-foreground/55 active:cursor-grabbing"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-foreground text-sm">{providerName}</span>
            {isCurrent && (
              <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                {t('code.enabled')}
              </span>
            )}
          </div>
          {modelName && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/50">{modelName}</div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleConfigure}
            className="flex items-center gap-1 rounded-md border border-border/50 px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground">
            <Pencil size={11} />
            {t('code.configure')}
          </button>
        </div>
      </div>
    </div>
  )
}
