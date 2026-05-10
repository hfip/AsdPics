const https = require("https");
const http = require("http");

const BASE = "https://arabseed.ink";
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Accept-Language": "ar,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

const MANIFEST = {
    id: "community.arabseed.abdulluhx",
    version: "1.0.0",
    name: "ArabSeed by Abdulluh.X",
    description: "افلام ومسلسلات عربية من عرب سيد",
    logo: "https://arabseed.ink/wp-content/uploads/2023/01/arabseed-logo.png",
    resources: ["stream"],
    types: ["movie", "series"],
    catalogs: [],
    idPrefixes: ["tt"]
};

function fetchText(url, headers) {
    return new Promise((resolve) => {
        const client = url.startsWith("https") ? https : http;
        const timer = setTimeout(() => resolve(""), 10000);
        try {
            const req = client.get(url, {
                headers: Object.assign({}, HEADERS, headers || {})
            }, (res) => {
                const chunks = [];
                res.on("data", c => chunks.push(c));
                res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf-8")); });
            });
            req.on("error", () => { clearTimeout(timer); resolve(""); });
        } catch (e) { clearTimeout(timer); resolve(""); }
    });
}

function postData(url, body, headers) {
    return new Promise((resolve) => {
        const bodyStr = typeof body === "string" ? body : new URLSearchParams(body).toString();
        const urlObj = new URL(url);
        const timer = setTimeout(() => resolve(""), 10000);
        try {
            const req = https.request({
                hostname: urlObj.hostname,
                path: urlObj.pathname,
                method: "POST",
                headers: Object.assign({}, HEADERS, {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Content-Length": Buffer.byteLength(bodyStr),
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": BASE
                }, headers || {})
            }, (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => { clearTimeout(timer); resolve(data); });
            });
            req.on("error", () => { clearTimeout(timer); resolve(""); });
            req.write(bodyStr);
            req.end();
        } catch (e) { clearTimeout(timer); resolve(""); }
    });
}

function fetchJson(url) {
    return new Promise((resolve) => {
        const client = url.startsWith("https") ? https : http;
        const timer = setTimeout(() => resolve({}), 8000);
        try {
            const req = client.get(url, {
                headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
            }, (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => { clearTimeout(timer); try { resolve(JSON.parse(data)); } catch (e) { resolve({}); } });
            });
            req.on("error", () => { clearTimeout(timer); resolve({}); });
        } catch (e) { clearTimeout(timer); resolve({}); }
    });
}

async function getTmdbMeta(imdbId, type) {
    const data = await fetchJson(
        "https://api.themoviedb.org/3/find/" + imdbId +
        "?api_key=" + TMDB_KEY + "&external_source=imdb_id"
    );
    const results = type === "movie" ? data.movie_results : data.tv_results;
    if (!results || results.length === 0) return null;
    const item = results[0];
    const arData = await fetchJson(
        "https://api.themoviedb.org/3/" + (type === "movie" ? "movie" : "tv") + "/" +
        item.id + "?api_key=" + TMDB_KEY + "&language=ar-SA"
    );
    return {
        arabicTitle: arData.title || arData.name || item.title || item.name || "",
        year: (arData.release_date || arData.first_air_date || "").split("-")[0]
    };
}

async function searchArabSeed(title, type) {
    const html = await fetchText(BASE + "/?s=" + encodeURIComponent(title));
    if (!html) return null;

    const typeStr = type === "movie" ? "movies" : "series";
    const linkPattern = new RegExp('href="(' + BASE.replace(/\./g, "\\.") + '/' + typeStr + '/[^"]+)"', "gi");
    let m;
    while ((m = linkPattern.exec(html)) !== null) {
        return m[1];
    }

    // جرب أي رابط
    const anyPattern = new RegExp('href="(' + BASE.replace(/\./g, "\\.") + '/(?:movies|series)/[^"]+)"', "gi");
    while ((m = anyPattern.exec(html)) !== null) {
        return m[1];
    }

    return null;
}

async function getEpisodePage(seriesUrl, season, episode) {
    const html = await fetchText(seriesUrl);
    if (!html) return null;

    // ابحث عن رابط الحلقة
    const epPattern = /href="([^"]+)"[^>]*>[^<]*(?:الحلقة|episode)[^<]*<\/a>/gi;
    let m;
    const episodes = [];
    while ((m = epPattern.exec(html)) !== null) {
        episodes.push(m[1]);
    }

    if (episodes.length === 0) return seriesUrl;

    // رجّع الحلقة المطلوبة
    if (episode <= episodes.length) return episodes[episode - 1];
    return episodes[0];
}

async function extractStreamsFromPage(pageUrl, watchReferer) {
    const html = await fetchText(pageUrl, { "Referer": watchReferer || BASE });
    if (!html) return [];

    // استخرج CSRF token
    const csrfMatch = html.match(/'csrf__token':\s*"([^"]+)"/);
    if (!csrfMatch) {
        console.log("[ArabSeed] No CSRF token found");
        return [];
    }
    const csrfToken = csrfMatch[1];

    // استخرج post_id
    const postIdMatch = html.match(/data-post="(\d+)"/);
    if (!postIdMatch) {
        console.log("[ArabSeed] No post_id found");
        return [];
    }
    const postId = postIdMatch[1];

    console.log("[ArabSeed] postId: " + postId + " csrf: " + csrfToken.substring(0, 10) + "...");

    // استخرج الجودات المتاحة
    const qualities = [];
    const qualPattern = /data-quality="([^"]+)"/g;
    let qm;
    while ((qm = qualPattern.exec(html)) !== null) {
        if (!qualities.includes(qm[1])) qualities.push(qm[1]);
    }

    if (qualities.length === 0) qualities.push("1080p");

    const streams = [];
    const seen = new Set();

    for (const quality of qualities.slice(0, 3)) {
        try {
            // جيب السيرفرات
            const serversHtml = await postData(BASE + "/get__quality__servers/", {
                post_id: postId,
                quality: quality,
                csrf_token: csrfToken
            }, { "Referer": pageUrl });

            if (!serversHtml) continue;

            const serverIds = [];
            const srvPattern = /data-server="([^"]+)"/g;
            let sm;
            while ((sm = srvPattern.exec(serversHtml)) !== null) {
                if (!serverIds.includes(sm[1])) serverIds.push(sm[1]);
            }

            for (const serverId of serverIds.slice(0, 4)) {
                try {
                    const serverResp = await postData(BASE + "/get__watch__server/", {
                        post_id: postId,
                        quality: quality,
                        server: serverId,
                        csrf_token: csrfToken
                    }, { "Referer": pageUrl });

                    if (!serverResp) continue;

                    let parsed = {};
                    try { parsed = JSON.parse(serverResp); } catch (e) { continue; }

                    const iframeUrl = parsed.server || parsed.url || parsed.link || "";
                    if (!iframeUrl || seen.has(iframeUrl)) continue;
                    seen.add(iframeUrl);

                    // استخرج رابط الفيديو من الـ iframe
                    const iframeHtml = await fetchText(iframeUrl, { "Referer": pageUrl });
                    if (!iframeHtml) continue;

                    // m3u8
                    const m3u8 = iframeHtml.match(/(?:file|src|source)\s*:\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i);
                    if (m3u8 && !seen.has(m3u8[1])) {
                        seen.add(m3u8[1]);
                        streams.push({
                            name: "ArabSeed by Abdulluh.X",
                            title: quality + " | عرب سيد",
                            url: m3u8[1],
                            behaviorHints: { notWebReady: false, headers: { "Referer": iframeUrl } }
                        });
                        continue;
                    }

                    // mp4
                    const mp4 = iframeHtml.match(/(?:file|src|source)\s*:\s*["'](https?:\/\/[^"']*\.mp4[^"']*)["']/i);
                    if (mp4 && !seen.has(mp4[1])) {
                        seen.add(mp4[1]);
                        streams.push({
                            name: "ArabSeed by Abdulluh.X",
                            title: quality + " | عرب سيد",
                            url: mp4[1],
                            behaviorHints: { notWebReady: false, headers: { "Referer": iframeUrl } }
                        });
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    return streams;
}

async function getArabSeedStreams(imdbId, type, season, episode) {
    const meta = await getTmdbMeta(imdbId, type);
    if (!meta || !meta.arabicTitle) {
        console.log("[ArabSeed] No meta for: " + imdbId);
        return [];
    }

    console.log("[ArabSeed] Title: " + meta.arabicTitle);

    const pageUrl = await searchArabSeed(meta.arabicTitle, type);
    if (!pageUrl) {
        console.log("[ArabSeed] Not found: " + meta.arabicTitle);
        return [];
    }

    console.log("[ArabSeed] Found: " + pageUrl);

    let watchUrl = pageUrl;

    if (type === "series") {
        const epUrl = await getEpisodePage(pageUrl, season, episode);
        if (!epUrl) return [];
        watchUrl = epUrl;
        console.log("[ArabSeed] Episode: " + watchUrl);
    }

    // جيب صفحة المشاهدة
    const html = await fetchText(watchUrl);
    const watchBtnMatch = html.match(/href="([^"]*\/watch[^"]*)"/i);
    const watchPageUrl = watchBtnMatch ? watchBtnMatch[1] : watchUrl + "watch/";

    return await extractStreamsFromPage(watchPageUrl, watchUrl);
}

module.exports = async function(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    const url = req.url || "/";

    if (url === "/" || url.includes("/manifest.json")) {
        return res.end(JSON.stringify(MANIFEST));
    }

    const streamMatch = url.match(/\/stream\/(movie|series)\/(.+)\.json/);
    if (streamMatch) {
        try {
            const type = streamMatch[1];
            const fullId = streamMatch[2];
            const parts = fullId.split(":");
            const imdbId = parts[0];
            const season = parseInt(parts[1] || "1");
            const episode = parseInt(parts[2] || "1");

            console.log("[ArabSeed] " + imdbId + " " + type);
            const streams = await getArabSeedStreams(imdbId, type, season, episode);
            console.log("[ArabSeed] Found " + streams.length + " streams");
            return res.end(JSON.stringify({ streams }));
        } catch (e) {
            console.error("[ArabSeed] Error: " + e.message);
            return res.end(JSON.stringify({ streams: [] }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
};
