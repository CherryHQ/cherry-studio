import '@renderer/components/chat/composer/tools'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { QuickPanelInputAdapter } from '@renderer/components/chat/composer/panelEngine'
import { useQuickPanel } from '@renderer/components/chat/composer/panelEngine'
import {
  ComposerToolDerivedStateProvider,
  type ComposerToolDispatch,
  ComposerToolProvider,
  type ComposerToolState,
  useComposerToolProviderDispatch,
  useComposerToolProviderLaunchers,
  useComposerToolProviderState
} from '@renderer/components/chat/composer/tools/ComposerToolProvider'
import type {
  ComposerToolScope,
  ToolActionKey,
  ToolActionMap,
  ToolContext,
  ToolDefinition,
  ToolRenderContext,
  ToolStateKey,
  ToolStateMap
} from '@renderer/components/chat/composer/tools/types'
import { getAllTools, getToolsForScope } from '@renderer/components/chat/composer/tools/types'
import { useProvider } from '@renderer/hooks/useProvider'
import type { Assistant } from '@renderer/types'
import type { ComposerAttachment } from '@renderer/utils/messageUtils/composerAttachment'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Model } from '@shared/data/types/model'
import { ChevronRightIcon, Plus } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerSerializedToken } from './tokens'
import type { ComposerToolLauncher, ComposerToolLauncherActionOptions } from './toolLauncher'

const TOOL_MENU_CONTENT_CLASS = 'min-w-52 w-max max-w-[calc(100vw-2rem)]'
const TOOL_SUBMENU_CONTENT_CLASS = 'min-w-44 w-max max-w-[calc(100vw-2rem)] data-[state=closed]:hidden'
const TOOL_MENU_BADGE_CLASS = 'shrink-0 whitespace-nowrap text-muted-foreground text-xs'

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

const ComposerToolRuntimeSlot = ({ tool, context }: { tool: AnyToolDefinition; context: AnyToolRenderContext }) => {
  const Runtime = tool.composer?.runtime
  if (!Runtime) return null
  return <Runtime context={context} />
}

export const ComposerToolRuntimeHost = ({ scope, assistant, model, session }: ComposerToolRuntimeBootstrapProps) => {
  const { t } = useTranslation()
  const toolState = useComposerToolProviderState()
  const { addNewTopic, onTextChange, setFiles, setMentionedModels, setSelectedKnowledgeBases, toolsRegistry } =
    useComposerToolProviderDispatch()
  const launcherApiCacheRef = useRef(new Map<string, ToolRenderContext<any, any>['launcher']>())
  const { provider } = useProvider(model.providerId)

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
    return getToolsForScope(scope, { assistant, model, session, provider })
  }, [assistant, model, provider, scope, session])

  const getLauncherApiForTool = useCallback(
    (toolKey: string): ToolRenderContext<any, any>['launcher'] => {
      const cache = launcherApiCacheRef.current

      if (!cache.has(toolKey)) {
        cache.set(toolKey, {
          registerLaunchers: (entries) => toolsRegistry.registerLaunchers(toolKey, entries)
        })
      }

      return cache.get(toolKey)!
    },
    [toolsRegistry]
  )

  const buildRenderContext = useCallback(
    <S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]>(
      tool: ToolDefinition<S, A>
    ): ToolRenderContext<S, A> => {
      const deps = tool.dependencies

      const state = (deps?.state || ([] as unknown as S)).reduce(
        (acc, key) => {
          acc[key] = toolState[key]
          return acc
        },
        {} as Pick<ToolStateMap, S[number]>
      )

      const runtimeActions = (deps?.actions || ([] as unknown as A)).reduce(
        (acc, key) => {
          const actionValue = toolActions[key]
          if (actionValue) {
            acc[key] = actionValue
          }
          return acc
        },
        {} as Pick<ToolActionMap, A[number]>
      )

      return {
        scope,
        assistant,
        model,
        session,
        state,
        actions: runtimeActions,
        launcher: getLauncherApiForTool(tool.key),
        t
      } as ToolRenderContext<S, A>
    },
    [assistant, getLauncherApiForTool, model, scope, session, t, toolActions, toolState]
  )

  const toolRuntimeEntries = useMemo(
    () =>
      availableTools.map((tool) => ({
        tool,
        context: buildRenderContext(tool)
      })),
    [availableTools, buildRenderContext]
  )

  useEffect(() => {
    const disposeCallbacks: Array<() => void> = []

    for (const { tool, context } of toolRuntimeEntries) {
      if (tool.composer?.menuItems) {
        const launchers = tool.composer.menuItems.createItems(context)
        const dispose = toolsRegistry.registerLaunchers(tool.key, launchers)
        disposeCallbacks.push(dispose)
      }
    }

    return () => {
      disposeCallbacks.forEach((dispose) => dispose())
    }
  }, [toolRuntimeEntries, toolsRegistry])

  return (
    <>
      {toolRuntimeEntries.map(({ tool, context }) => {
        if (!tool.composer?.runtime) return null
        return <ComposerToolRuntimeSlot key={`${tool.key}-composer-runtime`} tool={tool} context={context} />
      })}
    </>
  )
}

export const useComposerToolState = useComposerToolProviderState
export const useComposerToolDispatch = useComposerToolProviderDispatch
export { ComposerToolDerivedStateProvider }

const NOOP_LAUNCHER: ToolRenderContext<any, any>['launcher'] = { registerLaunchers: () => () => undefined }

interface ComposerToolMenuItemContentProps {
  icon?: React.ReactNode
  children: React.ReactNode
  badge?: React.ReactNode
  hasSubmenu?: boolean
}

function ComposerToolMenuItemContent({ icon, children, badge, hasSubmenu }: ComposerToolMenuItemContentProps) {
  return (
    <>
      <span className="flex min-w-max items-center gap-2">
        {icon && <span className="size-4 shrink-0">{icon}</span>}
        <span className="whitespace-nowrap">{children}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {badge}
        {hasSubmenu && <ChevronRightIcon className="size-4 text-muted-foreground" />}
      </span>
    </>
  )
}

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

const launcherSupportsSource = (launcher: ComposerToolLauncher, source: ComposerToolLauncherActionOptions['source']) =>
  !launcher.sources || launcher.sources.includes(source)

type ComposerToolMenuEntry = {
  launcher: ComposerToolLauncher
  source: ComposerToolLauncherActionOptions['source']
}

const getToolMenuEntries = (triggers: ReturnType<typeof useComposerToolProviderLaunchers>) => {
  const popoverLaunchers = getSortedLaunchers(triggers, 'popover')

  return popoverLaunchers.map((launcher): ComposerToolMenuEntry => ({ launcher, source: 'popover' }))
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

interface ComposerToolMenuProps {
  inputAdapter?: QuickPanelInputAdapter
}

export const ComposerActiveToolControls = ({ inputAdapter }: ComposerToolMenuProps) => {
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const activeLaunchers = useMemo(
    () =>
      getLaunchers('popover').filter(
        (launcher) =>
          launcher.active && launcher.showInActiveControls !== false && !launcher.disabled && !launcher.hidden
      ),
    [getLaunchers]
  )

  if (activeLaunchers.length === 0) return null

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {activeLaunchers.map((launcher) => (
        <button
          key={launcher.id}
          type="button"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 font-medium text-foreground-secondary text-xs transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[active=true]:bg-accent data-[active=true]:text-foreground [&_svg]:size-4"
          data-active
          disabled={launcher.disabled}
          aria-label={typeof launcher.label === 'string' ? launcher.label : undefined}
          onClick={() => dispatchLauncher(launcher, { source: 'popover', inputAdapter })}>
          <span className="flex shrink-0 items-center justify-center text-foreground-muted">{launcher.icon}</span>
          {launcher.suffix ? <span className="max-w-24 truncate">{launcher.suffix}</span> : null}
        </button>
      ))}
    </div>
  )
}

export const ComposerToolMenu = ({ inputAdapter }: ComposerToolMenuProps) => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { dispatchLauncher } = useComposerToolLauncherController()
  const triggers = useComposerToolProviderLaunchers()
  const [open, setOpen] = useState(false)
  const [activeTooltipId, setActiveTooltipId] = useState<string | null>(null)
  const entries = useMemo(() => getToolMenuEntries(triggers), [triggers])

  const visibleEntries = useMemo(() => entries.filter(({ launcher }) => !launcher.hidden), [entries])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) return
    setActiveTooltipId(null)
  }, [])

  const closeToolMenu = useCallback(() => {
    setActiveTooltipId(null)
    setOpen(false)
  }, [])

  if (visibleEntries.length === 0) return null

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-[30px] shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('common.add')}>
          <Plus size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={4} className={TOOL_MENU_CONTENT_CLASS}>
        {visibleEntries.map(({ launcher, source }) => {
          const tooltipContent = launcher.disabled
            ? (launcher.disabledReason ?? launcher.tooltip ?? launcher.description)
            : launcher.tooltip
          const submenuItems = (launcher.submenu ?? []).filter(
            (item) => !item.hidden && launcherSupportsSource(item, source)
          )
          const hasSubmenu = !launcher.disabled && submenuItems.length > 0
          const itemClassName = cn(
            !launcher.disabled && launcher.active && 'bg-accent text-accent-foreground',
            tooltipContent && 'data-[disabled]:pointer-events-auto'
          )
          const suffixBadge = launcher.suffix ? (
            <span className={TOOL_MENU_BADGE_CLASS}>{launcher.suffix}</span>
          ) : undefined

          if (hasSubmenu) {
            return (
              <DropdownMenuSub key={launcher.id}>
                <DropdownMenuSubTrigger
                  aria-label={typeof launcher.label === 'string' ? launcher.label : undefined}
                  className={cn(!launcher.disabled && launcher.active && 'bg-accent text-accent-foreground')}>
                  <ComposerToolMenuItemContent icon={launcher.icon} badge={suffixBadge}>
                    {launcher.label}
                  </ComposerToolMenuItemContent>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={TOOL_SUBMENU_CONTENT_CLASS}>
                  {submenuItems.map((item) => {
                    const tooltipId = `${launcher.id}:${item.id}`
                    const itemTooltipContent = item.disabled
                      ? (item.disabledReason ?? item.tooltip ?? item.description)
                      : item.tooltip
                    const itemSuffixBadge = item.suffix ? (
                      <span className={TOOL_MENU_BADGE_CLASS}>{item.suffix}</span>
                    ) : undefined
                    const submenuItem = (
                      <DropdownMenuItem
                        key={item.id}
                        aria-label={typeof item.label === 'string' ? item.label : undefined}
                        disabled={item.disabled}
                        className={cn(
                          !item.disabled && item.active && 'bg-accent text-accent-foreground',
                          itemTooltipContent && 'data-[disabled]:pointer-events-auto'
                        )}
                        onMouseMove={() => setActiveTooltipId(itemTooltipContent ? tooltipId : null)}
                        onMouseLeave={() => {
                          if (activeTooltipId === tooltipId) setActiveTooltipId(null)
                        }}
                        onSelect={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          closeToolMenu()
                          dispatchLauncher(item, { source: 'popover', inputAdapter, quickPanel })
                        }}>
                        <ComposerToolMenuItemContent icon={item.icon} badge={itemSuffixBadge}>
                          {item.label}
                        </ComposerToolMenuItemContent>
                      </DropdownMenuItem>
                    )

                    if (!itemTooltipContent) return submenuItem

                    return (
                      <Tooltip
                        key={item.id}
                        content={itemTooltipContent}
                        placement="right"
                        sideOffset={8}
                        isOpen={activeTooltipId === tooltipId}
                        onOpenChange={(nextOpen) => {
                          if (!nextOpen && activeTooltipId === tooltipId) setActiveTooltipId(null)
                        }}
                        classNames={{ placeholder: 'block' }}
                        showArrow>
                        {submenuItem}
                      </Tooltip>
                    )
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          }

          const menuItem = (
            <DropdownMenuItem
              key={launcher.id}
              aria-label={typeof launcher.label === 'string' ? launcher.label : undefined}
              disabled={launcher.disabled}
              className={itemClassName}
              onMouseMove={() => setActiveTooltipId(tooltipContent ? launcher.id : null)}
              onMouseLeave={() => {
                if (activeTooltipId === launcher.id) setActiveTooltipId(null)
              }}
              onSelect={(event) => {
                event.preventDefault()
                event.stopPropagation()
                closeToolMenu()
                dispatchLauncher(launcher, { source, inputAdapter, quickPanel })
              }}>
              <ComposerToolMenuItemContent
                icon={launcher.icon}
                badge={suffixBadge}
                hasSubmenu={launcher.kind === 'panel' ? true : undefined}>
                {launcher.label}
              </ComposerToolMenuItemContent>
            </DropdownMenuItem>
          )

          if (!tooltipContent) return menuItem

          return (
            <Tooltip
              key={launcher.id}
              content={tooltipContent}
              placement="right"
              sideOffset={8}
              isOpen={activeTooltipId === launcher.id}
              onOpenChange={(nextOpen) => {
                if (!nextOpen && activeTooltipId === launcher.id) setActiveTooltipId(null)
              }}
              classNames={{ placeholder: 'block' }}
              showArrow>
              {menuItem}
            </Tooltip>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
