/**
 * Base class for business-rule violations raised by src/domain. It carries a stable machine
 * `code`; mapping it to an HTTP response is the job of the server layer. Messages must never
 * contain personal data.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
}
