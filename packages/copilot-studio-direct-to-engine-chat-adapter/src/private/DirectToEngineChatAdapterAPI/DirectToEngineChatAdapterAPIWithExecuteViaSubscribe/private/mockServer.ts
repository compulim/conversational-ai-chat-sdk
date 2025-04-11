import { http, HttpResponse, type PathParams } from 'msw';
import { type SetupServerApi } from 'msw/node';
import { type DefaultHttpResponseResolver } from '../../../types/DefaultHttpResponseResolver';
import { type JestMockOf } from '../../../types/JestMockOf';

function createResponseResolver() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createResponseBodyForREST: JestMockOf<() => Promise<any>> = jest.fn(() => {
    throw new Error('"createResponseBodyForREST" is not mocked');
  });

  const createResponseStreamForSSE: JestMockOf<() => Promise<ReadableStream>> = jest.fn(() => {
    throw new Error('"createResponseStreamForSSE" is not mocked');
  });

  const createResponseHeaders = jest.fn((init: { params: PathParams }): Headers => {
    const { conversationId } = init.params;

    if (conversationId) {
      if (typeof conversationId === 'string') {
        return new Headers([['x-ms-conversationid', conversationId]]);
      } else {
        return new Headers([['x-ms-conversationid', conversationId[0]]]);
      }
    }

    return new Headers([['x-ms-conversationid', 'c-00001']]);
  });

  const responseResolver: JestMockOf<DefaultHttpResponseResolver> = jest.fn(init =>
    init.request.headers.get('accept-type')?.includes('text/event-stream')
      ? responseResolverForREST(init)
      : responseResolverForSSE(init)
  );

  const responseResolverForREST: JestMockOf<DefaultHttpResponseResolver> = jest.fn(
    async init => new HttpResponse(await createResponseBodyForREST(), { headers: createResponseHeaders(init) })
  );

  const responseResolverForSSE: JestMockOf<DefaultHttpResponseResolver> = jest.fn(async init => {
    const headers = new Headers(createResponseHeaders(init));

    headers.set('content-type', 'text/event-stream');

    return new HttpResponse(await createResponseStreamForSSE(), { headers });
  });

  return {
    createResponseBodyForREST,
    createResponseHeaders,
    createResponseStreamForSSE,
    responseResolver,
    responseResolverForREST,
    responseResolverForSSE
  };
}

export default function mockServer(server: SetupServerApi) {
  const httpPostContinue = createResponseResolver();
  const httpPostConversation = createResponseResolver();
  const httpPostExecute = createResponseResolver();
  const httpPostSubscribe = createResponseResolver();

  server.use(http.post('http://test/conversations', httpPostConversation.responseResolver));
  server.use(http.post('http://test/conversations/:conversationId', httpPostExecute.responseResolver));
  server.use(http.post('http://test/conversations/:conversationId/continue', httpPostContinue.responseResolver));
  server.use(http.post('http://test/conversations/:conversationId/subscribe', httpPostSubscribe.responseResolver));

  const baseURL = new URL('http://test/conversations');

  const strategy = {
    experimental_prepareSubscribeActivities: async () => ({ baseURL }),
    prepareExecuteTurn: async () => ({ baseURL }),
    prepareStartNewConversation: async () => ({ baseURL })
  };

  return {
    baseURL,
    httpPostContinue,
    httpPostConversation,
    httpPostExecute,
    httpPostSubscribe,
    strategy
  };
}
