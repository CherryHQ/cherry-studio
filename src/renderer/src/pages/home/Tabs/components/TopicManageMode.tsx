import AssistantAvatar from '@renderer/components/Avatar/AssistantAvatar'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { TopicManager } from '@renderer/hooks/useTopic'
import type { Assistant, Topic } from '@renderer/types'
import { cn } from '@renderer/utils'
import { Dropdown, Tooltip } from 'antd'
import { CheckSquare, FolderOpen, Search, Square, Trash2, XIcon } from 'lucide-react'
import type { FC, PropsWithChildren, Ref } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface TopicManageModeState {
  isManageMode: boolean
  selectedIds: Set<string>
  searchText: string
  enterManageMode: () => void
  exitManageMode: () => void
  toggleSelectTopic: (topicId: string) => void
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSearchText: React.Dispatch<React.SetStateAction<string>>
}

/**
 * Hook for managing topic selection state
 */
export function useTopicManageMode(): TopicManageModeState {
  const [isManageMode, setIsManageMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchText, setSearchText] = useState('')

  const enterManageMode = useCallback(() => {
    setIsManageMode(true)
    setSelectedIds(new Set())
    setSearchText('')
  }, [])

  const exitManageMode = useCallback(() => {
    setIsManageMode(false)
    setSelectedIds(new Set())
    setSearchText('')
  }, [])

  const toggleSelectTopic = useCallback((topicId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(topicId)) {
        next.delete(topicId)
      } else {
        next.add(topicId)
      }
      return next
    })
  }, [])

  return {
    isManageMode,
    selectedIds,
    searchText,
    enterManageMode,
    exitManageMode,
    toggleSelectTopic,
    setSelectedIds,
    setSearchText
  }
}

interface TopicManagePanelProps {
  assistant: Assistant
  assistants: Assistant[]
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  removeTopic: (topic: Topic) => void
  moveTopic: (topic: Topic, toAssistant: Assistant) => void
  manageState: TopicManageModeState
  filteredTopics: Topic[]
}

/**
 * Bottom panel component for topic management mode
 */
export const TopicManagePanel: React.FC<TopicManagePanelProps> = ({
  assistant,
  assistants,
  activeTopic,
  setActiveTopic,
  removeTopic,
  moveTopic,
  manageState,
  filteredTopics
}) => {
  const { t } = useTranslation()
  const { isManageMode, selectedIds, searchText, exitManageMode, setSelectedIds, setSearchText } = manageState
  const [isSearchMode, setIsSearchMode] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Topics that can be selected (non-pinned, and filtered when in search mode)
  const selectableTopics = useMemo(() => {
    const baseTopics = isSearchMode ? filteredTopics : assistant.topics
    return baseTopics.filter((topic) => !topic.pinned)
  }, [assistant.topics, filteredTopics, isSearchMode])

  // Check if all selectable topics are selected
  const isAllSelected = useMemo(() => {
    return selectableTopics.length > 0 && selectableTopics.every((topic) => selectedIds.has(topic.id))
  }, [selectableTopics, selectedIds])

  // Other assistants for move operation
  const otherAssistants = useMemo(() => assistants.filter((a) => a.id !== assistant.id), [assistants, assistant.id])

  // Handle select all / deselect all
  const handleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableTopics.map((topic) => topic.id)))
    }
  }, [isAllSelected, selectableTopics, setSelectedIds])

  // Handle clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [setSelectedIds])

  // Handle delete selected topics
  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return

    const remainingTopics = assistant.topics.filter((topic) => !selectedIds.has(topic.id))
    if (remainingTopics.length === 0) {
      window.toast.error(t('chat.topics.manage.error.at_least_one'))
      return
    }

    const confirmed = await window.modal.confirm({
      title: t('chat.topics.manage.delete.confirm.title'),
      content: t('chat.topics.manage.delete.confirm.content', { count: selectedIds.size }),
      centered: true,
      okButtonProps: { danger: true }
    })

    if (!confirmed) return

    await modelGenerating()

    const deletedCount = selectedIds.size
    for (const id of selectedIds) {
      const topic = assistant.topics.find((t) => t.id === id)
      if (topic) {
        await TopicManager.removeTopic(id)
        removeTopic(topic)
      }
    }

    // Switch to first remaining topic if current topic was deleted
    if (selectedIds.has(activeTopic.id)) {
      setActiveTopic(remainingTopics[0])
    }

    window.toast.success(t('chat.topics.manage.delete.success', { count: deletedCount }))
    exitManageMode()
  }, [selectedIds, assistant.topics, removeTopic, activeTopic.id, setActiveTopic, t, exitManageMode])

  // Handle move selected topics to another assistant
  const handleMoveSelected = useCallback(
    async (targetAssistantId: string) => {
      if (selectedIds.size === 0) return

      const targetAssistant = assistants.find((a) => a.id === targetAssistantId)
      if (!targetAssistant) return

      const remainingTopics = assistant.topics.filter((topic) => !selectedIds.has(topic.id))
      if (remainingTopics.length === 0) {
        window.toast.error(t('chat.topics.manage.error.at_least_one'))
        return
      }

      await modelGenerating()

      const movedCount = selectedIds.size
      for (const id of selectedIds) {
        const topic = assistant.topics.find((t) => t.id === id)
        if (topic) {
          moveTopic(topic, targetAssistant)
        }
      }

      // Switch to first remaining topic if current topic was moved
      if (selectedIds.has(activeTopic.id)) {
        setActiveTopic(remainingTopics[0])
      }

      window.toast.success(t('chat.topics.manage.move.success', { count: movedCount }))
      exitManageMode()
    },
    [selectedIds, assistant.topics, assistants, moveTopic, activeTopic.id, setActiveTopic, t, exitManageMode]
  )

  // Enter search mode
  const enterSearchMode = useCallback(() => {
    setIsSearchMode(true)
  }, [])

  // Exit search mode
  const exitSearchMode = useCallback(() => {
    setIsSearchMode(false)
    setSearchText('')
  }, [setSearchText])

  // Focus input when entering search mode
  useEffect(() => {
    if (isSearchMode && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isSearchMode])

  // Reset search mode when exiting manage mode
  useEffect(() => {
    if (!isManageMode) {
      setIsSearchMode(false)
    }
  }, [isManageMode])

  // Handle search input keydown
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        exitSearchMode()
      }
    },
    [exitSearchMode]
  )

  if (!isManageMode) return null

  // Search mode UI
  if (isSearchMode) {
    return (
      <ManagePanel>
        <ManagePanelContent>
          <LeftGroup>
            <Tooltip title={isAllSelected ? t('chat.topics.manage.deselect_all') : t('common.select_all')}>
              <ManageIconButton onClick={handleSelectAll}>
                {isAllSelected ? <CheckSquare size={16} /> : <Square size={16} />}
              </ManageIconButton>
            </Tooltip>
            {selectedIds.size > 0 && (
              <Tooltip title={t('chat.topics.manage.clear_selection')}>
                <SelectedBadge onClick={handleClearSelection}>{selectedIds.size}</SelectedBadge>
              </Tooltip>
            )}
          </LeftGroup>
          <SearchInputWrapper>
            <SearchInput
              ref={searchInputRef}
              type="text"
              placeholder={t('chat.topics.search.placeholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </SearchInputWrapper>
          <Tooltip title={t('common.close')}>
            <ManageIconButton onClick={exitSearchMode}>
              <XIcon size={16} />
            </ManageIconButton>
          </Tooltip>
        </ManagePanelContent>
      </ManagePanel>
    )
  }

  // Normal manage mode UI
  return (
    <ManagePanel>
      <ManagePanelContent>
        <LeftGroup>
          <Tooltip title={isAllSelected ? t('chat.topics.manage.deselect_all') : t('common.select_all')}>
            <ManageIconButton onClick={handleSelectAll}>
              {isAllSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            </ManageIconButton>
          </Tooltip>
          {selectedIds.size > 0 && (
            <Tooltip title={t('chat.topics.manage.clear_selection')}>
              <SelectedBadge onClick={handleClearSelection}>{selectedIds.size}</SelectedBadge>
            </Tooltip>
          )}
        </LeftGroup>
        <RightGroup>
          <Tooltip title={t('chat.topics.search.title')}>
            <ManageIconButton onClick={enterSearchMode}>
              <Search size={16} />
            </ManageIconButton>
          </Tooltip>
          {otherAssistants.length > 0 && (
            <Dropdown
              menu={{
                items: otherAssistants.map((a) => ({
                  key: a.id,
                  label: a.name,
                  icon: <AssistantAvatar assistant={a} size={18} />,
                  onClick: () => handleMoveSelected(a.id),
                  disabled: selectedIds.size === 0
                }))
              }}
              trigger={['click']}
              disabled={selectedIds.size === 0}>
              <Tooltip title={t('chat.topics.move_to')}>
                <ManageIconButton disabled={selectedIds.size === 0}>
                  <FolderOpen size={16} />
                </ManageIconButton>
              </Tooltip>
            </Dropdown>
          )}
          <Tooltip title={t('common.delete')}>
            <ManageIconButton danger onClick={handleDeleteSelected} disabled={selectedIds.size === 0}>
              <Trash2 size={16} />
            </ManageIconButton>
          </Tooltip>
          <ManageDivider />
          <Tooltip title={t('common.cancel')}>
            <ManageIconButton onClick={exitManageMode}>
              <XIcon size={16} />
            </ManageIconButton>
          </Tooltip>
        </RightGroup>
      </ManagePanelContent>
    </ManagePanel>
  )
}

// Tailwind components
const ManagePanel: FC<PropsWithChildren> = ({ children }) => (
  <div className="absolute bottom-[15px] left-[12px] z-[100] flex w-[calc(var(--assistants-width)-24px)] flex-row items-center rounded-xl bg-[var(--color-background)] px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.15),0_0_0_1px_var(--color-border)]">
    {children}
  </div>
)

const ManagePanelContent: FC<PropsWithChildren> = ({ children }) => (
  <div className="flex w-full min-w-0 flex-row items-center gap-1 overflow-hidden">{children}</div>
)

interface ManageIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean
}

const ManageIconButton: FC<PropsWithChildren<ManageIconButtonProps>> = ({
  children,
  className,
  danger,
  disabled,
  ...props
}) => (
  <button
    {...props}
    type="button"
    disabled={disabled}
    className={cn(
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none bg-transparent text-[var(--color-text-2)] transition-all duration-200',
      disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      !disabled && !danger && 'hover:bg-[var(--color-background-mute)] hover:text-[var(--color-text-1)]',
      danger && 'text-[var(--color-error)]',
      danger && !disabled && 'hover:bg-[var(--color-error)] hover:text-white [&:hover>svg]:text-white',
      className
    )}>
    {children}
  </button>
)

const ManageDivider: FC = () => <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />

const LeftGroup: FC<PropsWithChildren> = ({ children }) => <div className="flex items-center gap-1">{children}</div>

const RightGroup: FC<PropsWithChildren> = ({ children }) => (
  <div className="ml-auto flex items-center gap-1">{children}</div>
)

const SelectedBadge: FC<PropsWithChildren<React.HTMLAttributes<HTMLSpanElement>>> = ({
  children,
  className,
  ...props
}) => (
  <span
    {...props}
    className={cn(
      'inline-flex h-[18px] min-w-[18px] cursor-pointer items-center justify-center rounded-[9px] bg-[var(--color-primary)] px-[5px] font-medium text-[11px] text-white transition-opacity duration-200 hover:opacity-[0.85]',
      className
    )}>
    {children}
  </span>
)

const SearchInputWrapper: FC<PropsWithChildren> = ({ children }) => (
  <div className="mx-1 flex min-w-0 flex-1 items-center gap-1">{children}</div>
)

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>
}

const SearchInput: FC<SearchInputProps> = ({ className, ref, ...props }) => (
  <input
    {...props}
    ref={ref}
    className={cn(
      'h-7 min-w-0 flex-1 border-none bg-transparent p-0 text-[13px] text-[var(--color-text-1)] outline-none placeholder:text-[var(--color-text-3)]',
      className
    )}
  />
)

export default TopicManagePanel
