import { SyncOutlined } from '@ant-design/icons'
import UpdateDialogPopup from '@renderer/components/Popups/UpdateDialogPopup'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdate'
import { useSettings } from '@renderer/hooks/useSettings'
import { Button } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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

  if (update.ignore) {
    return null
  }

  const handleOpenUpdateDialog = () => {
    UpdateDialogPopup.show({ releaseInfo: appUpdateState.info || null })
  }

  return (
    <Container>
      <UpdateButton
        className="nodrag"
        onClick={handleOpenUpdateDialog}
        icon={<SyncOutlined />}
        color="primary"
        variant="outlined"
        size="small">
        {t('button.update_available')}
      </UpdateButton>
    </Container>
  )
}

const Container = styled.div``

const UpdateButton = styled(Button)`
  border-radius: 24px;
  font-size: 12px;
  @media (max-width: 1000px) {
    display: none;
  }
`

export default UpdateAppButton
