// src/renderer/src/utils/remember-utils.ts
import { MCPServer } from '@renderer/types'

export async function getRememberedMemories(mcpServers: MCPServer[]): Promise<string> {
  try {
    // 查找simpleremember服务器
    const rememberServer = mcpServers.find((server) => server.name === '@cherry/simpleremember' && server.isActive)

    if (!rememberServer) {
      console.log('[SimpleRemember] Server not found or not active')
      return ''
    }

    console.log('[SimpleRemember] Found server:', rememberServer.name, 'isActive:', rememberServer.isActive)

    // 调用get_memories工具
    try {
      console.log('[SimpleRemember] Calling get_memories tool...')
      const response = await window.api.mcp.callTool({
        server: rememberServer,
        name: 'get_memories',
        args: {}
      })

      console.log('[SimpleRemember] get_memories response:', response)

      if (response.isError) {
        console.error('[SimpleRemember] Error getting memories:', response)
        return ''
      }

      // 解析记忆
      // 根据MCP规范，工具返回的是content数组，而不是data
      let memories = []
      if (response.content && response.content.length > 0 && response.content[0].text) {
        try {
          memories = JSON.parse(response.content[0].text)
        } catch (parseError) {
          console.error('[SimpleRemember] Failed to parse memories JSON:', parseError)
          return ''
        }
      } else if (response.data) {
        // 兼容旧版本的返回格式
        memories = response.data
      }

      console.log('[SimpleRemember] Parsed memories:', memories)

      if (!Array.isArray(memories) || memories.length === 0) {
        console.log('[SimpleRemember] No memories found or invalid format')
        return ''
      }

      // 构建记忆提示词
      // Add explicit type for memory item in map function
      const memoryPrompt = memories.map((memory: { content: string }) => `- ${memory.content}`).join('\n')
      console.log('[SimpleRemember] Generated memory prompt:', memoryPrompt)

      return `\n\n用户的记忆:\n${memoryPrompt}`
    } catch (toolError) {
      console.error('[SimpleRemember] Error calling get_memories tool:', toolError)
      return ''
    }
  } catch (error) {
    console.error('[SimpleRemember] Error in getRememberedMemories:', error)
    return ''
  }
}
