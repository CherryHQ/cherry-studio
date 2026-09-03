import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MenuList,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { chooseImageExportMode } from '@renderer/services/imageExportModeChooser'
import { toast } from '@renderer/services/toast'
import type { Topic } from '@renderer/types/topic'
import type { TopicBranchSummary } from '@renderer/types/topicBranch'
import { cn } from '@renderer/utils/style'
import { formatRelativeTime } from '@renderer/utils/time'
import type { TreeResponse } from '@shared/data/types/message'
import { Brain, CopyPlus, Download, GitBranch, MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildTopicBranchSummaries } from './topicBranchSummaries'

const logger = loggerService.withContext('TopicBranchSwitcher')

const EMPTY_TREE: TreeResponse = {
  activeNodeId: null,
  rootId: null,
  nodes: [],
  siblingsGroups: []
}

const EXPORT_MENU_PREFERENCES = {
  markdown: 'data.export.menus.markdown',
  markdownReason: 'data.export.menus.markdown_reason'
} as const

interface TopicBranchSwitcherProps {
  topic: Topic
  anchor: ReactNode
}

interface BranchAction {
  id: string
  label: string
  icon: ReactNode
  disabled?: boolean
  run: () => void
}

function BranchActionItems({ actions, kind }: { actions: BranchAction[]; kind: 'dropdown' | 'context' }) {
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem

  return actions.map((action) => (
    <Item key={action.id} disabled={action.disabled} onSelect={action.run}>
      {action.icon}
      {action.label}
    </Item>
  ))
}

function TopicBranchSwitcher({ topic, anchor }: TopicBranchSwitcherProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isBranchWritePending, setIsBranchWritePending] = useState(false)
  const actionMenuOpenRef = useRef(false)
  const branchWriteInFlightRef = useRef(false)
  const activeButtonRef = useRef<HTMLButtonElement>(null)
  const activeRowRef = useRef<HTMLDivElement>(null)
  const [exportMenuOptions] = useMultiplePreferences(EXPORT_MENU_PREFERENCES)
  const messagesCachePath = `/topics/${topic.id}/messages` as const
  const treeCachePath = `/topics/${topic.id}/tree` as const
  const { data, error, isLoading, refetch } = useQuery('/topics/:topicId/tree', {
    params: { topicId: topic.id },
    query: { depth: -1 }
  })
  useDataChange(
    '/topics/:topicId/tree',
    () => {
      void refetch()
    },
    { routeParams: { topicId: topic.id } }
  )
  const { trigger: setActiveNode } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: [messagesCachePath, treeCachePath]
  })
  const { trigger: copyBranchToNewTopic } = useMutation('POST', '/topics/:id/duplicate', {
    refresh: ['/topics']
  })

  const branches = useMemo(() => buildTopicBranchSummaries(data ?? EMPTY_TREE), [data])
  const endpointCount = branches.filter((branch) => branch.name.kind !== 'currentPath').length
  const currentBranch = branches.find((branch) => branch.isActive) ?? branches.find((branch) => branch.isMain)
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }), [i18n.language])

  const getBranchName = useCallback(
    (branch: TopicBranchSummary) => {
      switch (branch.name.kind) {
        case 'main':
          return t('chat.branch_switcher.main')
        case 'currentPath':
          return t('chat.branch_switcher.current_path')
        case 'newBranch':
          return t('chat.branch_switcher.new_branch')
        case 'preview':
          return branch.name.value
        case 'fallback':
          return t('chat.branch_switcher.fallback', { number: branch.name.index })
      }
    },
    [t]
  )

  const getBranchDescription = useCallback(
    (branch: TopicBranchSummary) => {
      const turns = t('chat.branch_switcher.turn_count', { count: branch.turnCount })
      if (branch.isMain || branch.name.kind === 'currentPath') {
        return `${t('chat.branch_switcher.last_active', {
          time: formatRelativeTime(branch.lastActivityAt, i18n.language)
        })} · ${turns}`
      }

      const branchPoint =
        branch.branchPointTurn === 0
          ? t('chat.branch_switcher.branched_at_start')
          : t('chat.branch_switcher.branched_after_turn', { turn: branch.branchPointTurn })
      const branchDate = branch.branchCreatedAt ? dateFormatter.format(new Date(branch.branchCreatedAt)) : ''
      return [branchPoint, branchDate, turns].filter(Boolean).join(' · ')
    },
    [dateFormatter, i18n.language, t]
  )

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      activeRowRef.current?.scrollIntoView?.({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && actionMenuOpenRef.current) return
    setOpen(nextOpen)
  }, [])

  const handleActionMenuOpenChange = useCallback((nextOpen: boolean) => {
    actionMenuOpenRef.current = nextOpen
  }, [])

  const handleBranchSelect = useCallback(
    async (branch: TopicBranchSummary) => {
      if (branch.isActive) {
        setOpen(false)
        return
      }
      if (branchWriteInFlightRef.current) return

      branchWriteInFlightRef.current = true
      setIsBranchWritePending(true)
      try {
        await setActiveNode({ params: { id: topic.id }, body: { nodeId: branch.nodeId } })
        setOpen(false)
      } catch (cause) {
        logger.error('Failed to switch topic branch', cause as Error)
        toast.error(t('chat.branch_switcher.switch_failed'))
        void refetch()
      } finally {
        branchWriteInFlightRef.current = false
        setIsBranchWritePending(false)
      }
    },
    [refetch, setActiveNode, t, topic.id]
  )

  const handleExport = useCallback(
    async (branch: TopicBranchSummary, exportReasoning: boolean) => {
      setOpen(false)
      const { exportTopicBranchAsMarkdown } = await import('@renderer/services/ExportService')
      await exportTopicBranchAsMarkdown(
        topic,
        { nodeId: branch.nodeId, name: getBranchName(branch) },
        exportReasoning,
        chooseImageExportMode
      )
    },
    [getBranchName, topic]
  )

  const handleCopy = useCallback(
    async (branch: TopicBranchSummary) => {
      if (branchWriteInFlightRef.current) return

      branchWriteInFlightRef.current = true
      setIsBranchWritePending(true)
      try {
        await copyBranchToNewTopic({ params: { id: topic.id }, body: { nodeId: branch.nodeId } })
        setOpen(false)
        toast.success(t('chat.message.flow.copy_topic.created'))
      } catch (cause) {
        logger.error('Failed to copy topic branch to a new conversation', cause as Error)
        toast.error(t('chat.branch_switcher.copy_failed'))
      } finally {
        branchWriteInFlightRef.current = false
        setIsBranchWritePending(false)
      }
    },
    [copyBranchToNewTopic, t, topic.id]
  )

  const getBranchActions = useCallback(
    (branch: TopicBranchSummary): BranchAction[] => [
      ...(exportMenuOptions.markdown
        ? [
            {
              id: 'markdown',
              label: t('chat.topics.export.md.label'),
              icon: <Download />,
              run: () => void handleExport(branch, false)
            }
          ]
        : []),
      ...(exportMenuOptions.markdownReason
        ? [
            {
              id: 'markdown-reasoning',
              label: t('chat.topics.export.md.reason'),
              icon: <Brain />,
              run: () => void handleExport(branch, true)
            }
          ]
        : []),
      {
        id: 'copy',
        label: t('chat.message.flow.copy_topic.label'),
        icon: <CopyPlus />,
        disabled: isBranchWritePending,
        run: () => void handleCopy(branch)
      }
    ],
    [exportMenuOptions.markdown, exportMenuOptions.markdownReason, handleCopy, handleExport, isBranchWritePending, t]
  )

  if (endpointCount < 2 || !currentBranch) return anchor

  const currentBranchName = getBranchName(currentBranch)
  const currentBranchPosition = branches.findIndex((branch) => branch.nodeId === currentBranch.nodeId) + 1
  const compactBranchName = currentBranch.isMain
    ? currentBranchName
    : t('chat.branch_switcher.fallback', { number: currentBranchPosition })

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <div className="flex w-fit min-w-0 max-w-full shrink items-center overflow-hidden [-webkit-app-region:no-drag]">
          {anchor}
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-1 h-7 max-w-48 shrink-0 gap-1.5 px-2 text-foreground-secondary shadow-none"
              title={currentBranchName}
              aria-label={t('chat.branch_switcher.trigger', { name: currentBranchName, count: branches.length })}>
              <GitBranch className="size-3.5 shrink-0" />
              <span>{compactBranchName}</span>
              <span className="shrink-0 text-foreground-tertiary">· {branches.length}</span>
            </Button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        alignOffset={8}
        sideOffset={6}
        className="w-[min(360px,calc(100vw-16px))] p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          activeButtonRef.current?.focus()
        }}
        aria-busy={isBranchWritePending || undefined}
        aria-label={t('chat.branch_switcher.branches')}>
        {error && (
          <div className="mb-1 rounded-md bg-destructive/10 px-2 py-1.5 text-destructive text-xs" role="alert">
            {t('chat.branch_switcher.load_failed')}
          </div>
        )}
        {isLoading && <div className="px-2 py-3 text-foreground-tertiary text-xs">{t('common.loading')}</div>}
        <MenuList className="max-h-[min(420px,60vh)] gap-0.5 overflow-y-auto overscroll-contain">
          {branches.map((branch) => {
            const name = getBranchName(branch)
            const actions = getBranchActions(branch)
            return (
              <ContextMenu key={branch.nodeId} modal={false} onOpenChange={handleActionMenuOpenChange}>
                <ContextMenuTrigger asChild>
                  <div
                    ref={branch.isActive ? activeRowRef : undefined}
                    className={cn(
                      'group flex min-w-0 items-center rounded-lg',
                      branch.isActive
                        ? 'bg-accent/60'
                        : !isBranchWritePending && 'focus-within:bg-accent/40 hover:bg-accent/30'
                    )}
                    role="listitem"
                    data-branch-node-id={branch.nodeId}>
                    <button
                      ref={branch.isActive ? activeButtonRef : undefined}
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none"
                      aria-current={branch.isActive ? 'true' : undefined}
                      disabled={isBranchWritePending}
                      onClick={() => void handleBranchSelect(branch)}>
                      <span
                        className={
                          branch.isActive
                            ? 'mt-1.5 size-2 shrink-0 rounded-full bg-primary'
                            : 'mt-1.5 size-2 shrink-0 rounded-full border border-foreground-tertiary'
                        }
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">{name}</span>
                        <span className="mt-0.5 block overflow-hidden text-[11px] text-foreground-tertiary leading-4 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
                          {getBranchDescription(branch)}
                        </span>
                      </span>
                    </button>
                    <DropdownMenu modal={false} onOpenChange={handleActionMenuOpenChange}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="mr-1 size-7 shrink-0 opacity-70 shadow-none hover:opacity-100 focus-visible:opacity-100"
                          disabled={isBranchWritePending}
                          aria-label={t('chat.branch_switcher.actions', { name })}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="right" sideOffset={4} className="z-[90] w-60">
                        <BranchActionItems actions={actions} kind="dropdown" />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="z-[90] w-60">
                  <BranchActionItems actions={actions} kind="context" />
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

export default TopicBranchSwitcher
