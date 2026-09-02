import type { Messages } from '../i18n/en.js';
import { ApiClientError } from './api.js';

/**
 * What to show a person when a request fails.
 *
 * The API answers in English, because an API has one language and its callers
 * include a CLI and an agent. A person reading a Japanese screen should not be
 * the one to absorb that, so the error's *code* — which is stable and
 * machine-facing — chooses the sentence, and the server's own text is the
 * fallback for the codes that carry detail worth keeping.
 */
const SPOKEN: Partial<Record<string, keyof Messages>> = {
  network_error: 'apiError.network',
  not_found: 'apiError.notFound',
  unauthorized: 'apiError.unauthorized',
  forbidden: 'apiError.forbidden',
  password_required: 'apiError.passwordRequired',
  invalid_password: 'apiError.invalidPassword',
  rate_limited: 'apiError.rateLimited',
  unsupported_media_type: 'apiError.unsupportedMedia',
  not_supported: 'apiError.notSupported',
  internal_error: 'apiError.server',
};

export function describeError(
  error: unknown,
  t: (key: keyof Messages, values?: Record<string, string>) => string,
): string {
  if (error instanceof ApiClientError) {
    const key = SPOKEN[error.code];
    if (key) return t(key);
    // bad_request, payload_too_large and conflict carry the numbers and names
    // that make them useful. An English sentence with those beats a translated
    // one without.
    return error.message;
  }
  return error instanceof Error ? error.message : t('apiError.server');
}
