import { TopView } from '@renderer/components/TopView'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setMCPServers } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { Modal, Typography } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [jsonConfig, setJsonConfig] = useState('')
  const [jsonSaving, setJsonSaving] = useState(false)
  const [jsonError, setJsonError] = useState('')
  const mcpServers = useAppSelector((state) => state.mcp.servers)

  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  const ipcRenderer = window.electron.ipcRenderer

  useEffect(() => {
    try {
      const mcpServersObj: Record<string, any> = {}

      mcpServers.forEach((server) => {
        const { name, ...serverData } = server
        mcpServersObj[name] = serverData
      })

      const standardFormat = {
        mcpServers: mcpServersObj
      }

      const formattedJson = JSON.stringify(standardFormat, null, 2)
      setJsonConfig(formattedJson)
      setJsonError('')
    } catch (error) {
      console.error('Failed to format JSON:', error)
      setJsonError(t('settings.mcp.jsonFormatError'))
    }
  }, [mcpServers, t])

  const onOk = async () => {
    setJsonSaving(true)
    try {
      if (!jsonConfig.trim()) {
        dispatch(setMCPServers([]))
        window.message.success(t('settings.mcp.jsonSaveSuccess'))
        setJsonError('')
        setJsonSaving(false)
        return
      }
      const parsedConfig = JSON.parse(jsonConfig)

      if (!parsedConfig.mcpServers || typeof parsedConfig.mcpServers !== 'object') {
        throw new Error(t('settings.mcp.invalidMcpFormat'))
      }

      const serversArray: MCPServer[] = []
      for (const [name, serverConfig] of Object.entries(parsedConfig.mcpServers)) {
        const server: MCPServer = {
          name,
          isActive: false,
          ...(serverConfig as any)
        }
        serversArray.push(server)
      }

      dispatch(setMCPServers(serversArray))
      ipcRenderer.send('mcp:servers-from-renderer', mcpServers)

      window.message.success(t('settings.mcp.jsonSaveSuccess'))
      setJsonError('')
      setOpen(false)
    } catch (error: any) {
      console.error('Failed to save JSON config:', error)
      setJsonError(error.message || t('settings.mcp.jsonSaveError'))
      window.message.error(t('settings.mcp.jsonSaveError'))
    } finally {
      setJsonSaving(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  EditMcpJsonPopup.hide = onCancel

  return (
    <Modal
      title={t('settings.mcp.editJson')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      width={800}
      height="80vh"
      loading={jsonSaving}
      transitionName="ant-move-down"
      centered>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Text type="secondary">
          {jsonError ? <span style={{ color: 'red' }}>{jsonError}</span> : ''}
        </Typography.Text>
      </div>
      <TextArea
        value={jsonConfig}
        onChange={(e) => setJsonConfig(e.target.value)}
        style={{
          width: '100%',
          fontFamily: 'monospace',
          minHeight: '60vh',
          marginBottom: '16px'
        }}
        onFocus={() => setJsonError('')}
      />
      <Typography.Text type="secondary">{t('settings.mcp.jsonModeHint')}</Typography.Text>
    </Modal>
  )
}

const TopViewKey = 'EditMcpJsonPopup'

export default class EditMcpJsonPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
