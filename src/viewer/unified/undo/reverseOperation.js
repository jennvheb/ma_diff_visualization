import {
    parseXml,
    serializeXml,
    getDslRoot,
    getParentPath,
    getLastPathIndex,
    cloneIntoDoc,
    replaceElement,
    removeElement,
    insertElementAt, resolveNodeRobust
} from "./xmlPatchUtils.js";
import {stampLogicalIds} from "../../../integration/stableIds.js";

function allElementsWithId(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll?.("*[id]") || []);
}

function resolveClosestExistingAncestor(root, path) {
    if (!root || !path) return null;

    const segs = String(path).split("/").filter(Boolean);

    while (segs.length) {
        const candidate = "/" + segs.join("/");
        const el = resolveElementByNumericPath(root, candidate);
        if (el) return el;
        segs.pop();
    }

    return root;
}

function pruneCloneDescendantsAlreadyPresent(cloneRoot, currentNewRoot) {
    if (!cloneRoot || !currentNewRoot) return;

    const descendants = allElementsWithId(cloneRoot);

    for (const el of descendants) {
        // do not prune the root element of the restored subtree itself
        if (el === cloneRoot) continue;

        const id = el.getAttribute("id");
        if (!id) continue;

        // if that id already exists somewhere in current NEW, this descendant has survived/moved elsewhere already
        const existing = findElementByIdAnywhere(currentNewRoot, id);
        if (existing) {
            el.parentNode?.removeChild(el);
        }
    }
}

function reverseInsert({ currentNewXml, op }) {
    const newDoc = parseXml(currentNewXml);
    const newRoot = getDslRoot(newDoc);

    if (!newRoot) {
        throw new Error("reverseInsert: missing DSL root");
    }

    // stamped lookup copy only
    const newLookup = newRoot.cloneNode(true);
    stampLogicalIds(newLookup);

    // resolve the inserted node in the stamped lookup tree
    const targetLookup = resolveNodeRobust(newLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidNew || op.sidOld,
        canonicalPath: op.newPath,
        rebasedPath: op.rebasedNewPath
    });

    if (!targetLookup) {
        throw new Error(
            `reverseInsert: could not find inserted node in lookup tree (${op.sidNew || op.sidOld || op.rebasedNewPath || op.newPath})`
        );
    }

    // map lookup node back to the corresponding real node
    const targetReal = findRealNodeByLookupNode(newRoot, newLookup, targetLookup);

    if (!targetReal) {
        throw new Error(
            `reverseInsert: could not resolve inserted node in real NEW tree (${op.sidNew || op.sidOld || op.rebasedNewPath || op.newPath})`
        );
    }

    removeElement(targetReal);
    return serializeXml(newDoc);
}

function childElements(node) {
    return Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
}

function findElementByIdAnywhere(root, id) {
    if (!root || !id) return null;
    return root.querySelector?.(`*[id="${CSS.escape(id)}"]`) || null;
}

function findAnchorByOldSiblings(oldParentLookup, sourceOldLookup, newLookup, newRoot) {
    const oldKids = childElements(oldParentLookup);
    const oldIndex = oldKids.indexOf(sourceOldLookup);
    if (oldIndex < 0) return null;

    // try next sibling first
    for (let i = oldIndex + 1; i < oldKids.length; i++) {
        const sib = oldKids[i];
        const sibId = sib.getAttribute?.("id");
        if (!sibId) continue;

        const lookupMatch = findElementByIdAnywhere(newLookup, sibId);
        if (!lookupMatch) continue;

        const realMatch = findElementByIdAnywhere(newRoot, sibId);
        if (!realMatch || !realMatch.parentNode) continue;

        return {
            mode: "before",
            ref: realMatch,
            parent: realMatch.parentNode
        };
    }

    // then previous sibling
    for (let i = oldIndex - 1; i >= 0; i--) {
        const sib = oldKids[i];
        const sibId = sib.getAttribute?.("id");
        if (!sibId) continue;

        const lookupMatch = findElementByIdAnywhere(newLookup, sibId);
        if (!lookupMatch) continue;

        const realMatch = findElementByIdAnywhere(newRoot, sibId);
        if (!realMatch || !realMatch.parentNode) continue;

        return {
            mode: "after",
            ref: realMatch,
            parent: realMatch.parentNode
        };
    }

    return null;
}

function findAnchorByOldSiblingsExcludingSelf(oldParentLookup, sourceOldLookup, newLookup, newRoot, selfId) {
    const oldKids = childElements(oldParentLookup);
    const oldIndex = oldKids.indexOf(sourceOldLookup);
    if (oldIndex < 0) return null;

    // try next sibling first
    for (let i = oldIndex + 1; i < oldKids.length; i++) {
        const sib = oldKids[i];
        const sibId = sib.getAttribute?.("id");
        if (!sibId || sibId === selfId) continue;

        const lookupMatch = findElementByIdAnywhere(newLookup, sibId);
        if (!lookupMatch) continue;

        const realMatch = findElementByIdAnywhere(newRoot, sibId);
        if (!realMatch || !realMatch.parentNode) continue;

        return {
            mode: "before",
            ref: realMatch,
            parent: realMatch.parentNode
        };
    }

    // then previous sibling
    for (let i = oldIndex - 1; i >= 0; i--) {
        const sib = oldKids[i];
        const sibId = sib.getAttribute?.("id");
        if (!sibId || sibId === selfId) continue;

        const lookupMatch = findElementByIdAnywhere(newLookup, sibId);
        if (!lookupMatch) continue;

        const realMatch = findElementByIdAnywhere(newRoot, sibId);
        if (!realMatch || !realMatch.parentNode) continue;

        return {
            mode: "after",
            ref: realMatch,
            parent: realMatch.parentNode
        };
    }

    return null;
}

function reverseMove({ baselineOldXml, currentNewXml, op }) {
    const oldDoc = parseXml(baselineOldXml);
    const newDoc = parseXml(currentNewXml);

    const oldRoot = getDslRoot(oldDoc);
    const newRoot = getDslRoot(newDoc);

    if (!oldRoot || !newRoot) {
        throw new Error("reverseMove: missing DSL root");
    }

    const oldLookup = oldRoot.cloneNode(true);
    const newLookup = newRoot.cloneNode(true);
    stampLogicalIds(oldLookup);
    stampLogicalIds(newLookup);

    const sourceOldLookup = resolveNodeRobust(oldLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidOld,
        canonicalPath: op.oldPath,
        rebasedPath: op.rebasedOldPath
    });

    if (!sourceOldLookup) {
        throw new Error(
            `reverseMove: could not find old source node in lookup tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }

    const sourceOldReal = findRealNodeByLookupNode(oldRoot, oldLookup, sourceOldLookup);

    if (!sourceOldReal) {
        throw new Error(
            `reverseMove: could not map old source node to real OLD tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }

    const targetNewLookup = resolveNodeRobust(newLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidNew || op.sidOld,
        canonicalPath: op.newPath,
        rebasedPath: op.rebasedNewPath
    });

    if (!targetNewLookup) {
        throw new Error(
            `reverseMove: could not find moved node in NEW lookup tree (${op.sidNew || op.sidOld || op.rebasedNewPath || op.newPath})`
        );
    }

    const targetNewReal = findRealNodeByLookupNode(newRoot, newLookup, targetNewLookup);

    if (!targetNewReal) {
        throw new Error(
            `reverseMove: could not find moved node in real NEW tree (${op.sidNew || op.sidOld})`
        );
    }

    const oldParentLookup = sourceOldLookup.parentNode;
    if (!oldParentLookup || oldParentLookup.nodeType !== 1) {
        throw new Error("reverseMove: old parent missing");
    }

    const restored = cloneIntoDoc(sourceOldReal, newDoc);

    // remove current moved node first
    if (targetNewReal.parentNode) {
        targetNewReal.parentNode.removeChild(targetNewReal);
    }
    if (op.realizeParentPath) {
        const parent = resolveElementByNumericPath(newRoot, op.realizeParentPath);

        if (parent) {
            const before = op.realizeBeforeId
                ? findElementByIdAnywhere(parent, op.realizeBeforeId)
                : null;

            const after = op.realizeAfterId
                ? findElementByIdAnywhere(parent, op.realizeAfterId)
                : null;

            if (before && before.parentNode === parent) {
                parent.insertBefore(restored, before);
                return serializeXml(newDoc);
            }

            if (after && after.parentNode === parent) {
                if (after.nextSibling) parent.insertBefore(restored, after.nextSibling);
                else parent.appendChild(restored);
                return serializeXml(newDoc);
            }

            insertElementAt(parent, restored, op.realizeIndex);
            return serializeXml(newDoc);
        }
    }    // place restored clone by OLD sibling anchors
    const newLookupAfterRemoval = newRoot.cloneNode(true);
    stampLogicalIds(newLookupAfterRemoval);

    const anchor = findAnchorByOldSiblingsExcludingSelf(
        oldParentLookup,
        sourceOldLookup,
        newLookupAfterRemoval,
        newRoot,
        op.sidOld || op.sidNew || op.selfOldId || null
    );

    if (anchor?.mode === "before" && anchor.ref && anchor.parent) {
        anchor.parent.insertBefore(restored, anchor.ref);
        return serializeXml(newDoc);
    }

    if (anchor?.mode === "after" && anchor.ref && anchor.parent) {
        if (anchor.ref.nextSibling) {
            anchor.parent.insertBefore(restored, anchor.ref.nextSibling);
        } else {
            anchor.parent.appendChild(restored);
        }
        return serializeXml(newDoc);
    }

    // fallback: old parent path, then closest existing ancestor
    const oldParentPath = indexPathFromAncestor(oldLookup, oldParentLookup);
    let targetParent =
        oldParentPath ? resolveElementByNumericPath(newRoot, oldParentPath) : null;

    if (!targetParent) {
        targetParent = resolveClosestExistingAncestor(newRoot, oldParentPath);
    }


    const oldIndex = childElements(oldParentLookup).indexOf(sourceOldLookup);
    insertElementAt(targetParent, restored, (oldIndex >= 0 ? oldIndex : 0) + 1);

    return serializeXml(newDoc);
}

function elementChildren(node) {
    return Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
}

function resolveElementByNumericPath(root, path) {
    if (!root || !path) return null;
    const segs = String(path).split("/").filter(Boolean).map(Number);

    let cur = root;
    for (const seg of segs) {
        const kids = elementChildren(cur);
        cur = kids[seg] || null;
        if (!cur) return null;
    }
    return cur;
}

function indexPathFromAncestor(root, node) {
    if (!root || !node) return null;
    if (root === node) return "/";

    const segs = [];
    let cur = node;

    while (cur && cur !== root) {
        const parent = cur.parentNode;
        if (!parent || parent.nodeType !== 1) return null;

        const kids = elementChildren(parent);
        const idx = kids.indexOf(cur);
        if (idx < 0) return null;

        segs.push(idx);
        cur = parent;
    }

    if (cur !== root) return null;
    return "/" + segs.reverse().join("/");
}

function findRealNodeByLookupNode(realRoot, lookupRoot, lookupNode) {
    const p = indexPathFromAncestor(lookupRoot, lookupNode);
    if (!p) return null;
    return resolveElementByNumericPath(realRoot, p);
}

function reverseDelete({ baselineOldXml, currentNewXml, op }) {
    const oldDoc = parseXml(baselineOldXml);
    const newDoc = parseXml(currentNewXml);

    const oldRoot = getDslRoot(oldDoc);
    const newRoot = getDslRoot(newDoc);

    if (!oldRoot || !newRoot) {
        throw new Error("reverseDelete: missing DSL root");
    }

    // stamped lookup copies only
    const oldLookup = oldRoot.cloneNode(true);
    const newLookup = newRoot.cloneNode(true);
    stampLogicalIds(oldLookup);
    stampLogicalIds(newLookup);

    // find deleted node in stamped OLD lookup tree
    const sourceOldLookup = resolveNodeRobust(oldLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidOld,
        canonicalPath: op.oldPath,
        rebasedPath: op.rebasedOldPath
    });

    if (!sourceOldLookup) {
        throw new Error(
            `reverseDelete: could not find old source node in lookup tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }

    // map that exact lookup node to the real OLD tree
    const sourceOldReal = findRealNodeByLookupNode(oldRoot, oldLookup, sourceOldLookup);

    if (!sourceOldReal) {
        throw new Error(
            `reverseDelete: could not map old lookup node to real OLD tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }

    const oldParentLookup = sourceOldLookup.parentNode;
    if (!oldParentLookup || oldParentLookup.nodeType !== 1) {
        throw new Error("reverseDelete: source old parent missing");
    }

    const clone = cloneIntoDoc(sourceOldReal, newDoc);
    pruneCloneDescendantsAlreadyPresent(clone, newRoot);

    if (op.realizeParentPath && Number.isInteger(op.realizeIndex)) {
        const parent = resolveElementByNumericPath(newRoot, op.realizeParentPath);

        console.log("[reverseDelete realize slot]", {
            parentPath: op.realizeParentPath,
            realizeIndex: op.realizeIndex,
            parentTag: parent?.tagName,
            childIds: Array.from(parent?.children || []).map(
                c => c.getAttribute("id") || c.tagName
            )
        });

        if (parent) {
            insertElementAt(parent, clone, op.realizeIndex);
            return serializeXml(newDoc);
        }
    }

    console.log("[reverseDelete] op", op);
    console.log("[reverseDelete] sourceOld tag/id",
        sourceOldReal?.tagName,
        sourceOldReal?.getAttribute?.("id"));
    console.log("[reverseDelete] old parent tag/id",
        oldParentLookup?.tagName,
        oldParentLookup?.getAttribute?.("id"));

    // anchor relative to OLD siblings, but insert into current NEW
    const anchor = findAnchorByOldSiblings(oldParentLookup, sourceOldLookup, newLookup, newRoot);

    console.log("[reverseDelete] anchor", anchor ? {
        mode: anchor.mode,
        refTag: anchor.ref?.tagName || null,
        refId: anchor.ref?.getAttribute?.("id") || null,
        parentTag: anchor.parent?.tagName || null,
        parentId: anchor.parent?.getAttribute?.("id") || null
    } : null);

    if (anchor?.mode === "before" && anchor.ref && anchor.parent) {
        anchor.parent.insertBefore(clone, anchor.ref);
        return serializeXml(newDoc);
    }

    if (anchor?.mode === "after" && anchor.ref && anchor.parent) {
        if (anchor.ref.nextSibling) {
            anchor.parent.insertBefore(clone, anchor.ref.nextSibling);
        } else {
            anchor.parent.appendChild(clone);
        }
        return serializeXml(newDoc);
    }

    if (op.realizeReplacesPath) {
        const parentPath = getParentPath(op.realizeReplacesPath);
        const index = getLastPathIndex(op.realizeReplacesPath);
        const parent = parentPath ? resolveElementByNumericPath(newRoot, parentPath) : null;

        console.log("[reverseDelete replace slot]", {
            realizeReplacesPath: op.realizeReplacesPath,
            parentPath,
            index,
            parentTag: parent?.tagName,
            childIds: Array.from(parent?.children || []).map(
                c => c.getAttribute("id") || c.tagName
            )
        });

        if (parent && Number.isInteger(index)) {
            const kids = Array.from(parent.children || []);
            const ref = kids[index] || null;

            if (ref) parent.insertBefore(clone, ref);
            else parent.appendChild(clone);
            return serializeXml(newDoc);
        }
    }


    // fallback: restore under closest surviving ancestor
    const oldParentRealPath = indexPathFromAncestor(oldLookup, oldParentLookup);

    let targetParent =
        oldParentRealPath
            ? resolveElementByNumericPath(newRoot, oldParentRealPath)
            : null;

    if (!targetParent) {
        targetParent = resolveClosestExistingAncestor(
            newRoot,
            oldParentRealPath
        );
    }

    if (!targetParent) {
        targetParent = newRoot;
    }

    const oldKids = childElements(oldParentLookup);
    const sourceIndex = oldKids.indexOf(sourceOldLookup);

    insertElementAt(
        targetParent,
        clone,
        (sourceIndex >= 0 ? sourceIndex : 0) + 1
    );

    return serializeXml(newDoc);
}

function copyAttributesFromOldToNew(sourceOldReal, targetNewReal) {
    if (!sourceOldReal || !targetNewReal) return;

    const oldAttrs = new Map(
        Array.from(sourceOldReal.attributes || []).map(a => [a.name, a.value])
    );
    const newAttrNames = Array.from(targetNewReal.attributes || []).map(a => a.name);

    for (const name of newAttrNames) {
        if (!oldAttrs.has(name)) {
            targetNewReal.removeAttribute(name);
        }
    }

    for (const [name, value] of oldAttrs.entries()) {
        targetNewReal.setAttribute(name, value);
    }
}
function diffIds(newIds = [], oldIds = []) {
    const oldSet = new Set(oldIds || []);
    return (newIds || []).filter(id => id && !oldSet.has(id));
}
function reverseUpdate({ baselineOldXml, currentNewXml, op }) {
    const oldDoc = parseXml(baselineOldXml);
    const newDoc = parseXml(currentNewXml);

    const oldRoot = getDslRoot(oldDoc);
    const newRoot = getDslRoot(newDoc);

    if (!oldRoot || !newRoot) {
        throw new Error("reverseUpdate: missing DSL root");
    }

    // stamped lookup trees only
    const oldLookup = oldRoot.cloneNode(true);
    const newLookup = newRoot.cloneNode(true);
    stampLogicalIds(oldLookup);
    stampLogicalIds(newLookup);

    // OLD lookup node
    const sourceOldLookup = resolveNodeRobust(oldLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidOld,
        canonicalPath: op.oldPath,
        rebasedPath: op.rebasedOldPath
    });

    if (!sourceOldLookup) {
        throw new Error(
            `reverseUpdate: could not find old source node in lookup tree (${op.sidOld || op.rebasedOldPath || op.oldPath})`
        );
    }

    let targetNewLookup = resolveNodeRobust(newLookup, {
        realId: op.id || op.selfOldId,
        sid: op.sidNew || op.sidOld,
        canonicalPath: op.newPath,
        rebasedPath: op.rebasedNewPath
    });

    // final fallback: use the structural position of the OLD lookup node
    // and recover the corresponding node in current NEW
    if (!targetNewLookup) {
        const oldLookupPath = indexPathFromAncestor(oldLookup, sourceOldLookup);
        if (oldLookupPath) {
            const candidate = resolveElementByNumericPath(newLookup, oldLookupPath);

            // only accept if it still looks like the same kind of node
            if (
                candidate &&
                (!op.contentNew?.tag || candidate.localName === op.contentNew.tag) &&
                (!op.contentOld?.tag || candidate.localName === op.contentOld.tag)
            ) {
                targetNewLookup = candidate;
            }
        }
    }


    if (!targetNewLookup) {
        throw new Error(
            `reverseUpdate: could not find target node in NEW lookup tree (${op.sidNew || op.rebasedNewPath || op.newPath || "no-new-target"})`
        );
    }

    // map lookup nodes to real nodes
    const oldRealPath = indexPathFromAncestor(oldLookup, sourceOldLookup);
    const newRealPath = indexPathFromAncestor(newLookup, targetNewLookup);

    if (!oldRealPath) {
        throw new Error("reverseUpdate: could not derive real OLD path from lookup node");
    }

    if (!newRealPath) {
        throw new Error("reverseUpdate: could not derive real NEW path from lookup node");
    }

    const sourceOldReal = resolveElementByNumericPath(oldRoot, oldRealPath);
    const targetNewReal = resolveElementByNumericPath(newRoot, newRealPath);

    if (!sourceOldReal) {
        throw new Error(
            `reverseUpdate: could not find old source node in real OLD tree (${oldRealPath})`
        );
    }

    if (!targetNewReal) {
        throw new Error(
            `reverseUpdate: could not find target node in real NEW tree (${newRealPath})`
        );
    }

    // hard guard: must still be the same kind of node
    if (op.contentOld?.tag && sourceOldReal.localName !== op.contentOld.tag) {
        throw new Error(
            `reverseUpdate: OLD tag mismatch (expected ${op.contentOld.tag}, got ${sourceOldReal.localName})`
        );
    }

    if (op.contentNew?.tag && targetNewReal.localName !== op.contentNew.tag) {
        throw new Error(
            `reverseUpdate: NEW tag mismatch (expected ${op.contentNew.tag}, got ${targetNewReal.localName})`
        );
    }

    console.log("reverseUpdate resolved", {
        sidOld: op.sidOld || null,
        sidNew: op.sidNew || null,
        lookupOldPath: op.oldPath || op.rebasedOldPath || null,
        lookupNewPath:  op.newPath || op.rebasedNewPath || null,
       // lookupOldPath: op.rebasedOldPath || op.oldPath || null,
       // lookupNewPath: op.rebasedNewPath || op.newPath || null,
        oldRealPath,
        newRealPath,
        oldTag: sourceOldReal.localName,
        newTag: targetNewReal.localName,
        oldId: sourceOldReal.getAttribute?.("id") || null,
        newId: targetNewReal.getAttribute?.("id") || null
    });

    const attrChanges = op?.contentDiff?.attrChanges || [];
    const textChanged = !!op?.contentDiff?.textChanged;
    const childTagsChanged = !!op?.contentDiff?.childTagsChanged;

    const oldHasElementChildren = elementChildren(sourceOldReal).length > 0;
    const newHasElementChildren = elementChildren(targetNewReal).length > 0;

    const isPureRootAttrUpdate =
        attrChanges.length > 0 &&
        !textChanged &&
        !childTagsChanged;

    const isTrueTextOnlyNode =
        textChanged &&
        !childTagsChanged &&
        !oldHasElementChildren &&
        !newHasElementChildren;
    const extraNewIds = diffIds(op.subtreeIdsNew, op.subtreeIdsOld);

    // descendants that exist in NEW but not in OLD, these may be moved-in or otherwise independently surviving nodes
    const hasForeignLiveDescendants = extraNewIds.length > 0;
    if (isPureRootAttrUpdate) {
        copyAttributesFromOldToNew(sourceOldReal, targetNewReal);
        return serializeXml(newDoc);
    }

    if (isTrueTextOnlyNode) {
        targetNewReal.textContent = sourceOldReal.textContent || "";
        return serializeXml(newDoc);
    }

    // If NEW contains extra descendants that are not part of OLD, do NOT replace the whole subtree, because that would delete moved-in children
    if (hasForeignLiveDescendants) {
        copyAttributesFromOldToNew(sourceOldReal, targetNewReal);
        return serializeXml(newDoc);
    }

    const replacement = cloneIntoDoc(sourceOldReal, newDoc);

    if (!replacement) {
        throw new Error("reverseUpdate: could not clone old node for replacement");
    }

    replaceElement(targetNewReal, replacement);
    return serializeXml(newDoc);
}

export function reverseOperations({ baselineOldXml, currentNewXml, ops }) {
    let xml = currentNewXml;

    for (const op of ops) {
        xml = reverseOperation({
            baselineOldXml,
            currentNewXml: xml,
            op
        });
    }

    return xml;
}
export function reverseOperation({ baselineOldXml, currentNewXml, op }) {
    if (!op?.type) {
        throw new Error("reverseOperation: missing op.type");
    }
    console.log("reverseOperation type =", op?.type, "op =", JSON.stringify(op, null, 2));

    switch (op.type) {
        case "insert":
            return reverseInsert({ currentNewXml, op });

        case "delete":
            return reverseDelete({ baselineOldXml, currentNewXml, op });

        case "update":
            return reverseUpdate({ baselineOldXml, currentNewXml, op });

        case "move":
            return reverseMove({ baselineOldXml, currentNewXml, op });

        default:
            throw new Error(`reverseOperation: unsupported op type for now: ${op.type}`);
    }
}