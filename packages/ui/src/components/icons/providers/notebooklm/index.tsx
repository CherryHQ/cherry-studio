import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NotebooklmAvatar } from './avatar'
import { NotebooklmLight } from './light'

const Notebooklm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NotebooklmLight {...props} className={className} />
  return <NotebooklmLight {...props} className={className} />
}

export const NotebooklmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Notebooklm, {
  Avatar: NotebooklmAvatar,
  colorPrimary: '#000000'
})

export default NotebooklmIcon
