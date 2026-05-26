import styled from 'styled-components'

/**
 * Inner padded container for the chat list. Used by `ChatVirtualList`
 * consumers that want consistent padding inside the virtualized
 * scroller. Flex-direction is now natural (column) — `ChatVirtualList`
 * handles its own scroll-to-bottom semantics.
 */
export const ScrollContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 10px 10px 20px;
  .multi-select-mode & {
    padding-bottom: 60px;
  }
`

interface ContainerProps {
  $right?: boolean
}

/**
 * Outer wrapper for the chat surface. **Not** the scroll element —
 * `ChatVirtualList` owns scrolling. Acts as the flex parent for the
 * virtualized list, the system-prompt banner, the anchor rail, and
 * the multi-select selection box.
 */
export const MessagesContainer = styled.div<ContainerProps>`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  z-index: 1;
  position: relative;
`
