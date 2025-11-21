import { SyncOutlined } from '@ant-design/icons'
import UpdateDialogPopup from '@renderer/components/Popups/UpdateDialogPopup'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { Button } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const UpdateAppButton: FC = () => {
  const { update } = useRuntime()
  const { autoCheckUpdate } = useSettings()
  const { t } = useTranslation()

  if (!update) {
    return null
  }

  if (!update.downloaded || !autoCheckUpdate) {
    return null
  }

  const handleOpenUpdateDialog = () => {
    UpdateDialogPopup.show({ releaseInfo: update.info || null })
  }

  return (
    <Container>
      <UpdateButton
        className="nodrag"
        onClick={handleOpenUpdateDialog}
        icon={<SyncOutlined />}
        color="orange"
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
