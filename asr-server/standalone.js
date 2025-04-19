/**
 * 独立的ASR服务器
 * 这个文件是一个简化版的server.js，用于在打包后的应用中运行
 */

// 基本依赖
const http = require('http')
const express = require('express')
const path = require('path')
const fs = require('fs')

// 输出环境信息
console.log('ASR Server starting...')
console.log('Node.js version:', process.version)
console.log('Current directory:', __dirname)
console.log('Current working directory:', process.cwd())
console.log('Command line arguments:', process.argv)

// 创建Express应用
const app = express()
const port = 34515

// 提供静态文件
app.use(express.static(__dirname))

// 提供网页给浏览器
app.get('/', (req, res) => {
  try {
    // 尝试多个可能的路径
    const possiblePaths = [
      // 当前目录
      path.join(__dirname, 'index.html'),
      // 上级目录
      path.join(__dirname, '..', 'index.html'),
      // 应用根目录
      path.join(process.cwd(), 'index.html')
    ]

    console.log('Possible index.html paths:', possiblePaths)

    // 查找第一个存在的文件
    let indexPath = null
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          indexPath = p
          console.log(`Found index.html at: ${p}`)
          break
        }
      } catch (e) {
        console.error(`Error checking existence of ${p}:`, e)
      }
    }

    if (indexPath) {
      res.sendFile(indexPath)
    } else {
      // 如果找不到文件，返回一个简单的HTML页面
      console.error('Could not find index.html, serving fallback page')
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>ASR Server</title>
          <style>
            body { font-family: sans-serif; padding: 2em; }
            h1 { color: #333; }
          </style>
        </head>
        <body>
          <h1>ASR Server is running</h1>
          <p>This is a fallback page because the index.html file could not be found.</p>
          <p>Server is running at: http://localhost:${port}</p>
          <p>Current directory: ${__dirname}</p>
          <p>Working directory: ${process.cwd()}</p>
        </body>
        </html>
      `)
    }
  } catch (error) {
    console.error('Error serving index.html:', error)
    res.status(500).send(`Server error: ${error.message}`)
  }
})

// 创建HTTP服务器
const server = http.createServer(app)

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

  // 处理服务器错误
  server.on('error', (error) => {
    console.error(`[Server] Failed to start server:`, error)
    process.exit(1) // Exit if server fails to start
  })
} catch (error) {
  console.error('[Server] Critical error starting server:', error)
  process.exit(1)
}
