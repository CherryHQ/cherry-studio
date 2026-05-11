import { useTranslation } from 'react-i18next'

import KnowledgeEntityNameDialog from './KnowledgeEntityNameDialog'

interface RenameKnowledgeGroupDialogProps {
  open: boolean
  initialName: string
  isSubmitting: boolean
  onSubmit: (name: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

const RenameKnowledgeGroupDialog = ({
  open,
  initialName,
  isSubmitting,
  onSubmit,
  onOpenChange
}: RenameKnowledgeGroupDialogProps) => {
  const { t } = useTranslation()

  return (
    <KnowledgeEntityNameDialog
      open={open}
      title={t('knowledge.groups.rename_title')}
      submitLabel={t('knowledge.groups.rename')}
      initialName={initialName}
      isSubmitting={isSubmitting}
      submitErrorMessage={t('knowledge.groups.error.failed_to_update')}
      namePlaceholder={t('knowledge.groups.name_placeholder')}
      nameRequiredMessage={t('knowledge.groups.name_required')}
      onSubmit={onSubmit}
      onOpenChange={onOpenChange}
    />
  )
}

export default RenameKnowledgeGroupDialog
