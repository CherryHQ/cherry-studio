import { TopView } from '@renderer/components/TopView'
import { cn } from '@renderer/utils'
import { Modal } from 'antd'
import { Bot, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type OptionType = 'assistant' | 'agent'

interface ShowParams {
  onSelect: (type: OptionType) => void
}

interface Props extends ShowParams {
  resolve: (data: { type?: OptionType }) => void
}

const PopupContainer: React.FC<Props> = ({ onSelect, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [hoveredOption, setHoveredOption] = useState<OptionType | null>(null)

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const handleSelect = (type: OptionType) => {
    setOpen(false)
    onSelect(type)
    resolve({ type })
  }

  AddAssistantOrAgentPopup.hide = onCancel

  return (
    <Modal
      title={t('chat.add.option.title')}
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      footer={null}
      width={560}>
      <div className="grid grid-cols-2 gap-4 py-4">
        {/* Assistant Option */}
        <button
          type="button"
          onClick={() => handleSelect('assistant')}
          className="group flex cursor-pointer flex-col items-center gap-3 rounded-lg bg-[var(--color-background-soft)] p-6 transition-all hover:bg-[var(--color-hover)]"
          onMouseEnter={() => setHoveredOption('assistant')}
          onMouseLeave={() => setHoveredOption(null)}>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-list-item)] transition-colors">
            <MessageSquare
              size={24}
              className={cn(
                'transition-colors',
                hoveredOption === 'assistant' ? 'text-[var(--color-primary)]' : 'text-[var(--color-icon-white)]'
              )}
            />
          </div>
          <div className="text-center">
            <h3 className="mb-1 font-semibold text-[var(--color-text-1)] text-base">{t('chat.add.assistant.title')}</h3>
            <p className="text-[var(--color-text-2)] text-sm">{t('chat.add.assistant.description')}</p>
          </div>
        </button>

        {/* Agent Option */}
        <button
          onClick={() => handleSelect('agent')}
          type="button"
          className="group flex cursor-pointer flex-col items-center gap-3 rounded-lg bg-[var(--color-background-soft)] p-6 transition-all hover:bg-[var(--color-hover)]"
          onMouseEnter={() => setHoveredOption('agent')}
          onMouseLeave={() => setHoveredOption(null)}>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-list-item)] transition-colors">
            <Bot
              size={24}
              className={cn(
                'transition-colors',
                hoveredOption === 'agent' ? 'text-[var(--color-primary)]' : 'text-[var(--color-icon-white)]'
              )}
            />
          </div>
          <div className="text-center">
            <h3 className="mb-1 font-semibold text-[var(--color-text-1)] text-base">{t('agent.add.title')}</h3>
            <p className="text-[var(--color-text-2)] text-sm">{t('agent.add.description')}</p>
          </div>
        </button>
      </div>
    </Modal>
  )
}

const TopViewKey = 'AddAssistantOrAgentPopup'

export default class AddAssistantOrAgentPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<{ type?: OptionType }>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
