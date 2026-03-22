import path from "node:path";
const {XMLSerializer} = await import("@xmldom/xmldom");
import {buildDrawableIndexById} from "../dom/signatures.js";
import {loadXidMapExpr, buildXidIndexFromXidMap} from "../xid/xidMap.js";
import {findDslRoot, loadDom} from "../runXyDiffBinary.js";

// build the lookup context needed for later parsing: map node to xid and id and corresponding dom node, locate node in old vs. new
// acts as reference data
export function buildParseContext(workDir) {
    const oldDom = loadDom(path.join(workDir, "old.xml"));
    const newDom = loadDom(path.join(workDir, "new.xml"));

    const baseOld = findDslRoot(oldDom) || oldDom.documentElement;
    const baseNew = findDslRoot(newDom) || newDom.documentElement;

    const oldXidMapExpr = loadXidMapExpr(path.join(workDir, "old.xml.xidmap"));
    const newXidMapExpr = loadXidMapExpr(path.join(workDir, "new.xml.xidmap"));

    const oldXidIndex = buildXidIndexFromXidMap(oldDom, oldXidMapExpr);
    const newXidIndex = buildXidIndexFromXidMap(newDom, newXidMapExpr);

    return {
        workDir,
        oldDom,
        newDom,
        baseOld,
        baseNew,
        oldXidIndex,
        newXidIndex,
        oldDrawablesById: buildDrawableIndexById(baseOld),
        newDrawablesById: buildDrawableIndexById(baseNew),
        serializer: new XMLSerializer()
    };
}
