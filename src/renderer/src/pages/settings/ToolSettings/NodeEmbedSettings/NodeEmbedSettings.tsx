import { Button, Card, Input, Spinner } from '@heroui/react'
import { IpcChannel } from '@shared/IpcChannel'
import { Plus, Play, RefreshCw, Trash2, Square, Upload, FolderOpen } from 'lucide-react'
import { FC, useEffect, useMemo, useState } from 'react'

type InstalledNodeApp = {
  id: string
  name: string
  version?: string
  dir: string
  entry: string
  createdAt: number
}

type Status = {
  running: boolean
  pid?: number
  appId?: string
  name?: string
  cwd?: string
  entry?: string
}

const NodeEmbedSettings: FC = () => {
  const [apps, setApps] = useState<InstalledNodeApp[]>([])
  const [status, setStatus] = useState<Status>({ running: false })
  const [loading, setLoading] = useState(false)
  const [envKV, setEnvKV] = useState<string>('')

  const envObject = useMemo(() => {
    const obj: Record<string, string> = {}
    envKV
      .split(/\n|,/) // lines or comma
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const idx = pair.indexOf('=')
        if (idx > 0) {
          const k = pair.slice(0, idx).trim()
          const v = pair.slice(idx + 1).trim()
          if (k) obj[k] = v
        }
      })
    return obj
  }, [envKV])

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await window.electron.ipcRenderer.invoke(IpcChannel.NodeEmbed_List)
      if (res?.success) setApps(res.apps || [])
    } finally {
      const st = await window.electron.ipcRenderer.invoke(IpcChannel.NodeEmbed_GetStatus)
      setStatus(st || { running: false })
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const selectZipAndInstall = async () => {
    try {
      const file = await window.electron.ipcRenderer.invoke(IpcChannel.File_Open, {
        properties: ['openFile'],
        filters: [{ name: 'Zip', extensions: ['zip'] }]
      })
      if (!file?.filePath) return
      const ret = await window.electron.ipcRenderer.invoke(IpcChannel.NodeEmbed_Install, file.filePath)
      if (ret?.success) {
        window.toast.success('安装完成')
        await refresh()
      } else {
        // 尝试手动指定入口
        const entry = window.prompt('未能自动识别入口文件。请输入入口相对路径（例如：dist/index.js）')
        if (entry) {
          const ret2 = await window.electron.ipcRenderer.invoke(IpcChannel.NodeEmbed_Install, file.filePath, { entry })
          if (ret2?.success) {
            window.toast.success('安装完成')
            await refresh()
          } else {
            window.toast.error('安装失败: ' + (ret2?.error || 'unknown'))
          }
        } else {
          window.toast.error('安装失败: ' + (ret?.error || 'unknown'))
        }
      }
    } catch (e: any) {
      window.toast.error('安装失败: ' + (e?.message || 'unknown'))
    }
  }

  const startApp = async (appId: string) => {
    setLoading(true)
    try {
      const ret = await window.electron.ipcRenderer.invoke(IpcChannel.NodeEmbed_Start, appId, envObject)
      if (ret?.success) {
        window.toast.success('已启动')
      } else {
        window.toast.error('启动失败: ' + (ret?.error || 'unknown'))
      }
    } finally {
      await refresh()
    }
  }

  const restartApp = async (appId?: string) => {
    setLoading(true)
    try {
      const ret = await window.electron.ipcRenderer.invoke(IpcChannel.NodeEmbed_Restart, appId, envObject)
      if (ret?.success) window.toast.success('已重启')
      else window.toast.error('重启失败: ' + (ret?.error || 'unknown'))
    } finally {
      await refresh()
    }
  }

  const stopApp = async () => {
    setLoading(true)
    try {
      const ret = await window.electron.ipcRenderer.invoke(IpcChannel.NodeEmbed_Stop)
      if (ret?.success) window.toast.success('已停止')
      else window.toast.error('停止失败: ' + (ret?.error || 'unknown'))
    } finally {
      await refresh()
    }
  }

  const removeApp = async (appId: string) => {
    setLoading(true)
    try {
      const ret = await window.electron.ipcRenderer.invoke(IpcChannel.NodeEmbed_Remove, appId)
      if (ret?.success) window.toast.success('已移除')
      else window.toast.error('移除失败: ' + (ret?.error || 'unknown'))
    } finally {
      await refresh()
    }
  }

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height))] w-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-semibold">内嵌 Node 服务</div>
          <div className="text-xs text-default-500">上传编译后的 zip 安装，启动后可提供 LLM 转接/自定义 API 能力</div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" startContent={<Upload size={16} />} onPress={selectZipAndInstall}>
            选择 Zip 安装
          </Button>
          <Button size="sm" variant="flat" startContent={<RefreshCw size={16} />} onPress={refresh}>
            刷新
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="mb-2 text-sm font-medium">运行环境变量 (可选)</div>
        <Input
          classNames={{ inputWrapper: 'min-h-[80px]' }}
          placeholder="以逗号或换行分隔，如：PORT=8080, API_KEY=xxx"
          value={envKV}
          onChange={(e) => setEnvKV(e.target.value)}
        />
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-divider p-4">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${status.running ? 'bg-success' : 'bg-danger'}`} />
            <div className="text-sm font-medium">
              {status.running ? '运行中' : '未运行'}
              {status.name ? ` · ${status.name}` : ''}
              {status.pid ? ` · PID ${status.pid}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status.running ? (
              <Button size="sm" color="danger" variant="flat" startContent={<Square size={16} />} onPress={stopApp}>
                停止
              </Button>
            ) : (
              <Button
                size="sm"
                color="success"
                startContent={<Play size={16} />}
                isDisabled={!apps.length}
                onPress={() => (apps.length ? startApp(apps[0].id) : undefined)}>
                启动第一个应用
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {loading && (
            <div className="flex items-center gap-2 p-3 text-sm text-default-500">
              <Spinner size="sm" /> 正在加载...
            </div>
          )}
          {!loading && (!apps || apps.length === 0) && (
            <div className="p-4 text-sm text-default-500">暂无已安装的应用，点击“选择 Zip 安装”。</div>
          )}
          {!loading && apps?.length > 0 && (
            <div className="divide-y divide-divider">
              {apps.map((app) => (
                <div key={app.id} className="flex items-center justify-between p-3">
                  <div className="flex min-w-0 flex-col">
                    <div className="truncate text-sm font-medium">
                      {app.name} {app.version ? `v${app.version}` : ''}
                    </div>
                    <div className="truncate text-xs text-default-500">{app.entry}</div>
                    <div className="truncate text-xs text-default-400">{app.id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" startContent={<Play size={14} />} onPress={() => startApp(app.id)}>
                      启动
                    </Button>
                    <Button size="sm" variant="flat" startContent={<RefreshCw size={14} />} onPress={() => restartApp(app.id)}>
                      重启
                    </Button>
                    <Button size="sm" color="danger" variant="flat" startContent={<Trash2 size={14} />} onPress={() => removeApp(app.id)}>
                      移除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

export default NodeEmbedSettings
