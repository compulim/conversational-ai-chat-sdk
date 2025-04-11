import { encode as base64Encode } from 'base64-arraybuffer';
import { Observable, asyncGeneratorWithLastValue } from 'iter-fest';
import { onErrorResumeNext } from 'on-error-resume-next';
import { v4 } from 'uuid';

import { type TurnGenerator } from './createHalfDuplexChatAdapter';
import DeferredObservable from './private/DeferredObservable';
import isAbortError from './private/isAbortError';
import promiseWithResolvers from './private/promiseWithResolvers';
import shareObservable from './private/shareObservable';
import { type Activity } from './types/Activity';
import { type Attachment } from './types/Attachment';
import { type ActivityId, type DirectLineJSBotConnection } from './types/DirectLineJSBotConnection';

function once<T = void>(fn: (value: T) => Promise<void>): (value: T) => Promise<void>;
function once<T = void>(fn: (value: T) => void): (value: T) => void;

function once<T>(fn: (value: T) => Promise<void> | void): (value: T) => Promise<void> | void {
  let called = false;

  return value => {
    if (!called) {
      called = true;

      return fn(value);
    }
  };
}

export default function toDirectLineJS(
  halfDuplexChatAdapter: TurnGenerator
): DirectLineJSBotConnection & { giveUp: () => void } {
  let nextSequenceId = 0;
  let giveUpDeferred = promiseWithResolvers<void>();
  let postActivityDeferred =
    promiseWithResolvers<readonly [Activity, (id: ActivityId) => void, (error: unknown) => void]>();

  // TODO: Find out why replyToId is pointing to nowhere.
  // TODO: Can the service add "timestamp" field?
  // TODO: Can the service echo back the activity?
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const patchActivity = ({ replyToId: _, ...activity }: Activity & { replyToId?: string }): Activity => ({
    ...activity,
    channelData: { ...activity.channelData, 'webchat:sequence-id': nextSequenceId++ },
    timestamp: new Date().toISOString()
  });

  const activityDeferredObservable = new DeferredObservable<Activity>(observer => {
    (async function () {
      connectionStatusDeferredObservable.next(0);
      connectionStatusDeferredObservable.next(1);

      let turnGenerator: TurnGenerator = halfDuplexChatAdapter;
      let handleRejectionOnce: ((error: unknown) => void) | undefined;
      let handleAcknowledgementOnce: () => void = once(async () => {
        connectionStatusDeferredObservable.next(2);
        await 0; // HACK: Web Chat need a spare cycle between connectionStatus$ change and activity$ subscription.
      });

      try {
        for (;;) {
          const iterator = asyncGeneratorWithLastValue(turnGenerator);

          for await (const activity of iterator) {
            await handleAcknowledgementOnce();

            observer.next(patchActivity(activity));
          }

          // All activities should be retrieved by now, we will start accepting "give up" signal from this point of time.
          giveUpDeferred = promiseWithResolvers<void>();

          // If no activities received from bot, we should still acknowledge.
          await handleAcknowledgementOnce();

          const executeTurn = iterator.lastValue();
          const result = await Promise.race([postActivityDeferred.promise, giveUpDeferred.promise]);

          if (result) {
            // TODO: Add test
            // 1. Use AbortSignal to abort all iterations. toDirectLineJS don't know about AbortSignal, only APISession/TurnGenerator does
            // 2. Call postActivity()
            // EXPECT: postActivity().subscribe() should error out.
            const [activity, resolvePostActivity, rejectPostActivity] = result;

            try {
              postActivityDeferred = promiseWithResolvers();

              // Patch `activity.attachments[].contentUrl` into Data URI if it was Blob URL.
              if (activity && activity.type === 'message' && activity.attachments) {
                activity.attachments = await Promise.all(
                  activity.attachments.map(async (attachment: Attachment) => {
                    if ('contentUrl' in attachment) {
                      const { contentUrl } = attachment;

                      // Ignore malformed URL.
                      if (onErrorResumeNext(() => new URL(contentUrl).protocol) === 'blob:') {
                        // Only allow fetching blob URLs.
                        const res = await fetch(contentUrl);

                        if (!res.ok) {
                          throw new Error('Failed to fetch attachment of blob URL.');
                        }

                        // FileReader.readAsDataURL() is not available in Node.js.
                        return Object.freeze({
                          ...attachment,
                          contentUrl: `data:${res.headers.get('content-type') || ''};base64,${base64Encode(
                            await res.arrayBuffer()
                          )}`
                        });
                      }
                    }

                    return attachment;
                  })
                );
              }

              turnGenerator = executeTurn(activity);
            } catch (error) {
              rejectPostActivity(error);

              throw error;
            }

            // Except "give up my turn", we will generate the activity ID and echoback the activity only when the first incoming activity arrived.
            // This make sure the bot acknowledged the outgoing activity before we echoback the activity.
            handleAcknowledgementOnce = once(() => {
              const activityId = v4() as ActivityId;

              observer.next(patchActivity({ ...activity, id: activityId }));
              resolvePostActivity(activityId);
            });

            handleRejectionOnce = once<unknown>(rejectPostActivity);
          } else {
            giveUpDeferred = promiseWithResolvers<void>();

            // TODO: Temporarily allowing `executeTurn()` to send `undefined` activity, we should change the `executeTurn` signature later.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            turnGenerator = executeTurn(undefined as any);

            handleRejectionOnce = undefined;
          }
        }
      } catch (error) {
        if (!isAbortError(error)) {
          console.error('Failed to communicate with the chat adapter.', error);

          handleRejectionOnce?.(error);
        }
      } finally {
        connectionStatusDeferredObservable.next(4);
      }
    })();
  });

  const connectionStatusDeferredObservable = new DeferredObservable<number>();

  return {
    activity$: shareObservable(activityDeferredObservable.observable),
    connectionStatus$: shareObservable(connectionStatusDeferredObservable.observable),
    end() {
      // Half-duplex connection does not requires implicit closing.
    },
    giveUp() {
      giveUpDeferred.resolve();
    },
    postActivity: (activity: Activity) =>
      // TODO: Throw exception if the postActivity() is already resolved because the current postActivity() will be lost.
      shareObservable(
        new Observable<ActivityId>(observer =>
          postActivityDeferred.resolve(
            Object.freeze([activity, id => observer.next(id), error => observer.error(error)])
          )
        )
      )
  };
}
