export const defaultAppHeaders = () => {
  return {
    'HTTP-Referer': 'https://cherry-ai.com',
    'X-Title': 'Cherry Studio'
  }
}

// Checks whether a string is a valid HTTP(S) URL. Kept under the existing main-process name, but
// backed by the shared predicate so the builtin tool input schemas validate against the very same
// function this process enforces at fetch time — see `isHttpUrl` for why that has to hold.
export { isHttpUrl as isValidUrl } from '@shared/utils/url'
