import type { AgentDetail } from '@shared/data/types/agent'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutations, useAgentMutationsById } from '../../adapters/agentAdapter'
import { ConfigEditorShell } from '../ConfigEditorShell'
import { useResourceEditorState } from '../useResourceEditorState'
import {
  AGENT_CONFIG_SECTIONS,
  type AgentConfigSection,
  type AgentFormState,
  type AgentSaveIntent,
  buildInitialAgentFormState,
  diffAgentSaveIntent,
  validateAgentCreateForm
} from './descriptor'
import AdvancedSection from './sections/AdvancedSection'
import BasicSection from './sections/BasicSection'
import PermissionSection from './sections/PermissionSection'
import PromptSection from './sections/PromptSection'
import ToolsSection from './sections/ToolsSection'

interface Props {
  /**
   * `undefined` puts the page in **create mode**: the agent row is not
   * POSTed until the user clicks 保存. Pass an `AgentDetail` for **edit
   * mode** — saves PATCH the existing row.
   */
  agent?: AgentDetail
  onBack: () => void
  /**
   * Called once the create flow lands a new agent on the server so the
   * parent can return to list mode and refetch the latest collection.
   */
  onCreated?: (created: AgentDetail) => void
}

// Stub used by the Tools tab in create mode so `agent.tools` / `agent.id`
// reads are safe. The tab renders empty-state copy until the agent exists
// server-side (see `ToolsSection` comments).
const EMPTY_AGENT_FOR_CREATE: AgentDetail = {
  id: '',
  type: 'claude-code',
  name: '',
  accessiblePaths: [],
  model: '',
  createdAt: '',
  updatedAt: '',
  tools: []
}

/**
 * Agent editor — same shell in both create and edit flows.
 *
 * - **Create** (library "+ Agent" → this page with `agent` undefined):
 *   form starts empty, Save POSTs a `CreateAgentDto` built by the
 *   descriptor, then fires `onCreated` so the parent can return to the
 *   list and fetch the canonical row set.
 * - **Edit** (`agent` present): Save PATCHes only the field diff.
 *   `configuration` sub-keys are merged onto the existing
 *   configuration rather than replacing it.
 *
 * Both flows share the generic `useResourceEditorState` hook + the
 * shared `ConfigEditorShell`; the create-vs-update branch lives in
 * `onCommit` and the `AgentSaveIntent` discriminant returned by
 * `diffAgentSaveIntent`.
 */
const AgentConfigPage: FC<Props> = ({ agent, onBack, onCreated }) => {
  const { t } = useTranslation()
  const isCreate = !agent

  const [activeSection, setActiveSection] = useState<AgentConfigSection>('basic')

  const { createAgent } = useAgentMutations()
  // Safe empty-string id in create mode — `useMutation` builds the path at
  // call-time and we only invoke the edit mutations in edit mode.
  const { updateAgent } = useAgentMutationsById(agent?.id ?? '')

  const initialForm = useMemo(() => buildInitialAgentFormState(agent), [agent])

  const { form, onChange, canSave, saving, saved, error, handleSave } = useResourceEditorState<
    AgentFormState,
    AgentSaveIntent
  >({
    initialForm,
    baselineKey: agent?.id ?? null,
    diff: (nextForm, baseline) => diffAgentSaveIntent(nextForm, baseline, agent ?? null),
    onCommit: async (intent) => {
      if (intent.kind === 'create') {
        const created = await createAgent(intent.payload)
        onCreated?.(created)
        // Even though the page returns to the list right after create, keep
        // the canonical row here so the save state machine completes against
        // backend-normalized data before the parent unmounts this editor.
        const next = buildInitialAgentFormState(created)
        return { nextBaseline: next, nextForm: next }
      }
      const updated = await updateAgent(intent.payload)
      const next = buildInitialAgentFormState(updated)
      return { nextBaseline: next, nextForm: next }
    },
    fallbackErrorMessage: t('library.config.save_failed')
  })

  const title = isCreate
    ? form.name.trim() || t('library.config.agent.create_title')
    : form.name || agent?.name || agent?.id || ''
  const requiredFieldMessage = t('common.required_field')
  const createValidation = isCreate ? validateAgentCreateForm(form) : null

  return (
    <ConfigEditorShell<AgentConfigSection>
      title={title}
      sections={AGENT_CONFIG_SECTIONS}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      canSave={canSave}
      saving={saving}
      saved={saved}
      error={error}
      onSave={handleSave}
      onBack={onBack}
      topBanner={isCreate ? <CreateAgentBanner /> : undefined}>
      {activeSection === 'basic' && (
        <BasicSection
          form={form}
          onChange={onChange}
          nameError={createValidation?.nameMissing ? requiredFieldMessage : undefined}
          modelError={createValidation?.modelMissing ? requiredFieldMessage : undefined}
        />
      )}
      {activeSection === 'prompt' && <PromptSection form={form} onChange={onChange} />}
      {activeSection === 'permission' && <PermissionSection form={form} onChange={onChange} />}
      {activeSection === 'tools' && (
        <ToolsSection agent={agent ?? EMPTY_AGENT_FOR_CREATE} form={form} onChange={onChange} />
      )}
      {activeSection === 'advanced' && <AdvancedSection form={form} onChange={onChange} />}
    </ConfigEditorShell>
  )
}

export default AgentConfigPage

/**
 * Inline banner shown above the shell body while the agent doesn't yet
 * exist server-side: the Tools tab can't bind MCP servers / tools
 * against an id that hasn't been assigned. The banner only appears
 * during the pre-save draft session.
 */
function CreateAgentBanner() {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-2 border-border/10 border-b bg-accent/20 px-5 py-2 text-[10px] text-muted-foreground/70">
      <span>{t('library.config.agent.create_banner')}</span>
    </div>
  )
}
