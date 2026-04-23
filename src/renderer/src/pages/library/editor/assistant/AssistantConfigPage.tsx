import type { Assistant } from '@shared/data/types/assistant'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistantMutationsById } from '../../adapters/assistantAdapter'
import { useEnsureTags, useTagList } from '../../adapters/tagAdapter'
import { ConfigEditorShell } from '../ConfigEditorShell'
import { useResourceEditorState } from '../useResourceEditorState'
import {
  ASSISTANT_CONFIG_SECTIONS,
  type AssistantConfigSection,
  type AssistantDiffResult,
  type AssistantFormState,
  diffAssistantUpdate,
  initialAssistantFormState
} from './descriptor'
import { BasicSection } from './sections/BasicSection'
import KnowledgeSection from './sections/KnowledgeSection'
import PromptSection from './sections/PromptSection'
import ToolsSection from './sections/ToolsSection'

interface Props {
  assistant: Assistant
  onBack: () => void
}

/**
 * Assistant editor.
 *
 * Creation is handled by LibraryPage (POST /assistants on click) so
 * this page always operates against an existing row. Form state lives
 * on `AssistantFormState` and is shared across all four sections —
 * Basic / Prompt / Knowledge / Tools edit different slices of the same
 * object so 保存 lands in a single PATCH; 取消 discards the in-memory
 * state.
 *
 * Save flow:
 *   1. `diffAssistantUpdate` produces the minimal PATCH body + a
 *      `tagsChanged` flag.
 *   2. If tags changed, resolve typed names → ids via `ensureTags`
 *      (POSTs any missing tags).
 *   3. PATCH /assistants/:id with the diff + `tagIds`. The backend
 *      syncs `entity_tag` inside the same transaction as the
 *      assistant-row update — atomic by construction.
 */
const AssistantConfigPage: FC<Props> = ({ assistant, onBack }) => {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState<AssistantConfigSection>('basic')

  const { updateAssistant } = useAssistantMutationsById(assistant.id)
  const { ensureTags } = useEnsureTags()
  const tagList = useTagList()
  const tagColorByName = useMemo(
    () => new Map(tagList.tags.map((tag) => [tag.name, tag.color ?? ''] as const).filter(([, color]) => color !== '')),
    [tagList.tags]
  )
  const allTagNames = useMemo(() => tagList.tags.map((tag) => tag.name), [tagList.tags])

  const initialForm = useMemo(() => initialAssistantFormState(assistant), [assistant])

  const { form, onChange, canSave, saving, saved, error, handleSave } = useResourceEditorState<
    AssistantFormState,
    AssistantDiffResult
  >({
    initialForm,
    baselineKey: assistant.id,
    diff: (nextForm, baseline) => diffAssistantUpdate(nextForm, baseline, assistant),
    onCommit: async (diff) => {
      // Resolve any newly-typed tag names to ids BEFORE the PATCH so
      // the payload carries authoritative tag ids; the assistant PATCH
      // then binds them atomically with the assistant-row update.
      const tagIds = diff.tagsChanged ? (await ensureTags(diff.tagNames)).map((tag) => tag.id) : undefined
      await updateAssistant({
        ...diff.dto,
        ...(tagIds !== undefined ? { tagIds } : {})
      })
    },
    fallbackErrorMessage: t('library.config.save_failed')
  })

  return (
    <ConfigEditorShell<AssistantConfigSection>
      title={assistant.name}
      sections={ASSISTANT_CONFIG_SECTIONS}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      canSave={canSave}
      saving={saving}
      saved={saved}
      error={error}
      onSave={handleSave}
      onBack={onBack}>
      {activeSection === 'basic' && (
        <BasicSection
          assistant={assistant}
          form={form}
          onChange={onChange}
          tagColorByName={tagColorByName}
          allTagNames={allTagNames}
        />
      )}
      {activeSection === 'prompt' && (
        <PromptSection assistant={assistant} prompt={form.prompt} onChange={(prompt) => onChange({ prompt })} />
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
