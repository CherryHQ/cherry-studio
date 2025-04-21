import React, { CSSProperties } from 'react'
import styled from 'styled-components'

interface DividerWithTextProps {
  text: string
  style?: CSSProperties
}

const DividerWithText: React.FC<DividerWithTextProps> = ({ text, style }) => {
  return (
    <DividerContainer style={style}>
      <DividerText>{text}</DividerText>
      <DividerLine />
    </DividerContainer>
  )
}

const DividerContainer = styled.div`
  display: flex;
  align-items: center;
  margin: 0px 0;
`

const DividerText = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
  margin-right: 8px;
`

const DividerLine = styled.div`
  flex: 1;
  height: 1px;
  background-color: var(--color-border);
`

export default DividerWithText
