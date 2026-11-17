import { BookOpen, Bot, ListTodo, MessageSquare, Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneCaret, SceneChip, ScenePanel } from '@cherrystudio/ui'

const FILTERS = [
  { icon: MessageSquare, key: 'globalSearch.filters.conversation' },
  { icon: ListTodo, key: 'globalSearch.filters.session' },
  { icon: Bot, key: 'globalSearch.filters.assistant' },
  { icon: Sparkles, key: 'globalSearch.filters.agent' },
  { icon: BookOpen, key: 'globalSearch.filters.knowledge' }
] as const

/** Search palette before a query: the focused input and the kinds of things it can find. */
export function GlobalSearchEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={1}
      sprites={[
        { x: 232, y: 3, color: 4, shape: 'corner', tilt: 10 },
        { x: 4, y: 84, color: 6, shape: 'checker', tilt: -12 },
        { x: 240, y: 118, color: 1, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <div className="flex h-[34px] shrink-0 items-center gap-[6px] border-b border-border-subtle px-[12px]">
          <Search size={11} strokeWidth={2} className="shrink-0 text-foreground" />
          <SceneCaret />
          <span className="truncate text-[8px] text-foreground-tertiary">{t('globalSearch.placeholder')}</span>
        </div>
        <div className="flex flex-col gap-[6px] px-[12px] pt-[10px]">
          <span className="text-[6.5px] text-foreground-tertiary">{t('globalSearch.filters.label')}</span>
          <div className="flex flex-wrap gap-[5px]">
            {FILTERS.map(({ icon, key }) => (
              <SceneChip key={key} icon={icon} label={t(key)} />
            ))}
          </div>
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
