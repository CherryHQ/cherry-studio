import { MenuOutlined } from '@ant-design/icons'
import { DraggableList } from '@renderer/components/DraggableList'
import { Box, HStack } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { useAgents } from '@renderer/hooks/useAgents'
import { Empty, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const PopupContainer: React.FC = () => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { agents, updateAgents } = useAgents()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    ManageAgentsPopup.hide()
  }

  useEffect(() => {
    if (agents.length === 0) {
      setOpen(false)
    }
  }, [agents])

  return (
    <Modal
      title={t('agents.manage.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      footer={null}
      transitionName="animation-move-down"
      centered>
      <Container>
        {agents.length > 0 && (
          <DraggableList list={agents} onUpdate={updateAgents}>
            {(item) => (
              <AgentItem>
                <Box mr={8}>
                  {item.emoji} {item.name}
                </Box>
                <HStack gap="15px">
                  <MenuOutlined style={{ cursor: 'move' }} />
                </HStack>
              </AgentItem>
            )}
          </DraggableList>
        )}
        {agents.length === 0 && <Empty description="" />}
      </Container>
    </Modal>
  )
}

const Container = styled.div`
  padding: 12px 0;
  height: 50vh;
  overflow-y: auto;
  &::-webkit-scrollbar {
    display: none;
  }
`

const AgentItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-radius: 8px;
  user-select: none;
  background-color: var(--color-background-soft);
  margin-bottom: 8px;
  .anticon {
    font-size: 16px;
    color: var(--color-icon);
  }
  &:hover {
    background-color: var(--color-background-mute);
  }
`

export default class ManageAgentsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('ManageAgentsPopup')
  }
  static show() {
    TopView.show(<PopupContainer />, 'ManageAgentsPopup')
  }
}
