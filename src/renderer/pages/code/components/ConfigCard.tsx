import type { Provider } from '@shared/data/types/provider'
import { GripVertical, Pencil, Power } from 'lucide-react'
import type { FC } from 'react'
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

/** A single enabled-provider row for a CLI tool. Single-select: the Power
 * toggle enables this provider (disabling any other active one). */
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

  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        dragging
          ? 'border-primary/40 opacity-50'
          : isCurrent
            ? 'border-success/50 bg-success/[0.04]'
            : 'border-border/40 hover:border-border'
      }`}>
      <div className="flex items-center gap-3">
        <GripVertical
          size={13}
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
            onClick={() => onConfigure(provider)}
            className="flex items-center gap-1 rounded-md border border-border/50 px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground">
            <Pencil size={11} />
            {t('code.configure')}
          </button>
          <button
            type="button"
            onClick={() => onToggleCurrent(provider)}
            className={`flex items-center gap-1 rounded-md border border-border/50 px-2.5 py-1 text-xs transition-colors ${
              isCurrent ? 'text-muted-foreground' : 'text-foreground'
            } hover:text-foreground`}>
            <Power size={11} />
            {isCurrent ? t('code.disable') : t('code.enable')}
          </button>
        </div>
      </div>
    </div>
  )
}
