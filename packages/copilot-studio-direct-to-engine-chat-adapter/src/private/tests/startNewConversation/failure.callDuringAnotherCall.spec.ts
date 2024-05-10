import type { Activity } from 'botframework-directlinejs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import DirectToEngineServerSentEventsChatAdapterAPI from '../../DirectToEngineServerSentEventsChatAdapterAPI';
import asyncIterableToArray from '../../asyncIterableToArray';
import type { BotResponse } from '../../types/BotResponse';
import type { HalfDuplexChatAdapterAPIStrategy } from '../../types/HalfDuplexChatAdapterAPIStrategy';
import type { DefaultHttpResponseResolver } from '../types/DefaultHttpResponseResolver';
import type { JestMockOf } from '../types/JestMockOf';

const server = setupServer();

const NOT_MOCKED: DefaultHttpResponseResolver = () => {
  throw new Error('This function is not mocked.');
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe.each(['rest' as const, 'server sent events' as const])('Using "%s" transport', transport => {
  let strategy: HalfDuplexChatAdapterAPIStrategy;

  beforeEach(() => {
    strategy = {
      async prepareExecuteTurn() {
        return Promise.resolve({
          baseURL: new URL('http://test/?api=execute#2'),
          body: { dummy: 'dummy' },
          headers: new Headers({ 'x-dummy': 'dummy' }),
          transport
        });
      },
      async prepareStartNewConversation() {
        return Promise.resolve({
          baseURL: new URL('http://test/?api=start#1'),
          body: { dummy: 'dummy' },
          headers: new Headers({ 'x-dummy': 'dummy' }),
          transport
        });
      }
    };
  });

  describe.each([true, false])('With emitStartConversationEvent of %s', emitStartConversationEvent => {
    let adapter: DirectToEngineServerSentEventsChatAdapterAPI;
    let httpPostContinue: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
    let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;

    beforeEach(() => {
      httpPostContinue = jest.fn(NOT_MOCKED);
      httpPostConversation = jest.fn(NOT_MOCKED);
      httpPostExecute = jest.fn(NOT_MOCKED);

      server.use(http.post('http://test/conversations', httpPostConversation));
      server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
      server.use(http.post('http://test/conversations/c-00001/continue', httpPostContinue));

      adapter = new DirectToEngineServerSentEventsChatAdapterAPI(strategy, { retry: { factor: 1, minTimeout: 0 } });
    });

    describe('When conversation started', () => {
      let firstStartNewConversationResult: ReturnType<
        DirectToEngineServerSentEventsChatAdapterAPI['startNewConversation']
      >;

      beforeEach(async () => {
        if (transport === 'rest') {
          httpPostConversation.mockImplementationOnce(() =>
            HttpResponse.json({
              action: 'continue',
              activities: [{ text: 'Hello, World!', type: 'message' }],
              conversationId: 'c-00001'
            } as BotResponse)
          );

          httpPostContinue.mockImplementationOnce(() =>
            HttpResponse.json({
              action: 'waiting',
              activities: [{ text: 'Aloha!', type: 'message' }],
              conversationId: 'c-00001'
            } as BotResponse)
          );
        } else {
          httpPostConversation.mockImplementationOnce(
            () =>
              new HttpResponse(
                Buffer.from(`event: activity
data: { "text": "Hello, World!", "type": "message" }

event: activity
data: { "text": "Aloha!", "type": "message" }

event: end
data: end

`),
                { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
              )
          );
        }

        firstStartNewConversationResult = adapter.startNewConversation(emitStartConversationEvent);
      });

      describe('when call startNewConversation again', () => {
        let errorThrown: unknown;

        beforeEach(() => {
          try {
            adapter.startNewConversation(emitStartConversationEvent);
          } catch (error) {
            errorThrown = error;
          }
        });

        test('should throw', () =>
          expect(() => {
            if (errorThrown) {
              throw errorThrown;
            }
          }).toThrow('Another operation is in progress.'));

        describe('when complete iterating the first call', () => {
          let activities: Activity[];

          beforeEach(async () => {
            activities = await asyncIterableToArray(firstStartNewConversationResult);
          });

          test('should return all activities', () =>
            expect(activities).toEqual([
              { text: 'Hello, World!', type: 'message' },
              { text: 'Aloha!', type: 'message' }
            ]));
        });
      });
    });
  });
});