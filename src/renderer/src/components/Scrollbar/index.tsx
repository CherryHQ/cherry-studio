import { forwardRef } from 'react'
import styled from 'styled-components'

interface Props {
  children?: React.ReactNode
  className?: string
  $isScrolling?: boolean
  $right?: boolean
}

const ScrollbarContainer = styled.div<{ $isScrolling?: boolean; $right?: boolean }>`
  overflow-y: auto;
  overflow-x: hidden;
  height: 100%;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    border-radius: 3px;
    background: transparent;
    ${({ $right }) => $right && `margin-right: 4px;`}
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 3px;
    background: ${({ $isScrolling }) =>
      $isScrolling ? 'var(--color-scrollbar-thumb)' : 'var(--color-scrollbar-track)'};
    transition: all 0.2s ease-in-out;
  }

  &:hover::-webkit-scrollbar-thumb {
    background: var(--color-scrollbar-thumb);
  }
`

const Scrollbar = forwardRef<HTMLDivElement, Props>(({ children, className, $isScrolling, $right }, ref) => {
  return (
    <ScrollbarContainer ref={ref} className={className} $isScrolling={$isScrolling} $right={$right}>
      {children}
    </ScrollbarContainer>
  )
})

Scrollbar.displayName = 'Scrollbar'

export default Scrollbar
