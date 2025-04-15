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

test.each([
  ['default silence timeout', undefined],
  ['custom silence timeout of 5 seconds', 5_000],
  ['custom silence timeout of 500 ms', 500]
])('Scenario: continue to drain /subscribe until /execute is finished with %s', async (_, subscribeSilenceTimeout) => {
  const serverMock = mockServer(server);
  const turnGenerator = createHalfDuplexChatAdapter(serverMock.strategy, {
    retry: { retries: 0 },
    signal: abortController.signal,
    subscribeSilenceTimeout
  });

  serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
    readableStreamFrom([encoder.encode('event: end\ndata:end\n\n')])
  );

  const { controller: subscribeController, readableStream: subscribeStream } = createReadableStreamWithController();

  subscribeController.enqueue(
    encoder.encode(
      `event: activity\ndata: ${JSON.stringify({
        from: { id: 'bot' },
        text: 'Bot first message',
        type: 'message'
      })}\n\nevent: activity\ndata: ${JSON.stringify({
        from: { id: 'bot' },
        text: 'Bot second message',
        type: 'message'
      })}\n\n`
    )
  );

  serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () => subscribeStream);

  const { controller: executeController, readableStream: executeStream } = createReadableStreamWithController();

  executeController.enqueue(
    encoder.encode(
      `event: activity\ndata: ${JSON.stringify({
        from: { id: 'bot' },
        text: 'Bot first message (duplicated)', // This activity should not be retrievable.
        type: 'message'
      })}\n\n`
    )
  );

  serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () => executeStream);

  // GIVEN: After startConversation() is done.
  const next1Value = await turnGenerator.next();

  expect(next1Value).toEqual({ done: true, value: expect.any(Function) });

  const executeTurn = next1Value.value as ExecuteTurnFunction;

  // THEN: POST /subscribe should be called.
  expect(serverMock.httpPostSubscribe.responseResolver).toHaveBeenCalledTimes(1);

  // WHEN: executeTurn() is called and returned a new TurnGenerator.
  const turnGenerator2 = executeTurn({ from: { id: 'user' }, text: 'User first message', type: 'message' });

  // THEN: execute().next() should receive the first activity.
  await expect(turnGenerator2.next()).resolves.toEqual({
    done: false,
    value: { from: { id: 'bot' }, text: 'Bot first message', type: 'message' }
  });

  // THEN: execute().next() should receive the second activity.
  await expect(turnGenerator2.next()).resolves.toEqual({
    done: false,
    value: { from: { id: 'bot' }, text: 'Bot second message', type: 'message' }
  });

  // SCENARIO: /execute is not finished yet, /subscribe continue to receive activity.

  // WHEN: /subscribe receive the third activity.
  subscribeController.enqueue(
    encoder.encode(
      `event: activity\ndata: ${JSON.stringify({
        from: { id: 'bot' },
        text: 'Bot third message',
        type: 'message'
      })}\n\n`
    )
  );

  // THEN: execute().next() should receive the third activity.
  await expect(turnGenerator2.next()).resolves.toEqual({
    done: false,
    value: { from: { id: 'bot' }, text: 'Bot third message', type: 'message' }
  });

  // WHEN: /execute finished.
  executeController.enqueue(encoder.encode('event: end\ndata: end\n\n'));
  executeController.close();

  // WHEN: After 100 ms.
  await jest.advanceTimersByTimeAsync(100);

  // THEN: executeTurn().next() should not have been resolved.
  const next2Promise = turnGenerator2.next();

  await expect(hasResolved(next2Promise)).resolves.toBe(false);

  // WHEN: /subscribe receive the fourth activity.
  subscribeController.enqueue(
    encoder.encode(
      `event: activity\ndata: ${JSON.stringify({
        from: { id: 'bot' },
        text: 'Bot fourth message',
        type: 'message'
      })}\n\n`
    )
  );

  // THEN: execute().next() should be resolved.
  await expect(next2Promise).resolves.toEqual({
    done: false,
    value: { from: { id: 'bot' }, text: 'Bot fourth message', type: 'message' }
  });

  // WHEN: next() is called.
  const next3Promise = turnGenerator2.next();

  // WHEN: After 1 second.
  // NOTES: For simplicity, we only count 1 second after next() is called.
  //        For best experience, we should count 1 second regardless next() is called or not.
  await jest.advanceTimersByTimeAsync(subscribeSilenceTimeout || 1_000);

  // THEN: executeTurn().next() should complete iteration.
  await expect(next3Promise).resolves.toEqual({ done: true, value: expect.any(Function) });

  // ---

  // WHEN: /subscribe queued another activity.
  subscribeController.enqueue(
    encoder.encode(
      `event: activity\ndata: ${JSON.stringify({
        from: { id: 'bot' },
        text: 'Bot fifth message',
        type: 'message'
      })}\n\n`
    )
  );

  const executeTurn2 = (await next3Promise).value as ExecuteTurnFunction;

  // WHEN: Another turn is executed.
  serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () =>
    readableStreamFrom([encoder.encode(`event: end\ndata: end\n\n`)])
  );

  const turnGenerator3 = executeTurn2({ from: { id: 'user' }, text: 'User second message', type: 'message' });

  // THEN: execute().next() should receive the fifth activity.
  await expect(turnGenerator3.next()).resolves.toEqual({
    done: false,
    value: { from: { id: 'bot' }, text: 'Bot fifth message', type: 'message' }
  });
});
