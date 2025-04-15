import { readableStreamFrom } from 'iter-fest';
import { setupServer } from 'msw/node';
import createHalfDuplexChatAdapter, {
  type ExecuteTurnFunction
} from '../../../experimental/createHalfDuplexChatAdapterWithSubscribe';
import createReadableStreamWithController from '../../../private/createReadableStreamWithController';
import hasResolved from '../../../private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIWithExecuteViaSubscribe/private/hasResolved';
import mockServer from '../../../private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIWithExecuteViaSubscribe/private/mockServer';

let abortController: AbortController;
const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

jest.setTimeout(1_000);

beforeEach(() => {
  abortController = new AbortController();
});

afterEach(() => abortController.abort());
afterEach(() => jest.restoreAllMocks());

test('Scenario: silence timeout should work', async () => {
  const serverMock = mockServer(server);
  const turnGenerator1 = createHalfDuplexChatAdapter(serverMock.strategy, {
    retry: { retries: 0 },
    signal: abortController.signal,
    subscribeSilenceTimeout: 2_000
  });

  serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
    readableStreamFrom([encoder.encode('event: end\ndata: end\n\n')])
  );

  const { readableStream: subscribeStream } = createReadableStreamWithController();

  serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () => subscribeStream);

  const nextResult1 = await turnGenerator1.next();

  expect(nextResult1).toEqual({ done: true, value: expect.any(Function) });

  // ---

  // GIVEN: /execute will return an ongoing stream.
  const executeTurn = nextResult1.value as ExecuteTurnFunction;

  const { controller: executeController, readableStream: executeStream } = createReadableStreamWithController();

  serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () => executeStream);

  // WHEN: executeTurn() is called and iterated.
  const turnGenerator2 = executeTurn({ from: { id: 'user' }, text: 'Hello, World!', type: 'message' });

  const nextResult2Promise = turnGenerator2.next();

  // THEN: Should not resolve executeTurn().
  await expect(hasResolved(nextResult2Promise)).resolves.toBe(false);

  // WHEN: After 2 seconds.
  await jest.advanceTimersByTimeAsync(2_000);

  // THEN: Should not resolve executeTurn() yet because /execute is not finished.
  await expect(hasResolved(nextResult2Promise)).resolves.toBe(false);

  // ---

  // WHEN: /execute is resolved.
  executeController.enqueue(encoder.encode('event: end\ndata:end\n\n'));

  // THEN: Should not resolve executeTurn() yet because still waiting for silence timeout.
  await expect(hasResolved(nextResult2Promise)).resolves.toBe(false);

  // ---

  // WHEN: After 2 seconds.
  await jest.advanceTimersByTimeAsync(2_000);

  // THEN: Should resolve executeTurn().
  await expect(nextResult2Promise).resolves.toEqual({ done: true, value: expect.any(Function) });
});
