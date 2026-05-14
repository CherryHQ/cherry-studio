import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DmxapiAvatar } from './avatar'
import { DmxapiDark } from './dark'
import { DmxapiLight } from './light'

const Dmxapi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DmxapiLight {...props} className={className} />
  if (variant === 'dark') return <DmxapiDark {...props} className={className} />
  return (
    <>
      <DmxapiLight className={cn('dark:hidden', className)} {...props} />
      <DmxapiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DmxapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dmxapi, {
  Avatar: DmxapiAvatar,
  colorPrimary: '#924C88'
})

export default DmxapiIcon
