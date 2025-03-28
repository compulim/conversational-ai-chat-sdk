import { type Transport } from './Transport';

export type StrategyRequestInit = {
  baseURL: URL;
  body?: Record<string, unknown> | undefined;
  headers?: Headers | undefined;
  transport?: Transport | undefined;
};

export type Strategy = {
  prepareExecuteTurn(): Promise<StrategyRequestInit>;
  prepareStartNewConversation(): Promise<StrategyRequestInit>;

  /**
   * (This API is experimental and is expected to go away with a new replacement before General Availability.)
   */
  experimental_prepareSubscribeActivities?: (() => Promise<StrategyRequestInit>) | undefined;
};
