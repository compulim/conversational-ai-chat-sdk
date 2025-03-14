import { encode as base64Encode } from 'base64-arraybuffer';
import { Observable, asyncGeneratorWithLastValue } from 'iter-fest';
import { onErrorResumeNext } from 'on-error-resume-next';
import { v4 } from 'uuid';

import { type TurnGenerator } from './createHalfDuplexChatAdapter';
import DeferredObservable from './private/DeferredObservable';
import promiseWithResolvers from './private/promiseWithResolvers';
import shareObservable from './private/shareObservable';
import { type Activity } from './types/Activity';
import { type Attachment } from './types/Attachment';
import { type ActivityId, type DirectLineJSBotConnection } from './types/DirectLineJSBotConnection';

const ConnectionStatus = {
  /** The status when the DirectLine object is first created/constructed */
  Uninitialized: 0,
  /** Currently trying to connect to the conversation */
  Connecting: 1,
  /** Successfully connected to the conversation. Connection is healthy so far as we know. */
  Online: 2,
  /** Last operation errored out with an expired token. Possibly waiting for someone to supply a new one. */
  ExpiredToken: 3,
  /** The initial attempt to connect to the conversation failed. No recovery possible. */
  FailedToConnect: 4,
  /** The bot ended the conversation */
  Ended: 5                       
} as const;

function once(fn: () => Promise<void>): () => Promise<void>;
function once(fn: () => void): () => void;

function once(fn: () => Promise<void> | void): () => Promise<void> | void {
  let called = false;

  return () => {
    if (!called) {
      called = true;

      return fn();
    }
  };
}

export default function toDirectLineJS(halfDuplexChatAdapter: TurnGenerator): DirectLineJSBotConnection {
  let nextSequenceId = 0;
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
      connectionStatusDeferredObservable.next(ConnectionStatus.Uninitialized);
      connectionStatusDeferredObservable.next(ConnectionStatus.Connecting);

      let turnGenerator: TurnGenerator = halfDuplexChatAdapter;
      let handleAcknowledgementOnce: () => Promise<void> | void = once(async () => {
        connectionStatusDeferredObservable.next(ConnectionStatus.Online);
        await 0; // HACK: Web Chat need a spare cycle between connectionStatus$ change and activity$ subscription.
      });

      try {
        for (;;) {
          const iterator = asyncGeneratorWithLastValue(turnGenerator);

          for await (const activity of iterator) {
            await handleAcknowledgementOnce();

            observer.next(patchActivity(activity));
          }

          // If no activities received from bot, we should still acknowledge.
          await handleAcknowledgementOnce();

          const executeTurn = iterator.lastValue();
          const [activity, resolvePostActivity, rejectPostActivity] = await postActivityDeferred.promise;

          try {
            postActivityDeferred = promiseWithResolvers();

            // Patch `activity.attachments[].contentUrl` into Data URI if it was Blob URL.
            if (activity.type === 'message' && activity.attachments) {
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

          // We will generate the activity ID and echoback the activity only when the first incoming activity arrived.
          // This make sure the bot acknowledged the outgoing activity before we echoback the activity.
          handleAcknowledgementOnce = once(() => {
            const activityId = v4() as ActivityId;

            observer.next(patchActivity({ ...activity, id: activityId }));
            resolvePostActivity(activityId);
          });
        }
      } catch (error) {
        console.error('Failed to communicate with the chat adapter.', error);

        connectionStatusDeferredObservable.next(ConnectionStatus.FailedToConnect);
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
    postActivity: (activity: Activity) =>
      shareObservable(
        new Observable<ActivityId>(observer =>
          postActivityDeferred.resolve(
            Object.freeze([activity, id => observer.next(id), error => observer.error(error)])
          )
        )
      )
  };
}
