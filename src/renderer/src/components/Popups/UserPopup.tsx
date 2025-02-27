import useAvatar from '@renderer/hooks/useAvatar'
import { useSettings } from '@renderer/hooks/useSettings'
import ImageStorage from '@renderer/services/ImageStorage'
import { useAppDispatch } from '@renderer/store'
import { setAvatar } from '@renderer/store/runtime'
import { setUserName } from '@renderer/store/settings'
import { compressImage } from '@renderer/utils'
import { Avatar, Button, Input, Modal, Popover, Upload } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Center, HStack, VStack } from '../Layout'
import { TopView } from '../TopView'
import EmojiPicker from '../EmojiPicker'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const { t } = useTranslation()
  const { userName } = useSettings()
  const dispatch = useAppDispatch()
  const avatar = useAvatar()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  const handleEmojiClick = async (emoji: string) => {
    try {
      // set emoji string
      await ImageStorage.set('avatar', emoji)
      // update avatar display
      dispatch(setAvatar(emoji))
      setEmojiPickerOpen(false)
    } catch (error: any) {
      window.message.error(error.message)
    }
  }

  // modify the judgment function, more accurately detect Emoji
  const isEmoji = (str: string) => {
    // check if it is a string and is not base64 or URL format
    return str && typeof str === 'string' && !str.startsWith('data:') && !str.startsWith('http');
  }

  return (
    <Modal
      width="300px"
      open={open}
      footer={null}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="ant-move-down"
      centered>
      <Center mt="30px">
        <VStack alignItems="center" gap="10px">
          <Popover
            content={<EmojiPicker onEmojiClick={handleEmojiClick} />}
            trigger="click"
            open={emojiPickerOpen}
            onOpenChange={setEmojiPickerOpen}
            placement="bottom">
            {isEmoji(avatar) ? (
              <EmojiAvatar>{avatar}</EmojiAvatar>
            ) : (
              <UserAvatar src={avatar} />
            )}
          </Popover>
          
          <HStack gap="10px">
            <Upload
              customRequest={() => {}}
              accept="image/png, image/jpeg, image/gif"
              itemRender={() => null}
              maxCount={1}
              onChange={async ({ file }) => {
                try {
                  const _file = file.originFileObj as File
                  if (_file.type === 'image/gif') {
                    await ImageStorage.set('avatar', _file)
                  } else {
                    const compressedFile = await compressImage(_file)
                    await ImageStorage.set('avatar', compressedFile)
                  }
                  dispatch(setAvatar(await ImageStorage.get('avatar')))
                } catch (error: any) {
                  window.message.error(error.message)
                }
              }}>
              <Button size="small">{t('Upload')}</Button>
            </Upload>
            <Button size="small" onClick={() => setEmojiPickerOpen(true)}>
              {t('Emoji')}
            </Button>
          </HStack>
        </VStack>
      </Center>
      <HStack alignItems="center" gap="10px" p="20px">
        <Input
          placeholder={t('settings.general.user_name.placeholder')}
          value={userName}
          onChange={(e) => dispatch(setUserName(e.target.value))}
          style={{ flex: 1, textAlign: 'center', width: '100%' }}
          maxLength={30}
        />
      </HStack>
    </Modal>
  )
}

const UserAvatar = styled(Avatar)`
  cursor: pointer;
  width: 80px;
  height: 80px;
  transition: opacity 0.3s ease;
  &:hover {
    opacity: 0.8;
  }
`

// 添加一个专门用于显示 Emoji 的样式组件
const EmojiAvatar = styled.div`
  cursor: pointer;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background-color: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  transition: opacity 0.3s ease;
  &:hover {
    opacity: 0.8;
  }
`

export default class UserPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('UserPopup')
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'UserPopup'
      )
    })
  }
}
