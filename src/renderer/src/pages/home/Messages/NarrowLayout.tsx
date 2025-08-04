import { useSettings } from '@renderer/hooks/useSettings'
import { FC, HTMLAttributes } from 'react'
import styled from 'styled-components'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

const NarrowLayout: FC<Props> = ({ children, ...props }) => {
  const { narrowMode } = useSettings()

  return (
    <Container className={`narrow-mode ${narrowMode ? 'active' : ''}`} {...props}>
      {children}
    </Container>
  )
}

const Container = styled.div`
  max-width: 100%;
  width: 100%;
  margin: 0 auto;
  position: relative;
  transition: max-width 0.3s ease-in-out;

  &.active {
    max-width: 800px;
  }
`

export default NarrowLayout
