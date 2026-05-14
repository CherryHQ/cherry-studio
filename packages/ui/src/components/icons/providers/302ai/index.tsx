import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Ai302Avatar } from './avatar'
import { Ai302Dark } from './dark'
import { Ai302Light } from './light'

const Ai302 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Ai302Light {...props} className={className} />
  if (variant === 'dark') return <Ai302Dark {...props} className={className} />
  return (
    <>
      <Ai302Light className={cn('dark:hidden', className)} {...props} />
      <Ai302Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Ai302Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ai302, {
  Avatar: Ai302Avatar,
  colorPrimary: '#3F3FAA'
})

export default Ai302Icon
