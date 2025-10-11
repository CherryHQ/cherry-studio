import { MenuOutlined } from '@ant-design/icons'
import { Box, RowFlex } from '@cherrystudio/ui'
import { DraggableList } from '@renderer/components/DraggableList'
import { TopView } from '@renderer/components/TopView'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { Empty, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const PopupContainer: React.FC = () => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { presets, setAssistantPresets } = useAssistantPresets()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    ManageAssistantPresetsPopup.hide()
  }

  useEffect(() => {
    if (presets.length === 0) {
      setOpen(false)
    }
  }, [presets])

  return (
    <Modal
      title={t('assistants.presets.manage.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      footer={null}
      transitionName="animation-move-down"
      centered>
      <Container>
        {presets.length > 0 && (
          <DraggableList list={presets} onUpdate={setAssistantPresets}>
            {(item) => (
              <AgentItem>
                <Box className="mr-8">
                  {item.emoji} {item.name}
                </Box>
                <RowFlex className="gap-[15px]">
                  <MenuOutlined style={{ cursor: 'move' }} />
                </RowFlex>
              </AgentItem>
            )}
          </DraggableList>
        )}
        {presets.length === 0 && <Empty description="" />}
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

export default class ManageAssistantPresetsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('ManageAssistantPresetsPopup')
  }
  static show() {
    TopView.show(<PopupContainer />, 'ManageAssistantPresetsPopup')
  }
}
