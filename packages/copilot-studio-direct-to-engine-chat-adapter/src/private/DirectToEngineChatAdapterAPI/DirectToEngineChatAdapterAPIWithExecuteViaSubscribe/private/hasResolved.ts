const unmockedSetTimeout = setTimeout;

export default function hasResolved(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<false>(resolve => unmockedSetTimeout(() => resolve(false), 0))
  ]);
}
