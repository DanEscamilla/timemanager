export type AiProviderErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'quota'
  | 'bad_request'
  | 'upstream'
  | 'config'

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode
  readonly status?: number
  readonly provider: string

  constructor(
    message: string,
    options: {
      code: AiProviderErrorCode
      provider: string
      status?: number
      cause?: unknown
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AiProviderError'
    this.code = options.code
    this.provider = options.provider
    this.status = options.status
  }
}

export function mapHttpStatusToCode(status: number): AiProviderErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status === 400 || status === 422) return 'bad_request'
  return 'upstream'
}
