import type { Assistant } from '@shared/data/types/assistant'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistantMutations, useAssistantMutationsById } from '../../adapters/assistantAdapter'
import { useEnsureTags, useTagList } from '../../adapters/tagAdapter'
import { ConfigEditorShell } from '../ConfigEditorShell'
import { useResourceEditorState } from '../useResourceEditorState'
import {
  ASSISTANT_CONFIG_SECTIONS,
  type AssistantConfigSection,
  type AssistantFormState,
  type AssistantSaveIntent,
  buildCreateAssistantFormState,
  diffAssistantSaveIntent,
  initialAssistantFormState,
  validateAssistantCreateForm
} from './descriptor'
import { BasicSection } from './sections/BasicSection'
import KnowledgeSection from './sections/KnowledgeSection'
import PromptSection from './sections/PromptSection'
import ToolsSection from './sections/ToolsSection'

interface Props {
  /**
   * `undefined` puts the page in create mode: the assistant row is only
   * POSTed when the user clicks 保存 after filling the required fields.
   */
  assistant?: Assistant
  onBack: () => void
  /** Fired after the initial POST so the parent can return to list + refetch. */
  onCreated?: (created: Assistant) => void
}

/**
 * Assistant editor — shared shell for create and edit.
 *
 * - Create mode (`assistant` omitted): open an empty form first, require
 *   name + prompt before Save enables, then POST on Save.
 * - Edit mode (`assistant` present): Save PATCHes the existing row.
 *
 * Both flows share the same top-bar shell + form state; branching lives in
 * the `AssistantSaveIntent` returned by `diffAssistantSaveIntent`.
 */
const AssistantConfigPage: FC<Props> = ({ assistant, onBack, onCreated }) => {
  const { t } = useTranslation()
  const isCreate = !assistant
  const [activeSection, setActiveSection] = useState<AssistantConfigSection>('basic')

  const { createAssistant } = useAssistantMutations()
  const { updateAssistant } = useAssistantMutationsById(assistant?.id ?? '')
  const { ensureTags } = useEnsureTags()
  const tagList = useTagList()
  const tagColorByName = useMemo(
    () => new Map(tagList.tags.map((tag) => [tag.name, tag.color ?? ''] as const).filter(([, color]) => color !== '')),
    [tagList.tags]
  )
  const allTagNames = useMemo(() => tagList.tags.map((tag) => tag.name), [tagList.tags])

  const initialForm = useMemo(
    () => (assistant ? initialAssistantFormState(assistant) : buildCreateAssistantFormState()),
    [assistant]
  )

  const { form, onChange, canSave, saving, saved, error, handleSave } = useResourceEditorState<
    AssistantFormState,
    AssistantSaveIntent
  >({
    initialForm,
    baselineKey: assistant?.id ?? null,
    diff: (nextForm, baseline) => diffAssistantSaveIntent(nextForm, baseline, assistant ?? null),
    onCommit: async (intent) => {
      if (intent.kind === 'create') {
        const tagIds = intent.tagNames.length > 0 ? (await ensureTags(intent.tagNames)).map((tag) => tag.id) : undefined
        const created = await createAssistant({
          ...intent.payload,
          ...(tagIds !== undefined ? { tagIds } : {})
        })
        onCreated?.(created)
        const next = initialAssistantFormState(created)
        return { nextBaseline: next, nextForm: next }
      }

      const tagIds = intent.tagsChanged ? (await ensureTags(intent.tagNames)).map((tag) => tag.id) : undefined
      const updated = await updateAssistant({
        ...intent.payload,
        ...(tagIds !== undefined ? { tagIds } : {})
      })
      const next = initialAssistantFormState(updated)
      return { nextBaseline: next, nextForm: next }
    },
    fallbackErrorMessage: t('library.config.save_failed')
  })

  const title = isCreate
    ? form.name.trim() || t('library.type.new_assistant')
    : form.name.trim() || assistant?.name || ''
  const requiredFieldMessage = t('common.required_field')
  const createValidation = isCreate ? validateAssistantCreateForm(form) : null

  return (
    <ConfigEditorShell<AssistantConfigSection>
      title={title}
      sections={ASSISTANT_CONFIG_SECTIONS}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      contentWidth="wide"
      canSave={canSave}
      saving={saving}
      saved={saved}
      error={error}
      onSave={handleSave}
      onBack={onBack}>
      {activeSection === 'basic' && (
        <>
          <BasicSection
            assistant={assistant}
            form={form}
            onChange={onChange}
            nameError={createValidation?.nameMissing ? requiredFieldMessage : undefined}
            tagColorByName={tagColorByName}
            allTagNames={allTagNames}
          />
          <PromptSection
            assistant={assistant}
            assistantName={form.name}
            prompt={form.prompt}
            promptError={createValidation?.promptMissing ? requiredFieldMessage : undefined}
            hideHeader
            onChange={(prompt) => onChange({ prompt })}
          />
        </>
      )}
      {activeSection === 'prompt' && (
        <BasicSection
          assistant={assistant}
          form={form}
          onChange={onChange}
          mode="optional"
          tagColorByName={tagColorByName}
          allTagNames={allTagNames}
        />
      )}
      {activeSection === 'knowledge' && (
        <KnowledgeSection
          value={form.knowledgeBaseIds}
          onChange={(knowledgeBaseIds) => onChange({ knowledgeBaseIds })}
        />
      )}
      {activeSection === 'tools' && (
        <ToolsSection
          mcpMode={form.mcpMode}
          mcpServerIds={form.mcpServerIds}
          onModeChange={(mcpMode) => onChange({ mcpMode })}
          onServerIdsChange={(mcpServerIds) => onChange({ mcpServerIds })}
        />
      )}
    </ConfigEditorShell>
  )
}

export default AssistantConfigPage
