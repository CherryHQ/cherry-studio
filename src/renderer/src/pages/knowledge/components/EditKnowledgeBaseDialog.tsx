import { useKnowledgeBase } from '@renderer/data/hooks/useKnowledges'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useUpdateKnowledgeBase } from '../hooks/useUpdateKnowledgeBase'
import { mapKnowledgeBaseV2ToV1 } from '../utils/knowledgeBaseAdapter'
import { KnowledgeBaseFormContainer, KnowledgeBaseFormModal } from './KnowledgeSettings'

interface EditKnowledgeBaseDialogProps {
  baseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (baseId: string) => void
}

const EditKnowledgeBaseDialog: FC<EditKnowledgeBaseDialogProps> = ({ baseId, open, onOpenChange, onSuccess }) => {
  const { t } = useTranslation()
  const { preprocessProviders } = usePreprocessProviders()
  const { base: baseV2 } = useKnowledgeBase(baseId, { enabled: !!baseId && open })
  const base = useMemo(
    () => (baseV2 ? mapKnowledgeBaseV2ToV1(baseV2, preprocessProviders) : undefined),
    [baseV2, preprocessProviders]
  )

  const [currentHasCriticalChanges, setCurrentHasCriticalChanges] = useState(false)

  const { submit, loading, hasCriticalChanges } = useUpdateKnowledgeBase({
    originalBase: base,
    onSuccess: (id) => {
      onOpenChange(false)
      onSuccess?.(id)
    }
  })

  // Loading state when base is not yet loaded
  if (!base) {
    return (
      <KnowledgeBaseFormModal
        title={t('knowledge.settings.title')}
        open={open}
        onOk={() => onOpenChange(false)}
        onCancel={() => onOpenChange(false)}
        panels={[
          {
            key: 'general',
            label: t('common.loading'),
            panel: <div style={{ padding: 16 }}>{t('common.loading')}</div>
          }
        ]}
        confirmLoading={true}
      />
    )
  }

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
