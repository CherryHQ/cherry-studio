import type { KnowledgeBase } from '@renderer/types'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgeBaseForm } from '../../hooks/useKnowledgeBaseForm'
import AdvancedSettingsPanel from './AdvancedSettingsPanel'
import GeneralSettingsPanel from './GeneralSettingsPanel'
import KnowledgeBaseFormModal, { type PanelConfig } from './KnowledgeBaseFormModal'

interface KnowledgeBaseFormContainerProps {
  title: string
  initialBase?: KnowledgeBase
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (base: KnowledgeBase) => Promise<void>
  loading?: boolean
  okText?: string
}

/**
 * Core form container for knowledge base creation and editing
 *
 * Manages form state via useKnowledgeBaseForm and renders the modal with panels.
 */
const KnowledgeBaseFormContainer: FC<KnowledgeBaseFormContainerProps> = ({
  title,
  initialBase,
  open,
  onOpenChange,
  onSubmit,
  loading,
  okText
}) => {
  const { t } = useTranslation()
  const {
    newBase,
    setNewBase,
    handlers,
    providerData: { selectedDocPreprocessProvider, docPreprocessSelectOptions }
  } = useKnowledgeBaseForm(initialBase)

  const panelConfigs: PanelConfig[] = [
    {
      key: 'general',
      label: t('settings.general.label'),
      panel: <GeneralSettingsPanel newBase={newBase} setNewBase={setNewBase} handlers={handlers} />
    },
    {
      key: 'advanced',
      label: t('settings.advanced.title'),
      panel: (
        <AdvancedSettingsPanel
          newBase={newBase}
          selectedDocPreprocessProvider={selectedDocPreprocessProvider}
          docPreprocessSelectOptions={docPreprocessSelectOptions}
          handlers={handlers}
        />
      )
    }
  ]

  const handleOk = async () => {
    await onSubmit(newBase)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <KnowledgeBaseFormModal
      title={title}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      panels={panelConfigs}
      confirmLoading={loading}
      okText={okText}
    />
  )
}

export default KnowledgeBaseFormContainer
