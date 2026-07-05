export function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}
