import { TopView } from '@renderer/components/TopView'
import { download } from '@renderer/utils/download'
import { Button, Modal, Space, Tabs } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShowParams {
  chart: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve, chart }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const mermaidId = `mermaid-popup-${Date.now()}`
  const [activeTab, setActiveTab] = useState('preview')
  const [scale, setScale] = useState(1)

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const handleZoom = (delta: number) => {
    const newScale = Math.max(0.1, Math.min(3, scale + delta))
    setScale(newScale)

    const element = document.getElementById(mermaidId)
    if (!element) return

    const svg = element.querySelector('svg')
    if (!svg) return

    const container = svg.parentElement
    if (container) {
      container.style.overflow = 'auto'
      container.style.position = 'relative'
      svg.style.transformOrigin = 'top left'
      svg.style.transform = `scale(${newScale})`
    }
  }

  const handleCopyImage = async () => {
    try {
      const element = document.getElementById(mermaidId)
      if (!element) return

      const svgElement = element.querySelector('svg')
      if (!svgElement) return

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()
      img.crossOrigin = 'anonymous'

      const viewBox = svgElement.getAttribute('viewBox')?.split(' ').map(Number) || []
      const width = viewBox[2] || svgElement.clientWidth || svgElement.getBoundingClientRect().width
      const height = viewBox[3] || svgElement.clientHeight || svgElement.getBoundingClientRect().height

      const svgData = new XMLSerializer().serializeToString(svgElement)
      const svgBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`

      img.onload = async () => {
        const scale = 3
        canvas.width = width * scale
        canvas.height = height * scale

        if (ctx) {
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0, width, height)
          const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          window.message.success(t('message.copy.success'))
        }
      }
      img.src = svgBase64
    } catch (error) {
      console.error('Copy failed:', error)
      window.message.error(t('message.copy.failed'))
    }
  }

  const handleDownload = async (format: 'svg' | 'png') => {
    try {
      const element = document.getElementById(mermaidId)
      if (!element) return

      const timestamp = Date.now()

      if (format === 'svg') {
        const svgElement = element.querySelector('svg')
        if (!svgElement) return
        const svgData = new XMLSerializer().serializeToString(svgElement)
        const blob = new Blob([svgData], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        download(url, `mermaid-diagram-${timestamp}.svg`)
        URL.revokeObjectURL(url)
      } else if (format === 'png') {
        const svgElement = element.querySelector('svg')
        if (!svgElement) return

        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const img = new Image()
        img.crossOrigin = 'anonymous'

        const viewBox = svgElement.getAttribute('viewBox')?.split(' ').map(Number) || []
        const width = viewBox[2] || svgElement.clientWidth || svgElement.getBoundingClientRect().width
        const height = viewBox[3] || svgElement.clientHeight || svgElement.getBoundingClientRect().height

        const svgData = new XMLSerializer().serializeToString(svgElement)
        const svgBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`

        img.onload = () => {
          const scale = 3
          canvas.width = width * scale
          canvas.height = height * scale

          if (ctx) {
            ctx.scale(scale, scale)
            ctx.drawImage(img, 0, 0, width, height)
          }

          canvas.toBlob((blob) => {
            if (blob) {
              const pngUrl = URL.createObjectURL(blob)
              download(pngUrl, `mermaid-diagram-${timestamp}.png`)
              URL.revokeObjectURL(pngUrl)
            }
          }, 'image/png')
        }
        img.src = svgBase64
      }
    } catch (error) {
      console.error('Download failed:', error)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(chart)
    window.message.success(t('message.copy.success'))
  }

  useEffect(() => {
    window?.mermaid?.contentLoaded()
  }, [])

  return (
    <Modal
      title={t('mermaid.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      width={1000}
      centered
      footer={[
        <Space key="download-buttons">
          {activeTab === 'source' && <Button onClick={() => handleCopy()}>{t('common.copy')}</Button>}
          {activeTab === 'preview' && (
            <>
              <Button onClick={() => handleZoom(0.1)}>{t('mermaid.resize.zoom-in')}</Button>
              <Button onClick={() => handleZoom(-0.1)}>{t('mermaid.resize.zoom-out')}</Button>
              <Button onClick={() => handleCopyImage()}>{t('common.copy')}</Button>
              <Button onClick={() => handleDownload('svg')}>{t('mermaid.download.svg')}</Button>
              <Button onClick={() => handleDownload('png')}>{t('mermaid.download.png')}</Button>
            </>
          )}
        </Space>
      ]}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key)}
        items={[
          {
            key: 'preview',
            label: t('mermaid.tabs.preview'),
            children: (
              <StyledMermaid id={mermaidId} className="mermaid">
                {chart}
              </StyledMermaid>
            )
          },
          {
            key: 'source',
            label: t('mermaid.tabs.source'),
            children: (
              <pre
                style={{
                  maxHeight: 'calc(80vh - 200px)',
                  overflowY: 'auto',
                  padding: '16px'
                }}>
                {chart}
              </pre>
            )
          }
        ]}
      />
    </Modal>
  )
}

export default class MermaidPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('MermaidPopup')
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'MermaidPopup'
      )
    })
  }
}

const StyledMermaid = styled.div`
  max-height: calc(80vh - 200px);
  text-align: center;
  overflow-y: auto;
`
