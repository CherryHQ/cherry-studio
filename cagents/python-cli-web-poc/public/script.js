class PythonWebInterface {
  constructor() {
    this.ws = null
    this.currentSessionId = null
    this.isConnected = false
    this.isRunning = false

    this.initializeElements()
    this.setupEventListeners()
    this.connect()
  }

  initializeElements() {
    this.statusIndicator = document.getElementById('status-indicator')
    this.statusText = document.getElementById('status-text')
    this.output = document.getElementById('output')
    this.commandInput = document.getElementById('command-input')
    this.userInput = document.getElementById('user-input')
    this.userInputContainer = document.getElementById('user-input-container')
    this.runBtn = document.getElementById('run-btn')
    this.killBtn = document.getElementById('kill-btn')
    this.sendBtn = document.getElementById('send-btn')
  }

  setupEventListeners() {
    this.runBtn.addEventListener('click', () => this.runCommand())
    this.killBtn.addEventListener('click', () => this.killSession())
    this.sendBtn.addEventListener('click', () => this.sendInput())

    this.commandInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !this.isRunning) {
        this.runCommand()
      }
    })

    this.userInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendInput()
      }
    })
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}`

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.isConnected = true
      this.updateStatus('Connected', true)
      this.addSystemMessage('Connected to server')
    }

    this.ws.onclose = () => {
      this.isConnected = false
      this.updateStatus('Disconnected', false)
      this.addSystemMessage('Disconnected from server. Attempting to reconnect...')

      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (!this.isConnected) {
          this.connect()
        }
      }, 3000)
    }

    this.ws.onerror = (error) => {
      this.addErrorMessage('WebSocket error occurred')
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(JSON.parse(event.data))
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'command_started':
        this.isRunning = true
        this.currentSessionId = data.sessionId
        this.updateUIState()
        this.showUserInput()
        this.addSystemMessage(`Started: ${data.command}`)
        break

      case 'output':
        this.addOutput(data.data, data.stream === 'stderr')
        break

      case 'command_finished':
        this.isRunning = false
        this.currentSessionId = null
        this.updateUIState()
        this.hideUserInput()
        this.addSystemMessage(`Process finished with exit code: ${data.exitCode}`)
        break

      case 'error':
        this.addErrorMessage(data.message)
        this.isRunning = false
        this.currentSessionId = null
        this.updateUIState()
        this.hideUserInput()
        break
    }
  }

  runCommand() {
    const command = this.commandInput.value.trim()
    if (!command || !this.isConnected || this.isRunning) return

    this.addCommandMessage(command)

    const sessionId = 'session_' + Date.now()
    this.ws.send(
      JSON.stringify({
        type: 'run_command',
        command: command,
        sessionId: sessionId
      })
    )

    this.commandInput.value = ''
  }

  sendInput() {
    const input = this.userInput.value
    if (!input || !this.currentSessionId) return

    this.addInputMessage(input)

    this.ws.send(
      JSON.stringify({
        type: 'send_input',
        input: input,
        sessionId: this.currentSessionId
      })
    )

    this.userInput.value = ''
  }

  killSession() {
    if (this.currentSessionId) {
      this.ws.send(
        JSON.stringify({
          type: 'kill_session',
          sessionId: this.currentSessionId
        })
      )
    }
  }

  updateStatus(text, connected) {
    this.statusText.textContent = text
    this.statusIndicator.className = connected ? 'status-connected' : 'status-disconnected'
  }

  updateUIState() {
    this.runBtn.disabled = !this.isConnected || this.isRunning
    this.killBtn.disabled = !this.isRunning
    this.commandInput.disabled = !this.isConnected || this.isRunning
  }

  showUserInput() {
    this.userInputContainer.style.display = 'flex'
    this.userInput.focus()
  }

  hideUserInput() {
    this.userInputContainer.style.display = 'none'
  }

  addMessage(content, className) {
    const messageDiv = document.createElement('div')
    messageDiv.className = `message ${className}`

    const timestamp = document.createElement('div')
    timestamp.className = 'timestamp'
    timestamp.textContent = new Date().toLocaleTimeString()

    const contentDiv = document.createElement('pre')
    contentDiv.textContent = content

    messageDiv.appendChild(timestamp)
    messageDiv.appendChild(contentDiv)

    this.output.appendChild(messageDiv)
    this.scrollToBottom()
  }

  addCommandMessage(command) {
    this.addMessage(`$ ${command}`, 'command')
  }

  addInputMessage(input) {
    this.addMessage(`> ${input}`, 'command')
  }

  addOutput(data, isError = false) {
    this.addMessage(data, isError ? 'error' : 'output')
  }

  addSystemMessage(message) {
    this.addMessage(message, 'system')
  }

  addErrorMessage(message) {
    this.addMessage(`Error: ${message}`, 'error')
  }

  scrollToBottom() {
    this.output.scrollTop = this.output.scrollHeight
  }
}

// Initialize the interface when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new PythonWebInterface()
})
