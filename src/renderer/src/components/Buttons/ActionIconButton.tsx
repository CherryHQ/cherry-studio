import { classNames } from '@renderer/utils'
import { Button, ButtonProps } from 'antd'
import React, { memo } from 'react'
import styled from 'styled-components'

interface ActionIconButtonProps extends ButtonProps {
  children: React.ReactNode
  active?: boolean
}

/**
 * A simple action button rendered as an icon
 */
const ActionIconButton: React.FC<ActionIconButtonProps> = ({ children, active = false, className, ...props }) => {
  return (
    <StyledActionButton type="text" shape="circle" className={classNames({ active }, className)} {...props}>
      {children}
    </StyledActionButton>
  )
}

const StyledActionButton = styled(Button)`
  height: 30px;
  width: 30px;
  font-size: 16px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  border: none;
  transition: all 0.3s ease;

  color: var(--color-icon);
  .icon,
  .anticon,
  .iconfont,
  .lucide {
    color: var(--color-icon);
  }

  .icon-a-addchat {
    font-size: 18px;
    margin-bottom: -2px;
  }

  &.active {
    .icon,
    .anticon,
    .iconfont,
    .lucide {
      color: var(--color-primary);
    }
  }
`

export default memo(ActionIconButton)
