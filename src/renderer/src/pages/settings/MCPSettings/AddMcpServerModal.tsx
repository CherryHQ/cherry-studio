import { nanoid } from '@reduxjs/toolkit'
import { useAppDispatch } from '@renderer/store'
import { setMCPServerActive } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { Form, Input, Modal } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface AddMcpServerModalProps {
  visible: boolean
  onClose: () => void
  onSuccess: (server: MCPServer) => void
  existingServers: MCPServer[]
}

const AddMcpServerModal: FC<AddMcpServerModalProps> = ({ visible, onClose, onSuccess, existingServers }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const dispatch = useAppDispatch()
  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const inputValue = values.serverConfig.trim()
      setLoading(true)

      // 將 JSON 解析邏輯提取
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
      if (serverToAdd && existingServers.some((server) => server.name === serverToAdd.name)) {
        form.setFields([
          {
            name: 'serverConfig',
            errors: [t('settings.mcp.addServerQuickly.nameExists', { name: serverToAdd.name })]
          }
        ])
        setLoading(false)
        return
      }

      // 如果成功解析並通過重複檢查，立即加入伺服器（非啟用狀態）並關閉對話框
      if (serverToAdd) {
        const newServer: MCPServer = {
          id: nanoid(),
          name: serverToAdd.name!,
          description: serverToAdd.description || '',
          baseUrl: serverToAdd.baseUrl || serverToAdd.url || '',
          command: serverToAdd.command || '',
          args: serverToAdd.args || [],
          env: serverToAdd.env || {},
          isActive: false,
          type: serverToAdd.type,
          logoUrl: serverToAdd.logoUrl,
          provider: serverToAdd.provider,
          providerUrl: serverToAdd.providerUrl,
          tags: serverToAdd.tags,
          configSample: serverToAdd.configSample
        }

        onSuccess(newServer)
        form.resetFields()
        onClose()

        // 在背景非同步檢查伺服器可用性並更新狀態
        // 將 serverToAdd 改為 newServer，確保傳遞完整的伺服器物件給後端
        window.api.mcp
          .checkMcpConnectivity(newServer)
          .then((isConnected) => {
            console.log(`Connectivity check for ${newServer.name}: ${isConnected}`)
            dispatch(setMCPServerActive({ id: newServer.id, isActive: isConnected }))
          })
          .catch((connError: any) => {
            console.error(`Connectivity check failed for ${newServer.name}:`, connError)
            window.message.error({
              content: t(`${newServer.name} settings.mcp.addServerQuickly.connectionFailed`),
              key: 'mcp-quick-add-failed'
            })
          })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={t('settings.mcp.addServerQuickly')}
      open={visible}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnClose
      width={600}>
      <Form form={form} layout="vertical" name="add_mcp_server_form">
        <Form.Item
          name="serverConfig"
          label={t('settings.mcp.addServerQuickly.tooltip')}
          rules={[{ required: true, message: t('settings.mcp.addServerQuickly.placeholder') }]}>
          <Input.TextArea
            rows={10}
            placeholder={`// 示例 JSON (stdio):
// {
//   "mcpServers": {
//     "stdio-server-example": {
//       "type": "stdio",
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
//       "url": "http://localhost:3001"
//     }
//   }
// }
`}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// 解析 JSON 提取伺服器資料
const parseAndExtractServer = (
  inputValue: string,
  t: (key: string, options?: any) => string
): { serverToAdd: Partial<MCPServer> | null; error: string | null } => {
  const validTypes: MCPServer['type'][] = ['stdio', 'sse', 'streamableHttp']
  const trimmedInput = inputValue.trim()

  // 1. 嘗試解析為 SSE
  if (trimmedInput.startsWith('data:')) {
    const lines = trimmedInput.split('\n')
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const sseData = line.substring(5).trim() // 提取 data: 後的內容
        if (sseData) {
          try {
            const parsedJson = JSON.parse(sseData)
            if (typeof parsedJson === 'object' && parsedJson !== null && Object.keys(parsedJson).length > 0) {
              const serverToAdd: Partial<MCPServer> = { ...parsedJson }
              serverToAdd.name = parsedJson.name || t('settings.mcp.newServer')
              if (!parsedJson.type || !validTypes.includes(parsedJson.type as MCPServer['type'])) {
                return {
                  serverToAdd: null,
                  error: t('settings.mcp.addServerQuickly.invalidType', { type: parsedJson.type ?? 'undefined' })
                }
              }
              serverToAdd.type = parsedJson.type as MCPServer['type']

              if (serverToAdd.name) {
                return { serverToAdd, error: null }
              }
            }
          } catch (e) {
            console.warn('Failed to parse SSE data line as JSON:', sseData, e)
          }
        }
      }
    }
    return { serverToAdd: null, error: t('settings.mcp.addServerQuickly.invalid') }
  }

  // 2. 如果不是 SSE，則嘗試解析為 STDIO
  let parsedJson
  try {
    parsedJson = JSON.parse(trimmedInput)
  } catch (e) {
    return { serverToAdd: null, error: t('settings.mcp.addServerQuickly.invalid') }
  }

  let serverToAdd: Partial<MCPServer> | null = null

  // 檢查是否包含多個伺服器配置 (適用於 JSON 格式)
  if (
    parsedJson.mcpServers &&
    typeof parsedJson.mcpServers === 'object' &&
    Object.keys(parsedJson.mcpServers).length > 1
  ) {
    return { serverToAdd: null, error: t('settings.mcp.addServerQuickly.multipleServers') }
  } else if (Array.isArray(parsedJson) && parsedJson.length > 1) {
    return { serverToAdd: null, error: t('settings.mcp.addServerQuickly.multipleServers') }
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
      // 確保名稱被設定，優先使用 JSON 中的名稱，否則使用 key
      serverToAdd!.name = potentialServer.name || firstServerKey
      // 檢查 type 欄位
      if (!potentialServer.type || !validTypes.includes(potentialServer.type as MCPServer['type'])) {
        return {
          serverToAdd: null,
          error: t('settings.mcp.addServerQuickly.invalidType', { type: potentialServer.type || 'undefined' })
        }
      }
      serverToAdd!.type = potentialServer.type as MCPServer['type']
    } else {
      console.error('Invalid server data under mcpServers key:', potentialServer)
      serverToAdd = null
    }
  } else if (Array.isArray(parsedJson) && parsedJson.length > 0) {
    // Case 2: [{...}, ...] - 取第一個伺服器，確保它是物件
    if (typeof parsedJson[0] === 'object' && parsedJson[0] !== null) {
      serverToAdd = { ...parsedJson[0] }
      // 確保名稱被設定，優先使用 JSON 中的名稱，否則使用預設名稱
      serverToAdd!.name = parsedJson[0].name || t('settings.mcp.newServer')
      // 檢查 type 欄位
      if (!parsedJson[0].type || !validTypes.includes(parsedJson[0].type as MCPServer['type'])) {
        return {
          serverToAdd: null,
          error: t('settings.mcp.addServerQuickly.invalidType', { type: parsedJson[0].type || 'undefined' })
        }
      }
      serverToAdd!.type = parsedJson[0].type as MCPServer['type']
    } else {
      console.error('Invalid server data in array:', parsedJson[0])
      serverToAdd = null
    }
  } else if (
    typeof parsedJson === 'object' &&
    parsedJson !== null &&
    !Array.isArray(parsedJson) &&
    !parsedJson.mcpServers // 確保是直接的伺服器物件
  ) {
    // Case 3: {...} (單一伺服器物件)
    // 檢查物件是否為空
    if (Object.keys(parsedJson).length > 0) {
      serverToAdd = { ...parsedJson }
      serverToAdd!.name = parsedJson.name || t('settings.mcp.newServer')
      // 檢查 type 欄位
      if (!parsedJson.type || !validTypes.includes(parsedJson.type as MCPServer['type'])) {
        return {
          serverToAdd: null,
          error: t('settings.mcp.addServerQuickly.invalidType', { type: parsedJson.type || 'undefined' })
        }
      }
      serverToAdd!.type = parsedJson.type as MCPServer['type']
    } else {
      serverToAdd = null
    }
  } else {
    // 無效結構或空的 mcpServers
    serverToAdd = null
  }

  // 最終檢查 serverToAdd 是否有效 (例如至少有名稱)
  if (!serverToAdd || !serverToAdd.name) {
    console.error('Invalid JSON structure for server config or missing name:', parsedJson)
    return { serverToAdd: null, error: t('settings.mcp.addServerQuickly.invalid') }
  }
  // 確保 type 已被設定 (先前的檢查應該已保證，如果 serverToAdd 不是 null)
  if (!serverToAdd.type) {
    // 此檢查主要用於防禦，理論上 type 應該已經在前面被設定或因無效而返回
    console.error('Server object created without a type, this should not happen:', serverToAdd)
    return { serverToAdd: null, error: t('settings.mcp.addServerQuickly.invalid') }
  }

  return { serverToAdd, error: null }
}

export default AddMcpServerModal
