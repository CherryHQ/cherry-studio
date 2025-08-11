import { loggerService } from '@logger'
import CodeEditor from '@renderer/components/CodeEditor'
import { TopView } from '@renderer/components/TopView'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setMCPServers } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { Modal, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (data: any) => void
}

const logger = loggerService.withContext('EditMcpJsonPopup')

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [jsonConfig, setJsonConfig] = useState('')
  const [jsonSaving, setJsonSaving] = useState(false)
  const [jsonError, setJsonError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const mcpServers = useAppSelector((state) => state.mcp.servers)

  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  useEffect(() => {
    setIsLoading(true)
    try {
      const mcpServersObj: Record<string, any> = {}

      mcpServers.forEach((server) => {
        const { id, ...serverData } = server
        mcpServersObj[id] = serverData
      })

      const standardFormat = {
        mcpServers: mcpServersObj
      }

      const formattedJson = JSON.stringify(standardFormat, null, 2)
      setJsonConfig(formattedJson)
      setJsonError('')
    } catch (error) {
      logger.error('Failed to format JSON:', error as Error)
      setJsonError(t('settings.mcp.jsonFormatError'))
    } finally {
      setIsLoading(false)
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
        throw new Error(t('settings.mcp.addServer.importFrom.invalid'))
      }

      const serversArray: MCPServer[] = []

      for (const [id, serverConfig] of Object.entries(parsedConfig.mcpServers)) {
        const server: MCPServer = {
          id,
          isActive: false,
          ...(serverConfig as any)
        }

        if (!server.name) {
          server.name = id
        }

        serversArray.push(server)
      }

      dispatch(setMCPServers(serversArray))

      window.message.success(t('settings.mcp.jsonSaveSuccess'))
      setJsonError('')
      setOpen(false)
    } catch (error: any) {
      logger.error('Failed to save JSON config:', error)
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
      maskClosable={false}
      width={800}
      height="80vh"
      loading={jsonSaving}
      transitionName="animation-move-down"
      centered>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Text type="secondary">
          {jsonError ? <span style={{ color: 'red' }}>{jsonError}</span> : ''}
        </Typography.Text>
      </div>
      {isLoading ? (
        <Spin size="large" />
      ) : (
        <CodeEditor
          value={jsonConfig}
          language="json"
          onChange={(value) => setJsonConfig(value)}
          height="60vh"
          expanded
          unwrapped={false}
          options={{
            lint: true,
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            keymap: true
          }}
        />
      )}
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
