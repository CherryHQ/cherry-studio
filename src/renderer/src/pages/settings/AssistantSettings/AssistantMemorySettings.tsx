import { Box, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SettingDescription, SettingRow, SettingRowTitle } from '@renderer/pages/settings'
import type { Assistant, AssistantSettings } from '@renderer/types'
import { useTranslation } from 'react-i18next'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: Partial<AssistantSettings>) => void
}

const AssistantMemorySettings: React.FC<Props> = ({ assistant, updateAssistantSettings }) => {
  const { t } = useTranslation()
  const [memoryEnabled] = usePreference('feature.memory.enabled')
  const [provider] = usePreference('feature.memory.provider')

  const isMemoryConfigured = memoryEnabled && provider !== 'off'

  const enableMemory = assistant.settings?.enableMemory ?? false

  return (
    <Box className="flex flex-col gap-4 p-1">
      <Box className="font-bold">{t('settings.memory.title', 'Memory')}</Box>

      {!isMemoryConfigured && (
        <SettingDescription>
          {t(
            'assistants.settings.memory.not_configured',
            'Memory is not enabled. Enable it in Settings → Memory first.'
          )}
        </SettingDescription>
      )}

      <SettingRow>
        <div>
          <SettingRowTitle>
            {t('assistants.settings.memory.enable', 'Enable Memory for this Assistant')}
          </SettingRowTitle>
          <SettingDescription className="mt-0">
            {t(
              'assistants.settings.memory.enable_description',
              'When enabled, this assistant will retain conversation memories and recall relevant context during chat.'
            )}
          </SettingDescription>
        </div>
        <Switch
          checked={enableMemory}
          disabled={!isMemoryConfigured}
          onCheckedChange={(v) => updateAssistantSettings({ enableMemory: v })}
        />
      </SettingRow>
    </Box>
  )
}

export default AssistantMemorySettings
