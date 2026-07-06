export type Reagent = {
  id: string
  name: string
  shelf: string
}

export type Inventory = {
  reagents: Reagent[]
}

export type InventoryEnvelope = {
  version: 1
  kdf: {
    name: 'PBKDF2'
    hash: 'SHA-256'
    iterations: number
    salt: string
  }
  cipher: {
    name: 'AES-GCM'
    iv: string
  }
  payload: string
}
