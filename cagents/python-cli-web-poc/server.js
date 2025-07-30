const express = require('express')
const WebSocket = require('ws')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

const PORT = process.env.PORT || 3000

// Serve static files from public directory
app.use(express.static('public'))

// Route for main page
app.get('/', (req, res) => {
  res.redirect('/index.html')
})

// Store active Python processes
const activeSessions = new Map()

wss.on('connection', (ws) => {
  console.log('Client connected')

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message)

      switch (data.type) {
        case 'run_command':
          handlePythonCommand(ws, data.command, data.sessionId)
          break
        case 'send_input':
          handleUserInput(ws, data.input, data.sessionId)
          break
        case 'kill_session':
          killSession(data.sessionId)
          break
      }
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        })
      )
    }
  })

  ws.on('close', () => {
    console.log('Client disconnected')
    // Clean up any active sessions for this client
    for (let [sessionId, session] of activeSessions) {
      if (session.ws === ws) {
        killSession(sessionId)
      }
    }
  })
})

function handlePythonCommand(ws, command, sessionId) {
  // Kill existing session if any
  if (activeSessions.has(sessionId)) {
    killSession(sessionId)
  }

  // Parse command (simple split for POC)
  const args = command.trim().split(' ')
  const pythonCommand = args[0] === 'python' || args[0] === 'python3' ? args[0] : 'python3'
  const scriptArgs = args[0] === 'python' || args[0] === 'python3' ? args.slice(1) : args

  try {
    // Spawn Python process
    const pythonProcess = spawn(pythonCommand, scriptArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // Store session
    activeSessions.set(sessionId, {
      process: pythonProcess,
      ws: ws
    })

    // Send confirmation
    ws.send(
      JSON.stringify({
        type: 'command_started',
        sessionId: sessionId,
        command: command
      })
    )

    // Handle stdout
    pythonProcess.stdout.on('data', (data) => {
      ws.send(
        JSON.stringify({
          type: 'output',
          sessionId: sessionId,
          data: data.toString(),
          stream: 'stdout'
        })
      )
    })

    // Handle stderr
    pythonProcess.stderr.on('data', (data) => {
      ws.send(
        JSON.stringify({
          type: 'output',
          sessionId: sessionId,
          data: data.toString(),
          stream: 'stderr'
        })
      )
    })

    // Handle process exit
    pythonProcess.on('close', (code) => {
      ws.send(
        JSON.stringify({
          type: 'command_finished',
          sessionId: sessionId,
          exitCode: code
        })
      )
      activeSessions.delete(sessionId)
    })

    // Handle process error
    pythonProcess.on('error', (error) => {
      ws.send(
        JSON.stringify({
          type: 'error',
          sessionId: sessionId,
          message: `Failed to start process: ${error.message}`
        })
      )
      activeSessions.delete(sessionId)
    })
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: 'error',
        sessionId: sessionId,
        message: `Error running command: ${error.message}`
      })
    )
  }
}

function handleUserInput(ws, input, sessionId) {
  const session = activeSessions.get(sessionId)
  if (session && session.process) {
    session.process.stdin.write(input + '\n')
  } else {
    ws.send(
      JSON.stringify({
        type: 'error',
        sessionId: sessionId,
        message: 'No active session to send input to'
      })
    )
  }
}

function killSession(sessionId) {
  const session = activeSessions.get(sessionId)
  if (session && session.process) {
    session.process.kill()
    activeSessions.delete(sessionId)
  }
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log('Open your browser and navigate to the URL above')
})
