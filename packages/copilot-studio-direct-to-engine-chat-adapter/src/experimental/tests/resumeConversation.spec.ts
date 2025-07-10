import { scenario } from '@testduet/given-when-then';
import { readableStreamFrom } from 'iter-fest';
import { setupServer } from 'msw/node';

import mockServer from '../../private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIWithExecuteViaSubscribe/private/mockServer';
import { type Strategy } from '../../types/Strategy';
import createHalfDuplexChatAdapterWithSubscribe from '../createHalfDuplexChatAdapterWithSubscribe';

const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

jest.setTimeout(1_000);

scenario('resume conversation', bdd => {
  bdd
    .given(
      'an AbortController',
      () => ({ abortController: new AbortController() }),
      ({ abortController }) => abortController.abort()
    )
    .and('a strategy', ({ abortController }) => ({
      abortController,
      strategy: {
        experimental_prepareSubscribeActivities: jest.fn(async () => ({
          baseURL: new URL('http://test/conversations')
        })),
        prepareExecuteTurn: jest.fn(async () => ({ baseURL: new URL('http://test/conversations') })),
        prepareStartNewConversation: jest.fn(async () => ({ baseURL: new URL('http://test/conversations') }))
      } satisfies Strategy
    }))
    .and('an instance of msw', ({ abortController, strategy }) => {
      const serverMock = mockServer(server);

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

      serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode(`event: end\ndata: end\n\n`)])
      );

      return { abortController, serverMock, strategy };
    })
    .and('the chat adapter', ({ abortController, serverMock, strategy }) => {
      const onActivity = jest.fn();
      const chatAdapter = createHalfDuplexChatAdapterWithSubscribe(strategy, {
        experimental_resumeConversationId: 'c-00001'
      });

      return { abortController, chatAdapter, onActivity, serverMock, strategy };
    })
    .when('iterated', async ({ chatAdapter }) => chatAdapter.next())
    .then('should return no activities', (_, result) =>
      expect(result).toEqual({ done: true, value: expect.any(Function) })
    )
    .and('HTTP start conversation should not have been called', ({ serverMock }) =>
      expect(serverMock.httpPostConversation.responseResolver).toHaveBeenCalledTimes(0)
    )
    .and('strategy.prepareStartNewConversation should not have been called', ({ strategy }) =>
      expect(strategy.prepareStartNewConversation).toHaveBeenCalledTimes(0)
    )
    .when('execute turn is called', async (_, result) => {
      if (!result.done) {
        throw new Error();
      }

      const iterator = result.value({ from: { id: 'user' }, text: 'User first message', type: 'message' });

      return { iterator, result: iterator.next() };
    })
    .then('strategy.prepareExecuteTurn should have been called once', ({ strategy }) =>
      expect(strategy.prepareExecuteTurn).toHaveBeenCalledTimes(1)
    )
    .and('HTTP execute should have been called with conversation ID', ({ serverMock }) => {
      expect(serverMock.httpPostExecute.responseResolver.mock.calls[0][0].request.url).toBe(
        'http://test/conversations/c-00001'
      );

      expect(
        serverMock.httpPostExecute.responseResolver.mock.calls[0][0].request.headers.get('x-ms-conversationid')
      ).toBe('c-00001');
    })
    .and('HTTP execute should have been called with the outgoing activity', async ({ serverMock }) =>
      expect(serverMock.httpPostExecute.responseResolver.mock.calls[0][0].request.json()).resolves.toEqual({
        activity: { from: { id: 'user' }, text: 'User first message', type: 'message' }
      })
    )
    .and('HTTP execute should return an activity', (_, { result }) =>
      expect(result).resolves.toEqual({
        done: false,
        value: { from: { id: 'bot' }, text: 'Bot first message', type: 'message' }
      })
    );
});
