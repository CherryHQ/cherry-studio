import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceDeleteConfirmDialog } from '@renderer/components/resourceCatalog/dialogs/delete'
import { PromptEditDialogHost } from '@renderer/components/resourceCatalog/dialogs/edit'
import { dataApiService } from '@renderer/data/DataApiService'
import { resolveTemplate } from '@renderer/data/utils/dataApiPath'
import { useAssistantMutations, usePromptMutations } from '@renderer/hooks/resourceCatalog'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { serializeAssistantForExport } from '@renderer/utils/assistantTransfer'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import type { ConcreteApiPaths } from '@shared/data/api/paths'
import type { Prompt } from '@shared/data/types/prompt'

import { ResourceCardMenu } from './ResourceCardMenu'
import type { SkillLibraryTagManager } from './useSkillLibraryTags'

export type LibraryItem = Extract<ResourceItem, { type: 'assistant' | 'prompt' | 'agent' }>

export function LibraryResourceMenu({ resource, manager }: { resource: LibraryItem; manager: SkillLibraryTagManager }) {
  const { t } = useTranslation()
  const { duplicateAssistant } = useAssistantMutations()
  const { duplicatePrompt } = usePromptMutations()
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const resourceKey = `${resource.type}:${resource.id}`
  return (
    <>
      <ResourceCardMenu
        name={resource.name}
        resourceKey={resourceKey}
        manager={manager}
        onEdit={resource.type === 'prompt' ? () => setEditingPrompt(resource.raw) : undefined}
        onDelete={
          resource.type === 'agent' && isProtectedBuiltinAgentRole(resource.raw.configuration?.builtin_role)
            ? undefined
            : () => setConfirmOpen(true)
        }
        onDuplicate={
          resource.type === 'assistant'
            ? async () => {
                const copy = await duplicateAssistant(resource.raw)
                await manager.copy(resourceKey, `assistant:${copy.id}`)
              }
            : resource.type === 'prompt'
              ? async () => {
                  const copy = await duplicatePrompt(resource.raw)
                  await manager.copy(resourceKey, `prompt:${copy.id}`)
                }
              : undefined
        }
        onExport={
          resource.type === 'assistant'
            ? async () => {
                const assistant = await dataApiService.get(`/assistants/${resource.id}`)
                const bindingPath = resolveTemplate('/prompt-bindings/:targetType/:targetId', {
                  targetType: 'assistant',
                  targetId: assistant.id
                }) as ConcreteApiPaths
                const [prompts, group] = await Promise.all([
                  dataApiService.get(bindingPath),
                  assistant.groupId ? dataApiService.get(`/groups/${assistant.groupId}`) : undefined
                ])
                const content = serializeAssistantForExport(assistant, prompts, group?.name)
                await window.api.file.save(`${assistant.name}.json`, new TextEncoder().encode(content), {
                  filters: [{ name: t('assistants.presets.import.file_filter'), extensions: ['json'] }]
                })
              }
            : undefined
        }
      />
      {confirmOpen ? <ResourceDeleteConfirmDialog resource={resource} onClose={() => setConfirmOpen(false)} /> : null}
      {editingPrompt ? (
        <PromptEditDialogHost open prompt={editingPrompt} onClose={() => setEditingPrompt(null)} />
      ) : null}
    </>
  )
}
