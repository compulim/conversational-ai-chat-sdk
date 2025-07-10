import { scenario } from '@testduet/given-when-then';
import { waitFor } from '@testduet/wait-for';
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

// TODO: Fix leaking/lingering tests.
scenario('resume conversation', bdd => {
  bdd
    .given(
      'an AbortController',
      () => ({ abortController: new AbortController() }),
      ({ abortController }) => abortController.abort()
    )
    .and('an instance of msw', ({ abortController }) => {
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

      return { abortController, serverMock };
    })
    .and('the API', ({ abortController, serverMock }) => {
      const onActivity = jest.fn();
      const api = new DirectToEngineChatAdapterAPIWithExecuteViaSubscribe(serverMock.strategy, {
        onActivity,
        retry: { retries: 0 },
        signal: abortController.signal
      });

      return { abortController, api, onActivity, serverMock };
    })
    .when('resumeConversation() is called with conversation ID "c-00001"', async ({ api }) => {
      await api.experimental_resumeConversation({ conversationId: 'c-00001' });
    })
    .then('HTTP /subcribe should have been called', ({ serverMock }) =>
      // After successfully resumed the conversation, the /subscribe endpoint should have been called immediately.
      waitFor(() => expect(serverMock.httpPostSubscribe.responseResolver).toHaveBeenCalledTimes(1))
    )
    .and('onActivity() should have called', ({ onActivity }) =>
      // After successfully resumed the conversation, the /subscribe endpoint should have send the activity and signaled via onActivity() callback.
      waitFor(() => expect(onActivity).toHaveBeenCalledTimes(1))
    )
    .when('executeTurn() is called to give up the turn and returning the first iterated item', async ({ api }) => {
      for await (const activity of api.executeTurn()) {
        // Returning the first activity from the subscribe call.
        return activity;
      }
    })
    .then('return value should have the activity', (_, activity) =>
      expect(activity).toEqual({
        from: { id: 'bot' },
        text: 'Bot first message',
        type: 'message'
      })
    );
});
