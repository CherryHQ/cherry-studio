import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  {
    name: 'mcp-ui-demo',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

// HTML templates for different UIs
const getHelloWorldUI = () =>
  `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      min-height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
    }
    .container {
      text-align: center;
    }
    h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    p {
      font-size: 1.2em;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎉 Hello from MCP UI!</h1>
    <p>This is a simple MCP UI Resource rendered in Cherry Studio</p>
  </div>
</body>
</html>
`.trim()

const getInteractiveUI = () =>
  `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
      background: #f5f5f5;
      margin: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h2 {
      color: #333;
      margin-bottom: 20px;
    }
    button {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      margin: 5px;
      transition: background 0.2s;
    }
    button:hover {
      background: #5568d3;
    }
    #output {
      margin-top: 20px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
      min-height: 50px;
    }
    .info {
      color: #666;
      font-size: 14px;
      margin-top: 15px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>Interactive MCP UI Demo</h2>
    <p>Click the buttons to interact with MCP tools:</p>

    <button onclick="callEchoTool()">Call Echo Tool</button>
    <button onclick="getTimestamp()">Get Timestamp</button>
    <button onclick="openLink()">Open External Link</button>

    <div id="output"></div>

    <div class="info">
      This UI can communicate with the host application through postMessage API.
    </div>
  </div>

  <script>
    function callEchoTool() {
      const output = document.getElementById('output');
      output.innerHTML = '<p style="color: #0066cc;">Calling echo tool...</p>';

      window.parent.postMessage({
        type: 'tool',
        payload: {
          toolName: 'demo_echo',
          params: {
            message: 'Hello from MCP UI! Time: ' + new Date().toLocaleTimeString()
          }
        }
      }, '*');
    }

    function getTimestamp() {
      const output = document.getElementById('output');
      const now = new Date();
      output.innerHTML = \`
        <p style="color: #00aa00;">
          <strong>Current Timestamp:</strong><br/>
          \${now.toLocaleString()}<br/>
          Unix: \${Math.floor(now.getTime() / 1000)}
        </p>
      \`;
    }

    function openLink() {
      window.parent.postMessage({
        type: 'link',
        payload: {
          url: 'https://github.com/idosal/mcp-ui'
        }
      }, '*');
    }

    // Listen for responses
    window.addEventListener('message', (event) => {
      if (event.data.type === 'ui-message-response') {
        const output = document.getElementById('output');
        const { response, error } = event.data.payload;

        if (error) {
          output.innerHTML = \`<p style="color: #cc0000;">Error: \${error}</p>\`;
        } else {
          output.innerHTML = \`<p style="color: #00aa00;">Response: \${JSON.stringify(response, null, 2)}</p>\`;
        }
      }
    });
  </script>
</body>
</html>
`.trim()

const getFormUI = () =>
  `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
      background: #f5f5f5;
      margin: 0;
    }
    .container {
      max-width: 500px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h2 {
      color: #333;
      margin-bottom: 20px;
    }
    .form-group {
      margin-bottom: 15px;
    }
    label {
      display: block;
      margin-bottom: 5px;
      color: #555;
      font-weight: 500;
    }
    input, textarea {
      width: 100%;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      box-sizing: border-box;
    }
    textarea {
      min-height: 100px;
      resize: vertical;
    }
    button {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      width: 100%;
      margin-top: 10px;
    }
    button:hover {
      background: #5568d3;
    }
    #result {
      margin-top: 20px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>📝 Form UI Demo</h2>
    <form id="demoForm" onsubmit="handleSubmit(event)">
      <div class="form-group">
        <label for="name">Name:</label>
        <input type="text" id="name" name="name" required placeholder="Enter your name">
      </div>

      <div class="form-group">
        <label for="email">Email:</label>
        <input type="email" id="email" name="email" required placeholder="your@email.com">
      </div>

      <div class="form-group">
        <label for="message">Message:</label>
        <textarea id="message" name="message" required placeholder="Enter your message here..."></textarea>
      </div>

      <button type="submit">Submit Form</button>
    </form>

    <div id="result"></div>
  </div>

  <script>
    function handleSubmit(event) {
      event.preventDefault();

      const formData = new FormData(event.target);
      const data = Object.fromEntries(formData.entries());

      const result = document.getElementById('result');
      result.style.display = 'block';
      result.innerHTML = '<p style="color: #0066cc;">Submitting form...</p>';

      // Send form data to host
      window.parent.postMessage({
        type: 'notify',
        payload: {
          message: 'Form submitted with data: ' + JSON.stringify(data)
        }
      }, '*');

      // Display result
      result.innerHTML = \`
        <p style="color: #00aa00;"><strong>Form Submitted!</strong></p>
        <pre style="background: white; padding: 10px; border-radius: 4px; overflow-x: auto;">\${JSON.stringify(data, null, 2)}</pre>
      \`;
    }
  </script>
</body>
</html>
`.trim()

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'demo_echo',
        description: 'Echo back the message sent from UI',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to echo back'
            }
          },
          required: ['message']
        }
      },
      {
        name: 'show_hello_ui',
        description: 'Display a simple hello world UI with gradient background',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'show_interactive_ui',
        description:
          'Display an interactive UI demo with buttons for calling tools, getting timestamps, and opening links',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'show_form_ui',
        description: 'Display a form UI demo with input fields for name, email, and message',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  }
})

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (name === 'demo_echo') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            echo: args?.message || 'No message provided',
            timestamp: new Date().toISOString()
          })
        }
      ]
    }
  }

  if (name === 'show_hello_ui') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: 'resource',
            resource: {
              uri: 'ui://demo/hello',
              mimeType: 'text/html',
              text: getHelloWorldUI()
            }
          })
        }
      ]
    }
  }

  if (name === 'show_interactive_ui') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: 'resource',
            resource: {
              uri: 'ui://demo/interactive',
              mimeType: 'text/html',
              text: getInteractiveUI()
            }
          })
        }
      ]
    }
  }

  if (name === 'show_form_ui') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            type: 'resource',
            resource: {
              uri: 'ui://demo/form',
              mimeType: 'text/html',
              text: getFormUI()
            }
          })
        }
      ]
    }
  }

  throw new Error(`Unknown tool: ${name}`)
})

class MCPUIDemoServer {
  public server: Server
  constructor() {
    this.server = server
  }
}

export default MCPUIDemoServer
