import NodeBuilder from "../../PlayerDOM/NodeBuilder";
import { _NFMHandler } from '../../PlayerDOM/NFMHandler';
import PlayerDOM from '../../PlayerDOM/PlayerDOM';
import { incrementalCaptureEvent, IncrementalSource, MouseInteractions, ReplayerEvents, MediaInteractions, NodeEncoded, Emitter, missingNodeMap } from '../../PlayerDOM/types';
import { createPlayerService } from '../../PlayerStateMachine/PlayerStateMachine';
import { TreeIndex, warnNodeNotFound } from '../../utils';
import { ActionTimelineScheduler } from '../ActionTimeScheduler';
import * as InputTrigger from './InputTrigger';
import * as MouseMovementTrigger from './MouseMovementTrigger';
import * as MutationTrigger from './MutationTrigger';
import * as ScrollTrigger from './ScrollTrigger';

function performAction(
    e: incrementalCaptureEvent & { timestamp: number; delay?: number },
    isSync: boolean,
    treeIndex: TreeIndex,
    playerSM: ReturnType<typeof createPlayerService>,
    actionScheduler: ActionTimelineScheduler,
    emitter: Emitter,
    dom: PlayerDOM,
    NodeBuilder: NodeBuilder,
    fragmentParentMap: Map<NodeEncoded, NodeEncoded>,
    missingNodeMap: missingNodeMap,
    storeScrollPosition: Function,
    resolveMissingNode: Function,
) {
    const { data: d } = e;
    switch (d.source) {
        case IncrementalSource.Mutation: {
            if (isSync) {
                d.adds.forEach((m) => treeIndex.add(m));
                d.texts.forEach((m) => treeIndex.text(m));
                d.attributes.forEach((m) => treeIndex.attribute(m));
                d.removes.forEach((m) => treeIndex.remove(m));
            }
            MutationTrigger.perform(
                d,
                isSync,
                dom,
                NodeBuilder,
                fragmentParentMap,
                missingNodeMap,
                storeScrollPosition,
                resolveMissingNode
            );
            break;
        }
        case IncrementalSource.MouseMove: {
            if (isSync) {
                const lastPosition = d.positions[d.positions.length - 1];
                MouseMovementTrigger.perform(d, lastPosition.x, lastPosition.y, lastPosition.id,dom);
            } else {
                d.positions.forEach((p) => {
                    const action = {
                        doAction: () => {
                            MouseMovementTrigger.perform(d, p.x, p.y, p.id,dom);
                        },
                        delay:
                            p.timeOffset +
                            e.timestamp -
                            playerSM.state.context.baselineTime,
                    };
                    actionScheduler.addAction(action);
                });
                // add a dummy action to keep timer alive
                actionScheduler.addAction({
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
            const target = _NFMHandler.getNode(d.id);
            if (!target) {
                return warnNodeNotFound(d, d.id);
            }
            emitter.emit(ReplayerEvents.MouseInteraction, {
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
                        MouseMovementTrigger.perform(d, d.x, d.y, d.id,dom);
                        dom.cursor.classList.remove('active');
                        // tslint:disable-next-line
                        void dom.cursor.offsetWidth;
                        dom.cursor.classList.add('active');
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
                treeIndex.scroll(d);
                break;
            }
            ScrollTrigger.perform(d, dom);
            break;
        }
        case IncrementalSource.ViewportResize: {
            emitter.emit(ReplayerEvents.Resize, {
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
                treeIndex.input(d);
                break;
            }
            InputTrigger.perform(d);
            break;
        }
        case IncrementalSource.MediaInteraction: {
            const target = _NFMHandler.getNode(d.id);
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
            const target = _NFMHandler.getNode(d.id);
            if (!target) {
                return warnNodeNotFound(d, d.id);
            }

            const styleEl = (target as Node) as HTMLStyleElement;
            const parent = (target.parentNode as unknown) as NodeEncoded;
            const usingVirtualParent = fragmentParentMap.has(parent);
            let placeholderNode;

            if (usingVirtualParent) {
                /**
                 * styleEl.sheet is only accessible if the styleEl is part of the
                 * dom. This doesn't work on DocumentFragments so we have to re-add
                 * it to the dom temporarily.
                 */
                const domParent = fragmentParentMap.get(
                    (target.parentNode as unknown) as NodeEncoded,
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

export {
    performAction,
    InputTrigger,
    ScrollTrigger,
    MouseMovementTrigger
}
