/**
 * Safe JSON body reader for route handlers.
 *
 * `Request.json()` throws on an empty or malformed body, which surfaces as an
 * unhandled 500. For object-shaped POST/PATCH payloads we instead normalize any
 * empty, malformed, or non-object body to `{}` so each route's own field/schema
 * validation produces a clean 400 instead of crashing.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
