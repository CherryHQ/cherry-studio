import { FormOutlined } from '@ant-design/icons'
import { Button, cn } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { EventEmitter } from '@renderer/services/EventService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const NewTopicButton: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const addNewTopic = () => {
    EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC)
  }

  return (
    <div className="-mt-2.5 mb-2.5 flex min-h-auto items-center justify-center p-0">
      <Button
        size="sm"
        variant="light"
        color="primary"
        radius="full"
        startContent={<FormOutlined />}
        onPress={addNewTopic}
        className={cn(
          'h-[34px]! px-3 text-xs opacity-80 transition-all duration-300',
          'hover:border-[var(--color-border-mute)] hover:text-[var(--color-text-1)]! hover:opacity-90',
          theme === ThemeMode.dark
            ? 'bg-[var(--color-background-soft)] hover:bg-[var(--color-background-mute)]!'
            : undefined
        )}
        style={{
          backgroundColor: theme === ThemeMode.dark ? '' : undefined,
          color: 'var(--color-text-2)'
        }}>
        {t('chat.topics.new')}
      </Button>
    </div>
  )
}

export default NewTopicButton
