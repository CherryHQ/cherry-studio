import { SyncOutlined } from '@ant-design/icons'
import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useDisclosure } from '@heroui/react'
import UpdateDialog from '@renderer/components/UpdateDialog'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdate'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const UpdateAppButton: FC = () => {
  const { appUpdateState } = useAppUpdateState()
  const [autoCheckUpdate] = usePreference('app.dist.auto_update.enabled')
  const { t } = useTranslation()
  const { isOpen, onOpen, onClose } = useDisclosure()

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
        onPress={onOpen}
        startContent={<SyncOutlined />}
        color="warning"
        variant="bordered"
        size="sm">
        {t('button.update_available')}
      </UpdateButton>

      <UpdateDialog isOpen={isOpen} onClose={onClose} releaseInfo={appUpdateState.info || null} />
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
