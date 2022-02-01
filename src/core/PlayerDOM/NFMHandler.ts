import { NodeEncoded } from "./types"
import { NodeEncodedMapHandler } from "./types"

export const _NFMHandler: NodeEncodedMapHandler = {
    map: {},
    getId(n) {
        // if n is not a serialized NodeFormated, use -1 as its id.
        if (!n._cnode) { return -1 }
        return n._cnode.nodeId
    },
    getNode(id) { if (id === 33) console.log(_NFMHandler.map);
     return _NFMHandler.map[id] || null },

    removeNodeFromMap(n) {
        const id = n._cnode && n._cnode.nodeId
        delete _NFMHandler.map[id]
        if (n.childNodes) {
            n.childNodes.forEach((child) =>
                _NFMHandler.removeNodeFromMap((child as Node) as NodeEncoded),
            )
        }
    },
    has(id) { return _NFMHandler.map.hasOwnProperty(id) },
}