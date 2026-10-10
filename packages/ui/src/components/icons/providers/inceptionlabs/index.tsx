import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InceptionlabsAvatar } from './avatar'
import { InceptionlabsDark } from './dark'
import { InceptionlabsLight } from './light'

const Inceptionlabs = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InceptionlabsLight {...props} className={className} />
  if (variant === 'dark') return <InceptionlabsDark {...props} className={className} />
  return (
    <>
      <InceptionlabsLight className={cn('dark:hidden', className)} {...props} />
      <InceptionlabsDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const InceptionlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inceptionlabs, {
  Avatar: InceptionlabsAvatar,
  colorPrimary: '#000000'
})

export default InceptionlabsIcon
