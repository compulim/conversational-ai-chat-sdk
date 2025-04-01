export default function ignoreUnhandledRejection<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});

  return promise;
}
