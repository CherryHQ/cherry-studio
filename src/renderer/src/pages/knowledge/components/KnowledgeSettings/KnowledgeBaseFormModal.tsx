import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
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
  defaultExpandAdvanced?: boolean
  confirmLoading?: boolean
  okText?: string
  onOk?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onCancel?: (e: React.MouseEvent<HTMLButtonElement>) => void
}

const KnowledgeBaseFormModal: React.FC<KnowledgeBaseFormModalProps> = ({
  open,
  title,
  panels,
  onMoreSettings,
  defaultExpandAdvanced = false,
  confirmLoading,
  okText,
  onOk,
  onCancel
}) => {
  const { t } = useTranslation()
  const [showAdvanced, setShowAdvanced] = useState(defaultExpandAdvanced)

  const generalPanel = panels.find((p) => p.key === 'general')
  const advancedPanel = panels.find((p) => p.key === 'advanced')

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel?.(undefined as any)}>
      <DialogContent className="max-w-[min(500px,60vw)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-sm font-medium">{title}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-2 py-4">
          <div className="flex flex-col">
            {/* General Settings */}
            {generalPanel && <div>{generalPanel.panel}</div>}

            {/* Advanced Settings */}
            {showAdvanced && advancedPanel && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-4 px-4 text-sm font-medium text-foreground">{advancedPanel.label}</div>
                <div>{advancedPanel.panel}</div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex w-full items-center justify-between border-t border-border px-5 py-3">
          <div className="flex gap-2">
            {advancedPanel && (
              <Button variant="outline" onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {t('settings.advanced.title')}
              </Button>
            )}
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
