import { FC } from 'react'
import styled from 'styled-components'

interface EmojiIconProps {
  emoji: string
  className?: string
  size?: number
  fontSize?: number
}

const EmojiIcon: FC<EmojiIconProps> = ({ emoji, className, size = 26, fontSize = 15 }) => {
  return (
    <Container className={className} $size={size} $fontSize={fontSize}>
      <EmojiBackground>{emoji || '⭐️'}</EmojiBackground>
      {emoji}
    </Container>
  )
}

const Container = styled.div<{ $size: number; $fontSize: number }>`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${({ $size }) => $size / 2}px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: ${({ $fontSize }) => $fontSize}px;
  position: relative;
  overflow: hidden;
  margin-right: 3px;
`

const EmojiBackground = styled.div`
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 200%;
  transform: scale(1.5);
  filter: blur(5px);
  opacity: 0.4;
`

export default EmojiIcon
