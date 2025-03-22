import isPropValid from '@emotion/is-prop-valid'
import { ReactNode } from 'react'
import { StyleSheetManager as StyledComponentsStyleSheetManager } from 'styled-components'
import rtlPlugin from 'stylis-plugin-rtl'

import { useLayoutDirection } from './LayoutDirection'

interface StyleSheetManagerProps {
  children: ReactNode
}

const StyleSheetManager = ({ children }: StyleSheetManagerProps): JSX.Element => {
  const { isRTL } = useLayoutDirection()
  return (
    <StyledComponentsStyleSheetManager
      enableVendorPrefixes
      stylisPlugins={isRTL ? [rtlPlugin] : []}
      shouldForwardProp={(prop, element) => {
        // 对于 HTML 元素，使用 isPropValid 检查
        if (typeof element === 'string') {
          return isPropValid(prop)
        }
        // 对于自定义组件，允许所有非特殊属性通过
        return prop !== '$' && !prop.startsWith('$')
      }}>
      {children}
    </StyledComponentsStyleSheetManager>
  )
}

export default StyleSheetManager
