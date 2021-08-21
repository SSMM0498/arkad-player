/**
 * Represents the type of the node if it'a HTML Element or Text Node
 */
 export enum NodeType {
    Document,
    DocumentType,
    Element,
    Text
}

export type documentNode = {
    type: NodeType.Document;
    childNodes: NodeCaptured[];
};

export type documentTypeNode = {
    type: NodeType.DocumentType;
    name: string;
    publicId: string;
    systemId: string;
};

/**
 * Represents an array of all the usefull attributes found in the node
 */
export type attributes = {
    [key: string]: string | number | boolean
}

/**
 * Represents the storing format for a HTML Element
 */
export type ElementNode = {
    type: NodeType.Element
    elementName: string
    attributes: attributes
    childNodes: NodeCaptured[]
}

/**
 * Represents the text node or css rules
 */
export type TextNode = {
    type: NodeType.Text
    textContent: string
    isCSSRules: boolean
}

/**
 * Represents a captured node
 */
export type NodeCaptured = (
    {nodeId: number} &
    {originId?: number} &
    (| ElementNode | TextNode | documentNode | documentTypeNode)
)

/**
 * Represents a merge with the captured node and the node document
 */
export interface NodeEncoded extends Node {
    _cnode: NodeCaptured
}

/**
 * Represents a map storing all the found node
 */
export type DocumentNodesMap = {
    [key: number]: NodeEncoded
}

export abstract class Watcher {
    public callback: (p: eventWithTime) => void
    abstract watch() : void
    abstract capture(event?: Event) : void
}

export enum EventType {
    Meta,
    FullCapture,
    IncrementalCapture
}

/**
 * Event saved when all nodes states are captured
 */
export type fullCaptureEvent = {
    type: EventType.FullCapture
    data: {
        node: NodeCaptured
        initialOffset: {
            top: number
            left: number
        }
    }
    isFirst: "first" | "last" | "middle"
}

/**
 * Event saved when user triggered a watched event
 */
export type incrementalCaptureEvent = {
    type: EventType.IncrementalCapture
    data: incrementalData
}

/**
 * Event saved when a full capture is done
 */
export type metaEvent = {
    type: EventType.Meta;
    data: {
        href: string;
        width: number;
        height: number;
    };
    isFirst: "first" | "last" | "middle"
};

/**
 * Type of event which triggered the incremental capture
 */
export enum IncrementalSource {
    Mutation,
    MouseMove,
    MouseInteraction,
    Scroll,
    ViewportResize,
    Input,
    TouchMove,
    MediaInteraction,
    StyleSheetRule,
    TextSelection,
    Console
}

export type mutationData = {
    source: IncrementalSource.Mutation
} & mutationCallbackParam

export type mousemoveData = {
    source: IncrementalSource.MouseMove | IncrementalSource.TouchMove
    positions: mousePosition[]
}

export type mouseInteractionData = {
    source: IncrementalSource.MouseInteraction
} & mouseInteractionParam

export type textSelectionData = {
    source: IncrementalSource.TextSelection,
    selection: selectionValue
}

export type scrollData = {
    source: IncrementalSource.Scroll
} & scrollPosition

export type viewportResizeData = {
    source: IncrementalSource.ViewportResize
} & viewportResizeDimension

export type inputData = {
    source: IncrementalSource.Input
    id: number
} & inputValue

export type mediaInteractionData = {
    source: IncrementalSource.MediaInteraction
} & mediaInteractionParam

export type styleSheetRuleData = {
    source: IncrementalSource.StyleSheetRule
} & styleSheetRuleParam

export type consoleData = {
    source: IncrementalSource.Console,
    type: String,
    stack?: String,
    messages: String,
}

export type incrementalData =
    | mutationData
    | mousemoveData
    | mouseInteractionData
    | scrollData
    | viewportResizeData
    | inputData
    | mediaInteractionData
    | styleSheetRuleData
    | textSelectionData
    | consoleData

export type event =
    | fullCaptureEvent
    | incrementalCaptureEvent
    | metaEvent

export type eventWithTime = event & {
    timestamp: number
    delay?: number
}
/**
 * TODO:Check them
 */
export type mutationRecord = {
    type: string
    target: Node
    oldValue: string | null
    addedNodes: NodeList
    removedNodes: NodeList
    attributeName: string | null
}

export type textNodeNewValue = {
    node: Node
    value: string | null
}

export type textMutation = {
    id: number
    value: string | null
}

export type attributeNewValue = {
    node: Node
    attributes: {
        [key: string]: string | null
    }
}

export type attributeMutation = {
    id: number
    attributes: {
        [key: string]: string | null
    }
}

export type removedNodeMutation = {
    parentId: number
    id: number
}

export type addedNodeMutation = {
    parentId: number
    // Newly recorded mutations will not have previousId any more, just for compatibility
    previousId?: number | null
    nextId: number | null
    node: NodeCaptured
}

type mutationCallbackParam = {
    texts: textMutation[]
    attributes: attributeMutation[]
    removes: removedNodeMutation[]
    adds: addedNodeMutation[]
    fromIframe: boolean
}

export type mousePosition = {
    x: number
    y: number
    id: number
    timeOffset: number
}

export enum MouseInteractions {
    MouseUp,
    MouseDown,
    Click,
    ContextMenu,
    DblClick,
    Focus,
    Blur,
    TouchStart,
    TouchMove_Departed, // we will start a separate observer for touch move event
    TouchEnd,
}

type mouseInteractionParam = {
    type: MouseInteractions
    id: number
    x: number
    y: number
}

export type scrollPosition = {
    id: number
    x: number
    y: number
}

export type styleSheetAddRule = {
    rule: string
    index?: number
}

export type styleSheetDeleteRule = {
    index: number
}

export type styleSheetRuleParam = {
    id: number
    removes?: styleSheetDeleteRule[]
    adds?: styleSheetAddRule[]
}

export type viewportResizeDimension = {
    width: number
    height: number
}

export type inputValue = {
    text: string
    isChecked: boolean
}

export type selectionValue = {
    anchorId: number
    anchorOffset: number
    focusId: number
    focusOffset: number
}

export const enum MediaInteractions {
    Play,
    Pause,
}

export type mediaInteractionParam = {
    type: MediaInteractions
    id: number
}

export type DocumentDimension = {
    x: number;
    y: number;
}

export type NodeEncodedMapHandler = {
    map: DocumentNodesMap
    getId: (n: NodeEncoded) => number
    getNode: (id: number) => NodeEncoded | null
    removeNodeFromMap: (n: NodeEncoded) => void
    has: (id: number) => boolean
}

export type throttleOptions = {
    leading?: boolean
    trailing?: boolean
}

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