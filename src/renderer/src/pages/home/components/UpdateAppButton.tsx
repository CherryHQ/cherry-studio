import { SyncOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdate'
import { Button } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const UpdateAppButton: FC = () => {
  const { appUpdateState } = useAppUpdateState()
  const [autoCheckUpdate] = usePreference('app.dist.auto_update.enabled')
  const { t } = useTranslation()

  if (!appUpdateState) {
    return null
  }

  if (!appUpdateState.downloaded || !autoCheckUpdate) {
    return null
  }

  return (
    <Container>
      <UpdateButton
        className="nodrag"
        onClick={() => window.api.showUpdateDialog()}
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
