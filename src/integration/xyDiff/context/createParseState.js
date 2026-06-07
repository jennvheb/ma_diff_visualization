/**
 * creates mutable state object used while reading xydiff edits
 *
 * @returns {{operations: *[], renamedIdPairs: Map<any, any>, editsByXid: Map<any, any>, replacementByXid: Map<any, any>, pendingMoveDeletes: Map<any, any>, pendingMoveInserts: Map<any, any>, renamedNewIds: Set<any>}}
 */
export function createParseState() {
    return {
        operations: [],
        renamedNewIds: new Set(), // tracks ids that were renamed in the new tree
        renamedIdPairs: new Map(), // tracks (old id, new id)
        pendingMoveDeletes: new Map(), // nodes that may actually be a replacement or renamed node
        pendingMoveInserts: new Map(), // so temporarily store them until they can be paired or discarded
        editsByXid: new Map(), // groups edits by xydiff node id
        replacementByXid: new Map() // tracks replacements by xid
    };
}