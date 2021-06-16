import NodeBuilder from "../PlayerDOM/NodeBuilder";
import PlayerDOM from "../PlayerDOM/PlayerDOM";
import { _NFMHandler } from "../PlayerDOM/NFMHandler";
import { addedNodeMutation, Emitter, EventType, eventWithTime, fullCaptureEvent, Handler, metaEvent, missingNodeMap, NodeEncoded, NodeType, playerMetaData, ReplayerEvents, ScrollPosition } from "../PlayerDOM/types";
import * as mittProxy from 'mitt';
import { AppendedIframe, isIframeNode, TreeIndex } from "./utils";
import { ActionTimelineScheduler } from "../ActionsHandler/ActionTimeScheduler";
import { createPlayerService } from "../PlayerStateMachine/PlayerStateMachine";
import { InputTrigger, performAction, ScrollTrigger } from "../ActionsHandler/ActionsTriggers";

const mitt = (mittProxy as any).default || mittProxy;

export default class Player {
    public dom!: PlayerDOM;

    private events: eventWithTime[] = [];

    private NodeBuilder!: NodeBuilder;

    private actionScheduler!: ActionTimelineScheduler;

    private missingNodeMap: missingNodeMap = {}; // save missing node
    private treeIndex = new TreeIndex();
    private fragmentParentMap = new Map<NodeEncoded, NodeEncoded>(); // optimisize fast-forward
    private elementScrollPosition = new Map<NodeEncoded, ScrollPosition>();  // store scroll position of element while fast-forward

    private emitter: Emitter = mitt();
    private playerSM!: ReturnType<typeof createPlayerService>;

    private newDocumentQueue: addedNodeMutation[] = [];

    constructor(
        events: eventWithTime[],
        w: HTMLDivElement
    ) {
        this.turnEventToAction = this.turnEventToAction.bind(this);

        // retrieve the recorded events to replay
        this.events = events;

        // initialize the main classes
        this.initUtils(w);

        // set all handlers for events sent to the emitter
        this.setEmitterHandlers();

        // rebuild first full snapshot as the poster of the player
        // maybe we can cache it for performance optimization
        this.setPlayerPoster();
    }

    private setEmitterHandlers() {
        this.emitter.on(ReplayerEvents.Flush, () => {
            const { scrollMap, inputMap } = this.treeIndex.flush();

            for (const [frag, parent] of this.fragmentParentMap.entries()) {
                _NFMHandler.map[parent._cnode.nodeId] = parent;

                /**
                 * If we have already set value attribute on textarea,
                 * then we could not apply text content as default value any more.
                 */
                if (
                    parent._cnode.type === NodeType.Element &&
                    parent._cnode.elementName === 'textarea' &&
                    frag.textContent
                ) {
                    ((parent as unknown) as HTMLTextAreaElement).value = frag.textContent;
                }
                parent.appendChild(frag);
                // restore scroll position of elements after they are mounted
                this.restoreScrollPosition(parent);
            }

            this.fragmentParentMap.clear();
            this.elementScrollPosition.clear();

            for (const d of scrollMap.values()) { ScrollTrigger.perform(d, this.dom); }

            for (const d of inputMap.values()) { InputTrigger.perform(d); }
        });
        this.emitter.on(ReplayerEvents.Resize, this.dom.handleResize as Handler);
    }

    public on(event: string, handler: Handler) {
        this.emitter.on(event, handler);
        return this;
    }

    private setPlayerPoster() {
        // first meta information
        const firstMeta = this.events.find((e) => e.type === EventType.Meta);
        if (firstMeta) {
            const { width, height } = firstMeta.data as metaEvent['data'];
            this.emitter.emit(ReplayerEvents.Resize, {
                width,
                height,
            });
        }

        // first full capture
        const firstFullCapture = this.events.find((e) => e.type === EventType.FullCapture);
        if (firstFullCapture) {
            this.rebuildFullCapture(
                firstFullCapture as fullCaptureEvent & { timestamp: number },
            );
        }
    }

    private initUtils(w: HTMLDivElement) {
        // Setup the player dom (wrapper, iframe, fake cursor mouse)
        this.dom = new PlayerDOM(w);
        this.dom.setupDom();

        // Create a Node builder
        this.NodeBuilder = new NodeBuilder(this.dom.iframe);

        // Create an action scheduler
        this.actionScheduler = new ActionTimelineScheduler();

        // Init the player state machine and run it
        this.playerSM = createPlayerService(
            {
                events: this.events,
                actionScheduler: this.actionScheduler,
                timeOffset: 0,
                baselineTime: 0,
                lastPlayedEvent: null,
            },
            this.turnEventToAction,
            this.emitter
        );

        this.playerSM.start();
        this.playerSM.subscribe((state) => {
            this.emitter.emit(ReplayerEvents.StateChange, {
                player: state,
            });
        });
    }

    public play(timeOffset = 0) {
        // Switch to pause state first on playerStateMachine if it's not the case
        if (!this.playerSM.state.matches('paused')) {
            this.playerSM.send({ type: 'PAUSE' });
        }
        // Switch to play state on playerStateMachine
        this.playerSM.send({ type: 'PLAY', payload: { timeOffset } });
        // Delete the pause class in iframe
        this.dom.iframe.contentDocument
            ?.getElementsByTagName('html')[0]
            .classList.remove('player-paused');
        this.emitter.emit(ReplayerEvents.Start);
    }

    public pause(timeOffset?: number) {
        // Switch to pause state first on playerStateMachine if it's on play state
        if (timeOffset === undefined && this.playerSM.state.matches('playing')) {
            this.playerSM.send({ type: 'PAUSE' });
        }
        //  TODO: Why this
        if (typeof timeOffset === 'number') {
            this.play(timeOffset);
            this.playerSM.send({ type: 'PAUSE' });
        }
        // Delete the pause class in iframe
        this.dom.iframe.contentDocument
            ?.getElementsByTagName('html')[0]
            .classList.add('player-paused');
        this.emitter.emit(ReplayerEvents.Pause);
    }

    public getMetaData(): playerMetaData {
        const firstEvent = this.playerSM.state.context.events[0];
        const lastEvent = this.playerSM.state.context.events[
            this.playerSM.state.context.events.length - 1
        ];
        return {
            startTime: firstEvent.timestamp,
            endTime: lastEvent.timestamp,
            totalTime: lastEvent.timestamp - firstEvent.timestamp,
        };
    }

    public getCurrentTime(): number {
        return this.actionScheduler.timeOffset + this.getTimeOffset();
    }

    public getTimeOffset(): number {
        const { baselineTime, events } = this.playerSM.state.context;
        return baselineTime - events[0].timestamp;
    }

    private rebuildFullCapture(event: fullCaptureEvent, isSync: boolean = false) {
        if (!this.dom.iframe.contentDocument) {
            return console.warn("Looks like your replayer has been destroyed.");
        }

        const collected: AppendedIframe[] = [];
        const _buildResult = this.NodeBuilder.build(event.data.node, this.dom.iframe.contentDocument, (builtNode) => {
            this.collectIframeAndAttachDocument(collected, builtNode);
        });

        const _dom = _buildResult[0];
        _NFMHandler.map = _buildResult[1];

        for (const { mutationInQueue, builtNode } of collected) {
            this.attachDocumentToIframe(mutationInQueue, builtNode);
            this.newDocumentQueue = this.newDocumentQueue.filter(
                (m) => m !== mutationInQueue,
            );
        }

        const domJson = (_dom as HTMLDocument)!.documentElement.outerHTML;

        this.dom.iframe.contentWindow!.document.open('text/html', 'replace');
        this.dom.iframe.contentWindow!.document.write(domJson);
        this.dom.iframe.contentWindow!.document.close();

        // avoid form submit to refresh the iframe
        this.dom.iframe.contentDocument!.addEventListener('submit', evt => {
            if (evt.target && (evt.target as Element).tagName === 'FORM') {
                evt.preventDefault();
            }
        });
        // avoid a link click to refresh the iframe
        this.dom.iframe.contentDocument!.addEventListener('click', evt => {
            if (evt.target && (evt.target as Element).tagName === 'A') {
                evt.preventDefault();
            }
        });

        this.emitter.emit(ReplayerEvents.FullCaptureRebuilded, event);
    }

    private attachDocumentToIframe(
        mutation: addedNodeMutation,
        iframeEl: HTMLIFrameElement,
    ) {
        const collected: AppendedIframe[] = [];
        this.NodeBuilder.buildAllNodes(
            mutation.node,
            _NFMHandler.map,
            iframeEl.contentDocument!,
            (builtNode) => {
                this.collectIframeAndAttachDocument(collected, builtNode);
            },
        );
        for (const { mutationInQueue, builtNode } of collected) {
            this.attachDocumentToIframe(mutationInQueue, builtNode);
            this.newDocumentQueue = this.newDocumentQueue.filter(
                (m) => m !== mutationInQueue,
            );
        }
    }

    private collectIframeAndAttachDocument(
        collected: AppendedIframe[],
        builtNode: NodeEncoded,
    ) {
        if (isIframeNode(builtNode)) {
            const mutationInQueue = this.newDocumentQueue.find(
                (m) => m.parentId === builtNode._cnode.nodeId,
            );
            if (mutationInQueue) {
                collected.push({ mutationInQueue, builtNode });
            }
        }
    }

    private turnEventToAction(event: eventWithTime, isSync = false) {
        let castFn: undefined | (() => void);

        switch (event.type) {
            case EventType.Meta:
                castFn = () =>
                    this.emitter.emit(ReplayerEvents.Resize, {
                        width: event.data.width,
                        height: event.data.height,
                    });
                break;
            case EventType.FullCapture:
                castFn = () => {
                    this.rebuildFullCapture(event);
                    this.dom.iframe.contentWindow!.scrollTo(event.data.initialOffset);
                };
                break;
            case EventType.IncrementalCapture:
                castFn = () => {
                    performAction(
                        event,
                        isSync,
                        this.treeIndex,
                        this.playerSM,
                        this.actionScheduler,
                        this.emitter,
                        this.dom,
                        this.NodeBuilder,
                        this.fragmentParentMap,
                        this.missingNodeMap,
                        this.storeScrollPosition,
                        this.restoreScrollPosition,
                    );
                };
                break;
            default:
        }

        const wrapped = () => {
            if (castFn) {
                castFn();
            }
            this.playerSM.send({ type: 'CAST_EVENT', payload: { event } });
            if (event === this.events[this.events.length - 1]) {
                this.playerSM.send('END');
                this.emitter.emit(ReplayerEvents.Finish);
            }
        };

        return wrapped;
    }

    private storeScrollPosition(parent: NodeEncoded) {
        if (parent) {
            if (parent.nodeType === parent.ELEMENT_NODE) {
                const parentElement = (parent as unknown) as HTMLElement;
                if (parentElement.scrollLeft || parentElement.scrollTop) {
                    // store scroll position state
                    this.elementScrollPosition.set(parent, {
                        scroll: [parentElement.scrollLeft, parentElement.scrollTop],
                    });
                }
                const children = parentElement.children;
                for (const child of Array.from(children)) {
                    this.storeScrollPosition((child as unknown) as NodeEncoded);
                }
            }
        }
    }

    private restoreScrollPosition(parent: NodeEncoded) {
        if (parent.nodeType === parent.ELEMENT_NODE) {
            const parentElement = (parent as unknown) as HTMLElement;
            if (this.elementScrollPosition.has(parent)) {
                const storedState = this.elementScrollPosition.get(parent)!;
                // restore scroll position
                if (storedState.scroll) {
                    parentElement.scrollLeft = storedState.scroll[0];
                    parentElement.scrollTop = storedState.scroll[1];
                }
                this.elementScrollPosition.delete(parent);
            }
            const children = parentElement.children;
            for (const child of Array.from(children)) {
                this.restoreScrollPosition((child as unknown) as NodeEncoded);
            }
        }
    }

}