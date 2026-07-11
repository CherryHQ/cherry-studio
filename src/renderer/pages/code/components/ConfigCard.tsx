import { Button } from '@cherrystudio/ui'
import { resolveProviderIconRef, useIcon } from '@cherrystudio/ui/icons'
import { GatewayIcon } from '@renderer/components/icons/GatewayIcon'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@shared/data/types/provider'
import { isApiGatewayProviderId } from '@shared/types/codeCli'
import { CircleMinus, GripVertical, Play, SquarePen } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface ProviderCardProps {
  provider: Provider
  providerName: string
  modelName?: string
  /** Optional one-line blurb shown under the name — used to promote the unified gateway. */
  description?: string
  isCurrent: boolean
  dragging?: boolean
  onConfigure: (provider: Provider) => void
  onToggleCurrent: (provider: Provider) => void
}

/** A single enabled-provider row for a CLI tool. Single-select: Enable + Configure
 * are revealed on hover. */
export const ProviderCard: FC<ProviderCardProps> = ({
  provider,
  providerName,
  modelName,
  description,
  isCurrent,
  dragging,
  onConfigure,
  onToggleCurrent
}) => {
  const { t } = useTranslation()
  const isGateway = isApiGatewayProviderId(provider.id)
  const providerIcon = useIcon(resolveProviderIconRef(provider.id))

  return (
    <div
      className={`group relative rounded-xl border p-3.5 transition-colors ${
        dragging
          ? 'border-primary/40 opacity-50'
          : isCurrent
            ? 'border-primary bg-primary/5'
            : 'border-border/40 hover:border-border hover:bg-primary/5'
      }`}>
      <div className="pointer-events-none relative flex items-center gap-3">
        <GripVertical
          size={13}
          className="pointer-events-auto shrink-0 cursor-grab text-muted-foreground/25 active:cursor-grabbing"
        />

        <span aria-hidden className="shrink-0">
          {isGateway ? (
            // The unified gateway wears a broadcast-tower glyph (relay/hub metaphor) instead of a brand logo.
            <span className="flex size-6 items-center justify-center rounded-md border border-border/30 bg-background text-foreground">
              <GatewayIcon width={15} height={15} />
            </span>
          ) : (
            <ProviderAvatarPrimitive
              providerId={provider.id}
              providerName={providerName}
              logo={providerIcon}
              size={24}
              className="rounded-md border border-border/30 **:data-[slot=avatar-fallback]:rounded-[inherit] **:data-[slot=avatar-image]:rounded-[inherit]"
            />
          )}
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
          {description && <p className="mt-0.5 truncate text-muted-foreground/60 text-xs">{description}</p>}
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onConfigure(provider)}
            className="min-h-0 border-border/50 px-2.5 py-1">
            <SquarePen size={11} />
            {t('code.configure')}
          </Button>
          <Button
            type="button"
            variant={isCurrent ? 'destructive' : 'default'}
            size="sm"
            onClick={() => onToggleCurrent(provider)}
            className={`min-h-0 px-2.5 py-1 ${
              isCurrent ? 'bg-destructive/10 text-destructive shadow-none hover:bg-destructive/15' : ''
            }`}>
            {isCurrent ? <CircleMinus size={11} /> : <Play size={11} />}
            {isCurrent ? t('code.disable') : t('code.enable')}
          </Button>
        </div>
      </div>
    </div>
  )
}
