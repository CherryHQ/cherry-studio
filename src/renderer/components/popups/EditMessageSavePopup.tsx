import { Box, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { GitBranch, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** How the user wants to save an edited user message. */
export type EditMessageSaveChoice = 'save-only' | 'save-and-regenerate'

interface EditMessageSavePopupParams {
  /** Whether the topic currently has a live stream that blocks regeneration. */
  regenerateDisabled?: boolean
}

type Props = EditMessageSavePopupParams & PopupInjectedProps<EditMessageSaveChoice | null>

const EditMessageSavePopupContainer: React.FC<Props> = ({ regenerateDisabled = false, open, resolve }) => {
  const { t } = useTranslation()

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resolve(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeOnOverlayClick={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('chat.message.edit_save.title')}</DialogTitle>
        </DialogHeader>
        <Box className="text-foreground-secondary text-sm">{t('chat.message.edit_save.description')}</Box>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => resolve('save-only')}>
            <Save className="mr-1.5 size-4" />
            {t('chat.message.edit_save.save_only')}
          </Button>
          <Button onClick={() => resolve('save-and-regenerate')} disabled={regenerateDisabled}>
            <GitBranch className="mr-1.5 size-4" />
            {t('chat.message.edit_save.save_and_regenerate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Ask how an edited user message should be saved. Editing a user message no
 * longer regenerates the whole conversation by default — the user explicitly
 * picks between a plain content save and a save + regenerate (which branches
 * the tree and spends tokens).
 */
const EditMessageSavePopup = createPopup<EditMessageSavePopupParams, EditMessageSaveChoice | null>(
  EditMessageSavePopupContainer,
  { dismissResult: null }
)

export default EditMessageSavePopup
