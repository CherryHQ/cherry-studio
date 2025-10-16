import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, RowFlex } from '@cherrystudio/ui'
import { Menu } from 'antd'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface PanelConfig {
  key: string
  label: string
  panel: React.ReactNode
}

interface KnowledgeBaseFormModalProps {
  title?: string
  open: boolean
  onCancel: () => void
  onOk?: () => void
  panels: PanelConfig[]
}

const KnowledgeBaseFormModal: React.FC<KnowledgeBaseFormModalProps> = ({ title, open, onCancel, onOk, panels }) => {
  const { t } = useTranslation()
  const [selectedMenu, setSelectedMenu] = useState(panels[0]?.key)

  const menuItems = panels.map(({ key, label }) => ({ key, label }))
  const activePanel = panels.find((p) => p.key === selectedMenu)?.panel

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onCancel()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={true}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="w-[900px] max-w-[65vw] overflow-hidden p-0 pb-[10px] sm:max-w-[900px]">
        {title && (
          <DialogHeader className="m-0 rounded-none border-[var(--color-border)] border-b-[0.5px] p-[10px_15px]">
            <DialogTitle className="text-sm">{title}</DialogTitle>
          </DialogHeader>
        )}
        <RowFlex className="h-[550px]">
          <LeftMenu>
            <StyledMenu
              defaultSelectedKeys={[selectedMenu]}
              mode="vertical"
              items={menuItems}
              onSelect={({ key }) => setSelectedMenu(key)}
            />
          </LeftMenu>
          <SettingsContentPanel>{activePanel}</SettingsContentPanel>
        </RowFlex>
        {onOk && (
          <DialogFooter className="border-[var(--color-border)] border-t-[0.5px] px-4 pt-3">
            <Button variant="bordered" onPress={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button onPress={onOk}>{t('common.confirm')}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

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
