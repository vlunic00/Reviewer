export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchJson(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(path, options);
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }
  return data;
}
