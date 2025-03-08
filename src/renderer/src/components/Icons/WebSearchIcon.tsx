import { GlobalOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import React, { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const WebSearchIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  const { t } = useTranslation()

  return (
    <Container>
      <Tooltip title={t('models.websearch')} placement="top">
        <Icon {...(props as any)} />
      </Tooltip>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`

const Icon = styled(GlobalOutlined)`
  color: var(--color-link);
  font-size: 15px;
  margin-right: 6px;
`

export default WebSearchIcon
