import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CephalonAvatar } from './avatar'
import { CephalonDark } from './dark'
import { CephalonLight } from './light'

const Cephalon = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CephalonLight {...props} className={className} />
  if (variant === 'dark') return <CephalonDark {...props} className={className} />
  return (
    <>
      <CephalonLight className={cn(className, 'dark:hidden')} {...props} />
      <CephalonDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const CephalonIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cephalon, {
  Avatar: CephalonAvatar,
  colorPrimary: '#000000'
})

export default CephalonIcon
