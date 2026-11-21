import { Icon } from '@iconify/react'
import { Bot, FolderOpen, Globe, LoaderCircle, Plus, TerminalSquare, TriangleAlert } from 'lucide-react'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import {
  getArtifactPaneSelectionPath,
  type ArtifactPaneFileSelection
} from '@renderer/components/chat/panes/ArtifactPane'
import { getPathBasename } from '@renderer/components/chat/panes/artifactPanePath'
import {
  RightPanelHeaderControls,
  useRightPanelActions,
  useRightPanelState
} from '@renderer/components/chat/panes/Shell'
import { RightPaneTabs, type RightPaneTab } from '@renderer/components/RightPaneTabs'
import { useTerminalResources } from '@renderer/components/terminal/TerminalResourcesProvider'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { agentBrowserRuntimeService as browser } from '@renderer/services/AgentBrowserRuntimeService'
import { getFileIconName } from '@renderer/utils/fileIconName'
import type { WorkspaceUsageRecord } from '@shared/types/workspaceUsage'

const HeaderSlotContext = createContext<{
  element: HTMLDivElement | null
  setElement: (node: HTMLDivElement | null) => void
} | null>(null)
export function AgentResourceHeaderProvider({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  return <HeaderSlotContext value={{ element, setElement }}>{children}</HeaderSlotContext>
}
export function AgentResourceHeaderControls({
  children,
  panelId
}: {
  children: ReactNode
  panelId: 'files' | 'terminal'
}) {
  const slot = use(HeaderSlotContext)
  const panel = useRightPanelState()
  return slot?.element && panel.activePanelId === panelId ? createPortal(children, slot.element) : null
}

type ResourceTab = RightPaneTab &
  (
    | { kind: 'file-browser' }
    | { kind: 'file'; file: ArtifactPaneFileSelection }
    | { kind: 'browser'; id: string }
    | { kind: 'terminal'; id: string }
    | { kind: 'cleanup'; record: WorkspaceUsageRecord }
  )
const fileKey = (file: ArtifactPaneFileSelection) =>
  `file:${JSON.stringify([file.workspacePath, file.filePath, file.previewType ?? 'artifact', Boolean(file.readOnly)])}`

export function AgentResourceTabs({
  files,
  selectedFile,
  dirty,
  activateFile,
  closeFile
}: {
  files: ArtifactPaneFileSelection[]
  selectedFile: ArtifactPaneFileSelection | null
  dirty: boolean
  activateFile: (file: ArtifactPaneFileSelection) => void
  closeFile: (file: ArtifactPaneFileSelection) => void
}) {
  const { t } = useTranslation()
  const terminal = useTerminalResources()
  const panel = useRightPanelState()
  const actions = useRightPanelActions()
  const slot = use(HeaderSlotContext)
  const prefix = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingClose, setPendingClose] = useState<{
    key: string
    kind: ResourceTab['kind']
    next: string | null
    keyboard: boolean
  } | null>(null)
  const [browserEnabled] = usePreference('app.browser.agent_control.enabled')
  const pages = useSyncExternalStore(browser.subscribe, () => browser.getPages(terminal.sessionId))
  const page = useSyncExternalStore(browser.subscribe, () => browser.get(terminal.sessionId))
  const cleanup = useSWR(menuOpen ? 'terminal-cleanup-list' : null, () => ipcApi.request('terminal.cleanup.list', {}))
  const warning = (terminal.cleanup.data?.count ?? 0) > 0 || terminal.cleanup.data?.recoveryFailed
  const setTabs = terminal.setTabs
  const filesActive = panel.activePanelId === 'files' && panel.presentationOpen
  useEffect(() => {
    if (!filesActive || files.length) return
    setTabs((current) => (current.fileBrowserOpen ? current : { ...current, fileBrowserOpen: true }))
  }, [filesActive, files.length, terminal.sessionId, setTabs])
  const all: ResourceTab[] = [
    ...(!files.length && terminal.tabs.fileBrowserOpen
      ? [
          {
            kind: 'file-browser',
            key: 'files',
            title: t('agent.right_pane.tabs.files'),
            path: t('agent.right_pane.tabs.files'),
            icon: <FolderOpen className="size-3.5 shrink-0" aria-hidden />
          } satisfies ResourceTab
        ]
      : []),
    ...files.map(
      (file): ResourceTab => ({
        kind: 'file',
        file,
        key: fileKey(file),
        title: file.displayName ?? getPathBasename(file.filePath),
        path: getArtifactPaneSelectionPath(file),
        icon: <Icon icon={getFileIconName(file.filePath)} className="size-3.5 shrink-0" aria-hidden />
      })
    ),
    ...pages.map(
      (item): ResourceTab => ({
        kind: 'browser',
        id: item.pageId,
        key: `browser:${item.pageId}`,
        title: item.title || (item.url === 'about:blank' ? t('webview.tabs.new') : item.url),
        path: item.url,
        icon: item.loading ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Globe className="size-3.5 shrink-0" aria-hidden />
        ),
        status: item.executing ? (
          <Bot className="size-3.5 shrink-0 text-primary" aria-label={t('terminal.agent_active')} />
        ) : undefined
      })
    ),
    ...terminal.tabs.terminals
      .filter((item) => !terminal.tabs.hiddenTerminalIds.includes(item.id))
      .map((item): ResourceTab => {
        const resource = terminal.resources.find((resource) => resource.id === item.id)
        const unconfirmed = resource?.cleanup === 'unconfirmed' || resource?.process.kind === 'lost'
        const agent = resource?.control.kind === 'agent'
        return {
          kind: 'terminal',
          id: item.id,
          key: `terminal:${item.id}`,
          title: item.title,
          path: item.title,
          icon: <TerminalSquare className="size-3.5 shrink-0" aria-hidden />,
          status: unconfirmed ? (
            <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-label={t('terminal.cleanup.unconfirmed')} />
          ) : agent ? (
            <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
              <Bot className="size-3" aria-hidden />
              {t(
                resource?.process.kind === 'running' &&
                  (resource.kind === 'pipe' || resource.shellFacts?.kind === 'program')
                  ? 'terminal.agent_active'
                  : 'terminal.agent_control'
              )}
            </span>
          ) : resource?.kind === 'pipe' && resource.process.kind === 'running' ? (
            <span className="text-xs text-muted-foreground">{t('terminal.background')}</span>
          ) : undefined
        }
      }),
    ...terminal.cleanupTabs.map(
      (record): ResourceTab => ({
        kind: 'cleanup',
        record,
        key: `cleanup:${record.id}`,
        title: t('terminal.cleanup.unconfirmed'),
        path: record.cwd,
        icon: <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
      })
    )
  ]
  const tabs = [...all].sort((a, b) => {
    const left = terminal.tabs.order.indexOf(a.key),
      right = terminal.tabs.order.indexOf(b.key)
    return (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right)
  })
  const keys = tabs.map((tab) => tab.key)
  useEffect(() => {
    setTabs((current) =>
      current.order.length === keys.length && current.order.every((key, index) => key === keys[index])
        ? current
        : { ...current, order: keys }
    )
  }, [keys, setTabs])
  const activeKey =
    panel.activePanelId === 'files'
      ? selectedFile
        ? fileKey(selectedFile)
        : 'files'
      : panel.activePanelId === 'browser'
        ? page
          ? `browser:${page.pageId}`
          : null
        : terminal.selectedCleanupId
          ? `cleanup:${terminal.selectedCleanupId}`
          : terminal.tabs.selectedTerminalId
            ? `terminal:${terminal.tabs.selectedTerminalId}`
            : null
  const activate = useCallback(
    (key: string) => {
      setPendingClose(null)
      const tab = tabs.find((item) => item.key === key)
      if (!tab) return
      if (tab.kind === 'file-browser') actions.requestOpen('files', { userInitiated: true })
      else if (tab.kind === 'file') activateFile(tab.file)
      else if (tab.kind === 'browser') {
        browser.activate(terminal.sessionId, tab.id)
        actions.requestOpen('browser', { userInitiated: true })
      } else if (tab.kind === 'terminal') terminal.show(tab.id, tab.title)
      else terminal.openCleanup(tab.record)
    },
    [tabs, activateFile, actions, terminal]
  )
  useEffect(() => {
    if (pendingClose?.kind === 'terminal' && activeKey && activeKey !== pendingClose.key) {
      setPendingClose(null)
      return
    }
    if (!pendingClose || tabs.some((tab) => tab.key === pendingClose.key)) return
    const next =
      pendingClose.next && tabs.some((tab) => tab.key === pendingClose.next) ? pendingClose.next : tabs[0]?.key
    if (next) {
      activate(next)
      if (pendingClose.keyboard) requestAnimationFrame(() => document.getElementById(`${prefix}-${next}`)?.focus())
    }
    setPendingClose(null)
  }, [pendingClose, tabs, activate, prefix, activeKey])
  const close = (key: string, keyboard: boolean) => {
    const index = tabs.findIndex((item) => item.key === key)
    const tab = tabs[index]
    if (!tab) return
    if (key === activeKey)
      setPendingClose({ key, kind: tab.kind, next: tabs[index + 1]?.key ?? tabs[index - 1]?.key ?? null, keyboard })
    if (tab.kind === 'file-browser') {
      setTabs((current) => ({ ...current, fileBrowserOpen: false }))
      if (key === activeKey && tabs.length === 1) actions.close()
    } else if (tab.kind === 'file') closeFile(tab.file)
    else if (tab.kind === 'browser') browser.closePages(terminal.sessionId, [tab.id])
    else if (tab.kind === 'terminal')
      void terminal.close(tab.id).then((result) => {
        if (result === 'rejected') setPendingClose((current) => (current?.key === key ? null : current))
      })
    else terminal.closeCleanup(tab.record.id)
  }
  return (
    <div
      className="flex min-h-(--navbar-height) min-w-0 shrink-0 items-center gap-1 border-b border-border-subtle bg-card px-2 [-webkit-app-region:no-drag]"
      data-testid="agent-resource-header">
      <RightPaneTabs
        tabs={tabs}
        activeKey={activeKey}
        label={t('agent.resources.tabs')}
        activeDirty={panel.activePanelId === 'files' && dirty}
        dirtyLabel={t('agent.preview_pane.edit.unsaved')}
        closeLabel={t('common.close')}
        overflowLabel={t('webview.tabs.all')}
        tabIdPrefix={prefix}
        onActivate={activate}
        onClose={close}
      />
      <div ref={slot?.setElement} className="flex shrink-0 items-center gap-1" />
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip content={t('agent.resources.open_create')}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('agent.resources.open_create')}
              className="relative shrink-0">
              <Plus className="size-4" />
              {terminal.truncated && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('terminal.history_limited')}</p>
              )}
              {warning && (
                <span
                  className="absolute end-0 top-0 size-1.5 rounded-full bg-warning"
                  aria-label={t('terminal.cleanup.unconfirmed')}
                />
              )}
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-auto">
          <DropdownMenuItem disabled={terminal.creating} onSelect={() => void terminal.create()}>
            <TerminalSquare className="size-4" />
            {t('terminal.new_terminal')}
          </DropdownMenuItem>
          {browserEnabled && (
            <DropdownMenuItem
              onSelect={() => {
                browser.openStartPage(terminal.sessionId)
                actions.requestOpen('browser', { userInitiated: true })
              }}>
              <Globe className="size-4" />
              {t('webview.tabs.new')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={!actions.canOpen('files')}
            onSelect={() => actions.requestOpen('files', { userInitiated: true })}>
            <FolderOpen className="size-4" />
            {t('agent.right_pane.tabs.files')}
          </DropdownMenuItem>
          {warning && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-warning">{t('terminal.cleanup.unconfirmed')}</DropdownMenuLabel>
              {cleanup.data?.map((record) => (
                <DropdownMenuItem key={record.id} onSelect={() => terminal.openCleanup(record)}>
                  <TriangleAlert className="size-4 shrink-0" />
                  <span className="truncate" title={record.cwd}>
                    {record.cwd}
                  </span>
                </DropdownMenuItem>
              ))}
              {(terminal.cleanup.data?.recoveryFailed || cleanup.error) && (
                <p role="alert" className="px-2 py-1.5 text-xs text-warning">
                  {t('terminal.cleanup.protected')}
                </p>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <RightPanelHeaderControls canMaximize />
    </div>
  )
}
