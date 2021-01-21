import {
    eventWithTime,
    EventType,
    IncrementalSource,
} from '../../../recorder/src/Recorder/types';
import { actionWithDelay } from './types';

export class actionScheduler {
    public timeOffset: number = 0;

    private actionsBuffer: actionWithDelay[];
    private raf: number | null = null;

    constructor(actions: actionWithDelay[] = []) {
        this.actionsBuffer = actions;
    }
    /**
     * Add an action after the timer starts.
     * @param action
     */
    public addAction(action: actionWithDelay) {
        const index = this.findActionIndex(action);
        this.actionsBuffer.splice(index, 0, action);
    }

    /**
     * Add all actions before the timer starts
     * @param actions
     */
    public addActions(actions: actionWithDelay[]) {
        this.actionsBuffer.push(...actions);
    }

    public start() {
        this.actionsBuffer.sort((a1, a2) => a1.delay - a2.delay);
        this.timeOffset = 0;
        let lastTimestamp = performance.now();
        const { actionsBuffer: actions } = this;
        const self = this;
        function check(time: number) {
            self.timeOffset += time - lastTimestamp;
            lastTimestamp = time;
            while (actions.length) {
                const action = actions[0];
                if (self.timeOffset >= action.delay) {
                    actions.shift();
                    action.doAction();
                } else {
                    break;
                }
            }
            if (actions.length > 0) {
                self.raf = requestAnimationFrame(check);
            }
        }
        this.raf = requestAnimationFrame(check);
    }

    public clear() {
        if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
        }
        this.actionsBuffer.length = 0;
    }

    public isActive() {
        return this.raf !== null;
    }

    private findActionIndex(action: actionWithDelay): number {
        let start = 0;
        let end = this.actionsBuffer.length - 1;
        while (start <= end) {
            let mid = Math.floor((start + end) / 2);
            if (this.actionsBuffer[mid].delay < action.delay) {
                start = mid + 1;
            } else if (this.actionsBuffer[mid].delay > action.delay) {
                end = mid - 1;
            } else {
                return mid;
            }
        }
        return start;
    }
}

// TODO: add speed to mouse move timestamp calculation
export function addDelay(event: eventWithTime, baselineTime: number): number {
    // Mouse move events was recorded in a throttle function,
    // so we need to find the real timestamp by traverse the time offsets.
    if (
        event.type === EventType.IncrementalCapture &&
        event.data.source === IncrementalSource.MouseMove
    ) {
        const firstOffset = event.data.positions[0].timeOffset;
        // timeOffset is a negative offset to event.timestamp
        const firstTimestamp = event.timestamp + firstOffset;
        event.delay = firstTimestamp - baselineTime;
        return firstTimestamp - baselineTime;
    }
    event.delay = event.timestamp - baselineTime;
    return event.delay;
}
