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
import NodeCaptor from "../../../recorder/src/NodeCaptor/NodeCaptor";
import { mirror } from "../../../recorder/src/Recorder/utils";
import NodeBuilder from "../NodeBuilder/NodeBuilder";
import { Timer } from './Timer';
import { createPlayerService } from '../StateMachine/PlayerStateMachine';
import { Handler, missingNodeMap, playerMetaData, viewportResizeDimention, actionWithDelay, missingNode, ReplayerEvents, Emitter, ElementState } from "./types";
import { iterateResolveTree, queueToResolveTrees, TreeIndex, warnNodeNotFound } from "./utils";
import { NodeFormated, NodeType } from "../../../recorder/src/NodeCaptor/types";
import PlayerDOM from "./PlayerDOM";

const mitt = (mittProxy as any).default || mittProxy;

class Player {
    public dom: PlayerDOM

    private events: eventWithTime[] = [];

    private NodeBuilder: NodeBuilder;

    private lastPlayedEvent: eventWithTime;
    private timer: Timer;
    private loadTimeout: number = 10 * 1000;

    private legacy_missingNodeRetryMap: missingNodeMap = {};
    private treeIndex!: TreeIndex;
    private fragmentParentMap!: Map<NodeFormated, NodeFormated>;
    private elementStateMap!: Map<NodeFormated, ElementState>;

    private emitter: Emitter = mitt();
    private service!: ReturnType<typeof createPlayerService>;

    constructor(events: eventWithTime[], w:HTMLDivElement) {
        this.events = events;
        this.getCastFn = this.getCastFn.bind(this);
        this.dom.handleResize = this.dom.handleResize.bind(this);
        this.emitter.on(ReplayerEvents.Resize, this.dom.handleResize as Handler);

        this.treeIndex = new TreeIndex();
        this.fragmentParentMap = new Map<NodeFormated, NodeFormated>();
        this.elementStateMap = new Map<NodeFormated, ElementState>();
        this.emitter.on(ReplayerEvents.Flush, () => {
            const { scrollMap, inputMap } = this.treeIndex.flush();

            for (const [frag, parent] of this.fragmentParentMap.entries()) {
                mirror.map[parent._fnode.nodeId] = parent;
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
                // restore state of elements after they are mounted
                this.restoreState(parent);
            }

            this.fragmentParentMap.clear();
            this.elementStateMap.clear();

            for (const d of scrollMap.values()) {
                this.performScroll(d);
            }
            for (const d of inputMap.values()) {
                this.performInput(d);
            }
        });

        this.initUtils(w);
        // rebuild first full snapshot as the poster of the player
        // maybe we can cache it for performance optimization
        const firstMeta = this.service.state.context.events.find(
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
        const firstFullCapture = this.service.state.context.events.find(
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

    public on(event: string, handler: Handler) {
        this.emitter.on(event, handler);
        return this;
    }

    private initUtils(w: HTMLDivElement) {
        this.dom = new PlayerDOM(w)
        this.dom.setupDom()
        this.NodeBuilder = new NodeBuilder(this.dom.iframe);
        this.timer = new Timer();
        this.service = createPlayerService(
            {
                events: this.events,
                timer: this.timer,
                timeOffset: 0,
                baselineTime: 0,
                lastPlayedEvent: null,
            },
            {
                getCastFn: this.getCastFn,
                emitter: this.emitter,
            }
        );
        this.service.start();
        this.service.subscribe((state) => {
            this.emitter.emit(ReplayerEvents.StateChange, {
                player: state,
            });
        });
    }

    /**
     * This API was designed to be used as play at any time offset.
     * Since we minimized the data collected from recorder, we do not
     * have the ability of undo an event.
     * So the implementation of play at any time offset will always iterate
     * all of the events, cast event before the offset synchronously
     * and cast event after the offset asynchronously with timer.
     * @param timeOffset number
     */
    public play(timeOffset = 0) {
        if (this.service.state.matches('paused')) {
            this.service.send({ type: 'PLAY', payload: { timeOffset } });
        } else {
            this.service.send({ type: 'PAUSE' });
            this.service.send({ type: 'PLAY', payload: { timeOffset } });
        }
        this.dom.iframe.contentDocument
            ?.getElementsByTagName('html')[0]
            .classList.remove('rrweb-paused');
        this.emitter.emit(ReplayerEvents.Start);
    }

    public pause(timeOffset?: number) {
        if (timeOffset === undefined && this.service.state.matches('playing')) {
            this.service.send({ type: 'PAUSE' });
        }
        if (typeof timeOffset === 'number') {
            this.play(timeOffset);
            this.service.send({ type: 'PAUSE' });
        }
        this.dom.iframe.contentDocument
            ?.getElementsByTagName('html')[0]
            .classList.add('rrweb-paused');
        this.emitter.emit(ReplayerEvents.Pause);
    }

    //  TODO: Departed
    public resume(timeOffset = 0) {
        console.warn(
            `The 'resume' will be departed in 1.0. Please use 'play' method which has the same interface.`,
        );
        this.play(timeOffset);
        this.emitter.emit(ReplayerEvents.Resume);
    }

    public getMetaData(): playerMetaData {
        const firstEvent = this.service.state.context.events[0];
        const lastEvent = this.service.state.context.events[
            this.service.state.context.events.length - 1
        ];
        return {
            startTime: firstEvent.timestamp,
            endTime: lastEvent.timestamp,
            totalTime: lastEvent.timestamp - firstEvent.timestamp,
        };
    }

    public getCurrentTime(): number {
        return this.timer.timeOffset + this.getTimeOffset();
    }

    public getTimeOffset(): number {
        const { baselineTime, events } = this.service.state.context;
        return baselineTime - events[0].timestamp;
    }

    private getCastFn(event: eventWithTime, isSync = false) {
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
                    this.applyIncremental(event, isSync);
                };
                break;
            default:
        }

        const wrappedCastFn = () => {
            ``
            if (castFn) {
                castFn();
            }
            this.service.send({ type: 'CAST_EVENT', payload: { event } });
            this.lastPlayedEvent = event;
            if (event === this.events[this.events.length - 1]) {
                this.service.send('END');
                this.emitter.emit(ReplayerEvents.Finish);
            }
        };

        return wrappedCastFn;
    }

    private rebuildFullCapture(event: fullCaptureEvent, isSync: boolean = false) {
        if (!this.dom.iframe.contentDocument) {
            return console.warn("Looks like your replayer has been destroyed.");
        }
        if (Object.keys(this.legacy_missingNodeRetryMap).length) {
            console.warn(
                'Found unresolved missing node map',
                this.legacy_missingNodeRetryMap,
            );
        }
        this.legacy_missingNodeRetryMap = {};
        mirror.map = this.NodeBuilder.build(event.data.node, this.dom.iframe.contentDocument)[1];
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

        if (!this.service.state.matches('playing')) {
            this.dom.iframe.contentDocument
                .getElementsByTagName('html')[0]
                .classList.add('rrweb-paused');
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
            let beforeLoadState = this.service.state;
            const stateHandler = () => {
                beforeLoadState = this.service.state;
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
                this.service.send({ type: 'PAUSE' });
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

    private applyIncremental(
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
                    this.moveAndHover(d, lastPosition.x, lastPosition.y, lastPosition.id);
                } else {
                    d.positions.forEach((p) => {
                        const action = {
                            doAction: () => {
                                this.moveAndHover(d, p.x, p.y, p.id);
                            },
                            delay:
                                p.timeOffset +
                                e.timestamp -
                                this.service.state.context.baselineTime,
                        };
                        this.timer.addAction(action);
                    });
                    // add a dummy action to keep timer alive
                    this.timer.addAction({
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
                const target = mirror.getNode(d.id);
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
                            this.moveAndHover(d, d.x, d.y, d.id);
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
                const target = mirror.getNode(d.id);
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
                const target = mirror.getNode(d.id);
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

    private performMutation(d: mutationData, useVirtualParent: boolean) {
        d.removes.forEach((mutation) => {
            const target = mirror.getNode(mutation.id);
            if (!target) {
                return warnNodeNotFound(d, mutation.id);
            }
            const parent = mirror.getNode(mutation.parentId);
            if (!parent) {
                return warnNodeNotFound(d, mutation.parentId);
            }
            // target may be removed with its parents before
            mirror.removeNodeFromMap(target);
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
            ...this.legacy_missingNodeRetryMap,
        };
        const queue: addedNodeMutation[] = [];

        // next not present at this moment
        function nextNotInDOM(mutation: addedNodeMutation) {
            let next: Node | null = null;
            if (mutation.nextId) {
                next = mirror.getNode(mutation.nextId) as Node;
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
            let parent = mirror.getNode(mutation.parentId);
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
                mirror.map[mutation.parentId] = virtualParent;
                this.fragmentParentMap.set(virtualParent, parent);

                // store the state, like scroll position, of child nodes before they are unmounted from dom
                this.storeState(parent);

                while (parent.firstChild) {
                    virtualParent.appendChild(parent.firstChild);
                }
                parent = virtualParent;
            }

            let previous: Node | null = null;
            let next: Node | null = null;
            if (mutation.previousId) {
                previous = mirror.getNode(mutation.previousId) as Node;
            }
            if (mutation.nextId) {
                next = mirror.getNode(mutation.nextId) as Node;
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
                this.legacy_resolveMissingNode(
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
                let parent = mirror.getNode(tree.value.parentId);
                if (parent) {
                    iterateResolveTree(tree, (mutation) => {
                        appendNode(mutation);
                    });
                }
            }
        }

        if (Object.keys(legacy_missingNodeMap).length) {
            Object.assign(this.legacy_missingNodeRetryMap, legacy_missingNodeMap);
        }

        d.texts.forEach((mutation) => {
            let target = mirror.getNode(mutation.id);
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
            let target = mirror.getNode(mutation.id);
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

    private performScroll(d: scrollData) {
        const target = mirror.getNode(d.id);
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

    private performInput(d: inputData) {
        const target = mirror.getNode(d.id);
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


    /**
     * store state of elements before unmounted from dom recursively
     * the state should be restored in the handler of event ReplayerEvents.Flush
     * e.g. browser would lose scroll position after the process that we add children of parent node to Fragment Document as virtual dom
     */
    private storeState(parent: NodeFormated) {
        if (parent) {
            if (parent.nodeType === parent.ELEMENT_NODE) {
                const parentElement = (parent as unknown) as HTMLElement;
                if (parentElement.scrollLeft || parentElement.scrollTop) {
                    // store scroll position state
                    this.elementStateMap.set(parent, {
                        scroll: [parentElement.scrollLeft, parentElement.scrollTop],
                    });
                }
                const children = parentElement.children;
                for (const child of Array.from(children)) {
                    this.storeState((child as unknown) as NodeFormated);
                }
            }
        }
    }

    /**
     * restore the state of elements recursively, which was stored before elements were unmounted from dom in virtual parent mode
     * this function corresponds to function storeState
     */
    private restoreState(parent: NodeFormated) {
        if (parent.nodeType === parent.ELEMENT_NODE) {
            const parentElement = (parent as unknown) as HTMLElement;
            if (this.elementStateMap.has(parent)) {
                const storedState = this.elementStateMap.get(parent)!;
                // restore scroll position
                if (storedState.scroll) {
                    parentElement.scrollLeft = storedState.scroll[0];
                    parentElement.scrollTop = storedState.scroll[1];
                }
                this.elementStateMap.delete(parent);
            }
            const children = parentElement.children;
            for (const child of Array.from(children)) {
                this.restoreState((child as unknown) as NodeFormated);
            }
        }
    }

    private legacy_resolveMissingNode(
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
            delete this.legacy_missingNodeRetryMap[mutation.node.nodeId];
            if (mutation.previousId || mutation.nextId) {
                this.legacy_resolveMissingNode(map, parent, node as Node, mutation);
            }
        }
        if (nextInMap) {
            const { node, mutation } = nextInMap as missingNode;
            parent.insertBefore(node, target.nextSibling);
            delete map[mutation.node.nodeId];
            delete this.legacy_missingNodeRetryMap[mutation.node.nodeId];
            if (mutation.previousId || mutation.nextId) {
                this.legacy_resolveMissingNode(map, parent, node as Node, mutation);
            }
        }
    }

    private moveAndHover(d: incrementalData, x: number, y: number, id: number) {
        this.dom.mouse.style.left = `${x}px`;
        this.dom.mouse.style.top = `${y}px`;

        const target = mirror.getNode(id);
        if (!target) {
            return warnNodeNotFound(d, id);
        }
        this.hoverElements((target as Node) as Element);
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