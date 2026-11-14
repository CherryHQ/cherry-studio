import { ChevronDown, Eye, EyeOff, Info } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider, useProviderAuthConfig, useProviderMutations } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { DEFAULT_VERTEX_AI_LOCATIONS, parseVertexAIServiceAccountJson } from '@renderer/utils/vertexAi'
import {
  isVertexAuthorizedUserCredentials,
  VERTEX_AUTHORIZED_USER_TYPE,
  type VertexAuthorizedUserView
} from '@shared/utils/vertexGoogleCredentials'

import {
  ProviderHelpLink,
  ProviderHelpText,
  ProviderHelpTextRow,
  ProviderSettingsSubtitle
} from '../primitives/ProviderSettingsPrimitives'
import LoginOauthPanel from './LoginOauthPanel'

const logger = loggerService.withContext('VertexAiSettings')

interface Props {
  providerId: string
}

/** How this provider authenticates to Vertex AI. */
type VertexAuthMethod = 'service_account' | 'google'

/** A string field of the stored credentials, or '' when absent. */
const readCredential = (credentials: Record<string, unknown> | undefined, key: string) => {
  const value = credentials?.[key]
  return typeof value === 'string' ? value : ''
}

const VertexAiSettings: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { data: authConfig } = useProviderAuthConfig(providerId)
  const { updateAuthConfig: saveAuthConfigToServer } = useProviderMutations(providerId)

  const gcpConfig = authConfig?.type === 'iam-gcp' ? authConfig : null
  const credentials = gcpConfig?.credentials
  // The auth-config read returns Google sign-ins as a view without the refresh token.
  const googleView = isVertexAuthorizedUserCredentials(credentials) ? (credentials as VertexAuthorizedUserView) : null
  const storedAuthMethod: VertexAuthMethod = googleView ? 'google' : 'service_account'
  const hasStoredServiceAccountKey =
    !googleView && Boolean(readCredential(credentials, 'privateKey') || readCredential(credentials, 'clientEmail'))
  const savedGoogleClientId = googleView?.clientId ?? ''
  const isGoogleClientSaved = Boolean(googleView?.clientId && googleView.clientSecret)

  // The picker only switches the view; it follows the stored method when that changes.
  const [authMethod, setAuthMethod] = useState<VertexAuthMethod>(storedAuthMethod)
  const [syncedAuthMethod, setSyncedAuthMethod] = useState<VertexAuthMethod>(storedAuthMethod)
  if (syncedAuthMethod !== storedAuthMethod) {
    setSyncedAuthMethod(storedAuthMethod)
    setAuthMethod(storedAuthMethod)
  }

  const [localClientId, setLocalClientId] = useState(readCredential(credentials, 'clientId'))
  const [localClientSecret, setLocalClientSecret] = useState(readCredential(credentials, 'clientSecret'))
  const [showClientSecret, setShowClientSecret] = useState(false)

  const [localProjectId, setLocalProjectId] = useState(gcpConfig?.project ?? '')
  const [localLocation, setLocalLocation] = useState(gcpConfig?.location ?? '')
  const [localPrivateKey, setLocalPrivateKey] = useState(readCredential(credentials, 'privateKey'))
  const [localClientEmail, setLocalClientEmail] = useState(readCredential(credentials, 'clientEmail'))
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
  const isMethodSwitchConfirmOpenRef = useRef(false)

  const resetLocalAuthConfig = useCallback(() => {
    setLocalProjectId(gcpConfig?.project ?? '')
    setLocalLocation(gcpConfig?.location ?? '')
    setLocalPrivateKey(readCredential(credentials, 'privateKey'))
    setLocalClientEmail(readCredential(credentials, 'clientEmail'))
    setLocalClientId(readCredential(credentials, 'clientId'))
    setLocalClientSecret(readCredential(credentials, 'clientSecret'))
    if (!serviceAccountJsonError) {
      setServiceAccountJson('')
      setServiceAccountJsonError(false)
    }
  }, [credentials, gcpConfig?.location, gcpConfig?.project, serviceAccountJsonError])

  useEffect(() => {
    if (!isDraftDirtyRef.current && activeSaveRequestsRef.current === 0) {
      resetLocalAuthConfig()
    }
  }, [resetLocalAuthConfig])

  const markDraftDirty = () => {
    isDraftDirtyRef.current = true
  }

  const apiKeyWebsite = provider?.websites?.apiKey

  const serviceAccountCredentials = () => ({ privateKey: localPrivateKey, clientEmail: localClientEmail })
  const googleClientCredentials = () => ({
    type: VERTEX_AUTHORIZED_USER_TYPE,
    clientId: localClientId.trim(),
    clientSecret: localClientSecret.trim()
  })
  /** Saving project or location resends the credentials as stored, never unsaved drafts. */
  const storedCredentials = () =>
    googleView
      ? { type: VERTEX_AUTHORIZED_USER_TYPE, clientId: googleView.clientId, clientSecret: googleView.clientSecret }
      : {
          privateKey: readCredential(credentials, 'privateKey'),
          clientEmail: readCredential(credentials, 'clientEmail')
        }

  const discardCredentialDrafts = () => {
    setLocalPrivateKey(readCredential(credentials, 'privateKey'))
    setLocalClientEmail(readCredential(credentials, 'clientEmail'))
    setLocalClientId(readCredential(credentials, 'clientId'))
    setLocalClientSecret(readCredential(credentials, 'clientSecret'))
    isDraftDirtyRef.current = false
  }

  /** Asks before a save replaces the stored sign-in; a second prompt never stacks on an open one. */
  const confirmMethodSwitch = async (title: string, content: string) => {
    if (isMethodSwitchConfirmOpenRef.current) return false
    isMethodSwitchConfirmOpenRef.current = true
    try {
      const confirmed = await popup.confirm({ title, content, centered: true })
      if (!confirmed) discardCredentialDrafts()
      return confirmed
    } finally {
      isMethodSwitchConfirmOpenRef.current = false
    }
  }

  const signOutOfGoogle = async () => {
    try {
      await ipcApi.request('oauth.logout', { providerId })
      return true
    } catch (error) {
      logger.error('Failed to sign out of Google before replacing its credentials', { providerId, error })
      toast.error(t('settings.provider.save_failed'))
      return false
    }
  }

  const confirmReplaceServiceAccount = async () =>
    !hasStoredServiceAccountKey ||
    confirmMethodSwitch(
      t('settings.provider.vertex_ai.auth_method.replace_service_account_title'),
      t('settings.provider.vertex_ai.auth_method.replace_service_account_content')
    )

  /** Confirms before a service account key replaces a stored Google client, signing out a live session. */
  const signOutBeforeServiceAccountSave = async () => {
    if (!googleView) return true
    const confirmed = await confirmMethodSwitch(
      t('settings.provider.vertex_ai.auth_method.replace_google_title'),
      t('settings.provider.vertex_ai.auth_method.replace_google_content')
    )
    if (!confirmed) return false
    return !googleView.signedIn || signOutOfGoogle()
  }

  /** A different OAuth client cannot reuse the session, so revoke it rather than silently dropping it. */
  const signOutBeforeClientChange = async (clientId: string) => {
    if (!googleView?.signedIn || clientId === googleView.clientId) return true
    const confirmed = await confirmMethodSwitch(
      t('settings.provider.vertex_ai.google.change_client_title'),
      t('settings.provider.vertex_ai.google.change_client_content')
    )
    return confirmed && signOutOfGoogle()
  }

  const saveAuthConfig = async (nextCredentials: Record<string, unknown>) => {
    activeSaveRequestsRef.current++
    try {
      await saveAuthConfigToServer({
        type: 'iam-gcp' as const,
        project: localProjectId,
        location: localLocation,
        credentials: nextCredentials
      })
      if (activeSaveRequestsRef.current === 1) {
        isDraftDirtyRef.current = false
      }
    } catch (error) {
      logger.error('Failed to save Vertex AI auth config', { providerId, error })
      toast.error(t('settings.provider.save_failed'))
      if (activeSaveRequestsRef.current === 1) {
        isDraftDirtyRef.current = false
        resetLocalAuthConfig()
      }
    } finally {
      activeSaveRequestsRef.current--
    }
  }

  const saveSharedFields = () => saveAuthConfig(storedCredentials())

  const saveServiceAccountFields = async () => {
    const nextCredentials = serviceAccountCredentials()
    // Switching methods waits until the new method's fields are complete.
    if (storedAuthMethod === 'google' && (!nextCredentials.privateKey || !nextCredentials.clientEmail)) return
    if (!(await signOutBeforeServiceAccountSave())) return
    await saveAuthConfig(nextCredentials)
  }

  const saveGoogleClientFields = async () => {
    const nextCredentials = googleClientCredentials()
    if (!nextCredentials.clientId || !nextCredentials.clientSecret) return
    const confirmed = googleView
      ? await signOutBeforeClientChange(nextCredentials.clientId)
      : await confirmReplaceServiceAccount()
    if (!confirmed) return
    await saveAuthConfig(nextCredentials)
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
      // Set before confirming: the dialog takes focus, and that blur must not import again.
      isJsonImportingRef.current = true
      try {
        if (!(await signOutBeforeServiceAccountSave())) {
          setTimeout(() => {
            setServiceAccountJson('')
          }, 0)
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
          toast.success(t('settings.provider.vertex_ai.service_account.json_parse_success'))
        } catch (error) {
          logger.error('Failed to save Vertex AI auth config from JSON import', { providerId, error })
          toast.error(t('settings.provider.save_failed'))
          // Preserve user-pasted JSON so they can correct and retry;
          // do not call resetLocalAuthConfig — it would clear the textarea.
          setServiceAccountJsonError(true)
        } finally {
          activeSaveRequestsRef.current--
        }
      } finally {
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
      toast.error(t('settings.provider.vertex_ai.service_account.json_parse_error'))
      setServiceAccountJsonError(true)
      return
    }

    if (!(await signOutBeforeServiceAccountSave())) {
      setServiceAccountJson('')
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
      toast.success(t('settings.provider.vertex_ai.service_account.json_parse_success'))
    } catch (error) {
      logger.error('Failed to save Vertex AI auth config from JSON import', { providerId, error })
      toast.error(t('settings.provider.save_failed'))
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
        credentials: storedCredentials()
      })
      if (activeSaveRequestsRef.current === 1) {
        isDraftDirtyRef.current = false
      }
    } catch (error) {
      logger.error('Failed to save Vertex AI auth config with location', { providerId, error })
      toast.error(t('settings.provider.save_failed'))
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
    <div className="flex flex-col">
      <ProviderSettingsSubtitle className="mt-1.5">
        {t('settings.provider.vertex_ai.auth_method.label')}
      </ProviderSettingsSubtitle>
      <div className="mt-1.5">
        <SegmentedControl<VertexAuthMethod>
          aria-label={t('settings.provider.vertex_ai.auth_method.label')}
          size="sm"
          value={authMethod}
          options={[
            { value: 'service_account', label: t('settings.provider.vertex_ai.auth_method.service_account') },
            { value: 'google', label: t('settings.provider.vertex_ai.auth_method.google') }
          ]}
          onValueChange={setAuthMethod}
        />
      </div>

      {authMethod === 'service_account' && (
        <>
          <ProviderSettingsSubtitle className="mt-1.5">
            {t('settings.provider.vertex_ai.service_account.title')}
          </ProviderSettingsSubtitle>
          <div className="mt-1.5 flex gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-foreground">
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
            aria-label={t('settings.provider.vertex_ai.service_account.json_input')}
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
              aria-label={t('settings.provider.vertex_ai.service_account.client_email')}
              value={localClientEmail}
              placeholder={t('settings.provider.vertex_ai.service_account.client_email_placeholder')}
              onChange={(e) => {
                markDraftDirty()
                setLocalClientEmail(e.target.value)
              }}
              onBlur={() => void saveServiceAccountFields()}
            />
            <button
              type="button"
              onClick={() => setShowClientEmail(!showClientEmail)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
              aria-label={t('settings.provider.vertex_ai.service_account.private_key')}
              value={localPrivateKey}
              placeholder={t('settings.provider.vertex_ai.service_account.private_key_placeholder')}
              onChange={(e) => {
                markDraftDirty()
                setLocalPrivateKey(e.target.value)
              }}
              onBlur={() => void saveServiceAccountFields()}
              spellCheck={false}
              rows={localPrivateKey ? 2 : 1}
            />
            <button
              type="button"
              onClick={() => setShowPrivateKey(!showPrivateKey)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('settings.provider.vertex_ai.service_account.toggle_private_key_visibility')}>
              {showPrivateKey ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </button>
          </div>
          <ProviderHelpTextRow>
            <ProviderHelpText>{t('settings.provider.vertex_ai.service_account.private_key_help')}</ProviderHelpText>
          </ProviderHelpTextRow>
        </>
      )}

      {authMethod === 'google' && (
        <>
          <div className="mt-1.5 flex gap-2 rounded-md border border-info-border bg-info-subtle px-3 py-2.5 text-sm text-info-subtle-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <span>{t('settings.provider.vertex_ai.google.intro')}</span>
          </div>

          <ProviderSettingsSubtitle className="mt-1.5">
            {t('settings.provider.vertex_ai.google.client_id')}
          </ProviderSettingsSubtitle>
          <Input
            className="mt-1.5 w-full"
            aria-label={t('settings.provider.vertex_ai.google.client_id')}
            value={localClientId}
            placeholder={t('settings.provider.vertex_ai.google.client_id_placeholder')}
            spellCheck={false}
            onChange={(e) => {
              markDraftDirty()
              setLocalClientId(e.target.value)
            }}
            onBlur={() => void saveGoogleClientFields()}
          />
          <ProviderHelpTextRow>
            <ProviderHelpText>{t('settings.provider.vertex_ai.google.client_id_help')}</ProviderHelpText>
          </ProviderHelpTextRow>

          <ProviderSettingsSubtitle className="mt-1.5">
            {t('settings.provider.vertex_ai.google.client_secret')}
          </ProviderSettingsSubtitle>
          <div className="relative mt-1.5 w-full">
            <Input
              className="w-full pr-10"
              type={showClientSecret ? 'text' : 'password'}
              aria-label={t('settings.provider.vertex_ai.google.client_secret')}
              value={localClientSecret}
              placeholder={t('settings.provider.vertex_ai.google.client_secret_placeholder')}
              spellCheck={false}
              onChange={(e) => {
                markDraftDirty()
                setLocalClientSecret(e.target.value)
              }}
              onBlur={() => void saveGoogleClientFields()}
            />
            <button
              type="button"
              onClick={() => setShowClientSecret(!showClientSecret)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('settings.provider.vertex_ai.google.toggle_client_secret_visibility')}>
              {showClientSecret ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </button>
          </div>

          {isGoogleClientSaved ? (
            <div className="mt-3">
              {/* Remount per client so the panel re-reads the session the server keeps per client. */}
              <LoginOauthPanel
                key={savedGoogleClientId}
                providerId={providerId}
                i18nNs="vertex_ai.google"
                showAccountId
              />
            </div>
          ) : (
            <ProviderHelpTextRow>
              <ProviderHelpText>{t('settings.provider.vertex_ai.google.client_required')}</ProviderHelpText>
            </ProviderHelpTextRow>
          )}
        </>
      )}
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
            onBlur={() => void saveSharedFields()}
          />
          <button
            type="button"
            onClick={() => setShowProjectId(!showProjectId)}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
                    void saveSharedFields()
                  }
                }}
              />
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
    </div>
  )
}

export default VertexAiSettings
