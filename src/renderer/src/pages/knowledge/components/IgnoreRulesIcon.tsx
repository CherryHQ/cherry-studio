import { InfoCircleOutlined } from '@ant-design/icons'
import { KnowledgeItem } from '@renderer/types'
import { Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import DirectoryConfigPopup from './DirectoryConfigPopup'

interface IgnoreRulesIconProps {
  item: KnowledgeItem
}

const IgnoreRulesIcon: FC<IgnoreRulesIconProps> = ({ item }) => {
  const { t } = useTranslation()

  // 只有目录类型且有忽略规则的项才显示图标
  if (item.type !== 'directory' || !item.ignorePatterns || item.ignorePatterns.patterns.length === 0) {
    return null
  }

  // 生成简略的规则预览文本
  const previewText = () => {
    const { patterns, type } = item.ignorePatterns!
    const patternText = patterns.slice(0, 3).join(', ') + (patterns.length > 3 ? '...' : '')
    return `${t(`knowledge.ignore_type_${type}`)}: ${patternText}`
  }

  const handleClick = async () => {
    // 打开只读的忽略规则弹窗
    await DirectoryConfigPopup.show({
      directoryPath: item.content as string,
      title: t('knowledge.view_ignore_patterns'),
      ignorePatterns: item.ignorePatterns,
      readOnly: true
    })
  }

  return (
    <Tooltip title={previewText()}>
      <InfoCircleOutlined
        onClick={(e) => {
          e.stopPropagation()
          handleClick()
        }}
        style={{ marginLeft: 8, cursor: 'pointer', color: 'var(--color-text-3)' }}
      />
    </Tooltip>
  )
}

export default IgnoreRulesIcon
