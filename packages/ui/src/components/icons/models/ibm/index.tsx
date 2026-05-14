import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { IbmAvatar } from './avatar'
import { IbmDark } from './dark'
import { IbmLight } from './light'

const Ibm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <IbmLight {...props} className={className} />
  if (variant === 'dark') return <IbmDark {...props} className={className} />
  return (
    <>
      <IbmLight className={cn('dark:hidden', className)} {...props} />
      <IbmDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const IbmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ibm, {
  Avatar: IbmAvatar,
  colorPrimary: '#DFE9F3'
})

export default IbmIcon
