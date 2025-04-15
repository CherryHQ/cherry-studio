import { useEffect, useState } from 'react'

export type MathEngineType = 'KaTeX' | 'MathJax'

/**
 * 数学插件缓存单例
 */
const mathPluginCache: {
  katex: any | null
  mathjax: any | null
  katexCssLoaded: boolean
} = {
  katex: null,
  mathjax: null,
  katexCssLoaded: false
}

/**
 * 加载数学引擎插件
 * @param engineType 数学引擎类型
 * @returns 加载的插件
 */
async function loadMathPlugin(engineType: MathEngineType) {
  if (engineType === 'KaTeX') {
    if (!mathPluginCache.katex) {
      if (!mathPluginCache.katexCssLoaded) {
        // 加载KaTeX样式和扩展
        await import('katex/dist/katex.min.css')
        await import(/* @vite-ignore */ 'katex/dist/contrib/copy-tex' as any)
        await import(/* @vite-ignore */ 'katex/dist/contrib/mhchem' as any)
        mathPluginCache.katexCssLoaded = true
      }
      // 加载KaTeX插件
      const { default: rehypeKatex } = await import('rehype-katex')
      mathPluginCache.katex = rehypeKatex
    }
    return mathPluginCache.katex
  } else {
    if (!mathPluginCache.mathjax) {
      // @ts-ignore next-line
      const { default: rehypeMathjax } = await import('rehype-mathjax')
      mathPluginCache.mathjax = rehypeMathjax
    }
    return mathPluginCache.mathjax
  }
}

/**
 * Markdown数学公式渲染钩子
 * @param engineType 数学引擎类型
 * @returns 数学公式渲染插件
 */
export function useMarkdownMath(engineType: MathEngineType) {
  const [plugin, setPlugin] = useState<any>(null)

  useEffect(() => {
    let isMounted = true

    // 重置插件状态，避免显示上一个引擎的插件
    setPlugin(null)

    loadMathPlugin(engineType)
      .then((loadedPlugin) => {
        if (isMounted) {
          setPlugin(() => loadedPlugin)
        }
      })
      .catch((error) => {
        console.error(`Error loading ${engineType} plugin:`, error)
      })

    return () => {
      isMounted = false
    }
  }, [engineType])

  return plugin
}
