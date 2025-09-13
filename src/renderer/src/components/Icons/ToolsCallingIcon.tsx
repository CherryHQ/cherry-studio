import { ToolOutlined } from '@ant-design/icons'
import { Tooltip } from '@heroui/react'
import React, { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const ToolsCallingIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  const { t } = useTranslation()

  return (
    <Container>
      <Tooltip content={t('models.function_calling')} placement="top" showArrow={true}>
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

const Icon = styled(ToolOutlined)`
  color: var(--color-primary);
  font-size: 15px;
  margin-right: 6px;
`

export default ToolsCallingIcon
