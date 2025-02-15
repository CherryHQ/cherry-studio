import React from 'react'
import styled from 'styled-components'

type Props = {
  text: string | number
  maxLine?: number
} & React.HTMLAttributes<HTMLDivElement>

const Ellipsis = (props: Props) => {
  const { text, maxLine = 1, ...rest } = props
  return (
    <EllipsisContainer maxLine={maxLine} {...rest}>
      {text}
    </EllipsisContainer>
  )
}

const EllipsisContainer = styled.div<{ maxLine: number }>`
  display: -webkit-box;
  -webkit-box-orient: vertical;
  text-overflow: ellipsis;
  overflow: hidden;
  -webkit-line-clamp: ${({ maxLine }) => maxLine};
`

export default Ellipsis
