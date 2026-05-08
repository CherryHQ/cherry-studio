import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useVertexAISettings } from '@renderer/hooks/useVertexAI'
import {
  getMissingVertexAIConfigFields,
  mergeVertexAILocationOptions,
  parseVertexAIServiceAccountJson
} from '@renderer/utils/vertexAI'
import { Alert, AutoComplete, Button, Input } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

const visibilityToggleStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  right: 8,
  transform: 'translateY(-50%)',
  zIndex: 1
}

const visibilityIconStyle: React.CSSProperties = {
  color: 'var(--color-text-3)'
}

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
        paddingRight: 40,
        WebkitTextSecurity: privateKeyVisible ? 'none' : 'disc'
      }) as React.CSSProperties,
    [privateKeyVisible]
  )
  const jsonTextAreaStyle = useMemo(
    () =>
      ({
        paddingRight: 40,
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
        style={{ marginTop: 5 }}
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
        <Input.TextArea
          value={serviceAccountJson}
          status={serviceAccountJsonError ? 'error' : undefined}
          placeholder={t('settings.provider.vertex_ai.service_account.json_input_placeholder')}
          onChange={handleServiceAccountJsonChange}
          onBlur={handleServiceAccountJsonBlur}
          style={jsonTextAreaStyle}
          spellCheck={false}
          autoComplete="off"
          autoSize={serviceAccountJsonError ? { minRows: 2, maxRows: 2 } : { minRows: 1, maxRows: 1 }}
        />
        <Button
          type="text"
          size="small"
          aria-label={jsonInputLabel}
          icon={
            serviceAccountJsonVisible ? (
              <EyeOutlined style={visibilityIconStyle} />
            ) : (
              <EyeInvisibleOutlined style={visibilityIconStyle} />
            )
          }
          onClick={() => setServiceAccountJsonVisible((visible) => !visible)}
          onMouseDown={(event) => event.preventDefault()}
          style={visibilityToggleStyle}
        />
      </div>
      <SettingHelpTextRow>
        <SettingHelpText style={serviceAccountJsonError ? { color: 'var(--color-error)' } : undefined}>
          {serviceAccountJsonError
            ? t('settings.provider.vertex_ai.service_account.json_parse_error')
            : t('settings.provider.vertex_ai.service_account.json_input_help')}
        </SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 5 }}>
        {t('settings.provider.vertex_ai.service_account.client_email')}
      </SettingSubtitle>
      <Input.Password
        value={serviceAccount.clientEmail}
        status={isClientEmailMissing ? 'error' : undefined}
        placeholder={t('settings.provider.vertex_ai.service_account.client_email_placeholder')}
        onChange={handleServiceAccountClientEmailChange}
        onBlur={handleServiceAccountClientEmailBlur}
        style={{ marginTop: 5 }}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.vertex_ai.service_account.client_email_help')}</SettingHelpText>
      </SettingHelpTextRow>

      <SettingSubtitle style={{ marginTop: 5 }}>{privateKeyLabel}</SettingSubtitle>
      <div style={{ position: 'relative', marginTop: 5 }}>
        <Input.TextArea
          value={serviceAccount.privateKey}
          status={isPrivateKeyMissing ? 'error' : undefined}
          placeholder={t('settings.provider.vertex_ai.service_account.private_key_placeholder')}
          onChange={handleServiceAccountPrivateKeyChange}
          onBlur={handleServiceAccountPrivateKeyBlur}
          style={secretTextAreaStyle}
          spellCheck={false}
          autoComplete="off"
          autoSize={{ minRows: 2, maxRows: 2 }}
        />
        <Button
          type="text"
          size="small"
          aria-label={privateKeyLabel}
          icon={
            privateKeyVisible ? (
              <EyeOutlined style={visibilityIconStyle} />
            ) : (
              <EyeInvisibleOutlined style={visibilityIconStyle} />
            )
          }
          onClick={() => setPrivateKeyVisible((visible) => !visible)}
          onMouseDown={(event) => event.preventDefault()}
          style={visibilityToggleStyle}
        />
      </div>
      <SettingHelpTextRow>
        <SettingHelpText>{t('settings.provider.vertex_ai.service_account.private_key_help')}</SettingHelpText>
      </SettingHelpTextRow>
      <>
        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.vertex_ai.project_id')}</SettingSubtitle>
        <Input.Password
          value={localProjectId}
          status={isProjectIdMissing ? 'error' : undefined}
          placeholder={t('settings.provider.vertex_ai.project_id_placeholder')}
          onChange={handleProjectIdChange}
          onBlur={handleProjectIdBlur}
          style={{ marginTop: 5 }}
        />
        <SettingHelpTextRow>
          <SettingHelpText>{t('settings.provider.vertex_ai.project_id_help')}</SettingHelpText>
        </SettingHelpTextRow>

        <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.vertex_ai.location')}</SettingSubtitle>
        <AutoComplete
          value={localLocation}
          status={isLocationMissing ? 'error' : undefined}
          placeholder={t('settings.provider.vertex_ai.location_placeholder')}
          onChange={handleLocationChange}
          onSelect={handleLocationSelect}
          onBlur={handleLocationBlur}
          options={locationOptions}
          style={{ marginTop: 5, width: '100%' }}
        />
        <SettingHelpTextRow>
          <SettingHelpText>{t('settings.provider.vertex_ai.location_help')}</SettingHelpText>
        </SettingHelpTextRow>
      </>
    </>
  )
}

export default VertexAISettings
