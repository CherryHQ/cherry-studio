import { hostname, networkInterfaces } from 'node:os'

import { collaborationService, workerRuntimeService } from '@main/services/agents'
import { collaborationRuntimeService } from '@main/services/agents/services/CollaborationRuntimeService'
import { mobileToolbarService } from '@main/services/MobileToolbarService'
import type { MobileToolbarAction, MobileToolbarSnapshot } from '@shared/types/mobileToolbar'
import express from 'express'

import { config } from '../../config'

const mobileRouter = express.Router()
const MOBILE_PAGE_BUILD = 'mobile-page-20260508-7'
const MOBILE_SHELL_BUILD = 'mobile-shell-20260508-7'
const MOBILE_UI_LABEL = '移动版 v2.5'

const getToolbarSnapshot = (): MobileToolbarSnapshot | null => {
  const snapshot = mobileToolbarService.getSnapshot()
  return snapshot && Array.isArray(snapshot.tools) ? snapshot : null
}

const getRequestToken = (req: express.Request) => {
  const header = req.header('x-mobile-token')
  if (header) return header
  const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (bearer) return bearer
  return typeof req.query.token === 'string' ? req.query.token : ''
}

const requireMobileToken: express.RequestHandler = async (req, res, next) => {
  const serverConfig = await config.get()
  if (getRequestToken(req) !== serverConfig.apiKey) {
    return res.status(401).json({
      error: {
        message: 'Invalid mobile token',
        type: 'unauthorized',
        code: 'mobile_token_invalid'
      }
    })
  }
  return next()
}

const isTailscaleIPv4 = (value: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(value)

const getAccessHosts = () => {
  const lanHosts: string[] = []
  const tailscaleHosts: string[] = []

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal || address.family !== 'IPv4') continue
      const isTail = name.toLowerCase().includes('tailscale') || isTailscaleIPv4(address.address)
      if (isTail) {
        tailscaleHosts.push(address.address)
      } else {
        lanHosts.push(address.address)
      }
    }
  }

  return {
    lanHost: lanHosts[0] ?? '127.0.0.1',
    lanHosts: Array.from(new Set(lanHosts)),
    tailscaleHosts: Array.from(new Set(tailscaleHosts)),
    machineName: hostname()
  }
}

const getDefaultWorkspace = async () => {
  const workspaces = await collaborationService.listWorkspaces()
  if (workspaces[0]) return workspaces[0]
  return collaborationService.createWorkspace({ name: '本机任务台' })
}

const renderMobileHtml = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#111214" />
  <meta name="cherry-mobile-build" content="${MOBILE_PAGE_BUILD}" />
  <link rel="icon" href="data:," />
  <title>Cherry 镜像</title>
  <style>
    :root {
      color-scheme: dark;
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
      --bg: #111214;
      --panel: #181a1e;
      --panel-2: #202328;
      --panel-soft: #14161a;
      --line: #30343b;
      --line-soft: rgba(255, 255, 255, 0.08);
      --text: #f4f5f7;
      --muted: #a0a7b2;
      --faint: #737b86;
      --accent: #25c77a;
      --accent-2: #f0b35a;
      --danger: #ff6f73;
      --bubble-user: #123828;
      --bubble-worker: #202328;
      --bubble-event: #191b20;
      --shadow: 0 16px 32px rgba(0, 0, 0, 0.26);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      min-height: 100dvh;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
    }
    body { min-height: 100dvh; }
    button, input, textarea, select {
      font: inherit;
      color: inherit;
    }
    button {
      appearance: none;
      border: 1px solid var(--line);
      background: var(--panel-2);
      min-height: 38px;
      border-radius: 12px;
      padding: 0 12px;
    }
    button:disabled {
      opacity: 0.45;
    }
    textarea, input, select {
      width: 100%;
      border: 1px solid var(--line);
      background: #0f1013;
      border-radius: 12px;
      outline: none;
    }
    textarea {
      min-height: 42px;
      max-height: 120px;
      resize: none;
      padding: 11px 12px;
      line-height: 1.45;
    }
    input, select {
      min-height: 40px;
      padding: 0 12px;
    }
    .shell {
      height: 100dvh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      background: var(--bg);
    }
    .topbar {
      flex: 0 0 auto;
      min-height: 56px;
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: calc(8px + var(--safe-top)) 10px 8px;
      border-bottom: 1px solid var(--line-soft);
      background: rgba(17, 18, 20, 0.92);
      backdrop-filter: blur(16px);
    }
    .icon-btn {
      min-width: 40px;
      width: 40px;
      height: 40px;
      padding: 0;
      display: inline-grid;
      place-items: center;
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.04);
      font-size: 17px;
      line-height: 1;
    }
    .title-block {
      min-width: 0;
      text-align: left;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .title-row h1 {
      margin: 0;
      min-width: 0;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.18;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: var(--faint);
    }
    .status-dot.ok { background: var(--accent); }
    .status-dot.err { background: var(--danger); }
    .subtitle {
      margin-top: 3px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .subtitle.idle { color: var(--accent); }
    .subtitle.busy { color: var(--danger); }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .chat {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background:
        linear-gradient(180deg, rgba(37, 199, 122, 0.08), transparent 160px),
        var(--bg);
    }
    .message-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      padding: 12px 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .day-chip {
      align-self: center;
      padding: 4px 9px;
      color: var(--faint);
      font-size: 11px;
      border: 1px solid var(--line-soft);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.03);
    }
    .message {
      width: fit-content;
      max-width: min(82vw, 680px);
      border: 1px solid var(--line-soft);
      border-radius: 16px;
      padding: 9px 11px;
      background: var(--bubble-worker);
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
    }
    .message.user {
      align-self: flex-end;
      background: var(--bubble-user);
      border-color: rgba(37, 199, 122, 0.24);
    }
    .message.system,
    .message.event {
      align-self: center;
      max-width: 92%;
      background: var(--bubble-event);
      border-style: dashed;
    }
    .message.task {
      border-color: rgba(240, 179, 90, 0.34);
      background: rgba(240, 179, 90, 0.08);
    }
    .message-head {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 5px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.2;
      flex-wrap: wrap;
    }
    .message-body {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.48;
      font-size: 14px;
    }
    .empty-state {
      margin: auto 8px;
      padding: 18px 16px;
      border: 1px dashed var(--line);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.03);
      text-align: center;
      color: var(--muted);
    }
    .empty-state strong {
      display: block;
      margin-bottom: 7px;
      color: var(--text);
      font-size: 16px;
    }
    .empty-state p {
      margin: 0 0 12px;
      font-size: 13px;
      line-height: 1.5;
    }
    .composer {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 10px max(10px, var(--safe-bottom));
      border-top: 1px solid var(--line-soft);
      background: rgba(17, 18, 20, 0.96);
      backdrop-filter: blur(18px);
    }
    .composer-row {
      display: flex;
      align-items: end;
      gap: 8px;
    }
    .toolbar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }
    .toolbar-row::-webkit-scrollbar {
      display: none;
    }
    .toolbar-btn {
      min-width: 44px;
      width: 44px;
      height: 44px;
      padding: 0;
      flex: 0 0 auto;
      border-radius: 14px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.03);
    }
    .toolbar-btn.active {
      color: var(--text);
      border-color: rgba(37, 199, 122, 0.34);
      background: rgba(37, 199, 122, 0.12);
    }
    .toolbar-btn:disabled,
    .toolbar-btn.disabled {
      opacity: 0.38;
    }
    .toolbar-btn svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.85;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .task-fields {
      display: none;
      grid-template-columns: 1fr;
      gap: 7px;
    }
    .task-fields.show {
      display: grid;
    }
    .send-btn {
      min-width: 48px;
      width: 48px;
      height: 42px;
      padding: 0;
      border-color: rgba(37, 199, 122, 0.36);
      background: rgba(37, 199, 122, 0.16);
      font-weight: 700;
    }
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
      background: rgba(0, 0, 0, 0.48);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.16s ease;
    }
    .drawer-backdrop.show {
      opacity: 1;
      pointer-events: auto;
    }
    .drawer {
      position: fixed;
      top: 0;
      bottom: 0;
      z-index: 21;
      width: min(88vw, 360px);
      display: flex;
      flex-direction: column;
      background: #16181c;
      border-right: 1px solid var(--line);
      box-shadow: var(--shadow);
      transform: translateX(-104%);
      transition: transform 0.18s ease;
    }
    .drawer.right {
      right: 0;
      border-right: 0;
      border-left: 1px solid var(--line);
      transform: translateX(104%);
    }
    .drawer.show {
      transform: translateX(0);
    }
    .drawer-head {
      min-height: 54px;
      padding: calc(8px + var(--safe-top)) 10px 8px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border-bottom: 1px solid var(--line-soft);
    }
    .drawer-head h2 {
      margin: 0;
      font-size: 16px;
    }
    .drawer-head-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .drawer-action-btn {
      min-height: 34px;
      padding: 0 12px;
      border-radius: 11px;
      font-size: 12px;
      color: var(--text);
      border-color: rgba(37, 199, 122, 0.3);
      background: rgba(37, 199, 122, 0.12);
    }
    .drawer-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 10px 10px max(10px, var(--safe-bottom));
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .room-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: stretch;
      gap: 8px;
    }
    .room-main {
      min-width: 0;
    }
    .room-archive-btn {
      min-width: 42px;
      width: 42px;
      height: 42px;
      padding: 0;
      display: inline-grid;
      place-items: center;
      border-radius: 12px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.035);
      line-height: 1;
    }
    .room-archive-btn:hover {
      color: var(--text);
      border-color: rgba(255, 255, 255, 0.16);
    }
    .room-archive-btn svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .room-item, .worker-item, .detail-card, .diagnostics-card {
      width: 100%;
      text-align: left;
      border: 1px solid var(--line-soft);
      border-radius: 14px;
      padding: 11px;
      background: rgba(255, 255, 255, 0.035);
    }
    .room-item.active {
      border-color: rgba(37, 199, 122, 0.34);
      background: rgba(37, 199, 122, 0.1);
    }
    .item-title {
      display: block;
      color: var(--text);
      font-size: 14px;
      font-weight: 650;
      line-height: 1.3;
      margin-bottom: 5px;
    }
    .item-meta, .detail-card p, .diagnostics-card p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
    }
    .diagnostics-card summary {
      cursor: pointer;
      color: var(--accent);
      font-size: 13px;
      font-weight: 650;
    }
    .diagnostics-card div {
      display: grid;
      gap: 5px;
      margin-top: 9px;
    }
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: none;
      place-items: center;
      padding: 22px;
      background:
        linear-gradient(180deg, rgba(17, 18, 20, 0.78), rgba(17, 18, 20, 0.96)),
        var(--bg);
    }
    .overlay.show {
      display: grid;
    }
    .overlay-card {
      width: min(100%, 360px);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 20px;
      background: var(--panel);
      box-shadow: var(--shadow);
      text-align: center;
    }
    .overlay-card strong {
      display: block;
      margin-bottom: 8px;
      font-size: 18px;
    }
    .overlay-card p {
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <div id="drawer-backdrop" class="drawer-backdrop"></div>
  <aside id="rooms-drawer" class="drawer">
    <div class="drawer-head">
      <h2>会话</h2>
      <div class="drawer-head-actions">
        <button id="open-task-compose" class="drawer-action-btn" type="button">新任务</button>
        <button id="close-rooms" class="icon-btn" type="button" aria-label="关闭会话">×</button>
      </div>
    </div>
    <div id="room-list" class="drawer-body"></div>
  </aside>
  <aside id="details-drawer" class="drawer right">
    <div class="drawer-head">
      <h2>状态</h2>
      <button id="close-details" class="icon-btn" type="button" aria-label="关闭状态">×</button>
    </div>
    <div class="drawer-body">
      <details class="diagnostics-card">
        <summary>连接诊断</summary>
        <div>
          <p>页面：${MOBILE_PAGE_BUILD}</p>
          <p>地址：<span id="diagnostics-url"></span></p>
          <p>服务：<span id="diagnostics-server">等待连接</span></p>
          <p>来源：<span id="diagnostics-source">ios</span></p>
        </div>
      </details>
      <div id="detail-panel"></div>
      <div id="worker-panel"></div>
    </div>
  </aside>
  <div class="shell">
    <header class="topbar">
      <button id="open-rooms" class="icon-btn" type="button" aria-label="打开会话">☰</button>
      <div class="title-block">
        <div class="title-row">
          <span id="status-dot" class="status-dot"></span>
          <h1 id="top-title">Cherry 镜像</h1>
        </div>
        <div id="top-subtitle" class="subtitle">${MOBILE_UI_LABEL}</div>
      </div>
      <div class="top-actions">
        <button id="refresh" class="icon-btn" type="button" aria-label="刷新">↻</button>
        <button id="open-details" class="icon-btn" type="button" aria-label="打开状态">⋯</button>
      </div>
    </header>
    <main class="chat">
      <section id="feed" class="message-list" aria-live="polite"></section>
      <section class="composer">
        <div id="toolbar" class="toolbar-row" aria-label="工具栏"></div>
        <div id="task-fields" class="task-fields">
          <input id="title" placeholder="任务标题（可选）" />
          <select id="worker"></select>
        </div>
        <div class="composer-row">
          <textarea id="content" placeholder="写点什么，发到当前会话"></textarea>
          <button id="send" class="send-btn" type="button">发</button>
        </div>
      </section>
    </main>
  </div>
  <div id="overlay" class="overlay">
    <div class="overlay-card">
      <strong id="overlay-title">正在连接</strong>
      <p id="overlay-body">正在读取桌面端状态。</p>
      <button id="overlay-action" type="button">重试</button>
    </div>
  </div>
  <script>
    const params = new URLSearchParams(location.search)
    const safeStorageGet = (key) => {
      try { return localStorage.getItem(key) } catch (_error) { return null }
    }
    const safeStorageSet = (key, value) => {
      try {
        if (value) localStorage.setItem(key, value)
        else localStorage.removeItem(key)
      } catch (_error) {}
    }
    const token = params.get('token') || safeStorageGet('cherry-mobile-token') || ''
    if (params.get('token')) safeStorageSet('cherry-mobile-token', params.get('token'))

    const KEY_LAST_ROOM = 'cherry-mobile-last-room'
    const KEY_MODE = 'cherry-mobile-compose-mode'
    const KEY_WORKER = 'cherry-mobile-worker'

    let activeRoomId = params.get('roomId') || safeStorageGet(KEY_LAST_ROOM) || ''
    let composeMode = safeStorageGet(KEY_MODE) || 'message'
    let loading = false
    let timer = null
    let state = { workspace: null, rooms: [], messages: [], workers: [], toolbar: null }
    let diagnostics = null
    let toolbarState = {
      reasoningEffort: 'default',
      permissionMode: 'bypassPermissions',
      toolsEnabled: true,
      commandMode: 'plain'
    }

    const statusDotEl = document.getElementById('status-dot')
    const topTitleEl = document.getElementById('top-title')
    const topSubtitleEl = document.getElementById('top-subtitle')
    const feedEl = document.getElementById('feed')
    const toolbarEl = document.getElementById('toolbar')
    const titleEl = document.getElementById('title')
    const contentEl = document.getElementById('content')
    const workerEl = document.getElementById('worker')
    const taskFieldsEl = document.getElementById('task-fields')
    const sendBtn = document.getElementById('send')
    const roomsDrawerEl = document.getElementById('rooms-drawer')
    const detailsDrawerEl = document.getElementById('details-drawer')
    const backdropEl = document.getElementById('drawer-backdrop')
    const roomListEl = document.getElementById('room-list')
    const detailPanelEl = document.getElementById('detail-panel')
    const workerPanelEl = document.getElementById('worker-panel')
    const diagnosticsUrlEl = document.getElementById('diagnostics-url')
    const diagnosticsServerEl = document.getElementById('diagnostics-server')
    const diagnosticsSourceEl = document.getElementById('diagnostics-source')
    const overlayEl = document.getElementById('overlay')
    const overlayTitleEl = document.getElementById('overlay-title')
    const overlayBodyEl = document.getElementById('overlay-body')
    const overlayActionEl = document.getElementById('overlay-action')
    const openTaskComposeBtn = document.getElementById('open-task-compose')

    const normalizeToken = () => String(token || '').trim()
    const selectedRoom = () => state.rooms.find((item) => item.id === activeRoomId)
    const findWorkerByAgentId = (agentId) => state.workers.find((item) => item.primaryInstanceId === agentId || item.agent?.id === agentId)
    const selectedWorker = () => {
      const room = selectedRoom()
      const roomMetadata = room && room.metadata && typeof room.metadata === 'object' ? room.metadata : null
      const selectedWorkerKey = roomMetadata && typeof roomMetadata.selectedWorkerKey === 'string' ? roomMetadata.selectedWorkerKey : ''

      if (room?.assignedAgentId) {
        const byAgent = findWorkerByAgentId(room.assignedAgentId)
        if (byAgent) return byAgent
      }
      if (selectedWorkerKey) {
        const byKey = state.workers.find((item) => item.type === selectedWorkerKey)
        if (byKey) return byKey
      }

      const preferredKey = workerEl.value || safeStorageGet(KEY_WORKER) || ''
      if (preferredKey) {
        const byPreference = state.workers.find((item) => item.type === preferredKey)
        if (byPreference) return byPreference
      }

      return (
        state.workers.find((item) => item.type === 'hermes' && item.canRun) ||
        state.workers.find((item) => item.canRun) ||
        state.workers[0] ||
        null
      )
    }
    const statusLabel = (status, assignedAgentId) => {
      if (status === 'todo' && !assignedAgentId) return '待整理'
      return ({ todo: '待办', in_progress: '进行中', needs_confirmation: '待确认', done: '已完成', blocked: '已阻塞' })[status] || '未知'
    }
    const roleLabel = (message) => {
      if (message.authorType === 'user') return '你'
      if (message.authorType === 'system') return '系统'
      return 'Worker'
    }
    const kindLabel = (message) => {
      if (message.kind === 'task') return '任务'
      if (message.kind === 'event') return '事件'
      return '消息'
    }
    const displayMessageContent = (message) =>
      String(message.content || '')
        .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/^\s+/, '')
    const formatTime = (value) => {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    const setConnectionStatus = (status) => {
      statusDotEl.className = 'status-dot' + (status === 'ok' ? ' ok' : status === 'err' ? ' err' : '')
    }
    const showOverlay = (title, body, actionText) => {
      overlayTitleEl.textContent = title
      overlayBodyEl.textContent = body
      overlayActionEl.textContent = actionText || '重试'
      overlayEl.classList.add('show')
    }
    const hideOverlay = () => {
      overlayEl.classList.remove('show')
    }
    const closeDrawers = () => {
      roomsDrawerEl.classList.remove('show')
      detailsDrawerEl.classList.remove('show')
      backdropEl.classList.remove('show')
    }
    const openRooms = () => {
      detailsDrawerEl.classList.remove('show')
      roomsDrawerEl.classList.add('show')
      backdropEl.classList.add('show')
    }
    const openDetails = () => {
      roomsDrawerEl.classList.remove('show')
      detailsDrawerEl.classList.add('show')
      backdropEl.classList.add('show')
    }
    const persistLastRoom = () => {
      safeStorageSet(KEY_LAST_ROOM, activeRoomId)
      const url = new URL(window.location.href)
      if (activeRoomId) url.searchParams.set('roomId', activeRoomId)
      else url.searchParams.delete('roomId')
      history.replaceState({}, '', url.toString())
    }
    const api = async (path, options = {}) => {
      const sep = path.includes('?') ? '&' : '?'
      const response = await fetch(path + sep + 'token=' + encodeURIComponent(normalizeToken()), {
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        ...options
      })
      if (!response.ok) {
        const message = await response.text()
        const error = new Error(message || ('请求失败：' + response.status))
        error.status = response.status
        throw error
      }
      return response.json()
    }
    const createEmptyState = (title, body, actionLabel, action) => {
      const empty = document.createElement('div')
      empty.className = 'empty-state'
      const strong = document.createElement('strong')
      strong.textContent = title
      const text = document.createElement('p')
      text.textContent = body
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = actionLabel
      btn.onclick = action
      empty.append(strong, text, btn)
      return empty
    }
    const normalizeDispatchContent = (content) => {
      const trimmed = String(content || '').trim()
      if (!trimmed) return ''
      if (toolbarState.commandMode === 'plan' && !trimmed.startsWith('/plan')) {
        return '/plan ' + trimmed
      }
      return trimmed
    }
    const deriveToolbarState = (toolbar) => {
      const derived = {
        reasoningEffort: 'default',
        permissionMode: toolbarState.permissionMode,
        toolsEnabled: true,
        commandMode: 'plain'
      }
      const tools = Array.isArray(toolbar && toolbar.tools) ? toolbar.tools : []
      tools.forEach((tool) => {
        if (tool.key === 'reasoning') {
          const match = String(tool.label || '').match(/思考：(.+)$/)
          const label = match ? match[1] : '默认'
          derived.reasoningEffort = ({ '默认': 'default', '关闭': 'none', '轻度': 'low', '中等': 'medium', '深入': 'high', '超强': 'xhigh' })[label] || 'default'
        }
        if (tool.key === 'permission_mode') {
          const match = String(tool.label || '').match(/模式：(.+)$/)
          const label = match ? match[1] : ''
          derived.permissionMode = ({ 'Full Auto Mode': 'bypassPermissions', 'Plan Mode': 'plan', 'Accept Edits': 'acceptEdits', 'Read Only': 'default' })[label] || derived.permissionMode
        }
        if (tool.key === 'tools_toggle') {
          derived.toolsEnabled = /开启$/.test(String(tool.label || '')) || tool.active === true
        }
        if (tool.key === 'plan_command') {
          derived.commandMode = /\/plan$/.test(String(tool.label || '')) || tool.active === true ? 'plan' : 'plain'
        }
      })
      return derived
    }
    const toolbarIconSvg = (icon) => {
      const paths = {
        'paperclip': '<path d="M21.44 11.05 12 20.5a5 5 0 0 1-7.07-7.07l9.9-9.9a3.5 3.5 0 1 1 4.95 4.95L9.17 19.09a2 2 0 0 1-2.83-2.83l9.19-9.19" />',
        'lightbulb': '<path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.74c.53.38 1 .95 1.28 1.6L9.5 17h5l.22-.66c.28-.65.75-1.22 1.28-1.6A7 7 0 0 0 12 2Z" />',
        'globe': '<circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18" /><path d="M12 3a15 15 0 0 0 0 18" />',
        'link': '<path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 13" /><path d="M14 11a5 5 0 0 1 0 7L12.5 19.5a5 5 0 1 1-7-7L7 11" />',
        'hammer': '<path d="M14 4 20 10" /><path d="M12 6 18 12" /><path d="M8 10l6-6" /><path d="M3 21l8-8" />',
        'wrench': '<path d="M14.7 6.3a3.5 3.5 0 1 0 3 3l-5.8 5.8a2 2 0 1 0 2.8 2.8l5.8-5.8a3.5 3.5 0 0 0-5.8-5.8Z" /><path d="m9 15-4 4" />',
        'command': '<path d="M6 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm12-14a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" /><path d="M8 5h8v14H8Z" />',
        'terminal': '<path d="M4 17 10 12 4 7" /><path d="M12 19h8" />',
        'at-sign': '<circle cx="12" cy="12" r="4" /><path d="M16 8v5a2 2 0 1 0 4 0 8 8 0 1 0-3 6.3" />',
        'zap': '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />',
        'message-square-plus': '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h9" /><path d="M17 3v6" /><path d="M14 6h6" />',
        'route': '<circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h5a3 3 0 0 0 3-3V8" /><circle cx="18" cy="18" r="2" />',
        'folder-pen': '<path d="M3 20h7" /><path d="M3 8h5l2 2h11v4" /><path d="M16 19l5-5" /><path d="m18 12 3 3" />',
        'refresh-ccw': '<path d="M3 12a9 9 0 0 1 15.3-6.36L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.3 6.36L3 16" /><path d="M8 16H3v5" />',
        'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18 2l4 4" /><path d="M16 4 7 13v4h4l9-9" />',
        'sparkles': '<path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /><path d="M5 14l.6 1.4L7 16l-1.4.6L5 18l-.6-1.4L3 16l1.4-.6L5 14Z" />',
        'image': '<rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m21 15-4.5-4.5L8 19" />',
        'file-search': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><circle cx="11" cy="14" r="2.5" /><path d="m13 16 2.2 2.2" />',
        'panel-top-open': '<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="m9 15 3-3 3 3" />',
        'circle-x': '<circle cx="12" cy="12" r="9" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />',
        'archive': '<rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" />'
      }
      return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[icon] || paths.globe) + '</svg>'
    }
    const renderToolbar = () => {
      toolbarEl.replaceChildren()
      const toolbar = state.toolbar
      toolbarState = deriveToolbarState(toolbar)
      const tools = Array.isArray(toolbar && toolbar.tools) ? toolbar.tools.slice(0, 5) : []
      if (!tools.length) {
        toolbarEl.classList.add('hidden')
        return
      }
      toolbarEl.classList.remove('hidden')
      tools.forEach((tool) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'toolbar-btn' + (tool.active ? ' active' : '') + (tool.enabled ? '' : ' disabled')
        button.setAttribute('aria-label', tool.label)
        button.disabled = !tool.enabled
        button.innerHTML = toolbarIconSvg(tool.icon)
        button.onclick = async () => {
          if (!tool.enabled) return
          button.classList.add('active')
          try {
            await api('/mobile/api/toolbar/actions', {
              method: 'POST',
              body: JSON.stringify({ key: tool.key, action: 'tap' })
            })
            await load()
          } catch (_error) {
            void load()
          }
        }
        toolbarEl.append(button)
      })
    }
    const renderRooms = () => {
      roomListEl.replaceChildren()
      if (!state.rooms.length) {
        roomListEl.append(createEmptyState('还没有会话', '从会话抽屉里发起一个新任务，手机端就会直达对应工作区。', '新建任务', () => {
          closeDrawers()
          setComposeMode('task')
          contentEl.focus()
        }))
        return
      }
      state.rooms.forEach((room) => {
        const row = document.createElement('div')
        row.className = 'room-row'
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'room-item room-main' + (room.id === activeRoomId ? ' active' : '')
        item.onclick = () => {
          activeRoomId = room.id
          persistLastRoom()
          closeDrawers()
          void load({ preserveInput: true })
        }
        const title = document.createElement('span')
        title.className = 'item-title'
        title.textContent = room.title
        const meta = document.createElement('span')
        meta.className = 'item-meta'
        meta.textContent = statusLabel(room.status, room.assignedAgentId) + ' / ' + room.id.slice(0, 8)
        item.append(title, meta)
        const archiveBtn = document.createElement('button')
        archiveBtn.type = 'button'
        archiveBtn.className = 'room-archive-btn'
        archiveBtn.setAttribute('aria-label', '归档会话')
        archiveBtn.title = '归档'
        archiveBtn.innerHTML = toolbarIconSvg('archive')
        archiveBtn.onclick = async (event) => {
          event.stopPropagation()
          const ok = window.confirm('归档这个会话？归档后会从手机和桌面任务台主列表隐藏。')
          if (!ok) return
          archiveBtn.disabled = true
          try {
            await api('/mobile/api/rooms/' + encodeURIComponent(room.id) + '/archive', { method: 'POST' })
            if (activeRoomId === room.id) {
              activeRoomId = ''
              persistLastRoom()
            }
            await load()
          } finally {
            archiveBtn.disabled = false
          }
        }
        row.append(item, archiveBtn)
        roomListEl.append(row)
      })
    }
    const renderWorkers = () => {
      const previous = workerEl.value || safeStorageGet(KEY_WORKER) || ''
      workerEl.replaceChildren()
      workerPanelEl.replaceChildren()

      const defaultOption = document.createElement('option')
      defaultOption.value = ''
      defaultOption.textContent = '不指定 Worker'
      workerEl.append(defaultOption)

      if (!state.workers.length) {
        workerPanelEl.append(createEmptyState('没有可展示的 Worker', '你仍然可以创建普通任务，稍后在桌面分配。', '知道了', closeDrawers))
      } else {
        state.workers.forEach((worker) => {
          const option = document.createElement('option')
          option.value = worker.canRun && worker.type ? worker.type : ''
          option.disabled = !worker.canRun || !worker.type
          option.textContent = worker.label + (worker.canRun ? '' : '（不可用）')
          workerEl.append(option)

          const card = document.createElement('div')
          card.className = 'worker-item'
          const title = document.createElement('span')
          title.className = 'item-title'
          title.textContent = worker.label
          const meta = document.createElement('p')
          meta.textContent = worker.healthLabel + ' / ' + (worker.workload?.label || '空闲')
          card.append(title, meta)
          workerPanelEl.append(card)
        })
      }
      workerEl.value = Array.from(workerEl.options).some((option) => option.value === previous) ? previous : ''
    }
    const renderDetails = () => {
      detailPanelEl.replaceChildren()
      const room = selectedRoom()
      const card = document.createElement('div')
      card.className = 'detail-card'
      const title = document.createElement('span')
      title.className = 'item-title'
      title.textContent = room ? room.title : '当前会话'
      const status = document.createElement('p')
      status.textContent = room
        ? '状态：' + statusLabel(room.status, room.assignedAgentId) + ' / 负责人：' + (room.assignedAgentId || '未指定')
        : '还没有选中会话'
      const id = document.createElement('p')
      id.textContent = room ? 'ID：' + room.id : '可以从左侧选择会话，或从会话抽屉发起新任务。'
      card.append(title, status, id)
      detailPanelEl.append(card)
    }
    const renderDiagnostics = () => {
      diagnosticsUrlEl.textContent = location.href
      diagnosticsSourceEl.textContent = params.get('client') || 'browser'
      diagnosticsServerEl.textContent = diagnostics
        ? diagnostics.build + ' / 房间 ' + diagnostics.counts.rooms + ' / Worker ' + diagnostics.counts.workers
        : '等待连接'
    }
    const renderHeader = () => {
      const worker = selectedWorker()
      const titleParts = [worker?.label, worker?.displayModelName].filter(Boolean)
      const isBusy = Boolean(worker?.workload?.activeRuns && worker.workload.activeRuns > 0)

      topTitleEl.textContent = titleParts.length ? titleParts.join(' ') : 'Cherry 镜像'
      topSubtitleEl.textContent = worker ? (isBusy ? '任务中' : '空闲') : ${JSON.stringify(MOBILE_UI_LABEL)}
      topSubtitleEl.className = 'subtitle' + (worker ? (isBusy ? ' busy' : ' idle') : '')
    }
    const renderMessages = () => {
      const room = selectedRoom()
      const nearBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 80
      feedEl.replaceChildren()
      const day = document.createElement('div')
      day.className = 'day-chip'
      day.textContent = ${JSON.stringify(MOBILE_PAGE_BUILD)}
      feedEl.append(day)

      if (!room) {
        feedEl.append(createEmptyState('还没有会话', '先发起一个任务，手机端就会直达对应工作区。', '新建任务', () => {
          setComposeMode('task')
          contentEl.focus()
        }))
        return
      }
      if (!state.messages.length) {
        feedEl.append(createEmptyState('这个会话还没有消息', '直接在底部派任务，桌面端会同步执行。', '派第一个任务', () => {
          setComposeMode('message')
          contentEl.focus()
        }))
        return
      }
      state.messages.forEach((message) => {
        const item = document.createElement('article')
        const roleClass = message.authorType === 'user' ? ' user' : message.authorType === 'system' ? ' system' : ''
        const kindClass = message.kind === 'task' ? ' task' : message.kind === 'event' ? ' event' : ''
        item.className = 'message' + roleClass + kindClass

        const head = document.createElement('div')
        head.className = 'message-head'
        head.textContent = roleLabel(message) + ' / ' + kindLabel(message) + (formatTime(message.createdAt) ? ' / ' + formatTime(message.createdAt) : '')

        const body = document.createElement('div')
        body.className = 'message-body'
        body.textContent = displayMessageContent(message)
        item.append(head, body)
        feedEl.append(item)
      })
      if (nearBottom) {
        requestAnimationFrame(() => {
          feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: 'smooth' })
        })
      }
    }
    const render = () => {
      renderHeader()
      renderToolbar()
      renderDiagnostics()
      renderRooms()
      renderWorkers()
      renderDetails()
      renderMessages()
    }
    const load = async () => {
      if (!normalizeToken()) {
        setConnectionStatus('err')
        showOverlay('缺少 Token', '请回桌面 Cherry 的 API 服务器设置里复制 Token，然后在 iOS 壳的连接设置中保存。', '重试')
        return
      }
      if (loading) return
      loading = true
      try {
        const query = activeRoomId ? '?roomId=' + encodeURIComponent(activeRoomId) : ''
        const next = await Promise.all([
          api('/mobile/api/state' + query),
          api('/mobile/api/diagnostics')
        ])
        state = next[0]
        diagnostics = next[1]
        if (state.rooms.length && !state.rooms.some((room) => room.id === activeRoomId)) {
          activeRoomId = state.selectedRoomId || state.rooms[0].id
        }
        if (!activeRoomId && state.selectedRoomId) activeRoomId = state.selectedRoomId
        persistLastRoom()
        hideOverlay()
        setConnectionStatus('ok')
        render()
      } catch (error) {
        setConnectionStatus('err')
        const isUnauthorized = error && error.status === 401
        showOverlay(
          isUnauthorized ? 'Token 不正确' : '连不上桌面 Cherry',
          isUnauthorized ? '请重新复制桌面端 API Token。' : '请确认桌面 Cherry API 服务已开启，并且手机使用的是 Mac 的局域网或 Tailscale 地址。',
          '重试'
        )
      } finally {
        loading = false
      }
    }
    const setComposeMode = (mode) => {
      composeMode = mode
      safeStorageSet(KEY_MODE, mode)
      taskFieldsEl.classList.toggle('show', mode === 'task')
      contentEl.placeholder = mode === 'task' ? '描述要做什么，可以指定 Worker' : '给当前会话派任务，桌面端会同步执行'
      sendBtn.textContent = mode === 'task' ? '建' : '发'
    }
    const sendMessage = async () => {
      const room = selectedRoom()
      const content = normalizeDispatchContent(contentEl.value)
      if (!room || !content) {
        if (!room) setComposeMode('task')
        return
      }
      sendBtn.disabled = true
      try {
        await api('/mobile/api/rooms/' + encodeURIComponent(room.id) + '/dispatch', {
          method: 'POST',
          body: JSON.stringify({
            content,
            reasoningEffort: toolbarState.reasoningEffort,
            permissionMode: toolbarState.permissionMode,
            toolsEnabled: toolbarState.toolsEnabled,
            commandMode: toolbarState.commandMode,
            workerType: selectedWorker()?.type || workerEl.value || undefined
          })
        })
        contentEl.value = ''
        await load()
      } finally {
        sendBtn.disabled = false
      }
    }
    const sendTask = async () => {
      const title = titleEl.value.trim() || contentEl.value.trim().slice(0, 24) || '手机任务'
      const content = contentEl.value.trim() || title
      if (!content) return
      sendBtn.disabled = true
      safeStorageSet(KEY_WORKER, workerEl.value)
      try {
        const created = await api('/mobile/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ title, content, workerType: workerEl.value || undefined })
        })
        titleEl.value = ''
        contentEl.value = ''
        activeRoomId = created?.room?.id || ''
        setComposeMode('message')
        persistLastRoom()
        await load()
      } finally {
        sendBtn.disabled = false
      }
    }
    const sendCurrent = () => {
      if (composeMode === 'task') return void sendTask()
      return void sendMessage()
    }
    const startAutoRefresh = () => {
      if (timer) clearInterval(timer)
      timer = window.setInterval(() => {
        if (document.activeElement === contentEl || document.activeElement === titleEl) return
        void load()
      }, 3000)
    }

    overlayActionEl.onclick = () => void load()
    document.getElementById('open-rooms').onclick = openRooms
    document.getElementById('open-details').onclick = openDetails
    document.getElementById('close-rooms').onclick = closeDrawers
    document.getElementById('close-details').onclick = closeDrawers
    document.getElementById('refresh').onclick = () => void load()
    backdropEl.onclick = closeDrawers
    openTaskComposeBtn.onclick = () => {
      closeDrawers()
      setComposeMode('task')
      contentEl.focus()
    }
    sendBtn.onclick = sendCurrent
    contentEl.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        sendCurrent()
      }
    })
    workerEl.addEventListener('change', () => safeStorageSet(KEY_WORKER, workerEl.value))

    setComposeMode(composeMode === 'task' ? 'task' : 'message')
    showOverlay('正在连接', '正在读取桌面端状态。', '重试')
    void load()
    startAutoRefresh()
  </script>
</body>
</html>`

mobileRouter.get('/', (_req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store'
  })
  res.type('html').send(renderMobileHtml())
})

mobileRouter.get('/api/info', requireMobileToken, async (req, res) => {
  const serverConfig = await config.get()
  const port = serverConfig.port
  const token = encodeURIComponent(getRequestToken(req))
  const { lanHost, lanHosts, tailscaleHosts, machineName } = getAccessHosts()
  const localUrl = `http://127.0.0.1:${port}`
  const lanUrls = lanHosts.map((host) => `http://${host}:${port}`)
  const tailscaleUrls = tailscaleHosts.map((host) => `http://${host}:${port}`)
  res.json({
    machineName,
    lanHost,
    lanHosts,
    tailscaleHosts,
    port,
    localUrl,
    lanUrls,
    tailscaleUrls,
    recommendedServiceUrl: tailscaleUrls[0] ?? lanUrls[0] ?? localUrl,
    mobileUrl: `http://${lanHost}:${port}/mobile?token=${token}`
  })
})

mobileRouter.get('/api/diagnostics', requireMobileToken, async (req, res) => {
  const serverConfig = await config.get()
  const workspace = await getDefaultWorkspace()
  const [rooms, workers] = await Promise.all([
    collaborationService.listRooms(workspace.id),
    workerRuntimeService.listWorkers()
  ])
  const { lanHosts, tailscaleHosts, machineName } = getAccessHosts()
  const localUrl = `http://127.0.0.1:${serverConfig.port}`
  const lanUrls = lanHosts.map((host) => `http://${host}:${serverConfig.port}`)
  const tailscaleUrls = tailscaleHosts.map((host) => `http://${host}:${serverConfig.port}`)

  res.json({
    build: MOBILE_PAGE_BUILD,
    shellBuild: MOBILE_SHELL_BUILD,
    label: MOBILE_UI_LABEL,
    tokenValid: true,
    serverTime: new Date().toISOString(),
    machineName,
    port: serverConfig.port,
    workspace: {
      id: workspace.id,
      name: workspace.name
    },
    counts: {
      rooms: rooms.length,
      workers: workers.length
    },
    urls: {
      local: localUrl,
      lan: lanUrls,
      tailscale: tailscaleUrls,
      recommended: tailscaleUrls[0] ?? lanUrls[0] ?? localUrl
    },
    request: {
      host: req.get('host') ?? '',
      ip: req.ip,
      userAgent: req.get('user-agent') ?? ''
    },
    currentPageUrl: `${req.protocol}://${req.get('host')}/mobile`
  })
})

mobileRouter.get('/api/state', requireMobileToken, async (req, res) => {
  const workspace = await getDefaultWorkspace()
  const [rooms, workers] = await Promise.all([
    collaborationService.listRooms(workspace.id),
    workerRuntimeService.listWorkers()
  ])
  const requestedRoomId = typeof req.query.roomId === 'string' ? req.query.roomId : ''
  const selectedRoom = rooms.find((room) => room.id === requestedRoomId) ?? rooms[0]
  const messages = selectedRoom ? await collaborationService.listRoomMessages(selectedRoom.id) : []

  res.json({
    workspace,
    rooms,
    workers,
    toolbar: getToolbarSnapshot(),
    selectedRoomId: selectedRoom?.id ?? null,
    messages
  })
})

mobileRouter.post('/api/toolbar/actions', requireMobileToken, async (req, res) => {
  const key = String(req.body?.key || '').trim()
  const action = String(req.body?.action || '').trim() as MobileToolbarAction['action']

  if (!key || action !== 'tap') {
    return res.status(400).json({ error: { message: 'key and tap action are required' } })
  }

  const accepted = await mobileToolbarService.requestAction({ key, action })
  if (!accepted) {
    return res.status(409).json({ error: { message: 'desktop toolbar is not ready' } })
  }

  return res.status(202).json({ ok: true })
})

mobileRouter.post('/api/tasks', requireMobileToken, async (req, res) => {
  const workspace = await getDefaultWorkspace()
  const title = String(req.body?.title || '').trim()
  const content = String(req.body?.content || title).trim()
  const workerType = String(req.body?.workerType || '').trim()
  if (!title || !content) {
    return res.status(400).json({ error: { message: 'title and content are required' } })
  }
  const workers = workerType ? await workerRuntimeService.listWorkers() : []
  const worker = workers.find((item) => item.type === workerType && item.canRun && item.agent)

  const room = await collaborationService.createRoom({
    workspaceId: workspace.id,
    title,
    status: 'todo',
    assignedAgentId: worker?.agent?.id,
    metadata: { source: 'mobile', selectedWorkerKey: worker?.type, selectedWorkerLabel: worker?.label }
  })
  const message = await collaborationService.createRoomMessage({
    roomId: room.id,
    authorType: 'user',
    kind: 'task',
    intent: 'task',
    routing: 'none',
    content,
    metadata: { source: 'mobile' }
  })

  void collaborationRuntimeService.handleTaskMessage(room.id, message.id)
  return res.status(201).json({ room, message })
})

mobileRouter.post('/api/rooms/:roomId/archive', requireMobileToken, async (req, res) => {
  const room = await collaborationService.archiveRoom(req.params.roomId)
  if (!room) {
    return res.status(404).json({ error: { message: 'room not found' } })
  }
  return res.status(200).json(room)
})

mobileRouter.post('/api/rooms/:roomId/dispatch', requireMobileToken, async (req, res) => {
  const rawContent = String(req.body?.content || '').trim()
  const commandMode = String(req.body?.commandMode || 'plain').trim() === 'plan' ? 'plan' : 'plain'
  const content = commandMode === 'plan' && !rawContent.startsWith('/plan') ? `/plan ${rawContent}` : rawContent
  const reasoningEffort = String(req.body?.reasoningEffort || '').trim() || undefined
  const permissionMode = String(req.body?.permissionMode || '').trim() || undefined
  const toolsEnabled = typeof req.body?.toolsEnabled === 'boolean' ? req.body.toolsEnabled : undefined
  const workerType = String(req.body?.workerType || '').trim() || undefined

  if (!content) {
    return res.status(400).json({ error: { message: 'content is required' } })
  }

  const room = await collaborationService.getRoom(req.params.roomId)
  if (!room) {
    return res.status(404).json({ error: { message: 'room not found' } })
  }

  const workers = await workerRuntimeService.listWorkers()
  const targetFamily = workerType ? workers.find((item) => item.type === workerType) : undefined
  const targetAgentId =
    room.assignedAgentId ||
    targetFamily?.primaryInstanceId ||
    targetFamily?.instances.find((item) => item.canRun)?.agent.id ||
    targetFamily?.agent?.id

  if (!targetAgentId) {
    const message = await collaborationService.createRoomMessage({
      roomId: room.id,
      authorType: 'user',
      kind: 'task',
      intent: 'task',
      routing: 'none',
      content,
      metadata: {
        source: 'mobile',
        reasoningEffort,
        permissionMode,
        toolsEnabled,
        commandMode,
        workerType
      }
    })
    const eventMessage = workerType
      ? '当前选择的 Worker 不可用，任务保持在待整理。'
      : '当前没有可用 Worker，任务保持在待整理。'
    await collaborationService.createRoomMessage({
      roomId: room.id,
      authorType: 'system',
      kind: 'event',
      content: eventMessage
    })
    await collaborationService.updateRoom(room.id, { status: 'todo' })
    return res.status(202).json({
      roomId: room.id,
      taskMessageId: message.id,
      targetAgentId: null,
      status: 'failed',
      eventMessage
    })
  }

  if (!room.assignedAgentId && targetFamily) {
    await collaborationService.updateRoom(room.id, {
      assignedAgentId: targetAgentId,
      metadata: {
        ...(room.metadata && typeof room.metadata === 'object' ? room.metadata : {}),
        selectedWorkerKey: targetFamily.type,
        selectedWorkerLabel: targetFamily.label
      }
    })
  }

  try {
    const result = await collaborationRuntimeService.assignRoomAndRun(room.id, {
      targetAgentId,
      content,
      reasoningEffort,
      permissionMode,
      toolsEnabled
    })
    return res.status(202).json({
      roomId: result.roomId,
      taskMessageId: result.taskMessageId,
      targetAgentId: result.effectiveTargetAgentId ?? result.targetAgentId,
      status: result.status === 'deferred' ? 'deferred' : 'running',
      eventMessage: result.eventMessage
    })
  } catch (error) {
    const eventMessage = error instanceof Error ? error.message : String(error)
    const message = await collaborationService.createRoomMessage({
      roomId: room.id,
      authorType: 'user',
      kind: 'task',
      intent: 'task',
      routing: 'none',
      content,
      metadata: {
        source: 'mobile',
        reasoningEffort,
        permissionMode,
        toolsEnabled,
        commandMode,
        workerType,
        targetAgentId
      }
    })
    await collaborationService.createRoomMessage({
      roomId: room.id,
      authorType: 'system',
      kind: 'event',
      content: `手机派工失败：${eventMessage}`
    })
    await collaborationService.updateRoom(room.id, {
      assignedAgentId: targetAgentId,
      status: 'blocked'
    })
    return res.status(202).json({
      roomId: room.id,
      taskMessageId: message.id,
      targetAgentId,
      status: 'failed',
      eventMessage
    })
  }
})

mobileRouter.post('/api/rooms/:roomId/messages', requireMobileToken, async (req, res) => {
  const content = String(req.body?.content || '').trim()
  if (!content) {
    return res.status(400).json({ error: { message: 'content is required' } })
  }
  const room = await collaborationService.getRoom(req.params.roomId)
  if (!room) {
    return res.status(404).json({ error: { message: 'room not found' } })
  }
  const message = await collaborationService.createRoomMessage({
    roomId: room.id,
    authorType: 'user',
    kind: 'message',
    intent: 'message',
    routing: 'none',
    content,
    metadata: { source: 'mobile' }
  })
  return res.status(201).json(message)
})

export { mobileRouter }
