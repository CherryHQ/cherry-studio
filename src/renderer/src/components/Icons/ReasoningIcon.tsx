import { Tooltip } from 'antd'
import React, { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const ReasoningIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  const { t } = useTranslation()

  return (
    <Container>
      <Tooltip title={t('models.reasoning')} placement="top">
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
