import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NewapiAvatar } from './avatar'
import { NewapiDark } from './dark'
import { NewapiLight } from './light'

const Newapi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NewapiLight {...props} className={className} />
  if (variant === 'dark') return <NewapiDark {...props} className={className} />
  return (
    <>
      <NewapiLight className={cn('dark:hidden', className)} {...props} />
      <NewapiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const NewapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Newapi, {
  Avatar: NewapiAvatar,
  colorPrimary: '#000000'
})

export default NewapiIcon
