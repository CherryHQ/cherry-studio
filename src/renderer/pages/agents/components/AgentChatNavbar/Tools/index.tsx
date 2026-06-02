import type { ReactNode } from 'react'

interface Props {
  children?: ReactNode
}

const Tools = ({ children }: Props) => {
  return (
    <div className="flex items-center gap-0.5">
      {children}
      {/* TODO: Add search button back when global search supports agent messages */}
    </div>
  )
}

export default Tools
