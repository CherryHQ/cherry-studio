import { getLeadingEmoji } from '@renderer/utils'
import styled from 'styled-components'

const EmojiIcon = styled.div<{ $emoji: string }>`
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
  &:before {
    width: 100%;
    height: 100%;
    content: ${({ $emoji }) => `'${getLeadingEmoji($emoji || ' ')}'`};
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 200%;
    transform: scale(1.5);
    filter: blur(5px);
    opacity: 0.4;
  }
`

export default EmojiIcon
