import { Check } from 'lucide-react'
import { Fragment, type ReactNode, useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button, EmojiAvatar } from '@cherrystudio/ui'
import { AssistantAvatarImage } from '@renderer/components/Avatar/AssistantAvatarImage'
import { ChannelQrLoginDialog } from '@renderer/components/channel/ChannelQrLoginDialog'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import type { AutoConfigProgressView } from '@renderer/hooks/resourceCatalog'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useMcpServers } from '@renderer/hooks/useMcpServer'
import { useModelById } from '@renderer/hooks/useModel'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { permissionModeCards } from '@renderer/utils/agent'
import { platform } from '@renderer/utils/platform'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { CLAUDE_KNOWLEDGE_TOOL_NAMES } from '@shared/ai/claudecode/toolRegistry'
import { isQrLoginChannel } from '@shared/data/api/schemas/agentChannels'

import type { ResourceCreateWizardFormValues, ResourceCreateWizardKind, ResourceCreateWizardValues } from './types'

export type CreatedResource = {
  id: string
  values: ResourceCreateWizardValues
  /** The configuration came from auto create rather than the manual steps. */
  generated: boolean
  /** The uploaded avatar, once it was saved onto the resource. */
  avatarSrc?: string
}

function ResultAvatar({
  avatar,
  imageSrc,
  name,
  description,
  working = false
}: {
  avatar: string
  imageSrc?: string
  name: string
  description?: string
  working?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className={working ? 'animation-breathe' : undefined}>
        <AssistantAvatarImage
          src={imageSrc}
          alt={t('common.avatar')}
          size={84}
          className="shrink-0 rounded-[28%] border border-border object-cover"
          fallback={
            <EmojiAvatar
              size={84}
              fontSize={42}
              className="shrink-0 cursor-default rounded-[28%] border border-border hover:opacity-100">
              {avatar}
            </EmojiAvatar>
          }
        />
      </div>
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

/** The new Agent's channels, read back so a pending QR login can start from here. */
function ChannelsSummary({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const { channels } = useChannels({ agentId })
  const [loginId, setLoginId] = useState<string | null>(null)
  const login = channels.find((channel) => channel.id === loginId)

  if (channels.length === 0) return <>{t('library.config.dialogs.create.result.empty.not_connected')}</>
  return (
    <>
      {channels.map((channel, index) => {
        const pending = isQrLoginChannel(channel) && !channel.isActive
        return (
          <Fragment key={channel.id}>
            {index > 0 ? t('library.config.dialogs.create.result.list_separator') : null}
            {channel.name}
            {pending ? (
              <>
                <span className="ml-0.5">{t('library.config.dialogs.create.result.qr_pending')}</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="ml-1.5 h-auto p-0 text-[13px] underline shadow-none"
                  onClick={() => setLoginId(channel.id)}>
                  {t('library.config.dialogs.create.result.qr_login')}
                </Button>
              </>
            ) : null}
          </Fragment>
        )
      })}
      {login && (login.type === 'wechat' || login.type === 'feishu') ? (
        <ChannelQrLoginDialog
          key={login.id}
          channel={{ id: login.id, type: login.type }}
          onClose={() => setLoginId(null)}
        />
      ) : null}
    </>
  )
}

type WorkingStepState = 'active' | 'done'

function WorkingStep({
  state,
  label,
  aside,
  children
}: {
  state: WorkingStepState
  label: string
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="fade-in-0 slide-in-from-top-1 flex animate-in flex-col gap-1.5 py-0.5 duration-300 motion-reduce:animate-none">
      <div className="flex min-h-7 items-center gap-2.5 text-[13px]">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {state === 'done' ? (
            <Check
              aria-hidden="true"
              className="zoom-in-50 fade-in-0 size-3.5 animate-in text-success duration-200 motion-reduce:animate-none"
              strokeWidth={2.5}
            />
          ) : (
            <span
              aria-hidden="true"
              className="size-3.5 animate-spin rounded-full border-[1.5px] border-border border-t-foreground [animation-duration:0.9s] motion-reduce:animate-none"
            />
          )}
        </span>
        <span className={state === 'done' ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
        {aside ? <span className="ml-auto text-foreground-tertiary text-xs tabular-nums">{aside}</span> : null}
      </div>
      {children}
    </div>
  )
}

function WorkingPicks({ picks }: { picks: string[] }) {
  if (picks.length === 0) return null
  return (
    <div className="ml-[26px] flex flex-wrap gap-1">
      {picks.map((pick) => (
        <span
          key={pick}
          className="zoom-in-90 fade-in-0 animate-in rounded-md border border-border-subtle bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground leading-4 duration-200 motion-reduce:animate-none">
          {pick}
        </span>
      ))}
    </div>
  )
}

/**
 * Shown while auto create generates and saves. Each step appears once the one before it is written,
 * with what the model has produced so far: the prompt as it streams, then the picks as they arrive.
 */
export function ResourceCreateWorkingView({
  kind,
  form,
  progress
}: {
  kind: ResourceCreateWizardKind
  form: UseFormReturn<ResourceCreateWizardFormValues>
  /** `null` until the first streamed text arrives; a model that cannot stream stays there until done. */
  progress: AutoConfigProgressView | null
}) {
  const { t } = useTranslation()
  const [avatar, avatarImage, name, purpose] = useWatch({
    control: form.control,
    name: ['avatar', 'avatarImage', 'name', 'description']
  })
  const isAgent = kind === 'agent'
  const fallbackName = isAgent
    ? t('library.config.dialogs.create.result.agent_fallback_name')
    : t('library.config.dialogs.create.result.assistant_fallback_name')
  const prompt = progress?.prompt ?? ''
  const promptLines = prompt.split('\n').filter((line) => line.trim())
  const promptDone = progress?.promptDone ?? false
  const toolsDone = progress?.tools.done ?? false
  const skillsDone = progress?.skills.done ?? false
  const toolsLabel = isAgent
    ? toolsDone
      ? t('library.config.dialogs.create.result.working.tools_done')
      : t('library.config.dialogs.create.result.working.tools_active')
    : toolsDone
      ? t('library.config.dialogs.create.result.working.assistant_tools_done')
      : t('library.config.dialogs.create.result.working.assistant_tools_active')

  return (
    <div className="flex flex-col gap-5 px-6 pt-6 pb-5">
      <ResultAvatar
        avatar={avatar}
        imageSrc={avatarImage?.previewUrl}
        name={name.trim() || fallbackName}
        description={purpose.trim()}
        working
      />
      <div
        role="status"
        aria-label={t('library.config.dialogs.create.result.working_title')}
        className="flex flex-col gap-1 rounded-xl border border-border-subtle px-3.5 py-2.5">
        <WorkingStep
          state={promptDone ? 'done' : 'active'}
          label={
            promptDone
              ? t('library.config.dialogs.create.result.working.prompt_done')
              : t('library.config.dialogs.create.result.working.prompt_active')
          }
          aside={
            prompt
              ? t('library.config.dialogs.create.result.working.prompt_chars', { count: prompt.length })
              : undefined
          }>
          {!promptDone && promptLines.length > 0 ? (
            // The newest lines of the prompt as it is written; older ones scroll away above.
            <div className="mb-1 ml-[26px] flex h-15 flex-col justify-end overflow-hidden rounded-md bg-muted/50 px-2.5 py-1.5 text-muted-foreground text-xs leading-5">
              {promptLines.slice(-3).map((line, index) => (
                <div key={`${promptLines.length}-${index}`} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          ) : null}
        </WorkingStep>
        {promptDone ? (
          <WorkingStep state={toolsDone ? 'done' : 'active'} label={toolsLabel}>
            <WorkingPicks picks={progress?.tools.picks ?? []} />
          </WorkingStep>
        ) : null}
        {isAgent && toolsDone ? (
          <WorkingStep
            state={skillsDone ? 'done' : 'active'}
            label={
              skillsDone
                ? t('library.config.dialogs.create.result.working.skills_done')
                : t('library.config.dialogs.create.result.working.skills_active')
            }>
            <WorkingPicks picks={progress?.skills.picks ?? []} />
          </WorkingStep>
        ) : null}
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
  onStart,
  onClose
}: {
  kind: ResourceCreateWizardKind
  created: CreatedResource
  onAdjust: () => void
  /** Absent when the caller has no conversation to open; the page then offers Close. */
  onStart?: () => void
  onClose: () => void
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
  const caps = AGENT_RUNTIME_CAPABILITIES[values.agentType]
  // Matches the edit dialog: knowledge tools only count once a knowledge base is bound.
  const builtinTools = caps
    .builtinTools(platform)
    .filter((tool) => values.knowledgeBaseIds.length > 0 || !CLAUDE_KNOWLEDGE_TOOL_NAMES.has(tool.id))
  const disabledTools = new Set(values.disabledTools)
  const settings = values.agentSettings
  // Builtin skills are always enabled for a new Agent, whatever was picked.
  const skillIds = [
    ...skills.filter((skill) => skill.source === 'builtin').map((skill) => skill.id),
    ...values.skillIds
  ]

  return (
    <>
      <div className="flex flex-col gap-5 px-6 pt-6 pb-5">
        <ResultAvatar
          avatar={values.avatar}
          imageSrc={created.avatarSrc}
          name={values.name}
          description={values.description}
        />
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
                  enabled: builtinTools.filter((tool) => !disabledTools.has(tool.id)).length,
                  total: builtinTools.length
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
          {isAgent ? (
            <SummaryRow label={t('settings.channels.title')}>
              <ChannelsSummary agentId={created.id} />
            </SummaryRow>
          ) : null}
          {isAgent && caps.heartbeat ? (
            <SummaryRow label={t('library.config.agent.field.heartbeat_enabled.label')}>
              {settings?.heartbeatEnabled
                ? t('library.config.dialogs.create.result.heartbeat_every', { minutes: settings.heartbeatInterval })
                : t('library.config.dialogs.create.result.heartbeat_off')}
            </SummaryRow>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 px-6 pb-5">
        <Button type="button" variant="outline" onClick={onAdjust}>
          {t('library.config.dialogs.create.result.adjust')}
        </Button>
        <Button type="button" variant="emphasis" onClick={onStart ?? onClose}>
          {onStart ? t('library.config.dialogs.create.result.start') : t('common.close')}
        </Button>
      </div>
    </>
  )
}
