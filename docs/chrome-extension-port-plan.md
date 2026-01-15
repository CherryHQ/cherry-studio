# Cherry Studio Chrome Extension Port Plan

## Executive Summary

This document outlines a comprehensive plan to port Cherry Studio from an Electron desktop application to a Chrome extension. The port involves significant architectural changes due to the fundamental differences between Electron and Chrome extension environments.

**Feasibility Assessment:**
- Core AI functionality: 95% portable
- UI components: 85% portable
- Data persistence: 70% portable
- System integration: 10% portable (major feature loss)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Chrome Extension Structure](#2-chrome-extension-structure)
3. [Phase 1: Foundation Setup](#3-phase-1-foundation-setup)
4. [Phase 2: Core AI Layer Migration](#4-phase-2-core-ai-layer-migration)
5. [Phase 3: Data Persistence Migration](#5-phase-3-data-persistence-migration)
6. [Phase 4: UI Migration](#6-phase-4-ui-migration)
7. [Phase 5: Feature Parity Analysis](#7-phase-5-feature-parity-analysis)
8. [Phase 6: Chrome-Specific Features](#8-phase-6-chrome-specific-features)
9. [Phase 7: Testing & QA](#9-phase-7-testing--qa)
10. [Feature Comparison Matrix](#10-feature-comparison-matrix)
11. [Technical Risks & Mitigations](#11-technical-risks--mitigations)
12. [Migration Checklist](#12-migration-checklist)

---

## 1. Architecture Overview

### Current Electron Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Application                      │
├─────────────────────────────────────────────────────────────┤
│  Main Process (Node.js)          │  Renderer Process (React) │
│  ├── WindowService               │  ├── Redux Store          │
│  ├── MCPService                  │  ├── React Components     │
│  ├── FileStorage                 │  ├── IndexedDB (Dexie)    │
│  ├── KnowledgeService            │  └── UI Logic             │
│  ├── BackupManager               │                           │
│  ├── SelectionService            │                           │
│  └── 20+ Services                │                           │
├─────────────────────────────────────────────────────────────┤
│                    Preload (IPC Bridge)                      │
│                    200+ IPC Channels                         │
└─────────────────────────────────────────────────────────────┘
```

### Target Chrome Extension Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Chrome Extension (MV3)                     │
├─────────────────────────────────────────────────────────────┤
│  Service Worker           │  UI Contexts                     │
│  (background.js)          │  ├── Popup (popup.html)          │
│  ├── AI Service           │  ├── Side Panel (sidepanel.html) │
│  ├── MCP Manager          │  ├── Options (options.html)      │
│  ├── Storage Service      │  └── Content Scripts             │
│  ├── Backup Service       │                                  │
│  └── Message Router       │  Shared                          │
│                           │  ├── Redux Store                 │
│                           │  ├── React Components            │
│                           │  └── IndexedDB                   │
├─────────────────────────────────────────────────────────────┤
│                chrome.runtime.sendMessage()                  │
│                chrome.storage API                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Chrome Extension Structure

### Manifest V3 Configuration

```json
{
  "manifest_version": 3,
  "name": "Cherry Studio",
  "version": "1.0.0",
  "description": "AI Assistant powered by multiple LLM providers",

  "permissions": [
    "storage",
    "unlimitedStorage",
    "activeTab",
    "contextMenus",
    "sidePanel",
    "offscreen",
    "identity",
    "alarms"
  ],

  "optional_permissions": [
    "clipboardRead",
    "clipboardWrite",
    "downloads"
  ],

  "host_permissions": [
    "https://api.openai.com/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://*.amazonaws.com/*",
    "<all_urls>"
  ],

  "background": {
    "service_worker": "background.js",
    "type": "module"
  },

  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },

  "side_panel": {
    "default_path": "sidepanel.html"
  },

  "options_page": "options.html",

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],

  "web_accessible_resources": [
    {
      "resources": ["fonts/*", "images/*"],
      "matches": ["<all_urls>"]
    }
  ],

  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+C",
        "mac": "Command+Shift+C"
      }
    },
    "open_side_panel": {
      "suggested_key": {
        "default": "Ctrl+Shift+S",
        "mac": "Command+Shift+S"
      },
      "description": "Open Cherry Studio side panel"
    },
    "quick_ask": {
      "suggested_key": {
        "default": "Ctrl+Shift+A",
        "mac": "Command+Shift+A"
      },
      "description": "Quick ask selected text"
    }
  }
}
```

### Directory Structure

```
cherry-studio-extension/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
│
├── src/
│   ├── background/
│   │   ├── index.ts              # Service worker entry
│   │   ├── message-router.ts     # Message handling
│   │   ├── services/
│   │   │   ├── ai-service.ts     # AI provider calls
│   │   │   ├── mcp-service.ts    # MCP (HTTP/SSE only)
│   │   │   ├── storage-service.ts
│   │   │   ├── backup-service.ts
│   │   │   └── auth-service.ts
│   │   └── utils/
│   │
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx               # Quick actions UI
│   │
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx               # Full chat interface
│   │
│   ├── options/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx               # Settings UI
│   │
│   ├── content/
│   │   ├── index.ts              # Content script entry
│   │   ├── selection-handler.ts  # Text selection
│   │   └── page-context.ts       # Page extraction
│   │
│   ├── offscreen/
│   │   ├── index.html
│   │   └── worker.ts             # Long-running tasks
│   │
│   ├── shared/
│   │   ├── store/                # Redux store (migrated)
│   │   ├── components/           # React components (migrated)
│   │   ├── hooks/
│   │   ├── types/
│   │   ├── utils/
│   │   └── constants/
│   │
│   └── packages/
│       └── aiCore/               # Extracted AI core (unchanged)
│
├── public/
│   ├── icons/
│   └── fonts/
│
└── build/
    └── ... (bundled output)
```

---

## 3. Phase 1: Foundation Setup

### 3.1 Project Initialization

**Tasks:**
1. Create new extension project with Vite + React + TypeScript
2. Configure Manifest V3
3. Set up build pipeline for multiple entry points
4. Configure TypeScript paths and shared code

**Build Configuration (vite.config.ts):**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest })
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        offscreen: resolve(__dirname, 'src/offscreen/index.html')
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@aiCore': resolve(__dirname, 'src/packages/aiCore')
    }
  }
})
```

### 3.2 Message Passing Architecture

Replace Electron IPC with Chrome message passing:

```typescript
// src/shared/messaging/types.ts
export enum MessageType {
  // AI Operations
  AI_STREAM_TEXT = 'ai:streamText',
  AI_GENERATE_OBJECT = 'ai:generateObject',
  AI_GENERATE_IMAGE = 'ai:generateImage',

  // MCP Operations
  MCP_LIST_TOOLS = 'mcp:listTools',
  MCP_EXECUTE_TOOL = 'mcp:executeTool',
  MCP_CONNECT = 'mcp:connect',
  MCP_DISCONNECT = 'mcp:disconnect',

  // Storage Operations
  STORAGE_GET = 'storage:get',
  STORAGE_SET = 'storage:set',
  STORAGE_DELETE = 'storage:delete',

  // Backup Operations
  BACKUP_CREATE = 'backup:create',
  BACKUP_RESTORE = 'backup:restore',

  // Knowledge Base
  KB_SEARCH = 'kb:search',
  KB_INDEX = 'kb:index',

  // Authentication
  AUTH_OAUTH_START = 'auth:oauthStart',
  AUTH_OAUTH_CALLBACK = 'auth:oauthCallback'
}

export interface Message<T = unknown> {
  type: MessageType
  payload: T
  requestId?: string
}

export interface StreamMessage {
  type: 'chunk' | 'done' | 'error'
  data: unknown
  requestId: string
}
```

```typescript
// src/shared/messaging/client.ts
export class ExtensionMessenger {
  private streamHandlers = new Map<string, (msg: StreamMessage) => void>()

  constructor() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'stream' && message.requestId) {
        const handler = this.streamHandlers.get(message.requestId)
        if (handler) handler(message)
      }
      return false
    })
  }

  async send<T, R>(type: MessageType, payload: T): Promise<R> {
    return chrome.runtime.sendMessage({ type, payload })
  }

  async stream<T>(
    type: MessageType,
    payload: T,
    onChunk: (chunk: unknown) => void
  ): Promise<void> {
    const requestId = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      this.streamHandlers.set(requestId, (msg) => {
        if (msg.type === 'chunk') onChunk(msg.data)
        else if (msg.type === 'done') {
          this.streamHandlers.delete(requestId)
          resolve()
        } else if (msg.type === 'error') {
          this.streamHandlers.delete(requestId)
          reject(msg.data)
        }
      })

      chrome.runtime.sendMessage({ type, payload, requestId })
    })
  }
}
```

```typescript
// src/background/message-router.ts
import { Message, MessageType } from '@shared/messaging/types'
import { AIService } from './services/ai-service'
import { MCPService } from './services/mcp-service'
import { StorageService } from './services/storage-service'

const aiService = new AIService()
const mcpService = new MCPService()
const storageService = new StorageService()

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }))
  return true // Keep channel open for async response
})

async function handleMessage(message: Message, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    // AI Operations
    case MessageType.AI_STREAM_TEXT:
      return aiService.streamText(message.payload, message.requestId, sender.tab?.id)
    case MessageType.AI_GENERATE_OBJECT:
      return aiService.generateObject(message.payload)
    case MessageType.AI_GENERATE_IMAGE:
      return aiService.generateImage(message.payload)

    // MCP Operations
    case MessageType.MCP_LIST_TOOLS:
      return mcpService.listTools(message.payload)
    case MessageType.MCP_EXECUTE_TOOL:
      return mcpService.executeTool(message.payload)

    // Storage Operations
    case MessageType.STORAGE_GET:
      return storageService.get(message.payload)
    case MessageType.STORAGE_SET:
      return storageService.set(message.payload)

    default:
      throw new Error(`Unknown message type: ${message.type}`)
  }
}
```

---

## 4. Phase 2: Core AI Layer Migration

### 4.1 Extract aiCore Package

The `packages/aiCore/` package is already well-encapsulated and browser-compatible. Direct extraction with minimal changes:

**Required Changes:**
1. Remove any Node.js-specific imports (none found in analysis)
2. Update build configuration for browser target
3. Export as ES module

```typescript
// src/packages/aiCore/index.ts (mostly unchanged)
export {
  createExecutor,
  createOpenAICompatibleExecutor,
  generateImage,
  generateObject,
  generateText,
  streamText
} from './core'

export { globalModelResolver } from './core/models'
export { PluginManager, createContext, definePlugin, PluginEngine } from './core/plugins'
```

### 4.2 AI Service Worker Implementation

```typescript
// src/background/services/ai-service.ts
import { streamText, generateObject, generateImage } from '@aiCore'
import { globalModelResolver } from '@aiCore'

export class AIService {
  async streamText(
    payload: StreamTextPayload,
    requestId: string,
    tabId?: number
  ): Promise<void> {
    const { provider, model, messages, options } = payload

    const resolvedModel = globalModelResolver.resolve(provider, model)

    const stream = await streamText({
      model: resolvedModel,
      messages,
      ...options
    })

    // Stream chunks back to requesting context
    for await (const chunk of stream.textStream) {
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'stream',
          requestId,
          data: { type: 'chunk', text: chunk }
        })
      } else {
        chrome.runtime.sendMessage({
          type: 'stream',
          requestId,
          data: { type: 'chunk', text: chunk }
        })
      }
    }

    // Signal completion
    const target = tabId
      ? chrome.tabs.sendMessage.bind(chrome.tabs, tabId)
      : chrome.runtime.sendMessage.bind(chrome.runtime)

    target({
      type: 'stream',
      requestId,
      data: { type: 'done', usage: await stream.usage }
    })
  }

  async generateObject(payload: GenerateObjectPayload) {
    const { provider, model, messages, schema, options } = payload
    const resolvedModel = globalModelResolver.resolve(provider, model)

    return generateObject({
      model: resolvedModel,
      messages,
      schema,
      ...options
    })
  }

  async generateImage(payload: GenerateImagePayload) {
    const { provider, model, prompt, options } = payload
    const resolvedModel = globalModelResolver.resolve(provider, model)

    return generateImage({
      model: resolvedModel,
      prompt,
      ...options
    })
  }
}
```

### 4.3 MCP Service (HTTP/SSE Only)

**Critical Limitation:** Chrome extensions cannot spawn subprocesses, so stdio-based MCP servers are not supported. Only HTTP and SSE transports work.

```typescript
// src/background/services/mcp-service.ts
import { Client } from '@anthropic-ai/mcp-client'
import { SSEClientTransport, StreamableHTTPClientTransport } from '@anthropic-ai/mcp-client/transports'

interface MCPServer {
  id: string
  name: string
  transport: 'sse' | 'http'
  url: string
  headers?: Record<string, string>
}

export class MCPService {
  private clients = new Map<string, Client>()

  async connect(server: MCPServer): Promise<void> {
    if (this.clients.has(server.id)) {
      return // Already connected
    }

    let transport: SSEClientTransport | StreamableHTTPClientTransport

    if (server.transport === 'sse') {
      transport = new SSEClientTransport(server.url, {
        headers: server.headers
      })
    } else {
      transport = new StreamableHTTPClientTransport(server.url, {
        headers: server.headers
      })
    }

    const client = new Client({
      name: 'cherry-studio-extension',
      version: '1.0.0'
    })

    await client.connect(transport)
    this.clients.set(server.id, client)
  }

  async disconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client) {
      await client.close()
      this.clients.delete(serverId)
    }
  }

  async listTools(serverId: string): Promise<Tool[]> {
    const client = this.clients.get(serverId)
    if (!client) throw new Error(`Server ${serverId} not connected`)

    const response = await client.listTools()
    return response.tools
  }

  async executeTool(payload: {
    serverId: string
    toolName: string
    arguments: Record<string, unknown>
  }): Promise<unknown> {
    const client = this.clients.get(payload.serverId)
    if (!client) throw new Error(`Server ${payload.serverId} not connected`)

    return client.callTool({
      name: payload.toolName,
      arguments: payload.arguments
    })
  }
}
```

---

## 5. Phase 3: Data Persistence Migration

### 5.1 Storage Strategy

| Electron Source | Chrome Extension Target | Notes |
|-----------------|------------------------|-------|
| electron-store | chrome.storage.local | Settings, configs |
| Redux-persist (localStorage) | chrome.storage.local | State persistence |
| IndexedDB (Dexie) | IndexedDB (Dexie) | No change needed |
| File system | IndexedDB + Blob storage | Files stored as blobs |
| ~/.cherry-studio/ | Extension storage | Config migration |

### 5.2 Chrome Storage Service

```typescript
// src/background/services/storage-service.ts
const STORAGE_KEY_PREFIX = 'cherry:'

export class StorageService {
  // Settings storage (chrome.storage.local)
  async getSettings<T>(key: string): Promise<T | undefined> {
    const result = await chrome.storage.local.get(`${STORAGE_KEY_PREFIX}${key}`)
    return result[`${STORAGE_KEY_PREFIX}${key}`]
  }

  async setSettings<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({
      [`${STORAGE_KEY_PREFIX}${key}`]: value
    })
  }

  // Large data storage (IndexedDB via Dexie)
  private db = new CherryDatabase()

  async getConversation(id: string) {
    return this.db.topics.get(id)
  }

  async saveConversation(topic: Topic) {
    return this.db.topics.put(topic)
  }

  // File blob storage
  async saveFile(file: File): Promise<string> {
    const id = crypto.randomUUID()
    const blob = new Blob([await file.arrayBuffer()], { type: file.type })

    await this.db.files.add({
      id,
      name: file.name,
      type: file.type,
      size: file.size,
      blob,
      createdAt: Date.now()
    })

    return id
  }

  async getFile(id: string): Promise<Blob | undefined> {
    const record = await this.db.files.get(id)
    return record?.blob
  }
}
```

### 5.3 IndexedDB Schema (Dexie Migration)

```typescript
// src/shared/database/index.ts
import Dexie, { Table } from 'dexie'

interface FileRecord {
  id: string
  name: string
  type: string
  size: number
  blob: Blob
  createdAt: number
}

interface Topic {
  id: string
  assistantId: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

interface MessageBlock {
  id: string
  topicId: string
  messageId: string
  type: 'text' | 'code' | 'image' | 'tool_result'
  content: unknown
}

interface KnowledgeNote {
  id: string
  baseId: string
  content: string
  embedding?: number[]
  metadata: Record<string, unknown>
}

export class CherryDatabase extends Dexie {
  files!: Table<FileRecord>
  topics!: Table<Topic>
  messageBlocks!: Table<MessageBlock>
  knowledgeNotes!: Table<KnowledgeNote>
  settings!: Table<{ id: string; value: unknown }>
  quickPhrases!: Table<{ id: string; content: string; category: string }>
  translateHistory!: Table<{ id: string; from: string; to: string; text: string; result: string }>

  constructor() {
    super('CherryStudioExtension')

    this.version(1).stores({
      files: 'id, name, type, createdAt',
      topics: 'id, assistantId, createdAt, updatedAt',
      messageBlocks: 'id, topicId, messageId, type',
      knowledgeNotes: 'id, baseId',
      settings: 'id',
      quickPhrases: 'id, category',
      translateHistory: 'id'
    })
  }
}

export const db = new CherryDatabase()
```

### 5.4 Redux Store Migration

```typescript
// src/shared/store/index.ts
import { configureStore, combineReducers } from '@reduxjs/toolkit'
import {
  persistStore,
  persistReducer,
  FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER
} from 'redux-persist'

// Custom storage engine for Chrome extension
const chromeStorage = {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key)
    return result[key] ?? null
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key)
  }
}

// Import slices (migrated from src/renderer/src/store/)
import assistantsReducer from './slices/assistants'
import settingsReducer from './slices/settings'
import llmReducer from './slices/llm'
import mcpReducer from './slices/mcp'
import knowledgeReducer from './slices/knowledge'
import messagesReducer from './slices/messages'
import runtimeReducer from './slices/runtime'

const rootReducer = combineReducers({
  assistants: assistantsReducer,
  settings: settingsReducer,
  llm: llmReducer,
  mcp: mcpReducer,
  knowledge: knowledgeReducer,
  messages: messagesReducer,
  runtime: runtimeReducer
})

const persistConfig = {
  key: 'cherry-studio-extension',
  version: 1,
  storage: chromeStorage,
  blacklist: ['runtime', 'messages'] // Don't persist transient state
}

const persistedReducer = persistReducer(persistConfig, rootReducer)

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    })
})

export const persistor = persistStore(store)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
```

---

## 6. Phase 4: UI Migration

### 6.1 Component Migration Strategy

**Directly Portable (85%):**
- All React components from `src/renderer/src/components/`
- Ant Design components
- CodeMirror editors
- Tiptap rich text editor
- Shiki syntax highlighting
- Message rendering components
- Settings panels

**Requires Adaptation (15%):**
- Window controls (remove)
- File dialogs (use File API)
- System tray integration (remove)
- Multi-window communication (use chrome.runtime)

### 6.2 Side Panel Implementation (Main UI)

```tsx
// src/sidepanel/App.tsx
import React from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { ConfigProvider, theme } from 'antd'
import { store, persistor } from '@shared/store'
import { ChatInterface } from '@shared/components/ChatInterface'
import { useSettings } from '@shared/hooks/useSettings'

function AppContent() {
  const { themeMode } = useSettings()

  return (
    <ConfigProvider
      theme={{
        algorithm: themeMode === 'dark'
          ? theme.darkAlgorithm
          : theme.defaultAlgorithm
      }}
    >
      <div className="cherry-sidepanel">
        <ChatInterface />
      </div>
    </ConfigProvider>
  )
}

export function App() {
  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <AppContent />
      </PersistGate>
    </Provider>
  )
}
```

### 6.3 Popup Implementation (Quick Actions)

```tsx
// src/popup/App.tsx
import React, { useState } from 'react'
import { Button, Input, Space, Dropdown } from 'antd'
import {
  MessageOutlined,
  SettingOutlined,
  HistoryOutlined,
  RobotOutlined
} from '@ant-design/icons'

export function App() {
  const [quickInput, setQuickInput] = useState('')

  const openSidePanel = () => {
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
  }

  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  const askWithSelection = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    chrome.tabs.sendMessage(tab.id!, { type: 'getSelection' }, (selection) => {
      if (selection) {
        // Open side panel with selection context
        chrome.storage.session.set({ pendingSelection: selection })
        openSidePanel()
      }
    })
  }

  const quickAsk = async () => {
    if (!quickInput.trim()) return
    chrome.storage.session.set({ pendingQuestion: quickInput })
    openSidePanel()
  }

  return (
    <div className="cherry-popup" style={{ width: 320, padding: 16 }}>
      <h3 style={{ margin: '0 0 16px' }}>Cherry Studio</h3>

      <Space direction="vertical" style={{ width: '100%' }}>
        <Input.Search
          placeholder="Quick ask..."
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
          onSearch={quickAsk}
          enterButton="Ask"
        />

        <Button
          type="primary"
          icon={<MessageOutlined />}
          block
          onClick={openSidePanel}
        >
          Open Chat
        </Button>

        <Button
          icon={<RobotOutlined />}
          block
          onClick={askWithSelection}
        >
          Ask About Selection
        </Button>

        <Button
          icon={<SettingOutlined />}
          block
          onClick={openOptions}
        >
          Settings
        </Button>
      </Space>
    </div>
  )
}
```

### 6.4 Content Script (Page Integration)

```typescript
// src/content/index.ts
import { createSelectionPopup } from './selection-handler'
import { extractPageContext } from './page-context'

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'getSelection':
      sendResponse(window.getSelection()?.toString() || '')
      break

    case 'getPageContext':
      sendResponse(extractPageContext())
      break

    case 'showSelectionPopup':
      createSelectionPopup(message.position)
      break
  }
  return false
})

// Text selection handler
document.addEventListener('mouseup', (event) => {
  const selection = window.getSelection()
  if (selection && selection.toString().trim().length > 0) {
    // Notify background script of selection
    chrome.runtime.sendMessage({
      type: 'textSelected',
      text: selection.toString(),
      url: window.location.href,
      title: document.title
    })
  }
})
```

```typescript
// src/content/selection-handler.ts
export function createSelectionPopup(position: { x: number; y: number }) {
  // Remove existing popup
  const existing = document.getElementById('cherry-selection-popup')
  if (existing) existing.remove()

  const popup = document.createElement('div')
  popup.id = 'cherry-selection-popup'
  popup.innerHTML = `
    <div class="cherry-popup-content">
      <button data-action="explain">Explain</button>
      <button data-action="translate">Translate</button>
      <button data-action="summarize">Summarize</button>
      <button data-action="ask">Ask...</button>
    </div>
  `

  popup.style.cssText = `
    position: fixed;
    left: ${position.x}px;
    top: ${position.y}px;
    z-index: 999999;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    padding: 8px;
  `

  popup.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest('button')
    if (button) {
      const action = button.dataset.action
      const selection = window.getSelection()?.toString()

      chrome.runtime.sendMessage({
        type: 'selectionAction',
        action,
        text: selection,
        url: window.location.href
      })

      popup.remove()
    }
  })

  document.body.appendChild(popup)

  // Auto-remove on click outside
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popup.contains(e.target as Node)) {
        popup.remove()
        document.removeEventListener('click', handler)
      }
    })
  }, 100)
}
```

---

## 7. Phase 5: Feature Parity Analysis

### 7.1 Features to Migrate (Full Support)

| Feature | Implementation | Notes |
|---------|---------------|-------|
| Multi-provider AI chat | Direct migration | aiCore package unchanged |
| Conversation history | IndexedDB | Same Dexie schema |
| Multiple assistants | Redux state | Settings migrated |
| Code highlighting | Shiki | Works in extension |
| Rich text editing | Tiptap | Works in extension |
| Markdown rendering | react-markdown | Works in extension |
| Image generation | AI SDK | Works in extension |
| Object generation | AI SDK | Works in extension |
| Provider settings | Chrome storage | OAuth flows work |
| Themes (dark/light) | CSS variables | Works in extension |
| Quick phrases | IndexedDB | Full support |
| Translation | AI-powered | Full support |
| Export (JSON) | Blob download | Works in extension |

### 7.2 Features with Limited Support

| Feature | Limitation | Workaround |
|---------|-----------|------------|
| MCP servers | No stdio transport | HTTP/SSE servers only |
| File attachments | No file system | File picker + IndexedDB |
| Knowledge base | No local embeddings | Use API-based embeddings |
| OCR | No system OCR | Tesseract.js (slower) |
| Keyboard shortcuts | Limited keys | chrome.commands API |
| Backup (local) | No file write | Download as file |
| Document parsing | Limited formats | PDF.js, browser APIs |

### 7.3 Features to Remove

| Feature | Reason |
|---------|--------|
| System selection toolbar | Requires OS hooks |
| Global shortcuts | Not available in MV3 |
| System tray | Electron-specific |
| Window management | Not applicable |
| Auto-updates | Chrome handles this |
| Local file watching | No file system access |
| Code execution sandbox | Security risk |
| Local backup scheduler | Use alarms API instead |

---

## 8. Phase 6: Chrome-Specific Features

### 8.1 Context Menu Integration

```typescript
// src/background/context-menu.ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'cherry-ask',
    title: 'Ask Cherry Studio',
    contexts: ['selection']
  })

  chrome.contextMenus.create({
    id: 'cherry-explain',
    title: 'Explain with AI',
    contexts: ['selection']
  })

  chrome.contextMenus.create({
    id: 'cherry-translate',
    title: 'Translate',
    contexts: ['selection']
  })

  chrome.contextMenus.create({
    id: 'cherry-summarize',
    title: 'Summarize Page',
    contexts: ['page']
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id
  if (!tabId) return

  switch (info.menuItemId) {
    case 'cherry-ask':
      await chrome.storage.session.set({
        pendingAction: {
          type: 'ask',
          text: info.selectionText,
          url: info.pageUrl
        }
      })
      chrome.sidePanel.open({ tabId })
      break

    case 'cherry-explain':
      await chrome.storage.session.set({
        pendingAction: {
          type: 'explain',
          text: info.selectionText
        }
      })
      chrome.sidePanel.open({ tabId })
      break

    case 'cherry-translate':
      await chrome.storage.session.set({
        pendingAction: {
          type: 'translate',
          text: info.selectionText
        }
      })
      chrome.sidePanel.open({ tabId })
      break

    case 'cherry-summarize':
      // Get page content via content script
      chrome.tabs.sendMessage(tabId, { type: 'getPageContent' }, async (content) => {
        await chrome.storage.session.set({
          pendingAction: {
            type: 'summarize',
            text: content,
            url: info.pageUrl
          }
        })
        chrome.sidePanel.open({ tabId })
      })
      break
  }
})
```

### 8.2 Side Panel API

```typescript
// src/background/side-panel.ts
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error))

// Handle side panel opening from different contexts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'openSidePanel') {
    chrome.sidePanel.open({
      tabId: sender.tab?.id || chrome.tabs.TAB_ID_NONE
    })
    sendResponse({ success: true })
  }
  return false
})
```

### 8.3 Offscreen Document (Long-Running Tasks)

```typescript
// src/background/offscreen-manager.ts
let creatingOffscreen: Promise<void> | null = null

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  })

  if (existingContexts.length > 0) return

  if (creatingOffscreen) {
    await creatingOffscreen
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run long-running AI tasks without blocking service worker'
    })
    await creatingOffscreen
    creatingOffscreen = null
  }
}

// Use for heavy computation
export async function runInOffscreen<T>(
  task: string,
  payload: unknown
): Promise<T> {
  await ensureOffscreenDocument()

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { target: 'offscreen', task, payload },
      (response) => {
        if (response.error) reject(new Error(response.error))
        else resolve(response.result)
      }
    )
  })
}
```

### 8.4 Alarms for Background Tasks

```typescript
// src/background/alarms.ts
// Periodic tasks (backup reminders, sync, etc.)
chrome.alarms.create('cherry-sync', { periodInMinutes: 30 })
chrome.alarms.create('cherry-backup-reminder', { periodInMinutes: 1440 }) // Daily

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case 'cherry-sync':
      // Sync settings across devices if enabled
      const settings = await chrome.storage.local.get('syncEnabled')
      if (settings.syncEnabled) {
        await syncToCloud()
      }
      break

    case 'cherry-backup-reminder':
      // Show notification to backup
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Cherry Studio Backup',
        message: 'Consider backing up your conversations and settings.'
      })
      break
  }
})
```

---

## 9. Phase 7: Testing & QA

### 9.1 Testing Strategy

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/']
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@aiCore': resolve(__dirname, 'src/packages/aiCore')
    }
  }
})
```

```typescript
// test/setup.ts
import { vi } from 'vitest'

// Mock Chrome APIs
global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    },
    getContexts: vi.fn().mockResolvedValue([]),
    openOptionsPage: vi.fn()
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined)
    },
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined)
    }
  },
  sidePanel: {
    open: vi.fn(),
    setPanelBehavior: vi.fn().mockResolvedValue(undefined)
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn()
    }
  },
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 1 }]),
    sendMessage: vi.fn()
  },
  alarms: {
    create: vi.fn(),
    onAlarm: {
      addListener: vi.fn()
    }
  }
} as unknown as typeof chrome
```

### 9.2 Test Categories

1. **Unit Tests**
   - AI Service methods
   - Storage Service methods
   - Message routing
   - Redux slices

2. **Integration Tests**
   - Message passing flow
   - Storage persistence
   - AI provider calls (mocked)

3. **E2E Tests (Manual)**
   - Full chat flow
   - Provider configuration
   - Context menu actions
   - Side panel interactions

---

## 10. Feature Comparison Matrix

| Feature | Electron | Extension | Notes |
|---------|----------|-----------|-------|
| **AI Chat** | ✅ | ✅ | Full parity |
| **Streaming responses** | ✅ | ✅ | Full parity |
| **Multiple providers** | ✅ | ✅ | Full parity |
| **Conversation history** | ✅ | ✅ | Full parity |
| **Multiple assistants** | ✅ | ✅ | Full parity |
| **Code highlighting** | ✅ | ✅ | Full parity |
| **Image generation** | ✅ | ✅ | Full parity |
| **Dark/light themes** | ✅ | ✅ | Full parity |
| **Quick phrases** | ✅ | ✅ | Full parity |
| **Translation** | ✅ | ✅ | Full parity |
| **Export (JSON)** | ✅ | ✅ | Full parity |
| **MCP (HTTP/SSE)** | ✅ | ✅ | Full parity |
| **MCP (stdio)** | ✅ | ❌ | Not possible |
| **File attachments** | ✅ | ⚠️ | Via file picker |
| **Knowledge base** | ✅ | ⚠️ | API embeddings only |
| **OCR** | ✅ | ⚠️ | Tesseract.js |
| **Local backup** | ✅ | ⚠️ | Download only |
| **Cloud backup** | ✅ | ✅ | Full parity |
| **System shortcuts** | ✅ | ⚠️ | Limited |
| **Selection toolbar** | ✅ | ⚠️ | Context menu |
| **System tray** | ✅ | ❌ | Not available |
| **Multi-window** | ✅ | ⚠️ | Popup + Panel |
| **Auto-update** | ✅ | ✅ | Chrome handles |
| **Code execution** | ✅ | ❌ | Security risk |
| **Full-screen mode** | ✅ | ❌ | Not applicable |

**Legend:** ✅ Full support | ⚠️ Limited/adapted | ❌ Not available

---

## 11. Technical Risks & Mitigations

### Risk 1: Service Worker Limitations
**Issue:** Service workers have a 5-minute idle timeout and may be terminated.

**Mitigation:**
- Use offscreen documents for long-running tasks
- Implement reconnection logic for MCP servers
- Cache intermediate states in chrome.storage.session
- Use chrome.alarms for periodic tasks

### Risk 2: Storage Limits
**Issue:** chrome.storage.local has 10MB limit (unlimited with permission).

**Mitigation:**
- Request "unlimitedStorage" permission
- Use IndexedDB for large data (conversations, files)
- Implement data cleanup/archival strategies

### Risk 3: Cross-Origin Requests
**Issue:** Extension context has different CORS behavior.

**Mitigation:**
- Declare host_permissions for AI provider APIs
- Use background service worker for API calls
- Handle CORS errors gracefully

### Risk 4: Memory Constraints
**Issue:** Extension memory is more constrained than desktop app.

**Mitigation:**
- Implement message pagination
- Lazy load conversation history
- Optimize component rendering
- Clear unused data proactively

### Risk 5: Migration Complexity
**Issue:** Large codebase with many interdependencies.

**Mitigation:**
- Extract aiCore as independent package first
- Migrate in phases with clear milestones
- Maintain test coverage throughout
- Create adapter layers for gradual migration

---

## 12. Migration Checklist

### Phase 1: Foundation (Estimated: Week 1-2)
- [ ] Initialize new extension project structure
- [ ] Configure Vite + CRXJS build pipeline
- [ ] Set up Manifest V3 configuration
- [ ] Implement message passing infrastructure
- [ ] Create Chrome storage adapters

### Phase 2: Core AI (Estimated: Week 2-3)
- [ ] Extract aiCore package
- [ ] Implement AI service in background worker
- [ ] Create streaming response handler
- [ ] Test all AI providers
- [ ] Implement MCP service (HTTP/SSE)

### Phase 3: Data Layer (Estimated: Week 3-4)
- [ ] Migrate IndexedDB schema
- [ ] Implement Chrome storage service
- [ ] Create Redux store with chrome.storage persistence
- [ ] Build data migration utility (Electron → Extension)
- [ ] Test persistence across extension restarts

### Phase 4: UI Migration (Estimated: Week 4-6)
- [ ] Set up side panel with React
- [ ] Migrate chat interface components
- [ ] Migrate settings pages
- [ ] Implement popup quick actions
- [ ] Add content script selection handling
- [ ] Theme system adaptation

### Phase 5: Chrome Features (Estimated: Week 6-7)
- [ ] Implement context menus
- [ ] Configure keyboard shortcuts
- [ ] Add notification support
- [ ] Implement offscreen document
- [ ] Set up alarm-based tasks

### Phase 6: Polish & QA (Estimated: Week 7-8)
- [ ] Performance optimization
- [ ] Memory usage audit
- [ ] Cross-browser testing (Chrome, Edge)
- [ ] Security review
- [ ] Write documentation
- [ ] Prepare for Chrome Web Store submission

---

## Appendix A: Package.json Template

```json
{
  "name": "cherry-studio-extension",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "build:check": "pnpm lint && pnpm test && tsc --noEmit",
    "lint": "biome check --apply .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@aiCore": "workspace:*",
    "@ant-design/icons": "^5.6.1",
    "@reduxjs/toolkit": "^2.2.5",
    "ai": "^5.0.98",
    "@ai-sdk/openai": "^2.0.85",
    "@ai-sdk/anthropic": "^2.0.49",
    "@ai-sdk/google": "^2.0.49",
    "antd": "^5.27.0",
    "dexie": "^4.0.8",
    "dexie-react-hooks": "^1.1.7",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-redux": "^9.1.2",
    "redux-persist": "^6.0.0",
    "shiki": "^3.12.0"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0",
    "@types/chrome": "^0.0.268",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^6.3.0",
    "vitest": "^2.0.0"
  }
}
```

---

## Appendix B: Migration Priority Matrix

| Component | Priority | Effort | Value | Recommendation |
|-----------|----------|--------|-------|----------------|
| aiCore package | P0 | Low | Critical | Extract first |
| Chat interface | P0 | Medium | Critical | Core feature |
| Provider settings | P0 | Low | Critical | Required |
| Message storage | P0 | Medium | Critical | Core feature |
| Side panel UI | P0 | Medium | Critical | Main interface |
| Context menus | P1 | Low | High | Chrome-native |
| MCP (HTTP) | P1 | Medium | High | Power users |
| Knowledge base | P2 | High | Medium | Partial support |
| File attachments | P2 | Medium | Medium | Limited |
| OCR | P3 | Medium | Low | Tesseract.js |
| Code execution | Drop | N/A | N/A | Security risk |
| System toolbar | Drop | N/A | N/A | Not possible |

---

*Document Version: 1.0*
*Created: 2026-01-15*
*Project: Cherry Studio Chrome Extension Port*
