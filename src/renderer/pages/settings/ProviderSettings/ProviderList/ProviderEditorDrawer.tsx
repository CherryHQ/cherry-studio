import { Button, Field, FieldError, FieldLabel, Input, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import ProviderLogoPicker from '@renderer/components/ProviderLogoPicker'
import { getProviderLabelKey } from '@renderer/i18n/label'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn, fileToAvatarDataUrl, generateColorFromChar, getForegroundColor, uuid } from '@renderer/utils'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, AuthType, EndpointConfig, Provider } from '@shared/data/types/provider'
import { isEmpty } from 'lodash'
import { ChevronRight, Eye, EyeOff, ImagePlus, RotateCcw } from 'lucide-react'
import { type ChangeEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import type { ProviderEditorMode, SubmitProviderEditorParams } from './useProviderEditor'

const logger = loggerService.withContext('ProviderEditorDrawer')

type ProviderEditorSubmit = SubmitProviderEditorParams

interface ProviderEditorDrawerProps {
  open: boolean
  mode: ProviderEditorMode | null
  initialLogo?: string
  onClose: () => void
  onSubmit: (providerInput: ProviderEditorSubmit) => Promise<void>
}

/**
 * Endpoint types surfaced in the "更多端点" disclosure. The disclosure filters
 * out whichever one is the form's primary URL slot, so the same array works
 * for both `create-custom` (primary = openai-chat-completions) and
 * `duplicate` (primary = source's defaultChatEndpoint).
 */
const SECONDARY_ENDPOINT_LABELS: Array<{ type: EndpointType; labelKey: string }> = [
  { type: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, labelKey: 'settings.provider.more_endpoints.openai_chat' },
  { type: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, labelKey: 'settings.provider.more_endpoints.anthropic' },
  { type: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, labelKey: 'settings.provider.more_endpoints.gemini' },
  { type: ENDPOINT_TYPE.OPENAI_RESPONSES, labelKey: 'settings.provider.more_endpoints.openai_responses' }
]

function emptyAuthConfigFor(authType: AuthType): AuthConfig {
  switch (authType) {
    case 'iam-azure':
      return { type: 'iam-azure', apiVersion: '' }
    case 'iam-aws':
      return { type: 'iam-aws', region: '' }
    case 'api-key-aws':
      return { type: 'api-key-aws', region: '' }
    case 'iam-gcp':
      return { type: 'iam-gcp', project: '', location: '' }
    case 'oauth':
      return { type: 'oauth', clientId: '' }
    case 'api-key':
    default:
      return { type: 'api-key' }
  }
}

/**
 * In duplicate mode, whether the source's auth shape uses URL-based endpoints
 * (`api-key`, `iam-azure`) vs. cloud-account-based ones (`iam-aws`, `iam-gcp`,
 * `oauth`) decides whether the form asks for a Base URL.
 */
function duplicateNeedsBaseUrl(authType: AuthType): boolean {
  return authType === 'api-key' || authType === 'iam-azure'
}

function mergeSecondaryEndpoints(
  target: Partial<Record<EndpointType, EndpointConfig>>,
  secondaryUrls: Record<string, string>,
  primary: EndpointType
) {
  for (const { type } of SECONDARY_ENDPOINT_LABELS) {
    if (type === primary) continue
    const value = secondaryUrls[type]?.trim()
    if (value) {
      target[type] = { baseUrl: value }
    }
  }
}

export default function ProviderEditorDrawer({
  open,
  mode,
  initialLogo,
  onClose,
  onSubmit
}: ProviderEditorDrawerProps) {
  const { t } = useTranslation()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [secondaryUrls, setSecondaryUrls] = useState<Record<string, string>>({})
  const [moreEndpointsOpen, setMoreEndpointsOpen] = useState(false)
  const [logo, setLogo] = useState<string | null>(null)
  const [logoDirty, setLogoDirty] = useState(false)
  const [logoPickerOpen, setLogoPickerOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [baseUrlTouched, setBaseUrlTouched] = useState(false)
  const previousOpenRef = useRef(false)

  const editingProvider = mode?.kind === 'edit' ? mode.provider : null
  const duplicateSource = mode?.kind === 'duplicate' ? mode.source : null

  const urlForm: { primary: EndpointType; requireBaseUrl: boolean } | null = (() => {
    if (!mode || mode.kind === 'edit') return null
    if (mode.kind === 'create-custom') {
      return { primary: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, requireBaseUrl: true }
    }
    if (!duplicateNeedsBaseUrl(mode.source.authType)) return null
    return {
      primary: mode.source.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      requireBaseUrl: false
    }
  })()

  // Reset form state every time the drawer transitions closed→open. Keys off
  // the mode so reopening in a different mode reseeds cleanly.
  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open

    if (!open || wasOpen) {
      return
    }

    setName(editingProvider?.name ?? '')
    setNameTouched(false)
    setBaseUrl('')
    setBaseUrlTouched(false)
    setApiKey('')
    setSecondaryUrls({})
    setMoreEndpointsOpen(false)
    setLogoDirty(false)
    setLogoPickerOpen(false)
  }, [open, editingProvider, duplicateSource])

  useEffect(() => {
    if (!open || logoDirty) {
      return
    }

    setLogo(initialLogo ?? null)
  }, [initialLogo, logoDirty, open])

  const previewName = name.trim()
  const avatarBackgroundColor = useMemo(
    () => (previewName ? generateColorFromChar(previewName) : undefined),
    [previewName]
  )
  const avatarForegroundColor = useMemo(
    () => (avatarBackgroundColor ? getForegroundColor(avatarBackgroundColor) : undefined),
    [avatarBackgroundColor]
  )

  const handleUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      const storedLogo = await fileToAvatarDataUrl(file)
      setLogo(storedLogo)
      setLogoDirty(true)
    } catch (error) {
      // fileToAvatarDataUrl can reject on a corrupt or unsupported file
      // (compression or base64 encoding) — tell the user instead of silently doing nothing.
      logger.error('Failed to process uploaded provider logo', error as Error)
      window.toast.error(t('settings.provider.logo_upload_failed'))
    }
  }

  const buildSubmit = (): ProviderEditorSubmit | null => {
    const trimmedName = name.trim()
    if (!trimmedName || !mode) return null

    if (mode.kind === 'edit') {
      return {
        mode: 'edit',
        name: trimmedName,
        defaultChatEndpoint: mode.provider.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        logo: logoDirty ? logo : undefined
      }
    }

    const trimmedApiKey = apiKey.trim()
    const apiKeysPayload: ApiKeyEntry[] | undefined = trimmedApiKey
      ? [{ id: uuid(), key: trimmedApiKey, isEnabled: true }]
      : undefined

    if (mode.kind === 'create-custom') {
      const trimmedBaseUrl = baseUrl.trim()
      if (!trimmedBaseUrl) return null

      const endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> = {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: trimmedBaseUrl }
      }
      mergeSecondaryEndpoints(endpointConfigs, secondaryUrls, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)

      return {
        mode: 'create',
        name: trimmedName,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs,
        authConfig: { type: 'api-key' },
        apiKeys: apiKeysPayload,
        logo: logo ?? undefined
      }
    }

    if (mode.kind === 'duplicate') {
      const { source } = mode
      const defaultChatEndpoint = source.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      const submit: Extract<ProviderEditorSubmit, { mode: 'create' }> = {
        mode: 'create',
        name: trimmedName,
        defaultChatEndpoint,
        presetProviderId: source.presetProviderId,
        authConfig: emptyAuthConfigFor(source.authType),
        logo: logo ?? undefined
      }
      if (duplicateNeedsBaseUrl(source.authType)) {
        const endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> = {}
        const trimmedBaseUrl = baseUrl.trim()
        if (trimmedBaseUrl) {
          endpointConfigs[defaultChatEndpoint] = { baseUrl: trimmedBaseUrl }
        }
        mergeSecondaryEndpoints(endpointConfigs, secondaryUrls, defaultChatEndpoint)
        if (!isEmpty(endpointConfigs)) {
          submit.endpointConfigs = endpointConfigs
        }
        if (apiKeysPayload) {
          submit.apiKeys = apiKeysPayload
        }
      }
      return submit
    }

    // Exhaustiveness guard: a new ProviderEditorMode kind must be handled
    // explicitly above rather than silently falling through to duplicate.
    const _exhaustive: never = mode
    throw new Error(`Unhandled provider editor mode kind: ${(_exhaustive as { kind: string }).kind}`)
  }

  // Validation surfaces inline beneath each field (see showNameError /
  // showBaseUrlError) rather than by disabling the button, so the button only
  // gates on having an active mode and not already submitting.
  const submittable = Boolean(mode)

  const showNameError = nameTouched && !name.trim()
  const showBaseUrlError = Boolean(urlForm?.requireBaseUrl) && baseUrlTouched && !baseUrl.trim()

  const handleSubmit = async () => {
    setNameTouched(true)
    setBaseUrlTouched(true)
    const payload = buildSubmit()
    if (!payload) return

    setIsSubmitting(true)
    try {
      await onSubmit(payload)
    } catch (error) {
      logger.error('Provider editor submit failed', error as Error)
      window.toast.error(t('settings.provider.save_failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const title = (() => {
    if (!mode) return t('settings.provider.add.title')
    if (mode.kind === 'edit') return t('common.edit')
    if (mode.kind === 'duplicate') {
      const presetLabel = mode.source.presetProviderId
        ? t(getProviderLabelKey(mode.source.presetProviderId))
        : mode.source.name
      return t('settings.provider.duplicate.drawer_title', { name: presetLabel })
    }
    return t('settings.provider.create_custom.title')
  })()

  const submitLabel = (() => {
    if (mode?.kind === 'edit') return t('common.save')
    if (mode?.kind === 'duplicate') return t('settings.provider.duplicate.menu_label')
    return t('button.add')
  })()

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button disabled={!submittable || isSubmitting} loading={isSubmitting} onClick={() => void handleSubmit()}>
        {submitLabel}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer open={open} onClose={onClose} title={title} footer={footer}>
      <div className="flex flex-col gap-5">
        {duplicateSource && duplicateSource.presetProviderId && <DuplicateHeader source={duplicateSource} />}

        <AvatarSection
          uploadInputRef={uploadInputRef}
          name={name}
          logo={logo}
          initialLogo={initialLogo}
          logoPickerOpen={logoPickerOpen}
          editingProviderId={editingProvider?.id}
          avatarBackgroundColor={avatarBackgroundColor}
          avatarForegroundColor={avatarForegroundColor}
          onUpload={(event) => void handleUploadChange(event)}
          onPick={(providerId) => {
            setLogo(`icon:${providerId}`)
            setLogoDirty(true)
            setLogoPickerOpen(false)
          }}
          onReset={() => {
            setLogo(null)
            setLogoDirty(true)
          }}
          onLogoPickerOpenChange={setLogoPickerOpen}
        />

        <NameField
          name={name}
          showError={showNameError}
          onNameChange={setName}
          onBlur={() => setNameTouched(true)}
          onEnter={handleSubmit}
          disableEnter={isSubmitting}
        />

        {urlForm && (
          <>
            <BaseUrlField
              label={t('settings.provider.base_url.label')}
              placeholder={t('settings.provider.base_url.placeholder')}
              value={baseUrl}
              onChange={setBaseUrl}
              required={urlForm.requireBaseUrl}
              error={showBaseUrlError ? t('settings.provider.base_url.required') : undefined}
              onBlur={() => setBaseUrlTouched(true)}
            />
            <ApiKeyField value={apiKey} onChange={setApiKey} />
            <MoreEndpointsDisclosure
              open={moreEndpointsOpen}
              onToggle={() => setMoreEndpointsOpen((v) => !v)}
              primary={urlForm.primary}
              values={secondaryUrls}
              onChange={(type: EndpointType, value: string) => setSecondaryUrls((prev) => ({ ...prev, [type]: value }))}
            />
          </>
        )}

        {duplicateSource && !duplicateNeedsBaseUrl(duplicateSource.authType) && (
          <p className="text-muted-foreground/80 text-xs leading-[1.4]">
            {t('settings.provider.duplicate.fill_after_create')}
          </p>
        )}
      </div>
    </ProviderSettingsDrawer>
  )
}

function DuplicateHeader({ source }: { source: Provider }) {
  const { t } = useTranslation()
  const presetId = source.presetProviderId
  const label = presetId ? t(getProviderLabelKey(presetId)) : source.name
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-muted bg-muted/40 px-3 py-2">
      <ProviderAvatar provider={{ id: presetId ?? source.id, name: label }} size={18} />
      <span className="truncate text-foreground/85 text-sm">{label}</span>
    </div>
  )
}

interface AvatarSectionProps {
  uploadInputRef: React.RefObject<HTMLInputElement | null>
  name: string
  logo: string | null
  initialLogo?: string
  logoPickerOpen: boolean
  editingProviderId?: string
  avatarBackgroundColor?: string
  avatarForegroundColor?: string
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onPick: (providerId: string) => void
  onReset: () => void
  onLogoPickerOpenChange: (open: boolean) => void
}

function AvatarSection({
  uploadInputRef,
  name,
  logo,
  initialLogo,
  logoPickerOpen,
  editingProviderId,
  avatarBackgroundColor,
  avatarForegroundColor,
  onUpload,
  onPick,
  onReset,
  onLogoPickerOpenChange
}: AvatarSectionProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="flex h-19 w-19 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted/50"
        style={
          avatarBackgroundColor && avatarForegroundColor
            ? { backgroundColor: avatarBackgroundColor, color: avatarForegroundColor }
            : undefined
        }>
        <ProviderAvatarPrimitive
          providerId={editingProviderId ?? 'provider-editor-preview'}
          providerName={name || 'Provider'}
          logo={logo ?? undefined}
          size={76}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={() => uploadInputRef.current?.click()}>
          <ImagePlus size={16} />
          {t('settings.general.image_upload')}
        </Button>
        <Popover open={logoPickerOpen} onOpenChange={onLogoPickerOpenChange}>
          <PopoverTrigger asChild>
            <Button variant="outline">{t('settings.general.avatar.builtin')}</Button>
          </PopoverTrigger>
          <PopoverContent align="center" sideOffset={8} className="w-auto">
            <ProviderLogoPicker onProviderClick={onPick} />
          </PopoverContent>
        </Popover>
        <Button variant="outline" disabled={!logo && !initialLogo} onClick={onReset}>
          <RotateCcw size={16} />
          {t('settings.general.avatar.reset')}
        </Button>
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="hidden"
        onChange={onUpload}
      />
    </div>
  )
}

interface NameFieldProps {
  name: string
  showError: boolean
  onNameChange: (value: string) => void
  onBlur: () => void
  onEnter: () => void
  disableEnter: boolean
}

function NameField({ name, showError, onNameChange, onBlur, onEnter, disableEnter }: NameFieldProps) {
  const { t } = useTranslation()
  const uid = useId()
  const inputId = `${uid}-name-input`
  const errorId = `${uid}-name-error`
  return (
    <Field className="gap-2">
      <FieldLabel required htmlFor={inputId} className="text-[13px] text-foreground/85">
        {t('settings.provider.add.name.label')}
      </FieldLabel>
      <Input
        id={inputId}
        value={name}
        placeholder={t('settings.provider.add.name.placeholder')}
        maxLength={32}
        aria-invalid={showError}
        aria-describedby={showError ? errorId : undefined}
        onChange={(event) => onNameChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && !disableEnter) {
            onEnter()
          }
        }}
      />
      <FieldError
        id={errorId}
        className="text-xs"
        errors={showError ? [{ message: t('settings.provider.add.name.required') }] : undefined}
      />
    </Field>
  )
}

interface MoreEndpointsDisclosureProps {
  open: boolean
  onToggle: () => void
  primary: EndpointType
  values: Record<string, string>
  onChange: (type: EndpointType, value: string) => void
}

function MoreEndpointsDisclosure({ open, onToggle, primary, values, onChange }: MoreEndpointsDisclosureProps) {
  const { t } = useTranslation()
  const entries = SECONDARY_ENDPOINT_LABELS.filter((entry) => entry.type !== primary)
  if (entries.length === 0) return null

  return (
    <div>
      <button type="button" onClick={onToggle} className={providerListClasses.disclosureToggle}>
        <ChevronRight
          className={cn(providerListClasses.disclosureChevron, open && providerListClasses.disclosureChevronOpen)}
        />
        <span>{t('settings.provider.more_endpoints.toggle')}</span>
      </button>
      {open && (
        <div className={providerListClasses.disclosureBody}>
          {entries.map(({ type, labelKey }) => (
            <BaseUrlField
              key={type}
              label={t(labelKey)}
              placeholder={t('settings.provider.base_url.placeholder')}
              value={values[type] ?? ''}
              onChange={(value) => onChange(type, value)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface BaseUrlFieldProps {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  error?: string
  onBlur?: () => void
}

function BaseUrlField({ label, placeholder, value, onChange, required, error, onBlur }: BaseUrlFieldProps) {
  const uid = useId()
  const inputId = `${uid}-url-input`
  const errorId = `${uid}-url-error`
  return (
    <Field className="gap-2">
      <FieldLabel required={required} htmlFor={inputId} className="text-[13px] text-foreground">
        {label}
      </FieldLabel>
      <Input
        id={inputId}
        value={value}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <FieldError id={errorId} className="text-xs" errors={error ? [{ message: error }] : undefined} />
    </Field>
  )
}

interface ApiKeyFieldProps {
  value: string
  onChange: (value: string) => void
}

/**
 * Optional first API key for create-flow. Leaving it empty is fine — users
 * who deferred auth can still finish the flow and fill keys on the detail
 * page later. The detail page is the canonical home for key rotation /
 * multi-key / labeling; this drawer only seeds one entry.
 */
function ApiKeyField({ value, onChange }: ApiKeyFieldProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-2">
      <label className="font-medium text-[13px] text-foreground">{t('settings.provider.api_key.label')}</label>
      <div className="relative">
        <Input
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={t('settings.provider.api_key.placeholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={t(visible ? 'settings.provider.api_key.hide_key' : 'settings.provider.api_key.show_key')}
          onClick={() => setVisible((v) => !v)}
          className="-translate-y-1/2 absolute top-1/2 right-2 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground">
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  )
}
