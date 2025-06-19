import { groupTranslations } from '@renderer/pages/agents/agentGroupTranslations'
import { DynamicIcon, IconName } from 'lucide-react/dynamic'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  groupName: string
  size?: number
  strokeWidth?: number
}

export const AgentGroupIcon: FC<Props> = ({ groupName, size = 20, strokeWidth = 1.2 }) => {
  const { i18n } = useTranslation()
  const currentLanguage = i18n.language as keyof (typeof groupTranslations)[string]

  const findOriginalKey = (name: string): string => {
    if (groupTranslations[name]) {
      return name
    }

    for (const key in groupTranslations) {
      if (groupTranslations[key][currentLanguage] === name) {
        return key
      }
    }

    return name
  }

  const originalKey = findOriginalKey(groupName)

  const iconMap: { [key: string]: IconName } = {
    我的: 'user-check',
    精选: 'star',
    职业: 'briefcase',
    商业: 'handshake',
    工具: 'wrench',
    语言: 'languages',
    办公: 'file-text',
    通用: 'settings',
    写作: 'pen-tool',
    编程: 'code',
    情感: 'heart',
    教育: 'graduation-cap',
    创意: 'lightbulb',
    学术: 'book-open',
    设计: 'wand-sparkles',
    艺术: 'palette',
    娱乐: 'gamepad-2',
    生活: 'coffee',
    医疗: 'stethoscope',
    游戏: 'gamepad-2',
    翻译: 'languages',
    音乐: 'music',
    点评: 'message-square-more',
    文案: 'file-text',
    百科: 'book',
    健康: 'heart-pulse',
    营销: 'trending-up',
    科学: 'flask-conical',
    分析: 'bar-chart',
    法律: 'scale',
    咨询: 'messages-square',
    金融: 'banknote',
    旅游: 'plane',
    管理: 'users',
    搜索: 'search'
  } as const

  return <DynamicIcon name={iconMap[originalKey] || 'bot-message-square'} size={size} strokeWidth={strokeWidth} />
}
