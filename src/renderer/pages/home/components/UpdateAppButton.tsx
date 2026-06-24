import { Button } from '@cherrystudio/ui'
import UpdateDialogPopup from '@renderer/components/Popups/UpdateDialogPopup'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdate'
import { useSettings } from '@renderer/hooks/useSettings'
import { RefreshCw } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const UpdateAppButton: FC = () => {
  const { appUpdateState } = useAppUpdateState()
  const { autoCheckUpdate } = useSettings()
  const { t } = useTranslation()

  if (!appUpdateState) {
    return null
  }

  if (!appUpdateState.downloaded || !autoCheckUpdate) {
    return null
  }

  if (appUpdateState.ignore) {
    return null
  }

  const handleOpenUpdateDialog = () => {
    void UpdateDialogPopup.show({ releaseInfo: appUpdateState.info || null })
  }

  return (
    <div>
      <Button className="nodrag rounded-3xl text-xs" onClick={handleOpenUpdateDialog} variant="outline" size="sm">
        <RefreshCw size={14} />
        {t('button.update_available')}
      </Button>
    </div>
  )
}

export default UpdateAppButton
