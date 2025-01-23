import SettingsPage, { SettingsTab } from '@renderer/pages/settings/SettingsPage'
import { Modal } from 'antd'
import { FC, useState } from 'react'
import styled, { createGlobalStyle } from 'styled-components'

interface Props {
  actionButton?: React.ReactNode
  activeTab?: SettingsTab
}

const SettingsPopup: FC<Props> = ({ actionButton, activeTab }) => {
  const [open, setOpen] = useState(false)

  const onCancel = () => {
    setOpen(false)
  }

  return (
    <>
      <div onClick={() => setOpen(true)}>{actionButton}</div>
      <GlobalStyle />
      <StyledModal
        transitionName="ant-move-down"
        width="80vw"
        title={null}
        open={open}
        onCancel={onCancel}
        footer={null}>
        <SettingsPage activeTab={activeTab} />
      </StyledModal>
    </>
  )
}

const GlobalStyle = createGlobalStyle`
  .ant-modal-mask {
    backdrop-filter: blur(10px);
    background-color: transparent !important;
  }
`

const StyledModal = styled(Modal)`
  min-width: 900px;
  max-width: 1300px;
  padding-bottom: 0;

  .ant-modal-content {
    padding: 0;
    overflow: hidden;
    border-radius: 12px;
    /* border: 0.5px solid var(--color-border); */
  }
  .ant-modal-close {
    top: 4px;
    right: 4px;
  }
`

export default SettingsPopup
