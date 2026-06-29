import { Badge, Button, Tooltip } from '@cherrystudio/ui'
import type { Provider } from '@shared/data/types/provider'
import { Pencil, Power } from 'lucide-react'
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
      className={`group flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${
        dragging
          ? 'border-primary/40 bg-accent/60 shadow-sm'
          : 'border-transparent hover:border-border hover:bg-accent/40'
      }`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`size-1.5 shrink-0 rounded-full ${isCurrent ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-foreground text-sm">{providerName}</span>
            {isCurrent && (
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px] leading-4">
                {t('code.current_config')}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
            {modelName && <span className="truncate font-mono">{modelName}</span>}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip content={isCurrent ? t('code.disable') : t('code.enable')} placement="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onToggleCurrent(provider)}
            className={`size-6 ${isCurrent ? 'text-primary' : 'text-muted-foreground/40 hover:text-foreground'}`}>
            <Power size={12} />
          </Button>
        </Tooltip>
        <Tooltip content={t('code.configure')} placement="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onConfigure(provider)}
            className="size-6 text-muted-foreground/40 hover:text-foreground">
            <Pencil size={10} />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
