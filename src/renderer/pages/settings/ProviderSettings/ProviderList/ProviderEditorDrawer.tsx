import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Combobox,
  type ComboboxOption,
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import ProviderLogoPicker from '@renderer/components/ProviderLogoPicker'
import { getProviderLabelKey } from '@renderer/i18n/label'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { ProviderImageEndpointFields } from '@renderer/pages/settings/ProviderSettings/components/ProviderImageEndpointFields'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize } from '@renderer/utils/image'
import { cn, generateColorFromChar, getForegroundColor } from '@renderer/utils/style'
import { uuid } from '@renderer/utils/uuid'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, AuthType, EndpointConfig, Provider } from '@shared/data/types/provider'
import { isEmpty } from 'es-toolkit/compat'
import { ChevronRight, Eye, EyeOff, ImagePlus, RotateCcw } from 'lucide-react'
import { type ChangeEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import type { ProviderImageEndpointDraft } from '../utils/providerImageEndpoints'
import {
  buildCustomProviderCreationPayload,
  buildCustomProviderEndpointPreview,
  CUSTOM_PROVIDER_COMPATIBILITY_TYPES,
  CUSTOM_PROVIDER_TEXT_ENDPOINTS,
  type CustomProviderCompatibility,
  type CustomProviderCompatibilityType,
  type CustomProviderCreationInvalidUrl,
  type CustomProviderTextEndpoint,
  findInvalidCustomProviderCreationUrl,
  getCustomProviderPrimaryEndpoint,
  type OpenAiCompatibilityEndpoint
} from './customProviderCreation'
import type { ProviderEditorMode, SubmitProviderEditorParams } from './useProviderEditor'

const logger = loggerService.withContext('ProviderEditorDrawer')

const EMPTY_IMAGE_ENDPOINT_DRAFT: ProviderImageEndpointDraft = {
  imagesBaseUrl: '',
  useSeparateImageEditUrl: false,
  imageEditBaseUrl: ''
}

type ProviderEditorSubmit = SubmitProviderEditorParams

interface ProviderEditorDrawerProps {
  open: boolean
  mode: ProviderEditorMode | null
  initialLogo?: string
  presetSources?: Provider[]
  onClose: () => void
  onSelectPreset?: (source: Provider) => void
  onSubmit: (providerInput: ProviderEditorSubmit) => Promise<void>
}

/**
 * Text endpoint types surfaced in advanced settings. The UI filters out the
 * current primary URL slot, so the same labels work for both compatibility
 * creation and duplicate flows.
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
  presetSources = [],
  onClose,
  onSelectPreset,
  onSubmit
}: ProviderEditorDrawerProps) {
  const { t } = useTranslation()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [secondaryUrls, setSecondaryUrls] = useState<Record<string, string>>({})
  const [moreEndpointsOpen, setMoreEndpointsOpen] = useState(false)
  const [compatibilityType, setCompatibilityType] = useState<CustomProviderCompatibilityType | null>(null)
  const [openAiEndpoint, setOpenAiEndpoint] = useState<OpenAiCompatibilityEndpoint>(
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  )
  const [customEndpoint, setCustomEndpoint] = useState<CustomProviderTextEndpoint>(
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  )
  const [imageEndpointDraft, setImageEndpointDraft] = useState<ProviderImageEndpointDraft>(EMPTY_IMAGE_ENDPOINT_DRAFT)
  const [compatibilityTouched, setCompatibilityTouched] = useState(false)
  const [invalidCreationUrl, setInvalidCreationUrl] = useState<CustomProviderCreationInvalidUrl | null>(null)
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false)
  // `logo` is the preview value only (a preset id / url / object URL for a
  // staged upload). When the user uploads, `stagedFile` holds the raw file whose
  // bytes are sent to `provider.set_logo` on save; a preset/clear leaves it null.
  const [logo, setLogo] = useState<string | null>(null)
  const [stagedFile, setStagedFile] = useState<File | null>(null)
  const [logoDirty, setLogoDirty] = useState(false)
  const [logoPickerOpen, setLogoPickerOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [baseUrlTouched, setBaseUrlTouched] = useState(false)
  const previousOpenRef = useRef(false)
  // Object URL backing the upload preview; revoked when it's replaced or the
  // component unmounts so blobs don't leak.
  const previewObjectUrlRef = useRef<string | null>(null)

  const revokePreviewObjectUrl = () => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
      previewObjectUrlRef.current = null
    }
  }

  useEffect(() => () => revokePreviewObjectUrl(), [])

  const editingProvider = mode?.kind === 'edit' ? mode.provider : null
  const duplicateSource = mode?.kind === 'duplicate' ? mode.source : null

  const urlForm: { primary: EndpointType; requireBaseUrl: boolean } | null = (() => {
    if (!mode || mode.kind === 'edit' || mode.kind === 'create-custom') return null
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
    setCompatibilityType(null)
    setOpenAiEndpoint(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    setCustomEndpoint(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    setImageEndpointDraft(EMPTY_IMAGE_ENDPOINT_DRAFT)
    setCompatibilityTouched(false)
    setInvalidCreationUrl(null)
    setAdvancedSettingsOpen(false)
    setLogoDirty(false)
    setLogoPickerOpen(false)
    revokePreviewObjectUrl()
    setStagedFile(null)
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
  const customCompatibility = useMemo<CustomProviderCompatibility | null>(() => {
    switch (compatibilityType) {
      case 'new-api':
        return { type: 'new-api' }
      case 'anthropic':
        return { type: 'anthropic' }
      case 'gemini':
        return { type: 'gemini' }
      case 'openai':
        return { type: 'openai', endpoint: openAiEndpoint }
      case 'custom':
        return { type: 'custom', endpoint: customEndpoint }
      case null:
        return null
    }
  }, [compatibilityType, customEndpoint, openAiEndpoint])

  const primaryCustomEndpoint = customCompatibility
    ? getCustomProviderPrimaryEndpoint(customCompatibility)
    : ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  const customRequestPreview = customCompatibility
    ? buildCustomProviderEndpointPreview(baseUrl, primaryCustomEndpoint)
    : ''

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const sizeError = checkEntityImageSize(file)
    if (sizeError) {
      toast.error(sizeError)
      return
    }

    // Stage the raw file + preview it via an object URL (revoking any previous
    // one); the bytes are sent to `provider.set_logo` on save. The renderer no
    // longer pre-creates a file_entry, so a bad upload only surfaces on save.
    revokePreviewObjectUrl()
    previewObjectUrlRef.current = URL.createObjectURL(file)
    setLogo(previewObjectUrlRef.current)
    setStagedFile(file)
    setLogoDirty(true)
  }

  const handleSelectPreset = (source: Provider) => {
    // A preset starts a real provider instance. Preserve the user's identity
    // and basic connection fields, but do not leak protocol-specific drafts
    // from Advanced Custom into the duplicate flow.
    setSecondaryUrls({})
    setMoreEndpointsOpen(false)
    setImageEndpointDraft(EMPTY_IMAGE_ENDPOINT_DRAFT)
    setInvalidCreationUrl(null)
    setAdvancedSettingsOpen(false)
    onSelectPreset?.(source)
  }

  const buildSubmit = (): ProviderEditorSubmit | null => {
    const trimmedName = name.trim()
    if (!trimmedName || !mode) return null

    // A staged upload sends its bytes via `provider.set_logo`; a picked icon is a
    // preset key; a reset restores the default. Not dirty → unchanged (the field is omitted).
    const logoEdit: SubmitProviderEditorParams['logo'] = stagedFile
      ? { kind: 'image', file: stagedFile }
      : logoDirty
        ? logo
          ? { kind: 'key', key: logo }
          : { kind: 'default' }
        : undefined
    const logoField = logoEdit ? { logo: logoEdit } : {}

    if (mode.kind === 'edit') {
      return {
        mode: 'edit',
        name: trimmedName,
        defaultChatEndpoint: mode.provider.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        ...logoField
      }
    }

    const trimmedApiKey = apiKey.trim()
    const apiKeysPayload: ApiKeyEntry[] | undefined = trimmedApiKey
      ? [{ id: uuid(), key: trimmedApiKey, isEnabled: true }]
      : undefined

    if (mode.kind === 'create-custom') {
      if (!customCompatibility) return null

      const creationPayload = buildCustomProviderCreationPayload({
        compatibility: customCompatibility,
        baseUrl,
        extraTextEndpointUrls: secondaryUrls,
        imageEndpointDraft
      })
      return {
        mode: 'create',
        name: trimmedName,
        ...creationPayload,
        authConfig: { type: 'api-key' },
        apiKeys: apiKeysPayload,
        ...logoField
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
        ...logoField
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
  const showDuplicateBaseUrlError = Boolean(urlForm?.requireBaseUrl) && baseUrlTouched && !baseUrl.trim()
  const customBaseUrlError =
    mode?.kind === 'create-custom' && baseUrlTouched && invalidCreationUrl?.field === 'baseUrl'
      ? t(baseUrl.trim() ? 'settings.provider.base_url.invalid' : 'settings.provider.base_url.required')
      : undefined

  const handleSubmit = async () => {
    setNameTouched(true)
    setBaseUrlTouched(true)
    if (mode?.kind === 'create-custom') {
      setCompatibilityTouched(true)
      if (!customCompatibility) {
        return
      }
      const invalidUrl = findInvalidCustomProviderCreationUrl({
        compatibility: customCompatibility,
        baseUrl,
        extraTextEndpointUrls: secondaryUrls,
        imageEndpointDraft
      })
      setInvalidCreationUrl(invalidUrl)
      if (invalidUrl) {
        if (invalidUrl.field !== 'baseUrl') {
          setAdvancedSettingsOpen(true)
        }
        return
      }
    }
    const payload = buildSubmit()
    if (!payload) return

    setIsSubmitting(true)
    try {
      await onSubmit(payload)
    } catch (error) {
      logger.error('Provider editor submit failed', error as Error)
      toast.error(t('settings.provider.save_failed'))
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
        {mode?.kind === 'create-custom' ? (
          <>
            <AvatarSection
              uploadInputRef={uploadInputRef}
              name={name}
              logo={logo}
              initialLogo={initialLogo}
              logoPickerOpen={logoPickerOpen}
              editingProviderId={editingProvider?.id}
              avatarBackgroundColor={avatarBackgroundColor}
              avatarForegroundColor={avatarForegroundColor}
              onUpload={(event) => handleUploadChange(event)}
              onPick={(providerId) => {
                revokePreviewObjectUrl()
                setStagedFile(null)
                setLogo(`icon:${providerId}`)
                setLogoDirty(true)
                setLogoPickerOpen(false)
              }}
              onReset={() => {
                revokePreviewObjectUrl()
                setStagedFile(null)
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
            <CompatibilityFields
              value={compatibilityType}
              openAiEndpoint={openAiEndpoint}
              customEndpoint={customEndpoint}
              showError={compatibilityTouched && !compatibilityType}
              onChange={(value) => {
                setCompatibilityType(value)
                setInvalidCreationUrl(null)
              }}
              onOpenAiEndpointChange={(value) => {
                setOpenAiEndpoint(value)
                setInvalidCreationUrl(null)
              }}
              onCustomEndpointChange={(value) => {
                setCustomEndpoint(value)
                setInvalidCreationUrl(null)
              }}
            />

            {compatibilityType === 'custom' && onSelectPreset && presetSources.length > 0 && (
              <PresetInstancePicker sources={presetSources} onSelect={handleSelectPreset} />
            )}

            {customCompatibility && (
              <>
                <BaseUrlField
                  label={t('settings.provider.base_url.label')}
                  placeholder={t('settings.provider.base_url.placeholder')}
                  value={baseUrl}
                  onChange={(value) => {
                    setBaseUrl(value)
                    setInvalidCreationUrl(null)
                  }}
                  required
                  error={customBaseUrlError}
                  description={
                    customRequestPreview
                      ? t('settings.provider.create_custom.request_preview', { path: customRequestPreview })
                      : undefined
                  }
                  onBlur={() => {
                    setBaseUrlTouched(true)
                    const invalidUrl = findInvalidCustomProviderCreationUrl({
                      compatibility: customCompatibility,
                      baseUrl,
                      extraTextEndpointUrls: secondaryUrls,
                      imageEndpointDraft
                    })
                    setInvalidCreationUrl(invalidUrl?.field === 'baseUrl' ? invalidUrl : null)
                  }}
                />
                <ApiKeyField value={apiKey} onChange={setApiKey} />

                <Accordion
                  type="single"
                  collapsible
                  value={advancedSettingsOpen ? 'advanced' : ''}
                  onValueChange={(value) => setAdvancedSettingsOpen(value === 'advanced')}>
                  <AccordionItem value="advanced" className="border-border/60">
                    <AccordionTrigger className="min-h-10 py-2.5">
                      <span className="flex flex-col gap-0.5">
                        <span>{t('settings.provider.create_custom.advanced.label')}</span>
                        <span className="font-normal text-foreground-muted text-xs">
                          {t('settings.provider.create_custom.advanced.description')}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="flex flex-col gap-5 pt-3">
                      <div className="flex flex-col gap-1">
                        <h3 className="font-medium text-[13px] text-foreground">
                          {t('settings.provider.create_custom.advanced.extra_text_urls')}
                        </h3>
                        <p className="text-foreground-muted text-xs">
                          {t('settings.provider.create_custom.advanced.extra_text_urls_help')}
                        </p>
                      </div>
                      {SECONDARY_ENDPOINT_LABELS.filter(({ type }) => type !== primaryCustomEndpoint).map(
                        ({ type, labelKey }) => {
                          const invalidExtraEndpoint =
                            invalidCreationUrl?.field === 'extraTextEndpointUrl' &&
                            invalidCreationUrl.endpointType === type
                          return (
                            <BaseUrlField
                              key={type}
                              label={t(labelKey)}
                              placeholder={t('settings.provider.base_url.placeholder')}
                              value={secondaryUrls[type] ?? ''}
                              error={invalidExtraEndpoint ? t('settings.provider.base_url.invalid') : undefined}
                              onChange={(value) => {
                                setSecondaryUrls((previous) => ({ ...previous, [type]: value }))
                                setInvalidCreationUrl(null)
                              }}
                            />
                          )
                        }
                      )}
                      <ProviderImageEndpointFields
                        value={imageEndpointDraft}
                        invalidField={
                          invalidCreationUrl?.field === 'imagesBaseUrl' ||
                          invalidCreationUrl?.field === 'imageEditBaseUrl'
                            ? invalidCreationUrl.field
                            : undefined
                        }
                        onChange={(value) => {
                          setImageEndpointDraft(value)
                          setInvalidCreationUrl(null)
                        }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </>
            )}
          </>
        ) : (
          <>
            <AvatarSection
              uploadInputRef={uploadInputRef}
              name={name}
              logo={logo}
              initialLogo={initialLogo}
              logoPickerOpen={logoPickerOpen}
              editingProviderId={editingProvider?.id}
              avatarBackgroundColor={avatarBackgroundColor}
              avatarForegroundColor={avatarForegroundColor}
              onUpload={(event) => handleUploadChange(event)}
              onPick={(providerId) => {
                revokePreviewObjectUrl()
                setStagedFile(null)
                setLogo(`icon:${providerId}`)
                setLogoDirty(true)
                setLogoPickerOpen(false)
              }}
              onReset={() => {
                revokePreviewObjectUrl()
                setStagedFile(null)
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

            {duplicateSource?.presetProviderId && <DuplicateHeader source={duplicateSource} />}

            {urlForm && (
              <>
                <BaseUrlField
                  label={t('settings.provider.base_url.label')}
                  placeholder={t('settings.provider.base_url.placeholder')}
                  value={baseUrl}
                  onChange={setBaseUrl}
                  required={urlForm.requireBaseUrl}
                  error={showDuplicateBaseUrlError ? t('settings.provider.base_url.required') : undefined}
                  onBlur={() => setBaseUrlTouched(true)}
                />
                <ApiKeyField value={apiKey} onChange={setApiKey} />
                <MoreEndpointsDisclosure
                  open={moreEndpointsOpen}
                  onToggle={() => setMoreEndpointsOpen((v) => !v)}
                  primary={urlForm.primary}
                  values={secondaryUrls}
                  onChange={(type: EndpointType, value: string) =>
                    setSecondaryUrls((prev) => ({ ...prev, [type]: value }))
                  }
                />
              </>
            )}
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

const COMPATIBILITY_LABEL_KEYS: Record<CustomProviderCompatibilityType, { label: string; description: string }> = {
  'new-api': {
    label: 'settings.provider.create_custom.compatibility.new_api.label',
    description: 'settings.provider.create_custom.compatibility.new_api.description'
  },
  openai: {
    label: 'settings.provider.create_custom.compatibility.openai.label',
    description: 'settings.provider.create_custom.compatibility.openai.description'
  },
  anthropic: {
    label: 'settings.provider.create_custom.compatibility.anthropic.label',
    description: 'settings.provider.create_custom.compatibility.anthropic.description'
  },
  gemini: {
    label: 'settings.provider.create_custom.compatibility.gemini.label',
    description: 'settings.provider.create_custom.compatibility.gemini.description'
  },
  custom: {
    label: 'settings.provider.create_custom.compatibility.custom.label',
    description: 'settings.provider.create_custom.compatibility.custom.description'
  }
}

interface CompatibilityFieldsProps {
  value: CustomProviderCompatibilityType | null
  openAiEndpoint: OpenAiCompatibilityEndpoint
  customEndpoint: CustomProviderTextEndpoint
  showError: boolean
  onChange: (value: CustomProviderCompatibilityType) => void
  onOpenAiEndpointChange: (value: OpenAiCompatibilityEndpoint) => void
  onCustomEndpointChange: (value: CustomProviderTextEndpoint) => void
}

function CompatibilityFields({
  value,
  openAiEndpoint,
  customEndpoint,
  showError,
  onChange,
  onOpenAiEndpointChange,
  onCustomEndpointChange
}: CompatibilityFieldsProps) {
  const { t } = useTranslation()
  const uid = useId()
  const descriptionId = `${uid}-description`
  const errorId = `${uid}-error`

  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="mb-0 flex items-center gap-1 text-[13px] text-foreground">
        {t('settings.provider.create_custom.compatibility.label')}
        <span aria-hidden className="text-destructive">
          *
        </span>
      </FieldLegend>
      <p id={descriptionId} className="text-foreground-muted text-xs">
        {t('settings.provider.create_custom.compatibility.description')}
      </p>
      <Select value={value ?? ''} onValueChange={(nextValue) => onChange(nextValue as CustomProviderCompatibilityType)}>
        <SelectTrigger
          className="min-h-10 w-full"
          aria-label={t('settings.provider.create_custom.compatibility.label')}
          aria-describedby={showError ? `${descriptionId} ${errorId}` : descriptionId}
          aria-invalid={showError}>
          <SelectValue placeholder={t('settings.provider.create_custom.compatibility.placeholder')} />
        </SelectTrigger>
        <SelectContent align="start">
          {CUSTOM_PROVIDER_COMPATIBILITY_TYPES.map((type) => (
            <SelectItem key={type} value={type} className="min-h-10">
              {t(COMPATIBILITY_LABEL_KEYS[type].label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && <p className="text-foreground-muted text-xs">{t(COMPATIBILITY_LABEL_KEYS[value].description)}</p>}
      <FieldError
        id={errorId}
        className="text-xs"
        errors={showError ? [{ message: t('settings.provider.create_custom.compatibility.required') }] : undefined}
      />

      {value === 'openai' && (
        <ProtocolRadioGroup
          label={t('settings.provider.create_custom.openai_protocol.label')}
          value={openAiEndpoint}
          options={[
            {
              value: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
              label: t('settings.provider.create_custom.openai_protocol.chat.label'),
              description: t('settings.provider.create_custom.openai_protocol.chat.description')
            },
            {
              value: ENDPOINT_TYPE.OPENAI_RESPONSES,
              label: t('settings.provider.create_custom.openai_protocol.responses.label'),
              description: t('settings.provider.create_custom.openai_protocol.responses.description')
            }
          ]}
          onChange={(nextValue) => onOpenAiEndpointChange(nextValue as OpenAiCompatibilityEndpoint)}
        />
      )}

      {value === 'custom' && (
        <ProtocolRadioGroup
          label={t('settings.provider.create_custom.custom_protocol.label')}
          value={customEndpoint}
          options={CUSTOM_PROVIDER_TEXT_ENDPOINTS.map((type) => ({
            value: type,
            label: t(SECONDARY_ENDPOINT_LABELS.find((entry) => entry.type === type)?.labelKey ?? type)
          }))}
          onChange={(nextValue) => onCustomEndpointChange(nextValue as CustomProviderTextEndpoint)}
        />
      )}
    </FieldSet>
  )
}

interface ProtocolRadioGroupProps {
  label: string
  value: string
  options: Array<{ value: string; label: string; description?: string }>
  onChange: (value: string) => void
}

function ProtocolRadioGroup({ label, value, options, onChange }: ProtocolRadioGroupProps) {
  const uid = useId()
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg bg-muted/35 p-3">
      <span className="font-medium text-foreground text-xs">{label}</span>
      <RadioGroup value={value} onValueChange={onChange} className="gap-2">
        {options.map((option) => {
          const optionId = `${uid}-${option.value}`
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                'flex min-h-10 cursor-pointer items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2',
                'transition-[background-color,border-color] duration-150 hover:bg-background/60',
                value === option.value && 'border-border bg-background/80'
              )}>
              <RadioGroupItem id={optionId} value={option.value} size="sm" className="mt-0.5" />
              <span>
                <span className="block font-medium text-foreground text-xs">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-[11px] text-foreground-muted">{option.description}</span>
                )}
              </span>
            </label>
          )
        })}
      </RadioGroup>
    </div>
  )
}

type PresetProviderOption = ComboboxOption<{ source: Provider }>

function PresetInstancePicker({ sources, onSelect }: { sources: Provider[]; onSelect: (source: Provider) => void }) {
  const { t } = useTranslation()
  const options = useMemo<PresetProviderOption[]>(
    () =>
      sources.map((source) => {
        const presetId = source.presetProviderId ?? source.id
        const label = t(getProviderLabelKey(presetId))
        return {
          value: source.id,
          label,
          icon: <ProviderAvatar provider={{ id: presetId, name: label }} size={20} />,
          source
        }
      }),
    [sources, t]
  )

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-muted bg-muted/25 p-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-[13px] text-foreground">
          {t('settings.provider.create_custom.preset_instance.title')}
        </span>
        <span className="text-foreground-muted text-xs">
          {t('settings.provider.create_custom.preset_instance.description')}
        </span>
      </div>
      <Combobox
        options={options}
        value=""
        onChange={(value) => {
          const selectedValue = Array.isArray(value) ? value[0] : value
          const selected = options.find((option) => option.value === selectedValue)
          if (selected) {
            onSelect(selected.source)
          }
        }}
        className="min-h-10 w-full justify-between px-3 text-left font-normal"
        emptyText={t('settings.provider.create_custom.preset_instance.empty')}
        filterOption={(option, search) => {
          const haystack = `${option.label} ${option.value} ${option.source.name}`.toLocaleLowerCase()
          return haystack.includes(search.trim().toLocaleLowerCase())
        }}
        placeholder={t('settings.provider.create_custom.preset_instance.placeholder')}
        popoverClassName="w-(--radix-popover-trigger-width) [&_[data-slot=command-list]]:max-h-[280px]"
        searchPlaceholder={t('settings.provider.create_custom.preset_instance.search_placeholder')}
      />
    </div>
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
  const uid = useId()
  const contentId = `${uid}-more-endpoints`
  const entries = SECONDARY_ENDPOINT_LABELS.filter((entry) => entry.type !== primary)
  if (entries.length === 0) return null

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className={providerListClasses.disclosureToggle}>
        <ChevronRight
          className={cn(providerListClasses.disclosureChevron, open && providerListClasses.disclosureChevronOpen)}
        />
        <span>{t('settings.provider.more_endpoints.toggle')}</span>
      </button>
      {open && (
        <div id={contentId} className={providerListClasses.disclosureBody}>
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
  description?: string
  onBlur?: () => void
}

function BaseUrlField({
  label,
  placeholder,
  value,
  onChange,
  required,
  error,
  description,
  onBlur
}: BaseUrlFieldProps) {
  const uid = useId()
  const inputId = `${uid}-url-input`
  const errorId = `${uid}-url-error`
  const descriptionId = `${uid}-url-description`
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
        aria-describedby={
          [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
        }
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {description && (
        <p id={descriptionId} aria-live="polite" className="break-all text-foreground-muted text-xs">
          {description}
        </p>
      )}
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
  const uid = useId()
  const inputId = `${uid}-api-key-input`

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="font-medium text-[13px] text-foreground">
        {t('settings.provider.api_key.label')}
      </label>
      <div className="relative">
        <Input
          id={inputId}
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
          className="-translate-y-1/2 absolute top-1/2 right-0 flex size-10 items-center justify-center rounded-md text-muted-foreground/70 transition-colors duration-150 hover:bg-accent/40 hover:text-foreground">
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  )
}
