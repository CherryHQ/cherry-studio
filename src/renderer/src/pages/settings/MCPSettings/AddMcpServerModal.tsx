import { UploadOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import CodeEditor from '@renderer/components/CodeEditor'
import { useTimer } from '@renderer/hooks/useTimer'
import { useAppDispatch } from '@renderer/store'
import { setMCPServerActive } from '@renderer/store/mcp'
import { MCPServer, objectKeys, safeValidateMcpConfig } from '@renderer/types'
import { parseJSON } from '@renderer/utils'
import { formatZodError } from '@renderer/utils/error'
import { Button, Form, Modal, Upload } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AddMcpServerModal')

interface AddMcpServerModalProps {
  visible: boolean
  onClose: () => void
  onSuccess: (server: MCPServer) => void
  existingServers: MCPServer[]
  initialImportMethod?: 'json' | 'dxt'
}

interface ParsedServerData extends MCPServer {
  url?: string // JSON 可能包含此欄位，而不是 baseUrl
}

// 預設的 JSON 範例內容
const initialJsonExample = `// 示例 JSON (stdio):
// {
//   "mcpServers": {
//     "stdio-server-example": {
//       "command": "npx",
//       "args": ["-y", "mcp-server-example"]
//     }
//   }
// }

// 示例 JSON (sse):
// {
//   "mcpServers": {
//     "sse-server-example": {
//       "type": "sse",
//       "url": "http://localhost:3000"
//     }
//   }
// }

// 示例 JSON (streamableHttp):
// {
//   "mcpServers": {
//     "streamable-http-example": {
//       "type": "streamableHttp",
//       "url": "http://localhost:3001",
//       "headers": {
//         "Content-Type": "application/json",
//         "Authorization": "Bearer your-token"
//       }
//     }
//   }
// }
`

const AddMcpServerModal: FC<AddMcpServerModalProps> = ({
  visible,
  onClose,
  onSuccess,
  existingServers,
  initialImportMethod = 'json'
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [importMethod, setImportMethod] = useState<'json' | 'dxt'>(initialImportMethod)
  const [dxtFile, setDxtFile] = useState<File | null>(null)
  const dispatch = useAppDispatch()
  const { setTimeoutTimer } = useTimer()

  // Update import method when initialImportMethod changes
  useEffect(() => {
    setImportMethod(initialImportMethod)
  }, [initialImportMethod])

  /**
   * 从JSON字符串中解析MCP服务器配置
   * @param inputValue - JSON格式的服务器配置字符串
   * @returns 包含解析后的服务器配置和可能的错误信息的对象
   * - serverToAdd: 解析成功时返回服务器配置对象，失败时返回null
   * - error: 解析失败时返回错误信息，成功时返回null
   */
  const getServerFromJson = (
    inputValue: string
  ): { serverToAdd: Partial<ParsedServerData>; error: null } | { serverToAdd: null; error: string } => {
    const trimmedInput = inputValue.trim()
    const parsedJson = parseJSON(trimmedInput)
    if (parsedJson === null) {
      logger.error('Failed to parse json.', { input: trimmedInput })
      return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.invalid') }
    }

    const { data: validConfig, error } = safeValidateMcpConfig(parsedJson)
    if (error) {
      logger.error('Failed to validate json.', { parsedJson, error })
      return { serverToAdd: null, error: formatZodError(error, t('settings.mcp.addServer.importFrom.invalid')) }
    }

    let serverToAdd: Partial<ParsedServerData> | null = null

    if (objectKeys(validConfig.mcpServers).length > 1) {
      return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.error.multipleServers') }
    }

    if (objectKeys(validConfig.mcpServers).length > 0) {
      const key = objectKeys(validConfig.mcpServers)[0]
      serverToAdd = validConfig.mcpServers[key]
      if (!serverToAdd.name) {
        serverToAdd.name = key
      }
    } else {
      return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.invalid') }
    }

    // zod 太好用了你们知道吗
    return { serverToAdd, error: null }
  }

  const handleOk = async () => {
    try {
      setLoading(true)

      if (importMethod === 'dxt') {
        if (!dxtFile) {
          window.toast.error(t('settings.mcp.addServer.importFrom.noDxtFile'))
          setLoading(false)
          return
        }

        // Process DXT file
        try {
          const result = await window.api.mcp.uploadDxt(dxtFile)

          if (!result.success) {
            window.toast.error(result.error || t('settings.mcp.addServer.importFrom.dxtProcessFailed'))
            setLoading(false)
            return
          }

          const { manifest, extractDir } = result.data

          // Check for duplicate names
          if (existingServers && existingServers.some((server) => server.name === manifest.name)) {
            window.toast.error(t('settings.mcp.addServer.importFrom.nameExists', { name: manifest.name }))
            setLoading(false)
            return
          }

          // Process args with variable substitution
          const processedArgs = manifest.server.mcp_config.args
            .map((arg) => {
              // Replace ${__dirname} with the extraction directory
              let processedArg = arg.replace(/\$\{__dirname\}/g, extractDir)

              // For now, remove user_config variables and their values
              processedArg = processedArg.replace(/--[^=]*=\$\{user_config\.[^}]+\}/g, '')

              return processedArg.trim()
            })
            .filter((arg) => arg.trim() !== '' && arg !== '--' && arg !== '=' && !arg.startsWith('--='))

          logger.debug('Processed DXT args:', processedArgs)

          // Create MCPServer from DXT manifest
          const newServer: MCPServer = {
            id: nanoid(),
            name: manifest.display_name || manifest.name,
            description: manifest.description || manifest.long_description || '',
            baseUrl: '',
            command: manifest.server.mcp_config.command,
            args: processedArgs,
            env: manifest.server.mcp_config.env || {},
            isActive: false,
            type: 'stdio',
            // Add DXT-specific metadata
            dxtVersion: manifest.dxt_version,
            dxtPath: extractDir,
            // Add additional metadata from manifest
            logoUrl: manifest.icon ? `${extractDir}/${manifest.icon}` : undefined,
            provider: manifest.author?.name,
            providerUrl: manifest.homepage || manifest.repository?.url,
            tags: manifest.keywords
          }

          onSuccess(newServer)
          form.resetFields()
          setDxtFile(null)
          onClose()

          // Check server connectivity in background (with timeout)
          setTimeoutTimer(
            'handleOk',
            () => {
              window.api.mcp
                .checkMcpConnectivity(newServer)
                .then((isConnected) => {
                  logger.debug(`Connectivity check for ${newServer.name}: ${isConnected}`)
                  dispatch(setMCPServerActive({ id: newServer.id, isActive: isConnected }))
                })
                .catch((connError: any) => {
                  logger.error(`Connectivity check failed for ${newServer.name}:`, connError)
                  // Don't show error for DXT servers as they might need additional setup
                  logger.warn(
                    `DXT server ${newServer.name} connectivity check failed, this is normal for servers requiring additional configuration`
                  )
                })
            },
            1000
          ) // Delay to ensure server is properly added to store
        } catch (error) {
          logger.error('DXT processing error:', error as Error)
          window.toast.error(t('settings.mcp.addServer.importFrom.dxtProcessFailed'))
          setLoading(false)
          return
        }
      } else {
        // Original JSON import logic
        const values = await form.validateFields()
        const inputValue = values.serverConfig.trim()

        const { serverToAdd, error } = getServerFromJson(inputValue)

        if (error !== null) {
          form.setFields([
            {
              name: 'serverConfig',
              errors: [error]
            }
          ])
          setLoading(false)
          return
        }

        // 檢查重複名稱
        if (existingServers && existingServers.some((server) => server.name === serverToAdd.name)) {
          form.setFields([
            {
              name: 'serverConfig',
              errors: [t('settings.mcp.addServer.importFrom.nameExists', { name: serverToAdd.name })]
            }
          ])
          setLoading(false)
          return
        }

        // 如果成功解析並通過所有檢查，立即加入伺服器（非啟用狀態）並關閉對話框
        const newServer: MCPServer = {
          id: nanoid(),
          ...serverToAdd,
          name: serverToAdd.name || t('settings.mcp.newServer'),
          baseUrl: serverToAdd.baseUrl ?? serverToAdd.url ?? '',
          isActive: false // 初始狀態為非啟用
        }

        onSuccess(newServer)
        form.resetFields()
        onClose()

        // 在背景非同步檢查伺服器可用性並更新狀態
        window.api.mcp
          .checkMcpConnectivity(newServer)
          .then((isConnected) => {
            logger.debug(`Connectivity check for ${newServer.name}: ${isConnected}`)
            dispatch(setMCPServerActive({ id: newServer.id, isActive: isConnected }))
          })
          .catch((connError: any) => {
            logger.error(`Connectivity check failed for ${newServer.name}:`, connError)
            window.toast.error(newServer.name + t('settings.mcp.addServer.importFrom.connectionFailed'))
          })
      }
    } finally {
      setLoading(false)
    }
  }

  // CodeEditor 內容變更時的回呼函式
  const handleEditorChange = useCallback(
    (newContent: string) => {
      form.setFieldsValue({ serverConfig: newContent })
      // 可選：如果希望即時驗證，可以取消註解下一行
      // form.validateFields(['serverConfig']);
    },
    [form]
  )

  const serverConfigValue = form.getFieldValue('serverConfig')

  return (
    <Modal
      title={
        importMethod === 'dxt'
          ? t('settings.mcp.addServer.importFrom.dxt')
          : t('settings.mcp.addServer.importFrom.json')
      }
      open={visible}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields()
        setDxtFile(null)
        setImportMethod(initialImportMethod)
        onClose()
      }}
      confirmLoading={loading}
      destroyOnHidden
      centered
      transitionName="animation-move-down"
      width={600}>
      <Form form={form} layout="vertical" name="add_mcp_server_form">
        {importMethod === 'json' ? (
          <Form.Item
            name="serverConfig"
            label={t('settings.mcp.addServer.importFrom.tooltip')}
            rules={[{ required: true, message: t('settings.mcp.addServer.importFrom.placeholder') }]}>
            <CodeEditor
              // 如果表單值為空，顯示範例 JSON；否則顯示表單值
              value={serverConfigValue}
              placeholder={initialJsonExample}
              language="json"
              onChange={handleEditorChange}
              height="60vh"
              expanded={false}
              wrapped
              options={{
                lint: true,
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                keymap: true
              }}
            />
          </Form.Item>
        ) : (
          <Form.Item
            label={t('settings.mcp.addServer.importFrom.dxtFile')}
            help={t('settings.mcp.addServer.importFrom.dxtHelp')}>
            <Upload
              accept=".dxt"
              maxCount={1}
              beforeUpload={(file) => {
                setDxtFile(file)
                return false // Prevent automatic upload
              }}
              onRemove={() => setDxtFile(null)}
              fileList={dxtFile ? [{ uid: '-1', name: dxtFile.name, status: 'done' } as any] : []}>
              <Button icon={<UploadOutlined />}>{t('settings.mcp.addServer.importFrom.selectDxtFile')}</Button>
            </Upload>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

export default AddMcpServerModal
