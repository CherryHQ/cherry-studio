import { Input, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider, useProviderAuthConfig, useProviderMutations } from '@renderer/hooks/useProvider'
import { DEFAULT_VERTEX_AI_LOCATIONS, parseVertexAIServiceAccountJson } from '@renderer/utils/vertexAi'
import { ChevronDown, Eye, EyeOff, Info } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ProviderHelpLink,
  ProviderHelpText,
  ProviderHelpTextRow,
  ProviderSettingsSubtitle
} from '../primitives/ProviderSettingsPrimitives'

const logger = loggerService.withContext('VertexAiSettings')

interface Props {
  providerId: string
}

const VertexAiSettings: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { data: authConfig } = useProviderAuthConfig(providerId)
  const { updateAuthConfig: saveAuthConfigToServer } = useProviderMutations(providerId)

  const gcpConfig = authConfig?.type === 'iam-gcp' ? authConfig : null
  const credentials = gcpConfig?.credentials as Record<string, string> | undefined

  const [localProjectId, setLocalProjectId] = useState(gcpConfig?.project ?? '')
  const [localLocation, setLocalLocation] = useState(gcpConfig?.location ?? '')
  const [localPrivateKey, setLocalPrivateKey] = useState(credentials?.privateKey ?? '')
  const [localClientEmail, setLocalClientEmail] = useState(credentials?.clientEmail ?? '')
  const [serviceAccountJson, setServiceAccountJson] = useState('')
  const [serviceAccountJsonError, setServiceAccountJsonError] = useState(false)

  // 敏感内容显示/隐藏的状态
  const [showClientEmail, setShowClientEmail] = useState(false)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [showProjectId, setShowProjectId] = useState(false)

  // 地区下拉框展开状态
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const isDraftDirtyRef = useRef(false)
  const activeSaveRequestsRef = useRef(0)
  const isJsonImportingRef = useRef(false)
  const isSelectingLocationRef = useRef(false)

  const resetLocalAuthConfig = useCallback(() => {
    setLocalProjectId(gcpConfig?.project ?? '')
    setLocalLocation(gcpConfig?.location ?? '')
    setLocalPrivateKey(credentials?.privateKey ?? '')
    setLocalClientEmail(credentials?.clientEmail ?? '')
    if (!serviceAccountJsonError) {
      setServiceAccountJson('')
      setServiceAccountJsonError(false)
    }
  }, [
    credentials?.clientEmail,
    credentials?.privateKey,
    gcpConfig?.location,
    gcpConfig?.project,
    serviceAccountJsonError
  ])

  useEffect(() => {
    if (!isDraftDirtyRef.current && activeSaveRequestsRef.current === 0) {
      resetLocalAuthConfig()
    }
  }, [resetLocalAuthConfig])

  const markDraftDirty = () => {
    isDraftDirtyRef.current = true
  }

  const apiKeyWebsite = provider?.websites?.apiKey

  const saveAuthConfig = async () => {
    activeSaveRequestsRef.current++
    try {
      await saveAuthConfigToServer({
        type: 'iam-gcp' as const,
        project: localProjectId,
        location: localLocation,
        credentials: {
          privateKey: localPrivateKey,
          clientEmail: localClientEmail
        }
      })
      if (activeSaveRequestsRef.current === 1) {
        isDraftDirtyRef.current = false
      }
    } catch (error) {
      logger.error('Failed to save Vertex AI auth config', { providerId, error })
      window.toast.error(t('settings.provider.save_failed'))
      if (activeSaveRequestsRef.current === 1) {
        isDraftDirtyRef.current = false
        resetLocalAuthConfig()
      }
    } finally {
      activeSaveRequestsRef.current--
    }
  }

  const handleServiceAccountJsonChange = async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setServiceAccountJson(value)
    if (serviceAccountJsonError) {
      setServiceAccountJsonError(false)
    }

    const trimmed = value.trim()
    if (!trimmed) {
      return
    }

    const parsed = parseVertexAIServiceAccountJson(trimmed)
    if (parsed) {
      setLocalPrivateKey(parsed.privateKey)
      setLocalClientEmail(parsed.clientEmail)
      if (parsed.projectId) {
        setLocalProjectId(parsed.projectId)
      }

      isJsonImportingRef.current = true
      activeSaveRequestsRef.current++
      try {
        await saveAuthConfigToServer({
          type: 'iam-gcp' as const,
          project: parsed.projectId ?? localProjectId,
          location: localLocation,
          credentials: {
            privateKey: parsed.privateKey,
            clientEmail: parsed.clientEmail
          }
        })
        // Defer clearing to avoid being overwritten by Textarea.Input's
        // internal useControllableState handleChange firing after us.
        setTimeout(() => {
          setServiceAccountJson('')
        }, 0)
        setServiceAccountJsonError(false)
        // Intentionally do NOT clear isDraftDirtyRef here: the useEffect reset
        // will run on the next server refetch and re-sync local state from
        // gcpConfig (which already contains the values we just saved). Clearing
        // here would clobber a concurrent user edit in another field.
        window.toast.success(t('settings.provider.vertex_ai.service_account.json_parse_success'))
      } catch (error) {
        logger.error('Failed to save Vertex AI auth config from JSON import', { providerId, error })
        window.toast.error(t('settings.provider.save_failed'))
        // Preserve user-pasted JSON so they can correct and retry;
        // do not call resetLocalAuthConfig — it would clear the textarea.
        setServiceAccountJsonError(true)
      } finally {
        activeSaveRequestsRef.current--
        isJsonImportingRef.current = false
      }
    }
  }

  const handleServiceAccountJsonBlur = async () => {
    // Skip if onChange already triggered a JSON import (avoids double save + double toast)
    if (isJsonImportingRef.current) return

    const value = serviceAccountJson.trim()

    if (!value) {
      return
    }

    const parsed = parseVertexAIServiceAccountJson(value)
    if (!parsed) {
      window.toast.error(t('settings.provider.vertex_ai.service_account.json_parse_error'))
      setServiceAccountJsonError(true)
      return
    }

    setLocalPrivateKey(parsed.privateKey)
    setLocalClientEmail(parsed.clientEmail)
    if (parsed.projectId) {
      setLocalProjectId(parsed.projectId)
    }

    activeSaveRequestsRef.current++
    try {
      await saveAuthConfigToServer({
        type: 'iam-gcp' as const,
        project: parsed.projectId ?? localProjectId,
        location: localLocation,
        credentials: {
          privateKey: parsed.privateKey,
          clientEmail: parsed.clientEmail
        }
      })
      setServiceAccountJson('')
      setServiceAccountJsonError(false)
      window.toast.success(t('settings.provider.vertex_ai.service_account.json_parse_success'))
    } catch (error) {
      logger.error('Failed to save Vertex AI auth config from JSON import', { providerId, error })
      window.toast.error(t('settings.provider.save_failed'))
      // Preserve user-pasted JSON so they can correct and retry;
      // do not call resetLocalAuthConfig — it would clear the textarea.
      setServiceAccountJsonError(true)
    } finally {
      activeSaveRequestsRef.current--
    }
  }

  const handleLocationSelect = (value: string) => {
    setLocalLocation(value)
    setDropdownOpen(false)
    void saveAuthConfigWithLocation(value)
    isSelectingLocationRef.current = false
  }

  const saveAuthConfigWithLocation = async (locationValue: string) => {
    const trimmedLocation = locationValue.trim()
    const previousLocation = localLocation
    activeSaveRequestsRef.current++
    try {
      await saveAuthConfigToServer({
        type: 'iam-gcp' as const,
        project: localProjectId,
        location: trimmedLocation,
        credentials: {
          privateKey: localPrivateKey,
          clientEmail: localClientEmail
        }
      })
      if (activeSaveRequestsRef.current === 1) {
        isDraftDirtyRef.current = false
      }
    } catch (error) {
      logger.error('Failed to save Vertex AI auth config with location', { providerId, error })
      window.toast.error(t('settings.provider.save_failed'))
      // Only roll back location — do not clear credentials the user already confirmed.
      setLocalLocation(previousLocation)
      if (activeSaveRequestsRef.current === 1) {
        isDraftDirtyRef.current = false
      }
    } finally {
      activeSaveRequestsRef.current--
    }
  }

  return (
    <>
      <ProviderSettingsSubtitle className="mt-1.5">
        {t('settings.provider.vertex_ai.service_account.title')}
      </ProviderSettingsSubtitle>
      <div
        className="mt-1.5 flex gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-foreground text-sm"
        role="status">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>{t('settings.provider.vertex_ai.service_account.description')}</span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <ProviderSettingsSubtitle className="mt-0">
          {t('settings.provider.vertex_ai.service_account.json_input')}
        </ProviderSettingsSubtitle>
        {apiKeyWebsite && (
          <ProviderHelpLink target="_blank" href={apiKeyWebsite} className="mx-0">
            {t('settings.provider.get_api_key')}
          </ProviderHelpLink>
        )}
      </div>
      <Textarea.Input
        className="mt-1.5 min-h-10 w-full px-3 py-1.5 text-sm"
        value={serviceAccountJson}
        placeholder={t('settings.provider.vertex_ai.service_account.json_input_placeholder')}
        onChange={handleServiceAccountJsonChange}
        onBlur={handleServiceAccountJsonBlur}
        spellCheck={false}
        rows={1}
      />
      <ProviderHelpTextRow>
        <ProviderHelpText className={serviceAccountJsonError ? 'text-destructive' : undefined}>
          {serviceAccountJsonError
            ? t('settings.provider.vertex_ai.service_account.json_parse_error')
            : t('settings.provider.vertex_ai.service_account.json_input_help')}
        </ProviderHelpText>
      </ProviderHelpTextRow>

      <ProviderSettingsSubtitle className="mt-1.5">
        {t('settings.provider.vertex_ai.service_account.client_email')}
      </ProviderSettingsSubtitle>
      <div className="relative mt-1.5 w-full">
        <Input
          className="w-full pr-10"
          type={showClientEmail ? 'text' : 'password'}
          value={localClientEmail}
          placeholder={t('settings.provider.vertex_ai.service_account.client_email_placeholder')}
          onChange={(e) => {
            markDraftDirty()
            setLocalClientEmail(e.target.value)
          }}
          onBlur={saveAuthConfig}
        />
        <button
          type="button"
          onClick={() => setShowClientEmail(!showClientEmail)}
          className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground"
          aria-label={t('settings.provider.vertex_ai.service_account.toggle_client_email_visibility')}>
          {showClientEmail ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
      </div>
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('settings.provider.vertex_ai.service_account.client_email_help')}</ProviderHelpText>
      </ProviderHelpTextRow>

      <ProviderSettingsSubtitle className="mt-1.5">
        {t('settings.provider.vertex_ai.service_account.private_key')}
      </ProviderSettingsSubtitle>
      <div className="relative mt-1.5 w-full">
        <Textarea.Input
          className="min-h-10 w-full resize-none overflow-y-auto px-3 py-1.5 pr-10 text-sm"
          style={
            {
              WebkitTextSecurity: showPrivateKey ? 'none' : 'disc',
              maxHeight: localPrivateKey ? '52px' : '32px'
            } as React.CSSProperties
          }
          value={localPrivateKey}
          placeholder={t('settings.provider.vertex_ai.service_account.private_key_placeholder')}
          onChange={(e) => {
            markDraftDirty()
            setLocalPrivateKey(e.target.value)
          }}
          onBlur={saveAuthConfig}
          spellCheck={false}
          rows={localPrivateKey ? 2 : 1}
        />
        <button
          type="button"
          onClick={() => setShowPrivateKey(!showPrivateKey)}
          className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground"
          aria-label={t('settings.provider.vertex_ai.service_account.toggle_private_key_visibility')}>
          {showPrivateKey ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
      </div>
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('settings.provider.vertex_ai.service_account.private_key_help')}</ProviderHelpText>
      </ProviderHelpTextRow>
      <>
        <ProviderSettingsSubtitle className="mt-1.5">
          {t('settings.provider.vertex_ai.project_id')}
        </ProviderSettingsSubtitle>
        <div className="relative mt-1.5 w-full">
          <Input
            className="w-full pr-10"
            type={showProjectId ? 'text' : 'password'}
            value={localProjectId}
            placeholder={t('settings.provider.vertex_ai.project_id_placeholder')}
            onChange={(e) => {
              markDraftDirty()
              setLocalProjectId(e.target.value)
            }}
            onBlur={saveAuthConfig}
          />
          <button
            type="button"
            onClick={() => setShowProjectId(!showProjectId)}
            className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground"
            aria-label={t('settings.provider.vertex_ai.service_account.toggle_project_id_visibility')}>
            {showProjectId ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
        </div>
        <ProviderHelpTextRow>
          <ProviderHelpText>{t('settings.provider.vertex_ai.project_id_help')}</ProviderHelpText>
        </ProviderHelpTextRow>

        <ProviderSettingsSubtitle className="mt-1.5">
          {t('settings.provider.vertex_ai.location')}
        </ProviderSettingsSubtitle>

        <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <PopoverAnchor asChild>
            <div className="relative mt-1.5 w-full">
              <Input
                className="w-full pr-10"
                aria-invalid={!localLocation.trim()}
                value={localLocation}
                placeholder={t('settings.provider.vertex_ai.location_placeholder')}
                onChange={(e) => {
                  markDraftDirty()
                  setLocalLocation(e.target.value)
                }}
                onClick={() => setDropdownOpen(true)}
                onFocus={() => setDropdownOpen(true)}
                onBlur={() => {
                  if (!isSelectingLocationRef.current) {
                    void saveAuthConfig()
                  }
                }}
              />
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground"
                  aria-label={t('settings.provider.vertex_ai.select_location')}
                  aria-haspopup="listbox">
                  <ChevronDown className="size-4" />
                </button>
              </PopoverTrigger>
            </div>
          </PopoverAnchor>
          <PopoverContent className="max-h-60 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1" align="start">
            <div role="listbox" aria-label={t('settings.provider.vertex_ai.location')}>
              {DEFAULT_VERTEX_AI_LOCATIONS.map((loc) => {
                const isSelected = localLocation === loc.value
                return (
                  <button
                    key={loc.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={() => {
                      isSelectingLocationRef.current = true
                    }}
                    onClick={() => handleLocationSelect(loc.value)}
                    className="w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground">
                    {loc.label}
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
        <ProviderHelpTextRow>
          <ProviderHelpText>{t('settings.provider.vertex_ai.location_help')}</ProviderHelpText>
        </ProviderHelpTextRow>
      </>
    </>
  )
}

export default VertexAiSettings
