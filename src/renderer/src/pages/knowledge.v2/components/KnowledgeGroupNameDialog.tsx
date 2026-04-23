import { useTranslation } from 'react-i18next'

import KnowledgeEntityNameDialog from './KnowledgeEntityNameDialog'

interface KnowledgeGroupNameDialogProps {
  mode: 'create' | 'update'
  open: boolean
  initialName?: string
  isSubmitting: boolean
  onSubmit: (name: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

const KnowledgeGroupNameDialog = ({
  mode,
  open,
  initialName,
  isSubmitting,
  onSubmit,
  onOpenChange
}: KnowledgeGroupNameDialogProps) => {
  const { t } = useTranslation()

  const title = mode === 'create' ? t('knowledge_v2.groups.add') : t('knowledge_v2.groups.rename_title')
  const submitLabel = mode === 'create' ? t('common.add') : t('knowledge_v2.groups.rename')
  const submitErrorKey =
    mode === 'create' ? 'knowledge_v2.groups.error.failed_to_create' : 'knowledge_v2.groups.error.failed_to_update'

  return (
    <KnowledgeEntityNameDialog
      open={open}
      title={title}
      submitLabel={submitLabel}
      initialName={initialName}
      isSubmitting={isSubmitting}
      submitErrorMessage={t(submitErrorKey)}
      namePlaceholder={t('knowledge_v2.groups.name_placeholder')}
      nameRequiredMessage={t('knowledge_v2.groups.name_required')}
      onSubmit={onSubmit}
      onOpenChange={onOpenChange}
    />
  )
}

export default KnowledgeGroupNameDialog
