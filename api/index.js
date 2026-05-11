const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const SCRAPINGBEE_KEY = "AYDMQOEF8G5QN3B7ER570SRSJUXITKBZ39019BGGWABEPFEW2XDQZ8Q654O65IE0BXPBZ7CPRLDRRL7C";
const WATCH_BASE = "https://m.reviewrate.net";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const manifest = {
    id: "community.asdpics.abdulluhx",
    version: "6.0.0",
    name: "Arabseed Turbo | عرب سيد",
    description: "سحب فائق السرعة (أقل من 10 ثوانٍ) باستخدام تقنية الطلبات المتوازية",
    logo: "https://asd.pics/templates/Default/images/logo.png",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

// دالة جلب سريعة (بدون انتظار طويل)
async function fetchViaBee(url, method = "GET", body = null, render = true) {
    let beeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_KEY}&url=${encodeURIComponent(url)}&render_js=${render}&premium_proxy=true&timeout=10000`;
    
    if (method === "POST" && body) {
        const bodyParams = new URLSearchParams(body).toString();
        beeUrl += `&method=POST&body=${encodeURIComponent(bodyParams)}`;
    }

    try {
        const res = await fetch(beeUrl, { headers: { "User-Agent": USER_AGENT } });
        return res.ok ? await res.text() : null;
    } catch (e) { return null; }
}

async function extractStreams(imdbId) {
    const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;
    const streams = [];
    const seen = new Set();

    try {
        // 1. جلب الصفحة الأساسية (الطلب الوحيد الذي ينتظر JS)
        const html = await fetchViaBee(watchUrl);
        if (!html) return [];

        const csrfToken = html.match(/csrf_token['"]?\s*:\s*['"]([^'"]+)['"]/)?.[1];
        const postId = html.match(/post_id['" ]?\s*:\s*['" ]?(\d+)/)?.[1] || html.match(/data-post=["'](\d+)["']/)?.[1];

        if (!csrfToken || !postId) return [];

        // 2. جلب قائمة السيرفرات (طلب POST سريع)
        const ajaxUrl = `${WATCH_BASE}/get__quality__servers/`;
        const serversAjax = await fetchViaBee(ajaxUrl, "POST", { post_id: postId, quality: "1080", csrf_token: csrfToken }, false);
        
        if (!serversAjax) return [];
        const $ = load(serversAjax);
        const serverNodes = [];
        $("li[data-server]").each((_i, el) => {
            serverNodes.push({ id: $(el).attr("data-server"), qu: $(el).attr("data-quality") || "1080" });
        });

        // 3. الطلب المتوازي (المعالجة في نفس الوقت لتوفير الوقت)
        const serverPromises = serverNodes.slice(0, 2).map(async (srv) => {
            const serverJson = await fetchViaBee(`${WATCH_BASE}/get__watch__server/`, "POST", {
                post_id: postId,
                quality: srv.qu,
                server: srv.id,
                csrf_token: csrfToken
            }, false);

            try {
                const parsed = JSON.parse(serverJson);
                let iframeUrl = parsed.server;
                if (iframeUrl) {
                    if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                    
                    // جلب روابط الفيديو الخام بسرعة
                    const embedHtml = await fetchViaBee(iframeUrl, "GET", null, false);
                    if (embedHtml) {
                        const videoLinks = embedHtml.match(/https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*/gi) || [];
                        return videoLinks.map(link => {
                            if (!seen.has(link) && !link.includes("google")) {
                                seen.add(link);
                                return {
                                    title: `🎬 سيرفر ${srv.id} (${link.includes("m3u8") ? "HLS" : "MP4"})`,
                                    url: link,
                                    behaviorHints: { notWebReady: false, headers: { "Referer": iframeUrl } }
                                };
                            }
                            return null;
                        }).filter(x => x !== null);
                    }
                }
            } catch (e) { return []; }
        });

        const results = await Promise.all(serverPromises);
        results.flat().forEach(s => { if(s) streams.push(s); });

    } catch (e) {}
    return streams;
}

app.get("/", (req, res) => res.json(manifest));
app.get("/manifest.json", (req, res) => res.json(manifest));
app.get("/stream/:type/:id.json", async (req, res) => {
    const imdbId = req.params.id.split(":")[0];
    const streams = await extractStreams(imdbId);
    res.json({ streams: streams.slice(0, 5) });
});

module.exports = app;
