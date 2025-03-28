export default function createReadableStreamWithController<T>(): {
  controller: ReadableStreamDefaultController<T>;
  readableStream: ReadableStream<T>;
} {
  let controller: ReadableStreamDefaultController<T> | undefined;
  const readableStream = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  if (!controller) {
    throw new Error('ASSERTION: Controller should have been assigned.');
  }

  return { controller, readableStream };
}
