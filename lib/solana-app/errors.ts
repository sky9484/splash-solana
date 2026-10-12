/**
 * Errors the Solana app shows a person. Each says what happened and what to
 * do next, in the product's voice (design brief §4.7). `code` is stable for
 * the UI and tests; `status` is the HTTP status the route returns.
 */
export type ServiceErrorCode =
  | 'org_not_found'
  | 'invoice_not_found'
  | 'payment_not_found'
  | 'receipt_not_found'
  | 'bad_request'
  | 'keys_missing'
  | 'possession_failed'
  | 'vault_missing'
  | 'vault_exists'
  | 'devnet_fund_manual'
  | 'reader_failed'
  | 'fields_unconfirmed'
  | 'insufficient_balance'
  | 'no_route'
  | 'quote_expired'
  | 'policy_denied'
  | 'not_prepared'
  | 'signature_required'
  | 'signature_invalid'
  | 'wrong_state'
  | 'send_failed'
  | 'uncertain'
  | 'webhook_invalid'
  | 'transaction_too_large'
  | 'devnet_not_supported'
  | 'not_authorized'
  | 'device_exists';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;
  readonly detail?: Record<string, unknown>;

  constructor(code: ServiceErrorCode, message: string, status = 400, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}
