import http from "node:http";
import {computeDiffState} from "../run/computeDiffState.js";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = http.createServer(async (req, res) => {
    //cors headers for browser access from localhost
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // handle preflight
    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method !== "POST" || req.url !== "/api/recompute-diff") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain");
        res.end("Not found");
        return;
    }

    let body = "";
    req.on("data", chunk => {
        body += chunk;
    });

    req.on("end", async () => {
        try {
            const payload = JSON.parse(body);

            const result = await computeDiffState({
                algo: payload.algo,
                oldXmlString: payload.oldXml,
                newXmlString: payload.newXml,
                rawPassthrough: !!payload.rawPassthrough,
                anchors: payload.anchors || ["id", "endpoint", "label"],
                mode: payload.mode || "balanced",
                pretty: true,
                xydiffBinaryPath: payload.xydiffBinaryPath || path.resolve(__dirname, "../../xydiff-bin/xydiff")
            });

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
                ok: true,
                result
            }));
        } catch (err) {
            console.error("[recompute-server] error", err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
                ok: false,
                error: err?.message || String(err)
            }));
        }
    });
});

server.listen(8787, () => {
    console.log("recompute server listening on http://localhost:8787");
});