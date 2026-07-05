const encoder = new TextEncoder()

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password))
  return toHex(new Uint8Array(digest))
}
