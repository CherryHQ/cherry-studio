import { Button, Field, FieldContent, FieldGroup, FieldLabel, Input } from '@cherrystudio/ui'
import { FILE_PROCESSOR_CONFIG } from '@renderer/config/fileProcessing'
import { useFileProcessor } from '@renderer/hooks/useFileProcessing'
import { Eye, EyeOff } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProcessorSettingsLayout from '../ProcessorSettingsLayout'

interface ApiProcessorSettingsProps {
  processorId: string
}

const ApiProcessorSettings: FC<ApiProcessorSettingsProps> = ({ processorId }) => {
  const { t } = useTranslation()
  const { processor, updateProcessor } = useFileProcessor(processorId)

  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiHostInput, setApiHostInput] = useState('')

  const capability = processor?.capabilities[0]
  const hasApiHost = capability && 'apiHost' in capability

  useEffect(() => {
    setApiKeyInput(processor?.apiKeys?.join(', ') || '')
    setApiHostInput(capability?.apiHost || '')
  }, [processor, capability])

  if (!processor) return null

  const handleBlur = (field: 'apiKeys' | 'apiHost', value: string) => {
    if (field === 'apiKeys') {
      const newKeys = value
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
      const currentKeys = processor.apiKeys ?? []
      if (JSON.stringify(newKeys) !== JSON.stringify(currentKeys)) {
        updateProcessor({ apiKeys: newKeys })
      }
      return
    }

    if (!capability) return
    const trimmed = value.trim().replace(/\/$/, '')
    if (trimmed !== (capability.apiHost ?? '')) {
      updateProcessor({ capabilities: { [capability.feature]: { apiHost: trimmed } } })
    }
    setApiHostInput(trimmed)
  }

  return (
    <ProcessorSettingsLayout.Root
      title={t(`settings.file_processing.processor.${processor.id}.name`)}
      officialUrl={FILE_PROCESSOR_CONFIG[processor.id]?.websites.official}>
      <ProcessorSettingsLayout.Header />
      <ProcessorSettingsLayout.Content>
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
                    onBlur={(e) => handleBlur('apiKeys', e.target.value)}
                    placeholder={t('settings.file_processing.api_key_placeholder')}
                    className="rounded-2xs pr-10"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-translate-y-1/2 absolute top-1/2 right-2"
                    onClick={() => setShowApiKey((prev) => !prev)}>
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </div>
              {FILE_PROCESSOR_CONFIG[processor.id]?.websites.apiKey && (
                <span
                  className="mt-1 flex cursor-pointer items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                  onClick={() => window.open(FILE_PROCESSOR_CONFIG[processor.id]?.websites.apiKey, '_blank')}>
                  {t('settings.file_processing.get_api_key')}
                </span>
              )}
            </FieldContent>
          </Field>

          {/* API Host (if has default) */}
          {hasApiHost && (
            <Field>
              <FieldLabel>{t('settings.file_processing.api_host')}</FieldLabel>
              <FieldContent>
                <Input
                  value={apiHostInput}
                  onChange={(e) => setApiHostInput(e.target.value)}
                  onBlur={(e) => handleBlur('apiHost', e.target.value)}
                  placeholder={t('settings.file_processing.api_host_placeholder')}
                  className="rounded-2xs"
                />
              </FieldContent>
            </Field>
          )}
        </FieldGroup>

        <div className="border-border border-b" />
      </ProcessorSettingsLayout.Content>
    </ProcessorSettingsLayout.Root>
  )
}

export default ApiProcessorSettings
