export default function isAbortError(error: unknown): error is DOMException & { name: 'AbortError' } {
  return !!error && error instanceof DOMException && error.name === 'AbortError';
}
