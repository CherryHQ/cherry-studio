import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useCreateKnowledgeBase } from '../hooks/useCreateKnowledgeBase'
import { KnowledgeBaseFormContainer } from './KnowledgeSettings'

interface AddKnowledgeBaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (baseId: string) => void
}

const AddKnowledgeBaseDialog: FC<AddKnowledgeBaseDialogProps> = ({ open, onOpenChange, onSuccess }) => {
  const { t } = useTranslation()
  const { submit, loading } = useCreateKnowledgeBase({
    onSuccess: (baseId) => {
      onOpenChange(false)
      onSuccess?.(baseId)
    }
  })

  return (
    <KnowledgeBaseFormContainer
      title={t('knowledge.add.title')}
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={submit}
      loading={loading}
    />
  )
}

export default AddKnowledgeBaseDialog
