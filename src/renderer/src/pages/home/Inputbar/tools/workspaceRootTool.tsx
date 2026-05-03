/**
 * Workspace root picker — binds the active topic to a filesystem directory.
 */

import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import { dataApiService } from '@renderer/data/DataApiService'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useTopicById } from '@renderer/hooks/useTopicDataApi'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import { Tooltip } from 'antd'
import { Check, Folder, FolderCheck, FolderLock, FolderOpen, FolderX } from 'lucide-react'
import { useCallback } from 'react'
import styled from 'styled-components'

const logger = loggerService.withContext('workspaceRootTool')
const SYMBOL = 'workspace-root'

async function setWorkspaceRoot(topicId: string, workspaceRoot: string | null): Promise<void> {
  try {
    await dataApiService.patch(`/topics/${topicId}`, { body: { workspaceRoot } })
  } catch (err) {
    // Persistent route 404 = topic still lives in TemporaryChatService.
    // Retry on the temp route; any other error propagates.
    if (isDataApiError(err) && err.code === ErrorCode.NOT_FOUND) {
      await dataApiService.patch(`/temporary/topics/${topicId}`, { body: { workspaceRoot } })
      return
    }
    throw err
  }
}

/** Last path segment, e.g. `/Users/me/proj` → `proj`. Falls back to the full
 *  path for edge cases like `/` or paths ending with a separator. */
function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (!trimmed) return path
  const segs = trimmed.split(/[\\/]/)
  const last = segs[segs.length - 1]
  return last || trimmed
}

/** Pretty path for descriptions — `~` shorthand + truncation. */
function formatPath(path: string): string {
  const home = '/Users/'
  let display = path
  if (display.startsWith(home)) {
    const rest = display.slice(home.length)
    const slash = rest.indexOf('/')
    if (slash > 0) display = `~/${rest.slice(slash + 1)}`
  }
  if (display.length > 60) display = `${display.slice(0, 28)}…${display.slice(-28)}`
  return display
}

const workspaceRootTool = defineTool({
  key: 'workspace_root',
  label: (t) => t('chat.input.workspace.label', 'Workspace folder'),
  visibleInScopes: [TopicType.Chat],

  render: function WorkspaceRootRender(context) {
    const { t, topic, quickPanelController } = context
    const invalidate = useInvalidateCache()
    const [override, setOverride] = useSharedCache(`topic.workspace_root_override.${topic?.id ?? '_none'}` as const)

    const { topic: topicById } = useTopicById(topic?.id)
    const isLocked = !!topicById

    const currentRoot = override !== null ? override.root : (topic?.workspaceRoot ?? null)
    const isSet = !!currentRoot

    const apply = useCallback(
      async (next: string | null) => {
        if (!topic?.id) return
        try {
          await setWorkspaceRoot(topic.id, next)
          // Write through to the shared cache so this and other windows
          // see the new value immediately, regardless of SWR liveness.
          setOverride({ root: next })
          // Best-effort SWR refresh for persistent topics; silently
          // no-ops for temp topics (route 404s but the cache write
          // already covered the UI).
          await Promise.all([invalidate(`/topics/${topic.id}`), invalidate('/topics')])
        } catch (err) {
          logger.error('Failed to update workspace root', err as Error)
          window.toast?.error?.(t('chat.input.workspace.error', 'Failed to set workspace folder'))
        }
      },
      [topic?.id, setOverride, invalidate, t]
    )

    const pickFolder = useCallback(async () => {
      const folderPath = await window.api.file.selectFolder({
        title: t('chat.input.workspace.picker_title', 'Choose workspace folder')
      })
      if (!folderPath) return
      await apply(folderPath)
    }, [apply, t])

    const clearFolder = useCallback(() => apply(null), [apply])

    // Click is only wired in the editable render mode (see below). Locked
    // topics short-circuit before reaching this handler — the badge is a
    // <div> with no onClick.
    const handleClick = useCallback(() => {
      // Toggle: close if our panel is already showing.
      if (quickPanelController.isVisible && quickPanelController.symbol === SYMBOL) {
        quickPanelController.close('esc')
        return
      }

      const items: Array<{
        label: string
        description?: string
        icon: React.ReactNode
        isSelected?: boolean
        action: () => void
      }> = []

      if (isSet) {
        items.push({
          label: basenameOf(currentRoot),
          description: formatPath(currentRoot),
          icon: <Check size={16} />,
          isSelected: true,
          action: () => quickPanelController.close('click')
        })
      }

      items.push({
        label: t('chat.input.workspace.pick', 'Pick folder…'),
        description: isSet
          ? t('chat.input.workspace.replace_hint', 'Replace the current workspace')
          : t('chat.input.workspace.pick_hint', 'Bind this topic to a folder on disk'),
        icon: <FolderOpen size={16} />,
        action: () => void pickFolder()
      })

      if (isSet) {
        items.push({
          label: t('chat.input.workspace.clear', 'Clear workspace'),
          description: t('chat.input.workspace.clear_hint', 'Unbind this topic from any folder'),
          icon: <FolderX size={16} />,
          action: () => void clearFolder()
        })
      }

      quickPanelController.open({
        title: isSet
          ? t('chat.input.workspace.title_set', 'Workspace: {{path}}', { path: formatPath(currentRoot) })
          : t('chat.input.workspace.title_unset', 'Workspace folder (none)'),
        symbol: SYMBOL,
        list: items
      })
    }, [quickPanelController, t, isSet, currentRoot, pickFolder, clearFolder])

    const tooltipTitle = isLocked
      ? t('chat.input.workspace.tooltip_locked', '{{path}} — locked after first message', { path: currentRoot ?? '' })
      : isSet
        ? t('chat.input.workspace.tooltip_set', 'Workspace: {{path}}', { path: currentRoot })
        : t('chat.input.workspace.tooltip_unset', 'Bind a workspace folder')

    // Three render modes:
    //  - locked + bound: static badge, no click target. Opening a panel
    //    here would imply mutability — even a read-only panel signals
    //    "pick something". So we drop the affordance entirely.
    //  - editable + bound: pill button that opens the picker.
    //  - unset: bare icon button.
    if (isSet && isLocked) {
      return (
        <Tooltip placement="top" title={tooltipTitle} mouseLeaveDelay={0}>
          <PillBadge>
            <FolderLock size={16} color="#8c8c8c" />
            <PillLabel>{basenameOf(currentRoot)}</PillLabel>
          </PillBadge>
        </Tooltip>
      )
    }

    if (isSet) {
      return (
        <Tooltip placement="top" title={tooltipTitle} mouseLeaveDelay={0}>
          <PillButton type="button" onClick={handleClick}>
            <FolderCheck size={16} color="#1677ff" />
            <PillLabel>{basenameOf(currentRoot)}</PillLabel>
          </PillButton>
        </Tooltip>
      )
    }

    return (
      <Tooltip placement="top" title={tooltipTitle} mouseLeaveDelay={0}>
        <ActionIconButton onClick={handleClick} icon={<Folder size={18} />} />
      </Tooltip>
    )
  }
})

registerTool(workspaceRootTool)

export default workspaceRootTool

const PillButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  background: rgba(22, 119, 255, 0.08);
  border: 1px solid rgba(22, 119, 255, 0.3);
  border-radius: 6px;
  color: #1677ff;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;
  &:hover {
    background: rgba(22, 119, 255, 0.16);
  }
`

/** Static, non-interactive variant — used after the topic is persisted. */
const PillBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 6px;
  color: #595959;
  font-size: 12px;
  white-space: nowrap;
  cursor: default;
  user-select: none;
`

const PillLabel = styled.span`
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
