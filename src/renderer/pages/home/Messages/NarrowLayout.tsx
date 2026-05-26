import { usePreference } from '@data/hooks/usePreference'
import type { FC, HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

const NarrowLayout: FC<Props> = ({ children, ...props }) => {
  const [narrowMode] = usePreference('chat.narrow_mode')

  return (
    <div
      className={`narrow-mode relative mx-auto w-full max-w-full transition-[max-width] duration-300 ease-in-out ${narrowMode ? 'active max-w-[800px]' : ''}`}
      {...props}>
      {children}
    </div>
  )
}

export default NarrowLayout
