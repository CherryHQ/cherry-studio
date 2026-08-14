// 配置信息
const config = {
  R2_CUSTOM_DOMAIN: 'cherrystudio.ocool.online',
  R2_BUCKET_NAME: 'cherrystudio',
  // 缓存键名
  CACHE_KEY: 'cherry-studio-latest-release',
  VERSION_DB: 'versions.json',
  LOG_FILE: 'logs.json',
  MAX_LOGS: 1000 // 最多保存多少条日志
}

// Worker 入口函数
const worker = {
  // 定时器触发配置
  scheduled: {
    cron: '*/1 * * * *' // 每分钟执行一次
  },

  // 定时器执行函数 - 只负责检查和更新
  async scheduled(event, env, ctx) {
    try {
      await initDataFiles(env)
      console.log('开始定时检查新版本...')
      // 使用新的 checkNewRelease 函数
      await checkNewRelease(env)
    } catch (error) {
      console.error('定时任务执行失败:', error)
    }
  },

  // HTTP 请求处理函数 - 只负责返回数据
  async fetch(request, env, ctx) {
    if (!env || !env.R2_BUCKET) {
      return new Response(
        JSON.stringify({
          error: 'R2 存储桶未正确配置'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const url = new URL(request.url)
    const filename = url.pathname.slice(1)

    try {
      // 处理文件下载请求
      if (filename) {
        return await handleDownload(env, filename)
      }

      // 只返回缓存的版本信息
      return await getCachedRelease(env)
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error.message,
          stack: error.stack
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
  }
}

export default worker

/**
 * 添加日志记录函数
 */
async function addLog(env, type, event, details = null) {
  try {
    const logFile = await env.R2_BUCKET.get(config.LOG_FILE)
    let logs = { logs: [] }

    if (logFile) {
      logs = JSON.parse(await logFile.text())
    }

    logs.logs.unshift({
      timestamp: new Date().toISOString(),
      type,
      event,
      details
    })

    // 保持日志数量在限制内
    if (logs.logs.length > config.MAX_LOGS) {
      logs.logs = logs.logs.slice(0, config.MAX_LOGS)
    }

    await env.R2_BUCKET.put(config.LOG_FILE, JSON.stringify(logs, null, 2))
  } catch (error) {
    console.error('写入日志失败:', error)
  }
}

/**
 * 获取最新版本信息
 */
async function getLatestRelease(env) {
  try {
    const cached = await env.R2_BUCKET.get(config.CACHE_KEY)
    if (!cached) {
      // 如果缓存不存在，先检查版本数据库
      const versionDB = await env.R2_BUCKET.get(config.VERSION_DB)
      if (versionDB) {
        const versions = JSON.parse(await versionDB.text())
        if (versions.latestVersion) {
          // 从版本数据库重建缓存
          const latestVersion = versions.versions[versions.latestVersion]
          const cacheData = {
            version: latestVersion.version,
            publishedAt: latestVersion.publishedAt,
            changelog: latestVersion.changelog,
            downloads: latestVersion.files
              .filter((file) => file.uploaded)
              .map((file) => ({
                name: file.name,
                url: `https://${config.R2_CUSTOM_DOMAIN}/${file.name}`,
                size: formatFileSize(file.size)
              }))
          }
          // 更新缓存
          await env.R2_BUCKET.put(config.CACHE_KEY, JSON.stringify(cacheData))
          return new Response(JSON.stringify(cacheData), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          })
        }
      }
      // 如果版本数据库也没有数据，才执行检查更新
      const data = await checkNewRelease(env)
      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    const data = await cached.text()
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    await addLog(env, 'ERROR', '获取版本信息失败', error.message)
    return new Response(
      JSON.stringify({
        error: '获取版本信息失败: ' + error.message,
        detail: '请稍���再试'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
}

// 修改下载处理函数，直接接收 env
async function handleDownload(env, filename) {
  try {
    const object = await env.R2_BUCKET.get(filename)

    if (!object) {
      return new Response('文件未找到', { status: 404 })
    }

    // 设置响应头
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('etag', object.httpEtag)
    headers.set('Content-Disposition', `attachment; filename="${filename}"`)

    return new Response(object.body, {
      headers
    })
  } catch (error) {
    console.error('下载文件时发生错误:', error)
    return new Response('获取文件失败', { status: 500 })
  }
}

/**
 * 根据文件扩展名获取对应的 Content-Type
 */
function getContentType(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  const types = {
    exe: 'application/x-msdownload', // Windows 可执行文件
    dmg: 'application/x-apple-diskimage', // macOS 安装包
    zip: 'application/zip', // 压缩包
    AppImage: 'application/x-executable', // Linux 可执行文件
    blockmap: 'application/octet-stream' // 更新文件
  }
  return types[ext] || 'application/octet-stream'
}

/**
 * 格式化文件大小
 * 将字节转换为人类可读的格式（B, KB, MB, GB）
 */
function formatFileSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

/**
 * 版本号比较函数
 * 用于对版本号进行排序
 */
function compareVersions(a, b) {
  const partsA = a.replace('v', '').split('.')
  const partsB = b.replace('v', '').split('.')

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = parseInt(partsA[i] || 0)
    const numB = parseInt(partsB[i] || 0)

    if (numA !== numB) {
      return numA - numB
    }
  }

  return 0
}

/**
 * 初始化数据文件
 */
async function initDataFiles(env) {
  try {
    // 检查并初始化版本数据库
    const versionDB = await env.R2_BUCKET.get(config.VERSION_DB)
    if (!versionDB) {
      const initialVersions = {
        versions: {},
        latestVersion: null,
        lastChecked: new Date().toISOString()
      }
      await env.R2_BUCKET.put(config.VERSION_DB, JSON.stringify(initialVersions, null, 2))
      await addLog(env, 'INFO', 'versions.json 初始化成功')
    }

    // 检查并初始化日志文件
    const logFile = await env.R2_BUCKET.get(config.LOG_FILE)
    if (!logFile) {
      const initialLogs = {
        logs: [
          {
            timestamp: new Date().toISOString(),
            type: 'INFO',
            event: '系统初始化'
          }
        ]
      }
      await env.R2_BUCKET.put(config.LOG_FILE, JSON.stringify(initialLogs, null, 2))
      console.log('logs.json 初始化成功')
    }
  } catch (error) {
    console.error('初始化数据文件失败:', error)
  }
}

// 新增：只获取缓存的版本信息
async function getCachedRelease(env) {
  try {
    const cached = await env.R2_BUCKET.get(config.CACHE_KEY)
    if (!cached) {
      // 如果缓存不存在，从版本数据库获取
      const versionDB = await env.R2_BUCKET.get(config.VERSION_DB)
      if (versionDB) {
        const versions = JSON.parse(await versionDB.text())
        if (versions.latestVersion) {
          const latestVersion = versions.versions[versions.latestVersion]
          const cacheData = {
            version: latestVersion.version,
            publishedAt: latestVersion.publishedAt,
            changelog: latestVersion.changelog,
            downloads: latestVersion.files
              .filter((file) => file.uploaded)
              .map((file) => ({
                name: file.name,
                url: `https://${config.R2_CUSTOM_DOMAIN}/${file.name}`,
                size: formatFileSize(file.size)
              }))
          }
          // 重建缓存
          await env.R2_BUCKET.put(config.CACHE_KEY, JSON.stringify(cacheData))
          return new Response(JSON.stringify(cacheData), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          })
        }
      }
      // 如果没有任何数据，返回错误
      return new Response(
        JSON.stringify({
          error: '没有可用的版本信息'
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      )
    }

    // 返回缓存数据
    return new Response(await cached.text(), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    await addLog(env, 'ERROR', '获取缓存版本信息失败', error.message)
    throw error
  }
}

// 新增：只检查新版本并更新
async function checkNewRelease(env) {
  try {
    // 获取 GitHub 最新版本
    const githubResponse = await fetch('https://api.github.com/repos/CherryHQ/cherry-studio/releases/latest', {
      headers: { 'User-Agent': 'CloudflareWorker' }
    })

    if (!githubResponse.ok) {
      throw new Error('GitHub API 请求失败')
    }

    const releaseData = await githubResponse.json()
    const version = releaseData.tag_name

    // 获取版本数据库
    const versionDB = await env.R2_BUCKET.get(config.VERSION_DB)
    let versions = { versions: {}, latestVersion: null, lastChecked: new Date().toISOString() }

    if (versionDB) {
      versions = JSON.parse(await versionDB.text())
    }

    // 移除版本检查，改为记录是否有文件更新的标志
    let hasUpdates = false
    if (versions.latestVersion !== version) {
      await addLog(env, 'INFO', `发现新版本: ${version}`)
      hasUpdates = true
    } else {
      await addLog(env, 'INFO', `版本 ${version} 文件完整性检查开始`)
    }

    // 准备新版本记录
    const versionRecord = {
      version,
      publishedAt: releaseData.published_at,
      uploadedAt: null,
      files: releaseData.assets.map((asset) => ({
        name: asset.name,
        size: asset.size,
        uploaded: false
      })),
      changelog: releaseData.body
    }

    // 检查并上传文件
    for (const asset of releaseData.assets) {
      try {
        const existingFile = await env.R2_BUCKET.get(asset.name)
        // 检查文件是否存在且大小是否一致
        if (!existingFile || existingFile.size !== asset.size) {
          hasUpdates = true
          const response = await fetch(asset.browser_download_url)
          if (!response.ok) {
            throw new Error(`下载失败: HTTP ${response.status}`)
          }

          const file = await response.arrayBuffer()
          await env.R2_BUCKET.put(asset.name, file, {
            httpMetadata: { contentType: getContentType(asset.name) }
          })

          // 更新文件状态
          const fileIndex = versionRecord.files.findIndex((f) => f.name === asset.name)
          if (fileIndex !== -1) {
            versionRecord.files[fileIndex].uploaded = true
          }

          await addLog(env, 'INFO', `文件${existingFile ? '更新' : '上传'}成功: ${asset.name}`)
        } else {
          // 文件存在且大小相同，标记为已上传
          const fileIndex = versionRecord.files.findIndex((f) => f.name === asset.name)
          if (fileIndex !== -1) {
            versionRecord.files[fileIndex].uploaded = true
          }
          await addLog(env, 'INFO', `文件完整性验证通过: ${asset.name}`)
        }
      } catch (error) {
        await addLog(env, 'ERROR', `文件处理失败: ${asset.name}`, error.message)
      }
    }

    // 只有在有更新或是新版本时才更新数据库和缓存
    if (hasUpdates) {
      // 更新版本记录
      versionRecord.uploadedAt = new Date().toISOString()
      versions.versions[version] = versionRecord
      versions.latestVersion = version

      // 保存版本数据库
      await env.R2_BUCKET.put(config.VERSION_DB, JSON.stringify(versions, null, 2))

      // 更新缓存
      const cacheData = {
        version,
        publishedAt: releaseData.published_at,
        changelog: releaseData.body,
        downloads: versionRecord.files
          .filter((file) => file.uploaded)
          .map((file) => ({
            name: file.name,
            url: `https://${config.R2_CUSTOM_DOMAIN}/${file.name}`,
            size: formatFileSize(file.size)
          }))
      }

      await env.R2_BUCKET.put(config.CACHE_KEY, JSON.stringify(cacheData))
      await addLog(env, 'INFO', hasUpdates ? '更新完成' : '文件完整性检查完成')

      // 清理旧版本
      const versionList = Object.keys(versions.versions).sort((a, b) => compareVersions(b, a))
      if (versionList.length > 2) {
        // 获取需要保留的两个最新版本
        const keepVersions = versionList.slice(0, 2)
        // 获取所有需要删除的版本
        const oldVersions = versionList.slice(2)

        // 先获取 R2 桶中的所有文件列表
        const allFiles = await listAllFiles(env)

        // 获取需要保留的文件名列表
        const keepFiles = new Set()
        for (const keepVersion of keepVersions) {
          const versionFiles = versions.versions[keepVersion].files
          versionFiles.forEach((file) => keepFiles.add(file.name))
        }

        // 删除所有旧版本文件
        for (const oldVersion of oldVersions) {
          const oldFiles = versions.versions[oldVersion].files
          for (const file of oldFiles) {
            try {
              if (file.uploaded) {
                await env.R2_BUCKET.delete(file.name)
                await addLog(env, 'INFO', `删除旧文件: ${file.name}`)
              }
            } catch (error) {
              await addLog(env, 'ERROR', `删除旧文件失败: ${file.name}`, error.message)
            }
          }
          delete versions.versions[oldVersion]
        }

        // 清理可能遗留的旧文件
        for (const file of allFiles) {
          if (!keepFiles.has(file.name)) {
            try {
              await env.R2_BUCKET.delete(file.name)
              await addLog(env, 'INFO', `删除遗留文件: ${file.name}`)
            } catch (error) {
              await addLog(env, 'ERROR', `删除遗留文件失败: ${file.name}`, error.message)
            }
          }
        }

        // 保存更新后的版本数据库
        await env.R2_BUCKET.put(config.VERSION_DB, JSON.stringify(versions, null, 2))
      }
    } else {
      await addLog(env, 'INFO', '所有文件完整性检查通过，无需更新')
    }

    return hasUpdates ? cacheData : null
  } catch (error) {
    await addLog(env, 'ERROR', '检查新版本失败', error.message)
    throw error
  }
}

// 新增：获取 R2 桶中的所有文件列表
async function listAllFiles(env) {
  const files = []
  let cursor

  do {
    const listed = await env.R2_BUCKET.list({ cursor, include: ['customMetadata'] })
    files.push(...listed.objects)
    cursor = listed.cursor
  } while (cursor)

  return files
}
