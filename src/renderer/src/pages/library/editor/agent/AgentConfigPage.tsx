import { useAgentTools } from '@renderer/hooks/agents/useAgentTools'
import type { AgentDetail } from '@shared/data/types/agent'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutations, useAgentMutationsById } from '../../adapters/agentAdapter'
import { ConfigEditorShell } from '../ConfigEditorShell'
import { useResourceEditorState } from '../useResourceEditorState'
import {
  AGENT_CONFIG_SECTIONS,
  type AgentConfigSection,
  type AgentFormState,
  type AgentSaveIntent,
  applyAgentFormPatch,
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

// Stub used by the Tools tab in create mode so `agent.id` reads are safe.
// Skills still require a persisted agent id; tool and MCP draft changes are
// saved with the create payload.
const EMPTY_AGENT_FOR_CREATE: AgentDetail = {
  id: '',
  type: 'claude-code',
  name: '',
  accessiblePaths: [],
  model: '',
  modelName: null,
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

  const [currentAgent, setCurrentAgent] = useState<AgentDetail | undefined>(undefined)
  const [activeSection, setActiveSection] = useState<AgentConfigSection>('basic')

  const editAgent = currentAgent && agent && currentAgent.id === agent.id ? currentAgent : agent

  const { createAgent } = useAgentMutations()
  // Safe empty-string id in create mode — `useMutation` builds the path at
  // call-time and we only invoke the edit mutations in edit mode.
  const { updateAgent } = useAgentMutationsById(editAgent?.id ?? '')

  const initialForm = useMemo(() => buildInitialAgentFormState(editAgent), [editAgent])

  const { form, setForm, canSave, saving, saved, error, handleSave } = useResourceEditorState<
    AgentFormState,
    AgentSaveIntent
  >({
    initialForm,
    baselineKey: agent?.id ?? null,
    diff: (nextForm, baseline) => diffAgentSaveIntent(nextForm, baseline, editAgent ?? null),
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
      setCurrentAgent(updated)
      const next = buildInitialAgentFormState(updated)
      return { nextBaseline: next, nextForm: next }
    },
    fallbackErrorMessage: t('library.config.save_failed')
  })
  const { tools } = useAgentTools(editAgent?.type ?? 'claude-code', form.mcps)
  const onChange = useCallback(
    (patch: Partial<AgentFormState>) => {
      if (patch.soulEnabled === true && activeSection === 'permission') {
        setActiveSection('basic')
      }
      setForm((prev) => applyAgentFormPatch(prev, patch, tools))
    },
    [activeSection, setForm, tools]
  )
  const visibleSections = useMemo(
    () => AGENT_CONFIG_SECTIONS.filter((section) => !form.soulEnabled || section.id !== 'permission'),
    [form.soulEnabled]
  )

  const title = isCreate
    ? form.name.trim() || t('library.config.agent.create_title')
    : form.name || editAgent?.name || editAgent?.id || ''
  const requiredFieldMessage = t('common.required_field')
  const createValidation = isCreate ? validateAgentCreateForm(form) : null

  return (
    <ConfigEditorShell<AgentConfigSection>
      title={title}
      sections={visibleSections}
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
      {activeSection === 'permission' && !form.soulEnabled && <PermissionSection form={form} onChange={onChange} />}
      {activeSection === 'tools' && (
        <ToolsSection agent={editAgent ?? EMPTY_AGENT_FOR_CREATE} tools={tools} form={form} onChange={onChange} />
      )}
      {activeSection === 'advanced' && <AdvancedSection form={form} onChange={onChange} />}
    </ConfigEditorShell>
  )
}

export default AgentConfigPage

/**
 * Inline banner shown above the shell body while the agent doesn't yet exist
 * server-side: skills cannot be enabled until an agent id has been assigned.
 */
function CreateAgentBanner() {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-2 border-border/40 border-b bg-accent/20 px-5 py-2 text-muted-foreground/70 text-xs">
      <span>{t('library.config.agent.section.tools.skills_require_save')}</span>
    </div>
  )
}
