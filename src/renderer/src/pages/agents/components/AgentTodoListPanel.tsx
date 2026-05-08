/**
 * Mock-only preview: tasks and details come from in-file fixtures, not a real data source.
 * Lives in ComponentLabSettings so the visual contract can be reviewed before the agent
 * execution todo/progress API is decided.
 */
import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import {
  Atom,
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  CodeXml,
  FileText,
  Globe,
  ListFilter,
  LoaderCircle,
  Package,
  Paintbrush,
  Palette,
  Rocket,
  Search,
  Settings,
  Share2,
  X
} from 'lucide-react'
import type { ComponentType, PropsWithChildren } from 'react'
import { createContext, use, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type AgentTodoStatus = 'completed' | 'in_progress' | 'pending'
type AgentTodoDetailIcon = 'code' | 'globe' | 'package' | 'paintbrush' | 'rocket' | 'search' | 'settings'
type AgentTodoResourceIcon = 'atom' | 'book' | 'file' | 'package' | 'palette' | 'search' | 'settings'

interface AgentTodoItem {
  id: string
  labelKey: string
  status: AgentTodoStatus
}

interface AgentTodoDetailResource {
  id: string
  icon: AgentTodoResourceIcon
  labelKey: string
  metaKey?: string
}

interface AgentTodoDetailGroup {
  id: string
  icon: AgentTodoDetailIcon
  titleKey: string
  summaryKey?: string
  collectionTitleKey?: string
  resources?: AgentTodoDetailResource[]
}

interface AgentTodoListState {
  tasks: AgentTodoItem[]
  details: AgentTodoDetailGroup[]
  isTasksExpanded: boolean
  isDetailsExpanded: boolean
}

interface AgentTodoListActions {
  toggleTasks: () => void
  toggleDetails: () => void
}

interface AgentTodoListMeta {
  completedCount: number
  totalCount: number
}

interface AgentTodoListContextValue {
  state: AgentTodoListState
  actions: AgentTodoListActions
  meta: AgentTodoListMeta
}

interface AgentTodoListProviderProps extends PropsWithChildren {
  tasks?: AgentTodoItem[]
  details?: AgentTodoDetailGroup[]
  defaultTasksExpanded?: boolean
  defaultDetailsExpanded?: boolean
}

interface AgentTodoListRootProps extends PropsWithChildren {
  className?: string
}

const MOCK_TASKS: AgentTodoItem[] = [
  { id: 'search-web', labelKey: 'agent.todo.mock.tasks.searchWeb', status: 'completed' },
  { id: 'review-references', labelKey: 'agent.todo.mock.tasks.reviewReferences', status: 'completed' },
  { id: 'install-dependencies', labelKey: 'agent.todo.mock.tasks.installDependencies', status: 'completed' },
  { id: 'configure-project', labelKey: 'agent.todo.mock.tasks.configureProject', status: 'completed' },
  { id: 'write-components', labelKey: 'agent.todo.mock.tasks.writeComponents', status: 'completed' },
  { id: 'write-pages', labelKey: 'agent.todo.mock.tasks.writePages', status: 'completed' },
  { id: 'add-router', labelKey: 'agent.todo.mock.tasks.addRouter', status: 'in_progress' },
  { id: 'add-linting', labelKey: 'agent.todo.mock.tasks.addLinting', status: 'pending' },
  { id: 'build-deploy', labelKey: 'agent.todo.mock.tasks.buildDeploy', status: 'pending' },
  { id: 'finish', labelKey: 'agent.todo.mock.tasks.finish', status: 'pending' }
]

const MOCK_DETAILS: AgentTodoDetailGroup[] = [
  {
    id: 'search-web',
    icon: 'search',
    titleKey: 'agent.todo.mock.details.searchWeb.title',
    summaryKey: 'agent.todo.mock.details.searchWeb.summary',
    resources: [
      {
        id: 'react-vite-query',
        icon: 'search',
        labelKey: 'agent.todo.mock.details.searchWeb.resources.reactViteQuery'
      }
    ]
  },
  {
    id: 'review-references',
    icon: 'globe',
    titleKey: 'agent.todo.mock.details.reviewReferences.title',
    collectionTitleKey: 'agent.todo.mock.details.reviewReferences.collectionTitle',
    resources: [
      {
        id: 'vite-docs',
        icon: 'book',
        labelKey: 'agent.todo.mock.details.reviewReferences.resources.viteDocs',
        metaKey: 'agent.todo.mock.details.reviewReferences.resources.viteMeta'
      },
      {
        id: 'react-docs',
        icon: 'atom',
        labelKey: 'agent.todo.mock.details.reviewReferences.resources.reactDocs',
        metaKey: 'agent.todo.mock.details.reviewReferences.resources.reactMeta'
      },
      {
        id: 'tailwind-docs',
        icon: 'palette',
        labelKey: 'agent.todo.mock.details.reviewReferences.resources.tailwindDocs',
        metaKey: 'agent.todo.mock.details.reviewReferences.resources.tailwindMeta'
      },
      {
        id: 'npm-create-vite',
        icon: 'package',
        labelKey: 'agent.todo.mock.details.reviewReferences.resources.npmCreateVite',
        metaKey: 'agent.todo.mock.details.reviewReferences.resources.npmMeta'
      }
    ]
  },
  {
    id: 'install-dependencies',
    icon: 'package',
    titleKey: 'agent.todo.mock.details.installDependencies.title',
    summaryKey: 'agent.todo.mock.details.installDependencies.summary',
    resources: [
      {
        id: 'react-deps',
        icon: 'package',
        labelKey: 'agent.todo.mock.details.installDependencies.resources.reactDeps',
        metaKey: 'agent.todo.mock.details.installDependencies.resources.dependenciesMeta'
      },
      {
        id: 'tailwind-deps',
        icon: 'package',
        labelKey: 'agent.todo.mock.details.installDependencies.resources.tailwindDeps',
        metaKey: 'agent.todo.mock.details.installDependencies.resources.devDependenciesMeta'
      },
      {
        id: 'typescript-deps',
        icon: 'package',
        labelKey: 'agent.todo.mock.details.installDependencies.resources.typescriptDeps',
        metaKey: 'agent.todo.mock.details.installDependencies.resources.devDependenciesMeta'
      }
    ]
  },
  {
    id: 'configure-project',
    icon: 'settings',
    titleKey: 'agent.todo.mock.details.configureProject.title',
    resources: [
      {
        id: 'tailwind-config',
        icon: 'settings',
        labelKey: 'agent.todo.mock.details.configureProject.resources.tailwindConfig',
        metaKey: 'agent.todo.mock.details.configureProject.resources.createdMeta'
      },
      {
        id: 'postcss-config',
        icon: 'settings',
        labelKey: 'agent.todo.mock.details.configureProject.resources.postcssConfig',
        metaKey: 'agent.todo.mock.details.configureProject.resources.createdMeta'
      },
      {
        id: 'vite-config',
        icon: 'settings',
        labelKey: 'agent.todo.mock.details.configureProject.resources.viteConfig',
        metaKey: 'agent.todo.mock.details.configureProject.resources.updatedMeta'
      }
    ]
  },
  {
    id: 'write-components',
    icon: 'code',
    titleKey: 'agent.todo.mock.details.writeComponents.title',
    collectionTitleKey: 'agent.todo.mock.details.writeComponents.collectionTitle',
    resources: [
      {
        id: 'header',
        icon: 'file',
        labelKey: 'agent.todo.mock.details.writeComponents.resources.header',
        metaKey: 'agent.todo.mock.details.writeComponents.resources.newMeta'
      },
      {
        id: 'footer',
        icon: 'file',
        labelKey: 'agent.todo.mock.details.writeComponents.resources.footer',
        metaKey: 'agent.todo.mock.details.writeComponents.resources.newMeta'
      },
      {
        id: 'card',
        icon: 'file',
        labelKey: 'agent.todo.mock.details.writeComponents.resources.card',
        metaKey: 'agent.todo.mock.details.writeComponents.resources.newMeta'
      },
      {
        id: 'button',
        icon: 'file',
        labelKey: 'agent.todo.mock.details.writeComponents.resources.button',
        metaKey: 'agent.todo.mock.details.writeComponents.resources.modifiedMeta'
      },
      {
        id: 'layout',
        icon: 'file',
        labelKey: 'agent.todo.mock.details.writeComponents.resources.layout',
        metaKey: 'agent.todo.mock.details.writeComponents.resources.newMeta'
      },
      {
        id: 'app',
        icon: 'file',
        labelKey: 'agent.todo.mock.details.writeComponents.resources.app',
        metaKey: 'agent.todo.mock.details.writeComponents.resources.updatedMeta'
      }
    ]
  },
  {
    id: 'write-pages',
    icon: 'paintbrush',
    titleKey: 'agent.todo.mock.details.writePages.title',
    resources: [
      {
        id: 'home-page',
        icon: 'file',
        labelKey: 'agent.todo.mock.details.writePages.resources.home',
        metaKey: 'agent.todo.mock.details.writePages.resources.newMeta'
      },
      {
        id: 'about-page',
        icon: 'file',
        labelKey: 'agent.todo.mock.details.writePages.resources.about',
        metaKey: 'agent.todo.mock.details.writePages.resources.newMeta'
      }
    ]
  },
  {
    id: 'add-router',
    icon: 'rocket',
    titleKey: 'agent.todo.mock.details.addRouter.title',
    summaryKey: 'agent.todo.mock.details.addRouter.summary'
  }
]

const DETAIL_ICONS: Record<AgentTodoDetailIcon, ComponentType<{ className?: string; size?: number }>> = {
  code: CodeXml,
  globe: Globe,
  package: Package,
  paintbrush: Paintbrush,
  rocket: Rocket,
  search: Search,
  settings: Settings
}

const RESOURCE_ICONS: Record<AgentTodoResourceIcon, ComponentType<{ className?: string; size?: number }>> = {
  atom: Atom,
  book: BookOpen,
  file: FileText,
  package: Package,
  palette: Palette,
  search: Search,
  settings: Settings
}

const AgentTodoListContext = createContext<AgentTodoListContextValue | null>(null)

const useAgentTodoList = () => {
  const context = use(AgentTodoListContext)

  if (!context) {
    throw new Error('AgentTodoListPanel compound components must be used within an AgentTodoListPanel provider')
  }

  return context
}

const AgentTodoListMockProvider = ({
  children,
  tasks = MOCK_TASKS,
  details = MOCK_DETAILS,
  defaultTasksExpanded = true,
  defaultDetailsExpanded = true
}: AgentTodoListProviderProps) => {
  const [isTasksExpanded, setIsTasksExpanded] = useState(defaultTasksExpanded)
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(defaultDetailsExpanded)

  const completedCount = useMemo(() => tasks.filter((task) => task.status === 'completed').length, [tasks])

  const value = useMemo<AgentTodoListContextValue>(
    () => ({
      state: {
        tasks,
        details,
        isTasksExpanded,
        isDetailsExpanded
      },
      actions: {
        toggleTasks: () => setIsTasksExpanded((expanded) => !expanded),
        toggleDetails: () => setIsDetailsExpanded((expanded) => !expanded)
      },
      meta: {
        completedCount,
        totalCount: tasks.length
      }
    }),
    [completedCount, details, isDetailsExpanded, isTasksExpanded, tasks]
  )

  return <AgentTodoListContext value={value}>{children}</AgentTodoListContext>
}

const AgentTodoListRoot = ({ children, className }: AgentTodoListRootProps) => (
  <section
    className={cn(
      'mx-3 mt-3 mb-1 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm',
      className
    )}>
    {children}
  </section>
)

const AgentTodoListHeader = () => {
  const { t } = useTranslation()
  const {
    state: { isTasksExpanded },
    actions: { toggleTasks },
    meta: { completedCount, totalCount }
  } = useAgentTodoList()

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50"
      aria-expanded={isTasksExpanded}
      onClick={toggleTasks}>
      <ChevronDown
        size={10}
        className={cn('shrink-0 text-muted-foreground transition-transform', !isTasksExpanded && '-rotate-90')}
      />
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground/85">{t('agent.todo.mock.title')}</span>
      <span className="shrink-0 text-[9px] text-muted-foreground tabular-nums">
        {completedCount}/{totalCount}
      </span>
    </button>
  )
}

const AgentTodoListTasks = () => {
  const {
    state: { isTasksExpanded, tasks }
  } = useAgentTodoList()

  if (!isTasksExpanded) {
    return null
  }

  return (
    <div className="px-3 pb-1">
      {tasks.map((task) => (
        <AgentTodoListTaskRow key={task.id} task={task} />
      ))}
    </div>
  )
}

const AgentTodoListTaskRow = ({ task }: { task: AgentTodoItem }) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-6 items-center gap-2 px-1 py-1.25">
      <AgentTodoListStatusIcon status={task.status} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[11px]',
          task.status === 'completed' && 'text-foreground/80',
          task.status === 'in_progress' && 'text-foreground',
          task.status === 'pending' && 'text-muted-foreground/50'
        )}>
        {t(task.labelKey)}
      </span>
    </div>
  )
}

const AgentTodoListStatusIcon = ({ status }: { status: AgentTodoStatus }) => {
  if (status === 'completed') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
        <Check size={10} />
      </span>
    )
  }

  if (status === 'in_progress') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center text-primary">
        <LoaderCircle size={11} className="animate-spin" />
      </span>
    )
  }

  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/30">
      <Circle size={10} />
    </span>
  )
}

const AgentTodoListDetails = () => {
  const { t } = useTranslation()
  const {
    state: { details, isDetailsExpanded },
    actions: { toggleDetails }
  } = useAgentTodoList()

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 border-border/40 border-t px-4 py-2 text-left transition-colors hover:bg-muted/50"
        aria-expanded={isDetailsExpanded}
        onClick={toggleDetails}>
        <ChevronDown
          size={9}
          className={cn('shrink-0 text-muted-foreground/60 transition-transform', !isDetailsExpanded && '-rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {t('agent.todo.mock.details.title')}
        </span>
      </button>
      {isDetailsExpanded && (
        <div className="px-3 pb-2">
          {details.map((detail) => (
            <AgentTodoListDetailGroup key={detail.id} detail={detail} />
          ))}
        </div>
      )}
    </div>
  )
}

const AgentTodoListDetailGroup = ({ detail }: { detail: AgentTodoDetailGroup }) => {
  const { t } = useTranslation()
  const Icon = DETAIL_ICONS[detail.icon]
  const resourceCount = detail.resources?.length ?? 0

  return (
    <div className="mb-1.5">
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <Icon size={10} className="text-primary" />
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{t(detail.titleKey)}</span>
      </div>
      <div className="mb-1 ml-6">
        {detail.summaryKey && (
          <div className="mb-1 rounded-md bg-muted/60 px-3 py-2">
            <p className="m-0 text-[10px] text-foreground/60 leading-[1.6]">{t(detail.summaryKey)}</p>
          </div>
        )}
        {!!resourceCount && (
          <div className="overflow-hidden rounded-md bg-muted/60">
            {detail.collectionTitleKey && (
              <div className="flex items-center justify-between border-border/40 border-b px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[10px] text-muted-foreground">{t(detail.collectionTitleKey)}</span>
                  <span className="text-[9px] text-muted-foreground/60">{resourceCount}</span>
                </div>
                <Share2 size={9} className="shrink-0 text-muted-foreground/50" />
              </div>
            )}
            <div className="py-0.5">
              {detail.resources?.map((resource) => (
                <AgentTodoListDetailResource key={resource.id} resource={resource} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const AgentTodoListDetailResource = ({ resource }: { resource: AgentTodoDetailResource }) => {
  const { t } = useTranslation()
  const Icon = RESOURCE_ICONS[resource.icon]

  return (
    <div className="flex items-center gap-2 px-3 py-1 transition-colors hover:bg-muted/80">
      <span className="flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[10px]">
        <Icon size={10} className="text-muted-foreground/70" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground/70">{t(resource.labelKey)}</span>
      {resource.metaKey && <span className="shrink-0 text-[9px] text-muted-foreground/60">{t(resource.metaKey)}</span>}
    </div>
  )
}

const AgentTodoListFooter = () => {
  const { t } = useTranslation()
  const {
    meta: { completedCount, totalCount }
  } = useAgentTodoList()

  return (
    <div className="flex items-center gap-2 border-border/40 border-t px-3.5 py-2">
      <ListFilter size={11} className="shrink-0 text-muted-foreground/60" />
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
        {t('agent.todo.mock.progress', { completed: completedCount, total: totalCount })}
      </span>
      <Tooltip content={t('agent.todo.mock.actions.dismiss')}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 text-primary"
          aria-label={t('agent.todo.mock.actions.dismiss')}
          disabled>
          <X size={10} />
        </Button>
      </Tooltip>
      <Tooltip content={t('agent.todo.mock.actions.complete')}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 text-primary"
          aria-label={t('agent.todo.mock.actions.complete')}
          disabled>
          <Check size={11} />
        </Button>
      </Tooltip>
    </div>
  )
}

const AgentTodoListPanelView = ({ className }: { className?: string }) => (
  <AgentTodoListRoot className={className}>
    <AgentTodoListHeader />
    <AgentTodoListTasks />
    <AgentTodoListDetails />
    <AgentTodoListFooter />
  </AgentTodoListRoot>
)

const AgentTodoListPanelDefault = ({ className }: { className?: string }) => (
  <AgentTodoListMockProvider>
    <AgentTodoListPanelView className={className} />
  </AgentTodoListMockProvider>
)

export const AgentTodoListPanel = {
  MockProvider: AgentTodoListMockProvider,
  Root: AgentTodoListRoot,
  Header: AgentTodoListHeader,
  Tasks: AgentTodoListTasks,
  Details: AgentTodoListDetails,
  Footer: AgentTodoListFooter
}

export type {
  AgentTodoDetailGroup,
  AgentTodoDetailIcon,
  AgentTodoDetailResource,
  AgentTodoItem,
  AgentTodoResourceIcon,
  AgentTodoStatus
}
export default AgentTodoListPanelDefault
