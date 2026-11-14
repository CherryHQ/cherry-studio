import { useTranslation } from 'react-i18next'

import { Switch } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { AssistantAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/AssistantAvatarPicker'
import { openResourceEditDialog } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { useAssistant } from '@renderer/hooks/useAssistant'

import { ProfilePaneFrame } from './ProfilePaneFrame'
import {
  ProfilePaneHeader,
  ProfilePaneSection,
  ProfilePaneSectionAction,
  ProfileSettingButton,
  ProfileSettingsRow
} from './ProfilePaneParts'

/** Profile of the conversation's Assistant: who it is, its activity, and a few settings. */
export function AssistantProfilePane({ assistantId }: { assistantId: string }) {
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
