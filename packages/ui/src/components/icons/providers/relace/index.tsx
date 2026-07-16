import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RelaceAvatar } from './avatar'
import { RelaceDark } from './dark'
import { RelaceLight } from './light'

const Relace = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RelaceLight {...props} className={className} />
  if (variant === 'dark') return <RelaceDark {...props} className={className} />
  return (
    <>
      <RelaceLight className={cn('dark:hidden', className)} {...props} />
      <RelaceDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const RelaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Relace, {
  Avatar: RelaceAvatar,
  colorPrimary: '#000000'
})

export default RelaceIcon
