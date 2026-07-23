import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  Separator
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import ProviderLogoPicker from '@renderer/components/ProviderLogoPicker'
import { getProviderLabelKey } from '@renderer/i18n/label'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize } from '@renderer/utils/image'
import { cn, generateColorFromChar, getForegroundColor } from '@renderer/utils/style'
import { uuid } from '@renderer/utils/uuid'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, AuthType, EndpointConfig, Provider } from '@shared/data/types/provider'
import { isEmpty } from 'es-toolkit/compat'
import { ChevronRight, Eye, EyeOff, ImagePlus, RotateCcw } from 'lucide-react'
import { type ChangeEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import {
  buildCustomProviderCreationPayload,
  buildCustomProviderEndpointPreview,
  CUSTOM_PROVIDER_ENDPOINTS,
  CUSTOM_PROVIDER_TEXT_ENDPOINTS,
  type CustomProviderCreationInvalidUrl,
  type CustomProviderEndpoint,
  type CustomProviderEndpointUrls,
  type CustomProviderTextEndpoint,
  findInvalidCustomProviderCreationUrl,
  getCustomProviderDefaultChatEndpoint
} from './customProviderCreation'
import type { ProviderEditorMode, SubmitProviderEditorParams } from './useProviderEditor'

const logger = loggerService.withContext('ProviderEditorDrawer')

type ProviderEditorSubmit = SubmitProviderEditorParams

const COMMON_CUSTOM_PROVIDER_ENDPOINTS = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES
] as const

const ADDITIONAL_CUSTOM_PROVIDER_ENDPOINTS = [
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
] as const

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

function isCustomProviderTextEndpoint(endpointType: EndpointType): endpointType is CustomProviderTextEndpoint {
  return CUSTOM_PROVIDER_TEXT_ENDPOINTS.some((type) => type === endpointType)
}

function mergeSecondaryEndpoints(
  target: Partial<Record<EndpointType, EndpointConfig>>,
  secondaryUrls: Record<string, string>,
  primary: EndpointType
) {
  for (const type of CUSTOM_PROVIDER_ENDPOINTS) {
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
  const [endpointUrls, setEndpointUrls] = useState<CustomProviderEndpointUrls>({})
  const [preferredChatEndpoint, setPreferredChatEndpoint] = useState<CustomProviderTextEndpoint>(
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  )
  const [invalidCreationUrl, setInvalidCreationUrl] = useState<CustomProviderCreationInvalidUrl | null>(null)
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
  const duplicateUsesEndpointFields = Boolean(
    duplicateSource &&
      urlForm &&
      (duplicateSource.presetProviderId === 'new-api' || isCustomProviderTextEndpoint(urlForm.primary))
  )
  const duplicateDefaultTextEndpoint =
    urlForm && isCustomProviderTextEndpoint(urlForm.primary) ? urlForm.primary : ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  const duplicateEndpointUrls = useMemo<CustomProviderEndpointUrls>(() => {
    if (!duplicateUsesEndpointFields || !urlForm) {
      return {}
    }

    const values: CustomProviderEndpointUrls = {}
    for (const endpointType of CUSTOM_PROVIDER_ENDPOINTS) {
      const override = secondaryUrls[endpointType]
      if (override?.trim()) {
        values[endpointType] = override
      }
    }

    if (duplicateSource?.presetProviderId === 'new-api') {
      for (const endpointType of CUSTOM_PROVIDER_TEXT_ENDPOINTS) {
        if (!values[endpointType]?.trim()) {
          values[endpointType] = baseUrl
        }
      }
    } else {
      values[duplicateDefaultTextEndpoint] = baseUrl
    }

    return values
  }, [
    baseUrl,
    duplicateDefaultTextEndpoint,
    duplicateSource?.presetProviderId,
    duplicateUsesEndpointFields,
    secondaryUrls,
    urlForm
  ])

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
    setEndpointUrls({})
    const initialDefaultEndpoint =
      duplicateSource?.defaultChatEndpoint && isCustomProviderTextEndpoint(duplicateSource.defaultChatEndpoint)
        ? duplicateSource.defaultChatEndpoint
        : ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    setPreferredChatEndpoint(initialDefaultEndpoint)
    setInvalidCreationUrl(null)
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

  const handleEndpointUrlChange = (endpointType: CustomProviderEndpoint, value: string) => {
    const nextEndpointUrls = { ...endpointUrls, [endpointType]: value }
    setEndpointUrls(nextEndpointUrls)
    if (CUSTOM_PROVIDER_TEXT_ENDPOINTS.some((type) => type === endpointType)) {
      const textEndpoint = endpointType as CustomProviderTextEndpoint
      const configuredTextEndpoints = CUSTOM_PROVIDER_TEXT_ENDPOINTS.filter((type) => nextEndpointUrls[type]?.trim())
      if (configuredTextEndpoints.length === 1 && configuredTextEndpoints[0] === textEndpoint) {
        setPreferredChatEndpoint(textEndpoint)
      } else if (!nextEndpointUrls[preferredChatEndpoint]?.trim()) {
        setPreferredChatEndpoint(configuredTextEndpoints[0] ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
      }
    }
    setInvalidCreationUrl(null)
  }

  const handleSelectPreset = (source: Provider) => {
    // A preset starts a real provider instance. Preserve the user's identity
    // and the current default text URL, but do not leak endpoint-specific
    // drafts into the duplicate flow.
    const defaultEndpoint = getCustomProviderDefaultChatEndpoint(endpointUrls, preferredChatEndpoint)
    const defaultEndpointUrl = endpointUrls[defaultEndpoint]?.trim()
    if (defaultEndpointUrl) {
      setBaseUrl(defaultEndpointUrl)
    }
    setPreferredChatEndpoint(
      source.defaultChatEndpoint && isCustomProviderTextEndpoint(source.defaultChatEndpoint)
        ? source.defaultChatEndpoint
        : ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    )
    setSecondaryUrls({})
    setMoreEndpointsOpen(false)
    setEndpointUrls({})
    setInvalidCreationUrl(null)
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
      const creationPayload = buildCustomProviderCreationPayload({
        endpointUrls,
        preferredChatEndpoint
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
          const primaryEndpoints =
            source.presetProviderId === 'new-api' ? CUSTOM_PROVIDER_TEXT_ENDPOINTS : [defaultChatEndpoint]
          for (const endpointType of primaryEndpoints) {
            endpointConfigs[endpointType] = { baseUrl: trimmedBaseUrl }
          }
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

  const handleSubmit = async () => {
    setNameTouched(true)
    setBaseUrlTouched(true)
    if (mode?.kind === 'create-custom') {
      const invalidUrl = findInvalidCustomProviderCreationUrl({
        endpointUrls,
        preferredChatEndpoint
      })
      setInvalidCreationUrl(invalidUrl)
      if (invalidUrl) {
        if (
          invalidUrl.field === 'endpointUrl' &&
          ADDITIONAL_CUSTOM_PROVIDER_ENDPOINTS.some((endpointType) => endpointType === invalidUrl.endpointType)
        ) {
          setMoreEndpointsOpen(true)
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

  const footerActions = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button disabled={!submittable || isSubmitting} loading={isSubmitting} onClick={() => void handleSubmit()}>
        {submitLabel}
      </Button>
    </div>
  )

  const avatarSection = (
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
  )

  const nameField = (
    <NameField
      name={name}
      showError={showNameError}
      onNameChange={setName}
      onBlur={() => setNameTouched(true)}
      onEnter={handleSubmit}
      disableEnter={isSubmitting}
    />
  )
  const customAdditionalConfiguredCount = ADDITIONAL_CUSTOM_PROVIDER_ENDPOINTS.filter((endpointType) =>
    endpointUrls[endpointType]?.trim()
  ).length
  const duplicateAdditionalConfiguredCount = ADDITIONAL_CUSTOM_PROVIDER_ENDPOINTS.filter((endpointType) =>
    endpointType === urlForm?.primary ? baseUrl.trim() : secondaryUrls[endpointType]?.trim()
  ).length

  const formContent = (
    <div className="flex flex-col gap-5">
      {avatarSection}
      {nameField}

      {mode?.kind === 'create-custom' ? (
        <>
          <ApiKeyField value={apiKey} onChange={setApiKey} />
          <CustomProviderEndpointFields
            endpointUrls={endpointUrls}
            preferredChatEndpoint={preferredChatEndpoint}
            invalidUrl={invalidCreationUrl}
            moreOpen={moreEndpointsOpen}
            additionalConfiguredCount={customAdditionalConfiguredCount}
            additionalContent={
              onSelectPreset && presetSources.length > 0 ? (
                <PresetInstancePicker sources={presetSources} onSelect={handleSelectPreset} />
              ) : undefined
            }
            onMoreOpenChange={setMoreEndpointsOpen}
            onEndpointUrlChange={handleEndpointUrlChange}
            onPreferredChatEndpointChange={setPreferredChatEndpoint}
          />
        </>
      ) : (
        <>
          {duplicateSource?.presetProviderId && <DuplicateHeader source={duplicateSource} />}

          {urlForm &&
            (duplicateUsesEndpointFields ? (
              <>
                <ApiKeyField value={apiKey} onChange={setApiKey} />
                <CustomProviderEndpointFields
                  endpointUrls={duplicateEndpointUrls}
                  preferredChatEndpoint={duplicateDefaultTextEndpoint}
                  invalidUrl={null}
                  moreOpen={moreEndpointsOpen}
                  additionalConfiguredCount={duplicateAdditionalConfiguredCount}
                  onMoreOpenChange={setMoreEndpointsOpen}
                  onEndpointUrlChange={(endpointType, value) => {
                    if (endpointType === urlForm.primary) {
                      setBaseUrl(value)
                    } else {
                      setSecondaryUrls((prev) => ({ ...prev, [endpointType]: value }))
                    }
                  }}
                />
              </>
            ) : (
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
            ))}
        </>
      )}

      {duplicateSource && !duplicateNeedsBaseUrl(duplicateSource.authType) && (
        <p className="text-muted-foreground/80 text-xs leading-[1.4]">
          {t('settings.provider.duplicate.fill_after_create')}
        </p>
      )}
    </div>
  )

  if (mode?.kind === 'edit') {
    return (
      <ProviderSettingsDrawer open={open} onClose={onClose} title={title} footer={footerActions}>
        {formContent}
      </ProviderSettingsDrawer>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          onClose()
        }
      }}>
      <DialogContent
        aria-describedby={undefined}
        closeOnOverlayClick={!isSubmitting}
        showCloseButton={!isSubmitting}
        size="xl"
        data-testid="provider-editor-dialog"
        className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-base leading-5">{title}</DialogTitle>
        </DialogHeader>
        <Scrollbar data-testid="provider-editor-scrollbar" className="min-h-0 px-6 py-2">
          {formContent}
        </Scrollbar>
        <DialogFooter className="mt-4 border-border border-t px-6 py-4">{footerActions}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CUSTOM_PROVIDER_ENDPOINT_LABEL_KEYS: Record<CustomProviderEndpoint, string> = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'settings.provider.more_endpoints.openai_chat',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'settings.provider.more_endpoints.openai_responses',
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'settings.provider.more_endpoints.anthropic',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: 'settings.provider.more_endpoints.gemini',
  [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: 'settings.provider.image_endpoints.image_generation_base_url.label',
  [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: 'settings.provider.image_endpoints.image_edit_base_url.label'
}

interface CustomProviderEndpointFieldsProps {
  endpointUrls: CustomProviderEndpointUrls
  preferredChatEndpoint: CustomProviderTextEndpoint
  invalidUrl: CustomProviderCreationInvalidUrl | null
  moreOpen: boolean
  additionalConfiguredCount: number
  additionalContent?: ReactNode
  onMoreOpenChange: (open: boolean) => void
  onEndpointUrlChange: (endpointType: CustomProviderEndpoint, value: string) => void
  onPreferredChatEndpointChange?: (endpointType: CustomProviderTextEndpoint) => void
}

function CustomProviderEndpointFields({
  endpointUrls,
  preferredChatEndpoint,
  invalidUrl,
  moreOpen,
  additionalConfiguredCount,
  additionalContent,
  onMoreOpenChange,
  onEndpointUrlChange,
  onPreferredChatEndpointChange
}: CustomProviderEndpointFieldsProps) {
  const { t } = useTranslation()
  const textEndpointRequired = invalidUrl?.field === 'textEndpointRequired'

  const renderEndpointField = (endpointType: CustomProviderEndpoint, labelAccessory?: ReactNode) => {
    const endpointValue = endpointUrls[endpointType] ?? ''
    const invalidEndpoint = invalidUrl?.field === 'endpointUrl' && invalidUrl.endpointType === endpointType
    const requestPreview = buildCustomProviderEndpointPreview(endpointValue, endpointType)
    const emptyValueHelp = CUSTOM_PROVIDER_TEXT_ENDPOINTS.some((type) => type === endpointType)
      ? t('settings.provider.create_custom.endpoint_fields.url_help')
      : t(
          endpointType === ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION
            ? 'settings.provider.image_endpoints.image_generation_base_url.help'
            : 'settings.provider.image_endpoints.image_edit_base_url.help'
        )

    return (
      <BaseUrlField
        label={t(CUSTOM_PROVIDER_ENDPOINT_LABEL_KEYS[endpointType])}
        placeholder={t('settings.provider.base_url.placeholder')}
        value={endpointValue}
        error={invalidEndpoint ? t('settings.provider.base_url.invalid') : undefined}
        description={
          requestPreview
            ? t('settings.provider.create_custom.request_preview', { path: requestPreview })
            : emptyValueHelp
        }
        labelAccessory={labelAccessory}
        onChange={(nextValue) => onEndpointUrlChange(endpointType, nextValue)}
      />
    )
  }

  const renderEndpointControl = (endpointType: CustomProviderEndpoint) => {
    const isConfiguredTextEndpoint =
      CUSTOM_PROVIDER_TEXT_ENDPOINTS.some((type) => type === endpointType) && endpointUrls[endpointType]?.trim()
    const labelAccessory = isConfiguredTextEndpoint ? (
      preferredChatEndpoint === endpointType ? (
        <Badge variant="secondary" className="h-5 border-0 px-1.5 py-0 font-normal text-foreground-muted text-xs">
          {t('settings.provider.create_custom.endpoint_fields.default_chat')}
        </Badge>
      ) : onPreferredChatEndpointChange ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="before:-top-5 relative h-5 min-h-0 rounded-full px-2 text-xs transition-transform before:absolute before:inset-x-0 before:bottom-0 before:content-[''] active:scale-[0.96]"
          onClick={() => onPreferredChatEndpointChange(endpointType as CustomProviderTextEndpoint)}>
          {t('settings.provider.create_custom.endpoint_fields.set_default_chat')}
        </Button>
      ) : null
    ) : null

    return <div key={endpointType}>{renderEndpointField(endpointType, labelAccessory)}</div>
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="custom-provider-endpoints-title">
      <h3 id="custom-provider-endpoints-title" className="font-medium text-[13px] text-foreground">
        {t('settings.provider.create_custom.endpoint_fields.label')}
      </h3>

      <div className="flex flex-col gap-5">{COMMON_CUSTOM_PROVIDER_ENDPOINTS.map(renderEndpointControl)}</div>

      <Accordion
        type="single"
        collapsible
        value={moreOpen ? 'more-settings' : ''}
        onValueChange={(value) => onMoreOpenChange(value === 'more-settings')}>
        <AccordionItem value="more-settings" className="border-0">
          <AccordionTrigger className="min-h-10 cursor-pointer py-0 font-normal text-muted-foreground text-xs hover:text-foreground disabled:cursor-not-allowed">
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span>{t('settings.provider.create_custom.endpoint_fields.more')}</span>
              {additionalConfiguredCount > 0 && (
                <span className="truncate text-foreground-muted">
                  {t('settings.provider.create_custom.endpoint_fields.more_configured', {
                    count: additionalConfiguredCount
                  })}
                </span>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-5 pt-3 pb-0 text-foreground">
            {ADDITIONAL_CUSTOM_PROVIDER_ENDPOINTS.map(renderEndpointControl)}
            {additionalContent && (
              <>
                <Separator className="bg-border-muted" />
                {additionalContent}
              </>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <FieldError
        className="text-xs"
        errors={
          textEndpointRequired
            ? [{ message: t('settings.provider.create_custom.endpoint_fields.text_endpoint_required') }]
            : undefined
        }
      />
    </section>
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
    <div className="flex flex-col gap-2">
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
        className={cn(providerListClasses.disclosureToggle, 'px-0')}>
        <ChevronRight
          className={cn(providerListClasses.disclosureChevron, open && providerListClasses.disclosureChevronOpen)}
        />
        <span>{t('settings.provider.more_endpoints.toggle')}</span>
      </button>
      {open && (
        <div id={contentId} className={cn(providerListClasses.disclosureBody, 'pl-0')}>
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
  labelAccessory?: ReactNode
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
  labelAccessory,
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
      <div className="flex min-h-5 items-center gap-2">
        <FieldLabel required={required} htmlFor={inputId} className="text-[13px] text-foreground">
          {label}
        </FieldLabel>
        {labelAccessory}
      </div>
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
    <Field className="gap-2">
      <FieldLabel htmlFor={inputId} className="text-[13px] text-foreground">
        {t('settings.provider.api_key.label')}
      </FieldLabel>
      <div className="relative">
        <Input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={t('settings.provider.api_key.placeholder')}
          className="pr-10"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={t(visible ? 'settings.provider.api_key.hide_key' : 'settings.provider.api_key.show_key')}
          onClick={() => setVisible((v) => !v)}
          className="-translate-y-1/2 absolute top-1/2 right-0 text-muted-foreground/70 hover:text-foreground">
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      </div>
    </Field>
  )
}
