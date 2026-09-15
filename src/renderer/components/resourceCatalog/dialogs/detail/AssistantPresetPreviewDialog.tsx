import { useTranslation } from 'react-i18next'

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { AssistantPresetIcon } from '@renderer/components/resourceCatalog/AssistantPresetIcon'
import type { OfficialAssistantVendor } from '@renderer/utils/resourceCatalog'

export interface AssistantPresetPreviewDialogPreset {
  description?: string
  emoji?: string
  group?: string[]
  name: string
  officialVendor?: OfficialAssistantVendor
  prompt?: string
}

type Props = {
  preset: AssistantPresetPreviewDialogPreset | null
  open: boolean
  adding?: boolean
  addedAssistantId?: string
  configurationProviderId?: string
  onOpenChange: (open: boolean) => void
  onAdd: () => Promise<void> | void
  onConfigureProvider?: (providerId: string) => void
  onOpenChat: (assistantId: string) => void
}

export function AssistantPresetPreviewDialog({
  preset,
  open,
  adding = false,
  addedAssistantId,
  configurationProviderId,
  onOpenChange,
  onAdd,
  onConfigureProvider,
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
        <DialogHeader className="shrink-0 border-b border-border-subtle px-5 pt-5 pr-12 pb-4 text-left">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-base">
              <AssistantPresetIcon preset={preset} size={20} />
            </div>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="truncate">{preset.name}</DialogTitle>
              {groups.length > 0 && (
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-1">
                  {groups.map((group) => (
                    <Badge
                      key={group}
                      variant="secondary"
                      className="text-muted-foreground border-0 bg-secondary px-1.5 py-px text-xs">
                      {group}
                    </Badge>
                  ))}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--scrollbar-thumb)]">
          {configurationProviderId && onConfigureProvider ? (
            <Alert
              type="warning"
              showIcon
              message={t('library.assistant_catalog.provider_required_title', { name: preset.name })}
              description={t('library.assistant_catalog.provider_required_description', { name: preset.name })}
              action={
                <Button variant="outline" size="sm" onClick={() => onConfigureProvider(configurationProviderId)}>
                  {t('navigate.provider_settings')}
                </Button>
              }
              className="rounded-md px-3 py-2 shadow-none"
            />
          ) : null}
          {description && (
            <section>
              <div className="text-muted-foreground mb-2 text-sm">
                {t('library.assistant_catalog.preview_description')}
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{description}</p>
            </section>
          )}

          {prompt && (
            <section>
              <div className="text-muted-foreground mb-2 text-sm">{t('library.assistant_catalog.preview_prompt')}</div>
              <p className="text-muted-foreground rounded-md border border-border-subtle bg-muted p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {prompt}
              </p>
            </section>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border-subtle px-5 py-4">
          <Button variant="outline" disabled={adding} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="emphasis"
            loading={!isAdded && adding}
            disabled={!isAdded && (adding || Boolean(configurationProviderId))}
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
