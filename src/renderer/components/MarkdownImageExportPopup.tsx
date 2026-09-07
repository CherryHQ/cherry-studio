import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem
} from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import type { ImageExportMode } from '@renderer/services/markdownImageExport'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import React, { useEffect, useState } from 'react'

export interface MarkdownImageExportOptions {
  imageCount: number
}

/**
 * Mode picker shown before a Markdown file export that contains images:
 * embed as base64 (default), write an assets folder, or export text only.
 * Cancelling the dialog resolves `null` and aborts the export.
 */
const MarkdownImageExportContainer: React.FC<
  MarkdownImageExportOptions & PopupInjectedProps<ImageExportMode | null>
> = ({ imageCount, open, resolve }) => {
  const [openState, setOpen] = useState(open)
  const [mode, setMode] = useState<ImageExportMode>('embed')

  useEffect(() => {
    setOpen(open)
  }, [open])

  const handleConfirm = () => {
    setOpen(false)
    resolve(mode)
  }

  const handleCancel = () => {
    setOpen(false)
    resolve(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) handleCancel()
  }

  const options: Array<{ value: ImageExportMode; label: string }> = [
    { value: 'embed', label: i18n.t('chat.topics.export.image_mode.embed') },
    { value: 'folder', label: i18n.t('chat.topics.export.image_mode.folder') },
    { value: 'none', label: i18n.t('chat.topics.export.image_mode.none') }
  ]

  return (
    <Dialog open={openState} onOpenChange={handleOpenChange}>
      <DialogContent closeOnOverlayClick={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{i18n.t('chat.topics.export.image_mode.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <DialogDescription>{i18n.t('chat.topics.export.image_mode.count', { count: imageCount })}</DialogDescription>
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as ImageExportMode)}
            aria-label={i18n.t('chat.topics.export.image_mode.title')}
            className="gap-2">
            {options.map((option) => (
              <label
                key={option.value}
                className="flex h-9 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm hover:bg-accent">
                <RadioGroupItem value={option.value} />
                <span>{option.label}</span>
              </label>
            ))}
          </RadioGroup>
          <p className="text-muted-foreground text-xs">{i18n.t('chat.topics.export.image_mode.cancel_hint')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {i18n.t('common.cancel')}
          </Button>
          <Button variant="default" onClick={handleConfirm}>
            {i18n.t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const MarkdownImageExportPopup = createPopup<MarkdownImageExportOptions, ImageExportMode | null>(
  MarkdownImageExportContainer,
  { dismissResult: null }
)

export default MarkdownImageExportPopup
