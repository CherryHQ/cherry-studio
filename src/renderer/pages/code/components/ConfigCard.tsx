import { Button } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@shared/data/types/provider'
import { GripVertical, Pencil } from 'lucide-react'
import type { FC } from 'react'
import type { MouseEvent } from 'react'
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
  const providerIcon = resolveProviderIcon(provider.id)

  const handleToggle = () => {
    onToggleCurrent(provider)
  }

  const handleConfigure = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onConfigure(provider)
  }

  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        dragging
          ? 'border-primary/40 opacity-50'
          : isCurrent
            ? 'border-border/40 bg-muted'
            : 'border-border/40 hover:border-border hover:bg-muted'
      }`}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={handleToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <GripVertical
            size={13}
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 cursor-grab text-muted-foreground/25 hover:text-muted-foreground/55 active:cursor-grabbing"
          />

          <span aria-hidden className="shrink-0">
            <ProviderAvatarPrimitive
              providerId={provider.id}
              providerName={providerName}
              logo={providerIcon}
              size={24}
              className="rounded-md border border-border/30 **:data-[slot=avatar-fallback]:rounded-[inherit] **:data-[slot=avatar-image]:rounded-[inherit]"
            />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-foreground text-sm">{providerName}</span>
              {modelName && (
                <>
                  <span aria-hidden className="shrink-0 text-muted-foreground/35 text-xs">
                    ｜
                  </span>
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/50">{modelName}</span>
                </>
              )}
              {isCurrent && (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                  {t('code.enabled')}
                </span>
              )}
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleConfigure}
            className="min-h-0 border-border/50 px-2.5 py-1 text-muted-foreground hover:text-foreground">
            <Pencil size={11} />
            {t('code.configure')}
          </Button>
        </div>
      </div>
    </div>
  )
}
