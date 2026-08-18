import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { NutstorePathSelector } from '@renderer/components/NutstorePathSelector'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { useTranslation } from 'react-i18next'

type Props = Nutstore.Fs & PopupInjectedProps<string | null>

const PopupContainer: React.FC<Props> = ({ open, resolve, ...fs }) => {
  const { t } = useTranslation()

  const onCancel = () => resolve(null)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.data.nutstore.pathSelector.title')}</DialogTitle>
        </DialogHeader>
        <NutstorePathSelector fs={fs} onConfirm={resolve} onCancel={onCancel} />
      </DialogContent>
    </Dialog>
  )
}

const NutstorePathPopup = createPopup<Nutstore.Fs, string | null>(PopupContainer, { dismissResult: null })

export default NutstorePathPopup
