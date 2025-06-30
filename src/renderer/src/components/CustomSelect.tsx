import { includeKeywords } from '@renderer/utils/search'
import { Select, SelectProps } from 'antd'

/**
 * 自定义 Select，使用增强的搜索 filter
 */
const CustomSelect = ({ ref, ...props }: SelectProps & { ref?: React.RefObject<any | null> }) => {
  return <Select ref={ref} filterOption={enhancedFilterOption} {...props} />
}

CustomSelect.displayName = 'CustomSelect'

function enhancedFilterOption(input: string, option: any) {
  return includeKeywords(option.label, input)
}

export default CustomSelect
