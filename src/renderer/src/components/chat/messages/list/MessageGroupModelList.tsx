import { Avatar, AvatarFallback, AvatarGroup, RowFlex, SegmentedControl, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import Scrollbar from '@renderer/components/Scrollbar'
import { getModelLogo } from '@renderer/config/models'
import type { Model } from '@renderer/types'
import { AssistantMessageStatus, type Message } from '@renderer/types/newMessage'
import { lightbulbSoftVariants } from '@renderer/utils/motionVariants'
import type { MultiModelFoldDisplayMode } from '@shared/data/preference/preferenceTypes'
import { first } from 'lodash'
import { Maximize2, Minimize2 } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC } from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
interface MessageGroupModelListProps {
  messages: Message[]
  selectMessageId: string
  setSelectedMessage: (message: Message) => void
}

const MessageGroupModelList: FC<MessageGroupModelListProps> = ({ messages, selectMessageId, setSelectedMessage }) => {
  const [foldDisplayMode, setFoldDisplayMode] = usePreference('chat.message.multi_model.fold_display_mode')
  const { t } = useTranslation()
  const isCompact = foldDisplayMode === 'compact'

  const isMessageProcessing = useCallback((message: Message) => {
    return [
      AssistantMessageStatus.PENDING,
      AssistantMessageStatus.PROCESSING,
      AssistantMessageStatus.SEARCHING
    ].includes(message.status as AssistantMessageStatus)
  }, [])

  const renderLabel = useCallback(
    (message: Message) => {
      const modelTip = message.model?.name
      const isProcessing = isMessageProcessing(message)

      if (isCompact) {
        return (
          <Tooltip key={message.id} content={modelTip} delay={500}>
            <AvatarWrapper
              className="avatar-wrapper"
              $isSelected={message.id === selectMessageId}
              onClick={() => {
                setSelectedMessage(message)
              }}>
              <motion.span variants={lightbulbSoftVariants} animate={isProcessing ? 'active' : 'idle'} initial="idle">
                <ModelAvatar model={message.model as Model} size={22} />
              </motion.span>
            </AvatarWrapper>
          </Tooltip>
        )
      }
      return (
        <SegmentedLabel>
          <ModelAvatar className={isProcessing ? 'animation-pulse' : ''} model={message.model as Model} size={20} />
          <ModelName>{message.model?.name}</ModelName>
        </SegmentedLabel>
      )
    },
    [isCompact, isMessageProcessing, selectMessageId, setSelectedMessage]
  )

  return (
    <Container>
      <Tooltip
        content={
          isCompact
            ? t('message.message.multi_model_style.fold.expand')
            : t('message.message.multi_model_style.fold.compress')
        }
        delay={500}>
        <DisplayModeToggle
          displayMode={foldDisplayMode}
          onClick={() => setFoldDisplayMode(isCompact ? 'expanded' : 'compact')}>
          {isCompact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </DisplayModeToggle>
      </Tooltip>
      <ModelsContainer $displayMode={foldDisplayMode}>
        {isCompact ? (
          /* Compact style display */
          <AvatarGroup className="p-2">
            {messages.map((message) => {
              const modelTip = message.model?.name
              const isSelected = message.id === selectMessageId

              return (
                <Tooltip key={message.id} content={modelTip} delay={500}>
                  {(() => {
                    const Icon = getModelLogo(message.model)
                    return Icon ? (
                      <div onClick={() => setSelectedMessage(message)} className="cursor-pointer">
                        <Icon.Avatar size={24} className={isSelected ? 'shadow-lg ring-2 ring-primary' : 'shadow-lg'} />
                      </div>
                    ) : (
                      <Avatar
                        className={`h-6 w-6 cursor-pointer shadow-lg ${isSelected ? 'ring-2 ring-primary' : ''}`}
                        onClick={() => setSelectedMessage(message)}>
                        <AvatarFallback>{first(message.model?.name)}</AvatarFallback>
                      </Avatar>
                    )
                  })()}
                </Tooltip>
              )
            })}
          </AvatarGroup>
        ) : (
          /* Expanded style display */
          <SegmentedControl
            value={selectMessageId}
            onValueChange={(value) => {
              const message = messages.find((message) => message.id === value) as Message
              setSelectedMessage(message)
            }}
            options={messages.map((message) => ({
              label: renderLabel(message),
              value: message.id
            }))}
            size="sm"
          />
        )}
      </ModelsContainer>
    </Container>
  )
}

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof RowFlex>) => (
  <RowFlex className={['ml-1 flex-1 items-center overflow-hidden', className].filter(Boolean).join(' ')} {...props} />
)

const DisplayModeToggle = ({
  className,
  displayMode,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { displayMode: MultiModelFoldDisplayMode }) => {
  void displayMode
  return (
    <div
      className={[
        'flex h-[26px] w-[26px] cursor-pointer rounded px-1.5 pt-0.5 pb-[3px] hover:bg-(--color-hover)',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}

const ModelsContainer = ({
  className,
  $displayMode,
  ...props
}: React.ComponentPropsWithoutRef<typeof Scrollbar> & { $displayMode: MultiModelFoldDisplayMode }) => (
  <Scrollbar
    className={[
      '[&_[data-slot=avatar-group]>*:has(+_*:hover)]:-translate-x-0.5 flex flex-1 items-center overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_[data-slot=avatar-group]>*:first-child]:ml-0! [&_[data-slot=avatar-group]>*:has(+_*:hover)]:mr-0.5! [&_[data-slot=avatar-group]>*:hover+*+*]:ml-[-4px]! [&_[data-slot=avatar-group]>*:hover+*]:ml-[5px]! [&_[data-slot=avatar-group]>*]:relative [&_[data-slot=avatar-group]>*]:ml-[-6px]! [&_[data-slot=avatar-group]>*]:transition-[transform,margin] [&_[data-slot=avatar-group]>*]:duration-[180ms] [&_[data-slot=avatar-group]>*]:ease-out [&_[data-slot=avatar-group]>*]:[will-change:transform] [&_[data-slot=avatar-group]]:flex [&_[data-slot=avatar-group]]:flex-nowrap [&_[data-slot=avatar-group]]:items-center [&_[data-slot=avatar-group]]:px-1 [&_[data-slot=avatar-group]]:py-1.5',
      $displayMode === 'expanded' ? 'flex-col justify-between' : 'flex-row justify-start',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const AvatarWrapper = ({
  className,
  $isSelected,
  style,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $isSelected: boolean }) => (
  <div
    className={[
      'inline-flex cursor-pointer rounded-full bg-(--color-background) transition-[transform,margin,filter] duration-[180ms] ease-out hover:mr-1! hover:ml-2! hover:translate-x-1.5 hover:scale-115 hover:brightness-[1.02]',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    style={{ zIndex: $isSelected ? 1 : 0, border: $isSelected ? '2px solid var(--color-primary)' : 'none', ...style }}
    {...props}
  />
)

const SegmentedLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex items-center gap-[5px] py-[3px]', className].filter(Boolean).join(' ')} {...props} />
)

const ModelName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={['font-medium text-xs', className].filter(Boolean).join(' ')} {...props} />
)

export default memo(MessageGroupModelList)
