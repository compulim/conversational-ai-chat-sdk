import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import { type Activity } from '../../types/Activity';
import { type Strategy } from '../../types/Strategy';
import { type Telemetry } from '../../types/Telemetry';
import DirectToEngineChatAdapterAPI from '../DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
import { type DefaultHttpResponseResolver } from '../types/DefaultHttpResponseResolver';
import { type JestMockOf } from '../types/JestMockOf';

const server = setupServer();

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const NOT_MOCKED = <T extends (...args: any[]) => any>(..._: Parameters<T>): ReturnType<T> => {
  throw new Error('This function is not mocked.');
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Livestreaming is not supported via REST API.
describe.each(['auto' as const])('Using "%s" transport', transport => {
  let strategy: Strategy;

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
    describe.each([
      ['With', true],
      ['Without', false]
    ])('%s correlation ID set', (_, shouldSetCorrelationId) => {
      let adapter: DirectToEngineChatAdapterAPI;
      let getCorrelationId: JestMockOf<() => string | undefined>;
      let httpPostContinue: JestMockOf<DefaultHttpResponseResolver>;
      let httpPostConversation: JestMockOf<DefaultHttpResponseResolver>;
      let httpPostExecute: JestMockOf<DefaultHttpResponseResolver>;
      let trackException: JestMockOf<Telemetry['trackException']>;

      beforeEach(() => {
        getCorrelationId = jest.fn(() => undefined);
        httpPostContinue = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        httpPostConversation = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        httpPostExecute = jest.fn(NOT_MOCKED<DefaultHttpResponseResolver>);
        trackException = jest.fn(NOT_MOCKED<Telemetry['trackException']>);

        server.use(http.post('http://test/conversations', httpPostConversation));
        server.use(http.post('http://test/conversations/c-00001', httpPostExecute));
        server.use(http.post('http://test/conversations/c-00001/continue', httpPostContinue));

        adapter = new DirectToEngineChatAdapterAPI(strategy, {
          retry: { factor: 1, minTimeout: 0 },
          telemetry: {
            get correlationId() {
              return getCorrelationId();
            },
            trackException
          }
        });
      });

      describe('When conversation started and bot returned with 3 typing activities of 2 different sessions', () => {
        let startNewConversationResult: ReturnType<DirectToEngineChatAdapterAPI['startNewConversation']>;

        beforeEach(() => {
          shouldSetCorrelationId && getCorrelationId.mockImplementation(() => 't-00001');
          startNewConversationResult = adapter.startNewConversation({ emitStartConversationEvent });
        });

        describe('after iterate once', () => {
          let iteratorResult: IteratorResult<Activity>;

          beforeEach(async () => {
            httpPostConversation.mockImplementationOnce(
              () =>
                new HttpResponse(
                  Buffer.from(`event: activity
data: { "channelData": { "chunkType": "delta", "streamType": "streaming" }, "from": { "id": "bot" }, "id": "a-00001", "text": "Hello, ", "type": "typing" }

event: activity
data: { "channelData": { "chunkType": "delta", "streamType": "streaming" }, "from": { "id": "bot" }, "id": "a-00002", "text": "Aloha!", "type": "typing" }

event: activity
data: { "channelData": { "chunkType": "delta", "streamId": "a-00001", "streamType": "streaming" }, "from": { "id": "bot" }, "id": "a-00003", "text": "World!", "type": "typing" }

event: end
data: end

`),
                  { headers: { 'content-type': 'text/event-stream', 'x-ms-conversationid': 'c-00001' } }
                )
            );

            iteratorResult = await startNewConversationResult.next();
          });

          test('should have POST to /conversations', () => expect(httpPostConversation).toHaveBeenCalledTimes(1));

          test('should return the first activity', () =>
            expect(iteratorResult).toEqual({
              done: false,
              value: {
                channelData: { chunkType: 'delta', streamType: 'streaming' },
                from: { id: 'bot' },
                id: 'a-00001',
                text: 'Hello, ',
                type: 'typing'
              }
            }));

          describe('after iterate twice', () => {
            let iteratorResult: IteratorResult<Activity>;

            beforeEach(async () => {
              iteratorResult = await startNewConversationResult.next();
            });

            test('should return the second activity', () =>
              expect(iteratorResult).toEqual({
                done: false,
                value: {
                  channelData: { chunkType: 'delta', streamType: 'streaming' },
                  from: { id: 'bot' },
                  id: 'a-00002',
                  text: 'Aloha!',
                  type: 'typing'
                }
              }));

            describe('after iterate the third time', () => {
              let iteratorResult: IteratorResult<Activity>;

              beforeEach(async () => {
                iteratorResult = await startNewConversationResult.next();
              });

              test('should return the first typing session with accumulated result', () =>
                expect(iteratorResult).toEqual({
                  done: false,
                  value: {
                    channelData: { chunkType: 'delta', streamId: 'a-00001', streamType: 'streaming' },
                    from: { id: 'bot' },
                    id: 'a-00003',
                    text: 'Hello, World!', // Should accumulate from previous typing activity in the same call.
                    type: 'typing'
                  }
                }));

              describe('after iterate the fourth time', () => {
                let iteratorResult: IteratorResult<Activity>;

                beforeEach(async () => {
                  iteratorResult = await startNewConversationResult.next();
                });

                test('should complete', () => expect(iteratorResult).toEqual({ done: true, value: undefined }));

                describe('when execute turn and bot returned 2 activities in 1 turn', () => {
                  let executeTurnResult: ReturnType<DirectToEngineChatAdapterAPI['executeTurn']>;

                  beforeEach(() => {
                    shouldSetCorrelationId && getCorrelationId.mockReset().mockImplementation(() => 't-00002');
                    executeTurnResult = adapter.executeTurn({
                      from: { id: 'u-00001' },
                      text: 'Morning.',
                      type: 'message'
                    });
                  });

                  describe('after iterate once', () => {
                    let iteratorResult: IteratorResult<Activity>;

                    beforeEach(async () => {
                      httpPostExecute.mockImplementationOnce(
                        () =>
                          new HttpResponse(
                            Buffer.from(`event: activity
data: { "channelData": { "chunkType": "full", "streamType": "streaming" }, "from": { "id": "bot" }, "id": "a-00004", "text": "Good", "type": "typing" }

event: activity
data: { "channelData": { "chunkType": "full", "streamId": "a-00004", "streamType": "streaming" }, "from": { "id": "bot" }, "id": "a-00005", "text": "Goodbye!", "type": "typing" }

event: end
data: end

`),
                            { headers: { 'content-type': 'text/event-stream' } }
                          )
                      );

                      iteratorResult = await executeTurnResult.next();
                    });

                    test('should return the fourth activity', () =>
                      expect(iteratorResult).toEqual({
                        done: false,
                        value: {
                          channelData: { chunkType: 'full', streamType: 'streaming' },
                          from: { id: 'bot' },
                          id: 'a-00004',
                          text: 'Good',
                          type: 'typing'
                        }
                      }));

                    describe('after iterate twice', () => {
                      let iteratorResult: IteratorResult<Activity>;

                      beforeEach(async () => {
                        iteratorResult = await executeTurnResult.next();
                      });

                      test('should return the fifth activity', () =>
                        expect(iteratorResult).toEqual({
                          done: false,
                          value: {
                            channelData: { chunkType: 'full', streamId: 'a-00004', streamType: 'streaming' },
                            from: { id: 'bot' },
                            id: 'a-00005',
                            text: 'Goodbye!', // Chunk type is "full", should not accumulate.
                            type: 'typing'
                          }
                        }));

                      describe('after iterate the third time', () => {
                        let iteratorResult: IteratorResult<Activity>;

                        beforeEach(async () => {
                          iteratorResult = await executeTurnResult.next();
                        });

                        test('should complete', () => expect(iteratorResult).toEqual({ done: true, value: undefined }));
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
