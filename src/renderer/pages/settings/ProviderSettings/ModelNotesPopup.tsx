import { Button } from '@cherrystudio/ui'
import MarkdownEditor from '@renderer/components/MarkdownEditor'
import { useTopViewClose } from '@renderer/components/Popups/useTopViewClose'
import { TopView } from '@renderer/components/TopView'
import { useProvider } from '@renderer/hooks/useProvider'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from './primitives/ProviderSettingsDrawer'
import { drawerClasses } from './primitives/ProviderSettingsPrimitives'

interface ShowParams {
  providerId: string
}

interface Props extends ShowParams {
  resolve: () => void
}

const PopupContainer: FC<Props> = ({ providerId, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const { provider, updateProvider } = useProvider(providerId)
  const [notes, setNotes] = useState<string>(provider?.settings?.notes || '')
  const [edited, setEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const close = useTopViewClose({ onClosingChange: setClosing, resolve, setOpen, topViewKey: TopViewKey })

  useEffect(() => {
    if (edited) {
      return
    }

    setNotes(provider?.settings?.notes || '')
  }, [edited, provider?.settings?.notes])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateProvider({ providerSettings: { ...provider?.settings, notes } })
      close()
    } catch {
      window.toast.error(t('blocks.edit.save.failed.label'))
    } finally {
      setSaving(false)
    }
  }

  const onCancel = () => {
    close()
  }

  const footer = (
    <div className={drawerClasses.footer}>
      <Button variant="outline" onClick={onCancel} disabled={closing}>
        {t('common.cancel')}
      </Button>
      <Button loading={saving} disabled={saving || closing} onClick={() => void handleSave()}>
        {t('common.save')}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      title={t('settings.provider.notes.title')}
      open={open}
      onClose={onCancel}
      footer={footer}
      bodyClassName="flex min-h-0 flex-1 flex-col px-5 py-4">
      <div className="min-h-0 flex-1">
        <MarkdownEditor
          value={notes}
          onChange={(value) => {
            setEdited(true)
            setNotes(value)
          }}
          placeholder={t('settings.provider.notes.placeholder')}
          height="400px"
        />
      </div>
    </ProviderSettingsDrawer>
  )
}

const TopViewKey = 'ModelNotesPopup'

export default class ModelNotesPopup {
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<void>((resolve) => {
      TopView.show(<PopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
