import { Button } from '@cherrystudio/ui'
import type { CodeCli } from '@shared/types/codeCli'
import { GripVertical, Pencil } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
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
 * `ProviderCard` (draggable, single-select) but drops the model label. Tools
 * whose own-login exposes tool params (`configurable`) also get a Configure
 * button; the rest are a bare toggle. */
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

  const handleConfigure = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onConfigure?.()
  }

  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        dragging
          ? 'border-primary/40 opacity-50'
          : selected
            ? 'border-border/40 bg-muted'
            : 'border-border/40 hover:border-border hover:bg-muted'
      }`}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <GripVertical
            size={13}
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 cursor-grab text-muted-foreground/25 hover:text-muted-foreground/55 active:cursor-grabbing"
          />

          <span aria-hidden className="shrink-0">
            <CLIIcon id={toolId} size={24} className="size-6 rounded-md border border-border/30" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-foreground text-sm">
                {t('code.own_login.title', { toolName })}
              </span>
              {selected && (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                  {t('code.enabled')}
                </span>
              )}
            </div>
          </div>
        </button>

        {configurable && onConfigure && (
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
        )}
      </div>
    </div>
  )
}
