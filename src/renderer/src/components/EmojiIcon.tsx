import { FC } from 'react'
import styled from 'styled-components'

interface EmojiIconProps {
  emoji: string
  className?: string
}

const EmojiIcon: FC<EmojiIconProps> = ({ emoji, className }) => {
  return (
    <Container className={className}>
      <EmojiBackground>{emoji || '⭐️'}</EmojiBackground>
      {emoji}
    </Container>
  )
}

const Container = styled.div`
  width: 26px;
  height: 26px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 15px;
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
