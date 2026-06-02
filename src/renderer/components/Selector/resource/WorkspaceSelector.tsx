import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import type { WorkspaceEntity } from '@shared/data/api/schemas/workspaces'
import { CircleSlash, Folder, FolderPlus } from 'lucide-react'
import { type ReactElement, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelSelectorRow } from '../model/ModelSelectorRow'
import { SelectorShell, type SelectorShellMountStrategy, type SelectorShellProps } from '../shell/SelectorShell'

const logger = loggerService.withContext('WorkspaceSelector')
const DEFAULT_MIN_LIST_HEIGHT = 144
const DEFAULT_MAX_LIST_HEIGHT = 320

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

function workspaceMatchesSearch(workspace: WorkspaceEntity, searchValue: string) {
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

  const { data: workspaces, isLoading, refetch } = useQuery('/workspaces')
  const { trigger: createWorkspace, isLoading: isCreatingWorkspace } = useMutation('POST', '/workspaces', {
    refresh: ['/workspaces']
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

  const renderWorkspaceRow = (workspace: WorkspaceEntity) => {
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
        const listMaxHeight =
          availableListHeight === undefined
            ? DEFAULT_MAX_LIST_HEIGHT
            : Math.min(DEFAULT_MAX_LIST_HEIGHT, availableListHeight)
        const listMinHeight =
          availableListHeight === undefined
            ? DEFAULT_MIN_LIST_HEIGHT
            : Math.min(DEFAULT_MIN_LIST_HEIGHT, availableListHeight)

        return (
          <Scrollbar
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            className="min-h-0 flex-1 px-1 py-1 outline-none"
            style={{ maxHeight: listMaxHeight, minHeight: listMinHeight }}>
            {workspaceListContent}
          </Scrollbar>
        )
      }}
    </SelectorShell>
  )
}
