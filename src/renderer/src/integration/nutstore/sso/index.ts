import { useEffect } from 'react'
import { type Secret } from './lib'

export interface OAuthResponse {
  username: string
  userid: string
  access_token: string
}

// 使用闭包创建一个可以在外部resolve的Promise
let resolveLastPromise: (value: {
  createOAuthUrl: (secret: Secret) => string
  decrypt: (app: string, s: string) => string
}) => void

// 立即创建Promise，但延迟resolve
const lastPromise = new Promise<{
  createOAuthUrl: (secret: Secret) => string
  decrypt: (app: string, s: string) => string
}>((resolve) => {
  resolveLastPromise = resolve
})

export async function initNutstore() {
  const { createOAuthUrl, decrypt } = await import('./lib/index')
  // 完成Promise
  resolveLastPromise({
    createOAuthUrl,
    decrypt
  })
}

export async function nutstoreSsoLogin() {
  const { createOAuthUrl } = await lastPromise
  const url = createOAuthUrl({
    app: 'cherrystudio'
  })

  window.open(url)
}

export async function decryptToken(token: string) {
  const { decrypt } = await lastPromise
  try {
    const decrypted = decrypt('cherrystudio', token)
    return JSON.parse(decrypted) as OAuthResponse
  } catch (error) {
    console.error('解密失败:', error)
    return null
  }
}

export function useInitNutstore() {
  useEffect(() => {
    initNutstore()
  }, [])
}
