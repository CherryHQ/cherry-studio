import { EyeOutlined } from '@ant-design/icons'
import React, { FC } from 'react'
import styled from 'styled-components'

const VisionIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
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

const Icon = styled(EyeOutlined)`
  color: var(--color-primary);
  font-size: 15px;
  margin-right: 6px;
`

export default VisionIcon
