import type { ErrorCode, ErrorDetails } from './errors.type';

export interface IErrorBody {
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
  trace_id: string | null;
}

export interface IErrorEnvelope {
  error: IErrorBody;
}

export interface IValidationPipeResponse {
  message: string[];
}
