export default async function* asyncIteratorWithDrain<T>(
  iterable: AsyncIterableIterator<T, unknown, unknown>,
  onDrain: () => void
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const resetDrainTimer = () => {
      clearTimeout(timeout);
      timeout = setTimeout(onDrain, 0);
    };

    resetDrainTimer();

    for await (const value of iterable) {
      resetDrainTimer();

      yield value;
    }
  } finally {
    clearTimeout(timeout);
  }
}
