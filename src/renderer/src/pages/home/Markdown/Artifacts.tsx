import { CloseOutlined, DownloadOutlined, ExpandOutlined } from '@ant-design/icons'
import MinApp from '@renderer/components/MinApp'
import { AppLogo } from '@renderer/config/env'
import { extractTitle } from '@renderer/utils/formats'
import { Button, Modal } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  html: string
}

const Artifacts: FC<Props> = ({ html }) => {
  const { t } = useTranslation()
  const title = extractTitle(html) || 'Artifacts' + ' ' + t('chat.artifacts.button.preview')
  const [previewModalVisible, setPreviewModalVisible] = useState(false)

  const onPreview = async () => {
    setPreviewModalVisible(true) // 显示 Modal
  }

  const handlePreviewModalOk = async () => {
    setPreviewModalVisible(false)
    const path = await window.api.file.create('artifacts-preview.html')
    await window.api.file.write(path, html)
    const filePath = `file://${path}`
    MinApp.start({
      name: title,
      logo: AppLogo,
      url: filePath
    })
  }

  const handlePreviewModalCancel = async () => {
    setPreviewModalVisible(false)
    const path = await window.api.file.create('artifacts-preview.html')
    await window.api.file.write(path, html)
    const filePath = `file://${path}`

    if (window.api.shell && window.api.shell.openExternal) {
      window.api.shell.openExternal(filePath)
    } else {
      Modal.error({
        title: t('chat.artifacts.preview.modal.error.title'),
        content: t('chat.artifacts.preview.modal.error.content')
      })
    }
  }

  const handlePreviewModalClose = () => {
    setPreviewModalVisible(false)
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

      <Modal
        title={t('chat.artifacts.preview.modal.title')}
        open={previewModalVisible}
        onOk={handlePreviewModalOk}
        onCancel={handlePreviewModalClose}
        okText={t('chat.artifacts.preview.modal.okText')}
        cancelText={t('chat.artifacts.preview.modal.cancelText')}
        closable={true}
        closeIcon={<CloseOutlined />}
        footer={[
          <Button key="cancel" onClick={handlePreviewModalCancel}>
            {t('chat.artifacts.preview.modal.cancelText')}
          </Button>,
          <Button key="submit" type="primary" onClick={handlePreviewModalOk}>
            {t('chat.artifacts.preview.modal.okText')}
          </Button>
        ]}>
        <p>{t('chat.artifacts.preview.modal.content')}</p>
      </Modal>
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
