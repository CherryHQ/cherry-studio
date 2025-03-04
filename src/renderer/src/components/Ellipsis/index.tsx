import type { HTMLAttributes } from 'react'
import styled, { css } from 'styled-components'

type Props = {
  maxLine?: number
} & HTMLAttributes<HTMLDivElement>

const Ellipsis = (props: Props) => {
  const { maxLine = 1, children, ...rest } = props
  return (
    <EllipsisContainer $maxLine={maxLine} {...rest}>
      {children}
    </EllipsisContainer>
  )
}

const multiLineEllipsis = css<{ $maxLine: number }>`
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${({ $maxLine }) => $maxLine};
  overflow-wrap: break-word;
`

const singleLineEllipsis = css`
  display: block;
  white-space: nowrap;
`

const EllipsisContainer = styled.div<{ $maxLine: number }>`
  overflow: hidden;
  text-overflow: ellipsis;
  ${({ $maxLine }) => ($maxLine > 1 ? multiLineEllipsis : singleLineEllipsis)}
`

export default Ellipsis
