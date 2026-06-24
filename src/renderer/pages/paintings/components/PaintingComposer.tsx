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

import { usePaintingComposerInputFiles } from '../hooks/usePaintingComposerInputFiles'
import type { PaintingData } from '../model/types/paintingData'
import PaintingModelSelector from './PaintingModelSelector'
import PaintingSettings from './PaintingSettings'

const PAINTING_MANAGED_TOKEN_KINDS: readonly ComposerDraftToken['kind'][] = ['file']
const PAINTING_IMAGE_EXTS = imageExts.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
const PAINTING_SCOPE = 'painting' as const

export interface PaintingComposerProps {
  painting: PaintingData
  generating: boolean
  onPromptChange: (value: string) => void
  onInputFilesChange: (files: FileEntry[]) => void
  onGenerate: () => void
  onCancel: () => void
  onModelSelect: (selection: { providerId: string; modelId: string }) => void
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}

/** Bottom-toolbar popover hosting the image-generation parameter list. */
const PaintingParamsButton: FC<{
  painting: PaintingData
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}> = ({ painting, onConfigChange, onGenerateRandomSeed }) => {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(COMPOSER_SELECTOR_BUTTON_CLASS, 'text-muted-foreground')}
          aria-label={t('common.settings')}>
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[min(340px,calc(100vw-2rem))] rounded-[8px] p-3">
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <PaintingSettings
            painting={painting}
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
  const [text, setText] = useState(() => painting.prompt ?? '')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const config = getComposerToolConfig(PAINTING_SCOPE)

  usePaintingComposerInputFiles({
    paintingId: painting.id,
    inputFiles: painting.inputFiles ?? [],
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

  // The prompt + input files are kept synced to page state per edit, so the
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
                  painting={painting}
                  onSelect={onModelSelect}
                  className={cn(COMPOSER_SELECTOR_BUTTON_CLASS, 'w-auto max-w-[200px] border border-border-subtle')}
                />
                <PaintingParamsButton
                  painting={painting}
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
  const couldAddImageFile = model ? isEditImageModel(model) : false

  return (
    <ComposerToolRuntimeProvider
      initialState={{ files: [], couldAddImageFile, extensions: PAINTING_IMAGE_EXTS }}
      actions={{ addNewTopic: () => {}, onTextChange: () => {} }}>
      {/* Remount per painting so the editor text + attachment bridge re-seed cleanly. */}
      <PaintingComposerInner key={painting.id} {...props} model={model} couldAddImageFile={couldAddImageFile} />
    </ComposerToolRuntimeProvider>
  )
}

export default PaintingComposer
