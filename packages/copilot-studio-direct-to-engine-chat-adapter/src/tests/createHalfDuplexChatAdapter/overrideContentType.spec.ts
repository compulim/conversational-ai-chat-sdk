import { scenario } from '@testduet/given-when-then';
import { HttpResponse, http } from 'msw';
import { readableStreamFrom } from 'iter-fest';
import { setupServer } from 'msw/node';

import createHalfDuplexChatAdapter from '../../createHalfDuplexChatAdapter';
import mockServer from '../../private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIWithExecuteViaSubscribe/private/mockServer';
import { type Strategy } from '../../types/Strategy';

const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

jest.setTimeout(1_000);

scenario('override content-type request header', bdd => {
  bdd
    .given('a strategy', () => ({
      strategy: {
        prepareExecuteTurn: jest.fn(() =>
          Promise.resolve({
            baseURL: new URL('http://test/?api=execute#2'),
            body: { dummy: 'dummy' },
            headers: new Headers({ 'content-type': 'application/json+yaml' }),
            transport: 'auto'
          })
        ),
        prepareStartNewConversation: jest.fn(() =>
          Promise.resolve({
            baseURL: new URL('http://test/?api=start#1'),
            body: { dummy: 'dummy' },
            headers: new Headers({ 'content-type': 'application/json+yaml' }),
            transport: 'auto'
          })
        )
      } satisfies Strategy
    }))
    .and('an instance of msw', ({ strategy }) => {
      const serverMock = mockServer(server);

      serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([
          encoder.encode(
            `event: activity\ndata: ${JSON.stringify({
              from: { id: 'bot' },
              text: 'Bot first message',
              type: 'message'
            })}\n\nevent: end\ndata: end\n\n`
          )
        ])
      );
      const httpPostConversations = jest.fn();
      httpPostConversations.mockImplementationOnce(
        () =>
          new HttpResponse(
            Buffer.from(`event: end
data: end

`),
            { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
          )
      );
      server.use(http.post('http://test/conversations', httpPostConversations));

      return { httpPostConversations, serverMock, strategy };
    })
    .and('the chat adapter', ({ httpPostConversations, serverMock, strategy }) => {
      const onActivity = jest.fn();
      const chatAdapter = createHalfDuplexChatAdapter(strategy);

      return { chatAdapter, httpPostConversations, onActivity, serverMock, strategy };
    })
    .when('iterated', async ({ chatAdapter }) => chatAdapter.next())
    .then('should return no activities', (_, result) =>
      expect(result).toEqual({ done: true, value: expect.any(Function) })
    )
    .and('strategy.prepareStartNewConversation should not have been called', ({ strategy }) =>
      expect(strategy.prepareStartNewConversation).toHaveBeenCalledTimes(1)
    )
    .and('HTTP start conversation should have been called with content-type override', ({ httpPostConversations }) => {
      expect(httpPostConversations).toHaveBeenCalledTimes(1);
      expect(httpPostConversations.mock.calls[0][0].request.headers.get('content-type')).toBe('application/json+yaml');
    })
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
    .and('HTTP execute should have been called once', ({ serverMock }) =>
      expect(serverMock.httpPostExecute.responseResolver).toHaveBeenCalledTimes(1)
    )
    .and('HTTP execute should have been called with content-type override', ({ serverMock }) => {
      expect(serverMock.httpPostExecute.responseResolver.mock.calls[0][0].request.headers.get('content-type')).toBe(
        'application/json+yaml'
      );
    })
    .and('HTTP execute should have been called with the outgoing activity', async ({ serverMock }) =>
      expect(serverMock.httpPostExecute.responseResolver.mock.calls[0][0].request.json()).resolves.toEqual({
        dummy: 'dummy',
        activity: { from: { id: 'user' }, text: 'User first message', type: 'message' }
      })
    )
    .and('HTTP execute should return an activity', (_, { result }) =>
      expect(result).resolves.toEqual({
        done: false,
        value: { from: { id: 'bot' }, text: 'Bot first message', type: 'message' }
      })
    )
    .when('iterate again', (_, { iterator }) => iterator.next())
    .then('should return done', (_, result) => expect(result).toEqual({ done: true, value: expect.any(Function) }));
});
