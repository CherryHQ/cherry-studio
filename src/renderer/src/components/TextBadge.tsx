import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  text: string
  style?: React.CSSProperties
}

const TextBadge: FC<Props> = ({ text, style }) => {
  return <Container style={style}>{text}</Container>
}

const Container = styled.span`
  font-size: 12px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
`

export default TextBadge
