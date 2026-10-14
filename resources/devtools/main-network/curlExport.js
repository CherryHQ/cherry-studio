const CURL_BODY_FRAMING_HEADERS = new Set(['content-length', 'transfer-encoding', 'content-encoding'])

function shellQuoteSingle(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function curlComment(text) {
  return `# ${String(text).replace(/\r?\n/g, ' ')}`
}

function shouldSkipCurlHeader(name) {
  return CURL_BODY_FRAMING_HEADERS.has(String(name).toLowerCase())
}

function getHeaderValue(headers, name) {
  const normalizedName = String(name).toLowerCase()
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (String(key).toLowerCase() === normalizedName) return value
  }
  return undefined
}

function hasReplayableCurlBody(body) {
  return body?.text !== undefined && body.replayable !== false && !body.truncated
}

function buildCurlCommand(event) {
  const parts = ['curl', '--globoff', shellQuoteSingle(event.url)]
  const method = (event.method || 'GET').toUpperCase()
  const body = event.requestBody
  const includeBody = hasReplayableCurlBody(body)

  if (method === 'HEAD') {
    parts.push('--head')
  } else if (method !== 'GET' || includeBody) {
    parts.push('-X', shellQuoteSingle(method))
  }

  const requestHeaders = event.requestHeaders ?? {}
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (shouldSkipCurlHeader(key)) continue
    parts.push('-H', shellQuoteSingle(`${key}: ${value}`))
  }

  if (includeBody && getHeaderValue(requestHeaders, 'content-type') === undefined) {
    const effectiveType = body?.contentType
    if (effectiveType) {
      parts.push('-H', shellQuoteSingle(`Content-Type: ${effectiveType}`))
    } else {
      parts.push('-H', shellQuoteSingle('Content-Type:'))
    }
  }

  if (method !== 'HEAD' && includeBody) {
    parts.push('--data-raw', shellQuoteSingle(body.text))
  } else if (body?.truncated) {
    parts.push(curlComment('request body truncated in capture; omit --data-raw for replay'))
  } else if (body?.text && body.replayable === false) {
    parts.push(
      curlComment(
        body.note ?? 'request body is a display summary only; omit --data-raw for replay'
      )
    )
  } else if (body?.note) {
    parts.push(curlComment(`request body not captured: ${body.note}`))
  }

  return parts.join(' \\\n  ')
}

globalThis.buildCurlCommand = buildCurlCommand
