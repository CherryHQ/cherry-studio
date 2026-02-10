import { isProd } from '@renderer/config/constant'
import type { ComponentType } from 'react'
import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const BlockErrorFallback: ComponentType<FallbackProps> = ({ error }) => {
  const { t } = useTranslation()

  return (
    <Container>
      <Message>{t('error.render.block', { defaultValue: 'This content block failed to render' })}</Message>
      {!isProd && error && <Detail>{error.message}</Detail>}
    </Container>
  )
}

const Container = styled.div`
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-error-bg, rgba(255, 77, 79, 0.04));
  border: 1px dashed var(--color-error, #ff4d4f);
  font-size: 12px;
`

const Message = styled.div`
  color: var(--color-error, #ff4d4f);
`

const Detail = styled.div`
  margin-top: 4px;
  color: var(--color-text-3);
  font-family: monospace;
  word-break: break-all;
`

export default BlockErrorFallback
