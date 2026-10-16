import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceCreateWizard } from '@renderer/components/resourceCatalog/dialogs/create'
import { AssistantCreateDialog, PromptEditDialog } from '@renderer/components/resourceCatalog/dialogs/edit'
import { useAgentMutations, useAssistantMutations, usePromptMutations } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { buildCreateAgentCommand } from '@renderer/utils/resourceCatalog'
import { isNonChatModel } from '@shared/utils/model'

export type LibraryResourceKind = 'prompt' | 'assistant' | 'agent'

export default function LibraryCreateDialog({
  kind,
  onClose,
  onCreated
}: {
  kind: LibraryResourceKind
  onClose: () => void
  onCreated: (kind: LibraryResourceKind) => void
}) {
  const { t } = useTranslation()
  const { createPrompt } = usePromptMutations()
  const { createAssistant } = useAssistantMutations()
  const { createAgent } = useAgentMutations()
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  const close = () => {
    if (!pending.current) onClose()
  }
  const save = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    try {
      await action()
      onCreated(kind)
    } catch (error) {
      if (kind === 'prompt') toast.error(formatErrorMessageWithPrefix(error, t('settings.prompts.errors.createFailed')))
      throw error
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return kind === 'agent' ? (
    <ResourceCreateWizard
      kind="agent"
      open
      isSubmitting={saving}
      onOpenChange={(open) => !open && close()}
      onSubmit={(values) => save(() => createAgent(buildCreateAgentCommand(values)))}
    />
  ) : kind === 'prompt' ? (
    <PromptEditDialog open saving={saving} onCancel={close} onSave={(values) => save(() => createPrompt(values))} />
  ) : (
    <AssistantCreateDialog
      open
      isSubmitting={saving}
      modelFilter={(model) => !isNonChatModel(model)}
      onOpenChange={(open) => !open && close()}
      onCreate={(values) => save(() => createAssistant(values))}
    />
  )
}
