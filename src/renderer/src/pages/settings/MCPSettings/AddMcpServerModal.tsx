import { nanoid } from '@reduxjs/toolkit'
import { MCPServer } from '@renderer/types'
import { Form, Input, Modal } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface AddMcpServerModalProps {
  visible: boolean
  onClose: () => void
  onSuccess: (server: MCPServer) => void
  existingServers: MCPServer[] // 新增：現有的伺服器列表
}

const AddMcpServerModal: FC<AddMcpServerModalProps> = ({ visible, onClose, onSuccess, existingServers }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const inputValue = values.serverConfig.trim()
      setLoading(true)

      let parsedJson
      try {
        // 嘗試解析為 JSON
        parsedJson = JSON.parse(inputValue)
      } catch (e) {
        // 如果解析失敗，手動設定表單錯誤
        form.setFields([
          {
            name: 'serverConfig',
            errors: [t('settings.mcp.addServerQuickly.invalid')]
          }
        ])
        setLoading(false)
        return
      }

      let serverToAdd: Partial<MCPServer> | null = null

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
          if (!serverToAdd!.name) {
            serverToAdd!.name = firstServerKey
          }
        } else {
          console.error('Invalid server data under mcpServers key:', potentialServer)
          serverToAdd = null
        }
      } else if (Array.isArray(parsedJson) && parsedJson.length > 0) {
        // Case 2: [{...}, ...] - 取第一個伺服器，確保它是物件
        if (typeof parsedJson[0] === 'object' && parsedJson[0] !== null) {
          serverToAdd = { ...parsedJson[0] }
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
        serverToAdd = { ...parsedJson }
      } else {
        // 無效結構或空的 mcpServers
        serverToAdd = null
      }

      if (!serverToAdd) {
        // 如果因無效結構導致 serverToAdd 為 null
        console.error('Invalid JSON structure for server config:', parsedJson)
        form.setFields([
          {
            name: 'serverConfig',
            errors: [t('settings.mcp.addServerQuickly.invalid')]
          }
        ])
        setLoading(false)
        return
      }

      // 檢查重複名稱 (從 validator 移過來)
      const serverName = serverToAdd.name || t('settings.mcp.newServer')
      if (existingServers.some((server) => server.name === serverName)) {
        form.setFields([
          {
            name: 'serverConfig',
            errors: [t('settings.mcp.addServerQuickly.nameExists')]
          }
        ])
        setLoading(false)
        return
      }

      if (serverToAdd) {
        const newServer: MCPServer = {
          id: nanoid(),
          name: serverName, // 使用已驗證的 serverName
          description: serverToAdd.description || '',
          baseUrl: serverToAdd.baseUrl || '',
          command: serverToAdd.command || '',
          args: serverToAdd.args || [],
          env: serverToAdd.env || {},
          isActive: serverToAdd.isActive === undefined ? false : serverToAdd.isActive,
          type: serverToAdd.type,
          logoUrl: serverToAdd.logoUrl,
          provider: serverToAdd.provider,
          providerUrl: serverToAdd.providerUrl,
          tags: serverToAdd.tags,
          configSample: serverToAdd.configSample
        }
        // 使用 IPC 將伺服器資訊傳遞給主進程處理，或直接在渲染進程處理
        // 這裡我們假設直接在渲染進程新增，並透過 onSuccess 回呼
        onSuccess(newServer)
        form.resetFields()
        onClose()
      } else {
        // 如果 serverToAdd 為 null，表示解析 JSON 失敗或結構無效，錯誤已在驗證器中處理
        // window.message.error({ content: t('settings.mcp.addServerQuickly.invalid'), key: 'mcp-quick-add' })
      }
    } catch (errorInfo) {
      // form.validateFields() 失敗會進入這裡，通常是 required 規則未通過
      console.log('Validation Failed:', errorInfo)
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
          rules={[
            { required: true, message: t('settings.mcp.addServerQuickly.placeholder') }
            // 移除 validator 規則
          ]}>
          <Input.TextArea
            rows={6}
            placeholder={`// 示例: \n// { \n//   "mcpServers": { \n//     "example-server": { \n//       "command": "npx", \n//       "args": [ \n//         "-y", \n//         "mcp-server-example" \n//       ] \n//     } \n//   } \n// }`}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default AddMcpServerModal
