let input = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk])
  const headerEnd = input.indexOf('\r\n\r\n')
  if (headerEnd < 0) return
  const length = Number(/Content-Length: (\d+)/i.exec(input.subarray(0, headerEnd).toString())[1])
  if (input.length < headerEnd + 4 + length) return
  const request = JSON.parse(input.subarray(headerEnd + 4, headerEnd + 4 + length).toString())
  const frame = (message) => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message })
    return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }
  process.stdout.write(
    Buffer.concat([
      frame({ method: 'fixture.ignoredNotification', params: {} }),
      frame({ id: request.id, result: { value: 41 } })
    ])
  )
  input = Buffer.alloc(0)
})
