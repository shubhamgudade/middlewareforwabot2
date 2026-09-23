import express from "express";
import fetch from "node-fetch";
import sharp from "sharp";


const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* ═══════════════════════════════════════════════
   STORE — sources + history
   ═══════════════════════════════════════════════ */

const SEARCH_QUERIES = [
    "youtube thumbnail meme",
    "instagram comments meme"
];

// Giphy account IDs or usernames added via +gpacc
const customAccounts = [];

// circular history — tracks last 50 gif IDs sent
const HISTORY_LIMIT = 50;
const sentHistory   = [];

function markSent(gifId) {
    if (sentHistory.includes(gifId)) return;
    sentHistory.push(gifId);
    if (sentHistory.length > HISTORY_LIMIT) sentHistory.shift();
}

function isRecentlySent(gifId) {
    return sentHistory.includes(gifId);
}

/* ═══════════════════════════════════════════════
   GIPHY FETCH
   ═══════════════════════════════════════════════ */

async function fetchGifFromQuery(apiKey, query) {
    const offset = Math.floor(Math.random() * 200);
    const url    = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=50&offset=${offset}&rating=pg-13`;
    const res    = await fetch(url);
    const data   = await res.json();
    return data.data || [];
}

async function fetchGifFromAccount(apiKey, username) {
    const url  = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=&username=${encodeURIComponent(username)}&limit=50&rating=pg-13`;
    const res  = await fetch(url);
    const data = await res.json();
    return data.data || [];
}

async function pickGif(apiKey) {
    // build pool of sources: queries + accounts
    const sources = [
        ...SEARCH_QUERIES.map(q => ({ type: "query", value: q })),
        ...customAccounts.map(a => ({ type: "account", value: a }))
    ];

    // shuffle sources, try until we find a non-repeated gif
    const shuffled = sources.sort(() => Math.random() - 0.5);

    for (const source of shuffled) {
        const gifs = source.type === "query"
            ? await fetchGifFromQuery(apiKey, source.value)
            : await fetchGifFromAccount(apiKey, source.value);

        // filter out recently sent
        const fresh = gifs.filter(g => !isRecentlySent(g.id));
        if (!fresh.length) continue;

        const picked = fresh[Math.floor(Math.random() * fresh.length)];
        return picked;
    }

    // all gifs recently sent — clear history and retry once
    sentHistory.length = 0;
    const fallback = await fetchGifFromQuery(apiKey, SEARCH_QUERIES[0]);
    return fallback[0] || null;
}

/* ═══════════════════════════════════════════════
   IMAGE PROCESSING
   ═══════════════════════════════════════════════ */

async function fetchAndConvert(gifUrl) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 15000);
    try {
        const res    = await fetch(gifUrl, { signal: controller.signal });
        const buffer = Buffer.from(await res.arrayBuffer());
        // convert to WebP — good quality, small size
        return await sharp(buffer, { animated: false })
            .jpeg({ quality: 80 })
            .toBuffer();
    } finally {
        clearTimeout(timer);
    }
}

/* ═══════════════════════════════════════════════
   ROUTES
   ═══════════════════════════════════════════════ */

// GET /gif
// Header: Authorization: Bearer <GIPHY_API_KEY>
app.get("/gif", async (req, res) => {
    const auth = req.headers["authorization"] || "";
    const apiKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

    if (!apiKey) return res.status(401).json({ error: "Missing API key" });

    try {
        const gif = await pickGif(apiKey);
        if (!gif) return res.status(404).json({ error: "No gif found" });

        const gifUrl = gif.images?.downsized?.url || gif.images?.original?.url;
        if (!gifUrl) return res.status(404).json({ error: "No gif URL" });

        console.log(`[/gif] fetching: ${gifUrl}`);
        let jpegBuffer;
        try {
            jpegBuffer = await fetchAndConvert(gifUrl);
        } catch (convErr) {
            console.error("[/gif] convert error:", convErr.message);
            return res.status(500).json({ error: "Convert failed", detail: convErr.message });
        }
        markSent(gif.id);

        res.set("Content-Type", "image/jpeg");
        res.send(jpegBuffer);

    } catch (err) {
        console.error("[/gif]", err.message);
        res.status(500).json({ error: "Failed to fetch gif", detail: err.message });
    }
});

// POST /accounts
// body: { "account": "giphy_username_or_channel" }
app.post("/accounts", (req, res) => {
    const { account } = req.body;
    if (!account || typeof account !== "string") {
        return res.status(400).json({ error: "account field required" });
    }
    // extract username from Giphy URL if full link passed
    let username = account.trim();
    const match  = username.match(/giphy\.com\/(?:channel\/|@)?([^/?#]+)/i);
    if (match) username = match[1];

    if (customAccounts.includes(username)) {
        return res.json({ message: "already exists", account: username });
    }
    customAccounts.push(username);
    console.log(`[accounts] added: ${username}`);
    res.json({ message: "added", account: username });
});

// GET /accounts
app.get("/accounts", (req, res) => {
    res.json({ accounts: customAccounts });
});

// GET /health
app.get("/health", (req, res) => {
    res.json({
        status:   "ok",
        sources:  SEARCH_QUERIES.length + customAccounts.length,
        history:  sentHistory.length
    });
});

app.listen(PORT, () => console.log(`[middleware] ready on :${PORT}`));
