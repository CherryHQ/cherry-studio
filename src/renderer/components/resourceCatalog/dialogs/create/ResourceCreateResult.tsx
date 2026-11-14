import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button, EmojiAvatar } from '@cherrystudio/ui'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { useModelById } from '@renderer/hooks/useModel'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { permissionModeCards } from '@renderer/utils/agent'
import { platform } from '@renderer/utils/platform'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { CLAUDE_KNOWLEDGE_TOOL_NAMES } from '@shared/ai/claudecode/toolRegistry'

import type { ResourceCreateWizardFormValues, ResourceCreateWizardKind, ResourceCreateWizardValues } from './types'

export type CreatedResource = {
  id: string
  values: ResourceCreateWizardValues
  /** The configuration came from auto create rather than the manual steps. */
  generated: boolean
}

function ResultAvatar({ avatar, name, description }: { avatar: string; name: string; description?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <EmojiAvatar
        size={84}
        fontSize={42}
        className="shrink-0 cursor-default rounded-[28%] border border-border hover:opacity-100">
        {avatar}
      </EmojiAvatar>
      <div className="mt-1 max-w-full truncate font-semibold text-foreground text-lg leading-tight">{name}</div>
      {description ? <div className="max-w-full text-[13px] text-muted-foreground">{description}</div> : null}
    </div>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 py-1">
      <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] text-foreground">{children}</span>
    </div>
  )
}

/** Shown while auto create generates and saves; one spinner per item, since all are configured at once. */
export function ResourceCreateWorkingView({
  kind,
  form
}: {
  kind: ResourceCreateWizardKind
  form: UseFormReturn<ResourceCreateWizardFormValues>
}) {
  const { t } = useTranslation()
  const [avatar, name, purpose] = useWatch({ control: form.control, name: ['avatar', 'name', 'description'] })
  const isAgent = kind === 'agent'
  const items = [
    t('library.config.dialogs.create.result.working.prompt'),
    t('library.config.dialogs.create.result.working.tools'),
    ...(isAgent ? [t('library.config.dialogs.create.result.working.skills')] : [])
  ]
  const fallbackName = isAgent
    ? t('library.config.dialogs.create.result.agent_fallback_name')
    : t('library.config.dialogs.create.result.assistant_fallback_name')

  return (
    <div className="flex flex-col gap-5 px-6 pt-6 pb-5">
      <ResultAvatar avatar={avatar} name={name.trim() || fallbackName} description={purpose.trim()} />
      <div className="rounded-xl border border-border-subtle px-3.5 py-2">
        {items.map((item) => (
          <div key={item} className="flex min-h-8 items-center gap-2.5 text-[13px] text-foreground">
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Summary of what was just created. Owns the catalog lookups so resolving names never
 * re-renders the dialog shell.
 */
export function ResourceCreateResultView({
  kind,
  created,
  onAdjust,
  onStart
}: {
  kind: ResourceCreateWizardKind
  created: CreatedResource
  onAdjust: () => void
  onStart: () => void
}) {
  const { t } = useTranslation()
  const { values, generated } = created
  const isAgent = kind === 'agent'
  const { model } = useModelById(values.modelId)
  const { skills } = useInstalledSkills(undefined, { enabled: isAgent })
  const { bases } = useKnowledgeBases()
  const { mcpServers } = useMcpServers()

  const namesOf = (items: readonly { id: string; name: string }[], ids: readonly string[], empty: string) => {
    const selected = new Set(ids)
    const names = items.filter((item) => selected.has(item.id)).map((item) => item.name)
    // Intl.ListFormat adds "and"/"和" before the last item, which reads wrong for a name list.
    return names.length > 0 ? names.join(t('library.config.dialogs.create.result.list_separator')) : empty
  }
  const notAdded = t('library.config.dialogs.create.result.empty.not_added')

  const promptState = !values.prompt
    ? t('library.config.dialogs.create.result.prompt_empty')
    : generated
      ? t('library.config.dialogs.create.result.prompt_generated')
      : t('library.config.dialogs.create.result.prompt_filled')
  const permissionCard = permissionModeCards.find((card) => card.mode === values.permissionMode)
  // Matches the edit dialog: knowledge tools only count once a knowledge base is bound.
  const builtinToolCount = AGENT_RUNTIME_CAPABILITIES[values.agentType]
    .builtinTools(platform)
    .filter((tool) => values.knowledgeBaseIds.length > 0 || !CLAUDE_KNOWLEDGE_TOOL_NAMES.has(tool.id)).length
  // Builtin skills are always enabled for a new Agent, whatever was picked.
  const skillIds = [
    ...skills.filter((skill) => skill.source === 'builtin').map((skill) => skill.id),
    ...values.skillIds
  ]

  return (
    <>
      <div className="flex flex-col gap-5 px-6 pt-6 pb-5">
        <ResultAvatar avatar={values.avatar} name={values.name} description={values.description} />
        <div className="rounded-xl border border-border-subtle px-3.5 py-1.5">
          <SummaryRow label={t('library.config.prompt.label')}>{promptState}</SummaryRow>
          <SummaryRow label={t('common.model')}>{model?.name ?? values.modelId}</SummaryRow>
          {isAgent && permissionCard ? (
            <SummaryRow label={t('library.config.agent.section.permission.title')}>
              {t(permissionCard.titleKey, permissionCard.titleFallback)}
            </SummaryRow>
          ) : null}
          <SummaryRow label={t('library.config.agent.section.tools.tab.tools')}>
            {isAgent
              ? t('library.config.dialogs.create.result.tools_enabled', {
                  enabled: builtinToolCount,
                  total: builtinToolCount
                })
              : values.enableWebSearch
                ? t('library.config.dialogs.create.result.web_search')
                : t('library.config.dialogs.create.result.empty.not_enabled')}
          </SummaryRow>
          {isAgent ? (
            <SummaryRow label={t('library.config.agent.section.tools.tab.skills')}>
              {namesOf(skills, skillIds, notAdded)}
            </SummaryRow>
          ) : null}
          <SummaryRow label={t('library.config.agent.section.tools.tab.mcp')}>
            {namesOf(
              mcpServers,
              values.mcpServerIds ?? [],
              isAgent ? t('library.config.dialogs.create.result.empty.not_bound') : notAdded
            )}
          </SummaryRow>
          <SummaryRow label={t('library.config.dialogs.create.step.knowledge')}>
            {namesOf(bases, values.knowledgeBaseIds, t('library.config.dialogs.create.result.empty.not_linked'))}
          </SummaryRow>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 px-6 pb-5">
        <Button type="button" variant="outline" onClick={onAdjust}>
          {t('library.config.dialogs.create.result.adjust')}
        </Button>
        <Button type="button" variant="emphasis" onClick={onStart}>
          {t('library.config.dialogs.create.result.start')}
        </Button>
      </div>
    </>
  )
}
