# Python CLI Web Interface POC

A proof-of-concept web interface for running Python CLI applications with real-time input/output interaction.

## Features

- **Web-based Terminal**: Chat-like interface for running Python commands
- **Real-time I/O**: Bidirectional communication with Python processes
- **Interactive Input**: Support for Python scripts that require user input
- **Process Management**: Start, monitor, and kill Python processes
- **WebSocket Communication**: Low-latency real-time updates

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the server**:
   ```bash
   npm start
   ```

3. **Open your browser**:
   - Navigate to `http://localhost:3000`
   - The interface will load automatically

## Usage Examples

### Basic Python Commands
```bash
python --version
python -c "print('Hello World')"
```

### Interactive Scripts
```bash
python test-script.py
python simple-calc.py
```

### Test Scripts Included

- **`test-script.py`**: Demonstrates user input, output streaming, and interactive features
- **`simple-calc.py`**: Simple calculator that takes mathematical expressions

## How It Works

1. **Frontend**: HTML/CSS/JS interface that looks like a terminal/chat
2. **WebSocket**: Real-time bidirectional communication
3. **Node.js Backend**: Spawns Python processes and manages I/O
4. **Process Management**: Each command runs in its own Python process

## Architecture

```
┌─────────────────┐    WebSocket    ┌──────────────────┐    spawn()    ┌─────────────┐
│   Web Browser   │ ◄─────────────► │   Node.js Server │ ◄──────────► │   Python    │
│   (Frontend)    │                 │   (Backend)      │               │   Process   │
└─────────────────┘                 └──────────────────┘               └─────────────┘
```

## Key Files

- `server.js` - Node.js server with WebSocket support
- `public/index.html` - Web interface
- `public/script.js` - Frontend JavaScript logic
- `public/style.css` - Interface styling
- `test-script.py` - Sample interactive Python script

## Development

The POC supports:
- ✅ Running Python commands
- ✅ Real-time output streaming  
- ✅ Interactive input handling
- ✅ Process termination
- ✅ Error handling
- ✅ Connection status monitoring
- ✅ Auto-reconnection

## Limitations

This is a POC with basic security. For production use, consider:
- Input sanitization
- Process sandboxing  
- Authentication/authorization
- Resource limits
- Proper error handling