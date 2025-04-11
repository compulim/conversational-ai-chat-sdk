type Entry<T> = { error: unknown; type: 'error' } | { type: 'value'; value: T };

export default class QueueWithAvailable<T> {
  constructor() {
    this.#array = [];
    this.#availableResolvers = Promise.withResolvers<void>();
  }

  #array: Entry<T>[];
  #availableResolvers: PromiseWithResolvers<void>;

  #push(entry: Entry<T>) {
    this.#array.push(entry);

    if (this.#array.length === 1) {
      const current = this.#availableResolvers;

      this.#availableResolvers = Promise.withResolvers<void>();

      current.resolve();
    }
  }

  available() {
    return this.#availableResolvers.promise;
  }

  enqueue(value: T) {
    this.#push({ type: 'value', value });
  }

  error(error: unknown) {
    this.#push({ error, type: 'error' });
  }

  shift(): T | undefined {
    const entry = this.#array.shift();

    if (entry) {
      if (entry.type === 'error') {
        throw entry.error;
      } else if (entry.type === 'value') {
        return entry.value;
      }
    }
  }
}
