import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@cherrystudio/ui'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AssistantCatalogPreset } from './useAssistantPresetCatalog'

interface Props {
  preset: AssistantCatalogPreset | null
  open: boolean
  adding?: boolean
  onOpenChange: (open: boolean) => void
  onAdd: () => Promise<void> | void
}

export function AssistantPresetPreviewDialog({ preset, open, adding = false, onOpenChange, onAdd }: Props) {
  const { t } = useTranslation()

  if (!preset) return null

  const description = preset.description?.trim()
  const prompt = preset.prompt?.trim()
  const groups = (preset.group || []).slice(0, 3)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 backdrop-blur-sm"
        className="max-h-[calc(100vh-48px)] w-[600px] gap-0 overflow-hidden rounded-xs border-border/30 bg-popover p-0 shadow-2xl sm:max-w-[600px]">
        <div className="flex items-start justify-between gap-4 border-border/15 border-b px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xs bg-accent/55 text-base">
              {preset.emoji || '🤖'}
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="truncate text-foreground text-lg leading-6">{preset.name}</DialogTitle>
              {groups.length > 0 && (
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-1">
                  {groups.map((group) => (
                    <Badge
                      key={group}
                      variant="secondary"
                      className="border-0 bg-accent/60 px-1.5 py-px text-muted-foreground/65 text-xs">
                      {group}
                    </Badge>
                  ))}
                </DialogDescription>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.close')}
            disabled={adding}
            onClick={() => onOpenChange(false)}
            className="flex h-7 min-h-0 w-7 shrink-0 items-center justify-center rounded-3xs font-normal text-muted-foreground/40 shadow-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
            <X size={14} />
          </Button>
        </div>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
          {description && (
            <section>
              <div className="mb-2 text-muted-foreground/60 text-sm">
                {t('library.assistant_catalog.preview_description')}
              </div>
              <p className="whitespace-pre-wrap text-foreground/80 text-sm leading-relaxed">{description}</p>
            </section>
          )}

          {prompt && (
            <section>
              <div className="mb-2 text-muted-foreground/60 text-sm">
                {t('library.assistant_catalog.preview_prompt')}
              </div>
              <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-xs border border-border/35 bg-accent/20 p-4 text-muted-foreground/80 text-sm leading-relaxed [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
                {prompt}
              </p>
            </section>
          )}
        </div>

        <DialogFooter className="border-border/15 border-t px-5 py-4">
          <Button
            variant="outline"
            disabled={adding}
            onClick={() => onOpenChange(false)}
            className="h-8 min-h-0 rounded-lg px-4 font-normal text-sm shadow-none focus-visible:ring-0">
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            loading={adding}
            onClick={() => void onAdd()}
            className="h-8 min-h-0 rounded-lg px-4 font-normal text-sm shadow-none focus-visible:ring-0">
            {t('library.assistant_catalog.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
