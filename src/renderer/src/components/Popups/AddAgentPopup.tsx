import {
  Avatar,
  Button,
  Form,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectedItemProps,
  SelectedItems,
  SelectItem
} from '@heroui/react'
import ClaudeCodeIcon from '@renderer/assets/images/models/claude.png'
import { TopView } from '@renderer/components/TopView'
import { useAgents } from '@renderer/hooks/useAgents'
import { useTimer } from '@renderer/hooks/useTimer'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { AgentEntity } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (value: AgentEntity | undefined) => void
}

type AgentTypeOption = {
  key: AgentEntity['type']
  name: AgentEntity['name']
  avatar: AgentEntity['avatar']
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const loadingRef = useRef(false)
  const { setTimeoutTimer } = useTimer()
  const { addAgent } = useAgents()

  const Option = useCallback(
    ({ option }: { option?: AgentTypeOption | null }) => {
      if (!option) {
        return (
          <div className="flex gap-2">
            <Avatar name="?" className="h-5 w-5" />
            {t('common.invalid_value')}
          </div>
        )
      }
      return (
        <div className="flex gap-2">
          <Avatar src={option.avatar} className="h-5 w-5" />
          {option.name}
        </div>
      )
    },
    [t]
  )

  const Item = useCallback(
    ({ item }: { item: SelectedItemProps<AgentTypeOption> }) => <Option option={item.data} />,
    [Option]
  )

  const renderValue = useCallback(
    (items: SelectedItems<AgentTypeOption>) => items.map((item) => <Item key={item.key} item={item} />),
    [Item]
  )

  // add supported agents type here
  const agentConfig = useMemo(
    () =>
      [
        {
          key: 'claude-code',
          name: 'Claude Code',
          avatar: ClaudeCodeIcon
        }
      ] as const satisfies AgentTypeOption[],
    []
  )

  const agentOptions: AgentTypeOption[] = useMemo(
    () =>
      agentConfig.map(
        (option) =>
          ({
            ...option,
            rendered: <Option option={option} />
          }) as const satisfies SelectedItemProps
      ),
    [Option, agentConfig]
  )

  const onCreateAgent = useCallback(
    async (option: AgentTypeOption) => {
      if (loadingRef.current) {
        return
      }

      loadingRef.current = true
      // TODO: update redux state
      const agent = {
        id: uuid(),
        type: option.key,
        name: option.name,
        created_at: '',
        updated_at: '',
        model: ''
      } satisfies AgentEntity

      setTimeoutTimer('onCreateAgent', () => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
      resolve(agent)
      setOpen(false)
    },
    [setTimeoutTimer, resolve]
  )

  const onClose = async () => {
    setOpen(false)
    AddAgentPopup.hide()
    resolve(undefined)
  }

  const onSubmit = async () => {
    window.toast.info('not implemented :(')
  }

  return (
    <Modal isOpen={open} onClose={onClose}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t('agent.add.title')}</ModalHeader>
            <ModalBody>
              <Form>
                <Select
                  items={agentOptions}
                  label={t('agent.add.label')}
                  placeholder={t('agent.add.placeholder')}
                  renderValue={renderValue}>
                  {(option) => (
                    <SelectItem key={option.key}>
                      <Option option={option} />
                    </SelectItem>
                  )}
                </Select>
              </Form>
            </ModalBody>
            <ModalFooter>
              <Button onPress={onClose}>{t('common.close')}</Button>
              <Button color="primary" onPress={onSubmit}>
                {t('common.add')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export default class AddAgentPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddAgentPopup')
  }
  static show() {
    return new Promise<AgentEntity | undefined>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, 'AddAgentPopup')
    })
  }
}
