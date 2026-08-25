import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NotebooklmAvatar } from './avatar'
import { NotebooklmDark } from './dark'
import { NotebooklmLight } from './light'

const Notebooklm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NotebooklmLight {...props} className={className} />
  if (variant === 'dark') return <NotebooklmDark {...props} className={className} />
  return (
    <>
      <NotebooklmLight className={cn('dark:hidden', className)} {...props} />
      <NotebooklmDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const NotebooklmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Notebooklm, {
  Avatar: NotebooklmAvatar,
  colorPrimary: '#000000'
})

export default NotebooklmIcon
