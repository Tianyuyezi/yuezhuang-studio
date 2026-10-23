export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

export function safeMessage(error: unknown) {
  return error instanceof AppError ? error.message : '操作未完成，请检查本地服务或稍后重试。'
}

export function redact(value: string) {
  return value.replace(/sk-[A-Za-z0-9_.-]+/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/([?&](?:key|token|access_token)=)[^&\s]+/gi, '$1[REDACTED]')
}
