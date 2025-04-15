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

test('Scenario: continue to drain /subscribe until /execute is finished', async () => {
  const serverMock = mockServer(server);
  const turnGenerator = createHalfDuplexChatAdapter(serverMock.strategy, {
    retry: { retries: 0 },
    signal: abortController.signal
  });

  serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
    readableStreamFrom([encoder.encode('event: end\ndata:end\n\n')])
  );

  let subscribeController: ReadableStreamDefaultController | undefined;
  let subscribeStream: ReadableStream;

  serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () => {
    ({ controller: subscribeController, readableStream: subscribeStream } = createReadableStreamWithController());

    return subscribeStream;
  });

  serverMock.httpPostExecute.createResponseStreamForSSE
    .mockImplementationOnce(async () => readableStreamFrom([encoder.encode(`event: end\ndata: end\n\n`)]))
    .mockImplementationOnce(async () => readableStreamFrom([encoder.encode(`event: end\ndata: end\n\n`)]));

  // GIVEN: After startConversation() is done.
  const next1Value = await turnGenerator.next();

  expect(next1Value).toEqual({ done: true, value: expect.any(Function) });

  const executeTurn = next1Value.value as ExecuteTurnFunction;

  // THEN: POST /subscribe should be called.
  expect(serverMock.httpPostSubscribe.responseResolver).toHaveBeenCalledTimes(1);

  if (!subscribeController) {
    throw new Error('ASSERTION ERROR');
  }

  // GIVEN: Subscribe stream returns an activity.
  subscribeController.enqueue(
    encoder.encode(
      `event: activity\ndata: ${JSON.stringify({
        from: { id: 'bot' },
        text: 'Bot first message',
        type: 'message'
      })}\n\n`
    )
  );

  // WHEN: executeTurn() is called and returned a new TurnGenerator.
  const turnGenerator2 = executeTurn({ from: { id: 'user' }, text: 'User first message', type: 'message' });

  // THEN: execute().next() should receive the first activity.
  await expect(turnGenerator2.next()).resolves.toEqual({
    done: false,
    value: { from: { id: 'bot' }, text: 'Bot first message', type: 'message' }
  });

  // WHEN: Call execute().next() again.
  const next2Promise = turnGenerator2.next();

  // THEN: It should not have been resolved yet.
  await expect(hasResolved(next2Promise)).resolves.toBe(false);

  // WHEN: After 1 second (silence timeout).
  jest.advanceTimersByTime(1_000);

  // THEN: Should receive done.
  await expect(next2Promise).resolves.toEqual({ done: true, value: expect.any(Function) });

  // GIVEN: Subscribe stream returns another activity.
  subscribeController.enqueue(
    encoder.encode(
      `event: activity\ndata: ${JSON.stringify({
        from: { id: 'bot' },
        text: 'Bot second message',
        type: 'message'
      })}\n\n`
    )
  );

  // WHEN: executeTurn() is called.
  const executeTurn2 = (await next2Promise).value as ExecuteTurnFunction;
  const turnGenerator3 = executeTurn2({ from: { id: 'user' }, text: 'User second message', type: 'message' });

  // THEN: execute().next() should receive the second activity.
  await expect(turnGenerator3.next()).resolves.toEqual({
    done: false,
    value: { from: { id: 'bot' }, text: 'Bot second message', type: 'message' }
  });

  // WHEN: Call execute().next() again.
  const next3Promise = turnGenerator3.next();

  // THEN: It should not have been resolved yet.
  await expect(hasResolved(next3Promise)).resolves.toBe(false);

  // WHEN: After 1 second (silence timeout).
  jest.advanceTimersByTime(1_000);

  // THEN: Should receive done.
  await expect(next3Promise).resolves.toEqual({ done: true, value: expect.any(Function) });
});
