import { ExpandOutlined, LinkOutlined } from '@ant-design/icons'
import { AppLogo } from '@renderer/config/env'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { extractTitle } from '@renderer/utils/formats'
import { Button } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  html: string
}

const Artifacts: FC<Props> = ({ html }) => {
  const { t } = useTranslation()
  const { openMinapp } = useMinappPopup()

  /**
   * 在应用内打开
   */
  const handleOpenInApp = async () => {
    const path = await window.api.file.createTempFile('artifacts-preview.html')
    await window.api.file.write(path, html)
    const filePath = `file://${path}`
    const title = extractTitle(html) || 'Artifacts ' + t('chat.artifacts.button.preview')
    openMinapp({
      id: 'artifacts-preview',
      name: title,
      logo: AppLogo,
      url: filePath
    })
  }

  /**
   * 外部链接打开
   */
  const handleOpenExternal = async () => {
    const path = await window.api.file.createTempFile('artifacts-preview.html')
    await window.api.file.write(path, html)
    const filePath = `file://${path}`

    if (window.api.shell && window.api.shell.openExternal) {
      window.api.shell.openExternal(filePath)
    } else {
      console.error(t('artifacts.preview.openExternal.error.content'))
    }
  }

  return (
    <Container>
      <Button icon={<ExpandOutlined />} onClick={handleOpenInApp}>
        {t('chat.artifacts.button.preview')}
      </Button>

      <Button icon={<LinkOutlined />} onClick={handleOpenExternal}>
        {t('chat.artifacts.button.openExternal')}
      </Button>
    </Container>
  )
}

const Container = styled.div`
  margin: 10px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding-bottom: 10px;
`

export default Artifacts
