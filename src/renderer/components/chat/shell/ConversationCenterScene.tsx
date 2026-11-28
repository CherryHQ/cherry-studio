import { MessageSquareDashed, Search, SquarePen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneCursor, SceneInput, ScenePanel, SceneRow } from '@cherrystudio/ui'

const SAMPLE_KEYS = [
  'chat.empty_scene.sample.trip',
  'chat.empty_scene.sample.roadmap',
  'chat.empty_scene.sample.regex',
  'chat.empty_scene.sample.reading'
] as const

const COPY = {
  chat: {
    list: 'chat.topics.title',
    search: 'common.search',
    group: 'chat.topics.group.today',
    composer: 'chat.input.placeholder'
  },
  agent: {
    list: 'agent.session.list.title',
    search: 'agent.session.search.placeholder',
    group: 'agent.session.group.today',
    composer: 'agent.input.placeholder'
  }
} as const

/** No conversation selected: the conversation list with the pointer on a row, and an empty stage. */
export function ConversationCenterScene({ variant }: { variant: 'chat' | 'agent' }) {
  const { t } = useTranslation()
  const copy = COPY[variant]
  return (
    <EmptyStateScene
      accent={5}
      sprites={[
        { x: 283, y: 3, color: 1, shape: 'ring', tilt: 10 },
        { x: 3, y: 125, color: 4, shape: 'checker', tilt: -12 },
        { x: 294, y: 146, color: 6, shape: 'corner', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[18px] h-[220px] w-[276px] flex-row">
        <div className="flex w-[124px] shrink-0 flex-col gap-[3px] border-r border-border-subtle p-[8px]">
          <div className="flex h-[18px] items-center px-[4px] text-[9px] font-semibold text-foreground">
            <span className="truncate">{t(copy.list)}</span>
            <SquarePen size={11} strokeWidth={1.8} className="ml-auto shrink-0 text-muted-foreground" />
          </div>
          <SceneInput icon={Search} placeholder={t(copy.search)} className="mb-[4px]" />
          <span className="px-[7px] text-[6.5px] text-foreground-tertiary">{t(copy.group)}</span>
          {SAMPLE_KEYS.map((key, index) => (
            <SceneRow key={key} label={t(key)} selected={index === 1} muted={index === 3} />
          ))}
        </div>
        <div className="relative flex-1">
          <MessageSquareDashed
            size={28}
            strokeWidth={1.3}
            className="absolute top-[64px] left-1/2 -translate-x-1/2 text-foreground-disabled"
          />
          <SceneInput
            placeholder={t(copy.composer)}
            className="absolute top-[150px] right-[12px] left-[12px] h-[21px]"
          />
        </div>
      </ScenePanel>
      <SceneCursor className="top-[106px] left-[98px]" />
    </EmptyStateScene>
  )
}
