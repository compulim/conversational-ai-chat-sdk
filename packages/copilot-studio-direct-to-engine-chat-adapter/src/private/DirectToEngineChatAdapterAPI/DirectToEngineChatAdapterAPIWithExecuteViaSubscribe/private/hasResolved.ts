export default function hasResolved(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([promise.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), 0))]);
}
