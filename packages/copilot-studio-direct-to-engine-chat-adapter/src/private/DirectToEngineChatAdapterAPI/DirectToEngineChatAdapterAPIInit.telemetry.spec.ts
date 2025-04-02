import { parse } from 'valibot';
import {
  directToEngineChatAdapterAPIInitSchema,
  type DirectToEngineChatAdapterAPIInit
} from './DirectToEngineChatAdapterAPIInit';

test('telemetry.correlationId should be a getter returning latest value', () => {
  const input: DirectToEngineChatAdapterAPIInit & { telemetry: { correlationId: string } } = {
    telemetry: {
      correlationId: '1'
    }
  };

  const output = parse(directToEngineChatAdapterAPIInitSchema, input);

  expect(output.telemetry?.correlationId).toEqual('1');

  // WHEN: input.correlationId changed.

  input.telemetry.correlationId = '2';

  // THEN: Output should change.

  expect(output.telemetry?.correlationId).toEqual('2');
});

test('should remove extra fields from telemetry', () => {
  const input: DirectToEngineChatAdapterAPIInit = {
    telemetry: {
      something: 'else'
    }
  };

  expect('something' in input.telemetry).toBe(true);

  // WHEN: init is parsed.

  const output = parse(directToEngineChatAdapterAPIInitSchema, input);

  // THEN: Output should not have extra fields.

  expect('something' in (output.telemetry as object)).toBe(false);
});
