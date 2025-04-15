import { readableStreamFrom } from 'iter-fest';
import { setupServer } from 'msw/node';
import type { Activity } from '../../../types/Activity';
import createReadableStreamWithController from '../../createReadableStreamWithController';
import type DirectToEngineChatAdapterAPIWithExecuteViaSubscribe from '../DirectToEngineChatAdapterAPIWithExecuteViaSubscribe';
import hasResolved from './private/hasResolved';
import mockServer from './private/mockServer';

const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

jest.setTimeout(1_000);

describe('setup', () => {
  let api: DirectToEngineChatAdapterAPIWithExecuteViaSubscribe;
  let serverMock: ReturnType<typeof mockServer>;

  beforeEach(() => {
    const {
      default: DirectToEngineChatAdapterAPIWithExecuteViaSubscribe
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('../DirectToEngineChatAdapterAPIWithExecuteViaSubscribe');

    serverMock = mockServer(server);

    api = new DirectToEngineChatAdapterAPIWithExecuteViaSubscribe(serverMock.strategy, {
      retry: { retries: 0 }
    });
  });

  describe('when startConversation iteration is finished', () => {
    let subscribeController: ReadableStreamDefaultController;
    let subscribeReadableStream: ReadableStream;

    beforeEach(async () => {
      ({ controller: subscribeController, readableStream: subscribeReadableStream } =
        createReadableStreamWithController());

      serverMock.httpPostSubscribe.createResponseStreamForSSE.mockImplementationOnce(
        async () => subscribeReadableStream
      );

      serverMock.httpPostConversation.createResponseStreamForSSE.mockImplementationOnce(async () =>
        readableStreamFrom([encoder.encode('event: end\ndata: end\n\n')])
      );

      const iterator = api.startNewConversation({ emitStartConversationEvent: true });

      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    });

    test('should have called subscribe', () =>
      expect(serverMock.httpPostSubscribe.responseResolver).toHaveBeenCalledTimes(1));

    describe('when executeTurn() is called', () => {
      let executeController: ReadableStreamDefaultController;
      let executeReadableStream: ReadableStream;
      let executeTurnIterable: AsyncIterableIterator<Activity>;
      let executeTurnNextPromise: Promise<IteratorResult<Activity>>;

      beforeEach(() => {
        ({ controller: executeController, readableStream: executeReadableStream } =
          createReadableStreamWithController());

        serverMock.httpPostExecute.createResponseStreamForSSE.mockImplementationOnce(async () => executeReadableStream);

        executeController.enqueue(encoder.encode('event: end\ndata: end\n\n'));
        executeController.close();

        executeTurnIterable = api.executeTurn({ from: { id: 'user' }, text: 'Hello, World!', type: 'message' });
        executeTurnNextPromise = executeTurnIterable.next();
      });

      test('should have called /execute', () =>
        expect(serverMock.httpPostExecute.responseResolver).toHaveBeenCalledTimes(1));

      test('should not resolve iteration', () => expect(hasResolved(executeTurnNextPromise)).resolves.toBe(false));

      describe('after 1 second', () => {
        beforeEach(() => jest.advanceTimersByTimeAsync(1_000));

        test('should return iteration done', () =>
          expect(executeTurnNextPromise).resolves.toEqual({ done: true, value: undefined }));
      });

      describe('after 500 ms', () => {
        beforeEach(() => jest.advanceTimersByTimeAsync(500));

        describe('when an activity is sent over /subscribe', () => {
          beforeEach(() => {
            subscribeController.enqueue(
              encoder.encode(
                `event: activity\ndata: ${JSON.stringify({
                  from: { id: 'bot' },
                  text: 'Bot first message',
                  type: 'message'
                })}\n\n`
              )
            );
          });

          test('executeTurn.next() should resolve to the activity', () =>
            expect(executeTurnNextPromise).resolves.toEqual({
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
});
