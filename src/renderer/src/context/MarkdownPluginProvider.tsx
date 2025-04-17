import { createContext, PropsWithChildren, use, useCallback, useEffect, useMemo, useState } from 'react'

// Rehype插件类型
export type RehypePluginName = 'rehype-katex' | 'rehype-mathjax' | 'rehype-raw'

// 插件缓存
const pluginCache: Record<string, any> = {
  katexCssLoaded: false
}

interface MarkdownPluginContextType {
  loadRehypePlugins: (pluginNames: RehypePluginName[]) => Promise<any[]>
}

const MarkdownPluginContext = createContext<MarkdownPluginContextType | null>(null)

export const MarkdownPluginProvider: React.FC<PropsWithChildren> = ({ children }) => {
  // 根据插件名称加载对应的rehype插件
  const loadRehypePlugin = useCallback(async (name: RehypePluginName): Promise<any> => {
    // 如果已经缓存，直接返回
    if (pluginCache[name]) {
      return pluginCache[name]
    }

    try {
      let plugin: any = null

      switch (name) {
        case 'rehype-katex': {
          if (!pluginCache.katexCssLoaded) {
            await import('katex/dist/katex.min.css')
            await import(/* @vite-ignore */ 'katex/dist/contrib/copy-tex' as any)
            await import(/* @vite-ignore */ 'katex/dist/contrib/mhchem' as any)
            pluginCache.katexCssLoaded = true
          }
          const { default: rehypeKatex } = await import('rehype-katex')
          plugin = rehypeKatex
          break
        }
        case 'rehype-mathjax': {
          // @ts-ignore next-line
          const { default: rehypeMathjax } = await import('rehype-mathjax')
          plugin = rehypeMathjax
          break
        }
        case 'rehype-raw': {
          const { default: rehypeRaw } = await import('rehype-raw')
          plugin = rehypeRaw
          break
        }
        default:
          throw new Error(`Unknown rehype plugin: ${name}`)
      }

      // 缓存并返回
      pluginCache[name] = plugin
      return plugin
    } catch (error) {
      console.error(`Error loading rehype plugin "${name}":`, error)
      throw error
    }
  }, [])

  // 批量加载rehype插件的函数
  const loadRehypePlugins = useCallback(
    async (pluginNames: RehypePluginName[]): Promise<any[]> => {
      try {
        return await Promise.all(pluginNames.map((name) => loadRehypePlugin(name)))
      } catch (error) {
        console.error('Failed to load rehype plugins:', error)
        return []
      }
    },
    [loadRehypePlugin]
  )

  const value = useMemo(
    () => ({
      loadRehypePlugins
    }),
    [loadRehypePlugins]
  )

  return <MarkdownPluginContext value={value}>{children}</MarkdownPluginContext>
}

export function useMarkdownPlugins() {
  const context = use(MarkdownPluginContext)
  if (!context) {
    throw new Error('useMarkdownPlugins must be used within a MarkdownPluginProvider')
  }
  return context
}

// 在组件中使用rehype插件的 hook
export function useRehypePlugins(pluginNames: RehypePluginName[]) {
  const { loadRehypePlugins } = useMarkdownPlugins()
  const [plugins, setPlugins] = useState<any[]>([])

  useEffect(() => {
    let mounted = true

    loadRehypePlugins(pluginNames).then((loadedPlugins) => {
      if (mounted) {
        setPlugins(loadedPlugins)
      }
    })

    return () => {
      mounted = false
    }
  }, [loadRehypePlugins, pluginNames])

  return plugins
}
