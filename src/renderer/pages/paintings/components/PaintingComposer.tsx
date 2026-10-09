import { Settings2 } from 'lucide-react'
import { type FC, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ImageOperationSchema, resolveImageCapability } from '@cherrystudio/provider-registry'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ComposerSurface from '@renderer/components/composer/ComposerSurface'
import {
  ComposerToolDerivedStateProvider,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerTokenReconcile,
  useComposerToolDispatch,
  useComposerToolLauncherActions,
  useComposerToolLauncherVersion,
  useComposerToolState
} from '@renderer/components/composer/ComposerToolRuntime'
import type { ComposerDraftToken } from '@renderer/components/composer/tokens'
import { getComposerToolConfig } from '@renderer/components/composer/tools/registry'
import {
  COMPOSER_SELECTOR_BUTTON_CLASS,
  ComposerToolbarControls
} from '@renderer/components/composer/variants/shared/ComposerControlScaffolding'
import { fileToComposerToken } from '@renderer/components/composer/variants/shared/composerTokens'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useModels } from '@renderer/hooks/useModel'
import { FILE_TYPE } from '@renderer/types/file'
import type { Model } from '@shared/data/types/model'
import { imageExts } from '@shared/utils/file'

import { type BaseConfigItem, isOptionsConfigItem } from '../form/baseConfigItem'
import { controlValue, finiteParamNumberOr, optionalFiniteNumber } from '../form/fieldValue'
import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { SIZE_PREVIEW_KEYS, sizeOptionLabel } from '../form/paintingSize'
import { resolveOptions, resolveOptionValue } from '../form/resolveOptions'
import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import { type InputCapability, usePaintingComposerInputFiles } from '../hooks/usePaintingComposerInputFiles'
import type { MaterializeInputs } from '../hooks/usePaintingGenerationSubmit'
import type { PaintingModelSelection } from '../hooks/usePaintingModelSwitch'
import type { PaintingData } from '../model/types/paintingData'
import { paintingOperation } from '../utils/paintingProviderMode'
import { PaintingImageAddButton, PaintingImageGallery } from './PaintingImageGallery'
import PaintingModelSelector from './PaintingModelSelector'
import PaintingSettings from './PaintingSettings'

const PAINTING_MANAGED_TOKEN_KINDS: readonly ComposerDraftToken['kind'][] = ['file']
// The reference-image tray owns image inputs, so it does not reconcile file pills.
const PAINTING_NO_MANAGED_TOKEN_KINDS: readonly ComposerDraftToken['kind'][] = []
const EMPTY_TOKENS: readonly ComposerDraftToken[] = []
const PAINTING_IMAGE_EXTS = imageExts.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
const PAINTING_SCOPE = 'painting' as const

/** Field types worth surfacing in the compact button summary. */
const SUMMARY_TYPES = new Set<BaseConfigItem['type']>([
  'select',
  'sizeChips',
  'slider',
  'radio',
  'iconRadio',
  'styleToggle'
])

type SummaryConfigItem = Extract<
  BaseConfigItem,
  { type: 'select' | 'sizeChips' | 'slider' | 'radio' | 'iconRadio' | 'styleToggle' }
>

function isSummaryConfigItem(item: BaseConfigItem): item is SummaryConfigItem {
  return SUMMARY_TYPES.has(item.type)
}

function formatSummaryValue(
  item: SummaryConfigItem,
  value: unknown,
  params: PaintingData['params'],
  translate: (key: string) => string
): string | undefined {
  // Size-bearing fields render as chip-style dimensions, matching the size chips.
  if ((SIZE_PREVIEW_KEYS as readonly string[]).includes(item.key ?? '')) {
    if (value === 'custom') {
      const width = optionalFiniteNumber(params?.customSize_width)
      const height = optionalFiniteNumber(params?.customSize_height)
      return width !== null && height !== null && width > 0 && height > 0 ? `${width}×${height}` : undefined
    }
    // Localize the selected option (e.g. `auto` → `自动`) the same way the chips
    // and the artboard prompt bar do, instead of formatting the raw enum.
    return isOptionsConfigItem(item) ? sizeOptionLabel(item, controlValue(value), params, translate) : undefined
  }
  if (item.type === 'slider') return `${finiteParamNumberOr(item.key, value, item.initialValue)}`
  // Option-based: show the selected option's localized label.
  const formattedValue = controlValue(value)
  const match = resolveOptions(item, params ?? {}, translate).find((opt) => controlValue(opt.value) === formattedValue)
  return match?.label ?? formattedValue
}

/**
 * Compact summary of the current parameter selection, shown on the params button so
 * the popover's choices are visible at a glance. Mirrors the form: each field's
 * effective value is `params[key] ?? item.initialValue` (PaintingFieldRenderer), so
 * registry defaults appear before the user explicitly changes them.
 */
function paramsSummary(
  params: PaintingData['params'],
  items: BaseConfigItem[],
  translate: (key: string) => string
): string {
  const parts: string[] = []
  for (const item of items) {
    if (!isSummaryConfigItem(item)) continue
    if (item.condition && !item.condition(params ?? {})) continue
    const storedValue = params?.[item.key]
    // Preserve the custom-size sentinel even for older registry snapshots that
    // did not yet append it to the option list. Its dimensions are validated in
    // formatSummaryValue; every other option still goes through the typed
    // catalog + declared-option boundary below.
    const value = isOptionsConfigItem(item)
      ? storedValue === 'custom' && (SIZE_PREVIEW_KEYS as readonly string[]).includes(item.key)
        ? storedValue
        : resolveOptionValue(item, storedValue, params ?? {}, translate)
      : (params?.[item.key] ?? item.initialValue)
    if (value === undefined || value === null || value === '') continue
    const formatted = formatSummaryValue(item, value, params, translate)
    if (formatted) parts.push(formatted)
  }
  return parts.join(' · ')
}

export interface PaintingComposerProps {
  painting: PaintingData
  /** Data-derived: a generation is running for this painting (possibly resumed). */
  generating: boolean
  /** Action-scoped: a send started here is in flight. Owned by usePaintingGenerationSubmit. */
  submitting: boolean
  onPromptChange: (value: string) => void
  /**
   * Hands the request its input resolver. The composer holds the draft attachments
   * but does not orchestrate the request — materialization is the request's first
   * step, run by its owner only once the preconditions pass.
   */
  onGenerate: (materialize: MaterializeInputs) => void | Promise<void>
  onCancel: () => void
  onModelSelect: (selection: PaintingModelSelection) => void
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}

/** Bottom-toolbar popover hosting the image-generation parameter list. */
const PaintingParamsButton: FC<{
  painting: PaintingData
  hasImages: boolean
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}> = ({ painting, hasImages, onConfigChange, onGenerateRandomSeed }) => {
  const { t } = useTranslation()
  const registrySupport = useImageGenerationSupport(painting.providerId, painting.model)
  const configItems = useMemo(
    () => imageGenerationToFields(registrySupport, { operation: paintingOperation(painting.mode), hasImages }),
    [registrySupport, painting.mode, hasImages]
  )
  const summary = useMemo(() => paramsSummary(painting.params, configItems, t), [painting.params, configItems, t])

  const hasIndependentOperations = ImageOperationSchema.options.some(
    (operation) =>
      operation !== 'generate' && resolveImageCapability(registrySupport, operation, hasImages).kind === 'supported'
  )
  if (configItems.length === 0 && !hasIndependentOperations) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(COMPOSER_SELECTOR_BUTTON_CLASS, 'text-muted-foreground')}
          aria-label={summary ? `${t('common.settings')}: ${summary}` : t('common.settings')}>
          <Settings2 className="size-4" />
          {summary && (
            <span className="max-w-55 truncate" title={summary}>
              {summary}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[min(300px,calc(100vw-2rem))] rounded-[8px] p-3">
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <PaintingSettings
            painting={painting}
            hasImages={hasImages}
            onConfigChange={onConfigChange}
            onGenerateRandomSeed={onGenerateRandomSeed}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface PaintingComposerInnerProps extends PaintingComposerProps {
  model?: Model
  couldAddImageFile: boolean
}

const PaintingComposerInner: FC<PaintingComposerInnerProps> = ({
  painting,
  generating,
  submitting,
  onPromptChange,
  onGenerate,
  onCancel,
  onModelSelect,
  onConfigChange,
  onGenerateRandomSeed,
  model,
  couldAddImageFile
}) => {
  const { t } = useTranslation()
  const { files, isExpanded } = useComposerToolState()
  const { setFiles, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const text = painting.prompt ?? ''
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const config = getComposerToolConfig(PAINTING_SCOPE)

  const support = useImageGenerationSupport(painting.providerId, painting.model)
  const draftImageCount = files.filter((file) => file.type === FILE_TYPE.IMAGE).length
  const resolution = resolveImageCapability(support, paintingOperation(painting.mode), draftImageCount > 0)
  const inputs = resolution.kind === 'supported' ? resolution.capability.inputs : undefined
  const imageRequired = inputs !== undefined && inputs.images.min > 0
  const missingRequiredImage = inputs !== undefined && draftImageCount < inputs.images.min
  const tooManyImages = inputs?.images.max.kind === 'known' && draftImageCount > inputs.images.max.value
  const missingPrompt = inputs?.prompt !== 'optional' && text.trim().length === 0

  const placeholder = !couldAddImageFile
    ? t('paintings.prompt_placeholder')
    : imageRequired
      ? t('paintings.prompt_placeholder_upload_required')
      : t('paintings.prompt_placeholder_upload')

  const inputCapability: InputCapability =
    !model || resolution.kind === 'unconfigured' ? 'unknown' : couldAddImageFile ? 'accept' : 'reject'

  const { materializeInputs } = usePaintingComposerInputFiles({
    paintingId: painting.id,
    inputFiles: painting.inputFiles ?? [],
    files,
    setFiles,
    inputCapability,
    providerId: painting.providerId
  })

  // The reference-image tray reads the same draft that will be materialized on send.
  const tokens = useMemo(
    () => (couldAddImageFile ? EMPTY_TOKENS : files.map(fileToComposerToken)),
    [couldAddImageFile, files]
  )
  const handleTokensChange = useComposerTokenReconcile({ scope: PAINTING_SCOPE, model })

  const handleTextChange = useCallback((value: string) => onPromptChange(value), [onPromptChange])

  // The request is orchestrated by its owner (usePaintingGenerationSubmit), which
  // holds the re-entrancy guard and runs materialization only after the preconditions
  // pass. This composer reports intent and hands over the resolver; it deliberately
  // keeps no send state of its own.
  const handleSendDraft = useCallback(() => onGenerate(materializeInputs), [materializeInputs, onGenerate])

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={couldAddImageFile} extensions={PAINTING_IMAGE_EXTS}>
      {model && <ComposerToolRuntimeHost scope={PAINTING_SCOPE} model={model} />}
      <ComposerSurface
        text={text}
        onTextChange={handleTextChange}
        tokens={tokens}
        managedTokenKinds={couldAddImageFile ? PAINTING_NO_MANAGED_TOKEN_KINDS : PAINTING_MANAGED_TOKEN_KINDS}
        onTokensChange={handleTokensChange}
        topContent={couldAddImageFile ? <PaintingImageGallery /> : undefined}
        leadingContent={couldAddImageFile ? <PaintingImageAddButton /> : undefined}
        placeholder={placeholder}
        sendDisabled={
          generating ||
          submitting ||
          !model ||
          resolution.kind === 'unsupported' ||
          missingPrompt ||
          missingRequiredImage ||
          tooManyImages
        }
        sendBlockedReason={missingRequiredImage ? t('paintings.edit.image_required') : undefined}
        isLoading={generating}
        onSendDraft={handleSendDraft}
        onPause={onCancel}
        supportedExts={PAINTING_IMAGE_EXTS}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? false}
        enableDragDrop={config.enableDragDrop ?? true}
        enableSpellCheck={enableSpellCheck}
        fontSize={fontSize}
        narrowMode
        getToolLaunchers={() => getLaunchers()}
        toolLaunchersVersion={toolLaunchersVersion}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        renderLeftControls={(inputAdapter, unifiedPanelControl) => (
          <ComposerToolbarControls
            inputAdapter={inputAdapter}
            unifiedPanelControl={unifiedPanelControl}
            renderContextControls={() => (
              <>
                <PaintingModelSelector
                  hideTitle
                  painting={painting}
                  onSelect={(selection) => onModelSelect({ ...selection, hasImages: draftImageCount > 0 })}
                  className={cn(COMPOSER_SELECTOR_BUTTON_CLASS, 'w-auto max-w-[200px] border border-border-subtle')}
                />
                <PaintingParamsButton
                  painting={painting}
                  hasImages={draftImageCount > 0}
                  onConfigChange={onConfigChange}
                  onGenerateRandomSeed={onGenerateRandomSeed}
                />
              </>
            )}
          />
        )}
      />
    </ComposerToolDerivedStateProvider>
  )
}

/**
 * The painting prompt bar, rebuilt on the shared `ComposerSurface`. The image-gen
 * model selector + parameter list live in the bottom toolbar; image inputs flow
 * through the composer attachment pipeline, bridged to the page's `FileEntry[]`.
 */
const PaintingComposer: FC<PaintingComposerProps> = (props) => {
  const { painting } = props
  const { models } = useModels(painting.providerId ? { providerId: painting.providerId } : undefined)
  const model = useMemo(
    () =>
      painting.model
        ? models.find((entry) => entry.providerId === painting.providerId && entry.apiModelId === painting.model)
        : undefined,
    [models, painting.providerId, painting.model]
  )
  const support = useImageGenerationSupport(painting.providerId, painting.model)
  const resolution = resolveImageCapability(support, paintingOperation(painting.mode), true)
  const couldAddImageFile = resolution.kind === 'supported'

  return (
    // A different painting re-seeds the draft; model switches reconcile capabilities
    // without remounting and discarding compatible attachments.
    <ComposerToolRuntimeProvider
      key={painting.id}
      initialState={{ files: [], couldAddImageFile, extensions: PAINTING_IMAGE_EXTS }}
      actions={{ addNewTopic: () => {}, onTextChange: () => {} }}>
      <PaintingComposerInner {...props} model={model} couldAddImageFile={couldAddImageFile} />
    </ComposerToolRuntimeProvider>
  )
}

export default PaintingComposer
