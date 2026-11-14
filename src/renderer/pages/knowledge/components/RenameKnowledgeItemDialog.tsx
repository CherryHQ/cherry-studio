import { useTranslation } from 'react-i18next'

import { type KnowledgeFileRenameError, validateRenamedFileName } from '@shared/utils/file'

import KnowledgeEntityNameDialog from './KnowledgeEntityNameDialog'

const RENAME_ERROR_KEYS = {
  empty: 'knowledge.data_source.rename.error.empty',
  too_long: 'knowledge.data_source.rename.error.too_long',
  invalid: 'knowledge.data_source.rename.error.invalid',
  extension_changed: 'knowledge.data_source.rename.error.extension_changed'
} as const satisfies Record<KnowledgeFileRenameError, string>

interface RenameKnowledgeItemDialogProps {
  open: boolean
  initialName: string
  onSubmit: (name: string) => Promise<void>
  onOpenChange: (open: boolean) => void
}

const RenameKnowledgeItemDialog = ({ open, initialName, onSubmit, onOpenChange }: RenameKnowledgeItemDialogProps) => {
  const { t } = useTranslation()

  const handleSubmit = async (name: string) => {
    const validation = validateRenamedFileName(initialName, name)
    if (!validation.valid) {
      throw new Error(t(RENAME_ERROR_KEYS[validation.reason]))
    }
    if (validation.name !== initialName) {
      await onSubmit(validation.name)
    }
    onOpenChange(false)
  }

  return (
    <KnowledgeEntityNameDialog
      open={open}
      title={t('knowledge.data_source.rename.title')}
      submitLabel={t('knowledge.data_source.actions.rename')}
      initialName={initialName}
      isSubmitting={false}
      submitErrorMessage={t('knowledge.data_source.rename.failed')}
      namePlaceholder={t('knowledge.data_source.rename.placeholder')}
      nameRequiredMessage={t('knowledge.data_source.rename.error.empty')}
      onSubmit={handleSubmit}
      onOpenChange={onOpenChange}
    />
  )
}

export default RenameKnowledgeItemDialog
