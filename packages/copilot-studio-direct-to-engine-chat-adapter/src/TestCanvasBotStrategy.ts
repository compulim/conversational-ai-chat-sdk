import {
  function_,
  instance,
  literal,
  object,
  optional,
  parse,
  pipe,
  string,
  transform,
  union,
  type InferOutput
} from 'valibot';

import { type Strategy } from './types/Strategy';
import { type Transport } from './types/Transport';

type DeltaToken = InferOutput<typeof deltaTokenSchema>;
type TestCanvasBotStrategyInit = Readonly<InferOutput<typeof testCanvasBotStrategyInitSchema>>;
type Token = InferOutput<typeof tokenSchema>;

const deltaTokenSchema = optional(string('getDeltaToken must return string or undefined'));
const testCanvasBotStrategyInitSchema = object({
  botId: string('botId must be a string'),
  environmentId: string('environmentId must be a string'),
  getDeltaToken: optional(
    pipe(
      function_('getDeltaToken must be a function'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform<() => any, () => Promise<DeltaToken>>(input => input)
    )
  ),
  getToken: pipe(
    function_('getToken must be a function'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform<() => any, () => Promise<Token>>(input => input)
  ),
  islandURI: instance(URL, 'islandURI must be instance of URL'),
  transport: union([literal('auto'), literal('rest')], 'transport must be either "auto" or "rest"')
});

const tokenSchema = string('getToken must return a string');

export default class TestCanvasBotStrategy implements Strategy {
  constructor(init: TestCanvasBotStrategyInit) {
    const { botId, islandURI, environmentId, getDeltaToken, getToken, transport } = parse(
      testCanvasBotStrategyInitSchema,
      init
    );

    this.#baseURL = new URL(`/environments/${encodeURI(environmentId)}/bots/${encodeURI(botId)}/test/`, islandURI);
    this.#getDeltaToken = async () => parse(deltaTokenSchema, await getDeltaToken?.());
    this.#getToken = async () => parse(tokenSchema, await getToken());
    this.#transport = transport;
  }

  #baseURL: URL;
  #getDeltaToken: () => Promise<DeltaToken>;
  #getToken: () => Promise<Token>;
  #transport: Transport;

  async #getHeaders() {
    return new Headers({ authorization: `Bearer ${await this.#getToken()}` });
  }

  public async prepareExecuteTurn(): ReturnType<Strategy['prepareExecuteTurn']> {
    const deltaToken = await this.#getDeltaToken();

    return {
      baseURL: this.#baseURL,
      body: deltaToken ? { deltaToken } : undefined,
      headers: await this.#getHeaders(),
      transport: this.#transport
    };
  }

  public async prepareStartNewConversation(): ReturnType<Strategy['prepareStartNewConversation']> {
    const deltaToken = await this.#getDeltaToken();

    return {
      baseURL: this.#baseURL,
      body: deltaToken ? { deltaToken } : undefined,
      headers: await this.#getHeaders(),
      transport: this.#transport
    };
  }
}

export { testCanvasBotStrategyInitSchema, type TestCanvasBotStrategyInit };
