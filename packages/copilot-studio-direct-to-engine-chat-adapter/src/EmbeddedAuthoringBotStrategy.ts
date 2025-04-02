import { function_, instance, object, optional, parse, pipe, string, transform, type InferOutput } from 'valibot';

import { type Strategy, type StrategyRequestInit } from './types/Strategy';

type DeltaToken = InferOutput<typeof deltaTokenSchema>;
type EmbeddedAuthoringBotStrategyInit = Readonly<InferOutput<typeof embeddedAuthoringBotStrategyInitSchema>>;
type Token = InferOutput<typeof tokenSchema>;

const deltaTokenSchema = optional(string('getDeltaToken must return string or undefined'));
const embeddedAuthoringBotStrategyInitSchema = object({
  baseURL: instance(URL, 'baseURL must be instance of URL'),
  botSchema: string('botSchema must be a string'),
  getDeltaToken: optional(
    pipe(
      function_('getDeltaToken must be a function'),
      transform<never, () => Promise<DeltaToken>>(input => input)
    )
  ),
  getToken: pipe(
    function_('getToken must be a function'),
    transform<never, () => Promise<Token>>(input => input)
  )
});
const tokenSchema = string('getToken must return a string');

export default class EmbeddedAuthoringBotStrategy implements Strategy {
  constructor(init: EmbeddedAuthoringBotStrategyInit) {
    const { baseURL, botSchema, getDeltaToken, getToken } = parse(embeddedAuthoringBotStrategyInitSchema, init);

    this.#baseURL = new URL(`/copilotstudio/embedded-authoring/authenticated/bots/${botSchema}/`, baseURL);
    this.#baseURL.searchParams.set('api-version', '1');

    this.#getDeltaToken = async () => parse(deltaTokenSchema, await getDeltaToken?.());
    this.#getToken = async () => parse(tokenSchema, await getToken());
  }

  #baseURL: URL;
  #getDeltaToken: () => Promise<DeltaToken>;
  #getToken: () => Promise<Token>;

  public async prepareStartNewConversation(): Promise<StrategyRequestInit> {
    const deltaToken = await this.#getDeltaToken();

    return {
      baseURL: this.#baseURL,
      body: deltaToken ? { deltaToken } : undefined,
      headers: new Headers({ authorization: `Bearer ${await this.#getToken()}` })
    };
  }

  public async prepareExecuteTurn(): Promise<StrategyRequestInit> {
    const deltaToken = await this.#getDeltaToken();

    return {
      baseURL: new URL('execute?api-version=1', this.#baseURL),
      body: deltaToken ? { deltaToken } : undefined,
      headers: new Headers({ authorization: `Bearer ${await this.#getToken()}` })
    };
  }
}

export type { EmbeddedAuthoringBotStrategyInit };
