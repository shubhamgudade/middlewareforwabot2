#!/usr/bin/env node
/**
 * deploy.js — creates the gif-middleware service on Render via API
 * Usage: node deploy.js <RENDER_API_KEY> <GITHUB_REPO_URL>
 * Example: node deploy.js rnd_xxxx https://github.com/you/gif-middleware
 */

const [,, RENDER_API_KEY, REPO_URL] = process.argv;

if (!RENDER_API_KEY || !REPO_URL) {
    console.error("Usage: node deploy.js <RENDER_API_KEY> <GITHUB_REPO_URL>");
    process.exit(1);
}

const RENDER_API = "https://api.render.com/v1";

const headers = {
    "Authorization": `Bearer ${RENDER_API_KEY}`,
    "Content-Type":  "application/json"
};

async function api(method, path, body) {
    const res = await fetch(`${RENDER_API}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) {
        console.error(`[Render API] ${method} ${path} failed:`, JSON.stringify(data, null, 2));
        process.exit(1);
    }
    return data;
}

async function deploy() {
    console.log("[deploy] fetching owner info...");
    const owners = await api("GET", "/owners?limit=1");
    const ownerId = owners[0]?.owner?.id;
    if (!ownerId) { console.error("No owner found"); process.exit(1); }
    console.log(`[deploy] owner: ${ownerId}`);

    console.log("[deploy] creating service...");
    const service = await api("POST", "/services", {
        type: "web_service",
        name: "gif-middleware",
        ownerId,
        repo: REPO_URL,
        branch: "main",
        runtime: "node",
        buildCommand: "npm install",
        startCommand: "node server.js",
        plan: "free",
        envVars: []
    });

    const serviceId  = service.service?.id;
    const serviceUrl = service.service?.serviceDetails?.url;

    console.log(`\n[deploy] service created`);
    console.log(`  ID:  ${serviceId}`);
    console.log(`  URL: ${serviceUrl || "(will be assigned after first deploy)"}`);
    console.log("\n[deploy] done. Render will now build and deploy.");
    console.log("[deploy] update MIDDLEWARE_URL in your bot .env once the URL is live.");
}

deploy().catch(err => {
    console.error("[deploy] fatal:", err.message);
    process.exit(1);
});
