import { resolveURLWithQueryAndHash } from './resolveURLWithQueryAndHash';

test('dot should include existing pathname', () => {
  const url = resolveURLWithQueryAndHash(new URL('https://example.com/abc?one=1#hash'), '.', 'xyz');

  expect(url).toHaveProperty('href', 'https://example.com/abc/xyz?one=1#hash');
});

test('with trailing hash dot should include existing pathname', () => {
  const url = resolveURLWithQueryAndHash(new URL('https://example.com/abc/?one=1#hash'), '.', 'xyz');

  expect(url).toHaveProperty('href', 'https://example.com/abc/xyz?one=1#hash');
});
