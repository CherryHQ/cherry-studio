import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AcedatacloudAvatar } from './avatar'
import { AcedatacloudDark } from './dark'
import { AcedatacloudLight } from './light'

const Acedatacloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AcedatacloudLight {...props} className={className} />
  if (variant === 'dark') return <AcedatacloudDark {...props} className={className} />
  return (
    <>
      <AcedatacloudLight className={cn('dark:hidden', className)} {...props} />
      <AcedatacloudDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AcedatacloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Acedatacloud, {
  Avatar: AcedatacloudAvatar,
  colorPrimary: '#000000'
})

export default AcedatacloudIcon
