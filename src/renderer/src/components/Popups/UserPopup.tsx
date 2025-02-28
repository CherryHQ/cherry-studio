import useAvatar from '@renderer/hooks/useAvatar'
import { useSettings } from '@renderer/hooks/useSettings'
import ImageStorage from '@renderer/services/ImageStorage'
import { useAppDispatch } from '@renderer/store'
import { setAvatar } from '@renderer/store/runtime'
import { setUserName } from '@renderer/store/settings'
import { compressImage } from '@renderer/utils'
import { Avatar, Input, Modal, Upload } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { Center, HStack } from '../Layout'
import { TopView } from '../TopView'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
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
          <UserAvatar src={avatar} />
        </Upload>
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
