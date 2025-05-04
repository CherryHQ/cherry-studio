import ChatFlowMap from '@renderer/pages/home/Messages/ChatFlowMap'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppSelector } from '@renderer/store'
import { Modal } from 'antd'
import { FC, useEffect, useState } from 'react'
import styled from 'styled-components'

const StyledModal = styled(Modal)`
  .ant-modal-content {
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .ant-modal-header {
    background: var(--bg-color);
    border-bottom: 1px solid var(--color-border);
    padding: 16px 24px;
  }
  .ant-modal-title {
    color: var(--color-text);
    font-size: 16px;
    font-weight: 500;
  }
  .ant-modal-close {
    color: var(--color-text);
    &:hover {
      color: var(--color-text);
      background: var(--color-background-mute);
    }
  }
  .ant-modal-body {
    padding: 0;
    height: 80vh;
    background: var(--bg-color);
  }
  .ant-modal-mask {
    background-color: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
  }
`

const DialogMap: FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const currentTopicId = useAppSelector((state) => state.messages.currentTopicId)

  useEffect(() => {
    const handleShowDialogMap = () => {
      setIsOpen(true)
    }

    EventEmitter.on(EVENT_NAMES.SHOW_DIALOG_MAP, handleShowDialogMap)

    return () => {
      EventEmitter.off(EVENT_NAMES.SHOW_DIALOG_MAP, handleShowDialogMap)
    }
  }, [])

  const handleClose = () => {
    setIsOpen(false)
  }

  return (
    <StyledModal
      title="对话流程图"
      open={isOpen}
      onCancel={handleClose}
      footer={null}
      width="90%"
      style={{ top: 20 }}
      destroyOnClose
      maskClosable={true}
      centered={false}>
      <ChatFlowMap conversationId={currentTopicId || ''} />
    </StyledModal>
  )
}

export default DialogMap
