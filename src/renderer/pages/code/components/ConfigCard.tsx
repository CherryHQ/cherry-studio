import { Badge, Button, Tooltip } from '@cherrystudio/ui'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import { Pencil, Power, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConfigCardProps {
  config: CliNamedConfig
  providerName?: string
  modelName?: string
  isCurrent: boolean
  onEdit: (config: CliNamedConfig) => void
  onDelete: (config: CliNamedConfig) => void
  onToggleCurrent: (config: CliNamedConfig) => void
}

/** A single named-config row, modeled on the ChannelsPage instance row. */
export const ConfigCard: FC<ConfigCardProps> = ({
  config,
  providerName,
  modelName,
  isCurrent,
  onEdit,
  onDelete,
  onToggleCurrent
}) => {
  const { t } = useTranslation()

  return (
    <div className="group flex items-center justify-between rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-accent/40">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`size-1.5 shrink-0 rounded-full ${isCurrent ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-foreground text-sm">{config.name}</span>
            {isCurrent && (
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px] leading-4">
                {t('code.current_config')}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
            {providerName && <span className="truncate">{providerName}</span>}
            {modelName && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="truncate font-mono">{modelName}</span>
              </>
            )}
            {config.directory && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="truncate">{config.directory}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip content={isCurrent ? t('code.disable') : t('code.enable')} side="bottom">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onToggleCurrent(config)}
            className={`size-6 ${isCurrent ? 'text-primary' : 'text-muted-foreground/40 hover:text-foreground'}`}>
            <Power size={12} />
          </Button>
        </Tooltip>
        <Tooltip content={t('common.edit')} side="bottom">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onEdit(config)}
            className="size-6 text-muted-foreground/40 hover:text-foreground">
            <Pencil size={10} />
          </Button>
        </Tooltip>
        <Tooltip content={t('common.delete')} side="bottom">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onDelete(config)}
            className="size-6 text-muted-foreground/40 hover:text-destructive">
            <Trash2 size={10} />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
