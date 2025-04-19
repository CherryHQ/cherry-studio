const http = require('http')
const WebSocket = require('ws')
const express = require('express')
const path = require('path') // Need path module

const app = express()
const port = 34515 // Define the port

// 获取index.html文件的路径
function getIndexHtmlPath() {
  // 在开发环境中，直接使用相对路径
  const devPath = path.join(__dirname, 'index.html')

  // 在pkg打包后，文件会被包含在可执行文件中
  // 使用process.pkg检测是否是打包环境
  if (process.pkg) {
    // 在打包环境中，使用绝对路径
    return path.join(path.dirname(process.execPath), 'index.html')
  }

  // 如果文件存在，返回开发路径
  try {
    if (require('fs').existsSync(devPath)) {
      return devPath
    }
  } catch (e) {
    console.error('Error checking file existence:', e)
  }

  // 如果都不存在，尝试使用当前目录
  return path.join(process.cwd(), 'index.html')
}

// 提供网页给浏览器
app.get('/', (req, res) => {
  const indexPath = getIndexHtmlPath()
  console.log(`Serving index.html from: ${indexPath}`)
  res.sendFile(indexPath)
})

const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

let browserConnection = null
let electronConnection = null

wss.on('connection', (ws) => {
  console.log('[Server] WebSocket client connected') // Add log

  ws.on('message', (message) => {
    let data
    try {
      // Ensure message is treated as string before parsing
      data = JSON.parse(message.toString())
      console.log('[Server] Received message:', data) // Log parsed data
    } catch (e) {
      console.error('[Server] Failed to parse message or message is not JSON:', message.toString(), e)
      return // Ignore non-JSON messages
    }

    // 识别客户端类型
    if (data.type === 'identify') {
      if (data.role === 'browser') {
        browserConnection = ws
        console.log('[Server] Browser identified and connected')
        // Notify Electron that the browser is ready
        if (electronConnection && electronConnection.readyState === WebSocket.OPEN) {
          electronConnection.send(JSON.stringify({ type: 'status', message: 'browser_ready' }))
          console.log('[Server] Sent browser_ready status to Electron')
        }
        // Notify Electron if it's already connected
        if (electronConnection) {
          electronConnection.send(JSON.stringify({ type: 'status', message: 'Browser connected' }))
        }
        ws.on('close', () => {
          console.log('[Server] Browser disconnected')
          browserConnection = null
          // Notify Electron
          if (electronConnection) {
            electronConnection.send(JSON.stringify({ type: 'status', message: 'Browser disconnected' }))
          }
        })
        ws.on('error', (error) => {
          console.error('[Server] Browser WebSocket error:', error)
          browserConnection = null // Assume disconnected on error
          if (electronConnection) {
            electronConnection.send(JSON.stringify({ type: 'status', message: 'Browser connection error' }))
          }
        })
      } else if (data.role === 'electron') {
        electronConnection = ws
        console.log('[Server] Electron identified and connected')
        // If browser is already connected when Electron connects, notify Electron immediately
        if (browserConnection && browserConnection.readyState === WebSocket.OPEN) {
          electronConnection.send(JSON.stringify({ type: 'status', message: 'browser_ready' }))
          console.log('[Server] Sent initial browser_ready status to Electron')
        }
        ws.on('close', () => {
          console.log('[Server] Electron disconnected')
          electronConnection = null
          // Maybe send stop to browser if electron disconnects?
          // if (browserConnection) browserConnection.send(JSON.stringify({ type: 'stop' }));
        })
        ws.on('error', (error) => {
          console.error('[Server] Electron WebSocket error:', error)
          electronConnection = null // Assume disconnected on error
        })
      }
    }
    // Electron 控制开始/停止
    else if (data.type === 'start' && ws === electronConnection) {
      if (browserConnection && browserConnection.readyState === WebSocket.OPEN) {
        console.log('[Server] Relaying START command to browser')
        browserConnection.send(JSON.stringify({ type: 'start' }))
      } else {
        console.log('[Server] Cannot relay START: Browser not connected')
        // Optionally notify Electron back
        electronConnection.send(JSON.stringify({ type: 'error', message: 'Browser not connected for ASR' }))
      }
    } else if (data.type === 'stop' && ws === electronConnection) {
      if (browserConnection && browserConnection.readyState === WebSocket.OPEN) {
        console.log('[Server] Relaying STOP command to browser')
        browserConnection.send(JSON.stringify({ type: 'stop' }))
      } else {
        console.log('[Server] Cannot relay STOP: Browser not connected')
      }
    } else if (data.type === 'reset' && ws === electronConnection) {
      if (browserConnection && browserConnection.readyState === WebSocket.OPEN) {
        console.log('[Server] Relaying RESET command to browser')
        browserConnection.send(JSON.stringify({ type: 'reset' }))
      } else {
        console.log('[Server] Cannot relay RESET: Browser not connected')
      }
    }
    // 浏览器发送识别结果
    else if (data.type === 'result' && ws === browserConnection) {
      if (electronConnection && electronConnection.readyState === WebSocket.OPEN) {
        // console.log('[Server] Relaying RESULT to Electron:', data.data); // Log less frequently if needed
        electronConnection.send(JSON.stringify({ type: 'result', data: data.data }))
      } else {
        // console.log('[Server] Cannot relay RESULT: Electron not connected');
      }
    }
    // 浏览器发送状态更新 (例如 'stopped')
    else if (data.type === 'status' && ws === browserConnection) {
      if (electronConnection && electronConnection.readyState === WebSocket.OPEN) {
        console.log('[Server] Relaying STATUS to Electron:', data.message) // Log status being relayed
        electronConnection.send(JSON.stringify({ type: 'status', message: data.message }))
      } else {
        console.log('[Server] Cannot relay STATUS: Electron not connected')
      }
    } else {
      console.log('[Server] Received unknown message type or from unknown source:', data)
    }
  })

  ws.on('error', (error) => {
    // Generic error handling for connection before identification
    console.error('[Server] Initial WebSocket connection error:', error)
    // Attempt to clean up based on which connection it might be (if identified)
    if (ws === browserConnection) {
      browserConnection = null
      if (electronConnection)
        electronConnection.send(JSON.stringify({ type: 'status', message: 'Browser connection error' }))
    } else if (ws === electronConnection) {
      electronConnection = null
    }
  })
})

server.listen(port, () => {
  console.log(`[Server] Server running at http://localhost:${port}`)
})

// Handle server errors
server.on('error', (error) => {
  console.error(`[Server] Failed to start server:`, error)
  process.exit(1) // Exit if server fails to start
})
