import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { ModelSelectorRow } from '@renderer/components/Selector/model/ModelSelectorRow'
import {
  DEFAULT_SELECTOR_CONTENT_HEIGHT,
  SelectorShell,
  type SelectorShellMountStrategy,
  type SelectorShellProps
} from '@renderer/components/Selector/shell/SelectorShell'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { CircleSlash, Folder, FolderPlus } from 'lucide-react'
import { type ReactElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WorkspaceSelector')
const DEFAULT_MIN_LIST_HEIGHT = 144

type SharedProps = {
  trigger: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: SelectorShellProps['side']
  align?: SelectorShellProps['align']
  sideOffset?: SelectorShellProps['sideOffset']
  mountStrategy?: SelectorShellMountStrategy
  disabled?: boolean
}

export type WorkspaceSelectorProps = SharedProps & {
  value: string | null | undefined
  onChange: (value: string | null) => void | Promise<void>
}

function workspaceMatchesSearch(workspace: AgentWorkspaceEntity, searchValue: string) {
  const query = searchValue.trim().toLowerCase()
  if (!query) return true

  return workspace.name.toLowerCase().includes(query) || workspace.path.toLowerCase().includes(query)
}

export function WorkspaceSelector({
  trigger,
  open: openProp,
  onOpenChange,
  side,
  align,
  sideOffset,
  mountStrategy,
  disabled,
  value,
  onChange
}: WorkspaceSelectorProps) {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const open = openProp ?? internalOpen
  const listboxId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const { data: workspaces, isLoading, refetch } = useQuery('/agent-workspaces')
  const { trigger: createWorkspace, isLoading: isCreatingWorkspace } = useMutation('POST', '/agent-workspaces', {
    refresh: ['/agent-workspaces']
  })

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, openProp]
  )

  useEffect(() => {
    if (open) {
      void refetch()
      return
    }

    setSearchValue('')
  }, [open, refetch])

  const filteredWorkspaces = useMemo(
    () => (workspaces ?? []).filter((workspace) => workspaceMatchesSearch(workspace, searchValue)),
    [searchValue, workspaces]
  )

  const selectedId = value ?? null

  useEffect(() => {
    if (!open || selectedId === null || !filteredWorkspaces.some((workspace) => workspace.id === selectedId)) {
      return
    }

    const element = listRef.current?.querySelector<HTMLElement>(`[data-option-id="${CSS.escape(selectedId)}"]`)
    element?.scrollIntoView({ block: 'start' })
  }, [filteredWorkspaces, open, selectedId])

  const handleSelectWorkspace = useCallback(
    async (workspaceId: string | null) => {
      if (workspaceId === selectedId) {
        handleOpenChange(false)
        return
      }

      await onChange(workspaceId)
      handleOpenChange(false)
    },
    [handleOpenChange, onChange, selectedId]
  )

  const handleCreateWorkspace = useCallback(async () => {
    handleOpenChange(false)

    let folderPath: string | null
    try {
      folderPath = await window.api.file.selectFolder({ properties: ['openDirectory', 'createDirectory'] })
    } catch (error) {
      logger.error('Failed to select workspace folder', error as Error)
      window.toast?.error(t('agent.session.workspace_selector.select_failed'))
      return
    }

    if (!folderPath) return

    try {
      const workspace = await createWorkspace({ body: { path: folderPath } })
      await refetch()
      await onChange(workspace.id)
    } catch (error) {
      logger.error('Failed to create workspace from folder', error as Error, { folderPath })
      window.toast?.error(t('agent.session.workspace_selector.create_failed'))
    }
  }, [createWorkspace, handleOpenChange, onChange, refetch, t])

  const renderWorkspaceRow = (workspace: AgentWorkspaceEntity) => {
    const selected = workspace.id === selectedId

    return (
      <div key={workspace.id} className="py-0.5">
        <ModelSelectorRow
          selected={selected}
          showSelectedIndicator={selected}
          leading={<Folder className="size-4 text-muted-foreground/70" />}
          onSelect={() => void handleSelectWorkspace(workspace.id)}
          rootProps={{ 'data-option-row': workspace.id }}
          optionProps={{
            'aria-selected': selected,
            'data-option-id': workspace.id
          }}>
          <span className="truncate text-foreground">{workspace.name}</span>
        </ModelSelectorRow>
      </div>
    )
  }

  const workspaceListContent = isLoading ? null : filteredWorkspaces.length === 0 ? (
    <EmptyState
      compact
      preset="no-result"
      description={t('agent.session.workspace_selector.empty_text')}
      className="min-h-full px-3 py-4"
    />
  ) : (
    filteredWorkspaces.map(renderWorkspaceRow)
  )

  return (
    <SelectorShell
      trigger={trigger}
      open={open}
      onOpenChange={handleOpenChange}
      width={320}
      side={side}
      align={align}
      sideOffset={sideOffset ?? 6}
      contentClassName="min-w-[280px]"
      mountStrategy={mountStrategy}
      contentHeight={DEFAULT_SELECTOR_CONTENT_HEIGHT}
      search={{
        value: searchValue,
        onChange: setSearchValue,
        placeholder: t('agent.session.workspace_selector.search_placeholder'),
        ariaControls: listboxId
      }}
      bottomAction={[
        {
          icon: <FolderPlus size={14} className="shrink-0" />,
          label: t('agent.session.workspace_selector.create_new'),
          disabled: disabled || isCreatingWorkspace,
          onClick: () => void handleCreateWorkspace()
        },
        {
          type: 'selectable',
          icon: <CircleSlash size={14} className="shrink-0" />,
          label: t('agent.session.workspace_selector.no_project'),
          selected: selectedId === null,
          onClick: () => void handleSelectWorkspace(null)
        }
      ]}>
      {({ availableListHeight }) => {
        const listHeight = availableListHeight ?? DEFAULT_MIN_LIST_HEIGHT

        return (
          <Scrollbar
            ref={listRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            className="min-h-0 flex-1 px-1 py-1 outline-none"
            style={{ height: listHeight }}>
            {workspaceListContent}
          </Scrollbar>
        )
      }}
    </SelectorShell>
  )
}
