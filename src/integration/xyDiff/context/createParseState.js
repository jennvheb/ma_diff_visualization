/*
 working memory while parsing
 operations: gets constantly pushed to while parsing, collects normalized delta operations
 renamedNewIds: tracks 'renamed' Ids emitted by the xydiff on the new model (get translated to insert+deletes)
 renamedIdParis: useful to track identity across rename; stores the mapping; used for deletes and moves
 pendingMoveDeletes + pendingMoveInserts: temporarily store candidates for inserts/deletes/moves (xydiff sometimes doesn't give the straight out information)
 editsByXid: tracks which kind of edits happened to a xid because xydiff emits compounded edits often
 */
export function createParseState() {
    return {
        operations: [],
        renamedNewIds: new Set(),
        renamedIdPairs: new Map(),
        pendingMoveDeletes: new Map(),
        pendingMoveInserts: new Map(),
        editsByXid: new Map()
    };
}
