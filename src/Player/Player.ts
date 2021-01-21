import {
    EventType,
    IncrementalSource,
    fullCaptureEvent,
    eventWithTime,
    MouseInteractions,
    incrementalCaptureEvent,
    mouseInteractionData,
    incrementalData,
    MediaInteractions,
    mutationData,
    addedNodeMutation,
    scrollData,
    inputData,
    metaEvent,
} from "../../../recorder/src/Recorder/types";
import * as mittProxy from 'mitt';
import { _NFHandler } from "../../../recorder/src/Recorder/utils";
import NodeBuilder from "../NodeBuilder/NodeBuilder";
import { actionScheduler } from './Timer';
import { createPlayerService } from '../StateMachine/PlayerStateMachine';
import { Handler, missingNodeMap, playerMetaData, viewportResizeDimention, actionWithDelay, missingNode, ReplayerEvents, Emitter, ScrollPosition } from "./types";
import { iterateResolveTree, queueToResolveTrees, TreeIndex, warnNodeNotFound } from "./utils";
import { NodeFormated, NodeType } from "../../../recorder/src/NodeCaptor/types";
import PlayerDOM from "./PlayerDOM";

const mitt = (mittProxy as any).default || mittProxy;

class Player {
    public dom!: PlayerDOM;

    private events: eventWithTime[] = [];

    private NodeBuilder!: NodeBuilder;

    private actionScheduler!: actionScheduler;
    private loadTimeout: number = 10 * 1000;

    private missingNodeMap: missingNodeMap = {}; //  save missing node
    private treeIndex = new TreeIndex();
    private fragmentParentMap = new Map<NodeFormated, NodeFormated>(); // optimisize fast-forward
    private elementScrollPosition  = new Map<NodeFormated, ScrollPosition>();  // store scroll position of element while fast-forward

    private emitter: Emitter = mitt();      
    private playerSM!: ReturnType<typeof createPlayerService>;

    constructor(events: eventWithTime[], w: HTMLDivElement) {
        // retrieve the recorded events to replay
        this.events = events;
        this.turnEventToAction = this.turnEventToAction.bind(this); // use to turn recorded event to executable action

        // set all handler event sent to the emitter
        this.setEmitterHandlers();

        //  initialize the some attribute class
        this.initUtils(w);

        // rebuild first full snapshot as the poster of the player
        // maybe we can cache it for performance optimization
        this.setPlayerPoster()
    }

    private setPlayerPoster() {
        const firstMeta = this.playerSM.state.context.events.find(
            (e) => e.type === EventType.Meta,
        );
        if (firstMeta) {
            const { width, height } = firstMeta.data as metaEvent['data'];
            setTimeout(() => {
                this.emitter.emit(ReplayerEvents.Resize, {
                    width,
                    height,
                });
            }, 0);
        }
        const firstFullCapture = this.playerSM.state.context.events.find(
            (e) => e.type === EventType.FullCapture,
        );
        if (firstFullCapture) {
            setTimeout(() => {
                this.rebuildFullCapture(
                    firstFullCapture as fullCaptureEvent & { timestamp: number },
                );
            }, 1);
        }
    }

    private setEmitterHandlers() {
        this.emitter.on(ReplayerEvents.Flush, () => {
            const { scrollMap, inputMap } = this.treeIndex.flush();

            for (const [frag, parent] of this.fragmentParentMap.entries()) {
                _NFHandler.map[parent._fnode.nodeId] = parent;

                /**
                 * If we have already set value attribute on textarea,
                 * then we could not apply text content as default value any more.
                 */
                if (
                    parent._fnode.type === NodeType.Element &&
                    parent._fnode.ElementName === 'textarea' &&
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

            for (const d of scrollMap.values()) { this.performScroll(d); }

            for (const d of inputMap.values()) { this.performInput(d); }
        });
        this.dom.handleResize = this.dom.handleResize.bind(this);
        this.emitter.on(ReplayerEvents.Resize, this.dom.handleResize as Handler);
    }

    public on(event: string, handler: Handler) {
        this.emitter.on(event, handler);
        return this;
    }

    private initUtils(w: HTMLDivElement) {
        //  Setup the player dom (wrapper, iframe, fake cursor mouse)
        this.dom = new PlayerDOM(w)
        this.dom.setupDom()

        //  Create a Node builder
        this.NodeBuilder = new NodeBuilder(this.dom.iframe);
        
        //  Create a actions buffer handler
        this.actionScheduler = new actionScheduler();

        //  Init player state machine
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
        //  Switch to pause state first on playerStateMachine if it's not the case
        if (!this.playerSM.state.matches('paused')) {
            this.playerSM.send({ type: 'PAUSE' });
        }
        //  Switch to play state on playerStateMachine
        this.playerSM.send({ type: 'PLAY', payload: { timeOffset } });
        //  Delete the pause class in iframe
        this.dom.iframe.contentDocument
            ?.getElementsByTagName('html')[0]
            .classList.remove('player-paused');
        this.emitter.emit(ReplayerEvents.Start);
    }

    public pause(timeOffset?: number) {
        //  Switch to pause state first on playerStateMachine if it's on play state
        if (timeOffset === undefined && this.playerSM.state.matches('playing')) {
            this.playerSM.send({ type: 'PAUSE' });
        }
        //  TODO: Why this
        if (typeof timeOffset === 'number') {
            this.play(timeOffset);
            this.playerSM.send({ type: 'PAUSE' });
        }
        //  Delete the pause class in iframe
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

    //  ! : Explain
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
                    this.performIncrementalAction(event, isSync);
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

    //  ! : Explain
    private rebuildFullCapture(event: fullCaptureEvent, isSync: boolean = false) {
        if (!this.dom.iframe.contentDocument) {
            return console.warn("Looks like your replayer has been destroyed.");
        }
        if (Object.keys(this.missingNodeMap).length) {
            console.warn(
                'Found unresolved missing node map',
                this.missingNodeMap,
            );
        }
        this.missingNodeMap = {};
        _NFHandler.map = this.NodeBuilder.build(event.data.node, this.dom.iframe.contentDocument)[1];
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
        })

        if (!this.playerSM.state.matches('playing')) {
            this.dom.iframe.contentDocument
                .getElementsByTagName('html')[0]
                .classList.add('player-paused');
        }

        this.emitter.emit(ReplayerEvents.FullCaptureRebuilded);
        if (!isSync) {
            this.waitForStylesheetLoad();
        }
    }

    /**
   * pause when loading style sheet, resume when loaded all timeout exceed
   */
    private waitForStylesheetLoad() {
        const head = this.dom.iframe.contentDocument?.head;
        if (head) {
            const unloadSheets: Set<HTMLLinkElement> = new Set();
            let timer: number;
            let beforeLoadState = this.playerSM.state;
            const stateHandler = () => {
                beforeLoadState = this.playerSM.state;
            };
            this.emitter.on(ReplayerEvents.Start, stateHandler);
            this.emitter.on(ReplayerEvents.Pause, stateHandler);
            const unsubscribe = () => {
                this.emitter.off(ReplayerEvents.Start, stateHandler);
                this.emitter.off(ReplayerEvents.Pause, stateHandler);
            };
            head.querySelectorAll('link[rel="stylesheet"]').forEach((css: HTMLLinkElement) => {
                if (!css.sheet) {
                    unloadSheets.add(css);
                    css.addEventListener('load', () => {
                        unloadSheets.delete(css);
                        // all loaded and timer not released yet
                        if (unloadSheets.size === 0 && timer !== -1) {
                            if (beforeLoadState.matches('playing')) {
                                this.play(this.getCurrentTime());
                            }
                            this.emitter.emit(ReplayerEvents.LoadStylesheetEnd);
                            if (timer) {
                                window.clearTimeout(timer);
                            }
                            unsubscribe();
                        }
                    });
                }
            });

            if (unloadSheets.size > 0) {
                // find some unload sheets after iterate
                this.playerSM.send({ type: 'PAUSE' });
                this.emitter.emit(ReplayerEvents.LoadStylesheetStart);
                timer = window.setTimeout(() => {
                    if (beforeLoadState.matches('playing')) {
                        this.play(this.getCurrentTime());
                    }
                    // mark timer was called
                    timer = -1;
                    unsubscribe();
                }, this.loadTimeout);
            }
        }
    }

    //  ! : Explain
    private performIncrementalAction(
        e: incrementalCaptureEvent & { timestamp: number; delay?: number },
        isSync: boolean
    ) {
        const { data: d } = e;
        switch (d.source) {
            case IncrementalSource.Mutation: {
                if (isSync) {
                    d.adds.forEach((m) => this.treeIndex.add(m));
                    d.texts.forEach((m) => this.treeIndex.text(m));
                    d.attributes.forEach((m) => this.treeIndex.attribute(m));
                    d.removes.forEach((m) => this.treeIndex.remove(m));
                }
                this.performMutation(d, isSync);
                break;
            }
            case IncrementalSource.MouseMove: {
                if (isSync) {
                    const lastPosition = d.positions[d.positions.length - 1];
                    this.performMouseMove(d, lastPosition.x, lastPosition.y, lastPosition.id);
                } else {
                    d.positions.forEach((p) => {
                        const action = {
                            doAction: () => {
                                this.performMouseMove(d, p.x, p.y, p.id);
                            },
                            delay:
                                p.timeOffset +
                                e.timestamp -
                                this.playerSM.state.context.baselineTime,
                        };
                        this.actionScheduler.addAction(action);
                    });
                    // add a dummy action to keep timer alive
                    this.actionScheduler.addAction({
                        doAction() { },
                        delay: e.delay! - d.positions[0]?.timeOffset,
                    });
                }
                break;
            }
            case IncrementalSource.MouseInteraction: {
                /**
                 * Same as the situation of missing input target.
                 */
                if (d.id === -1) {
                    break;
                }
                const event = new Event(MouseInteractions[d.type].toLowerCase());
                const target = _NFHandler.getNode(d.id);
                if (!target) {
                    return warnNodeNotFound(d, d.id);
                }
                this.emitter.emit(ReplayerEvents.MouseInteraction, {
                    type: d.type,
                    target,
                });
                switch (d.type) {
                    case MouseInteractions.Blur:
                        if ('blur' in ((target as Node) as HTMLElement)) {
                            ((target as Node) as HTMLElement).blur();
                        }
                        break;
                    case MouseInteractions.Focus:
                        ((target as Node) as HTMLElement).focus({
                            preventScroll: true,
                        });
                        break;
                    case MouseInteractions.Click:
                    case MouseInteractions.TouchStart:
                    case MouseInteractions.TouchEnd:
                        /**
                         * Click has no visual impact when replaying and may
                         * trigger navigation when apply to an <a> link.
                         * So we will not call click(), instead we add an
                         * animation to the mouse element which indicate user
                         * clicked at this moment.
                         */
                        if (!isSync) {
                            this.performMouseMove(d, d.x, d.y, d.id);
                            this.dom.mouse.classList.remove('active');
                            // tslint:disable-next-line
                            void this.dom.mouse.offsetWidth;
                            this.dom.mouse.classList.add('active');
                        }
                        break;
                    default:
                        target.dispatchEvent(event);
                }
                break;
            }
            case IncrementalSource.Scroll: {
                /**
                 * Same as the situation of missing input target.
                 */
                if (d.id === -1) {
                    break;
                }
                if (isSync) {
                    this.treeIndex.scroll(d);
                    break;
                }
                this.performScroll(d);
                break;
            }
            case IncrementalSource.ViewportResize: {
                this.emitter.emit(ReplayerEvents.Resize, {
                    width: d.width,
                    height: d.height,
                });
                break;
            }
            case IncrementalSource.Input: {
                /**
                 * Input event on an unserialized node usually means the event
                 * was synchrony triggered programmatically after the node was
                 * created. This means there was not an user observable interaction
                 * and we do not need to replay it.
                 */
                if (d.id === -1) {
                    break;
                }
                if (isSync) {
                    this.treeIndex.input(d);
                    break;
                }
                this.performInput(d);
                break;
            }
            case IncrementalSource.MediaInteraction: {
                const target = _NFHandler.getNode(d.id);
                if (!target) {
                    return warnNodeNotFound(d, d.id);
                }
                const mediaEl = (target as Node) as HTMLMediaElement;
                try {
                    if (d.type === MediaInteractions.Pause) {
                        mediaEl.pause();
                    }
                    if (d.type === MediaInteractions.Play) {
                        if (mediaEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                            mediaEl.play();
                        } else {
                            mediaEl.addEventListener('canplay', () => {
                                mediaEl.play();
                            });
                        }
                    }
                } catch (error) {
                    console.warn(
                        `Failed to replay media interactions: ${error.message || error}`,
                    );
                }
                break;
            }
            case IncrementalSource.StyleSheetRule: {
                const target = _NFHandler.getNode(d.id);
                if (!target) {
                    return warnNodeNotFound(d, d.id);
                }

                const styleEl = (target as Node) as HTMLStyleElement;
                const parent = (target.parentNode as unknown) as NodeFormated;
                const usingVirtualParent = this.fragmentParentMap.has(parent);
                let placeholderNode;

                if (usingVirtualParent) {
                    /**
                     * styleEl.sheet is only accessible if the styleEl is part of the
                     * dom. This doesn't work on DocumentFragments so we have to re-add
                     * it to the dom temporarily.
                     */
                    const domParent = this.fragmentParentMap.get(
                        (target.parentNode as unknown) as NodeFormated,
                    );
                    placeholderNode = document.createTextNode('');
                    parent.replaceChild(placeholderNode, target);
                    domParent!.appendChild(target);
                }

                const styleSheet: CSSStyleSheet = styleEl.sheet!;

                if (d.adds) {
                    d.adds.forEach(({ rule, index }) => {
                        const _index =
                            index === undefined
                                ? undefined
                                : Math.min(index, styleSheet.rules.length);
                        try {
                            styleSheet.insertRule(rule, _index);
                        } catch (e) {
                            /**
                             * sometimes we may capture rules with browser prefix
                             * insert rule with prefixs in other browsers may cause Error
                             */
                        }
                    });
                }

                if (d.removes) {
                    d.removes.forEach(({ index }) => {
                        try {
                            styleSheet.deleteRule(index);
                        } catch (e) {
                            /**
                             * same as insertRule
                             */
                        }
                    });
                }

                if (usingVirtualParent && placeholderNode) {
                    parent.replaceChild(target, placeholderNode);
                }

                break;
            }
            default:
        }
    }

    //  ! : Explain
    private performMutation(d: mutationData, useVirtualParent: boolean) {
        d.removes.forEach((mutation) => {
            const target = _NFHandler.getNode(mutation.id);
            if (!target) {
                return warnNodeNotFound(d, mutation.id);
            }
            const parent = _NFHandler.getNode(mutation.parentId);
            if (!parent) {
                return warnNodeNotFound(d, mutation.parentId);
            }
            // target may be removed with its parents before
            _NFHandler.removeNodeFromMap(target);
            if (parent) {
                const realParent = this.fragmentParentMap.get(parent);
                if (realParent && realParent.contains(target)) {
                    realParent.removeChild(target);
                } else if (this.fragmentParentMap.has(target)) {
                    /**
                     * the target itself is a fragment document and it's not in the dom
                     * so we should remove the real target from its parent
                     */
                    const realTarget = this.fragmentParentMap.get(target)!;
                    parent.removeChild(realTarget);
                    this.fragmentParentMap.delete(target);
                } else {
                    parent.removeChild(target);
                }
            }
        });

        // tslint:disable-next-line: variable-name
        const legacy_missingNodeMap: missingNodeMap = {
            ...this.missingNodeMap,
        };
        const queue: addedNodeMutation[] = [];

        // next not present at this moment
        function nextNotInDOM(mutation: addedNodeMutation) {
            let next: Node | null = null;
            if (mutation.nextId) {
                next = _NFHandler.getNode(mutation.nextId) as Node;
            }
            // next not present at this moment
            if (
                mutation.nextId !== null &&
                mutation.nextId !== undefined &&
                mutation.nextId !== -1 &&
                !next
            ) {
                return true;
            }
            return false;
        }

        const appendNode = (mutation: addedNodeMutation) => {
            if (!this.dom.iframe.contentDocument) {
                return console.warn('Looks like your replayer has been destroyed.');
            }
            let parent = _NFHandler.getNode(mutation.parentId);
            if (!parent) {
                return queue.push(mutation);
            }

            let parentInDocument = null;
            if (this.dom.iframe.contentDocument.contains) {
                parentInDocument = this.dom.iframe.contentDocument.contains(parent);
            } else if (this.dom.iframe.contentDocument.body.contains) {
                // fix for IE
                // refer 'Internet Explorer notes' at https://developer.mozilla.org/zh-CN/docs/Web/API/Document
                parentInDocument = this.dom.iframe.contentDocument.body.contains(parent);
            }

            if (useVirtualParent && parentInDocument) {
                const virtualParent = (document.createDocumentFragment() as unknown) as NodeFormated;
                _NFHandler.map[mutation.parentId] = virtualParent;
                this.fragmentParentMap.set(virtualParent, parent);

                // store the state, like scroll position, of child nodes before they are unmounted from dom
                this.storeScrollPosition(parent);

                while (parent.firstChild) {
                    virtualParent.appendChild(parent.firstChild);
                }
                parent = virtualParent;
            }

            let previous: Node | null = null;
            let next: Node | null = null;
            if (mutation.previousId) {
                previous = _NFHandler.getNode(mutation.previousId) as Node;
            }
            if (mutation.nextId) {
                next = _NFHandler.getNode(mutation.nextId) as Node;
            }
            if (nextNotInDOM(mutation)) {
                return queue.push(mutation);
            }

            const target = this.NodeBuilder.buildNode(mutation.node, this.dom.iframe.contentDocument!) as Node;

            // legacy data, we should not have -1 siblings any more
            if (mutation.previousId === -1 || mutation.nextId === -1) {
                legacy_missingNodeMap[mutation.node.nodeId] = {
                    node: target,
                    mutation,
                };
                return;
            }

            if (previous && previous.nextSibling && previous.nextSibling.parentNode) {
                parent.insertBefore(target, previous.nextSibling);
            } else if (next && next.parentNode) {
                // making sure the parent contains the reference nodes
                // before we insert target before next.
                parent.contains(next)
                    ? parent.insertBefore(target, next)
                    : parent.insertBefore(target, null);
            } else {
                parent.appendChild(target);
            }

            if (mutation.previousId || mutation.nextId) {
                this.resolveMissingNode(
                    legacy_missingNodeMap,
                    parent,
                    target,
                    mutation,
                );
            }
        };

        d.adds.forEach(mutation => appendNode(mutation));

        let startTime = Date.now();
        while (queue.length) {
            // transform queue to resolve tree
            const resolveTrees = queueToResolveTrees(queue);
            queue.length = 0;
            for (const tree of resolveTrees) {
                let parent = _NFHandler.getNode(tree.value.parentId);
                if (parent) {
                    iterateResolveTree(tree, (mutation) => {
                        appendNode(mutation);
                    });
                }
            }
        }

        if (Object.keys(legacy_missingNodeMap).length) {
            Object.assign(this.missingNodeMap, legacy_missingNodeMap);
        }

        d.texts.forEach((mutation) => {
            let target = _NFHandler.getNode(mutation.id);
            if (!target) {
                return warnNodeNotFound(d, mutation.id);
            }
            /**
             * apply text content to real parent directly
             */
            if (this.fragmentParentMap.has(target)) {
                target = this.fragmentParentMap.get(target)!;
            }
            target.textContent = mutation.value;
        });
        d.attributes.forEach((mutation) => {
            let target = _NFHandler.getNode(mutation.id);
            if (!target) {
                return warnNodeNotFound(d, mutation.id);
            }
            if (this.fragmentParentMap.has(target)) {
                target = this.fragmentParentMap.get(target)!;
            }
            for (const attributeName in mutation.attributes) {
                if (typeof attributeName === 'string') {
                    const value = mutation.attributes[attributeName];
                    try {
                        if (value !== null) {
                            ((target as Node) as Element).setAttribute(attributeName, value);
                        } else {
                            ((target as Node) as Element).removeAttribute(attributeName);
                        }
                    } catch (error) {

                    }
                }
            }
        });
    }

    //  ! : Explain
    private performScroll(d: scrollData) {
        const target = _NFHandler.getNode(d.id);
        if (!target) {
            return warnNodeNotFound(d, d.id);
        }
        if ((target as Node) === this.dom.iframe.contentDocument) {
            this.dom.iframe.contentWindow!.scrollTo({
                top: d.y,
                left: d.x,
                behavior: 'smooth',
            });
        } else {
            try {
                ((target as Node) as Element).scrollTop = d.y;
                ((target as Node) as Element).scrollLeft = d.x;
            } catch (error) {
                /**
                 * Seldomly we may found scroll target was removed before
                 * its last scroll event.
                 */
            }
        }
    }

    //  ! : Explain
    private performInput(d: inputData) {
        const target = _NFHandler.getNode(d.id);
        if (!target) {
            return warnNodeNotFound(d, d.id);
        }
        try {
            ((target as Node) as HTMLInputElement).checked = d.isChecked;
            ((target as Node) as HTMLInputElement).value = d.text;
        } catch (error) {
            // for safe
        }
    }

    private performMouseMove(d: incrementalData, x: number, y: number, id: number) {
        this.dom.mouse.style.left = `${x}px`;
        this.dom.mouse.style.top = `${y}px`;

        const target = _NFHandler.getNode(id);
        if (!target) {
            return warnNodeNotFound(d, id);
        }
        this.hoverElements((target as Node) as Element);
    }

    private storeScrollPosition(parent: NodeFormated) {
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
                    this.storeScrollPosition((child as unknown) as NodeFormated);
                }
            }
        }
    }

    private restoreScrollPosition(parent: NodeFormated) {
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
                this.restoreScrollPosition((child as unknown) as NodeFormated);
            }
        }
    }

    private resolveMissingNode(
        map: missingNodeMap,
        parent: Node,
        target: Node,
        targetMutation: addedNodeMutation,
    ) {
        const { previousId, nextId } = targetMutation;
        const previousInMap = previousId && map[previousId];
        const nextInMap = nextId && map[nextId];
        if (previousInMap) {
            const { node, mutation } = previousInMap as missingNode;
            parent.insertBefore(node, target);
            delete map[mutation.node.nodeId];
            delete this.missingNodeMap[mutation.node.nodeId];
            if (mutation.previousId || mutation.nextId) {
                this.resolveMissingNode(map, parent, node as Node, mutation);
            }
        }
        if (nextInMap) {
            const { node, mutation } = nextInMap as missingNode;
            parent.insertBefore(node, target.nextSibling);
            delete map[mutation.node.nodeId];
            delete this.missingNodeMap[mutation.node.nodeId];
            if (mutation.previousId || mutation.nextId) {
                this.resolveMissingNode(map, parent, node as Node, mutation);
            }
        }
    }

    private hoverElements(el: Element) {
        this.dom.iframe
            .contentDocument!.querySelectorAll('.\\:hover')
            .forEach(hoveredEl => {
                hoveredEl.classList.remove(':hover');
            });
        let currentEl: Element | null = el;
        while (currentEl) {
            if (currentEl.classList) {
                currentEl.classList.add(':hover');
            }
            currentEl = currentEl.parentElement;
        }
    }
}

export default Player;