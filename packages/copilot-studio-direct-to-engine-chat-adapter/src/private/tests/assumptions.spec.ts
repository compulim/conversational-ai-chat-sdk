import { EventSourceParserStream, type ParsedEvent } from 'eventsource-parser/stream';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { DefaultHttpResponseResolver } from '../types/DefaultHttpResponseResolver';
import type { JestMockOf } from '../types/JestMockOf';

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('msw: msw response completion should not aborted the msw request but only after fetch() is aborted', async () => {
  const abortController = new AbortController();
  const httpGet: JestMockOf<DefaultHttpResponseResolver> = jest.fn(_ => HttpResponse.text('Hello, World!'));

  server.use(http.get('http://test/', httpGet));

  // ---

  // GIVEN: Fetching without connection keep-alive.
  const res = await fetch('http://test/', {
    headers: { connection: 'close' },
    signal: abortController.signal
  });

  // WHEN: Response is sent completely.
  await expect(res.text()).resolves.toBe('Hello, World!');

  const { request } = httpGet.mock.calls[0][0];

  // THEN: The request is not aborted.
  expect(request.signal.aborted).toBe(false);

  // ---

  // ASSUMPTIONS: For unknown reasons, after the request/response completed,
  // we could still abort the request and it would be detected on service-side.
  // We already turned off keep-alive, so the connection should be closed after single call.
  abortController.abort();

  expect(request.signal.aborted).toBe(true);
});

test('fetch: aborting the fetch() call will not close the ReadableStream', async () => {
  const abortController = new AbortController();
  const decoder = new TextDecoder();
  const cancel: JestMockOf<UnderlyingSourceCancelCallback> = jest.fn().mockImplementationOnce(async () => {});
  const start: JestMockOf<Exclude<UnderlyingDefaultSource<ArrayBuffer>['start'], undefined>> = jest
    .fn()
    .mockImplementationOnce(() => {});

  const readableStream = new ReadableStream<ArrayBuffer>({ cancel, start });

  const httpGet: JestMockOf<DefaultHttpResponseResolver> = jest.fn(
    _ => new HttpResponse(readableStream, { headers: { 'content-type': 'text/event-stream' } })
  );

  server.use(http.get('http://test/', httpGet));

  // ---

  // GIVEN: Fetching with a working ReadableStream.
  const res = await fetch('http://test/', {
    headers: { connection: 'close' },
    signal: abortController.signal
  });

  expect(httpGet).toHaveBeenCalledTimes(1);

  if (!(res.body instanceof ReadableStream)) {
    throw new Error('ASSERTION: res.body should be ReadableStream.');
  }

  expect(start).toHaveBeenCalledTimes(1);

  start.mock.calls[0][0].enqueue(Buffer.from('Hello, World!'));

  const reader = res.body.getReader();
  const result = await reader.read();

  expect(result.done).toBeFalsy();
  expect(decoder.decode(result.value)).toBe('Hello, World!');

  // --- Aborting the request

  // WHEN: fetch() is aborted.
  abortController.abort();

  const { request } = httpGet.mock.calls[0][0];

  // THEN: The request should be aborted on service-side.
  expect(request.signal).not.toBe(abortController.signal);
  expect(request.signal.aborted).toBe(true);

  // --- Continue reading from the ReadableStream

  const controller = start.mock.calls[0][0];

  // WHEN: Pushing new data to the ReadableStream.
  controller.enqueue(Buffer.from('Aloha!'));

  // ASSUMPTIONS: For unknown reasons, after the fetch() is aborted, the ReadableStream will continue to function.
  const result2 = await reader.read();

  // THEN: Client can continue to read from the ReadableStream.
  expect(result2.done).toBeFalsy();
  expect(decoder.decode(result2.value)).toBe('Aloha!');

  // ---

  // WHEN: Controller is closed on service-side.
  controller.close();

  // THEN: Client will detect the ReadableStream is finished.
  const result3 = await reader.read();

  expect(result3.done).toBe(true);
  expect(result3.value).toBe(undefined);
});

test.each([['ReadableStream' as const], ['Reader' as const]])(
  'msw: cancelling %s will not abort the msw request',
  async type => {
    const abortController = new AbortController();
    const decoder = new TextDecoder();
    const cancel: JestMockOf<UnderlyingSourceCancelCallback> = jest.fn().mockImplementationOnce(async () => {});
    const start: JestMockOf<Exclude<UnderlyingDefaultSource<ArrayBuffer>['start'], undefined>> = jest
      .fn()
      .mockImplementationOnce(() => {});

    const readableStream = new ReadableStream<ArrayBuffer>({ cancel, start });

    const httpGet: JestMockOf<DefaultHttpResponseResolver> = jest.fn(
      _ => new HttpResponse(readableStream, { headers: { 'content-type': 'text/event-stream' } })
    );

    server.use(http.get('http://test/', httpGet));

    // ---

    const res = await fetch('http://test/', {
      headers: { connection: 'close' },
      signal: abortController.signal
    });

    expect(httpGet).toHaveBeenCalledTimes(1);

    if (!(res.body instanceof ReadableStream)) {
      throw new Error('ASSERTION: res.body should be ReadableStream.');
    }

    expect(start).toHaveBeenCalledTimes(1);

    start.mock.calls[0][0].enqueue(Buffer.from('Hello, World!'));

    const reader = res.body.getReader();
    const result = await reader.read();

    expect(result.done).toBeFalsy();
    expect(decoder.decode(result.value)).toBe('Hello, World!');

    // --- Cancelling the stream
    let cancelPromise: Promise<void>;

    if (type === 'ReadableStream') {
      reader.releaseLock();
      cancelPromise = res.body.cancel();
    } else if (type === 'Reader') {
      cancelPromise = reader.cancel();
    } else {
      throw new Error();
    }

    const { request } = httpGet.mock.calls[0][0];

    // ASSUMPTIONS: For unknown reasons, cancelling the ReadableStream will not abort the request.
    expect(request.signal.aborted).toBe(false);

    // ASSUMPTIONS: For unknown reason, the cancel() will never be resolved.
    expect(
      Promise.all([new Promise((_, reject) => setTimeout(() => reject(new Error('Not resolved')), 0)), cancelPromise])
    ).rejects.toThrowError('Not resolved');
  }
);

test('ReadableStream: pipeThrough() will be aborted only after microtask idle', async () => {
  const abortController = new AbortController();
  const cancel: JestMockOf<UnderlyingSourceCancelCallback> = jest.fn().mockImplementationOnce(async () => {});
  const start: JestMockOf<Exclude<UnderlyingDefaultSource<ArrayBuffer>['start'], undefined>> = jest
    .fn()
    .mockImplementationOnce(() => {});

  const readableStream = new ReadableStream<ArrayBuffer>({ cancel, start });

  const httpGet: JestMockOf<DefaultHttpResponseResolver> = jest.fn(
    _ => new HttpResponse(readableStream, { headers: { 'content-type': 'text/event-stream' } })
  );

  server.use(http.get('http://test/', httpGet));

  // ---

  const res = await fetch('http://test/', {
    headers: { connection: 'close' },
    signal: abortController.signal
  });

  if (!(res.body instanceof ReadableStream)) {
    throw new Error('ASSERTION: res.body should be ReadableStream.');
  }

  const textStream = res.body.pipeThrough(new TextDecoderStream(), { signal: abortController.signal });

  // ---

  const controller = start.mock.calls[0][0];

  controller.enqueue(Buffer.from('Hello, World!'));

  let chunks = '';

  for await (const chunk of textStream.values({ preventCancel: true })) {
    chunks += chunk;

    if (chunks === 'Hello, World!') {
      break;
    }
  }

  abortController.abort();

  // ASSUMPTIONS: Even aborted, if there are no microtask idle before enqueue(), it will read() before rejections.
  controller.enqueue(Buffer.from('Aloha!'));

  // ASSUMPTIONS: Subsequent enqueue() is ignored after aborted.
  controller.enqueue(Buffer.from('Good morning!'));

  const reader = textStream.getReader();

  expect(await reader.read()).toEqual({
    done: false,
    value: 'Aloha!'
  });

  await expect(reader.read()).rejects.toThrowError(new DOMException('This operation was aborted', 'AbortError'));
});

test('EventStreamParserStream: will reject on read() after abort()', async () => {
  const abortController = new AbortController();
  const cancel: JestMockOf<UnderlyingSourceCancelCallback> = jest.fn().mockImplementationOnce(async () => {});
  const start: JestMockOf<Exclude<UnderlyingDefaultSource<ArrayBuffer>['start'], undefined>> = jest
    .fn()
    .mockImplementationOnce(() => {});

  const readableStream = new ReadableStream<ArrayBuffer>({ cancel, start });

  const httpGet: JestMockOf<DefaultHttpResponseResolver> = jest.fn(
    _ => new HttpResponse(readableStream, { headers: { 'content-type': 'text/event-stream' } })
  );

  server.use(http.get('http://test/', httpGet));

  // ---

  const res = await fetch('http://test/', {
    headers: { connection: 'close' },
    signal: abortController.signal
  });

  if (!(res.body instanceof ReadableStream)) {
    throw new Error('ASSERTION: res.body should be ReadableStream.');
  }

  const eventStream = res.body
    .pipeThrough(new TextDecoderStream(), { signal: abortController.signal })
    .pipeThrough(new EventSourceParserStream(), { signal: abortController.signal });

  // ---

  const controller = start.mock.calls[0][0];

  controller.enqueue(Buffer.from('data: Hello, World!\n\n'));

  const reader = eventStream.getReader();
  const result = await reader.read();

  expect(result).toEqual({
    done: false,
    value: {
      data: 'Hello, World!',
      event: undefined,
      id: undefined,
      type: 'event'
    } satisfies ParsedEvent
  });

  abortController.abort();

  // ASSUMPTIONS: Subsequent enqueue() after abort() would be ignored.
  controller.enqueue(Buffer.from('data: Aloha!\n\n'));

  await expect(reader.read()).rejects.toThrowError(new DOMException('This operation was aborted', 'AbortError'));
});

test('ReadableStream: calling cancel() while read() is pending will return done', async () => {
  let controller: ReadableStreamDefaultController<number> | undefined;
  const readableStream = new ReadableStream<number>({
    start(c) {
      controller = c;
    }
  });

  if (!controller) {
    throw new Error('ASSERTION: controller should be assigned');
  }

  const reader1 = readableStream.getReader();

  controller.enqueue(1);

  await expect(reader1.read()).resolves.toEqual({ done: false, value: 1 });

  const readPromise = reader1.read();

  await reader1.cancel();

  await expect(reader1.closed).resolves.toBe(undefined);
  await expect(readPromise).resolves.toEqual({ done: true, value: undefined });

  expect(() => readableStream.getReader()).toThrowError(new TypeError('Invalid state: ReadableStream is locked'));
});

test('AsyncGenerator: return() should return input value', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generator: AsyncGenerator<any, any, any> = (async function* () {
    yield 1;
  })();

  const result = await generator.return('Something went wrong');

  expect(result).toEqual({ done: true, value: 'Something went wrong' });
});

test('ReadableStream: after controller.error(), readableStream.values().next() should throw but subsequent should resolve undefined', async () => {
  const readableStream = new ReadableStream<number>({
    start(controller) {
      controller.error(new Error('Something went wrong'));
    }
  });

  const values = readableStream.values();
  const nextPromise = values.next();

  await expect(nextPromise).rejects.toEqual(new Error('Something went wrong'));

  // --- Further call to next() will return undefined as the stream is closed.

  await expect(values.next()).resolves.toEqual({ done: true, value: undefined });
});

test('ReadableStreamDefaultReader: after controller.error(), reader.read() should throw', async () => {
  const readableStream = new ReadableStream<number>({
    start(controller) {
      controller.error(new Error('Something went wrong'));
    }
  });

  const reader = readableStream.getReader();
  const readPromise = reader.read();

  await expect(readPromise).rejects.toEqual(new Error('Something went wrong'));

  // --- Further call to next() will reject with same error.

  await expect(reader.read()).rejects.toEqual(new Error('Something went wrong'));
});

test('AsyncIterator: after throw, values().next() should throw but subsequent should resolve undefined', async () => {
  // eslint-disable-next-line require-yield
  const values = (async function* () {
    throw new Error('Something went wrong');
  })();

  const nextPromise = values.next();

  await expect(nextPromise).rejects.toEqual(new Error('Something went wrong'));

  // --- Further call to next() will return undefined.

  await expect(values.next()).resolves.toEqual({ done: true, value: undefined });
});
