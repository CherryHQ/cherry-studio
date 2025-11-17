import type { ButtonProps } from 'antd'
import { Button } from 'antd'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import styled from 'styled-components'

const StyledButton = styled(Button)`
  height: 36px;
  width: calc(var(--assistants-width) - 20px);
  justify-content: flex-start;
  border-radius: var(--list-item-border-radius);
  padding: 0 12px;
  font-size: 13px;
  color: var(--color-text-2);

  &:hover {
    background-color: var(--color-list-item);
  }
`

const AddButton: FC<ButtonProps> = ({ ...props }) => {
  return (
    <StyledButton
      {...props}
      type="text"
      onClick={props.onClick}
      icon={<PlusIcon size={16} style={{ flexShrink: 0 }} />}>
      {props.children}
    </StyledButton>
  )
}

export default AddButton
