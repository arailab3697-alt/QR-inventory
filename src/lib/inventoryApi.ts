export type ForeignItemReport = {
  id: string
  actualShelf: string
  expectedShelf: string
}

type ForeignItemReportRequest = {
  version: 1
  token: string
  items: ForeignItemReport[]
}

type ForeignItemReportResponse = {
  success: boolean
  count?: number
}

export class InventoryApi {
  private readonly gasEndpoint: string | null
  private readonly token: string | null

  constructor(gasEndpoint: string | null, token: string | null) {
    this.gasEndpoint = gasEndpoint
    this.token = token
  }

  async reportForeignItems(items: ForeignItemReport[]) {
    if (this.gasEndpoint === null || this.token === null) {
      throw new Error('GAS endpoint or token is not configured.')
    }

    const response = await fetch(this.gasEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        version: 1,
        token: this.token,
        items,
      } satisfies ForeignItemReportRequest),
    })

    if (!response.ok) {
      throw new Error(`Report failed with status ${response.status}.`)
    }

    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || payload === null) {
      throw new Error('Invalid report response.')
    }

    const result = payload as ForeignItemReportResponse
    if (result.success !== true) {
      throw new Error('Report was rejected by the server.')
    }

    return result
  }
}
