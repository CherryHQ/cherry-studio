import Scrollbar from '@renderer/components/Scrollbar'
import styled from 'styled-components'

export const ScrollContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
  overflow-anchor: none;
  padding: 10px 10px 20px;
  .multi-select-mode & {
    padding-bottom: 60px;
  }
`

interface ContainerProps {
  $right?: boolean
}

export const MessagesContainer = styled(Scrollbar)<ContainerProps>`
  display: flex;
  flex-direction: column-reverse;
  overflow-anchor: none;
  overflow-x: hidden;
  z-index: 1;
  position: relative;
`
