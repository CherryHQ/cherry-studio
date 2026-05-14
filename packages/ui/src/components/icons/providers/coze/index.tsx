import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CozeAvatar } from './avatar'
import { CozeDark } from './dark'
import { CozeLight } from './light'

const Coze = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CozeLight {...props} className={className} />
  if (variant === 'dark') return <CozeDark {...props} className={className} />
  return (
    <>
      <CozeLight className={cn('dark:hidden', className)} {...props} />
      <CozeDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const CozeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Coze, {
  Avatar: CozeAvatar,
  colorPrimary: '#4D53E8'
})

export default CozeIcon
