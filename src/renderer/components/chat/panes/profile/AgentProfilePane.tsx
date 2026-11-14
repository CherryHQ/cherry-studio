import { useTranslation } from 'react-i18next'

import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { PermissionModeIcon } from '@renderer/components/PermissionModeOption'
import { AgentAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/AgentAvatarPicker'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useModelById } from '@renderer/hooks/useModel'
import { getAgentAvatar, getPermissionModeCards } from '@renderer/utils/agent'
import type { AgentEntity } from '@shared/data/types/agent'

import { AgentProfileActivity, type AgentProfileWorkspace } from './AgentProfileActivity'
import { ProfilePaneFrame } from './ProfilePaneFrame'
import {
  ProfilePaneHeader,
  ProfilePaneSection,
  ProfilePaneSectionAction,
  ProfileSettingButton,
  ProfileSettingsRow
} from './ProfilePaneParts'

/** Profile of the conversation's Agent: who it is, its activity, and a few settings. */
export function AgentProfilePane({
  agentId,
  sessionId,
  workspace
}: {
  agentId: string
  sessionId?: string
  workspace?: AgentProfileWorkspace
}) {
  const { t } = useTranslation()
  const { agent } = useAgent(agentId)

  if (!agent) return <ProfilePaneFrame />

  return (
    <ProfilePaneFrame>
      <ProfilePaneHeader
        avatar={
          <AgentAvatarPicker
            agentId={agent.id}
            emoji={getAgentAvatar(agent.configuration?.avatar)}
            avatarSrc={agent.avatarSrc}
            ariaLabel={t('library.config.dialogs.create.avatar_aria')}
            portalContainer={null}
            size="lg"
          />
        }
        name={agent.name}
        description={agent.description}
      />
      <AgentProfileActivity agent={agent} sessionId={sessionId} workspace={workspace} />
      <AgentProfileSettings agent={agent} />
    </ProfilePaneFrame>
  )
}

function AgentProfileSettings({ agent }: { agent: AgentEntity }) {
  const { t } = useTranslation()
  const { model } = useModelById(agent.model)
  const [globalLanguage] = usePreference('agent.language')
  const openEdit = (initialTab?: string) => openResourceEditDialog({ kind: 'agent', id: agent.id, initialTab })

  const permissionMode = agent.configuration?.permission_mode ?? 'default'
  const permissionCard = getPermissionModeCards(agent.type).find((card) => card.mode === permissionMode)
  // undefined follows the global setting, null means no constraint, a string names the language.
  const language = agent.configuration?.language
  const languageValue =
    language === undefined
      ? t('library.config.agent.field.language.inherit', {
          language: globalLanguage || t('settings.agent.language.follow_conversation')
        })
      : language === null
        ? t('library.config.agent.field.language.mode.off')
        : language

  const modelLabel = t('common.model')
  const permissionLabel = t('chat.profile_pane.permission')
  const languageLabel = t('library.config.agent.field.language.label')

  return (
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
          value={model?.name ?? agent.modelName ?? t('button.select_model')}
          icon={model ? <ModelAvatar model={model} size={18} /> : undefined}
          onClick={() => openEdit('basic')}
        />
      </ProfileSettingsRow>
      <ProfileSettingsRow label={permissionLabel}>
        <ProfileSettingButton
          label={permissionLabel}
          value={permissionCard ? t(permissionCard.titleKey, permissionCard.titleFallback) : permissionMode}
          icon={<PermissionModeIcon mode={permissionMode} size={16} />}
          onClick={() => openEdit('basic')}
          className="w-40"
        />
      </ProfileSettingsRow>
      <ProfileSettingsRow label={languageLabel}>
        <ProfileSettingButton
          label={languageLabel}
          value={languageValue}
          onClick={() => openEdit('basic')}
          className="w-40"
        />
      </ProfileSettingsRow>
    </ProfilePaneSection>
  )
}
