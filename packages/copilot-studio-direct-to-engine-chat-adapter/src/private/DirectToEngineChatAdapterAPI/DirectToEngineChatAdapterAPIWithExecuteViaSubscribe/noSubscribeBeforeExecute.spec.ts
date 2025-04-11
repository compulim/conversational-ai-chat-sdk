import { waitFor } from '@testduet/wait-for';
import { readableStreamFrom } from 'iter-fest';
import { setupServer } from 'msw/node';
import type { Activity } from '../../../types/Activity';
import createReadableStreamWithController from '../../createReadableStreamWithController';
import type { JestMockOf } from '../../types/JestMockOf';
import DirectToEngineChatAdapterAPIWithExecuteViaSubscribe from '../DirectToEngineChatAdapterAPIWithExecuteViaSubscribe';
import hasResolved from './private/hasResolved';
import mockServer from './private/mockServer';

const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

jest.setTimeout(1_000);

describe('setup', () => {
  let api: DirectToEngineChatAdapterAPIWithExecuteViaSubscribe;
  let onActivity: JestMockOf<() => void>;
  let serverMock: ReturnType<typeof mockServer>;

  beforeEach(() => {
    onActivity = jest.fn();
    serverMock = mockServer(server);

    api = new DirectToEngineChatAdapterAPIWithExecuteViaSubscribe(serverMock.strategy, {
      onActivity,
      retry: { retries: 0 }
    });

    serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () =>
      readableStreamFrom([
        encoder.encode(
          `event: activity\ndata: ${JSON.stringify({
            from: { id: 'bot' },
            text: 'Bot first message',
            type: 'message'
          })}\n\n`
        )
      ])
    );
  });

  describe('when startConversation iteration is finished', () => {
    beforeEach(async () => {
      serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode('event: end\ndata: end\n\n')])
      );

      const iterator = api.startNewConversation({ emitStartConversationEvent: true });

      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    });

    test('should have called subscribe', () =>
      expect(serverMock.httpPostConversation.responseResolver).toHaveBeenCalledTimes(1));

    describe('when executeTurn is called', () => {
      let executeTurnIterator: AsyncIterableIterator<Activity>;
      let executeTurnIteratorNextPromise: Promise<IteratorResult<Activity>>;
      let executeController: ReadableStreamDefaultController;
      let executeStream: ReadableStream;

      beforeEach(async () => {
        ({ controller: executeController, readableStream: executeStream } = createReadableStreamWithController());

        serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementation(async () => executeStream);

        executeTurnIterator = api.executeTurn({
          from: { id: 'user' },
          text: 'Hello, World!',
          type: 'message'
        });

        executeTurnIteratorNextPromise = executeTurnIterator.next();

        await waitFor(() => expect(onActivity).toHaveBeenCalledTimes(1));
      });

      test('executeTurn.next() should not resolve', () =>
        expect(hasResolved(executeTurnIteratorNextPromise)).resolves.toBe(false));

      describe('after /execute return something', () => {
        beforeEach(() => {
          executeController.enqueue(encoder.encode('event: activity\ndata: {}\n\n'));
        });

        test('executeTurn.next() should resolve', () =>
          expect(executeTurnIteratorNextPromise).resolves.toEqual({
            done: false,
            value: {
              from: { id: 'bot' },
              text: 'Bot first message',
              type: 'message'
            }
          }));
      });
    });
  });
});
