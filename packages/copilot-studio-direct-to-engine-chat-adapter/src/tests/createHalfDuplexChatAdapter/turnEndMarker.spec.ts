import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import createHalfDuplexChatAdapter, {
  type ExecuteTurnFunction,
  type TurnGenerator
} from '../../createHalfDuplexChatAdapter';
import asyncGeneratorToArray from '../../private/asyncGeneratorToArray';
import { type BotResponse } from '../../private/types/BotResponse';
import { parseConversationId } from '../../private/types/ConversationId';
import { type DefaultHttpResponseResolver } from '../../private/types/DefaultHttpResponseResolver';
import { type JestMockOf } from '../../private/types/JestMockOf';
import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';

const server = setupServer();

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const NOT_MOCKED = <T extends (...args: any[]) => any>(..._: Parameters<T>): ReturnType<T> => {
  throw new Error('This function is not mocked.');
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe.each(['auto' as const, 'rest' as const])('Using "%s" transport', transport => {
  let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
  let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;

  beforeEach(() => {
    httpPostConversation = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
    httpPostExecute = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);

    server.use(http.post('http://test/conversations', httpPostConversation));
    server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
  });

  describe('with emitTurnEndMarker: false', () => {
    let strategy: Strategy;

    beforeEach(() => {
      strategy = {
        emitTurnEndMarker: false,
        async prepareExecuteTurn() {
          return { baseURL: new URL('http://test/?api=execute'), transport };
        },
        async prepareStartNewConversation() {
          return { baseURL: new URL('http://test/?api=start'), transport };
        }
      };
    });

    describe('on startNewConversation with one bot activity', () => {
      let activities: Activity[];

      beforeEach(async () => {
        if (transport === 'auto') {
          httpPostConversation.mockImplementationOnce(
            () =>
              new HttpResponse(
                Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Hello, World!", "type": "message" }

event: end
data: end

`),
                { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
              )
          );
        } else {
          httpPostConversation.mockImplementationOnce(() =>
            HttpResponse.json({
              action: 'waiting',
              activities: [{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }],
              conversationId: parseConversationId('c-00001')
            } satisfies BotResponse)
          );
        }

        const generator = createHalfDuplexChatAdapter(strategy, { retry: { factor: 1, minTimeout: 0 } });
        [activities] = await asyncGeneratorToArray(generator);
      });

      test('should yield only the bot message activity', () =>
        expect(activities).toEqual([{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }]));
    });
  });

  describe('with emitTurnEndMarker: true', () => {
    let strategy: Strategy;

    beforeEach(() => {
      strategy = {
        emitTurnEndMarker: true,
        async prepareExecuteTurn() {
          return { baseURL: new URL('http://test/?api=execute'), transport };
        },
        async prepareStartNewConversation() {
          return { baseURL: new URL('http://test/?api=start'), transport };
        }
      };
    });

    describe('on startNewConversation with one bot activity', () => {
      let activities: Activity[];

      beforeEach(async () => {
        if (transport === 'auto') {
          httpPostConversation.mockImplementationOnce(
            () =>
              new HttpResponse(
                Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Hello, World!", "type": "message" }

event: end
data: end

`),
                { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
              )
          );
        } else {
          httpPostConversation.mockImplementationOnce(() =>
            HttpResponse.json({
              action: 'waiting',
              activities: [{ from: { id: 'bot' }, text: 'Hello, World!', type: 'message' }],
              conversationId: parseConversationId('c-00001')
            } satisfies BotResponse)
          );
        }

        const generator = createHalfDuplexChatAdapter(strategy, { retry: { factor: 1, minTimeout: 0 } });
        [activities] = await asyncGeneratorToArray(generator);
      });

      test('should yield the bot message activity followed by the turn-end sentinel', () =>
        expect(activities).toEqual([
          { from: { id: 'bot' }, text: 'Hello, World!', type: 'message' },
          {
            channelData: { isTurnEndMarker: true },
            from: { id: 'bot', role: 'bot' },
            id: expect.any(String),
            name: 'copilot-studio:turn-end',
            type: 'event'
          }
        ]));
    });

    describe('on executeTurn with one bot activity', () => {
      let activities: Activity[];

      beforeEach(async () => {
        if (transport === 'auto') {
          httpPostConversation.mockImplementationOnce(
            () =>
              new HttpResponse(
                Buffer.from(`event: end
data: end

`),
                { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
              )
          );
          httpPostExecute.mockImplementationOnce(
            () =>
              new HttpResponse(
                Buffer.from(`event: activity
data: { "from": { "id": "bot" }, "text": "Aloha!", "type": "message" }

event: end
data: end

`),
                { headers: { 'content-type': 'text/event-stream' } }
              )
          );
        } else {
          httpPostConversation.mockImplementationOnce(() =>
            HttpResponse.json({
              action: 'waiting',
              activities: [],
              conversationId: parseConversationId('c-00001')
            } satisfies BotResponse)
          );
          httpPostExecute.mockImplementationOnce(() =>
            HttpResponse.json({
              action: 'waiting',
              activities: [{ from: { id: 'bot' }, text: 'Aloha!', type: 'message' }]
            } satisfies BotResponse)
          );
        }

        const startGenerator = createHalfDuplexChatAdapter(strategy, { retry: { factor: 1, minTimeout: 0 } });
        const [, executeTurn] = await asyncGeneratorToArray(startGenerator);

        const executeGenerator = (executeTurn as ExecuteTurnFunction)({
          from: { id: 'u-00001' },
          text: 'Hello.',
          type: 'message'
        });
        [activities] = await asyncGeneratorToArray(executeGenerator);
      });

      test('should yield the bot message activity followed by the turn-end sentinel', () =>
        expect(activities).toEqual([
          { from: { id: 'bot' }, text: 'Aloha!', type: 'message' },
          {
            channelData: { isTurnEndMarker: true },
            from: { id: 'bot', role: 'bot' },
            id: expect.any(String),
            name: 'copilot-studio:turn-end',
            type: 'event'
          }
        ]));
    });
  });
});
