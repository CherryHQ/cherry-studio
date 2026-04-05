import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import { knowledgeService } from '../services/KnowledgeService'
import { memoryService } from '../services/memory/MemoryService'

export function registerKnowledgeIpc() {
  ipcMain.handle(IpcChannel.KnowledgeBase_Create, knowledgeService.create.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Reset, knowledgeService.reset.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Delete, knowledgeService.delete.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Add, knowledgeService.add.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Remove, knowledgeService.remove.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Search, knowledgeService.search.bind(knowledgeService))
  ipcMain.handle(IpcChannel.KnowledgeBase_Rerank, knowledgeService.rerank.bind(knowledgeService))

  // memory
  ipcMain.handle(IpcChannel.Memory_Add, (_, messages, config) => memoryService.add(messages, config))
  ipcMain.handle(IpcChannel.Memory_Search, (_, query, config) => memoryService.search(query, config))
  ipcMain.handle(IpcChannel.Memory_List, (_, config) => memoryService.list(config))
  ipcMain.handle(IpcChannel.Memory_Delete, (_, id) => memoryService.delete(id))
  ipcMain.handle(IpcChannel.Memory_Update, (_, id, memory, metadata) => memoryService.update(id, memory, metadata))
  ipcMain.handle(IpcChannel.Memory_Get, (_, memoryId) => memoryService.get(memoryId))
  ipcMain.handle(IpcChannel.Memory_SetConfig, (_, config) => memoryService.setConfig(config))
  ipcMain.handle(IpcChannel.Memory_DeleteUser, (_, userId) => memoryService.deleteUser(userId))
  ipcMain.handle(IpcChannel.Memory_DeleteAllMemoriesForUser, (_, userId) =>
    memoryService.deleteAllMemoriesForUser(userId)
  )
  ipcMain.handle(IpcChannel.Memory_GetUsersList, () => memoryService.getUsersList())
  ipcMain.handle(IpcChannel.Memory_MigrateMemoryDb, () => memoryService.migrateMemoryDb())
}
