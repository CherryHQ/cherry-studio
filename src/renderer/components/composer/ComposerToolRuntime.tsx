import { getAllTools, getToolsForScope } from '@renderer/components/composer/tools/builtinTools'
import {
  ComposerToolDerivedStateProvider,
  type ComposerToolDispatch,
  ComposerToolProvider,
  type ComposerToolsRegistryApi,
  type ComposerToolState,
  useComposerToolProviderDispatch,
  useComposerToolProviderLaunchers,
  useComposerToolProviderState
} from '@renderer/components/composer/tools/ComposerToolProvider'
import type {
  ComposerToolScope,
  ToolActionKey,
  ToolActionMap,
  ToolContext,
  ToolDefinition,
  ToolRenderContext,
  ToolStateKey
} from '@renderer/components/composer/tools/types'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import type { Assistant } from '@renderer/types/assistant'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Model } from '@shared/data/types/model'
import { Plus } from 'lucide-react'
import React, { createContext, memo, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerUnifiedPanelControl } from './quickPanel'
import type { ComposerSerializedToken } from './tokens'
import type { ComposerToolLauncher, ComposerToolLauncherActionOptions } from './toolLauncher'

interface ComposerToolRuntimeActions {
  addNewTopic: () => void
  onTextChange: (updater: string | ((prev: string) => string)) => void
}

interface ComposerToolRuntimeProviderProps {
  children: React.ReactNode
  initialState?: Partial<{
    files: ComposerAttachment[]
    mentionedModels: Model[]
    selectedKnowledgeBases: KnowledgeBase[]
    isExpanded: boolean
    couldAddImageFile: boolean
    extensions: string[]
  }>
  actions: ComposerToolRuntimeActions
}

export const ComposerToolRuntimeProvider = ({ children, initialState, actions }: ComposerToolRuntimeProviderProps) => {
  return (
    <ComposerToolProvider initialState={initialState} actions={actions}>
      {children}
    </ComposerToolProvider>
  )
}

interface ComposerToolRuntimeBootstrapProps {
  scope: ComposerToolScope
  assistant?: Assistant
  model: Model
  session?: ToolContext['session']
}

type AnyToolDefinition = ToolDefinition<readonly ToolStateKey[], readonly ToolActionKey[]>
type AnyToolRenderContext = ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>

interface ComposerToolRuntimeEntryProps extends ComposerToolRuntimeBootstrapProps {
  tool: AnyToolDefinition
  toolState: ComposerToolState
  toolActions: ToolActionMap
  launcher: AnyToolRenderContext['launcher']
  toolsRegistry: ComposerToolsRegistryApi
  t: ReturnType<typeof useTranslation>['t']
}

const ComposerToolRuntimeEntry = ({
  tool,
  toolState,
  toolActions,
  launcher,
  toolsRegistry,
  scope,
  assistant,
  model,
  session,
  t
}: ComposerToolRuntimeEntryProps) => {
  const context = useMemo<AnyToolRenderContext>(() => {
    const state: Record<string, unknown> = {}
    for (const key of tool.dependencies?.state ?? []) state[key] = toolState[key]

    const actions: Record<string, unknown> = {}
    for (const key of tool.dependencies?.actions ?? []) {
      const action = toolActions[key]
      if (action) actions[key] = action
    }

    return {
      scope,
      assistant,
      model,
      session,
      state,
      actions,
      launcher,
      t
    } as AnyToolRenderContext
  }, [assistant, launcher, model, scope, session, t, tool, toolActions, toolState])

  useEffect(() => {
    if (!tool.composer?.menuItems) return
    return toolsRegistry.registerLaunchers(tool.key, tool.composer.menuItems.createItems(context))
  }, [context, tool, toolsRegistry])

  const Runtime = tool.composer?.runtime
  return Runtime ? <Runtime context={context} /> : null
}

const MemoizedComposerToolRuntimeEntry = memo(ComposerToolRuntimeEntry, (previous, next) => {
  if (
    previous.tool !== next.tool ||
    previous.launcher !== next.launcher ||
    previous.toolsRegistry !== next.toolsRegistry ||
    previous.scope !== next.scope ||
    previous.assistant !== next.assistant ||
    previous.model !== next.model ||
    previous.session !== next.session ||
    previous.t !== next.t
  ) {
    return false
  }

  for (const key of next.tool.dependencies?.state ?? []) {
    if (!Object.is(previous.toolState[key], next.toolState[key])) return false
  }
  for (const key of next.tool.dependencies?.actions ?? []) {
    if (!Object.is(previous.toolActions[key], next.toolActions[key])) return false
  }

  return true
})

export const ComposerToolRuntimeHost = ({ scope, assistant, model, session }: ComposerToolRuntimeBootstrapProps) => {
  const { t } = useTranslation()
  const toolState = useComposerToolProviderState()
  const { addNewTopic, onTextChange, setFiles, setMentionedModels, setSelectedKnowledgeBases, toolsRegistry } =
    useComposerToolProviderDispatch()
  const launcherApiCacheRef = useRef(new Map<string, ToolRenderContext<any, any>['launcher']>())

  const toolActions = useMemo<ToolActionMap>(
    () => ({
      addNewTopic,
      onTextChange,
      setFiles,
      setMentionedModels,
      setSelectedKnowledgeBases
    }),
    [addNewTopic, onTextChange, setFiles, setMentionedModels, setSelectedKnowledgeBases]
  )

  const availableTools = useMemo(() => {
    return getToolsForScope(scope, { assistant, model, session })
  }, [assistant, model, scope, session])

  const getLauncherApiForTool = useCallback(
    (toolKey: string): ToolRenderContext<any, any>['launcher'] => {
      const cache = launcherApiCacheRef.current

      if (!cache.has(toolKey)) {
        cache.set(toolKey, {
          registerLaunchers: (entries, footerActions) =>
            toolsRegistry.registerLaunchers(toolKey, entries, footerActions)
        })
      }

      return cache.get(toolKey)!
    },
    [toolsRegistry]
  )

  return (
    <>
      {availableTools.map((tool) => (
        <MemoizedComposerToolRuntimeEntry
          key={`${tool.key}-composer-runtime`}
          tool={tool}
          toolState={toolState}
          toolActions={toolActions}
          launcher={getLauncherApiForTool(tool.key)}
          toolsRegistry={toolsRegistry}
          scope={scope}
          assistant={assistant}
          model={model}
          session={session}
          t={t}
        />
      ))}
    </>
  )
}

export const useComposerToolState = useComposerToolProviderState
export const useComposerToolDispatch = useComposerToolProviderDispatch
export { ComposerToolDerivedStateProvider }

export const ComposerToolFooterActionsSync = () => {
  const { getFooterActions, version } = useComposerToolProviderLaunchers()
  const quickPanel = useQuickPanel()
  const { symbol, updateFooterActions } = quickPanel

  useLayoutEffect(() => {
    if (!symbol) {
      updateFooterActions([])
      return
    }

    updateFooterActions(getFooterActions(symbol))

    return () => updateFooterActions([])
  }, [getFooterActions, symbol, updateFooterActions, version])

  return null
}

const NOOP_LAUNCHER: ToolRenderContext<any, any>['launcher'] = { registerLaunchers: () => () => undefined }

interface ReconcileContextInputs {
  toolState: ComposerToolState
  dispatch: ComposerToolDispatch
  scope: ComposerToolScope
  assistant?: Assistant
  model?: Model
  session?: ToolContext['session']
  t: ReturnType<typeof useTranslation>['t']
}

/** Builds the (launcher-less) render context a tool's `tokens.reconcile` runs against. */
const buildReconcileContext = (tool: AnyToolDefinition, inputs: ReconcileContextInputs): AnyToolRenderContext => {
  const deps = tool.dependencies
  const state: Record<string, unknown> = {}
  for (const key of deps?.state ?? []) state[key] = inputs.toolState[key]
  const actions: Record<string, unknown> = {}
  for (const key of deps?.actions ?? []) {
    const value = inputs.dispatch[key]
    if (value) actions[key] = value
  }

  return {
    scope: inputs.scope,
    assistant: inputs.assistant,
    model: inputs.model as Model,
    session: inputs.session,
    state,
    actions,
    launcher: NOOP_LAUNCHER,
    t: inputs.t
  } as AnyToolRenderContext
}

interface ComposerTokenReconcileInputs {
  scope: ComposerToolScope
  assistant?: Assistant
  model?: Model
  session?: ToolContext['session']
}

/**
 * Returns a stable `reconcileTokens(draft)` callback that drives editor→state reconciliation
 * through the tools that own each token kind (attachment→file, knowledgeBase→knowledge,
 * skill→skill). Called by a variant from `ComposerSurface.onTokensChange`. Reads the latest
 * provider state/dispatch + inputs via a ref, so the callback is stable yet never stale, and
 * each tool's `reconcile` uses functional `setState` updates.
 *
 * Token tools are matched by `visibleInScopes` only (NOT `condition`) so reconciliation runs
 * unconditionally, matching the variants' previous always-on `handleTokensChange`.
 */
export function useComposerTokenReconcile(
  inputs: ComposerTokenReconcileInputs
): (draftTokens: readonly ComposerSerializedToken[]) => void {
  const { t } = useTranslation()
  const toolState = useComposerToolProviderState()
  const dispatch = useComposerToolProviderDispatch()
  const latestRef = useRef<ReconcileContextInputs>({ toolState, dispatch, t, ...inputs })
  latestRef.current = { toolState, dispatch, t, ...inputs }

  return useCallback((draftTokens: readonly ComposerSerializedToken[]) => {
    const current = latestRef.current
    const tokenTools = getAllTools().filter(
      (tool) => tool.composer?.tokens && (!tool.visibleInScopes || tool.visibleInScopes.includes(current.scope))
    )
    for (const tool of tokenTools) {
      tool.composer?.tokens?.reconcile(draftTokens, buildReconcileContext(tool, current))
    }
  }, [])
}

const getSortedLaunchers = (
  triggers: ReturnType<typeof useComposerToolProviderLaunchers>,
  source?: ComposerToolLauncherActionOptions['source']
) => {
  const launchers = triggers.getLaunchers().flatMap((launcher) => {
    if (launcher.hidden) return []

    const matchesSource = !source || !launcher.sources || launcher.sources.includes(source)
    const nestedRootPanelItems =
      source === 'root-panel'
        ? (launcher.submenu ?? []).filter((item) => !item.hidden && (!item.sources || item.sources.includes(source)))
        : []

    return matchesSource ? [launcher, ...nestedRootPanelItems] : nestedRootPanelItems
  })

  return launchers.sort(
    (left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
  )
}

export function useComposerToolLauncherController() {
  const triggers = useComposerToolProviderLaunchers()
  const quickPanel = useQuickPanel()

  const getLaunchers = useCallback(
    (source?: ComposerToolLauncherActionOptions['source']) => getSortedLaunchers(triggers, source),
    [triggers]
  )

  const dispatchLauncher = useCallback(
    (
      launcher: ComposerToolLauncher,
      options: Omit<ComposerToolLauncherActionOptions, 'quickPanel'> & {
        quickPanel?: ComposerToolLauncherActionOptions['quickPanel']
      }
    ) => {
      launcher.action?.({
        quickPanel: options.quickPanel ?? quickPanel,
        inputAdapter: options.inputAdapter,
        triggerInfo: options.triggerInfo,
        parentPanel: options.parentPanel,
        queryAnchor: options.queryAnchor,
        searchText: options.searchText,
        source: options.source
      })
    },
    [quickPanel]
  )

  return { getLaunchers, dispatchLauncher }
}

export function useComposerToolLauncherActions() {
  const { triggers } = useComposerToolProviderDispatch()

  const getLaunchers = useCallback(
    (source?: ComposerToolLauncherActionOptions['source']) => getSortedLaunchers(triggers, source),
    [triggers]
  )

  const dispatchLauncher = useCallback((launcher: ComposerToolLauncher, options: ComposerToolLauncherActionOptions) => {
    launcher.action?.(options)
  }, [])

  return { getLaunchers, dispatchLauncher }
}

export function useComposerToolLauncherVersion() {
  return useComposerToolProviderLaunchers().version
}

interface ComposerToolMenuProps {
  inputAdapter?: QuickPanelInputAdapter
  unifiedPanelControl?: ComposerUnifiedPanelControl
}

// Ids the pinned toolbar bar (ComposerToolbarShortcuts) is already rendering. The variant
// publishes them so ComposerActiveToolControls can drop those launchers (they'd otherwise
// double-render) — and, since the pinned bar is now their persistent home, an unpinned but
// active tool falls back into the active-controls chips.
const ComposerPinnedToolsContext = createContext<readonly string[]>([])

export const ComposerPinnedToolsProvider = ComposerPinnedToolsContext.Provider

export function useComposerPinnedTools() {
  return use(ComposerPinnedToolsContext)
}

export const ComposerActiveToolControls = ({ inputAdapter }: ComposerToolMenuProps) => {
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const pinnedIds = useComposerPinnedTools()
  const activeLaunchers = useMemo(
    () =>
      getLaunchers('popover').filter(
        (launcher) =>
          launcher.active &&
          launcher.showInActiveControls !== false &&
          !launcher.disabled &&
          !launcher.hidden &&
          !pinnedIds.includes(launcher.id)
      ),
    [getLaunchers, pinnedIds]
  )

  if (activeLaunchers.length === 0) return null

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {activeLaunchers.map((launcher) => (
        <button
          key={launcher.id}
          type="button"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground [&_svg]:size-4"
          data-active
          disabled={launcher.disabled}
          aria-label={typeof launcher.label === 'string' ? launcher.label : undefined}
          onClick={() => dispatchLauncher(launcher, { source: 'popover', inputAdapter })}>
          <span className="flex shrink-0 items-center justify-center text-foreground-tertiary">{launcher.icon}</span>
          {launcher.suffix ? <span className="max-w-24 truncate">{launcher.suffix}</span> : null}
        </button>
      ))}
    </div>
  )
}

export const ComposerToolMenu = ({ unifiedPanelControl }: ComposerToolMenuProps) => {
  const { t } = useTranslation()
  if (!unifiedPanelControl?.available) return null

  return (
    <button
      type="button"
      className="flex size-[30px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={t('settings.quickPanel.title')}
      onClick={() => unifiedPanelControl.open()}>
      <Plus size={18} />
    </button>
  )
}
