import { SyncOutlined } from '@ant-design/icons'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { Button } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const UpdateAppButton: FC = () => {
  return null
}

const Container = styled.div``

const UpdateButton = styled(Button)`
  border-radius: 24px;
  font-size: 12px;
  @media (max-width: 1000px) {
    display: none;
  }
`

export default UpdateAppButton
