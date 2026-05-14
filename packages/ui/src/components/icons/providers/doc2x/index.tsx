import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Doc2xAvatar } from './avatar'
import { Doc2xDark } from './dark'
import { Doc2xLight } from './light'

const Doc2x = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Doc2xLight {...props} className={className} />
  if (variant === 'dark') return <Doc2xDark {...props} className={className} />
  return (
    <>
      <Doc2xLight className={cn('dark:hidden', className)} {...props} />
      <Doc2xDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Doc2xIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doc2x, {
  Avatar: Doc2xAvatar,
  colorPrimary: '#7748F9'
})

export default Doc2xIcon
