import type { ButtonProps as HeroUIButtonProps } from '@heroui/react'
import { Button as HeroUIButton } from '@heroui/react'

export interface ButtonProps extends HeroUIButtonProps {}

const Button = ({ ...props }: ButtonProps) => {
  return <HeroUIButton {...props} />
}

Button.displayName = 'Button'

export default Button
