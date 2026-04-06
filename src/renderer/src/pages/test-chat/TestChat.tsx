import { useAiChat } from '@renderer/hooks/useAiChat'
import { useState } from 'react'

/**
 * Temporary test page for validating the AI IPC streaming pipeline (P1).
 *
 * Exercises: useAiChat → IpcChatTransport → AiService (mock) → stream chunks.
 * Will be removed in P3 after Chat.tsx is fully migrated.
 */
export default function TestChat() {
  const [input, setInput] = useState('')

  const { messages, status, error, sendMessage, stop, regenerate } = useAiChat({
    chatId: 'test-chat-001',
    topicId: 'test-chat-001'
  })

  const handleSend = () => {
    const text = input.trim()
    if (!text || status === 'streaming') return
    sendMessage({ text })
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 text-gray-500 text-sm">
        Status: <span className="font-mono">{status}</span>
        {error && <span className="ml-2 text-red-500">Error: {error.message}</span>}
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((msg) => (
          <div key={msg.id} className={`rounded p-3 ${msg.role === 'user' ? 'bg-blue-50' : 'bg-gray-50'}`}>
            <div className="mb-1 font-semibold text-gray-400 text-xs">{msg.role}</div>
            {msg.parts.map((part, i) => {
              if (part.type === 'text') {
                return (
                  <div key={i} className="whitespace-pre-wrap">
                    {part.text}
                  </div>
                )
              }
              if (part.type === 'reasoning') {
                return (
                  <div key={i} className="border-yellow-300 border-l-2 pl-2 text-gray-500 text-sm italic">
                    {part.text}
                  </div>
                )
              }
              return (
                <div key={i} className="text-gray-400 text-xs">
                  [{part.type}]
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={status === 'streaming'}
        />
        {status === 'streaming' ? (
          <button className="rounded bg-red-500 px-4 py-2 text-sm text-white" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="rounded bg-blue-500 px-4 py-2 text-sm text-white" onClick={handleSend}>
            Send
          </button>
        )}
        <button
          className="rounded bg-gray-300 px-4 py-2 text-sm"
          onClick={() => regenerate()}
          disabled={status === 'streaming' || messages.length === 0}>
          Regen
        </button>
      </div>
    </div>
  )
}
