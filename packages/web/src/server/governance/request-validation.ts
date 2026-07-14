export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

function fail(message: string): never {
  throw new RequestValidationError(message);
}

export function assertPlainObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail('request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

/** additionalProperties=false equivalent: every key in body must be in allowed. */
export function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      fail(`unexpected field "${key}"`);
    }
  }
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`"${key}" is required and must be a non-empty string`);
  }
  return value as string;
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`"${key}" must be a string`);
  return value;
}

export function requireNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`"${key}" is required and must be a finite number`);
  }
  return value as number;
}

export function requireNullableNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`"${key}" is required and must be a finite number or null`);
  }
  return value as number;
}

export function optionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    fail(`"${key}" must be an array of strings`);
  }
  return value as string[];
}

export function optionalArray<T>(body: Record<string, unknown>, key: string, mapItem: (item: unknown, index: number) => T): T[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`"${key}" must be an array`);
  return (value as unknown[]).map(mapItem);
}
