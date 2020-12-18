import { NodeFormated } from "../../../recorder/src/NodeCaptor/types";
import {
    addedNodeMutation,
    attributeMutation,
    EventType,
    eventWithTime,
    incrementalData,
    IncrementalSource,
    inputData,
    mutationData,
    removedNodeMutation,
    scrollData,
    textMutation,
} from "../../../recorder/src/Recorder/types";
import { mirror } from "../../../recorder/src/Recorder/utils";

const REPLAY_CONSOLE_PREFIX = '[replayer]';

export const rules: (blockClass: string) => string[] = (blockClass: string) => [
    `iframe, .${blockClass} { background: #ccc }`,
    'noscript { display: none !important; }',
];

export function warnNodeNotFound(d: incrementalData, id: number) {
    console.warn(
        REPLAY_CONSOLE_PREFIX,
        `target with id '${id}' not found in`,
        d,
    );
}

export function needCastInSyncMode(event: eventWithTime): boolean {
    switch (event.type) {
        case EventType.FullCapture:
        case EventType.Meta:
            return true;
        default:
            break;
    }

    switch (event.data.source) {
        case IncrementalSource.MouseMove:
        case IncrementalSource.MouseInteraction:
        case IncrementalSource.TouchMove:
        case IncrementalSource.MediaInteraction:
            return false;
        case IncrementalSource.ViewportResize:
        case IncrementalSource.StyleSheetRule:
        case IncrementalSource.Scroll:
        case IncrementalSource.Input:
            return true;
        default:
            break;
    }

    return true;
}

export type TreeNode = {
    id: number;
    mutation: addedNodeMutation;
    parent?: TreeNode;
    children: Record<number, TreeNode>;
    texts: textMutation[];
    attributes: attributeMutation[];
};

export class TreeIndex {
    public tree!: Record<number, TreeNode>;

    private removeNodeMutations!: removedNodeMutation[];
    private textMutations!: textMutation[];
    private attributeMutations!: attributeMutation[];
    private indexes!: Map<number, TreeNode>;
    private removeIdSet!: Set<number>;
    private scrollMap!: Map<number, scrollData>;
    private inputMap!: Map<number, inputData>;

    constructor() {
        this.reset();
    }

    public add(mutation: addedNodeMutation) {
        const parentTreeNode = this.indexes.get(mutation.parentId);
        const treeNode: TreeNode = {
            id: mutation.node.nodeId,
            mutation,
            children: [],
            texts: [],
            attributes: [],
        };
        if (!parentTreeNode) {
            this.tree[treeNode.id] = treeNode;
        } else {
            treeNode.parent = parentTreeNode;
            parentTreeNode.children[treeNode.id] = treeNode;
        }
        this.indexes.set(treeNode.id, treeNode);
    }

    public remove(mutation: removedNodeMutation) {
        const parentTreeNode = this.indexes.get(mutation.parentId);
        const treeNode = this.indexes.get(mutation.id);

        const deepRemoveFromMirror = (id: number) => {
            this.removeIdSet.add(id);
            const node = mirror.getNode(id);
            node?.childNodes.forEach((childNode) => {
                if ('__sn' in childNode) {
                    deepRemoveFromMirror(((childNode as unknown) as NodeFormated)._fnode.nodeId);
                }
            });
        };
        const deepRemoveFromTreeIndex = (node: TreeNode) => {
            this.removeIdSet.add(node.id);
            Object.values(node.children).forEach((n) => deepRemoveFromTreeIndex(n));
            const _treeNode = this.indexes.get(node.id);
            if (_treeNode) {
                const _parentTreeNode = _treeNode.parent;
                if (_parentTreeNode) {
                    delete _treeNode.parent;
                    delete _parentTreeNode.children[_treeNode.id];
                    this.indexes.delete(mutation.id);
                }
            }
        };

        if (!treeNode) {
            this.removeNodeMutations.push(mutation);
            deepRemoveFromMirror(mutation.id);
        } else if (!parentTreeNode) {
            delete this.tree[treeNode.id];
            this.indexes.delete(treeNode.id);
            deepRemoveFromTreeIndex(treeNode);
        } else {
            delete treeNode.parent;
            delete parentTreeNode.children[treeNode.id];
            this.indexes.delete(mutation.id);
            deepRemoveFromTreeIndex(treeNode);
        }
    }

    public text(mutation: textMutation) {
        const treeNode = this.indexes.get(mutation.id);
        if (treeNode) {
            treeNode.texts.push(mutation);
        } else {
            this.textMutations.push(mutation);
        }
    }

    public attribute(mutation: attributeMutation) {
        const treeNode = this.indexes.get(mutation.id);
        if (treeNode) {
            treeNode.attributes.push(mutation);
        } else {
            this.attributeMutations.push(mutation);
        }
    }

    public scroll(d: scrollData) {
        this.scrollMap.set(d.id, d);
    }

    public input(d: inputData) {
        this.inputMap.set(d.id, d);
    }

    public flush(): {
        mutationData: mutationData;
        scrollMap: TreeIndex['scrollMap'];
        inputMap: TreeIndex['inputMap'];
    } {
        const {
            tree,
            removeNodeMutations,
            textMutations,
            attributeMutations,
        } = this;

        const batchMutationData: mutationData = {
            source: IncrementalSource.Mutation,
            removes: removeNodeMutations,
            texts: textMutations,
            attributes: attributeMutations,
            adds: [],
        };

        const walk = (treeNode: TreeNode, removed: boolean) => {
            if (removed) {
                this.removeIdSet.add(treeNode.id);
            }
            batchMutationData.texts = batchMutationData.texts
                .concat(removed ? [] : treeNode.texts)
                .filter((m) => !this.removeIdSet.has(m.id));
            batchMutationData.attributes = batchMutationData.attributes
                .concat(removed ? [] : treeNode.attributes)
                .filter((m) => !this.removeIdSet.has(m.id));
            if (
                !this.removeIdSet.has(treeNode.id) &&
                !this.removeIdSet.has(treeNode.mutation.parentId) &&
                !removed
            ) {
                batchMutationData.adds.push(treeNode.mutation);
                if (treeNode.children) {
                    Object.values(treeNode.children).forEach((n) => walk(n, false));
                }
            } else {
                Object.values(treeNode.children).forEach((n) => walk(n, true));
            }
        };

        Object.values(tree).forEach((n) => walk(n, false));

        for (const id of this.scrollMap.keys()) {
            if (this.removeIdSet.has(id)) {
                this.scrollMap.delete(id);
            }
        }
        for (const id of this.inputMap.keys()) {
            if (this.removeIdSet.has(id)) {
                this.inputMap.delete(id);
            }
        }

        const scrollMap = new Map(this.scrollMap);
        const inputMap = new Map(this.inputMap);

        this.reset();

        return {
            mutationData: batchMutationData,
            scrollMap,
            inputMap,
        };
    }

    private reset() {
        this.tree = [];
        this.indexes = new Map();
        this.removeNodeMutations = [];
        this.textMutations = [];
        this.attributeMutations = [];
        this.removeIdSet = new Set();
        this.scrollMap = new Map();
        this.inputMap = new Map();
    }
}

type ResolveTree = {
    value: addedNodeMutation;
    children: ResolveTree[];
    parent: ResolveTree | null;
};

export function queueToResolveTrees(queue: addedNodeMutation[]): ResolveTree[] {
    const queueNodeMap: Record<number, ResolveTree> = {};
    const putIntoMap = (
        m: addedNodeMutation,
        parent: ResolveTree | null,
    ): ResolveTree => {
        const nodeInTree: ResolveTree = {
            value: m,
            parent,
            children: [],
        };
        queueNodeMap[m.node.nodeId] = nodeInTree;
        return nodeInTree;
    };

    const queueNodeTrees: ResolveTree[] = [];
    for (const mutation of queue) {
        const { nextId, parentId } = mutation;
        if (nextId && nextId in queueNodeMap) {
            const nextInTree = queueNodeMap[nextId];
            if (nextInTree.parent) {
                const idx = nextInTree.parent.children.indexOf(nextInTree);
                nextInTree.parent.children.splice(
                    idx,
                    0,
                    putIntoMap(mutation, nextInTree.parent),
                );
            } else {
                const idx = queueNodeTrees.indexOf(nextInTree);
                queueNodeTrees.splice(idx, 0, putIntoMap(mutation, null));
            }
            continue;
        }
        if (parentId in queueNodeMap) {
            const parentInTree = queueNodeMap[parentId];
            parentInTree.children.push(putIntoMap(mutation, parentInTree));
            continue;
        }
        queueNodeTrees.push(putIntoMap(mutation, null));
    }

    return queueNodeTrees;
}

export function iterateResolveTree(
    tree: ResolveTree,
    cb: (mutation: addedNodeMutation) => unknown,
) {
    cb(tree.value);
    /**
     * The resolve tree was designed to reflect the DOM layout,
     * but we need append next sibling first, so we do a reverse
     * loop here.
     */
    for (let i = tree.children.length - 1; i >= 0; i--) {
        iterateResolveTree(tree.children[i], cb);
    }
}
