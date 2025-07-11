import { Flex } from 'antd'
import { FC, memo, ReactNode } from 'react'
import styled from 'styled-components'

interface Props {
  children: string | ReactNode
}

const StatusBar: FC<Props> = ({ children }) => {
  return <Container>{children}</Container>
}

const Container = styled(Flex)`
  margin: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  overflow-y: auto;
  text-wrap: wrap;
`

export default memo(StatusBar)
