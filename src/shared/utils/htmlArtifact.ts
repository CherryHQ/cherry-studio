import { getWebviewPartition, WebviewSecurityProfile } from './webviewSecurity'

export const HTML_ARTIFACT_PREVIEW_PARTITION = getWebviewPartition(WebviewSecurityProfile.HtmlArtifactPreview)
export const HTML_ARTIFACT_PREVIEW_DATA_URL_PREFIX = 'data:text/html;charset=utf-8,'
