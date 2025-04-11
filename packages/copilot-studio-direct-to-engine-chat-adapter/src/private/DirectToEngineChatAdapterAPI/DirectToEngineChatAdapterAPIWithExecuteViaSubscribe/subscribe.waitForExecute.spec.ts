import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Activity } from '../../../types/Activity';
import type { DefaultHttpResponseResolver } from '../../types/DefaultHttpResponseResolver';
import type { JestMockOf } from '../../types/JestMockOf';
import DirectToEngineChatAdapterAPIWithExecuteViaSubscribe from '../DirectToEngineChatAdapterAPIWithExecuteViaSubscribe';
import hasResolved from './private/hasResolved';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const NOT_MOCKED = <T extends (...args: any[]) => any>(..._: Parameters<T>): ReturnType<T> => {
  throw new Error('This function is not mocked.');
};

const encoder = new TextEncoder();
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('setup', () => {
  let api: DirectToEngineChatAdapterAPIWithExecuteViaSubscribe;
  let abortController: AbortController;
  let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
  let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;
  let httpPostSubscribe: JestMockOf<DefaultHttpResponseResolver>;
  let subscribeController: ReadableStreamDefaultController;
  let lastExecuteController: ReadableStreamDefaultController;

  beforeEach(() => {
    abortController = new AbortController();

    api = new DirectToEngineChatAdapterAPIWithExecuteViaSubscribe(
      {
        async experimental_prepareSubscribeActivities() {
          return { baseURL: new URL('http://test/conversations') };
        },
        async prepareExecuteTurn() {
          return { baseURL: new URL('http://test/conversations') };
        },
        async prepareStartNewConversation() {
          return { baseURL: new URL('http://test/conversations') };
        }
      },
      { signal: abortController.signal }
    );

    httpPostConversation = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
    httpPostExecute = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>).mockImplementation(
      () =>
        new HttpResponse(
          new ReadableStream({
            start(controller) {
              lastExecuteController = controller;
            }
          }),
          { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
        )
    );
    httpPostSubscribe = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>).mockImplementationOnce(
      () =>
        new HttpResponse(
          new ReadableStream({
            start(controller) {
              subscribeController = controller;
            }
          }),
          { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
        )
    );

    server.use(http.post('http://test/conversations', httpPostConversation));
    server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
    server.use(http.post('http://test/conversations/c-00001/subscribe', httpPostSubscribe));

    httpPostConversation.mockImplementationOnce(
      () =>
        new HttpResponse(encoder.encode(`event: end\ndata: end\n\n`), {
          headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' }
        })
    );
  });

  afterEach(() => abortController.abort());

  describe('when startConversation iteration is finished', () => {
    beforeEach(async () => {
      const iterator = api.startNewConversation({ emitStartConversationEvent: true });

      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    });

    test('should have called subscribe', () => expect(httpPostSubscribe).toHaveBeenCalledTimes(1));

    describe('when execute is called', () => {
      let iterator: AsyncIterableIterator<Activity>;
      let iteratorNextPromise: Promise<IteratorResult<Activity>>;

      beforeEach(async () => {
        iterator = api.executeTurn({ from: { id: 'user' }, text: 'Hello, World!', type: 'message' });
        iteratorNextPromise = iterator.next();
      });

      describe('when subscribe send an activity', () => {
        beforeEach(() => {
          subscribeController.enqueue(
            encoder.encode(
              `event: activity\ndata: ${JSON.stringify({
                from: { id: 'bot' },
                text: 'Aloha via /subscribe',
                type: 'message'
              })}\n\n`
            )
          );
        });

        // Activities from /subscribe is blocked until the first activity from /execute.
        test('iterator.next() should not have resolved', () =>
          expect(hasResolved(iteratorNextPromise)).resolves.toBe(false));

        describe('when execute send an activity', () => {
          beforeEach(() => {
            lastExecuteController.enqueue(
              encoder.encode(
                `event: activity\ndata: ${JSON.stringify({
                  from: { id: 'bot' },
                  text: 'Aloha via /execute',
                  type: 'message'
                })}\n\n`
              )
            );
          });

          test('iterator.next() should be resolved with activity from /subscribe', () =>
            expect(iteratorNextPromise).resolves.toEqual({
              done: false,
              value: {
                from: { id: 'bot' },
                text: 'Aloha via /subscribe',
                type: 'message'
              }
            }));

          describe('when subscribe send another activity', () => {
            beforeEach(() => {
              subscribeController.enqueue(
                encoder.encode(
                  `event: activity\ndata: ${JSON.stringify({
                    from: { id: 'bot' },
                    text: 'Good morning via /subscribe',
                    type: 'message'
                  })}\n\n`
                )
              );
            });

            test('iterator.next() should be resolved with the activity', () =>
              expect(iterator.next()).resolves.toEqual({
                done: false,
                value: {
                  from: { id: 'bot' },
                  text: 'Good morning via /subscribe',
                  type: 'message'
                }
              }));
          });
        });
      });
    });
  });
});
