import { usePreference } from '@data/hooks/usePreference'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import type { Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import type { FC } from 'react'

import Topics from './TopicsTab'

interface Props {
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
  style?: React.CSSProperties
}

const HomeTabs: FC<Props> = ({ activeTopic, setActiveTopic, position, style }) => {
  const [topicPosition] = usePreference('topic.position')
  const { isLeftNavbar } = useNavbarPosition()

  const borderStyle = '0.5px solid var(--color-border)'
  const border =
    position === 'left'
      ? { borderRight: isLeftNavbar ? borderStyle : 'none' }
      : { borderLeft: isLeftNavbar ? borderStyle : 'none', borderTopLeftRadius: 0 }

  return (
    <div
      style={{ ...border, ...style }}
      className={classNames(
        'home-tabs relative flex h-[calc(100vh-var(--navbar-height))] w-(--assistants-width) flex-col overflow-hidden transition-[width] duration-300 [&_.collapsed]:w-0 [&_.collapsed]:border-l-0 [[navbar-position=left]_&]:bg-(--color-background) [[navbar-position=top]_&]:h-[calc(100vh-var(--navbar-height))]',
        { right: position === 'right' && topicPosition === 'right' }
      )}>
      <div className="home-tabs-content flex flex-1 flex-col overflow-hidden transition-[width] duration-300">
        <Topics activeTopic={activeTopic} setActiveTopic={setActiveTopic} position={position} />
      </div>
    </div>
  )
}

export default HomeTabs
