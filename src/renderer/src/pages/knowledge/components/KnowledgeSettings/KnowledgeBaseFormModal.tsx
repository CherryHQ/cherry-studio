import { HStack } from '@renderer/components/Layout'
import { Menu, Modal, ModalProps } from 'antd'
import React, { useState } from 'react'
import styled from 'styled-components'

export interface PanelConfig {
  key: string
  label: string
  panel: React.ReactNode
}

interface KnowledgeBaseFormModalProps extends Omit<ModalProps, 'children'> {
  panels: PanelConfig[]
}

const KnowledgeBaseFormModal: React.FC<KnowledgeBaseFormModalProps> = ({ panels, ...rest }) => {
  const [selectedMenu, setSelectedMenu] = useState(panels[0]?.key)

  const menuItems = panels.map(({ key, label }) => ({ key, label }))
  const activePanel = panels.find((p) => p.key === selectedMenu)?.panel

  return (
    <StyledModal
      destroyOnClose
      maskClosable={false}
      centered
      transitionName="animation-move-down"
      width="min(800px, 70vw)"
      styles={{
        body: { padding: 0, height: 550 },
        header: {
          padding: '10px 15px',
          borderBottom: '0.5px solid var(--color-border)',
          margin: 0,
          borderRadius: 0
        },
        content: {
          padding: 0,
          paddingBottom: 10,
          overflow: 'hidden'
        }
      }}
      {...rest}>
      <HStack height="100%">
        <LeftMenu>
          <StyledMenu
            defaultSelectedKeys={[selectedMenu]}
            mode="vertical"
            items={menuItems}
            onSelect={({ key }) => setSelectedMenu(key)}
          />
        </LeftMenu>
        <SettingsContentPanel>{activePanel}</SettingsContentPanel>
      </HStack>
    </StyledModal>
  )
}

const StyledModal = styled(Modal)`
  .ant-modal-title {
    font-size: 14px;
  }
  .ant-modal-close {
    top: 4px;
    right: 4px;
  }
`

const LeftMenu = styled.div`
  display: flex;
  height: 100%;
  border-right: 0.5px solid var(--color-border);
`

const SettingsContentPanel = styled.div`
  flex: 1;
  padding: 16px 16px;
  overflow-y: scroll;
`

const StyledMenu = styled(Menu)`
  width: 200px;
  padding: 5px;
  background: transparent;
  margin-top: 2px;
  border-inline-end: none !important;

  .ant-menu-item {
    height: 36px;
    color: var(--color-text-2);
    display: flex;
    align-items: center;
    border: 0.5px solid transparent;
    border-radius: 6px;
    margin-bottom: 7px;

    .ant-menu-title-content {
      line-height: 36px;
    }
  }
  .ant-menu-item-active {
    background-color: var(--color-background-soft) !important;
    transition: none;
  }
  .ant-menu-item-selected {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
    .ant-menu-title-content {
      color: var(--color-text-1);
      font-weight: 500;
    }
  }
`

export default KnowledgeBaseFormModal
