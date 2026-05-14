import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt5Avatar } from './avatar'
import { Gpt5Dark } from './dark'
import { Gpt5Light } from './light'

const Gpt5 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt5Light {...props} className={className} />
  if (variant === 'dark') return <Gpt5Dark {...props} className={className} />
  return (
    <>
      <Gpt5Light className={cn('dark:hidden', className)} {...props} />
      <Gpt5Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt5Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5, {
  Avatar: Gpt5Avatar,
  colorPrimary: '#000000'
})

export default Gpt5Icon
