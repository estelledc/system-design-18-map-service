export class AppError extends Error {
  constructor(code, status, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const invalid = (message) => new AppError('invalid_request', 400, message);
export const unauthorized = () => new AppError('unauthorized', 401, 'valid bearer authentication is required');
export const notFound = () => new AppError('not_found', 404, 'resource not found');
export const gone = (message = 'resource is no longer retained') => new AppError('gone', 410, message);
export const conflict = (message) => new AppError('intent_conflict', 409, message);
export const precondition = (message, stateRevision) => new AppError(
  'precondition_failed',
  412,
  message,
  Number.isSafeInteger(stateRevision) ? { stateRevision } : undefined,
);
export const buildIncomplete = () => new AppError(
  'build_incomplete',
  409,
  'only a verified complete build can be published',
);
export const overlayUnavailable = () => new AppError(
  'overlay_unavailable',
  409,
  'no compatible effective traffic overlay is current at route acceptance',
);
export const corrupted = () => new AppError(
  'artifact_corrupt',
  500,
  'an immutable artifact failed identity verification',
);

export function asAppError(error) {
  return error instanceof AppError
    ? error
    : new AppError('internal_error', 500, 'internal server error');
}
