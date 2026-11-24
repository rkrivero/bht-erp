import type { ApiErrorResponse } from "./types";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly entityRef?: string;
  readonly errorId?: string;

  constructor(response: ApiErrorResponse, status: number) {
    super(response.error);
    this.name = "ApiClientError";
    this.status = status;
    this.code = response.code;
    this.entityRef = response.entityRef;
    this.errorId = response.errorId;
  }
}

export type ResponseValidator<T> = (value: unknown) => value is T;

export function hasTopLevelKeys<T extends object>(
  ...keys: Array<keyof T>
): ResponseValidator<T> {
  return (value: unknown): value is T =>
    typeof value === "object" &&
    value !== null &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  validate?: ResponseValidator<T>
): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiClientError(
      {
        error: response.ok
          ? "El servidor devolvió una respuesta no válida"
          : "No se pudo completar la operación",
      },
      response.status
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      { error: "El servidor devolvió un JSON no válido" },
      response.status
    );
  }

  if (!response.ok) {
    throw new ApiClientError(
      isApiErrorResponse(payload)
        ? payload
        : { error: "No se pudo completar la operación" },
      response.status
    );
  }
  if (validate && !validate(payload)) {
    throw new ApiClientError(
      { error: "La respuesta del servidor no tiene la estructura esperada" },
      response.status
    );
  }
  return payload as T;
}
