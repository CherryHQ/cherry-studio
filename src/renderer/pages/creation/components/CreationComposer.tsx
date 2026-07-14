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
import type { FileEntry } from '@shared/data/types/file'
import type { Model } from '@shared/data/types/model'
import { type FC, type ReactNode, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CreationModelSelector, { type CreationModelKindSelection } from '../CreationModelSelector'
import { useCreationComposerInputFiles } from '../hooks/useCreationComposerInputFiles'
import CreationParamsButton from './CreationParamsButton'
import type { CreationParamsFormProps } from './CreationParamsForm'

const CREATION_MANAGED_TOKEN_KINDS: readonly ComposerDraftToken['kind'][] = ['file']
const CREATION_SCOPE = 'creation' as const
const EMPTY_FILE_ENTRIES: FileEntry[] = []
const EMPTY_EXTS: string[] = []
const noopInputFilesChange = () => {}

/** Flat-attachment pipeline wiring — the image mode's edit-input images. Omit for video (slot-based media). */
export interface CreationComposerAttachments {
  /** Gates image chips in the +/drag/paste pipeline (image: `isEditImageModel(model)`). */
  couldAddImageFile: boolean
  extensions: string[]
  /** Page-owned FileEntry list bridged to composer chips (seed + writeback). */
  inputFiles: FileEntry[]
  onInputFilesChange: (files: FileEntry[]) => void
}

export interface CreationComposerProps {
  /**
   * Remount key for the runtime provider owning composer file/text state
   * (image: `${painting.id}:${painting.model ?? ''}`; video: the current
   * creation id or a draft epoch). A key change re-seeds the prompt text and
   * attachment chips from the page state.
   */
  composerKey: string
  providerId?: string
  modelId?: string
  /** Resolved v2 model row — gates send, `ComposerToolRuntimeHost`, token reconcile. */
  model?: Model
  /** Initial text seed per `composerKey`; every edit is reported via `onPromptChange`. */
  prompt: string
  generating: boolean
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onCancel: () => void
  /** Kind-aware: selecting the other kind's model hands the page off to that flow. */
  onModelSelect: (selection: CreationModelKindSelection) => void
  /** Content gate; the core always adds `generating || !model`. Default: non-empty text. */
  canSend?: (ctx: { text: string; filesCount: number }) => boolean
  /** Omit → no attachment entry points (video mode). */
  attachments?: CreationComposerAttachments
  /** Omit / empty `items` → no params button. */
  paramsConfig?: CreationParamsFormProps
  /** Registry-driven media placeholder row, rendered inside the surface above the textarea. */
  headerContent?: ReactNode
  /** Compact control(s) before the model selector (video mode pills). */
  toolbarLeading?: ReactNode
}

const CreationComposerInner: FC<CreationComposerProps> = ({
  composerKey,
  providerId,
  modelId,
  model,
  prompt,
  generating,
  onPromptChange,
  onGenerate,
  onCancel,
  onModelSelect,
  canSend,
  attachments,
  paramsConfig,
  headerContent,
  toolbarLeading
}) => {
  const { t } = useTranslation()
  const { files, isExpanded } = useComposerToolState()
  const { setFiles, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const [text, setText] = useState(() => prompt ?? '')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const config = getComposerToolConfig(CREATION_SCOPE)

  // Unconditional (rules-of-hooks): with no attachments wiring the seed runs
  // once on an empty list and the unchanged-guard suppresses writeback — a no-op.
  useCreationComposerInputFiles({
    id: composerKey,
    inputFiles: attachments?.inputFiles ?? EMPTY_FILE_ENTRIES,
    files,
    setFiles,
    onInputFilesChange: attachments?.onInputFilesChange ?? noopInputFilesChange
  })

  const tokens = useMemo(() => files.map(fileToComposerToken), [files])
  const handleTokensChange = useComposerTokenReconcile({ scope: CREATION_SCOPE, model })

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

  const contentSendable = canSend ? canSend({ text, filesCount: files.length }) : text.trim().length > 0

  return (
    <ComposerToolDerivedStateProvider
      couldAddImageFile={attachments?.couldAddImageFile ?? false}
      extensions={attachments?.extensions ?? EMPTY_EXTS}>
      {model && <ComposerToolRuntimeHost scope={CREATION_SCOPE} model={model} />}
      <ComposerSurface
        text={text}
        onTextChange={handleTextChange}
        tokens={tokens}
        managedTokenKinds={CREATION_MANAGED_TOKEN_KINDS}
        onTokensChange={handleTokensChange}
        placeholder={t('paintings.prompt_placeholder')}
        sendDisabled={generating || !model || !contentSendable}
        isLoading={generating}
        onSendDraft={handleSendDraft}
        onPause={onCancel}
        supportedExts={attachments?.extensions ?? EMPTY_EXTS}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? false}
        enableDragDrop={(config.enableDragDrop ?? true) && Boolean(attachments)}
        enableSpellCheck={enableSpellCheck}
        fontSize={fontSize}
        narrowMode
        headerContent={headerContent}
        getToolLaunchers={() => getLaunchers()}
        toolLaunchersVersion={toolLaunchersVersion}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        renderLeftControls={(inputAdapter, unifiedPanelControl) => (
          <ComposerToolbarControls
            inputAdapter={inputAdapter}
            unifiedPanelControl={unifiedPanelControl}
            renderContextControls={() => (
              <>
                {toolbarLeading}
                <CreationModelSelector
                  hideTitle
                  providerId={providerId}
                  modelId={modelId}
                  onSelect={onModelSelect}
                  className={cn(COMPOSER_SELECTOR_BUTTON_CLASS, 'w-auto max-w-[200px] border border-border-subtle')}
                />
                {paramsConfig && <CreationParamsButton {...paramsConfig} />}
              </>
            )}
          />
        )}
      />
    </ComposerToolDerivedStateProvider>
  )
}

/**
 * The Creation page's shared prompt bar, built on `ComposerSurface`. Both modes
 * embed the kind-aware model selector + a params popover in the bottom toolbar;
 * image wires the flat attachment pipeline (`attachments`), video renders
 * registry-driven media placeholder slots (`headerContent`) and mode pills
 * (`toolbarLeading`) instead.
 */
const CreationComposer: FC<CreationComposerProps> = (props) => {
  // Key the provider (which owns `files` + the seeded text) by composerKey so a
  // painting/model/draft switch remounts it and re-seeds from the page state.
  return (
    <ComposerToolRuntimeProvider
      key={props.composerKey}
      initialState={{
        files: [],
        couldAddImageFile: props.attachments?.couldAddImageFile ?? false,
        extensions: props.attachments?.extensions ?? EMPTY_EXTS
      }}
      actions={{ addNewTopic: () => {}, onTextChange: () => {} }}>
      <CreationComposerInner {...props} />
    </ComposerToolRuntimeProvider>
  )
}

export default CreationComposer
