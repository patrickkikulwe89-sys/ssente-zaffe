/**
 * Deterministic JSON serialisation (RFC 8785 subset).
 *
 * Signatures are only meaningful if two machines serialise the same card to the
 * same bytes. We therefore sort object keys recursively, emit no insignificant
 * whitespace, and refuse the value types whose encoding is ambiguous.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number');
    if (!Number.isInteger(value)) throw new Error('canonicalize: use integers (money is stored in whole UGX)');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
