export function parseData(data: string) {
  try {
    const result = JSON.parse(
      Buffer.from(data, 'base64').toString('utf-8').replaceAll("'", '"').replaceAll('(', '').replaceAll(')', '')
    )

    return JSON.stringify(result)
  } catch (error) {
    return null
  }
}
