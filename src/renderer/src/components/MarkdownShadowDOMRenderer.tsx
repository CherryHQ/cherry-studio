import { StyleProvider } from '@ant-design/cssinjs'
import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { StyleSheetManager } from 'styled-components'

interface Props {
  children: React.ReactNode
}

const ShadowDOMRenderer: React.FC<Props> = ({ children }) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const [shadowRoot, setShadowRoot] = React.useState<ShadowRoot | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // 创建 shadow root
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' })

    // 获取原始样式表
    const markdownStyleSheet = Array.from(document.styleSheets).find((sheet) => {
      try {
        return Array.from(sheet.cssRules).some((rule: CSSRule) => {
          return rule.cssText?.includes('.markdown')
        })
      } catch {
        return false
      }
    })

    if (markdownStyleSheet) {
      const style = document.createElement('style')
      const cssRules = Array.from(markdownStyleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n')

      style.textContent = cssRules
      shadow.appendChild(style)
    }

    setShadowRoot(shadow)
  }, [])

  if (!shadowRoot) {
    return <div ref={hostRef} />
  }

  return (
    <div ref={hostRef}>
      {createPortal(
        <StyleSheetManager target={shadowRoot}>
          <StyleProvider container={shadowRoot} layer>
            {children}
          </StyleProvider>
        </StyleSheetManager>,
        shadowRoot
      )}
    </div>
  )
}

export default ShadowDOMRenderer
