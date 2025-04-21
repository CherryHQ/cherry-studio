import { useAppSelector } from '@renderer/store'
import { PostHogProvider as PostHogReactProvider } from 'posthog-js/react'
import { FC } from 'react'

const POSTHOG_OPTIONS = {
  api_key: 'phc_G0omsYajA6A9BY5c0rnU04ZaZck25xpR0DqKhwfF39n',
  api_host: 'https://us.i.posthog.com'
}

const PostHogProvider: FC<{ children: React.ReactNode }> = ({ children }) => {
  const enableDataCollection = useAppSelector((state) => state.settings.enableDataCollection)

  if (enableDataCollection) {
    return (
      <PostHogReactProvider apiKey={POSTHOG_OPTIONS.api_key} options={POSTHOG_OPTIONS}>
        {children}
      </PostHogReactProvider>
    )
  }

  return children
}

export default PostHogProvider
