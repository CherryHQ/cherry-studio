import { Tooltip } from 'antd'
import { ImageIcon } from 'lucide-react'
import React, { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const VisionIcon: FC<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>> = (props) => {
  const { t } = useTranslation()

  return (
    <Container>
      <Tooltip title={t('models.type.vision')} placement="top">
        <Icon size={15} {...(props as any)} />
      </Tooltip>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`

const Icon = styled(ImageIcon)`
  color: var(--color-primary);
  margin-right: 6px;
`

export default VisionIcon
