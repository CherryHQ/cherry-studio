import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { Profiler } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { bench, describe, vi } from 'vitest'

import ModelListSyncDrawer from '../ModelListSyncDrawer'

const { translate } = vi.hoisted(() => ({
  translate: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate })
}))

vi.mock('@cherrystudio/ui', () => ({
  Avatar: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  AvatarFallback: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  Button: ({ children, ...props }: any) => {
    Reflect.deleteProperty(props, 'loading')
    Reflect.deleteProperty(props, 'size')
    Reflect.deleteProperty(props, 'variant')
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  EmptyState: ({ title }: any) => <div>{title}</div>,
  HorizontalScrollContainer: ({ children }: any) => <div>{children}</div>,
  Input: (props: any) => <input {...props} />,
  Spinner: () => <div>loading</div>,
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
  Tooltip: ({ children }: any) => <>{children}</>
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  useIcon: () => undefined
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({ children, getItemKey, list }: any) => (
    <div>
      {list.slice(0, 24).map((item: unknown, index: number) => (
        <div key={getItemKey?.(index) ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/utils/model', () => ({
  getModelLogoRef: () => undefined
}))

vi.mock('../../components/ModelTagsWithLabel', () => ({
  default: () => null
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ children, open, title, titleActions }: any) =>
    open ? (
      <div>
        <header>
          {title}
          {titleActions}
        </header>
        {children}
      </div>
    ) : null
}))

const MODEL_COUNT = 1000
const provider = { id: 'benchmark', name: 'Benchmark' } as Provider
const allModels = Array.from({ length: MODEL_COUNT }, (_, index) => ({
  id: `benchmark::model-${index}`,
  providerId: 'benchmark',
  apiModelId: `model-${index}`,
  name: `Model ${index}`,
  group: `Group ${Math.floor(index / 50)}`,
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})) as Model[]
const allModelIds = allModels.map((model) => model.id)
const noModels: Model[] = []
const noModelIds: UniqueModelId[] = []
const doNothing = () => {}

type ReferenceMode = 'stable' | 'churn'
type UpdateScenario = 'operation-status' | 'add-all' | 'remove-all'

function referencesFor<T>(values: T[], mode: ReferenceMode): T[] {
  return mode === 'churn' ? [...values] : values
}

function createComponentBenchmark(mode: ReferenceMode, scenario: UpdateScenario) {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let commitCount = 0

  const renderDrawer = (isApplying: boolean, localModels: Model[]) => {
    // eslint-disable-next-line @eslint-react/dom/no-flush-sync -- The benchmark must time a completed React commit.
    flushSync(() => {
      root?.render(
        <Profiler id="model-list-sync-drawer" onRender={() => commitCount++}>
          <ModelListSyncDrawer
            open
            provider={provider}
            allModels={referencesFor(allModels, mode)}
            localModels={referencesFor(localModels, mode)}
            removableModelIds={referencesFor(allModelIds, mode)}
            defaultModelIds={referencesFor(noModelIds, mode)}
            staleModelIds={referencesFor(noModelIds, mode)}
            isLoading={false}
            isApplying={isApplying}
            onAddModels={doNothing}
            onRemoveModels={doNothing}
            onClose={doNothing}
          />
        </Profiler>
      )
    })
  }

  return {
    run() {
      if (scenario === 'operation-status') {
        renderDrawer(true, allModels)
      } else if (scenario === 'remove-all') {
        renderDrawer(false, noModels)
      } else {
        renderDrawer(false, allModels)
      }
    },
    options: {
      iterations: 20,
      warmupIterations: 5,
      setup() {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        commitCount = 0
        renderDrawer(false, scenario === 'add-all' ? noModels : allModels)
      },
      teardown() {
        if (commitCount < 2) {
          throw new Error('Model list benchmark update did not commit')
        }
        root?.unmount()
        container?.remove()
        root = undefined
        container = undefined
      }
    }
  }
}

describe(`${MODEL_COUNT} model drawer component updates`, () => {
  for (const scenario of ['operation-status', 'add-all', 'remove-all'] as const) {
    const stable = createComponentBenchmark('stable', scenario)
    const churn = createComponentBenchmark('churn', scenario)

    bench(`${scenario}: stable list references`, stable.run, stable.options)
    bench(`${scenario}: recreated list references (previous baseline)`, churn.run, churn.options)
  }
})
