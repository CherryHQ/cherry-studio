import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'

import CreateKnowledgeBaseDialog, { type CreateKnowledgeBaseDialogProps } from './CreateKnowledgeBaseDialog'
import FeishuWikiWizard from './FeishuWikiWizard'

const NewKnowledgeBaseDialog = (props: CreateKnowledgeBaseDialogProps) => {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'blank' | 'feishu' | null>(null)

  if (mode === 'blank') return <CreateKnowledgeBaseDialog {...props} />
  if (mode === 'feishu') {
    return <FeishuWikiWizard open={props.open} onOpenChange={props.onOpenChange} newBase={props} />
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="sm" aria-describedby={undefined} closeLabel={t('common.close')}>
        <DialogHeader className="pr-8">
          <DialogTitle>{t('knowledge.add.title')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-4 text-left whitespace-normal"
            onClick={() => setMode('blank')}>
            <span>{t('knowledge.add.blank')}</span>
            <span className="text-muted-foreground text-sm font-normal">{t('knowledge.add.blank_description')}</span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-4 text-left whitespace-normal"
            onClick={() => setMode('feishu')}>
            <span>{t('knowledge.add.from_feishu')}</span>
            <span className="text-muted-foreground text-sm font-normal">
              {t('knowledge.add.from_feishu_description')}
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default NewKnowledgeBaseDialog
