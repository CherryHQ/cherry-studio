import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useUpdateKnowledgeBase } from '../hooks/useUpdateKnowledgeBase'
import { mapKnowledgeBaseV2ToV1 } from '../utils/knowledgeBaseAdapter'
import { KnowledgeBaseFormContainer } from './KnowledgeSettings'

interface EditKnowledgeBaseDialogProps {
  base: KnowledgeBase
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (baseId: string) => void
}

const EditKnowledgeBaseDialog: FC<EditKnowledgeBaseDialogProps> = ({ base: baseV2, open, onOpenChange, onSuccess }) => {
  const { t } = useTranslation()
  const { preprocessProviders } = usePreprocessProviders()
  const base = useMemo(() => mapKnowledgeBaseV2ToV1(baseV2, preprocessProviders), [baseV2, preprocessProviders])

  const [currentHasCriticalChanges, setCurrentHasCriticalChanges] = useState(false)

  const { submit, loading, hasCriticalChanges } = useUpdateKnowledgeBase({
    originalBase: base,
    onSuccess: (id) => {
      onOpenChange(false)
      onSuccess?.(id)
    }
  })

  const handleSubmit = async (newBase: Parameters<typeof submit>[0]) => {
    setCurrentHasCriticalChanges(hasCriticalChanges(newBase))
    await submit(newBase)
  }

  return (
    <KnowledgeBaseFormContainer
      title={t('knowledge.settings.title')}
      initialBase={base}
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={handleSubmit}
      loading={loading}
      okText={currentHasCriticalChanges ? t('knowledge.migrate.button.text') : t('common.save')}
    />
  )
}

export default EditKnowledgeBaseDialog
