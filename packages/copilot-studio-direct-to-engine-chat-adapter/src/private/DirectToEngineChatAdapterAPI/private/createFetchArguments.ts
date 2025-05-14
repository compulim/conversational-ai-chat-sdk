import { type StrategyRequestInit } from '../../../types/Strategy';
import { resolveURLWithQueryAndHash } from '../../resolveURLWithQueryAndHash';
import {
  CHAT_ADAPTER_HEADER_NAME,
  CONVERSATION_ID_HEADER_NAME,
  CORRELATION_ID_HEADER_NAME,
  NPM_PACKAGE_VERSION
} from './Constants';

export default function createFetchArguments(
  strategyRequestInit: StrategyRequestInit,
  {
    conversationId,
    correlationId,
    pathSuffixes
  }: {
    conversationId?: string | undefined;
    correlationId?: string | undefined;
    pathSuffixes?: readonly string[] | undefined;
  }
): Readonly<Parameters<typeof fetch>> {
  const headers = new Headers(strategyRequestInit.headers);

  conversationId && headers.set(CONVERSATION_ID_HEADER_NAME, conversationId);

  headers.set(
    'accept',
    strategyRequestInit.transport === 'rest'
      ? 'application/json,*/*;q=0.8'
      : 'text/event-stream,application/json;q=0.9,*/*;q=0.8'
  );
  headers.set('content-type', 'application/json');
  headers.set(
    CHAT_ADAPTER_HEADER_NAME,
    new URLSearchParams([['version', NPM_PACKAGE_VERSION]] satisfies string[][]).toString()
  );

  correlationId && headers.set(CORRELATION_ID_HEADER_NAME, correlationId);

  return Object.freeze([
    resolveURLWithQueryAndHash(strategyRequestInit.baseURL, 'conversations', conversationId, ...(pathSuffixes || [])),
    {
      body: JSON.stringify(strategyRequestInit.body),
      headers,
      method: 'POST'
    } satisfies RequestInit
  ]);
}
