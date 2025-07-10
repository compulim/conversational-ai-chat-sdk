import { scenario } from '@testduet/given-when-then';
import { readableStreamFrom } from 'iter-fest';
import { setupServer } from 'msw/node';
import DirectToEngineChatAdapterAPIWithExecuteViaSubscribe from '../DirectToEngineChatAdapterAPIWithExecuteViaSubscribe';
import mockServer from './private/mockServer';

const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

jest.setTimeout(1_000);

function ignoreUnhandledRejection<T extends Promise<unknown>>(promise: T): T {
  promise.catch(() => {});

  return promise;
}

scenario('resume conversation after started', bdd => {
  bdd
    .given(
      'an AbortController',
      () => ({ abortController: new AbortController() }),
      ({ abortController }) => abortController.abort()
    )
    .and('an instance of msw', ({ abortController }) => {
      const serverMock = mockServer(server);

      serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode(`event: end\ndata:end\n\n`)])
      );

      serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode(`event: end\ndata:end\n\n`)])
      );

      return { abortController, serverMock };
    })
    .and('the API', ({ abortController, serverMock }) => {
      const onActivity = jest.fn();
      const telemetry = { trackException: jest.fn() };

      const api = new DirectToEngineChatAdapterAPIWithExecuteViaSubscribe(serverMock.strategy, {
        onActivity,
        retry: { retries: 0 },
        signal: abortController.signal,
        telemetry
      });

      return { abortController, api, onActivity, serverMock, telemetry };
    })
    .when('startConversation() is called', ({ api }) =>
      api.startNewConversation({ emitStartConversationEvent: true }).next()
    )
    .then('should return no activities', (_, result) => expect(result).toEqual({ done: true, value: undefined }))
    .when('resumeConversation() is called with conversation ID "c-00001"', ({ api }) => ({
      promise: ignoreUnhandledRejection(api.experimental_resumeConversation({ conversationId: 'c-00001' }))
    }))
    .then('should throw', (_, { promise }) =>
      expect(() => promise).rejects.toThrowError('Conversation has already started, cannot resume conversation')
    )
    .and('telemetry.trackException should have been called once', ({ telemetry }) =>
      expect(telemetry.trackException).toHaveBeenCalledTimes(1)
    )
    .and('telemetry.trackException should have been called with the error', ({ telemetry }) => {
      expect(telemetry.trackException.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(telemetry.trackException.mock.calls[0][0]).toHaveProperty(
        'message',
        'Conversation has already started, cannot resume conversation'
      );
    });
});
