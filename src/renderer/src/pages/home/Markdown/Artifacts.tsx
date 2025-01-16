import { DownloadOutlined, ExpandOutlined } from '@ant-design/icons'
import MinApp from '@renderer/components/MinApp'
import { AppLogo } from '@renderer/config/env'
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
  const title = extractTitle(html) || 'Artifacts' + ' ' + t('chat.artifacts.button.preview')

  const onPreview = async () => {
    const path = await window.api.file.create('artifacts-preview.html')
    await window.api.file.write(path, html)

    MinApp.start({
      name: title,
      logo: AppLogo,
      url: `file://${path}`
    })
  }

  const onDownload = () => {
    window.api.file.save(`${title}.html`, html)
  }

  return (
    <Container>
      <Button type="primary" icon={<ExpandOutlined />} onClick={onPreview} size="small">
        {t('chat.artifacts.button.preview')}
      </Button>
      <Button icon={<DownloadOutlined />} onClick={onDownload} size="small">
        {t('chat.artifacts.button.download')}
      </Button>
    </Container>
  )
}

const Container = styled.div`
  margin: 10px;
  display: flex;
  flex-direction: row;
  gap: 8px;
`

export default Artifacts
