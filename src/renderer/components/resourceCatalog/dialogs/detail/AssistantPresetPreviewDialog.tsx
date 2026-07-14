import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

export interface AssistantPresetPreviewDialogPreset {
  description?: string
  emoji?: string
  group?: string[]
  name: string
  prompt?: string
}

interface Props {
  preset: AssistantPresetPreviewDialogPreset | null
  open: boolean
  adding?: boolean
  addedAssistantId?: string
  onOpenChange: (open: boolean) => void
  onAdd: () => Promise<void> | void
  onOpenChat: (assistantId: string) => void
}

export function AssistantPresetPreviewDialog({
  preset,
  open,
  adding = false,
  addedAssistantId,
  onOpenChange,
  onAdd,
  onOpenChat
}: Props) {
  const { t } = useTranslation()

  if (!preset) return null

  const description = preset.description?.trim()
  const prompt = preset.prompt?.trim()
  const groups = (preset.group || []).slice(0, 3)
  const isAdded = Boolean(addedAssistantId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed height + a single scroll region (the body). The prompt block must NOT scroll on its
          own, or the dialog shows nested scrollbars. */}
      <DialogContent
        closeOnOverlayClick={!adding}
        size="xl"
        className="flex h-[min(600px,76vh)] flex-col gap-0 overflow-hidden p-0"
        onPointerDownOutside={(event) => adding && event.preventDefault()}>
        <DialogHeader className="shrink-0 border-border-muted border-b px-5 pt-5 pr-12 pb-4 text-left">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-base">
              {preset.emoji || '🤖'}
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="truncate">{preset.name}</DialogTitle>
              {groups.length > 0 && (
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-1">
                  {groups.map((group) => (
                    <Badge
                      key={group}
                      variant="secondary"
                      className="border-0 bg-secondary px-1.5 py-px text-foreground-secondary text-xs">
                      {group}
                    </Badge>
                  ))}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-1">
          {description && (
            <section>
              <div className="mb-2 text-foreground-secondary text-sm">
                {t('library.assistant_catalog.preview_description')}
              </div>
              <p className="whitespace-pre-wrap text-foreground text-sm leading-relaxed">{description}</p>
            </section>
          )}

          {prompt && (
            <section>
              <div className="mb-2 text-foreground-secondary text-sm">
                {t('library.assistant_catalog.preview_prompt')}
              </div>
              <p className="whitespace-pre-wrap rounded-md border border-border-subtle bg-muted p-4 text-foreground-secondary text-sm leading-relaxed">
                {prompt}
              </p>
            </section>
          )}
        </div>

        <DialogFooter className="shrink-0 border-border-muted border-t px-5 py-4">
          <Button variant="outline" disabled={adding} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="emphasis"
            loading={!isAdded && adding}
            disabled={!isAdded && adding}
            onClick={() => {
              if (addedAssistantId) {
                onOpenChat(addedAssistantId)
                onOpenChange(false)
              } else {
                void onAdd()
              }
            }}>
            {isAdded ? t('library.assistant_catalog.go_to_chat') : t('library.assistant_catalog.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
