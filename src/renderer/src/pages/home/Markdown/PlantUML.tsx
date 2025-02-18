import { CopyOutlined, LoadingOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Button, Modal, Space, Spin, Tabs } from 'antd'
import pako from 'pako'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface PlantUMLPopupProps {
  resolve: (data: any) => void
  diagram: string
}
export function isValidPlantUML(diagram: string | null): boolean {
  if (!diagram || !diagram.trim().startsWith('@start')) {
    return false
  }
  const diagramType = diagram.match(/@start(\w+)/)?.[1]

  return diagramType !== undefined && diagram.search(`@end${diagramType}`) !== -1
}

const PlantUMLServer = 'https://www.plantuml.com/plantuml'
function encode64(data: Uint8Array) {
  let r = ''
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 === data.length) {
      r += append3bytes(data[i], data[i + 1], 0)
    } else if (i + 1 === data.length) {
      r += append3bytes(data[i], 0, 0)
    } else {
      r += append3bytes(data[i], data[i + 1], data[i + 2])
    }
  }
  return r
}

function encode6bit(b: number) {
  if (b < 10) {
    return String.fromCharCode(48 + b)
  }
  b -= 10
  if (b < 26) {
    return String.fromCharCode(65 + b)
  }
  b -= 26
  if (b < 26) {
    return String.fromCharCode(97 + b)
  }
  b -= 26
  if (b === 0) {
    return '-'
  }
  if (b === 1) {
    return '_'
  }
  return '?'
}

function append3bytes(b1: number, b2: number, b3: number) {
  const c1 = b1 >> 2
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4)
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6)
  const c4 = b3 & 0x3f
  let r = ''
  r += encode6bit(c1 & 0x3f)
  r += encode6bit(c2 & 0x3f)
  r += encode6bit(c3 & 0x3f)
  r += encode6bit(c4 & 0x3f)
  return r
}
/**
 * https://plantuml.com/zh/code-javascript-synchronous
 * To use PlantUML image generation, a text diagram description have to be :
    1. Encoded in UTF-8
    2. Compressed using Deflate algorithm
    3. Reencoded in ASCII using a transformation _close_ to base64
 */
function encodeDiagram(diagram: string): string {
  const utf8text = new TextEncoder().encode(diagram)
  const compressed = pako.deflateRaw(utf8text)
  return encode64(compressed)
}

type PlantUMLServerImageProps = {
  format: 'png' | 'svg'
  diagram: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
}

function getPlantUMLImageUrl(format: 'png' | 'svg', diagram: string, isDark?: boolean) {
  const encodedDiagram = encodeDiagram(diagram)
  if (isDark) {
    return `${PlantUMLServer}/d${format}/${encodedDiagram}`
  }
  return `${PlantUMLServer}/${format}/${encodedDiagram}`
}

const PlantUMLServerImage: React.FC<PlantUMLServerImageProps> = ({ format, diagram, onClick }) => {
  const [loading, setLoading] = useState(true)
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const url = getPlantUMLImageUrl(format, diagram, isDark)
  return (
    <StyledPlantUML onClick={onClick}>
      <Spin
        spinning={loading}
        indicator={
          <LoadingOutlined
            spin
            style={{
              fontSize: 32
            }}
          />
        }>
        <img
          src={url}
          onLoad={() => {
            setLoading(false)
          }}
          onError={(e) => {
            setLoading(false)
            const target = e.target as HTMLImageElement
            target.style.opacity = '0.5'
            target.style.filter = 'blur(2px)'
          }}
        />
      </Spin>
    </StyledPlantUML>
  )
}

const PlantUMLPopupCantaier: React.FC<PlantUMLPopupProps> = ({ resolve, diagram }) => {
  const [open, setOpen] = useState(true)
  const [downloading, setDownloading] = useState({
    png: false,
    svg: false
  })
  const [activeTab, setActiveTab] = useState('preview')
  const { t } = useTranslation()
  console.log(`plantuml diagram: ${diagram}`)
  const encodedDiagram = encodeDiagram(diagram)
  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }
  const onClose = () => {
    resolve({})
  }
  const handleDownload = (format: 'svg' | 'png') => {
    const timestamp = Date.now()
    const url = `${PlantUMLServer}/${format}/${encodedDiagram}`
    setDownloading((prev) => ({ ...prev, [format]: true }))
    const filename = `plantuml-diagram-${timestamp}.${format}`
    downloadUrl(url, filename)
      .catch(() => {
        window.message.error(t('plantuml.download.failed'))
      })
      .finally(() => {
        setDownloading((prev) => ({ ...prev, [format]: false }))
      })
  }

  function handleCopy() {
    navigator.clipboard.writeText(diagram)
    window.message.success(t('message.copy.success'))
  }

  return (
    <Modal
      title={t('plantuml.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      width={1000}
      centered
      footer={[
        <Space key="download-buttons">
          {activeTab === 'source' && (
            <Button onClick={handleCopy} icon={<CopyOutlined />}>
              {t('common.copy')}
            </Button>
          )}
          {activeTab === 'preview' && (
            <>
              <Button onClick={() => handleDownload('svg')} loading={downloading.svg}>
                {t('plantuml.download.svg')}
              </Button>
              <Button onClick={() => handleDownload('png')} loading={downloading.png}>
                {t('plantuml.download.png')}
              </Button>
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
            label: t('plantuml.tabs.preview'),
            children: <PlantUMLServerImage format="svg" diagram={diagram} />
          },
          {
            key: 'source',
            label: t('plantuml.tabs.source'),
            children: (
              <pre
                style={{
                  maxHeight: 'calc(80vh - 200px)',
                  overflowY: 'auto',
                  padding: '16px'
                }}>
                {diagram}
              </pre>
            )
          }
        ]}
      />
    </Modal>
  )
}

class PlantUMLPopupTopView {
  static topviewId = 0
  static hide() {
    TopView.hide('PlantUMLPopup')
  }
  static show(diagram: string) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PlantUMLPopupCantaier
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
          diagram={diagram}
        />,
        'PlantUMLPopup'
      )
    })
  }
}
interface PlantUMLProps {
  diagram: string
}
export const PlantUML: React.FC<PlantUMLProps> = ({ diagram }) => {
  //   const { t } = useTranslation()
  const onPreview = () => {
    PlantUMLPopupTopView.show(diagram)
  }
  return <PlantUMLServerImage onClick={onPreview} format="svg" diagram={diagram} />
}

const StyledPlantUML = styled.div`
  max-height: calc(80vh - 100px);
  text-align: center;
  overflow-y: auto;
  img {
    max-width: 100%;
    height: auto;
    min-height: 100px;
    background: var(--color-code-background);
    cursor: pointer;
  }
`
async function downloadUrl(url: string, filename: string) {
  const response = await fetch(url)
  if (!response.ok) {
    window.message.warning({ content: response.statusText, duration: 1.5 })
    return
  }
  const blob = await response.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}
