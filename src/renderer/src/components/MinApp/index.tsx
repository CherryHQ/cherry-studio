/* eslint-disable react/no-unknown-property */
import { CloseOutlined, CodeOutlined, ExportOutlined, PushpinOutlined, ReloadOutlined } from '@ant-design/icons'
import { isMac, isWindows } from '@renderer/config/constant'
import { AppLogo } from '@renderer/config/env'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useBridge } from '@renderer/hooks/useBridge'
import { useMinapps } from '@renderer/hooks/useMinapps'
import store from '@renderer/store'
import { setMinappShow } from '@renderer/store/runtime'
import { MinAppType } from '@renderer/types'
import { Avatar, Drawer } from 'antd'
import { WebviewTag } from 'electron'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import { TopView } from '../TopView'

interface Props {
  app: MinAppType
  resolve: (data: any) => void
}

const MiniAppContainer: React.FC<Props> = ({ app, resolve }) => {
  return <MiniAppRenderer app={app} resolve={resolve} />
}

interface MiniAppRendererProps {
  app: MinAppType
  resolve: (data: any) => void
}

// MiniApp渲染器，用于在TopView中渲染所有MiniApp实例
const MiniAppRenderer: React.FC<MiniAppRendererProps> = ({ resolve }) => {
  // 从MinApp类获取所有实例数据
  const [instances, setInstances] = useState<
    Map<
      string | number,
      {
        visible: boolean
        app: MinAppType
        lastUsed: number
      }
    >
  >(new Map())

  // 同步实例状态
  useEffect(() => {
    const updateInstances = () => {
      setInstances(new Map(MinApp.appInstances))
    }

    // 初始更新
    updateInstances()

    // 创建一个定时器，定期检查是否有新实例
    const intervalId = setInterval(updateInstances, 500)

    return () => {
      clearInterval(intervalId)
    }
  }, [])

  // 渲染所有MiniApp实例，但只显示visible=true的实例
  return (
    <>
      {Array.from(instances.entries()).map(([id, instance]) => (
        <PopupContainer key={`miniapp-${id}`} app={instance.app} resolve={resolve} visible={instance.visible} />
      ))}
    </>
  )
}

interface Props {
  app: MinAppType
  resolve: (data: any) => void
  visible?: boolean
}

const PopupContainer: React.FC<Props> = ({ app, resolve, visible = true }) => {
  const { pinned, updatePinnedMinapps } = useMinapps()
  const isPinned = pinned.some((p) => p.id === app.id)
  const [open, setOpen] = useState(visible)
  const [opened, setOpened] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const webviewRef = useRef<WebviewTag | null>(null)
  const [cachedState, setCachedState] = useState<any>(null)

  // 用于防止重复调用onClose
  const isClosingRef = useRef(false)

  useBridge()

  // 当visible属性变化时，更新open状态
  useEffect(() => {
    setOpen(visible)
  }, [visible])

  // 从缓存加载状态
  useEffect(() => {
    if (app.id) {
      const cache = MinApp.getFromCache(app.id)
      if (cache) {
        console.log(`[MinApp] 从缓存加载 ${app.name} (ID: ${app.id})，URL: ${cache.webviewSrc}`)
        setCachedState(cache)
      } else {
        console.log(`[MinApp] 未找到 ${app.name} (ID: ${app.id}) 的缓存`)
      }
    }

    // 状态初始化完成后，打开webview
    const timer = setTimeout(() => setOpened(true), 350)
    return () => clearTimeout(timer)
  }, [app.id, app.name])

  // 简化的同步保存函数
  const saveStateSync = useCallback(() => {
    if (!app.id || !webviewRef.current) return undefined

    try {
      const currentUrl = webviewRef.current.getURL()

      MinApp.webviewCache.set(app.id, {
        webviewSrc: currentUrl,
        webviewState: { scrollTop: 0 }
      })

      // 如果缓存大小超过限制，删除最早的缓存
      if (MinApp.webviewCache.size > MinApp.MAX_INSTANCES) {
        const firstKey = MinApp.webviewCache.keys().next().value
        if (firstKey) {
          MinApp.webviewCache.delete(firstKey)
        }
      }
    } catch (error) {
      console.error('[MinApp] 同步保存失败:', error)
    }
  }, [app.id])

  // 关闭处理函数
  const handleClose = useCallback(async () => {
    // 防止重复调用
    if (isClosingRef.current) {
      console.log('[MinApp] 关闭操作已在进行中，忽略重复调用')
      return undefined
    }

    isClosingRef.current = true
    console.log(`[MinApp] 开始关闭 ${app.name}`)

    try {
      // 保存当前状态
      saveStateSync()
    } catch (err) {
      console.error('[MinApp] 关闭时保存状态失败:', err)
    }

    // 更新MinApp类中的实例状态
    if (app.id) {
      const instance = MinApp.getAppInstance(app.id)
      if (instance) {
        instance.visible = false
        MinApp.appInstances.set(app.id, instance)
      }
    }

    // 隐藏当前实例
    setOpen(false)

    // 延迟后完成关闭
    return new Promise<void>((resolveClose) => {
      setTimeout(() => {
        resolve({})
        resolveClose()
      }, 300)
    })
  }, [app.name, app.id, saveStateSync, resolve])

  // 设置全局关闭函数引用
  useEffect(() => {
    // 只有当当前实例可见时，才设置为全局onClose
    if (visible) {
      MinApp.onClose = () => {
        handleClose()
      }
    }

    return () => {
      // 重置，避免引用过期的函数
      if (MinApp.onClose.toString() === handleClose.toString()) {
        MinApp.onClose = () => {}
      }
    }
  }, [handleClose, visible])

  // Webview 事件处理
  useEffect(() => {
    if (!opened || !open) return

    const webview = webviewRef.current
    let scrollTrackingTimer: number | null = null

    if (webview) {
      const handleNewWindow = (event: any) => {
        event.preventDefault()
        if (webview.loadURL) {
          webview.loadURL(event.url)
        }
      }

      const onLoaded = () => {
        setIsReady(true)
        console.log(`[MinApp] ${app.name} webview 已加载: ${webview.getURL()}`)

        // 恢复滚动位置
        if (cachedState?.webviewState?.scrollTop) {
          try {
            const scrollPos = cachedState.webviewState.scrollTop
            webview.executeJavaScript(`
              setTimeout(() => {
                window.scrollTo(0, ${scrollPos});
                console.log('[MinApp] 已恢复滚动位置到: ${scrollPos}');
              }, 100);
            `)
          } catch (error) {
            console.error('[MinApp] 恢复滚动位置失败:', error)
          }
        }
      }

      const addScrollListener = () => {
        try {
          webview.executeJavaScript(`
            window.addEventListener('scroll', () => {
              window.currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
            }, { passive: true });
          `)

          // 定期获取滚动位置并保存
          scrollTrackingTimer = window.setInterval(() => {
            if (app.id && !isClosingRef.current) {
              webview
                .executeJavaScript('window.currentScrollY || 0')
                .then((scrollTop) => {
                  if (app.id) {
                    MinApp.webviewCache.set(app.id, {
                      webviewSrc: webview.getURL(),
                      webviewState: { scrollTop }
                    })
                  }
                })
                .catch((err) => {
                  console.error('[MinApp] 获取滚动位置失败:', err)
                })
            }
          }, 30000) as unknown as number
        } catch (error) {
          console.error('[MinApp] 添加滚动监听器失败:', error)
        }
      }

      webview.addEventListener('new-window', handleNewWindow)
      webview.addEventListener('did-finish-load', onLoaded)
      webview.addEventListener('dom-ready', addScrollListener)

      return () => {
        if (scrollTrackingTimer) {
          clearInterval(scrollTrackingTimer)
        }

        try {
          webview.removeEventListener('new-window', handleNewWindow)
          webview.removeEventListener('did-finish-load', onLoaded)
          webview.removeEventListener('dom-ready', addScrollListener)
        } catch (e) {
          // 忽略清理过程中的错误
        }
      }
    }
  }, [opened, open, cachedState, app.id, app.name])

  const canOpenExternalLink = app.url.startsWith('http://') || app.url.startsWith('https://')
  const canPinned = DEFAULT_MIN_APPS.some((i) => i.id === app?.id)

  // 各种按钮处理函数，使用useCallback提高性能
  const openDevTools = useCallback(() => {
    if (webviewRef.current) {
      webviewRef.current.openDevTools()
    }
  }, [])

  const onReload = useCallback(() => {
    if (webviewRef.current) {
      setCachedState(null) // 清除缓存状态
      webviewRef.current.src = app.url
    }
  }, [app.url])

  const onOpenLink = useCallback(() => {
    if (webviewRef.current) {
      const currentUrl = webviewRef.current.getURL()
      window.api.openWebsite(currentUrl)
    }
  }, [])

  const onTogglePin = useCallback(() => {
    const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...pinned, app]
    updatePinnedMinapps(newPinned)
  }, [isPinned, pinned, app.id, updatePinnedMinapps])

  const isInDevelopment = process.env.NODE_ENV === 'development'

  // 使用useMemo缓存Title组件以提高性能
  const Title = useMemo(
    () => (
      <TitleContainer style={{ justifyContent: 'space-between' }}>
        <TitleText>{app.name}</TitleText>
        <ButtonsGroup className={isWindows ? 'windows' : ''}>
          <Button onClick={onReload}>
            <ReloadOutlined />
          </Button>
          {canPinned && (
            <Button onClick={onTogglePin} className={isPinned ? 'pinned' : ''}>
              <PushpinOutlined style={{ fontSize: 16 }} />
            </Button>
          )}
          {canOpenExternalLink && (
            <Button onClick={onOpenLink}>
              <ExportOutlined />
            </Button>
          )}
          {isInDevelopment && (
            <Button onClick={openDevTools}>
              <CodeOutlined />
            </Button>
          )}
          <Button onClick={handleClose}>
            <CloseOutlined />
          </Button>
        </ButtonsGroup>
      </TitleContainer>
    ),
    [
      app.name,
      handleClose,
      onReload,
      onOpenLink,
      onTogglePin,
      openDevTools,
      isPinned,
      canPinned,
      canOpenExternalLink,
      isInDevelopment
    ]
  )

  // 使用CSS控制显示/隐藏，而不是卸载组件
  const containerStyle: React.CSSProperties = {
    display: open ? 'block' : 'none'
  }

  return (
    <div style={containerStyle}>
      <Drawer
        title={Title}
        placement="bottom"
        onClose={handleClose}
        open={open}
        mask={true}
        rootClassName="minapp-drawer"
        maskClassName="minapp-mask"
        height={'100%'}
        maskClosable={false}
        closeIcon={null}
        style={{ marginLeft: 'var(--sidebar-width)' }}>
        {!isReady && opened && (
          <EmptyView>
            <Avatar src={app.logo} size={80} style={{ border: '1px solid var(--color-border)', marginTop: -150 }} />
            <BeatLoader color="var(--color-text-2)" size="10" style={{ marginTop: 15 }} />
          </EmptyView>
        )}
        {opened && (
          <webview
            src={cachedState ? cachedState.webviewSrc : app.url}
            ref={webviewRef}
            style={WebviewStyle}
            allowpopups={'true' as any}
            partition="persist:webview"
          />
        )}
      </Drawer>
    </div>
  )
}

const WebviewStyle: React.CSSProperties = {
  width: 'calc(100vw - var(--sidebar-width))',
  height: 'calc(100vh - var(--navbar-height))',
  backgroundColor: 'white',
  display: 'inline-flex'
}

const TitleContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-left: ${isMac ? '20px' : '10px'};
  padding-right: 10px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`

const TitleText = styled.div`
  font-weight: bold;
  font-size: 14px;
  color: var(--color-text-1);
  margin-right: 10px;
  user-select: none;
`

const ButtonsGroup = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  -webkit-app-region: no-drag;
  &.windows {
    margin-right: ${isWindows ? '130px' : 0};
    background-color: var(--color-background-mute);
    border-radius: 50px;
    padding: 0 3px;
    overflow: hidden;
  }
`

const Button = styled.div`
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  color: var(--color-text-2);
  transition: all 0.2s ease;
  font-size: 14px;
  &:hover {
    color: var(--color-text-1);
    background-color: var(--color-background-mute);
  }
  &.pinned {
    color: var(--color-primary);
    background-color: var(--color-primary-bg);
  }
`

const EmptyView = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  background-color: var(--color-background);
`

export default class MinApp {
  static topviewId = 0
  static onClose = () => {}
  static app: MinAppType | null = null

  // 保存最近打开的miniapp实例
  static appInstances: Map<
    string | number,
    {
      visible: boolean
      app: MinAppType
      lastUsed: number
    }
  > = new Map()

  // 最大缓存数量
  static MAX_INSTANCES = 5

  // 获取当前可见的miniapp
  static getVisibleApp(): MinAppType | null {
    for (const [, instance] of MinApp.appInstances) {
      if (instance.visible) {
        return instance.app
      }
    }
    return null
  }

  // 隐藏所有miniapp
  static hideAllApps() {
    for (const [id, instance] of MinApp.appInstances) {
      instance.visible = false
      MinApp.appInstances.set(id, instance)
    }
  }

  // 添加或更新miniapp实例
  static updateAppInstance(app: MinAppType, visible: boolean = true) {
    if (!app.id) return undefined

    // 更新使用时间
    const now = Date.now()

    MinApp.appInstances.set(app.id, {
      visible,
      app,
      lastUsed: now
    })

    // 清理过多实例
    if (MinApp.appInstances.size > MinApp.MAX_INSTANCES) {
      let oldestId: string | number | null = null
      let oldestTime = Infinity

      for (const [id, instance] of MinApp.appInstances) {
        if (!instance.visible && instance.lastUsed < oldestTime) {
          oldestTime = instance.lastUsed
          oldestId = id
        }
      }

      // 如果所有app都可见，则移除最早使用的
      if (oldestId === null) {
        for (const [id, instance] of MinApp.appInstances) {
          if (instance.lastUsed < oldestTime) {
            oldestTime = instance.lastUsed
            oldestId = id
          }
        }
      }

      if (oldestId !== null) {
        console.log(`[MinApp] 移除最久未使用的应用: ${oldestId}`)
        MinApp.appInstances.delete(oldestId)
      }
    }

    console.log(`[MinApp] 当前应用池: ${MinApp.appInstances.size}/${MinApp.MAX_INSTANCES}个`)
  }

  // 获取miniapp实例
  static getAppInstance(id: string | number) {
    return MinApp.appInstances.get(id)
  }

  // 获取当前应用ID (用于导航栏判断高亮状态)
  static getCurrentAppId(): string | number | null {
    if (!MinApp.app || !MinApp.app.id) return null
    return MinApp.app.id
  }

  // 缓存webview状态
  static webviewCache = new Map<string | number, any>()

  static getFromCache(id: string | number) {
    return this.webviewCache.get(id)
  }

  static async start(app: MinAppType) {
    console.log(`[MinApp] 启动应用: ${app.name} (ID: ${app?.id})`)

    if (!app.id) {
      console.warn('[MinApp] 应用没有ID，无法缓存')
      return await MinApp.startNewApp(app)
    }

    // 检查是否是当前正在显示的应用
    if (app?.id && MinApp.app?.id === app?.id) {
      console.log(`[MinApp] ${app.name} 已经打开，不重新加载`)
      return undefined
    }

    // 尝试通过全局变量注入事件总线
    try {
      const EVENT_EMITTER = (window as any).EventEmitter
      const EVENT_NAMES_OBJ = (window as any).EVENT_NAMES
      if (EVENT_EMITTER && EVENT_NAMES_OBJ?.MINIAPP_CHANGED) {
        EVENT_EMITTER.emit(EVENT_NAMES_OBJ.MINIAPP_CHANGED, { appId: app.id })
        console.log('[MinApp] 已触发MINIAPP_CHANGED事件')
      }
    } catch (err) {
      console.error('[MinApp] 触发事件失败:', err)
    }

    // 检查应用是否已在缓存池中
    const existingInstance = MinApp.getAppInstance(app.id)
    if (existingInstance) {
      console.log(`[MinApp] 从应用池中恢复应用: ${app.name}`)

      // 先隐藏当前应用
      MinApp.hideAllApps()

      // 更新当前应用为点击的应用（直接更新）
      MinApp.app = app

      // 将该应用标记为可见并更新时间
      existingInstance.visible = true
      existingInstance.lastUsed = Date.now()
      MinApp.appInstances.set(app.id, existingInstance)

      // 触发应用显示
      store.dispatch(setMinappShow(true))

      // 更新当前选中的应用状态 - 导航栏高亮显示
      try {
        // 导入放在这里避免循环依赖
        const { setCurrentMinApp } = require('@renderer/store/minapps')
        store.dispatch(setCurrentMinApp(app.id))
      } catch (err) {
        console.error('[MinApp] 更新导航栏状态失败:', err)
      }

      return undefined
    }

    // 启动新应用
    return await MinApp.startNewApp(app)
  }

  // 启动一个新的miniapp（不在缓存中）
  static async startNewApp(app: MinAppType) {
    console.log(`[MinApp] 启动新应用: ${app.name}`)

    // 隐藏当前可见的应用
    MinApp.hideAllApps()

    if (!app.logo) {
      app.logo = AppLogo
    }

    // 设置为当前应用
    MinApp.app = app

    // 如果有ID，添加到实例池
    if (app.id) {
      MinApp.updateAppInstance(app, true)

      // 更新当前选中的应用状态 - 导航栏高亮显示
      try {
        // 导入放在这里避免循环依赖
        const { setCurrentMinApp } = require('@renderer/store/minapps')
        store.dispatch(setCurrentMinApp(app.id))
      } catch (err) {
        console.error('[MinApp] 更新导航栏状态失败:', err)
      }
    }

    // 显示应用
    store.dispatch(setMinappShow(true))

    return new Promise<any>((resolve) => {
      TopView.show(
        <MiniAppContainer
          app={app}
          resolve={(v) => {
            resolve(v)
            this.close()
          }}
        />,
        'MinApp'
      )
    })
  }

  static close() {
    console.log(`[MinApp] 关闭应用: ${MinApp.app?.name || 'unknown'}`)

    // 找到当前可见的应用实例，设置为隐藏
    if (MinApp.app?.id) {
      const instance = MinApp.getAppInstance(MinApp.app.id)
      if (instance) {
        instance.visible = false
        MinApp.appInstances.set(MinApp.app.id, instance)
      }

      // 清除当前选中的应用状态
      try {
        // 导入放在这里避免循环依赖
        const { setCurrentMinApp } = require('@renderer/store/minapps')
        store.dispatch(setCurrentMinApp(null))
      } catch (err) {
        console.error('[MinApp] 更新导航栏状态失败:', err)
      }

      // 尝试通过全局变量注入事件总线，通知关闭
      try {
        const EVENT_EMITTER = (window as any).EventEmitter
        const EVENT_NAMES_OBJ = (window as any).EVENT_NAMES
        if (EVENT_EMITTER && EVENT_NAMES_OBJ?.MINIAPP_CHANGED) {
          EVENT_EMITTER.emit(EVENT_NAMES_OBJ.MINIAPP_CHANGED, { appId: null })
          console.log('[MinApp] 已触发MINIAPP_CHANGED事件 (close)')
        }
      } catch (err) {
        console.error('[MinApp] 触发事件失败:', err)
      }
    }

    TopView.hide('MinApp')
    store.dispatch(setMinappShow(false))
    MinApp.app = null
    MinApp.onClose = () => {}
  }
}

// 初始化全局事件处理机制
setTimeout(() => {
  try {
    // 导入事件服务
    import('../../services/EventService').then(({ EventEmitter, EVENT_NAMES }) => {
      // 注入到全局对象，以便MinApp类可以静态访问
      ;(window as any).EventEmitter = EventEmitter
      ;(window as any).EVENT_NAMES = EVENT_NAMES

      // 添加自定义事件
      if (!(EVENT_NAMES as any).MINIAPP_CHANGED) {
        ;(EVENT_NAMES as any).MINIAPP_CHANGED = 'miniapp:changed'
      }

      console.log('[MinApp] 全局事件总线初始化成功:', EVENT_NAMES)

      // 测试监听
      EventEmitter.on((EVENT_NAMES as any).MINIAPP_CHANGED, (data: any) => {
        console.log('[MinApp] 收到MINIAPP_CHANGED事件:', data, '侧边栏应更新选中状态')
      })
    })
  } catch (err) {
    console.error('[MinApp] 全局事件总线初始化失败:', err)
  }
}, 500) // 延迟执行，确保所有依赖已加载
