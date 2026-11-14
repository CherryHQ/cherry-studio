import { useTranslation } from 'react-i18next'

import { Switch } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { AssistantAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/AssistantAvatarPicker'
import { KnowledgeBaseAvatar } from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import type { Assistant } from '@shared/data/types/assistant'

import { ProfilePaneFrame } from './ProfilePaneFrame'
import {
  ProfilePaneHeader,
  ProfilePaneSection,
  ProfilePaneSectionAction,
  ProfileSettingButton,
  ProfileSettingsRow
} from './ProfilePaneParts'
import { ProfileStatTiles, RecentTopicsSection } from './ProfilePaneStats'

/** Profile of the conversation's Assistant: who it is, its activity, and a few settings. */
export function AssistantProfilePane({
  assistantId,
  activeTopicId,
  onOpenTopic,
  onShowAllTopics
}: {
  assistantId: string
  /** The conversation's topic, marked in the recent topics. */
  activeTopicId?: string
  onOpenTopic?: (topicId: string) => void
  /** Shows the topic list of this Assistant. */
  onShowAllTopics?: () => void
}) {
  const { t } = useTranslation()
  const { assistant, model, updateAssistantSettings } = useAssistant(assistantId)

  if (!assistant) return <ProfilePaneFrame />

  const openEdit = (initialTab?: string) => openResourceEditDialog({ kind: 'assistant', id: assistant.id, initialTab })
  const modelLabel = t('common.model')
  const browserLabel = t('settings.browser.title')

  return (
    <ProfilePaneFrame>
      <ProfilePaneHeader
        avatar={
          <AssistantAvatarPicker
            assistantId={assistant.id}
            emoji={assistant.emoji}
            avatarSrc={assistant.avatarSrc}
            ariaLabel={t('library.config.dialogs.create.avatar_aria')}
            portalContainer={null}
            size="lg"
          />
        }
        name={assistant.name}
        description={assistant.description}
      />
      <AssistantUsage
        assistantId={assistant.id}
        activeTopicId={activeTopicId}
        onOpenTopic={onOpenTopic}
        onShowAllTopics={onShowAllTopics}
      />
      <KnowledgeBasesSection assistant={assistant} onManage={() => openEdit('tools.knowledge')} />
      <ProfilePaneSection
        title={t('common.settings')}
        action={
          <ProfilePaneSectionAction withChevron onClick={() => openEdit()}>
            {t('common.all')}
          </ProfilePaneSectionAction>
        }>
        <ProfileSettingsRow label={modelLabel}>
          <ProfileSettingButton
            label={modelLabel}
            value={model?.name ?? assistant.modelName ?? t('button.select_model')}
            icon={model ? <ModelAvatar model={model} size={18} /> : undefined}
            onClick={() => openEdit('basic')}
          />
        </ProfileSettingsRow>
        <ProfileSettingsRow label={browserLabel}>
          <Switch
            size="sm"
            aria-label={browserLabel}
            checked={assistant.settings.enableBrowser !== false}
            onCheckedChange={(enableBrowser) => void updateAssistantSettings({ enableBrowser })}
          />
        </ProfileSettingsRow>
      </ProfilePaneSection>
    </ProfilePaneFrame>
  )
}

/** The knowledge bases this Assistant answers from; hidden when none is linked. */
function KnowledgeBasesSection({ assistant, onManage }: { assistant: Assistant; onManage: () => void }) {
  const { t } = useTranslation()
  const { bases } = useKnowledgeBases({ enabled: assistant.knowledgeBaseIds.length > 0 })
  const linked = assistant.knowledgeBaseIds.flatMap((id) => bases.filter((base) => base.id === id))
  if (!linked.length) return null

  return (
    <ProfilePaneSection
      title={t('chat.profile_pane.knowledge.title')}
      action={
        <ProfilePaneSectionAction onClick={onManage}>
          {t('chat.profile_pane.knowledge.manage')}
        </ProfilePaneSectionAction>
      }>
      {linked.map((base) => (
        <div key={base.id} className="flex min-h-11 items-center gap-2.5 py-1">
          <KnowledgeBaseAvatar />
          <span className="min-w-0 flex-1 truncate text-foreground text-sm">{base.name}</span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {t('library.config.knowledge.doc_count', { count: base.itemCount })}
          </span>
        </div>
      ))}
    </ProfilePaneSection>
  )
}

function AssistantUsage({
  assistantId,
  activeTopicId,
  onOpenTopic,
  onShowAllTopics
}: {
  assistantId: string
  activeTopicId?: string
  onOpenTopic?: (topicId: string) => void
  onShowAllTopics?: () => void
}) {
  const { t } = useTranslation()
  const { data: stats, refetch } = useQuery('/assistants/:id/stats', { params: { id: assistantId } })
  useDataChange('/topics', () => void refetch())
  useDataChange('/ai-usage-records', () => void refetch())
  if (!stats) return null

  return (
    <>
      <ProfileStatTiles
        stats={[
          { label: t('chat.profile_pane.stats.topics'), value: stats.topicCount },
          { label: t('chat.profile_pane.stats.messages'), value: stats.messageCount },
          { label: t('chat.profile_pane.stats.recent_tokens'), value: stats.recentTokens }
        ]}
      />
      <RecentTopicsSection
        topics={stats.recentTopics}
        activeTopicId={activeTopicId}
        onOpenTopic={onOpenTopic}
        onShowAll={onShowAllTopics}
      />
    </>
  )
}
