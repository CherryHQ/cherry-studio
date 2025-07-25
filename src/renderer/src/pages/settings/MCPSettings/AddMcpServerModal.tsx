import { UploadOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import CodeEditor from '@renderer/components/CodeEditor'
import { useAppDispatch } from '@renderer/store'
import { setMCPServerActive } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
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

  // Update import method when initialImportMethod changes
  useEffect(() => {
    setImportMethod(initialImportMethod)
  }, [initialImportMethod])

  const handleOk = async () => {
    try {
      setLoading(true)

      if (importMethod === 'dxt') {
        if (!dxtFile) {
          window.message.error({
            content: t('settings.mcp.addServer.importFrom.noDxtFile'),
            key: 'mcp-no-dxt-file'
          })
          setLoading(false)
          return
        }

        // Process DXT file
        try {
          const result = await window.api.mcp.uploadDxt(dxtFile)

          if (!result.success) {
            window.message.error({
              content: result.error || t('settings.mcp.addServer.importFrom.dxtProcessFailed'),
              key: 'mcp-dxt-process-failed'
            })
            setLoading(false)
            return
          }

          const { manifest, extractDir } = result.data

          // Check for duplicate names
          if (existingServers && existingServers.some((server) => server.name === manifest.name)) {
            window.message.error({
              content: t('settings.mcp.addServer.importFrom.nameExists', { name: manifest.name }),
              key: 'mcp-name-exists'
            })
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
          setTimeout(() => {
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
          }, 1000) // Delay to ensure server is properly added to store
        } catch (error) {
          logger.error('DXT processing error:', error as Error)
          window.message.error({
            content: t('settings.mcp.addServer.importFrom.dxtProcessFailed'),
            key: 'mcp-dxt-error'
          })
          setLoading(false)
          return
        }
      } else {
        // Original JSON import logic
        const values = await form.validateFields()
        const inputValue = values.serverConfig.trim()

        const { serverToAdd, error } = parseAndExtractServer(inputValue, t)

        if (error) {
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
        if (existingServers && existingServers.some((server) => server.name === serverToAdd!.name)) {
          form.setFields([
            {
              name: 'serverConfig',
              errors: [t('settings.mcp.addServer.importFrom.nameExists', { name: serverToAdd!.name })]
            }
          ])
          setLoading(false)
          return
        }

        // 如果成功解析並通過所有檢查，立即加入伺服器（非啟用狀態）並關閉對話框
        const newServer: MCPServer = {
          id: nanoid(),
          ...serverToAdd!,
          name: serverToAdd!.name || t('settings.mcp.newServer'),
          baseUrl: serverToAdd!.baseUrl ?? serverToAdd!.url ?? '',
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
            window.message.error({
              content: t(`${newServer.name} settings.mcp.addServer.importFrom.connectionFailed`),
              key: 'mcp-quick-add-failed'
            })
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
      destroyOnClose
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
              maxHeight="300px"
              options={{
                lint: true,
                collapsible: true,
                wrappable: true,
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

// 解析 JSON 提取伺服器資料
const parseAndExtractServer = (
  inputValue: string,
  t: (key: string, options?: any) => string
): { serverToAdd: Partial<ParsedServerData> | null; error: string | null } => {
  const trimmedInput = inputValue.trim()

  let parsedJson
  try {
    parsedJson = JSON.parse(trimmedInput)
  } catch (e) {
    // JSON 解析失敗，返回錯誤
    return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.invalid') }
  }

  let serverToAdd: Partial<ParsedServerData> | null = null

  // 檢查是否包含多個伺服器配置 (適用於 JSON 格式)
  if (
    parsedJson.mcpServers &&
    typeof parsedJson.mcpServers === 'object' &&
    Object.keys(parsedJson.mcpServers).length > 1
  ) {
    return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.error.multipleServers') }
  } else if (Array.isArray(parsedJson) && parsedJson.length > 1) {
    return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.error.multipleServers') }
  }

  if (
    parsedJson.mcpServers &&
    typeof parsedJson.mcpServers === 'object' &&
    Object.keys(parsedJson.mcpServers).length > 0
  ) {
    // Case 1: {"mcpServers": {"serverName": {...}}}
    const firstServerKey = Object.keys(parsedJson.mcpServers)[0]
    const potentialServer = parsedJson.mcpServers[firstServerKey]
    if (typeof potentialServer === 'object' && potentialServer !== null) {
      serverToAdd = { ...potentialServer }
      serverToAdd!.name = potentialServer.name ?? firstServerKey
    } else {
      logger.error('Invalid server data under mcpServers key:', potentialServer)
      return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.invalid') }
    }
  } else if (Array.isArray(parsedJson) && parsedJson.length > 0) {
    // Case 2: [{...}, ...] - 取第一個伺服器，確保它是物件
    if (typeof parsedJson[0] === 'object' && parsedJson[0] !== null) {
      serverToAdd = { ...parsedJson[0] }
      serverToAdd!.name = parsedJson[0].name ?? t('settings.mcp.newServer')
    } else {
      logger.error('Invalid server data in array:', parsedJson[0])
      return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.invalid') }
    }
  } else if (
    typeof parsedJson === 'object' &&
    !Array.isArray(parsedJson) &&
    !parsedJson.mcpServers // 確保是直接的伺服器物件
  ) {
    // Case 3: {...} (單一伺服器物件)
    // 檢查物件是否為空
    if (Object.keys(parsedJson).length > 0) {
      serverToAdd = { ...parsedJson }
      serverToAdd!.name = parsedJson.name ?? t('settings.mcp.newServer')
    } else {
      // 空物件，視為無效
      serverToAdd = null
    }
  } else {
    // 無效結構或空的 mcpServers
    serverToAdd = null
  }

  // 確保 serverToAdd 存在且 name 存在
  if (!serverToAdd || !serverToAdd.name) {
    logger.error('Invalid JSON structure for server config or missing name:', parsedJson)
    return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.invalid') }
  }

  // Ensure tags is string[]
  if (
    serverToAdd.tags &&
    (!Array.isArray(serverToAdd.tags) || !serverToAdd.tags.every((tag) => typeof tag === 'string'))
  ) {
    logger.error('Tags must be an array of strings:', serverToAdd.tags)
    return { serverToAdd: null, error: t('settings.mcp.addServer.importFrom.invalid') }
  }

  return { serverToAdd, error: null }
}

export default AddMcpServerModal
