import { query } from '@anthropic-ai/claude-code'
import { readFileSync } from 'fs'

async function* generateMessages() {
  // First message
  yield {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: 'Analyze this codebase for security issues'
    }
  }

  // Wait for conditions or user input
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Follow-up with image
  yield {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: [
        {
          type: 'text',
          text: 'Review this architecture diagram'
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: readFileSync('diagram.png', 'base64')
          }
        }
      ]
    }
  }
}

// Process streaming responses
for await (const message of query({
  prompt: generateMessages(),
  options: {
    maxTurns: 10,
    allowedTools: ['Read', 'Grep']
  }
})) {
  if (message.type === 'result') {
    console.log(message.result)
  }
}
