import { addedNodeMutation } from '../../../recorder/src/Recorder/types';

export type viewportResizeDimention = {
    width: number;
    height: number;
};

export type playerConfig = {
    root: Element;
    liveMode: boolean;
};

export type playerMetaData = {
    startTime: number;
    endTime: number;
    totalTime: number;
};

export type missingNode = {
    node: Node;
    mutation: addedNodeMutation;
};

export type missingNodeMap = {
    [id: number]: missingNode;
};

export type actionWithDelay = {
    doAction: () => void;
    delay: number;
};

export type Handler = (event?: unknown) => void;

export type Emitter = {
    on(type: string, handler: Handler): void;
    off(type: string, handler: Handler): void;
    emit(type: string, event?: unknown): void;
};

export enum ReplayerEvents {
    Start = 'start',
    Pause = 'pause',
    Resume = 'resume',
    Interact = 'interact',
    Resize = 'resize',
    Finish = 'finish',
    FullCaptureRebuilded = 'fullCapture-rebuilded',
    LoadStylesheetStart = 'load-stylesheet-start',
    LoadStylesheetEnd = 'load-stylesheet-end',
    MouseInteraction = 'mouse-interaction',
    EventCast = 'event-cast',
    Flush = 'flush',
    StateChange = 'state-change',
}

export type ScrollPosition = {
    // [scrollLeft,scrollTop]
    scroll?: [number, number];
};