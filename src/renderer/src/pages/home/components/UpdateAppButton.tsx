import { SyncOutlined } from '@ant-design/icons'
import { useDisclosure } from '@heroui/react'
import UpdateDialog from '@renderer/components/UpdateDialog'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { Button } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const UpdateAppButton: FC = () => {
  const { update } = useRuntime()
  const { autoCheckUpdate } = useSettings()
  const { t } = useTranslation()
  const { isOpen, onOpen, onClose } = useDisclosure()

  if (!update) {
    return null
  }

  if (!update.downloaded || !autoCheckUpdate) {
    return null
  }

  return (
    <Container>
      <UpdateButton
        className="nodrag"
        onClick={onOpen}
        icon={<SyncOutlined />}
        color="orange"
        variant="outlined"
        size="small">
        {t('button.update_available')}
      </UpdateButton>

      <UpdateDialog isOpen={isOpen} onClose={onClose} releaseInfo={update.info || null} />
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
