import { Alert, Button, Sortable } from '@cherrystudio/ui'
import type { CodeCliOverrides } from '@shared/data/preference/preferenceTypes'
import { GripVertical } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CLI_TOOLS } from '..'
import { CodeHeroIllustrationIcon } from './CodeHeroIllustrationIcon'
import { CodeToolCard } from './CodeToolCard'
import type { CodeToolMeta } from './types'

type CliToolItem = (typeof CLI_TOOLS)[number]

export interface CodeToolGalleryProps {
  tools: readonly CliToolItem[]
  isBunInstalled: boolean
  isInstallingBun: boolean
  handleInstallBun: () => void
  activeToolValue: CliToolItem['value'] | undefined
  handleSelectTool: (value: CliToolItem['value']) => void
  toMeta: (tool: CliToolItem) => CodeToolMeta
  overrides: CodeCliOverrides
  onTogglePin: (toolId: CliToolItem['value']) => void
  onReorder: (orderedIds: CliToolItem['value'][]) => void
}

interface GalleryItem {
  id: CliToolItem['value']
  tool: CliToolItem
  meta: CodeToolMeta
  description: string
}

function getSortedTools(tools: readonly CliToolItem[], overrides: CodeCliOverrides): CliToolItem[] {
  const sorted = [...tools]
  sorted.sort((a, b) => {
    const aPinned = overrides[a.value]?.pinned ? 1 : 0
    const bPinned = overrides[b.value]?.pinned ? 1 : 0
    if (aPinned !== bPinned) return bPinned - aPinned
    const aOrder = overrides[a.value]?.order
    const bOrder = overrides[b.value]?.order
    if (aOrder != null && bOrder != null) return aOrder - bOrder
    if (aOrder != null) return -1
    if (bOrder != null) return 1
    return 0
  })
  return sorted
}

export function CodeToolGallery({
  tools,
  isBunInstalled,
  isInstallingBun,
  handleInstallBun,
  activeToolValue,
  handleSelectTool,
  toMeta,
  overrides,
  onTogglePin,
  onReorder
}: CodeToolGalleryProps) {
  const { t } = useTranslation()

  const [localOrder, setLocalOrder] = useState<CliToolItem['value'][] | null>(null)

  useEffect(() => {
    setLocalOrder(null)
  }, [overrides])

  const sortedTools = localOrder
    ? localOrder.map((id) => tools.find((t) => t.value === id)).filter((t): t is CliToolItem => t != null)
    : getSortedTools(tools, overrides)

  const galleryItems: GalleryItem[] = sortedTools.map((tool) => {
    const meta = toMeta(tool)
    const descriptionKey = `code.tool_description.${meta.id.replace(/-/g, '_')}`
    return { id: tool.value, tool, meta, description: t(descriptionKey, { defaultValue: '' }) }
  })

  const handleSortEnd = ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
    const reordered = [...sortedTools]
    const [removed] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, removed)
    const newOrder = reordered.map((t) => t.value)
    setLocalOrder(newOrder)
    onReorder(newOrder)
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto bg-background [&::-webkit-scrollbar]:hidden">
      {!isBunInstalled && (
        <Alert
          className="relative mx-4 mt-4 w-auto items-center rounded-xl border-border bg-card px-4 py-3 text-foreground text-sm sm:absolute sm:top-4 sm:right-4 sm:z-20 sm:mx-0 sm:mt-0 sm:whitespace-nowrap"
          message={t('code.bun_required_message')}
          action={
            <Button variant="secondary" size="sm" onClick={handleInstallBun} disabled={isInstallingBun}>
              {isInstallingBun ? t('code.installing_bun') : t('code.install_bun')}
            </Button>
          }
        />
      )}

      <div className="relative z-10 flex min-h-full flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-5xl">
          <div className="mb-12 flex flex-col items-center">
            <CodeHeroIllustrationIcon
              width={96}
              height={96}
              className="mb-4 rounded-full border border-border shadow-lg"
              aria-hidden="true"
            />
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">{t('code.hero_tagline')}</h1>
          </div>

          <Sortable<GalleryItem>
            items={galleryItems}
            itemKey="id"
            onSortEnd={handleSortEnd}
            layout="grid"
            useDragOverlay={true}
            showGhost={false}
            gap="1.25rem"
            className="grid-cols-1! sm:grid-cols-2! md:grid-cols-3! lg:grid-cols-4!"
            renderItem={(item) => {
              const isPinned = !!overrides[item.id]?.pinned
              return (
                <div className="group relative">
                  <div className="hover:!opacity-100 absolute top-2 left-2 z-10 cursor-grab rounded-md p-0.5 opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-40">
                    <GripVertical size={14} />
                  </div>
                  <CodeToolCard
                    icon={item.meta.icon!}
                    title={item.meta.label}
                    subtitle={item.description || undefined}
                    selected={activeToolValue === item.id}
                    pinned={isPinned}
                    onClick={() => handleSelectTool(item.id)}
                    onTogglePin={() => onTogglePin(item.id)}
                  />
                </div>
              )
            }}
          />
        </div>
      </div>
    </div>
  )
}
