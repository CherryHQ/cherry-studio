// 检查依赖项
try {
  console.log('ASR Server starting...')
  console.log('Node.js version:', process.version)
  console.log('Current directory:', __dirname)
  console.log('Current working directory:', process.cwd())
  console.log('Command line arguments:', process.argv)

  // 检查必要的依赖项
  const checkDependency = (name) => {
    try {
      require(name) // Removed unused variable 'module'
      console.log(`Successfully loaded dependency: ${name}`)
      return true
    } catch (error) {
      console.error(`Failed to load dependency: ${name}`, error.message)
      return false
    }
  }

  // 检查所有必要的依赖项
  const dependencies = ['http', 'ws', 'express', 'path', 'fs']
  const missingDeps = dependencies.filter((dep) => !checkDependency(dep))

  if (missingDeps.length > 0) {
    console.error(`Missing dependencies: ${missingDeps.join(', ')}. Server cannot start.`)
    process.exit(1)
  }
} catch (error) {
  console.error('Error during dependency check:', error)
  process.exit(1)
}

// 加载依赖项
const http = require('http')
const WebSocket = require('ws')
const express = require('express')
const path = require('path') // Need path module
// const fs = require('fs') // Commented out unused import 'fs'

const app = express()
const port = 34515 // Define the port

// 获取index.html文件的路径
function getIndexHtmlPath() {
  const fs = require('fs')
  console.log('Current directory:', __dirname)
  console.log('Current working directory:', process.cwd())

  // 尝试多个可能的路径
  const possiblePaths = [
    // 开发环境路径
    path.join(__dirname, 'index.html'),
    // 当前目录
    path.join(process.cwd(), 'index.html'),
    // 相对于可执行文件的路径
    path.join(path.dirname(process.execPath), 'index.html'),
    // 相对于可执行文件的上级目录的路径
    path.join(path.dirname(path.dirname(process.execPath)), 'index.html'),
    // 相对于可执行文件的resources目录的路径
    path.join(path.dirname(process.execPath), 'resources', 'index.html'),
    // 相对于可执行文件的resources/asr-server目录的路径
    path.join(path.dirname(process.execPath), 'resources', 'asr-server', 'index.html'),
    // 相对于可执行文件的asr-server目录的路径
    path.join(path.dirname(process.execPath), 'asr-server', 'index.html'),
    // 如果是pkg打包环境
    process.pkg ? path.join(path.dirname(process.execPath), 'index.html') : null
  ].filter(Boolean) // 过滤掉null值

  console.log('Possible index.html paths:', possiblePaths)

  // 检查每个路径，返回第一个存在的文件
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        console.log(`Found index.html at: ${p}`)
        return p
      }
    } catch (e) {
      console.error(`Error checking existence of ${p}:`, e)
    }
  }

  // 如果没有找到文件，返回默认路径并记录错误
  console.error('Could not find index.html in any of the expected locations')
  return path.join(__dirname, 'index.html') // 返回默认路径，即使它可能不存在
}

// 提供网页给浏览器
app.get('/', (req, res) => {
  try {
    const indexPath = getIndexHtmlPath()
    console.log(`Serving index.html from: ${indexPath}`)

    // 检查文件是否存在
    const fs = require('fs')
    if (!fs.existsSync(indexPath)) {
      console.error(`Error: index.html not found at ${indexPath}`)
      return res.status(404).send(`Error: index.html not found at ${indexPath}. <br>Please check the server logs.`)
    }

    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('Error sending index.html:', err)
        res.status(500).send(`Error serving index.html: ${err.message}`)
      }
    })
  } catch (error) {
    console.error('Error in route handler:', error)
    res.status(500).send(`Server error: ${error.message}`)
  }
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

// 添加进程错误处理
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error)
  // 不立即退出，给日志输出的时间
  setTimeout(() => process.exit(1), 1000)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason)
})

// 尝试启动服务器
try {
  server.listen(port, () => {
    console.log(`[Server] Server running at http://localhost:${port}`)
  })

  // Handle server errors
  server.on('error', (error) => {
    console.error(`[Server] Failed to start server:`, error)
    process.exit(1) // Exit if server fails to start
  })
} catch (error) {
  console.error('[Server] Critical error starting server:', error)
  process.exit(1)
}
