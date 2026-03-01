import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@cherrystudio/ui'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface PanelConfig {
  key: string
  label: string
  panel: React.ReactNode
}

interface KnowledgeBaseFormModalProps {
  open?: boolean
  title?: React.ReactNode
  panels: PanelConfig[]
  onMoreSettings?: () => void
  defaultActiveTab?: string
  confirmLoading?: boolean
  okText?: string
  onOk?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onCancel?: (e: React.MouseEvent<HTMLButtonElement>) => void
  afterClose?: () => void
}

const KnowledgeBaseFormModal: React.FC<KnowledgeBaseFormModalProps> = ({
  open,
  title,
  panels,
  onMoreSettings,
  defaultActiveTab = 'general',
  confirmLoading,
  okText,
  onOk,
  onCancel,
  afterClose
}) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState(defaultActiveTab)

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onCancel?.(undefined as any)
          afterClose?.()
        }
      }}>
      <DialogContent className="flex h-[min(550px,70vh)] flex-col gap-0 overflow-hidden p-2 sm:max-w-[min(700px,70vw)]">
        <DialogHeader className="border-border border-b p-4">
          <DialogTitle className="font-medium text-sm">{title}</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          orientation="vertical"
          variant="default"
          className="flex flex-1 overflow-hidden">
          {/* Left Sidebar */}
          <TabsList className="flex w-35 flex-col items-center justify-center bg-transparent p-2">
            {panels.map((panel) => (
              <TabsTrigger
                key={panel.key}
                value={panel.key}
                className="w-full justify-start rounded-2xs hover:opacity-70 data-[state=active]:bg-foreground/5 data-[state=active]:shadow-none">
                {panel.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Right Content Area */}
          <div className="flex-1 overflow-y-auto border-border border-l p-4">
            {panels.map((panel) => (
              <TabsContent key={panel.key} value={panel.key} className="m-0 h-full">
                {panel.panel}
              </TabsContent>
            ))}
          </div>
        </Tabs>

        <DialogFooter className="flex w-full items-center justify-between border-border border-t p-4">
          <div className="flex gap-2">
            {onMoreSettings && (
              <Button variant="outline" onClick={onMoreSettings}>
                {t('settings.moresetting.title')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button onClick={onOk} loading={confirmLoading}>
              {okText || t('common.confirm')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default KnowledgeBaseFormModal
