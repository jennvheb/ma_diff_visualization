export function createParseState() {
    return {
        operations: [],
        renamedNewIds: new Set(),
        renamedIdPairs: new Map(),
        pendingMoveDeletes: new Map(),
        pendingMoveInserts: new Map(),
        editsByXid: new Map(),
        replacementByXid: new Map()
    };
}