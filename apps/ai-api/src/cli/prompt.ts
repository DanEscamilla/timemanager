/** Read a line from stdin. Returns null on EOF. */
export async function readLine(label: string): Promise<string | null> {
  const value = prompt(label)
  return value
}

export async function chooseIndex(
  label: string,
  count: number,
): Promise<number | null> {
  while (true) {
    const raw = await readLine(label)
    if (raw === null) return null
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.toLowerCase() === 'q') return null
    const n = Number(trimmed)
    if (Number.isInteger(n) && n >= 1 && n <= count) return n - 1
    console.log(`Enter a number between 1 and ${count}, or q to quit.`)
  }
}

export async function confirm(label: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  while (true) {
    const raw = await readLine(`${label} [${hint}]`)
    if (raw === null) return false
    const trimmed = raw.trim().toLowerCase()
    if (trimmed === '') return defaultYes
    if (trimmed === 'y' || trimmed === 'yes') return true
    if (trimmed === 'n' || trimmed === 'no') return false
    console.log('Please answer y or n.')
  }
}

export function parseTypedValue(
  raw: string,
  type: 'string' | 'number' | 'boolean',
): string | number | boolean {
  if (type === 'string') return raw
  if (type === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      throw new Error('expected a number')
    }
    return n
  }
  const lower = raw.trim().toLowerCase()
  if (lower === 'true' || lower === 'yes' || lower === 'y' || lower === '1') {
    return true
  }
  if (lower === 'false' || lower === 'no' || lower === 'n' || lower === '0') {
    return false
  }
  throw new Error('expected true/false')
}
