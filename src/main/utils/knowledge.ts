export type UrlSource = 'normal' | 'github' | 'youtube'

const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|youtube\.be|yt\.be)/i

export function getUrlSource(url: string): UrlSource {
  if (youtubeRegex.test(url)) {
    return 'youtube'
  } else {
    return 'normal'
  }
}
