import { FC, memo } from 'react'
import styled from 'styled-components'

interface Props {
  children: string
}

const StatusBar: FC<Props> = ({ children }) => {
  return <Container>{children}</Container>
}

const Container = styled.div`
  margin: 10px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding-bottom: 10px;
  overflow-y: auto;
  text-wrap: wrap;
`

export default memo(StatusBar)
