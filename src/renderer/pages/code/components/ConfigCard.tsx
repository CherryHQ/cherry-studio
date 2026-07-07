import { Button } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@shared/data/types/provider'
import { GripVertical, Pencil, Play, Power } from 'lucide-react'
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

/** A single enabled-provider row for a CLI tool. Single-select: clicking the
 * card body (a full-bleed ghost button behind the content) toggles this
 * provider; Enable + Configure are revealed on hover. */
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

  return (
    <div
      className={`group relative rounded-xl border p-3.5 transition-colors ${
        dragging
          ? 'border-primary/40 opacity-50'
          : isCurrent
            ? 'border-border/40 bg-muted'
            : 'border-border/40 hover:border-border hover:bg-muted'
      }`}>
      {/* Full-card click target — clicks on the content pass through to it. */}
      <Button
        type="button"
        variant="ghost"
        tabIndex={-1}
        onClick={() => onToggleCurrent(provider)}
        aria-label={providerName}
        className="absolute inset-0 rounded-xl p-0 hover:bg-transparent"
      />

      <div className="pointer-events-none relative flex items-center gap-3">
        <GripVertical size={13} className="shrink-0 cursor-grab text-muted-foreground/25 active:cursor-grabbing" />

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
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onConfigure(provider)}
            className="min-h-0 border-border/50 px-2.5 py-1 text-muted-foreground hover:text-foreground">
            <Pencil size={11} />
            {t('code.configure')}
          </Button>
          <Button
            type="button"
            variant={isCurrent ? 'outline' : 'default'}
            size="sm"
            onClick={() => onToggleCurrent(provider)}
            className="min-h-0 px-2.5 py-1">
            {isCurrent ? <Power size={11} /> : <Play size={11} />}
            {isCurrent ? t('code.disable') : t('code.enable')}
          </Button>
        </div>
      </div>
    </div>
  )
}
