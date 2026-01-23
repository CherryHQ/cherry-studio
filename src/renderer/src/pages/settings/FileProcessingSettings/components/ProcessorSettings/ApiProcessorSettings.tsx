import { Button, Field, FieldContent, FieldGroup, FieldLabel, Input } from '@cherrystudio/ui'
import type { FileProcessorMerged } from '@renderer/hooks/useFileProcessors'
import type { FileProcessorOverride } from '@shared/data/presets/fileProcessing'
import { Eye, EyeOff } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { useApiProcessorSettings } from '../../hooks/useApiProcessorSettings'

interface ApiProcessorSettingsProps {
  processor: FileProcessorMerged
  updateConfig: (update: FileProcessorOverride) => void
}

const ApiProcessorSettings: FC<ApiProcessorSettingsProps> = ({ processor, updateConfig }) => {
  const { t } = useTranslation()

  // Get capability info
  const capability = processor.capabilities[0]
  const {
    apiKeyInput,
    apiHostInput,
    showApiKey,
    setApiKeyInput,
    setApiHostInput,
    toggleShowApiKey,
    handleFieldBlur,
    hasDefaultApiHost
  } = useApiProcessorSettings({ processor, capability, updateConfig })

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="px-4 py-2">{t(`processor.${processor.id}.name`)}</div>
      <div className="border-border border-b" />
      <FieldGroup className="px-4 py-2">
        {/* API Key */}
        <Field>
          <FieldLabel>{t('settings.file_processing.api_key')}</FieldLabel>
          <FieldContent>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onBlur={(e) => handleFieldBlur('apiKey', e.target.value)}
                  placeholder={t('settings.file_processing.api_key_placeholder')}
                  className="rounded-2xs pr-10"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-translate-y-1/2 absolute top-1/2 right-2"
                  onClick={toggleShowApiKey}>
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
            </div>
          </FieldContent>
        </Field>

        {/* API Host (if has default) */}
        {hasDefaultApiHost && (
          <Field>
            <FieldLabel>{t('settings.file_processing.api_host')}</FieldLabel>
            <FieldContent>
              <Input
                value={apiHostInput}
                onChange={(e) => setApiHostInput(e.target.value)}
                onBlur={(e) => handleFieldBlur('apiHost', e.target.value)}
                placeholder={t('settings.file_processing.api_host_placeholder')}
                className="rounded-2xs"
              />
            </FieldContent>
          </Field>
        )}
      </FieldGroup>

      <div className="border-border border-b" />
    </div>
  )
}

export default ApiProcessorSettings
