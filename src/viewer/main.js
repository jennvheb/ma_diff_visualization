import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Preprocessor} from '../../cpeediff/src/io/Preprocessor.js';
import {CpeeDiff} from '../../cpeediff/src/diff/CpeeDiff.js';
import {DiffConfig} from '../../cpeediff/src/config/DiffConfig.js';
import {parseXyDiffToDelta} from "../integration/xyDiff/parseXyDiffToDelta.js";
import {runXyDiffBinary} from "../integration/xyDiff/runXyDiffBinary.js";
import {deltaXmlToOps} from "../integration/xyDiff/deltaXmlToOps.js";
import {editScriptToOps} from "../integration/cpeeDiff/editScriptToOps.js";


const args = new Map(
    process.argv.slice(2).map(a => {
        const [k, v] = a.split('=');
        return [k.replace(/^--/, '').toLowerCase(), v ?? ''];
    })
);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ALGO = (args.get('algo')).toLowerCase();

/**
 * TESTDATA
 */
//const OLD = args.get('old') ?? './testset/test2.xml'; //TODO i have no idea whats going on
//const NEW = args.get('new') ?? './testset/visualize_one_00.xml'; //TODO


//const OLD = args.get('old') ?? './testset/base.xml';
//const NEW = args.get('new') ?? './testset/base1.xml';

//const OLD = args.get('old') ?? './testset/test2_old.xml';
//const NEW = args.get('new') ?? './testset/test2_copya7clear_anddelete.xml';

//const OLD = args.get('old') ?? './testset/visualize_one_og.xml';
//const NEW = args.get('new') ?? './testset/visualize_one_og_gwupdate.xml';

const OLD = args.get('old') ?? './testset/visualize_one_premove.xml';
const NEW = args.get('new') ?? './testset/visualize_one_2ins_1del_1mov.xml'; //TODO check order, debug

//const NEW = args.get('new') ?? './testset/visualize_one_moved.xml';

//const OLD = args.get('old') ?? './testset/visualize_one_00.xml'
//const NEW = args.get('new') ?? './testset/visualize_one.xml'


//const OLD = args.get('old') ?? './testset/yxc.xml';
//const NEW = args.get('new') ?? './testset/onlylil.xml';


const rawPassthrough = (args.get('raw') ?? '').toLowerCase() === 'true' || args.has('raw');

const oldPath = path.resolve(__dirname, OLD);
const newPath = path.resolve(__dirname, NEW);

const requested = (args.get('anchors') ?? 'all')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const ALL = ['id', 'endpoint', 'label'];
DiffConfig.MATCH_ANCHORS =
    requested.length === 1 && requested[0] === 'all' ? ALL : requested;

DiffConfig.MATCH_MODE = args.get('mode') ?? 'balanced';
DiffConfig.PRETTY_XML = (args.get('pretty') ?? 'true') !== 'false';

(async () => {
    try {

        function writeViewerData({ oldTreeXml, newTreeXml, algo, ops }) {
            const out = `
                window.OLD_TREE = ${JSON.stringify(oldTreeXml)};
                window.NEW_TREE = ${JSON.stringify(newTreeXml)};
        
                window.DIFF_SOURCE = ${JSON.stringify(algo)};
        
                window.DIFF = ${JSON.stringify(ops ?? [])};
            `;
            fs.writeFileSync(path.resolve(__dirname, 'diff_data.js'), out, 'utf8');
        }


        if (ALGO === 'cpeediff') {
            const pre = new Preprocessor();
            const oldTree = pre.fromFile(oldPath);
            const newTree = pre.fromFile(newPath);
            const differ = new CpeeDiff();
            const editScript = differ.diff(oldTree, newTree);
            const editXml = editScript.toXmlString();

            const oldTreeXml = oldTree.toXmlString();
            const newTreeXml = newTree.toXmlString();

            const opsJson = editScriptToOps(editScript);


            writeViewerData({
                oldTreeXml,
                newTreeXml,
                algo: 'cpeediff',
                ops: opsJson
            });
            console.log(editXml);
            return;
        }



        if (ALGO === 'xydiff') {
            // Choose inputs for xydiff: raw files vs preprocessed XML for debugging

            let oldTreeXmlString, newTreeXmlString;
            if (rawPassthrough) {
                oldTreeXmlString = fs.readFileSync(oldPath, 'utf8');
                newTreeXmlString = fs.readFileSync(newPath, 'utf8');
            } else {
                const pre = new Preprocessor();
                const oldTree = pre.fromFile(oldPath);
                const newTree = pre.fromFile(newPath);
                oldTreeXmlString = oldTree.toXmlString();
                newTreeXmlString = newTree.toXmlString();

            }

            const binaryPath = path.resolve(__dirname, '../../xydiff-bin/xydiff');


            const { output, workDir, oldFile, newFile } = runXyDiffBinary({
                binaryPath,
                oldTreeXmlString,
                newTreeXmlString,
            });


            if (rawPassthrough) {
                console.log(output);
                writeViewerData({
                    oldTreeXml: oldTreeXmlString,
                    newTreeXml: newTreeXmlString,
                    algo: 'xydiff',
                    ops: []
                });

            } else {
                const deltaXml = parseXyDiffToDelta(output, workDir);
                const opsJson  = deltaXmlToOps(deltaXml);

                writeViewerData({
                    oldTreeXml: oldTreeXmlString,
                    newTreeXml: newTreeXmlString,
                    algo: 'xydiff',
                    ops: opsJson
                });

            }

            // Cleanup temp files after parsing/printing
            try {
                for (const f of [
                    oldFile,
                    newFile,
                    path.join(workDir, 'old.xml.xidmap'),
                    path.join(workDir, 'new.xml.xidmap'),
                ]) {
                    if (fs.existsSync(f)) fs.unlinkSync(f);
                }
            } catch {
            }

            return;
        }
        console.error(`Unknown --algo=${ALGO}`);
        process.exitCode = 1;
    } catch (err) {
        console.error('Diff failed:', err?.message ?? err);
        process.exitCode = 1;
    }
})();
