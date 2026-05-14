import type { FC, HTMLAttributes, ReactNode } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  narrowMode?: boolean
}

const NarrowLayout: FC<Props> = ({ children, narrowMode = false, ...props }) => {
  return (
    <div
      className={`narrow-mode relative mx-auto w-full max-w-full transition-[max-width] duration-300 ease-in-out ${narrowMode ? 'active max-w-[800px]' : ''}`}
      {...props}>
      {children}
    </div>
  )
}

export default NarrowLayout
