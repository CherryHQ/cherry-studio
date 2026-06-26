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
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import type { Model } from '@shared/data/types/model'
import { imageExts } from '@shared/utils/file/fileExtensions'
import { isEditImageModel } from '@shared/utils/model'
import { Settings2 } from 'lucide-react'
import { type FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem } from '../form/baseConfigItem'
import { deriveChipLabel } from '../form/fields/SizeChipsField'
import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { resolveOptions } from '../form/resolveOptions'
import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import { usePaintingComposerInputFiles } from '../hooks/usePaintingComposerInputFiles'
import type { ComposerDraft } from '../model/composerDraft'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
import PaintingModelSelector from './PaintingModelSelector'
import PaintingSettings from './PaintingSettings'

const PAINTING_MANAGED_TOKEN_KINDS: readonly ComposerDraftToken['kind'][] = ['file']
const PAINTING_IMAGE_EXTS = imageExts.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
const PAINTING_SCOPE = 'painting' as const

type DraftParams = Record<string, unknown>

/** Size-bearing canonical keys — formatted as chip-style dimensions. */
const SIZE_PREVIEW_KEYS = ['size', 'imageResolution', 'aspectRatio'] as const

/** Field types worth surfacing in the compact button summary. */
const SUMMARY_TYPES = new Set<BaseConfigItem['type']>([
  'select',
  'sizeChips',
  'slider',
  'radio',
  'iconRadio',
  'styleToggle'
])

function formatSummaryValue(
  item: BaseConfigItem,
  value: unknown,
  params: DraftParams,
  translate: (key: string) => string
): string | undefined {
  // Size-bearing fields render as chip-style dimensions, matching the size chips.
  if ((SIZE_PREVIEW_KEYS as readonly string[]).includes(item.key ?? '')) {
    if (value === 'custom') {
      const w = params.customSize_width
      const h = params.customSize_height
      return w && h ? `${String(w)}×${String(h)}` : undefined
    }
    return deriveChipLabel(String(value), String(value))
  }
  if (item.type === 'slider') return String(value)
  // Option-based: show the selected option's localized label.
  const match = resolveOptions(item, params, translate).find((opt) => String(opt.value) === String(value))
  return match?.label ?? String(value)
}

/**
 * Compact summary of the current parameter selection, shown on the params button so
 * the popover's choices are visible at a glance. Mirrors the form: each field's
 * effective value is `params[key] ?? item.initialValue` (PaintingFieldRenderer), so
 * registry defaults appear before the user explicitly changes them.
 */
function paramsSummary(params: DraftParams, items: BaseConfigItem[], translate: (key: string) => string): string {
  const parts: string[] = []
  for (const item of items) {
    if (!item.key || !SUMMARY_TYPES.has(item.type)) continue
    if (item.condition && !item.condition(params)) continue
    const value = params[item.key] ?? item.initialValue
    if (value === undefined || value === null || value === '') continue
    const formatted = formatSummaryValue(item, value, params, translate)
    if (formatted) parts.push(formatted)
  }
  return parts.join(' · ')
}

export interface PaintingComposerProps {
  draft: ComposerDraft
  generating: boolean
  onPromptChange: (value: string) => void
  onInputFilesChange: (files: FileEntry[]) => void
  onGenerate: () => void
  onCancel: () => void
  onModelSelect: (selection: { providerId: string; modelId: string }) => void
  onConfigChange: (updates: Partial<ComposerDraft>) => void
  onGenerateRandomSeed?: (key: string) => void
}

/** Bottom-toolbar popover hosting the image-generation parameter list. */
const PaintingParamsButton: FC<{
  draft: ComposerDraft
  onConfigChange: (updates: Partial<ComposerDraft>) => void
  onGenerateRandomSeed?: (key: string) => void
}> = ({ draft, onConfigChange, onGenerateRandomSeed }) => {
  const { t } = useTranslation()
  const registrySupport = useImageGenerationSupport(draft.providerId, draft.model)
  const summary = useMemo(() => {
    const items = imageGenerationToFields(registrySupport, { mode: tabToImageGenerationMode(draft.mode) })
    return paramsSummary(draft.params, items, t)
  }, [registrySupport, draft.mode, draft.params, t])
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
      <PopoverContent align="start" side="top" className="w-[min(340px,calc(100vw-2rem))] rounded-[8px] p-3">
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <PaintingSettings draft={draft} onConfigChange={onConfigChange} onGenerateRandomSeed={onGenerateRandomSeed} />
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
  draft,
  generating,
  onPromptChange,
  onInputFilesChange,
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
  const [text, setText] = useState(() => draft.prompt)
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const config = getComposerToolConfig(PAINTING_SCOPE)

  usePaintingComposerInputFiles({
    sessionId: draft.sessionId,
    inputFiles: draft.inputFiles,
    files,
    setFiles,
    onInputFilesChange
  })

  const tokens = useMemo(() => files.map(fileToComposerToken), [files])
  const handleTokensChange = useComposerTokenReconcile({ scope: PAINTING_SCOPE, model })

  const handleTextChange = useCallback(
    (value: string) => {
      setText(value)
      onPromptChange(value)
    },
    [onPromptChange]
  )

  // The prompt + input files are kept synced to the draft per edit, so the
  // serialized draft is unused here — sending just triggers generation.
  const handleSendDraft = useCallback(() => {
    if (generating) return
    onGenerate()
  }, [generating, onGenerate])

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={couldAddImageFile} extensions={PAINTING_IMAGE_EXTS}>
      {model && <ComposerToolRuntimeHost scope={PAINTING_SCOPE} model={model} />}
      <ComposerSurface
        text={text}
        onTextChange={handleTextChange}
        tokens={tokens}
        managedTokenKinds={PAINTING_MANAGED_TOKEN_KINDS}
        onTokensChange={handleTokensChange}
        placeholder={t('paintings.prompt_placeholder')}
        sendDisabled={generating || (text.trim().length === 0 && files.length === 0) || !model}
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
        narrowMode={false}
        getToolLaunchers={() => getLaunchers()}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        renderLeftControls={(inputAdapter) => (
          <ComposerToolbarControls
            inputAdapter={inputAdapter}
            renderContextControls={() => (
              <>
                <PaintingModelSelector
                  hideTitle
                  draft={draft}
                  onSelect={onModelSelect}
                  className={cn(COMPOSER_SELECTOR_BUTTON_CLASS, 'w-auto max-w-[200px] border border-border-subtle')}
                />
                <PaintingParamsButton
                  draft={draft}
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
 * The painting prompt bar, rebuilt on the shared `ComposerSurface`. It is driven
 * by a `ComposerDraft` (not a painting record); the runtime provider is keyed by
 * `draft.sessionId`, which changes only when the draft is replaced — so editing
 * the model/prompt/params never remounts the composer or drops input images.
 */
const PaintingComposer: FC<PaintingComposerProps> = (props) => {
  const { draft } = props
  const { models } = useModels(draft.providerId ? { providerId: draft.providerId } : undefined)
  const model = useMemo(
    () =>
      draft.model
        ? models.find((entry) => entry.providerId === draft.providerId && entry.apiModelId === draft.model)
        : undefined,
    [models, draft.providerId, draft.model]
  )
  const couldAddImageFile = model ? isEditImageModel(model) : false

  return (
    <ComposerToolRuntimeProvider
      key={draft.sessionId}
      initialState={{ files: [], couldAddImageFile, extensions: PAINTING_IMAGE_EXTS }}
      actions={{ addNewTopic: () => {}, onTextChange: () => {} }}>
      <PaintingComposerInner {...props} model={model} couldAddImageFile={couldAddImageFile} />
    </ComposerToolRuntimeProvider>
  )
}

export default PaintingComposer
