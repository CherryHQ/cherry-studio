import { CreateGroupDialog } from '@renderer/components/CreateGroupDialog'
import { useTranslation } from 'react-i18next'

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
    <CreateGroupDialog
      open={open}
      title={t('knowledge.groups.add')}
      submitLabel={t('common.add')}
      isSubmitting={isSubmitting}
      errorMessage={t('knowledge.groups.error.failed_to_create')}
      namePlaceholder={t('knowledge.groups.name_placeholder')}
      nameRequiredMessage={t('knowledge.groups.name_required')}
      onCreate={onSubmit}
      onOpenChange={onOpenChange}
    />
  )
}

export default CreateKnowledgeGroupDialog
