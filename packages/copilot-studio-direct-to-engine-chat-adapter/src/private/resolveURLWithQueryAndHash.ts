export function resolveURLWithQueryAndHash(baseURL: URL, ...pathSegments: (false | string | undefined)[]): URL {
  if (pathSegments[0] === '.') {
    const lastSegment = baseURL.pathname.split('/').at(-1);

    pathSegments[0] = lastSegment ? lastSegment : '.';
  }

  const url = new URL(pathSegments.filter(Boolean).join('/'), baseURL);

  url.hash = baseURL.hash;
  url.search = baseURL.search;

  return url;
}
