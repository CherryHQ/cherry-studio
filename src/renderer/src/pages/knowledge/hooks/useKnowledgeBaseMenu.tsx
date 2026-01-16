import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { MenuProps } from 'antd'
import { Settings } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface UseKnowledgeBaseMenuArgs {
  renameKnowledgeBase: (baseId: string, name: string) => void
  deleteKnowledgeBase: (baseId: string) => Promise<void>
  onOpenSettings: (baseId: string) => void
  onSelectBase: (baseId?: string) => void
}

export const useKnowledgeBaseMenu = ({
  renameKnowledgeBase,
  deleteKnowledgeBase,
  onOpenSettings,
  onSelectBase
}: UseKnowledgeBaseMenuArgs) => {
  const { t } = useTranslation()
  const { assistants, updateAssistants } = useAssistants()
  const { presets, setAssistantPresets } = useAssistantPresets()

  const getMenuItems = useCallback(
    (base: KnowledgeBase): MenuProps['items'] => {
      const menus: MenuProps['items'] = [
        {
          label: t('knowledge.rename'),
          key: 'rename',
          icon: <EditIcon size={14} />,
          async onClick() {
            const name = await PromptPopup.show({
              title: t('knowledge.rename'),
              message: '',
              defaultValue: base.name || ''
            })
            if (name && base.name !== name) {
              renameKnowledgeBase(base.id, name)
            }
          }
        },
        {
          label: t('common.settings'),
          key: 'settings',
          icon: <Settings size={14} />,
          onClick: () => onOpenSettings(base.id)
        },
        { type: 'divider' },
        {
          label: t('common.delete'),
          danger: true,
          key: 'delete',
          icon: <DeleteIcon size={14} className="lucide-custom" />,
          onClick: () => {
            window.modal.confirm({
              title: t('knowledge.delete_confirm'),
              centered: true,
              onOk: async () => {
                onSelectBase(undefined)
                await deleteKnowledgeBase(base.id)

                // Clean up assistant references
                const updatedAssistants = assistants.map((assistant) => ({
                  ...assistant,
                  knowledge_bases: assistant.knowledge_bases?.filter((kb) => kb.id !== base.id)
                }))
                updateAssistants(updatedAssistants)

                // Clean up preset references
                const updatedPresets = presets.map((preset) => ({
                  ...preset,
                  knowledge_bases: preset.knowledge_bases?.filter((kb) => kb.id !== base.id)
                }))
                setAssistantPresets(updatedPresets)
              }
            })
          }
        }
      ]

      return menus
    },
    [
      assistants,
      deleteKnowledgeBase,
      onOpenSettings,
      onSelectBase,
      presets,
      renameKnowledgeBase,
      setAssistantPresets,
      t,
      updateAssistants
    ]
  )

  return { getMenuItems }
}
