import { Tooltip } from '@cherrystudio/ui'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const ReasoningIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  const { t } = useTranslation()

  return (
    <Container>
      <Tooltip content={t('models.type.reasoning')}>
        <Icon className="iconfont icon-thinking" {...(props as any)} />
      </Tooltip>
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
