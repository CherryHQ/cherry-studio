import KeyvStorage from '@kangfenmao/keyv-storage'

import { startAutoSync } from './services/BackupService'
import store from './store'

console.log('init.ts开始执行')

function initSpinner() {
  console.log('初始化spinner')
  const spinner = document.getElementById('spinner')
  if (spinner && window.location.hash !== '#/mini') {
    spinner.style.display = 'flex'
  }
}

function initKeyv() {
  console.log('初始化keyv存储')
  window.keyv = new KeyvStorage()
  window.keyv.init()
}

function initAutoSync() {
  console.log('初始化自动同步')
  setTimeout(() => {
    const { webdavAutoSync } = store.getState().settings
    console.log('webdavAutoSync设置:', webdavAutoSync)
    if (webdavAutoSync) {
      startAutoSync()
    }
  }, 2000)
}

// 初始化MCP相关内容
function initMCP() {
  console.log('初始化MCP')
  try {
    // 检查MCP状态
    const mcp = store.getState().mcp || {}
    const servers = mcp.servers || []

    console.log('MCP服务器数量:', servers.length)

    // 如果存在MCP服务器，确保状态正确
    if (servers.length > 0) {
      // 派发一个action以确保MCP状态正常
      store.dispatch({ type: 'mcp/setMCPServers', payload: servers })
    }

    console.log('MCP初始化完成')
  } catch (error) {
    console.error('MCP初始化错误:', error)
    // 出错时重置MCP服务器列表为空数组
    store.dispatch({ type: 'mcp/setMCPServers', payload: [] })
  }
}

initSpinner()
initKeyv()
initAutoSync()
initMCP()

console.log('init.ts执行完成')
