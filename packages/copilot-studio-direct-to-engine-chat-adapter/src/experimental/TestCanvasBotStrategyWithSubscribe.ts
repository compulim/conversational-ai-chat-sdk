import { optional, parse, string, type InferOutput } from 'valibot';
import TestCanvasBotStrategy, {
  testCanvasBotStrategyInitSchema,
  type TestCanvasBotStrategyInit
} from '../TestCanvasBotStrategy';
import type { StrategyRequestInit } from '../types/Strategy';

const deltaTokenSchema = optional(string('getDeltaToken must return string or undefined'));
const tokenSchema = string('getToken must return a string');

type DeltaToken = InferOutput<typeof deltaTokenSchema>;
type Token = InferOutput<typeof tokenSchema>;

export default class TestCanvasBotStrategyWithSubscribe extends TestCanvasBotStrategy {
  constructor(init: TestCanvasBotStrategyInit) {
    super(init);

    const { botId, islandURI, environmentId, getDeltaToken, getToken } = parse(testCanvasBotStrategyInitSchema, init);

    this.#baseURL = new URL(`/environments/${encodeURI(environmentId)}/bots/${encodeURI(botId)}/test/`, islandURI);
    this.#getDeltaToken = async () => parse(deltaTokenSchema, await getDeltaToken?.());
    this.#getToken = async () => parse(tokenSchema, await getToken());
  }

  #baseURL: URL;
  #getDeltaToken: () => Promise<DeltaToken>;
  #getToken: () => Promise<Token>;

  async #getHeaders() {
    return new Headers({ authorization: `Bearer ${await this.#getToken()}` });
  }

  async experimental_prepareSubscribeActivities(): Promise<StrategyRequestInit> {
    const deltaToken = await this.#getDeltaToken();

    return {
      baseURL: this.#baseURL,
      body: deltaToken ? { deltaToken } : undefined,
      headers: await this.#getHeaders(),
      transport: 'auto'
    };
  }
}
