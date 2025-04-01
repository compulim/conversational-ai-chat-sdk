// import { readableStreamValuesWithSignal } from 'iter-fest';
// import {
//   boolean,
//   function_,
//   instance,
//   number,
//   object,
//   optional,
//   pipe,
//   readonly,
//   string,
//   transform,
//   undefinedable,
//   type InferOutput
// } from 'valibot';
// import createReadableStreamWithController from './private/createReadableStreamWithController';
// import DirectToEngineChatAdapterAPI from './private/DirectToEngineChatAdapterAPI/DirectToEngineChatAdapterAPI';
// import isAbortError from './private/isAbortError';
// import { type ExecuteTurnInit, type HalfDuplexChatAdapterAPI } from './private/types/HalfDuplexChatAdapterAPI';
// import { type Activity } from './types/Activity';
// import { type Strategy } from './types/Strategy';
// import { type Telemetry } from './types/Telemetry';

// const createHalfDuplexChatAdapterInitSchema = pipe(
//   object({
//     emitStartConversationEvent: optional(boolean('"emitStartConversationEvent" must be a boolean')),
//     locale: optional(string('"locale" must be a string')),
//     onActivity: optional(
//       pipe(
//         function_('"onActivity" must be a function'),
//         transform(value => value as () => void)
//       )
//     ),
//     retry: optional(
//       pipe(
//         object({
//           factor: optional(number('"retry.factory" must be a number')),
//           minTimeout: optional(number('"retry.minTimeout" must be a number')),
//           maxTimeout: optional(number('"retry.maxTimeout" must be a number')),
//           randomize: optional(boolean('"retry.randomize" must be a boolean')),
//           retries: optional(number('"retry.retries" must be a number'))
//         }),
//         readonly()
//       )
//     ),
//     signal: optional(instance(AbortSignal, '"signal" must be of type AbortSignal')),
//     telemetry: optional(
//       pipe(
//         object(
//           {
//             correlationId: undefinedable(string('"telemetry.correlationId" must be a string')),
//             trackException: pipe(
//               function_('"telemetry.trackException" must be a function'),
//               transform(value => value as Telemetry['trackException'])
//             )
//           },
//           '"telemetry" must be an object'
//         ),
//         readonly(),
//         transform(value => value as Telemetry)
//       )
//     )
//   }),
//   readonly()
// );

// type CreateHalfDuplexChatAdapterInit = InferOutput<typeof createHalfDuplexChatAdapterInitSchema> & {
//   /**
//    * Callback function to call when there is an activity incoming but the turn is not on the bot side.
//    *
//    * If specified, the chat adapter will establish an out-of-band persistent connection to the bot.
//    *
//    * Use `signal` to close the out-of-band connection.
//    */
//   onActivity?: unknown;

//   /**
//    * All resources will be removed when the `abort()` method of the `AbortController` which owns the `AbortSignal` is called.
//    */
//   signal?: unknown;
// };

// type ExecuteTurnFunction = (activity: Activity | undefined, init?: ExecuteTurnInit | undefined) => TurnGenerator;

// type TurnGenerator = AsyncGenerator<Activity, ExecuteTurnFunction, undefined>;

// const createExecuteTurn = (
//   api: HalfDuplexChatAdapterAPI,
//   init: Readonly<
//     (
//       | {
//           ignoreExecuteTurnResponse: true;
//           incomingActivities: ReadableStream<Activity>;
//         }
//       | {
//           ignoreExecuteTurnResponse: false;
//           incomingActivities: undefined;
//         }
//     ) & {
//       telemetry: CreateHalfDuplexChatAdapterInit['telemetry'];
//     }
//   >
// ): ExecuteTurnFunction => {
//   const { ignoreExecuteTurnResponse, incomingActivities, telemetry } = init;
//   let obsoleted = false;

//   return (activity: Activity | undefined): TurnGenerator => {
//     if (obsoleted) {
//       const error = new Error('This executeTurn() function is obsoleted. Please use a new one.');

//       telemetry?.trackException(error, { handledAt: 'createHalfDuplexChatAdapter.createExecuteTurn' });

//       throw error;
//     }

//     obsoleted = true;

//     return (async function* () {
//       if (ignoreExecuteTurnResponse) {
//         const abortController = new AbortController();

//         if (activity) {
//           (async () => {
//             // eslint-disable-next-line @typescript-eslint/no-unused-vars
//             for await (const _ of api.executeTurn(activity)) {
//               // Experimentally, we are reading from /subscribe for incoming activities.
//               // Ideally, we should read from execute turn and use /subscribe as notifications only.
//             }

//             abortController.abort();
//           })();
//         } else {
//           // TODO: We should abort after incomingActivities is drained.
//           setTimeout(() => abortController.abort(), 100);
//         }

//         try {
//           yield* readableStreamValuesWithSignal(incomingActivities, { signal: abortController.signal });
//         } catch (error) {
//           if (!isAbortError(error)) {
//             throw error;
//           }
//         }
//       } else {
//         activity && (yield* api.executeTurn(activity));
//       }

//       return createExecuteTurn(api, init);
//     })();
//   };
// };

// export default function createHalfDuplexChatAdapter(
//   strategy: Strategy,
//   init: CreateHalfDuplexChatAdapterInit = {}
// ): TurnGenerator {
//   return (async function* (): TurnGenerator {
//     const api = new DirectToEngineChatAdapterAPI(strategy, {
//       retry: init.retry,
//       telemetry: init.telemetry
//     });

//     yield* api.startNewConversation({
//       emitStartConversationEvent: init.emitStartConversationEvent ?? true,
//       locale: init.locale
//     });

//     if (init.onActivity) {
//       const { controller: incomingActivitiesController, readableStream: incomingActivities } =
//         createReadableStreamWithController<Activity>();

//       (async (onActivity, signal) => {
//         try {
//           for await (const activity of api.experimental_subscribeActivities({ signal })) {
//             incomingActivitiesController.enqueue(activity);

//             onActivity();
//           }
//         } catch (error) {
//           if (!isAbortError(error)) {
//             init.telemetry?.trackException(error, { handledAt: 'createHalfDuplexChatAdapter.subscribeActivities' });
//           }
//         }
//       })(init.onActivity, init.signal);

//       return createExecuteTurn(api, {
//         ignoreExecuteTurnResponse: true,
//         incomingActivities,
//         telemetry: init.telemetry
//       });
//     }

//     return createExecuteTurn(api, {
//       ignoreExecuteTurnResponse: false,
//       incomingActivities: undefined,
//       telemetry: init.telemetry
//     });
//   })();
// }

// export type { CreateHalfDuplexChatAdapterInit, ExecuteTurnFunction, TurnGenerator };
