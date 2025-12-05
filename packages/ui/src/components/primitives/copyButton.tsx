// Original path: src/renderer/src/components/CopyButton.tsx
import { Copy } from 'lucide-react'
import type { FC } from 'react'

import { Tooltip } from './tooltip'

interface CopyButtonProps {
  tooltip?: string
  label?: string
  size?: number
  className?: string
  [key: string]: any
}

const CopyButton: FC<CopyButtonProps> = ({ tooltip, label, size = 14, className = '', ...props }) => {
  const button = (
    <div
      className={`flex flex-row items-center gap-1 cursor-pointer text-gray-600 dark:text-gray-400 transition-colors duration-200 hover:text-blue-600 dark:hover:text-blue-400 ${className}`}
      {...props}>
      <Copy size={size} className="transition-colors duration-200" />
      {label && <span style={{ fontSize: `${size}px` }}>{label}</span>}
    </div>
  )

  if (tooltip) {
    return <Tooltip content={tooltip}>{button}</Tooltip>
  }

  return button
}

export default CopyButton
