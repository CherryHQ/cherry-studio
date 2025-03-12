import { GlobalOutlined } from '@ant-design/icons'
import React, { FC } from 'react'
import styled from 'styled-components'

const WebSearchIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  return (
    <Container>
      <Icon {...(props as any)} />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`

const Icon = styled(GlobalOutlined)`
  color: var(--color-link);
  font-size: 15px;
  margin-right: 6px;
`

export default WebSearchIcon
