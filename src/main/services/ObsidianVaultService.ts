import { loggerService } from '@logger'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const logger = loggerService.withContext('ObsidianVaultService')
interface VaultInfo {
  path: string
  name: string
}

interface FileInfo {
  path: string
  type: 'folder' | 'markdown'
  name: string
}

class ObsidianVaultService {
  private obsidianConfigPath: string

  constructor() {
    // 根据操作系统获取Obsidian配置文件路径
    if (process.platform === 'win32') {
      this.obsidianConfigPath = path.join(app.getPath('appData'), 'obsidian', 'obsidian.json')
    } else if (process.platform === 'darwin') {
      this.obsidianConfigPath = path.join(
        app.getPath('home'),
        'Library',
        'Application Support',
        'obsidian',
        'obsidian.json'
      )
    } else {
      // Linux
      this.obsidianConfigPath = path.join(app.getPath('home'), '.config', 'obsidian', 'obsidian.json')
    }
  }

  /**
   * 获取所有的Obsidian Vault
   */
  getVaults(): VaultInfo[] {
    try {
      if (!fs.existsSync(this.obsidianConfigPath)) {
        return []
      }

      const configContent = fs.readFileSync(this.obsidianConfigPath, 'utf8')
      const config = JSON.parse(configContent)

      if (!config.vaults) {
        return []
      }

      return Object.entries(config.vaults).map(([, vault]: [string, any]) => ({
        path: vault.path,
        name: vault.name || path.basename(vault.path)
      }))
    } catch (error) {
      logger.error('Failed to get Obsidian Vault:', error as Error)
      return []
    }
  }

  /**
   * 获取Vault中的文件夹和Markdown文件结构
   */
  getVaultStructure(vaultPath: string): FileInfo[] {
    const results: FileInfo[] = []

    try {
      // 检查vault路径是否存在
      if (!fs.existsSync(vaultPath)) {
        logger.error(`Vault path does not exist: ${vaultPath}`)
        return []
      }

      // 检查是否是目录
      const stats = fs.statSync(vaultPath)
      if (!stats.isDirectory()) {
        logger.error(`Vault path is not a directory: ${vaultPath}`)
        return []
      }

      this.traverseDirectory(vaultPath, '', results)
    } catch (error) {
      logger.error('Failed to read Vault folder structure:', error as Error)
    }

    return results
  }

  /**
   * 递归遍历目录获取所有文件夹和Markdown文件
   */
  private traverseDirectory(dirPath: string, relativePath: string, results: FileInfo[]) {
    try {
      // 首先添加当前文件夹
      if (relativePath) {
        results.push({
          path: relativePath,
          type: 'folder',
          name: path.basename(relativePath)
        })
      }

      // 确保目录存在且可访问
      if (!fs.existsSync(dirPath)) {
        logger.error(`Directory does not exist: ${dirPath}`)
        return
      }

      let items
      try {
        items = fs.readdirSync(dirPath, { withFileTypes: true })
      } catch (err) {
        logger.error(`Failed to read directory ${dirPath}:`, err as Error)
        return
      }

      for (const item of items) {
        // 忽略以.开头的隐藏文件夹和文件
        if (item.name.startsWith('.')) {
          continue
        }

        const newRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name
        const fullPath = path.join(dirPath, item.name)

        if (item.isDirectory()) {
          this.traverseDirectory(fullPath, newRelativePath, results)
        } else if (item.isFile() && item.name.endsWith('.md')) {
          // 收集.md文件
          results.push({
            path: newRelativePath,
            type: 'markdown',
            name: item.name
          })
        }
      }
    } catch (error) {
      logger.error(`Failed to traverse directory ${dirPath}:`, error as Error)
    }
  }

  /**
   * 获取指定Vault的文件夹和Markdown文件结构
   * @param vaultName vault名称
   */
  getFilesByVaultName(vaultName: string): FileInfo[] {
    try {
      const vaults = this.getVaults()
      const vault = vaults.find((v) => v.name === vaultName)

      if (!vault) {
        logger.error(`Vault not found: ${vaultName}`)
        return []
      }

      logger.debug(`Get Vault file structure: ${vault.name} ${vault.path}`)
      return this.getVaultStructure(vault.path)
    } catch (error) {
      logger.error('Failed to get Vault file structure:', error as Error)
      return []
    }
  }
}

export default ObsidianVaultService
