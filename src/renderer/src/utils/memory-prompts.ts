import { MEMORY_FACT_EXTRACTION_PROMPT } from '@shared/config/prompts'
import * as z from 'zod'

// Define Zod schema for fact retrieval output
export const FactRetrievalSchema = z.object({
  facts: z.array(z.string()).describe('An array of distinct facts extracted from the conversation.')
})

// Define Zod schema for memory update output
export const MemoryUpdateSchema = z.array(
  z.object({
    id: z.string().describe('The unique identifier of the memory item.'),
    text: z.string().describe('The content of the memory item.'),
    event: z
      .enum(['ADD', 'UPDATE', 'DELETE', 'NONE'])
      .describe('The action taken for this memory item (ADD, UPDATE, DELETE, or NONE).'),
    old_memory: z.string().optional().describe('The previous content of the memory item if the event was UPDATE.')
  })
)

export const updateMemoryUserPrompt: string = `Below is the current content of my memory which I have collected till now. You have to update it in the following format only:
<oldMemory> 
{{ retrievedOldMemory }}
</oldMemory>

The new retrieved facts are mentioned below. You have to analyze the new retrieved facts and determine whether these facts should be added, updated, or deleted in the memory.
<newFacts>
{{ newRetrievedFacts }}
</newFacts>

You have to return the updated memory in the following JSON format:

[
    {
        "id": "0",
        "text": "User is a software engineer",
        "event": "ADD/UPDATE/DELETE/NONE",
        "old_memory": "Old memory text if event is UPDATE"
    },
    ...
]

Do not return anything except the JSON format.
`

export const extractJsonPrompt = `You are in a system that processing your response can only parse raw JSON. It is not capable of handling any other text or formatting.

- Your response MUST start with [ (an opening square bracket) and end with ] (a closing square bracket).
- DO NOT include markdown code blocks like \`\`\`json or \`\`\`.
- DO NOT add any text, notes, or explanations before or after the JSON data.
- Your entire response must be the JSON data and nothing else.

Please extract the JSON data from the following text:
`

export function getFactRetrievalMessages(parsedMessages: string): [string, string] {
  const systemPrompt = MEMORY_FACT_EXTRACTION_PROMPT
  const userPrompt = `Following is a conversation between the user and the assistant. Extract relevant facts and preferences ABOUT THE USER from this conversation.
Conversation:
${parsedMessages}`
  return [systemPrompt, userPrompt]
}

export function getUpdateMemoryMessages(
  retrievedOldMemory: Array<{ id: string; text: string }>,
  newRetrievedFacts: string[]
): string {
  return updateMemoryUserPrompt
    .replace('{{ retrievedOldMemory }}', JSON.stringify(retrievedOldMemory, null, 2))
    .replace('{{ newRetrievedFacts }}', JSON.stringify(newRetrievedFacts, null, 2))
}

export function parseMessages(messages: string[]): string {
  return messages.join('\n')
}

export function removeCodeBlocks(text: string): string {
  return text.replace(/```[^`]*```/g, '')
}
