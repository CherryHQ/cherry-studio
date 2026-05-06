import { Alert, Button, Input, Textarea } from '@cherrystudio/ui'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useVertexAISettings } from '@renderer/hooks/useVertexAI'
import {
  getMissingVertexAIConfigFields,
  mergeVertexAILocationOptions,
  parseVertexAIServiceAccountJson
} from '@renderer/utils/vertexAI'
import { Eye, EyeOff } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

const VertexAISettings = () => {
  const { t } = useTranslation()
  const {
    projectId,
    location,
    serviceAccount,
    setProjectId,
    setLocation,
    setServiceAccountPrivateKey,
    setServiceAccountClientEmail
  } = useVertexAISettings()

  const [localProjectId, setLocalProjectId] = useState(projectId)
  const [localLocation, setLocalLocation] = useState(location)
  const [serviceAccountJson, setServiceAccountJson] = useState('')
  const [serviceAccountJsonError, setServiceAccountJsonError] = useState(false)
  const [serviceAccountJsonVisible, setServiceAccountJsonVisible] = useState(false)
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false)

  const providerConfig = PROVIDER_URLS['vertexai']
  const apiKeyWebsite = providerConfig?.websites?.apiKey
  const jsonInputLabel = t('settings.provider.vertex_ai.service_account.json_input')
  const privateKeyLabel = t('settings.provider.vertex_ai.service_account.private_key')
  const serviceAccountClientEmail = serviceAccount.clientEmail
  const serviceAccountPrivateKey = serviceAccount.privateKey
  const locationOptions = useMemo(() => mergeVertexAILocationOptions([], localLocation), [localLocation])
  const missingConfigFields = useMemo(
    () =>
      getMissingVertexAIConfigFields({
        projectId: localProjectId,
        location: localLocation,
        serviceAccount: {
          clientEmail: serviceAccountClientEmail,
          privateKey: serviceAccountPrivateKey
        }
      }),
    [localProjectId, localLocation, serviceAccountClientEmail, serviceAccountPrivateKey]
  )
  const missingConfigFieldSet = useMemo(() => new Set(missingConfigFields), [missingConfigFields])
  const isClientEmailMissing = missingConfigFieldSet.has('clientEmail')
  const isPrivateKeyMissing = missingConfigFieldSet.has('privateKey')
  const isProjectIdMissing = missingConfigFieldSet.has('projectId')
  const isLocationMissing = missingConfigFieldSet.has('location')
  const secretTextAreaStyle = useMemo(
    () =>
      ({
        WebkitTextSecurity: privateKeyVisible ? 'none' : 'disc'
      }) as React.CSSProperties,
    [privateKeyVisible]
  )
  const jsonTextAreaStyle = useMemo(
    () =>
      ({
        WebkitTextSecurity: serviceAccountJsonVisible ? 'none' : 'disc'
      }) as React.CSSProperties,
    [serviceAccountJsonVisible]
  )

  const handleProjectIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalProjectId(e.target.value)
  }

  const applyServiceAccountJson = (value: string, options: { clearInput?: boolean } = {}) => {
    const parsed = parseVertexAIServiceAccountJson(value)

    if (!parsed) {
      return false
    }

    setServiceAccountPrivateKey(parsed.privateKey)
    setServiceAccountClientEmail(parsed.clientEmail)

    if (parsed.projectId) {
      setProjectId(parsed.projectId)
      setLocalProjectId(parsed.projectId)
    }

    if (options.clearInput) {
      setServiceAccountJson('')
    }

    setServiceAccountJsonError(false)
    window.toast.success(t('settings.provider.vertex_ai.service_account.json_parse_success'))

    return true
  }

  const handleServiceAccountJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const trimmedValue = value.trim()
    setServiceAccountJson(value)

    if (!trimmedValue) {
      setServiceAccountJsonError(false)
      return
    }

    const parsed = applyServiceAccountJson(value, { clearInput: true })
    setServiceAccountJsonError(!parsed)
  }

  const handleServiceAccountJsonBlur = () => {
    if (serviceAccountJson.trim() && serviceAccountJsonError) {
      window.toast.error(t('settings.provider.vertex_ai.service_account.json_parse_error'))
    }
  }

  const handleServiceAccountPrivateKeyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setServiceAccountPrivateKey(e.target.value)
  }

  const handleServiceAccountPrivateKeyBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setServiceAccountPrivateKey(e.target.value)
  }

  const handleServiceAccountClientEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setServiceAccountClientEmail(e.target.value)
  }

  const handleServiceAccountClientEmailBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setServiceAccountClientEmail(e.target.value)
  }

  const handleProjectIdBlur = () => {
    setProjectId(localProjectId)
  }

  const handleLocationBlur = () => {
    const trimmedLocation = localLocation.trim()
    setLocalLocation(trimmedLocation)
    setLocation(trimmedLocation)
  }

  const handleLocationChange = (value: string) => {
    setLocalLocation(value)
  }

  const handleLocationSelect = (value: string) => {
    setLocalLocation(value)
    setLocation(value)
  }

  return (
    <>
      <SettingSubtitle style={{ marginTop: 5 }}>
        {t('settings.provider.vertex_ai.service_account.title')}
      </SettingSubtitle>
      <Alert
        type="info"
        className="mt-1.25"
        message={t('settings.provider.vertex_ai.service_account.description')}
        showIcon
      />

      <SettingSubtitle style={{ marginTop: 5 }}>{jsonInputLabel}</SettingSubtitle>
      {apiKeyWebsite && (
        <SettingHelpTextRow>
          <SettingHelpLink target="_blank" href={apiKeyWebsite}>
            {t('settings.provider.get_api_key')}
          </SettingHelpLink>
        </SettingHelpTextRow>
      )}
      <div style={{ position: 'relative', marginTop: 5 }}>
        <Textarea.Input
          value={serviceAccountJson}
          hasError={serviceAccountJsonError}
          placeholder={t('settings.provider.vertex_ai.service_account.json_input_placeholder')}
          onChange={handleServiceAccountJsonChange}
          onBlur={handleServiceAccountJsonBlur}
          style={jsonTextAreaStyle}
          className="min-h-9 resize-none pr-10"
          spellCheck={false}
          autoComplete="off"
          rows={serviceAccountJsonError ? 2 : 1}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={jsonInputLabel}
          onClick={() => setServiceAccountJsonVisible((visible) => !visible)}
          onMouseDown={(event) => event.preventDefault()}
          className="absolute top-1/2 right-1.5 z-1 size-7 -translate-y-1/2 text-muted-foreground shadow-none">
          {serviceAccountJsonVisible ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
      </div>
      <SettingHelpTextRow>
        <SettingHelpText className={serviceAccountJsonError ? 'text-destructive' : undefined}>
          {serviceAccountJsonError
            ? t('settings.provider.vertex_ai.service_account.json_parse_error')
            : t('settings.provider.vertex_ai.service_account.json_input_help')}
        </SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 5 }}>
        {t('settings.provider.vertex_ai.service_account.client_email')}
      </SettingSubtitle>
      <Input
        type="password"
        value={serviceAccount.clientEmail}
        aria-invalid={isClientEmailMissing}
        placeholder={t('settings.provider.vertex_ai.service_account.client_email_placeholder')}
        onChange={handleServiceAccountClientEmailChange}
        onBlur={handleServiceAccountClientEmailBlur}
        className="mt-1.25"
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.vertex_ai.service_account.client_email_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 5 }}>{privateKeyLabel}</SettingSubtitle>
      <div style={{ position: 'relative', marginTop: 5 }}>
        <Textarea.Input
          value={serviceAccount.privateKey}
          hasError={isPrivateKeyMissing}
          placeholder={t('settings.provider.vertex_ai.service_account.private_key_placeholder')}
          onChange={handleServiceAccountPrivateKeyChange}
          onBlur={handleServiceAccountPrivateKeyBlur}
          style={secretTextAreaStyle}
          className="max-h-24 min-h-16 pr-10"
          spellCheck={false}
          autoComplete="off"
          rows={2}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={privateKeyLabel}
          onClick={() => setPrivateKeyVisible((visible) => !visible)}
          onMouseDown={(event) => event.preventDefault()}
          className="absolute top-1/2 right-1.5 z-1 size-7 -translate-y-1/2 text-muted-foreground shadow-none">
          {privateKeyVisible ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
      </div>
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.vertex_ai.service_account.private_key_help')}</SettingHelpText>
      </SettingHelpTextRow>
      <>
        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.vertex_ai.project_id')}</SettingSubtitle>
        <Input
          type="password"
          value={localProjectId}
          aria-invalid={isProjectIdMissing}
          placeholder={t('settings.provider.vertex_ai.project_id_placeholder')}
          onChange={handleProjectIdChange}
          onBlur={handleProjectIdBlur}
          className="mt-1.25"
        />
        <SettingHelpTextRow>
          <SettingHelpText>{t('settings.provider.vertex_ai.project_id_help')}</SettingHelpText>
        </SettingHelpTextRow>

        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.vertex_ai.location')}</SettingSubtitle>
        <Input
          value={localLocation}
          placeholder={t('settings.provider.vertex_ai.location_placeholder')}
          onChange={(event) => handleLocationChange(event.target.value)}
          onBlur={handleLocationBlur}
          onSelect={(event) => handleLocationSelect(event.currentTarget.value)}
          aria-invalid={isLocationMissing}
          className="mt-1.25"
          list="vertex-ai-location-options"
        />
        <datalist id="vertex-ai-location-options">
          {locationOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </datalist>
        <SettingHelpTextRow>
          <SettingHelpText>{t('settings.provider.vertex_ai.location_help')}</SettingHelpText>
        </SettingHelpTextRow>
      </>
    </>
  )
}

export default VertexAISettings
