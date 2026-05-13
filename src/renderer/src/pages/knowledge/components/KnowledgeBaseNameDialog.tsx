import { useTranslation } from 'react-i18next'

import KnowledgeEntityNameDialog from './KnowledgeEntityNameDialog'

interface KnowledgeBaseNameDialogProps {
  open: boolean
  initialName: string
  isSubmitting: boolean
  onSubmit: (name: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

const KnowledgeBaseNameDialog = ({
  open,
  initialName,
  isSubmitting,
  onSubmit,
  onOpenChange
}: KnowledgeBaseNameDialogProps) => {
  const { t } = useTranslation()

  return (
    <KnowledgeEntityNameDialog
      open={open}
      title={t('knowledge.rename_title')}
      submitLabel={t('knowledge.context.rename')}
      initialName={initialName}
      isSubmitting={isSubmitting}
      submitErrorMessage={t('knowledge.error.failed_to_edit')}
      namePlaceholder={t('common.name')}
      nameRequiredMessage={t('knowledge.name_required')}
      onSubmit={onSubmit}
      onOpenChange={onOpenChange}
    />
  )
}

export default KnowledgeBaseNameDialog
