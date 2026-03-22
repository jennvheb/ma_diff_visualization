const {DOMParser, XMLSerializer} = await import("@xmldom/xmldom");
import {stampLogicalIds} from "../stableIds.js";
import fs from "fs";
import path from "node:path";
import {execFileSync} from "node:child_process";


export function findDslRoot(doc) {
    const NS = "http://cpee.org/ns/description/1.0";
    if (!doc?.documentElement) return null;

    let last = null;
    const stack = [doc.documentElement];
    while (stack.length) {
        const n = stack.pop();
        if (n?.nodeType !== 1) continue;

        if (n.localName === "description" && n.namespaceURI === NS) last = n;

        const kids = n.childNodes || [];
        for (let i = kids.length - 1; i >= 0; i--) {
            const c = kids[i];
            if (c?.nodeType === 1) stack.push(c);
        }
    }
    return last;
}

export function projectForXyDiff(xmlString) {
    const doc = new DOMParser().parseFromString(xmlString, "text/xml");
    const root = findDslRoot(doc) || doc.documentElement;

    // useful for real task ids and viewer consistency
    stampLogicalIds(root);

    return new XMLSerializer().serializeToString(doc);
}

export function loadDom(filePath) {
    const xml = fs.readFileSync(filePath, "utf8");
    return new DOMParser().parseFromString(xml, "text/xml");
}

export function runXyDiffBinary({ binaryPath, oldTreeXmlString, newTreeXmlString }) {
    const workDir = path.dirname(binaryPath);

    const oldFile     = path.join(workDir, "old.xml");
    const newFile     = path.join(workDir, "new.xml");
    const oldOrigFile = path.join(workDir, "old.orig.xml");
    const newOrigFile = path.join(workDir, "new.orig.xml");

    // cleanup old xidmaps
    for (const f of ["old.xml.xidmap", "new.xml.xidmap"]) {
        const p = path.join(workDir, f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // write originals
    fs.writeFileSync(oldOrigFile, oldTreeXmlString, "utf8");
    fs.writeFileSync(newOrigFile, newTreeXmlString, "utf8");

    // project + stabilize BEFORE diff
    let oldProj = projectForXyDiff(oldTreeXmlString);
    let newProj = projectForXyDiff(newTreeXmlString);


    // write projected inputs
    fs.writeFileSync(oldFile, oldProj, "utf8");
    fs.writeFileSync(newFile, newProj, "utf8");

    // run xydiff
    const output = execFileSync(binaryPath, [oldFile, newFile], {
        cwd: workDir,
        env: { ...process.env, DYLD_LIBRARY_PATH: workDir },
        encoding: "utf8",
    });

    return { output, workDir, oldFile, newFile, oldOrigFile, newOrigFile };
}
