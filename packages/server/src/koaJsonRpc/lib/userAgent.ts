// SPDX-License-Identifier: Apache-2.0

/**
 * Reads the inbound User-Agent header for RequestDetails. Bounded metric labels
 * only — never used as a security boundary.
 */
export function readUserAgentHeader(
  headers: { [key: string]: string | string[] | undefined } | undefined,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const raw = headers['user-agent'] ?? headers['User-Agent'];
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' && raw[0].length > 0 ? raw[0] : undefined;
  }
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}
