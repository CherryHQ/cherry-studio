import { loggerService } from '@logger'
import { PoeLogo } from '@renderer/components/Icons'
import { PROVIDER_LOGO_MAP } from '@renderer/config/providers'
import ImageStorage from '@renderer/services/ImageStorage'
import { getProviderById } from '@renderer/services/ProviderService'
import { useAppSelector } from '@renderer/store'
import { removeLogo, setLogo, setLogos } from '@renderer/store/llm'
import { isSystemProviderId, Provider } from '@renderer/types'
import { generateColorFromChar, getFirstCharacter, getForegroundColor } from '@renderer/utils'
import { Avatar, AvatarProps } from 'antd'
import { AvatarSize } from 'antd/es/avatar/AvatarContext'
import { isEmpty } from 'lodash'
import { useCallback, useEffect } from 'react'
import { useDispatch } from 'react-redux'
import styled, { CSSProperties } from 'styled-components'

const logger = loggerService.withContext('useProviderLogo')

export const useProviderAvatar = () => {
  const providers = useAppSelector((state) => state.llm.providers)
  const logos = useAppSelector((state) => state.llm.logos)
  const dispatch = useDispatch()

  const saveLogo = useCallback(
    async (logo: string, providerId: string) => {
      ImageStorage.set(`provider-${providerId}`, logo)
      dispatch(setLogo({ id: providerId, logo }))
    },
    [dispatch]
  )

  const deleteLogo = useCallback(
    async (id: string) => {
      ImageStorage.remove(id).catch((e) => logger.error('Falied to remove image.', e as Error))
      dispatch(removeLogo(id))
    },
    [dispatch]
  )

  useEffect(() => {
    const getLogos = async () => {
      const _logos = {}
      for (const p of providers) {
        _logos[p.id] = await ImageStorage.get(`provider-${p.id}`)
      }
      dispatch(setLogos(_logos))
    }
    getLogos()
  }, [dispatch, providers])

  const ProviderAvatar = useCallback(
    ({
      pid,
      name,
      size,
      src,
      style,
      ...rest
    }: {
      pid?: string
      name?: string
      size?: number
      src?: string
    } & AvatarProps) => {
      if (src) {
        return <ProviderLogo draggable="false" shape="square" src={src} size={size} style={style} {...rest} />
      }
      let provider: Provider | undefined
      if (pid) {
        // 特殊处理一下svg格式
        if (isSystemProviderId(pid)) {
          const logoSrc = PROVIDER_LOGO_MAP[pid]
          switch (pid) {
            case 'poe':
              return <PoeLogo fontSize={typeof size === 'number' ? size : 18} style={style} />
            default:
              return <ProviderLogo draggable="false" shape="square" src={logoSrc} size={size} style={style} {...rest} />
          }
        }

        const customLogo = logos[pid]
        if (customLogo) {
          return <ProviderLogo draggable="false" shape="square" src={customLogo} size={size} style={style} {...rest} />
        }
        if (!name) {
          // generate a avatar for custom provider
          provider = getProviderById(pid)
          if (!provider) {
            return null
          }
        }
      }
      return <GeneratedAvatar name={name ?? provider?.name ?? 'P'} size={size} style={style} />
    },
    [logos]
  )

  function GeneratedAvatar({ name, size, style }: { name: string; size?: AvatarSize; style?: CSSProperties }) {
    const backgroundColor = generateColorFromChar(name)
    const color = name ? getForegroundColor(backgroundColor) : 'white'
    return (
      <ProviderLogo size={size} shape="square" style={{ backgroundColor, color, ...style }}>
        {getFirstCharacter(!isEmpty(name) ? name : 'P')}
      </ProviderLogo>
    )
  }
  return { ProviderAvatar, GeneratedAvatar, saveLogo, deleteLogo, logos }
}

const ProviderLogo = styled(Avatar)`
  border: 0.5px solid var(--color-border);
`
