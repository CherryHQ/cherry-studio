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
  background-color: var(--color-background-mute);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  text-wrap: wrap;
  border-radius: 0 0 8px 8px;
`

export default memo(StatusBar)
