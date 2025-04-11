import { readableStreamFrom } from 'iter-fest';
import { setupServer } from 'msw/node';
import createHalfDuplexChatAdapter, {
  type ExecuteTurnFunction
} from '../../../experimental/createHalfDuplexChatAdapterWithSubscribe';
import mockServer from '../../../private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIWithExecuteViaSubscribe/private/mockServer';
import createReadableStreamWithController from '../../../private/createReadableStreamWithController';

let abortController: AbortController;
const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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
        text: 'Bot first message (duplicated)',
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
  const turnGenerator2 = executeTurn({ from: { id: 'user' }, text: 'Hello, World!', type: 'message' });

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

  // THEN: execute().next() should complete.
  const next2Value = await turnGenerator2.next();

  expect(next2Value).toEqual({ done: true, value: expect.any(Function) });

  const executeTurn2 = next2Value.value as ExecuteTurnFunction;

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

  // WHEN: Another turn is executed.
  serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () =>
    readableStreamFrom([encoder.encode(`event: end\ndata: end\n\n`)])
  );

  const turnGenerator3 = executeTurn2({ from: { id: 'user' }, text: 'User second message', type: 'message' });

  // THEN: execute().next() should receive the fourth activity.
  await expect(turnGenerator3.next()).resolves.toEqual({
    done: false,
    value: { from: { id: 'bot' }, text: 'Bot fourth message', type: 'message' }
  });
});
