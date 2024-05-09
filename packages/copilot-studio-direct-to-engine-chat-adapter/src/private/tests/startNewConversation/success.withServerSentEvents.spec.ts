import type { Activity } from 'botframework-directlinejs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import DirectToEngineServerSentEventsChatAdapterAPI from '../../DirectToEngineServerSentEventsChatAdapterAPI';
import type { HalfDuplexChatAdapterAPIStrategy } from '../../types/HalfDuplexChatAdapterAPIStrategy';
import type { DefaultHttpResponseResolver } from '../types/DefaultHttpResponseResolver';
import type { JestMockOf } from '../types/JestMockOf';

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const strategy: HalfDuplexChatAdapterAPIStrategy = {
  async prepareExecuteTurn() {
    return Promise.resolve({ baseURL: new URL('http://test/'), transport: 'server sent events' });
  },
  async prepareStartNewConversation() {
    return Promise.resolve({ baseURL: new URL('http://test/'), transport: 'server sent events' });
  }
};

describe('When conversation started and bot returned with 2 activities in 2 turn', () => {
  let postConversations: JestMockOf<DefaultHttpResponseResolver>;
  let startNewConversationResult: ReturnType<DirectToEngineServerSentEventsChatAdapterAPI['startNewConversation']>;

  beforeEach(() => {
    postConversations = jest.fn<ReturnType<DefaultHttpResponseResolver>, Parameters<DefaultHttpResponseResolver>>(
      () =>
        new HttpResponse(
          Buffer.from(`event: activity
data: { "conversation": { "id": "c-00001" }, "text": "Hello, World!", "type": "message" }

event: activity
data: { "conversation": { "id": "c-00001" }, "text": "Aloha!", "type": "message" }

event: end
data: end

`),
          { headers: { 'content-type': 'text/event-stream' } }
        )
    );

    server.use(http.post('http://test/conversations/', postConversations));

    const adapter = new DirectToEngineServerSentEventsChatAdapterAPI(strategy);

    startNewConversationResult = adapter.startNewConversation(true);
  });

  test('should not POST to /conversations', () => expect(postConversations).toHaveBeenCalledTimes(0));

  describe('after iterate once', () => {
    let firstResult: IteratorResult<Activity>;

    beforeEach(async () => {
      firstResult = await startNewConversationResult.next();
    });

    describe('should have POST to /conversations', () => {
      test('once', () => expect(postConversations).toHaveBeenCalledTimes(1));

      test('with header "Accept" of "text/event-stream"', () =>
        expect(postConversations.mock.calls[0][0].request.headers.get('accept')).toBe('text/event-stream'));

      test('with header "Content-Type" of "application/json"', () =>
        expect(postConversations.mock.calls[0][0].request.headers.get('content-type')).toBe('application/json'));

      test('without header "x-ms-conversationid"', () =>
        expect(postConversations.mock.calls[0][0].request.headers.has('x-ms-conversationid')).toBe(false));

      test('with { emitStartConversationEvent: true }', () =>
        expect(postConversations.mock.calls[0][0].request.json()).resolves.toEqual({
          emitStartConversationEvent: true
        }));
    });

    test('should return first activity', () =>
      expect(firstResult).toEqual({
        done: false,
        value: { conversation: { id: 'c-00001' }, text: 'Hello, World!', type: 'message' }
      }));

    describe('after iterate twice', () => {
      let secondResult: IteratorResult<Activity>;

      beforeEach(async () => {
        secondResult = await startNewConversationResult.next();
      });

      test('should return second activity', () =>
        expect(secondResult).toEqual({
          done: false,
          value: { conversation: { id: 'c-00001' }, text: 'Aloha!', type: 'message' }
        }));

      describe('after iterate the third time', () => {
        let thirdResult: IteratorResult<Activity>;

        beforeEach(async () => {
          thirdResult = await startNewConversationResult.next();
        });

        test('should complete', () => expect(thirdResult).toEqual({ done: true, value: undefined }));
      });
    });
  });
});