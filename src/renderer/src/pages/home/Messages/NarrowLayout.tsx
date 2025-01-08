import { useSettings } from '@renderer/hooks/useSettings'
import { FC, HTMLAttributes } from 'react'
import styled from 'styled-components'

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

const NarrowLayout: FC<Props> = ({ children, ...props }) => {
  const { narrowMode } = useSettings()

  if (narrowMode) {
    return <Container {...props}>{children}</Container>
  }

  return children
}

const Container = styled.div`
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
`

export default NarrowLayout
