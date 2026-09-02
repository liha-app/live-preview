import type { ApiErrorCode } from '@liha-cli/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  password_required: 401,
  invalid_password: 401,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  conflict: 409,
  not_supported: 501,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = STATUS_BY_CODE[code];
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError('bad_request', message, details);
export const notFound = (message = 'Not found.') => new ApiError('not_found', message);
export const unauthorized = (message = 'Owner token required.') =>
  new ApiError('unauthorized', message);
export const forbidden = (message = 'Not allowed.') => new ApiError('forbidden', message);
export const tooLarge = (message: string) => new ApiError('payload_too_large', message);
