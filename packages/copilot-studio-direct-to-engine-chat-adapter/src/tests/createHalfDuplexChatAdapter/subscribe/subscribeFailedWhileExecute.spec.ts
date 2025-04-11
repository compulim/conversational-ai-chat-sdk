import { readableStreamFrom } from 'iter-fest';
import { HttpResponse } from 'msw';
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

  const { controller: executeController, readableStream: executeStream } = createReadableStreamWithController();

  serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () => executeStream);

  // GIVEN: /subscribe would fail.
  serverMock.httpPostSubscribe.responseResolver.mockImplementation(() => new HttpResponse(undefined, { status: 500 }));

  const nextResult = await turnGenerator.next();

  expect(nextResult).toEqual({ done: true, value: expect.any(Function) });

  const executeTurn = nextResult.value as ExecuteTurnFunction;

  // GIVEN: /execute will return empty.
  executeController.enqueue(
    encoder.encode(`event: activity\ndata: ${JSON.stringify({ from: { id: 'bot' }, text: '', type: 'message' })}\n\n`)
  );

  const turnGenerator2 = executeTurn({ from: { id: 'user' }, text: 'User first message', type: 'message' });

  // THEN: TurnGenerator.next() should throw.
  await expect(turnGenerator2.next()).rejects.toThrow();
});
