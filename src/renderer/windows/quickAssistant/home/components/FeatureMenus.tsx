import { Scrollbar } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { CornerDownLeft, FileText, Languages, Lightbulb, MessageSquare } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface FeatureMenusProps {
  text: string
  setRoute: Dispatch<SetStateAction<'translate' | 'summary' | 'chat' | 'explanation' | 'home'>>
  onSendMessage: (prompt?: string) => void
}

export interface FeatureMenusRef {
  nextFeature: () => void
  prevFeature: () => void
  useFeature: () => void
  resetSelectedIndex: () => void
}

const FeatureMenus = ({
  ref,
  text,
  setRoute,
  onSendMessage
}: FeatureMenusProps & { ref?: React.RefObject<FeatureMenusRef | null> }) => {
  const { t } = useTranslation()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const features = useMemo(
    () => [
      {
        icon: <MessageSquare className="size-4 text-foreground" />,
        title: t('quickAssistant.feature.chat'),
        active: true,
        onClick: () => {
          if (text) {
            setRoute('chat')
            onSendMessage()
          }
        }
      },
      {
        icon: <Languages className="size-4 text-foreground" />,
        title: t('quickAssistant.feature.translate'),
        onClick: () => text && setRoute('translate')
      },
      {
        icon: <FileText className="size-4 text-foreground" />,
        title: t('quickAssistant.feature.summary'),
        onClick: () => {
          if (text) {
            setRoute('summary')
            onSendMessage(t('prompts.summarize'))
          }
        }
      },
      {
        icon: <Lightbulb className="size-4 text-foreground" />,
        title: t('quickAssistant.feature.explanation'),
        onClick: () => {
          if (text) {
            setRoute('explanation')
            onSendMessage(t('prompts.explanation'))
          }
        }
      }
    ],
    [onSendMessage, setRoute, t, text]
  )

  useImperativeHandle(ref, () => ({
    nextFeature() {
      setSelectedIndex((prev) => (prev < features.length - 1 ? prev + 1 : 0))
    },
    prevFeature() {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : features.length - 1))
    },
    useFeature() {
      features[selectedIndex].onClick?.()
    },
    resetSelectedIndex() {
      setSelectedIndex(0)
    }
  }))

  return (
    <Scrollbar className="h-auto shrink-0 [-webkit-app-region:no-drag]">
      <div className="flex cursor-pointer flex-col gap-1">
        {features.map((feature, index) => (
          <button
            type="button"
            key={index}
            onClick={feature.onClick}
            className={cn(
              'flex w-full cursor-pointer select-none flex-row items-center gap-3 rounded-lg border-0 bg-transparent px-4 py-2 text-start transition-colors [-webkit-app-region:no-drag] hover:bg-accent',
              index === selectedIndex && 'bg-accent'
            )}>
            <span className="flex shrink-0 items-center justify-center">{feature.icon}</span>
            <span className="m-0 flex-1 text-foreground text-sm">{feature.title}</span>
            {index === selectedIndex && <CornerDownLeft className="size-4 text-muted-foreground" />}
          </button>
        ))}
      </div>
    </Scrollbar>
  )
}
FeatureMenus.displayName = 'FeatureMenus'

export default FeatureMenus
