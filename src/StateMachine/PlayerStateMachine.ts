// TODO: impl interact & live state
import { createMachine, interpret, assign, StateMachine } from '@xstate/fsm';
import {
    actionWithDelay,
    ReplayerEvents,
    Emitter,
} from '../Player/types';
import { eventWithTime, EventType, IncrementalSource } from '../../../recorder/src/Recorder/types'
import { addDelay, actionScheduler } from '../Player/Timer';
import { needCastInSyncMode } from '../Player/utils';

export type PlayerContext = {
    events: eventWithTime[];
    actionScheduler: actionScheduler;
    timeOffset: number;
    baselineTime: number;
    lastPlayedEvent: eventWithTime | null;
};

export type PlayerEvent =
    | {
        type: 'PLAY';
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

/**
 * If the array have multiple meta and fullsnapshot events,
 * return the events from last meta to the end.
 */
export function retrieveNeedEvents(
    events: eventWithTime[],
    baselineTime: number,
): eventWithTime[] {
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.type === EventType.Meta) {
            if (event.timestamp <= baselineTime) {
                return events.slice(i);
            }
        }
    }
    return events;
}

/**
 * @param context the context of the player
 * * events : events that it will replay
 * * actionsBufferHandler : a handler for all actions put in the buffer
 * * timeoffset : playing time offset
 * * base line time : the current time of the video
 * * last played event : the last played event
 * @param getCastFn retrieve the action that perform the player 
 * @param emitter an emitter instance
 */
export function createPlayerService(
    context: PlayerContext,
    getCastFn: (event: eventWithTime, isSync: boolean) => { (): void },
    emitter: Emitter,
) {
    const playerMachine = createMachine<PlayerContext, PlayerEvent, PlayerState>(
        //  Basics properties
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
        //  All actions that can perform the machine
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
                    const { actionScheduler: actionsBF, events, baselineTime, lastPlayedEvent } = ctx;
                    actionsBF.clear();      // Delete all buffered actions
                    for (const event of events) {
                        // TODO: improve this API
                        addDelay(event, baselineTime);
                    }
                    const neededEvents = retrieveNeedEvents(events, baselineTime);

                    const actions = new Array<actionWithDelay>();

                    /**
                     * Foreach event produce an corresponding action
                     * 
                     */
                    for (const event of neededEvents) {
                        let lastPlayedTimestamp = lastPlayedEvent?.timestamp;
                        //  Check if the last played event is a mouse incremental event 
                        if (
                            lastPlayedEvent?.type === EventType.IncrementalCapture &&
                            lastPlayedEvent.data.source === IncrementalSource.MouseMove
                        ) {
                            lastPlayedTimestamp =
                                lastPlayedEvent.timestamp +
                                lastPlayedEvent.data.positions[0]?.timeOffset;
                        }
                        //  Check if the time is passed for this event
                        if (
                            lastPlayedTimestamp &&
                            lastPlayedTimestamp < baselineTime &&
                            (event.timestamp <= lastPlayedTimestamp || event === lastPlayedEvent)
                        ) {
                            continue;
                        }
                        //  Check if the time is'nt up for this event and this event is not a mouse or media interaction event
                        const isSync = event.timestamp < baselineTime;
                        if (isSync && !needCastInSyncMode(event)) {
                            continue;
                        }
                        //  
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
                    //  
                    emitter.emit(ReplayerEvents.Flush);
                    actionsBF.addActions(actions);
                    actionsBF.start();
                },
                pause(ctx) {
                    ctx.actionScheduler.clear();
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