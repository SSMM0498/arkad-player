import { createMachine, interpret, assign, StateMachine } from '@xstate/fsm';
import {
    playerConfig,
    actionWithDelay,
    ReplayerEvents,
    Emitter,
} from '../Player/types';
import { eventWithTime, EventType, IncrementalSource } from '../../../recorder/src/Recorder/types'
import { addDelay, Timer } from '../Player/Timer';
import { needCastInSyncMode } from '../Player/utils';

export type PlayerContext = {
    events: eventWithTime[];
    timer: Timer;
    timeOffset: number;
    baselineTime: number;
    lastPlayedEvent: eventWithTime | null;
};


export type PlayerEvent =
    | { type: 'PLAY';
        payload: {
            timeOffset: number;
        };
    }
    | {
        type: 'CAST_EVENT';
        payload: {
            event: eventWithTime;
        };
    }
    | { type: 'PAUSE' }
    | { type: 'END'; };

export type PlayerState =
    | {
        value: 'playing';
        context: PlayerContext;
    }
    | {
        value: 'paused';
        context: PlayerContext;
    }

type PlayerAssets = {
    emitter: Emitter;
    getCastFn(event: eventWithTime, isSync: boolean): () => void;
};

/**
 * If the array have multiple meta and fullsnapshot events,
 * return the events from last meta to the end.
 */
export function discardPriorSnapshots(
    events: eventWithTime[],
    baselineTime: number,
): eventWithTime[] {
    for (let idx = events.length - 1; idx >= 0; idx--) {
        const event = events[idx];
        if (event.type === EventType.Meta) {
            if (event.timestamp <= baselineTime) {
                return events.slice(idx);
            }
        }
    }
    return events;
}

export function createPlayerService(
    context: PlayerContext,
    { getCastFn, emitter }: PlayerAssets,
) {
    const playerMachine = createMachine<PlayerContext, PlayerEvent, PlayerState>(
        {
            id: 'player',
            context,
            initial: 'paused',
            states: {
                playing: {
                    on: {
                        PAUSE: {
                            target: 'paused',
                            actions: ['pause'],
                        },
                        CAST_EVENT: {
                            target: 'playing',
                            actions: 'castEvent',
                        },
                        END: {
                            target: 'paused',
                            actions: ['resetLastPlayedEvent', 'pause'],
                        },
                    },
                },
                paused: {
                    on: {
                        PLAY: {
                            target: 'playing',
                            actions: ['recordTimeOffset', 'play'],
                        },
                        CAST_EVENT: {
                            target: 'paused',
                            actions: 'castEvent',
                        }
                    },
                },
            },
        },
        {
            actions: {
                recordTimeOffset: assign((ctx, event) => {
                    let timeOffset = ctx.timeOffset;
                    if ('payload' in event && 'timeOffset' in event.payload) {
                        timeOffset = event.payload.timeOffset;
                    }
                    return {
                        ...ctx,
                        timeOffset,
                        baselineTime: ctx.events[0].timestamp + timeOffset,
                    };
                }),
                castEvent: assign({
                    lastPlayedEvent: (ctx, event) => {
                        if (event.type === 'CAST_EVENT') {
                            return event.payload.event;
                        }
                        return ctx.lastPlayedEvent;
                    },
                }),
                play(ctx) {
                    console.warn('play');
                    const { timer, events, baselineTime, lastPlayedEvent } = ctx;
                    timer.clear();
                    for (const event of events) {
                        // TODO: improve this API
                        addDelay(event, baselineTime);
                    }
                    const neededEvents = discardPriorSnapshots(events, baselineTime);

                    const actions = new Array<actionWithDelay>();
                    for (const event of neededEvents) {
                        let lastPlayedTimestamp = lastPlayedEvent?.timestamp;
                        if (
                            lastPlayedEvent?.type === EventType.IncrementalCapture &&
                            lastPlayedEvent.data.source === IncrementalSource.MouseMove
                        ) {
                            lastPlayedTimestamp =
                                lastPlayedEvent.timestamp +
                                lastPlayedEvent.data.positions[0]?.timeOffset;
                        }
                        if (
                            lastPlayedTimestamp &&
                            lastPlayedTimestamp < baselineTime &&
                            (event.timestamp <= lastPlayedTimestamp ||
                                event === lastPlayedEvent)
                        ) {
                            continue;
                        }
                        const isSync = event.timestamp < baselineTime;
                        if (isSync && !needCastInSyncMode(event)) {
                            continue;
                        }
                        const castFn = getCastFn(event, isSync);
                        if (isSync) {
                            castFn();
                        } else {
                            actions.push({
                                doAction: () => {
                                    castFn();
                                    emitter.emit(ReplayerEvents.EventCast, event);
                                },
                                delay: event.delay!,
                            });
                        }
                    }
                    emitter.emit(ReplayerEvents.Flush);
                    timer.addActions(actions);
                    timer.start();
                },
                pause(ctx) {
                    ctx.timer.clear();
                },
                resetLastPlayedEvent: assign((ctx) => {
                    return {
                        ...ctx,
                        lastPlayedEvent: null,
                    };
                }),
            },
        },
    );
    return interpret(playerMachine);
}

export type PlayerMachineState = StateMachine.State<
    PlayerContext,
    PlayerEvent,
    PlayerState
>;