import React, { FC } from 'react'
import styled from 'styled-components'

const ReasoningIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  return (
    <Container>
      <Icon className="iconfont icon-thinking" {...(props as any)} />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`

const Icon = styled.i`
  color: var(--color-link);
  font-size: 16px;
  margin-right: 6px;
`

export default ReasoningIcon
