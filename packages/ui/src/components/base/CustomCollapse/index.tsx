import { Accordion, AccordionItem, type AccordionItemProps, type AccordionProps } from '@heroui/react'
import type { FC } from 'react'
import { memo } from 'react'

// 重新导出 HeroUI 的组件，方便直接使用
export { Accordion, AccordionItem } from '@heroui/react'

interface CustomCollapseProps {
  children: React.ReactNode
  accordionProps?: Omit<AccordionProps, 'children'>
  accordionItemProps?: Omit<AccordionItemProps, 'children'>
}

const CustomCollapse: FC<CustomCollapseProps> = ({ children, accordionProps = {}, accordionItemProps = {} }) => {
  // 解构 Accordion 的 props
  const {
    defaultExpandedKeys = ['1'],
    variant = 'bordered',
    className = '',
    isDisabled = false,
    ...restAccordionProps
  } = accordionProps

  // 解构 AccordionItem 的 props
  const { title = 'Collapse Panel', ...restAccordionItemProps } = accordionItemProps

  return (
    <Accordion
      defaultExpandedKeys={defaultExpandedKeys}
      variant={variant}
      className={className}
      isDisabled={isDisabled}
      selectionMode="multiple"
      {...restAccordionProps}>
      <AccordionItem
        key="1"
        aria-label={typeof title === 'string' ? title : 'collapse-item'}
        title={title}
        {...restAccordionItemProps}>
        {children}
      </AccordionItem>
    </Accordion>
  )
}

export default memo(CustomCollapse)
