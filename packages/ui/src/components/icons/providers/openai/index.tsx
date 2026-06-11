import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenaiAvatar } from './avatar'
import { OpenaiDark } from './dark'
import { OpenaiLight } from './light'

const Openai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenaiLight {...props} className={className} />
  if (variant === 'dark') return <OpenaiDark {...props} className={className} />
  return (
    <>
      <OpenaiLight className={cn(className, 'dark:hidden')} {...props} />
      <OpenaiDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const OpenaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openai, {
  Avatar: OpenaiAvatar,
  colorPrimary: '#000000'
})

export default OpenaiIcon
