import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DifyAvatar } from './avatar'
import { DifyDark } from './dark'
import { DifyLight } from './light'

const Dify = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DifyLight {...props} className={className} />
  if (variant === 'dark') return <DifyDark {...props} className={className} />
  return (
    <>
      <DifyLight className={cn('dark:hidden', className)} {...props} />
      <DifyDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DifyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dify, {
  Avatar: DifyAvatar,
  colorPrimary: '#FDFEFF'
})

export default DifyIcon
