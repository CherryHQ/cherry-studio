import { useTranslation } from 'react-i18next'

import KnowledgeEntityNameDialog from './KnowledgeEntityNameDialog'

interface CreateKnowledgeGroupDialogProps {
  open: boolean
  isSubmitting: boolean
  onSubmit: (name: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

const CreateKnowledgeGroupDialog = ({
  open,
  isSubmitting,
  onSubmit,
  onOpenChange
}: CreateKnowledgeGroupDialogProps) => {
  const { t } = useTranslation()

  return (
    <KnowledgeEntityNameDialog
      open={open}
      title={t('knowledge.groups.add')}
      submitLabel={t('common.add')}
      initialName=""
      isSubmitting={isSubmitting}
      submitErrorMessage={t('knowledge.groups.error.failed_to_create')}
      namePlaceholder={t('knowledge.groups.name_placeholder')}
      nameRequiredMessage={t('knowledge.groups.name_required')}
      onSubmit={onSubmit}
      onOpenChange={onOpenChange}
    />
  )
}

export default CreateKnowledgeGroupDialog
