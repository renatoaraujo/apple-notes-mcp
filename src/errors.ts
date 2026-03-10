export type ToolErrorCode =
  | 'ambiguous'
  | 'internal_error'
  | 'invalid_input'
  | 'not_found'
  | 'permission_denied'
  | 'unsafe_operation'
  | 'unsupported';

export interface ToolErrorData {
  code: ToolErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class NotesMcpError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function toToolErrorData(error: unknown): ToolErrorData {
  if (error instanceof NotesMcpError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      code: 'internal_error',
      message: error.message,
    };
  }

  return {
    code: 'internal_error',
    message: String(error),
  };
}
