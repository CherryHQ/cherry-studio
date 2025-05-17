// port from https://ai.pydantic.dev/mcp/run-python/
// https://jsr.io/@pydantic/mcp-run-python@0.0.13
import './polyfill'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type LoggingLevel, SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { asXml, runCode } from './runCode'

const VERSION = '0.0.13'

// list of log levels to use for level comparison
const LogLevels: LoggingLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']

/*
 * Create an MCP server with the `run_python_code` tool registered.
 */
function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'MCP Run Python',
      version: VERSION
    },
    {
      instructions: 'Call the "run_python_code" tool with the Python code to run.',
      capabilities: {
        logging: {}
      }
    }
  )

  const toolDescription = `Tool to execute Python code and return stdout, stderr, and return value.

The code may be async, and the value on the last line will be returned as the return value.

The code will be executed with Python 3.12.

Dependencies may be defined via PEP 723 script metadata, e.g. to install "pydantic", the script should start
with a comment of the form:

# /// script
# dependencies = ['pydantic']
# ///
print('python code here')
`

  let setLogLevel: LoggingLevel = 'info'

  server.server.setRequestHandler(SetLevelRequestSchema, (request) => {
    setLogLevel = request.params.level
    return {}
  })

  server.tool(
    'run_python_code',
    toolDescription,
    { python_code: z.string().describe('Python code to run') },
    async ({ python_code }: { python_code: string }) => {
      const logPromises: Promise<void>[] = []
      const result = await runCode(
        [
          {
            name: 'main.py',
            content: python_code,
            active: true
          }
        ],
        (level, data) => {
          if (LogLevels.indexOf(level) >= LogLevels.indexOf(setLogLevel)) {
            logPromises.push(server.server.sendLoggingMessage({ level, data }))
          }
        }
      )
      await Promise.all(logPromises)
      return {
        content: [{ type: 'text', text: asXml(result) }]
      }
    }
  )
  return server
}

export default createServer
