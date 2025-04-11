import { readableStreamFrom } from 'iter-fest';
import { HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Activity } from '../../../types/Activity';
import DirectToEngineChatAdapterAPIWithExecuteViaSubscribe from '../DirectToEngineChatAdapterAPIWithExecuteViaSubscribe';
import mockServer from './private/mockServer';

const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

jest.setTimeout(1_000);

describe('setup', () => {
  let api: DirectToEngineChatAdapterAPIWithExecuteViaSubscribe;
  let serverMock: ReturnType<typeof mockServer>;

  beforeEach(() => {
    serverMock = mockServer(server);

    api = new DirectToEngineChatAdapterAPIWithExecuteViaSubscribe(
      {
        experimental_prepareSubscribeActivities: async () => ({ baseURL: serverMock.baseURL }),
        prepareExecuteTurn: async () => ({ baseURL: serverMock.baseURL }),
        prepareStartNewConversation: async () => ({ baseURL: serverMock.baseURL })
      },
      { retry: { factor: 1, retries: 1 } }
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

    describe('when executeTurn is called with %s and /execute throw', () => {
      let executeTurnIterator: AsyncIterableIterator<Activity>;
      let executeTurnIteratorNextPromise: Promise<IteratorResult<Activity>>;

      beforeEach(async () => {
        serverMock.httpPostExecute.responseResolver.mockImplementationOnce(
          () => new HttpResponse(undefined, { status: 500 })
        );

        executeTurnIterator = api.executeTurn({
          from: { id: 'user' },
          text: 'Hello, World!',
          type: 'message'
        });

        executeTurnIteratorNextPromise = executeTurnIterator.next();

        await new Promise(resolve => setTimeout(resolve, 200));

        expect(serverMock.httpPostExecute.responseResolver).toHaveBeenCalledTimes(1);
      });

      test('executeTurn.next() should throw', () => expect(executeTurnIteratorNextPromise).rejects.toThrow());
    });
  });
});
