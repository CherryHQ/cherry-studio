/**
 * Chrome Extension Background Service Worker
 *
 * Handles:
 * - MCP server connections (HTTP/SSE only)
 * - Context menu actions
 * - Keyboard shortcuts
 * - Storage sync
 */

// MCP client connections (HTTP/SSE only - no stdio in extensions)
const mcpClients = new Map<string, { url: string; transport: 'sse' | 'http' }>()

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  // Create context menus
  chrome.contextMenus.create({
    id: 'cherry-ask',
    title: 'Ask Cherry Studio',
    contexts: ['selection']
  })

  chrome.contextMenus.create({
    id: 'cherry-explain',
    title: 'Explain with AI',
    contexts: ['selection']
  })

  chrome.contextMenus.create({
    id: 'cherry-translate',
    title: 'Translate',
    contexts: ['selection']
  })

  chrome.contextMenus.create({
    id: 'cherry-summarize',
    title: 'Summarize Page',
    contexts: ['page']
  })

  // Set side panel behavior
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id
  if (!tabId) return

  const actionMap: Record<string, string> = {
    'cherry-ask': 'ask',
    'cherry-explain': 'explain',
    'cherry-translate': 'translate',
    'cherry-summarize': 'summarize'
  }

  const action = actionMap[info.menuItemId as string]
  if (!action) return

  // Store the pending action
  await chrome.storage.session.set({
    pendingAction: {
      type: action,
      text: info.selectionText || '',
      url: info.pageUrl,
      title: tab?.title
    }
  })

  // Open side panel
  chrome.sidePanel.open({ tabId })
})

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open_side_panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id })
    }
  }
})

// Message handler for renderer communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error('Message handler error:', error)
      sendResponse({ error: error.message })
    })
  return true // Keep channel open for async response
})

interface Message {
  type: string
  payload?: unknown
}

async function handleMessage(message: Message, _sender: chrome.runtime.MessageSender): Promise<unknown> {
  const { type, payload } = message

  switch (type) {
    // Storage operations
    case 'storage:get': {
      const { key } = payload as { key: string }
      const result = await chrome.storage.local.get(key)
      return result[key]
    }

    case 'storage:set': {
      const { key, value } = payload as { key: string; value: unknown }
      await chrome.storage.local.set({ [key]: value })
      return { success: true }
    }

    // MCP operations (HTTP/SSE only)
    case 'mcp:connect': {
      const server = payload as { id: string; url: string; transport: 'sse' | 'http' }
      if (server.transport === 'stdio') {
        return { error: 'stdio transport not supported in Chrome extension' }
      }
      mcpClients.set(server.id, { url: server.url, transport: server.transport || 'http' })
      return { success: true }
    }

    case 'mcp:disconnect': {
      const { serverId } = payload as { serverId: string }
      mcpClients.delete(serverId)
      return { success: true }
    }

    case 'mcp:listTools': {
      const { serverId } = payload as { serverId: string }
      const client = mcpClients.get(serverId)
      if (!client) {
        return { error: 'Server not connected' }
      }

      try {
        const response = await fetch(`${client.url}/tools/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: Date.now() })
        })
        const data = await response.json()
        return data.result?.tools || []
      } catch (error) {
        return { error: (error as Error).message }
      }
    }

    case 'mcp:callTool': {
      const { serverId, name, args } = payload as { serverId: string; name: string; args: unknown }
      const client = mcpClients.get(serverId)
      if (!client) {
        return { error: 'Server not connected' }
      }

      try {
        const response = await fetch(`${client.url}/tools/call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name, arguments: args },
            id: Date.now()
          })
        })
        const data = await response.json()
        return data.result
      } catch (error) {
        return { error: (error as Error).message }
      }
    }

    // Backup operations
    case 'backup:webdav': {
      const { action, config, data, fileName } = payload as {
        action: string
        config: { url: string; username: string; password: string; path?: string }
        data?: string
        fileName?: string
      }

      const auth = btoa(`${config.username}:${config.password}`)
      const headers = { Authorization: `Basic ${auth}` }
      const basePath = config.path || '/cherry-studio'

      switch (action) {
        case 'check':
          try {
            const response = await fetch(`${config.url}${basePath}`, {
              method: 'PROPFIND',
              headers: { ...headers, Depth: '0' }
            })
            return { connected: response.ok }
          } catch {
            return { connected: false }
          }

        case 'backup':
          if (!data) return { error: 'No data provided' }
          try {
            const fileName = `backup-${Date.now()}.json`
            await fetch(`${config.url}${basePath}/${fileName}`, {
              method: 'PUT',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: data
            })
            return { success: true, fileName }
          } catch (error) {
            return { error: (error as Error).message }
          }

        case 'restore':
          try {
            const listResponse = await fetch(`${config.url}${basePath}`, {
              method: 'PROPFIND',
              headers: { ...headers, Depth: '1' }
            })
            const listText = await listResponse.text()
            // Parse WebDAV response to get latest file
            const files = listText.match(/backup-\d+\.json/g) || []
            if (files.length === 0) return { error: 'No backups found' }

            const latestFile = files.sort().pop()
            const dataResponse = await fetch(`${config.url}${basePath}/${latestFile}`, { headers })
            return dataResponse.text()
          } catch (error) {
            return { error: (error as Error).message }
          }

        case 'list':
          try {
            const response = await fetch(`${config.url}${basePath}`, {
              method: 'PROPFIND',
              headers: { ...headers, Depth: '1' }
            })
            const text = await response.text()
            const files = text.match(/backup-\d+\.json/g) || []
            return files.map((name) => ({ name, path: `${basePath}/${name}` }))
          } catch {
            return []
          }

        case 'delete':
          if (!fileName) return { error: 'No filename provided' }
          try {
            await fetch(`${config.url}${basePath}/${fileName}`, {
              method: 'DELETE',
              headers
            })
            return { success: true }
          } catch (error) {
            return { error: (error as Error).message }
          }

        default:
          return { error: 'Unknown action' }
      }
    }

    case 'backup:s3': {
      // S3 operations would need AWS SDK or direct API calls
      // For MVP, return not implemented
      return { error: 'S3 backup not yet implemented in extension' }
    }

    // Config operations
    case 'config:get': {
      const { key } = payload as { key: string }
      const result = await chrome.storage.local.get(`config:${key}`)
      return result[`config:${key}`]
    }

    case 'config:set': {
      const { key, value } = payload as { key: string; value: unknown }
      await chrome.storage.local.set({ [`config:${key}`]: value })
      return { success: true }
    }

    default:
      console.warn('Unknown message type:', type)
      return { error: `Unknown message type: ${type}` }
  }
}

// Keep service worker alive with periodic alarm
chrome.alarms.create('keepAlive', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Just checking - keeps service worker active
  }
})

console.log('Cherry Studio extension background loaded')
