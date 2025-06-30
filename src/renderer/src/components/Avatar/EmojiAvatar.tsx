import React, { memo } from 'react'
import styled from 'styled-components'

interface EmojiAvatarProps {
  children: string
  size?: number
  fontSize?: number
  onClick?: React.MouseEventHandler<HTMLDivElement>
  className?: string
  style?: React.CSSProperties
}

const EmojiAvatar = ({
  ref,
  children,
  size = 31,
  fontSize,
  onClick,
  className,
  style
}: EmojiAvatarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => (
  <StyledEmojiAvatar
    ref={ref}
    $size={size}
    $fontSize={fontSize ?? size * 0.5}
    onClick={onClick}
    className={className}
    style={style}>
    {children}
  </StyledEmojiAvatar>
)

EmojiAvatar.displayName = 'EmojiAvatar'

const StyledEmojiAvatar = styled.div<{ $size: number; $fontSize: number }>`
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background-soft);
  border: 0.5px solid var(--color-border);
  border-radius: 20%;
  cursor: pointer;
  width: ${(props) => props.$size}px;
  height: ${(props) => props.$size}px;
  font-size: ${(props) => props.$fontSize}px;
  transition: opacity 0.3s ease;

  &:hover {
    opacity: 0.8;
  }
`

export default memo(EmojiAvatar)
