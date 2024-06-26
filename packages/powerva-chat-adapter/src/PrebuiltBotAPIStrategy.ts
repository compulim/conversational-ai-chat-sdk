/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 */

import type { TurnBasedChatAdapterAPIStrategy } from './types/TurnBasedChatAdapterAPIStrategy';

type PrebuiltBotAPIStrategyInit = {
  botIdentifier: string;
  environmentEndpointURL: URL;
  getTokenCallback: () => Promise<string>;
};

const API_VERSION = '2022-03-01-preview';

export default class PrebuiltBotAPIStrategy implements TurnBasedChatAdapterAPIStrategy {
  constructor({ botIdentifier, environmentEndpointURL, getTokenCallback }: PrebuiltBotAPIStrategyInit) {
    this.#getTokenCallback = getTokenCallback;

    const url = new URL(`/powervirtualagents/prebuilt/authenticated/bots/${botIdentifier}/`, environmentEndpointURL);

    url.searchParams.set('api-version', API_VERSION);

    this.#baseURL = url;
  }

  #baseURL: URL;
  #getTokenCallback: () => Promise<string>;

  async #getHeaders() {
    return { authorization: `Bearer ${await this.#getTokenCallback()}` };
  }

  public async prepareContinueTurn(): ReturnType<TurnBasedChatAdapterAPIStrategy['prepareContinueTurn']> {
    return { baseURL: this.#baseURL, headers: await this.#getHeaders() };
  }

  public async prepareExecuteTurn(): ReturnType<TurnBasedChatAdapterAPIStrategy['prepareExecuteTurn']> {
    return { baseURL: this.#baseURL, headers: await this.#getHeaders() };
  }

  public async prepareStartNewConversation(): ReturnType<
    TurnBasedChatAdapterAPIStrategy['prepareStartNewConversation']
  > {
    return { baseURL: this.#baseURL, headers: await this.#getHeaders() };
  }
}
