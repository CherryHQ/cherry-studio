import { Button } from '@cherrystudio/ui'
import type { CodeCli } from '@shared/types/codeCli'
import { GripVertical, Pencil, Play, Power } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { CLIIcon } from './CLIIcon'

export interface OwnLoginCardProps {
  toolId: CodeCli
  toolName: string
  selected: boolean
  configurable?: boolean
  dragging?: boolean
  onToggle: () => void
  onConfigure?: () => void
}

/** Virtual "use your own login" row for login-capable CLI tools. Mirrors
 * `ProviderCard` (draggable, single-select) but drops the model label: clicking
 * the card body toggles it, and tools whose own-login exposes tool params
 * (`configurable`) also get a hover-revealed Configure button. */
export const OwnLoginCard: FC<OwnLoginCardProps> = ({
  toolId,
  toolName,
  selected,
  configurable,
  dragging,
  onToggle,
  onConfigure
}) => {
  const { t } = useTranslation()
  const title = t('code.own_login.title', { toolName })

  return (
    <div
      className={`group relative rounded-xl border p-3.5 transition-colors ${
        dragging
          ? 'border-primary/40 opacity-50'
          : selected
            ? 'border-border/40 bg-muted'
            : 'border-border/40 hover:border-border hover:bg-muted'
      }`}>
      {/* Full-card click target — clicks on the content pass through to it. */}
      <Button
        type="button"
        variant="ghost"
        tabIndex={-1}
        onClick={onToggle}
        aria-label={title}
        className="absolute inset-0 rounded-xl p-0 hover:bg-transparent"
      />

      <div className="pointer-events-none relative flex items-center gap-3">
        <GripVertical size={13} className="shrink-0 cursor-grab text-muted-foreground/25 active:cursor-grabbing" />

        <span aria-hidden className="shrink-0">
          <CLIIcon id={toolId} size={24} className="size-6 rounded-md border border-border/30" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-foreground text-sm">{title}</span>
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
          {configurable && onConfigure && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onConfigure()}
              className="min-h-0 border-border/50 px-2.5 py-1 text-muted-foreground hover:text-foreground">
              <Pencil size={11} />
              {t('code.configure')}
            </Button>
          )}
          <Button
            type="button"
            variant={selected ? 'outline' : 'default'}
            size="sm"
            onClick={onToggle}
            className="min-h-0 px-2.5 py-1">
            {selected ? <Power size={11} /> : <Play size={11} />}
            {selected ? t('code.disable') : t('code.enable')}
          </Button>
        </div>
      </div>
    </div>
  )
}
