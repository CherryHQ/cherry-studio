import type { CompoundIcon, CompoundIconProps } from '../../types'
import { N8nAvatar } from './avatar'
import { N8nLight } from './light'

const N8n = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <N8nLight {...props} className={className} />
  return <N8nLight {...props} className={className} />
}

export const N8nIcon: CompoundIcon = /*#__PURE__*/ Object.assign(N8n, {
  Avatar: N8nAvatar,
  colorPrimary: '#EA4B71'
})

export default N8nIcon
