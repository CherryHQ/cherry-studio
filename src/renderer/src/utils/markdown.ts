// 更彻底的查找方法，递归搜索所有子元素
export const findCitationInChildren = (children) => {
  if (!children) return null

  // 直接搜索子元素
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'object' && child?.props?.['data-citation']) {
      return child.props['data-citation']
    }

    // 递归查找更深层次
    if (typeof child === 'object' && child?.props?.children) {
      const found = findCitationInChildren(child.props.children)
      if (found) return found
    }
  }

  return null
}
