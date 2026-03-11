/// <reference lib="esnext" />

import { readableStreamFrom } from 'iter-fest';
import { setupServer } from 'msw/node';

import createHalfDuplexChatAdapter, {
  type ExecuteTurnFunction,
  type TurnGenerator
} from '../../../experimental/createHalfDuplexChatAdapterWithSubscribe';
import createReadableStreamWithController from '../../../private/createReadableStreamWithController';
import mockServer from '../../../private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPIWithExecuteViaSubscribe/private/mockServer';
import { type Activity } from '../../../types/Activity';

const server = setupServer();
const encoder = new TextEncoder();

let abortController: AbortController;

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

jest.setTimeout(1_000);

beforeEach(() => {
  abortController = new AbortController();
});

afterEach(() => abortController.abort());
afterEach(() => jest.restoreAllMocks());

describe('with emitTurnEndMarker: false', () => {
  test('on startNewConversation: should NOT yield a turn-end sentinel', async () => {
    const serverMock = mockServer(server);
    const strategy = { ...serverMock.strategy, emitTurnEndMarker: false };

    serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
      readableStreamFrom([
        encoder.encode(
          `event: activity\ndata: ${JSON.stringify({ from: { id: 'bot' }, text: 'Hello!', type: 'message' })}\n\nevent: end\ndata: end\n\n`
        )
      ])
    );

    const { controller: subscribeController, readableStream: subscribeStream } = createReadableStreamWithController();
    serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () => subscribeStream);

    const turnGenerator = createHalfDuplexChatAdapter(strategy, {
      retry: { retries: 0 },
      signal: abortController.signal
    });

    const activities: Activity[] = [];
    let result = await turnGenerator.next();

    while (!result.done) {
      activities.push(result.value as Activity);
      result = await turnGenerator.next();
    }

    subscribeController.close();

    expect(activities).toEqual([{ from: { id: 'bot' }, text: 'Hello!', type: 'message' }]);
  });
});

describe('with emitTurnEndMarker: true', () => {
  describe('on startNewConversation with one bot activity', () => {
    test('should yield the bot activity followed by the turn-end sentinel', async () => {
      const serverMock = mockServer(server);
      const strategy = { ...serverMock.strategy, emitTurnEndMarker: true };

      serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([
          encoder.encode(
            `event: activity\ndata: ${JSON.stringify({ from: { id: 'bot' }, text: 'Hello!', type: 'message' })}\n\nevent: end\ndata: end\n\n`
          )
        ])
      );

      const { controller: subscribeController, readableStream: subscribeStream } = createReadableStreamWithController();
      serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () => subscribeStream);

      const turnGenerator = createHalfDuplexChatAdapter(strategy, {
        retry: { retries: 0 },
        signal: abortController.signal
      });

      const activities: Activity[] = [];
      let result = await turnGenerator.next();

      while (!result.done) {
        activities.push(result.value as Activity);
        result = await turnGenerator.next();
      }

      subscribeController.close();

      expect(activities).toEqual([
        { from: { id: 'bot' }, text: 'Hello!', type: 'message' },
        {
          channelData: { isTurnEndMarker: true },
          from: { id: 'bot', role: 'bot' },
          id: expect.any(String),
          name: 'copilot-studio:turn-end',
          type: 'event'
        }
      ]);
    });
  });

  describe('on executeTurn with one bot activity', () => {
    test('should yield the bot activity followed by the turn-end sentinel', async () => {
      const serverMock = mockServer(server);
      const strategy = { ...serverMock.strategy, emitTurnEndMarker: true };

      // startNewConversation: no activities
      serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode('event: end\ndata: end\n\n')])
      );

      const { controller: subscribeController, readableStream: subscribeStream } = createReadableStreamWithController();
      serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () => subscribeStream);

      const turnGenerator: TurnGenerator = createHalfDuplexChatAdapter(strategy, {
        retry: { retries: 0 },
        signal: abortController.signal
      });

      // Drain startNewConversation — with emitTurnEndMarker: true, a sentinel is yielded first
      await turnGenerator.next(); // sentinel from startNewConversation
      const startResult = await turnGenerator.next();
      expect(startResult).toEqual({ done: true, value: expect.any(Function) });

      const executeTurn = startResult.value as ExecuteTurnFunction;

      // Queue a bot activity on /subscribe
      subscribeController.enqueue(
        encoder.encode(
          `event: activity\ndata: ${JSON.stringify({ from: { id: 'bot' }, text: 'Aloha!', type: 'message' })}\n\n`
        )
      );

      // Mock /execute to return end immediately
      serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode('event: end\ndata: end\n\n')])
      );

      const executeGenerator = executeTurn({ from: { id: 'user' }, text: 'Hi', type: 'message' });

      // First activity from /subscribe
      await expect(executeGenerator.next()).resolves.toEqual({
        done: false,
        value: { from: { id: 'bot' }, text: 'Aloha!', type: 'message' }
      });

      // Start the next iteration first so the silence-timeout setTimeout is created,
      // then advance fake timers to fire it.
      const sentinelPromise = executeGenerator.next();
      await jest.advanceTimersByTimeAsync(1_000);

      // Turn-end sentinel
      await expect(sentinelPromise).resolves.toEqual({
        done: false,
        value: {
          channelData: { isTurnEndMarker: true },
          from: { id: 'bot', role: 'bot' },
          id: expect.any(String),
          name: 'copilot-studio:turn-end',
          type: 'event'
        }
      });

      // Should complete with next executeTurn function
      await expect(executeGenerator.next()).resolves.toEqual({ done: true, value: expect.any(Function) });
    });
  });

  describe('turn-end sentinel IDs are unique across turns', () => {
    test('each turn emits a sentinel with a distinct ID', async () => {
      const serverMock = mockServer(server);
      const strategy = { ...serverMock.strategy, emitTurnEndMarker: true };

      // startNewConversation: no activities
      serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode('event: end\ndata: end\n\n')])
      );

      const { controller: subscribeController, readableStream: subscribeStream } = createReadableStreamWithController();
      serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(async () => subscribeStream);

      const turnGenerator: TurnGenerator = createHalfDuplexChatAdapter(strategy, {
        retry: { retries: 0 },
        signal: abortController.signal
      });

      await turnGenerator.next(); // sentinel from startNewConversation
      const startResult = await turnGenerator.next();
      const executeTurn = startResult.value as ExecuteTurnFunction;

      // First execute turn
      subscribeController.enqueue(
        encoder.encode(
          `event: activity\ndata: ${JSON.stringify({ from: { id: 'bot' }, text: 'Turn 1', type: 'message' })}\n\n`
        )
      );

      serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode('event: end\ndata: end\n\n')])
      );

      const gen1 = executeTurn({ from: { id: 'user' }, text: 'Hello', type: 'message' });

      await gen1.next(); // 'Turn 1' activity

      const sentinel1Promise = gen1.next();
      await jest.advanceTimersByTimeAsync(1_000);

      const sentinel1Result = await sentinel1Promise;
      expect(sentinel1Result.done).toBe(false);
      const sentinel1 = sentinel1Result.value as Activity;

      const done1Result = await gen1.next();
      const executeTurn2 = done1Result.value as ExecuteTurnFunction;

      // Second execute turn
      subscribeController.enqueue(
        encoder.encode(
          `event: activity\ndata: ${JSON.stringify({ from: { id: 'bot' }, text: 'Turn 2', type: 'message' })}\n\n`
        )
      );

      serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode('event: end\ndata: end\n\n')])
      );

      const gen2 = executeTurn2({ from: { id: 'user' }, text: 'Again', type: 'message' });

      await gen2.next(); // 'Turn 2' activity

      const sentinel2Promise = gen2.next();
      await jest.advanceTimersByTimeAsync(1_000);

      const sentinel2Result = await sentinel2Promise;
      expect(sentinel2Result.done).toBe(false);
      const sentinel2 = sentinel2Result.value as Activity;

      expect((sentinel1 as { id: string }).id).not.toBe((sentinel2 as { id: string }).id);
    });
  });
});
