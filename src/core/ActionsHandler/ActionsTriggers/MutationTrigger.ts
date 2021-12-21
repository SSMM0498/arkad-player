import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import NodeBuilder from "../../PlayerDOM/NodeBuilder";
import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { mutationData, missingNodeMap, addedNodeMutation, NodeEncoded, NodeType } from "../../PlayerDOM/types";
import { isIframeNode, iterateResolveTree, queueToResolveTrees, warnNodeNotFound } from "../../Player/utils";

export function perform(
    d: mutationData,
    useVirtualParent: boolean,
    dom: PlayerDOM,
    NodeBuilder: NodeBuilder,
    fragmentParentMap: Map<NodeEncoded, NodeEncoded>,
    missingNodeMap: missingNodeMap,
    newDocumentQueue: addedNodeMutation[],
    storeScrollPosition: Function,
    resolveMissingNode: Function,
    attachDocumentToIframe: Function,
) {
    d.removes.forEach((mutation) => {
        const target = _NFMHandler.getNode(mutation.id);
        if (!target) {
            return warnNodeNotFound(d, mutation.id);
        }
        const parent = _NFMHandler.getNode(mutation.parentId);
        if (!parent) {
            return warnNodeNotFound(d, mutation.parentId);
        }
        // target may be removed with its parents before
        _NFMHandler.removeNodeFromMap(target);
        if (parent) {
            const realParent = fragmentParentMap.get(parent);
            if (realParent && realParent.contains(target)) {
                realParent.removeChild(target);
            } else if (fragmentParentMap.has(target)) {
                /**
                 * the target itself is a fragment document and it's not in the dom
                 * so we should remove the real target from its parent
                 */
                const realTarget = fragmentParentMap.get(target)!;
                parent.removeChild(realTarget);
                fragmentParentMap.delete(target);
            } else {
                parent.removeChild(target);
            }
        }
    });

    // tslint:disable-next-line: variable-name
    const legacy_missingNodeMap: missingNodeMap = {
        ...missingNodeMap,
    };
    const queue: addedNodeMutation[] = [];

    // next not present at this moment
    function nextNotInDOM(mutation: addedNodeMutation) {
        let next: Node | null = null;
        if (mutation.nextId) {
            next = _NFMHandler.getNode(mutation.nextId) as Node;
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
        if (!dom.iframe.contentDocument) {
            return console.warn('Looks like your replayer has been destroyed.');
        }
        let parent = _NFMHandler.getNode(mutation.parentId);
        if (!parent) {
            if (!mutation.node) return;
            if (mutation.node.type === NodeType.Document) {
                // is newly added document, maybe the document node of an iframe
                return newDocumentQueue.push(mutation);
            }
            return queue.push(mutation);
        }

        let parentInDocument = null;
        if (dom.iframe.contentDocument.contains) {
            parentInDocument = dom.iframe.contentDocument.contains(parent);
        } else if (dom.iframe.contentDocument.body.contains) {
            // fix for IE
            // refer 'Internet Explorer notes' at https://developer.mozilla.org/zh-CN/docs/Web/API/Document
            parentInDocument = dom.iframe.contentDocument.body.contains(parent);
        }

        if (useVirtualParent && parentInDocument) {
            const virtualParent = (document.createDocumentFragment() as unknown) as NodeEncoded;
            _NFMHandler.map[mutation.parentId] = virtualParent;
            fragmentParentMap.set(virtualParent, parent);

            // store the state, like scroll position, of child nodes before they are unmounted from dom
            storeScrollPosition(parent);

            while (parent.firstChild) {
                virtualParent.appendChild(parent.firstChild);
            }
            parent = virtualParent;
        }

        let previous: Node | null = null;
        let next: Node | null = null;
        if (mutation.previousId) {
            previous = _NFMHandler.getNode(mutation.previousId) as Node;
        }
        if (mutation.nextId) {
            next = _NFMHandler.getNode(mutation.nextId) as Node;
        }
        if (nextNotInDOM(mutation)) {
            return queue.push(mutation);
        }

        if (mutation.node.originId && !_NFMHandler.getNode(mutation.node.originId)) {
            return;
        }

        const targetDoc = mutation.node.originId
            ? _NFMHandler.getNode(mutation.node.originId)
            : dom.iframe.contentDocument!;

        if (isIframeNode(parent)) {
            attachDocumentToIframe(mutation, parent);
            return;
        }

        // if (targetDoc !== null) {
        const target = NodeBuilder.buildAllNodes(mutation.node, _NFMHandler,(targetDoc as Document)) as NodeEncoded;
        console.log(target);
        // }


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

        if (isIframeNode(target)) {
            const mutationInQueue = newDocumentQueue.find(
                (m) => m.parentId === target._cnode.nodeId,
            );
            console.log("queue");
            if (mutationInQueue) {
                attachDocumentToIframe(mutationInQueue, target);
                newDocumentQueue = newDocumentQueue.filter(
                    (m) => m !== mutationInQueue,
                );
            }
        }

        if (mutation.previousId || mutation.nextId) {
            resolveMissingNode(
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
            let parent = _NFMHandler.getNode(tree.value.parentId);
            if (parent) {
                iterateResolveTree(tree, (mutation) => {
                    appendNode(mutation);
                });
            }
        }
    }

    if (Object.keys(legacy_missingNodeMap).length) {
        Object.assign(missingNodeMap, legacy_missingNodeMap);
    }

    d.texts.forEach((mutation) => {
        let target = _NFMHandler.getNode(mutation.id);
        if (!target) {
            return warnNodeNotFound(d, mutation.id);
        }
        /**
         * apply text content to real parent directly
         */
        if (fragmentParentMap.has(target)) {
            target = fragmentParentMap.get(target)!;
        }
        target!.textContent = mutation.value;
    });
    d.attributes.forEach((mutation) => {
        let target = _NFMHandler.getNode(mutation.id);
        if (!target) {
            return warnNodeNotFound(d, mutation.id);
        }
        if (fragmentParentMap.has(target)) {
            target = fragmentParentMap.get(target)!;
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