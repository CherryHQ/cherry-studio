import type { ErrorMessageBlock } from '@renderer/types/newMessageTypes'
import React from 'react'
import styled from 'styled-components'

interface Props {
  block: ErrorMessageBlock
}

const ErrorBlock: React.FC<Props> = ({ block }) => {
  return (
    <ErrorContainer>
      <ErrorIcon>⚠️</ErrorIcon>
      <ErrorMessage>
        {block.error?.message || '发生了错误，请重试或联系客服'}
      </ErrorMessage>
    </ErrorContainer>
  )
}

const ErrorContainer = styled.div`
  display: flex;
  align-items: center;
  background-color: var(--color-background-error);
  color: var(--color-text-error);
  padding: 12px 16px;
  border-radius: 8px;
  margin: 10px 0;
`

const ErrorIcon = styled.div`
  font-size: 18px;
  margin-right: 10px;
`

const ErrorMessage = styled.div`
  font-size: 14px;
`

export default React.memo(ErrorBlock)