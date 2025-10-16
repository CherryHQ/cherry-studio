import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@cherrystudio/ui'
import React from 'react'
import { useTranslation } from 'react-i18next'

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
        <Tabs defaultValue={panels[0]?.key} orientation="vertical" className="flex h-[550px] flex-row">
          <TabsList className="flex h-full w-auto items-start justify-center bg-transparent px-2">
            <TabsList className="mt-[2px] h-auto flex-col gap-0 bg-transparent p-[5px]">
              {panels.map((panel) => (
                <TabsTrigger
                  key={panel.key}
                  value={panel.key}
                  className="mb-[7px] flex h-9 items-center justify-start rounded-md border-[0.5px] border-transparent bg-transparent px-3 font-normal text-[var(--color-text-2)] shadow-none hover:bg-[var(--color-background-soft)] data-[state=active]:border-[var(--color-border)] data-[state=active]:bg-[var(--color-background-soft)] data-[state=active]:font-medium data-[state=active]:text-[var(--color-text-1)] data-[state=active]:shadow-none">
                  {panel.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </TabsList>
          <Separator orientation="vertical" />
          {panels.map((panel) => (
            <TabsContent key={panel.key} value={panel.key} className="flex-1 overflow-y-auto">
              {panel.panel}
            </TabsContent>
          ))}
        </Tabs>
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

export default KnowledgeBaseFormModal
