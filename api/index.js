const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const SCRAPINGBEE_KEY = "AYDMQOEF8G5QN3B7ER570SRSJUXITKBZ39019BGGWABEPFEW2XDQZ8Q654O65IE0BXPBZ7CPRLDRRL7C";
const WATCH_BASE = "https://m.reviewrate.net";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"; //

const manifest = {
    id: "community.asdpics.abdulluhx",
    version: "5.5.0",
    name: "Arabseed Bee Ultra | عرب سيد",
    description: "سحب وتشغيل البث المباشر بناءً على تحليل الـ DOM الفعلي للموقع",
    logo: "https://asd.pics/templates/Default/images/logo.png",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

async function fetchViaBee(url, method = "GET", body = null) {
    let beeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_KEY}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true&wait_browser=5000`;
    
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
        // 1. جلب الصفحة وحل التحدي الأمني
        const html = await fetchViaBee(watchUrl);
        if (!html) return [];

        // استخراج التوكن من main__obj.csrf_token كما في الصور
        const csrfToken = html.match(/csrf_token['"]?\s*:\s*['"]([^'"]+)['"]/)?.[1];
        const postId = html.match(/post_id['" ]?\s*:\s*['" ]?(\d+)/)?.[1] || html.match(/data-post=["'](\d+)["']/)?.[1];

        if (!csrfToken || !postId) return [];

        // 2. محاكاة طلب get__quality__servers كما ظهر في الصور
        const serversAjax = await fetchViaBee(`${WATCH_BASE}/get__quality__servers/`, "POST", {
            post_id: postId,
            quality: "1080", // نجرب جلب أعلى جودة أولاً
            csrf_token: csrfToken
        });

        if (!serversAjax) return [];
        const $ = load(serversAjax);
        const serverNodes = [];
        $("li[data-server]").each((_i, el) => {
            serverNodes.push({ id: $(el).attr("data-server"), qu: $(el).attr("data-quality") || "1080" });
        });

        // 3. محاكاة طلب get__watch__server للحصول على رابط iframe النهائي
        for (const srv of serverNodes.slice(0, 3)) {
            const serverJson = await fetchViaBee(`${WATCH_BASE}/get__watch__server/`, "POST", {
                post_id: postId,
                quality: srv.qu,
                server: srv.id,
                csrf_token: csrfToken
            });

            try {
                const parsed = JSON.parse(serverJson);
                let iframeUrl = parsed.server; // المتغير e.server المذكور في صورك
                if (iframeUrl) {
                    if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                    
                    // الدخول للـ iframe لفك الروابط المباشرة m3u8/mp4
                    const embedHtml = await fetchViaBee(iframeUrl);
                    const videoLinks = embedHtml.match(/https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*/gi) || [];
                    
                    videoLinks.forEach(link => {
                        if (!seen.has(link) && !link.includes("google")) {
                            seen.add(link);
                            const isHls = link.includes("m3u8");
                            streams.push({
                                title: `🎬 سيرفر ${srv.id} (${isHls ? "HLS" : "MP4"}) - ${srv.qu}p`,
                                url: link,
                                behaviorHints: { notWebReady: false, headers: { "Referer": iframeUrl } }
                            });
                        }
                    });
                }
            } catch (e) {}
        }
    } catch (e) {}
    return streams;
}

app.get("/", (req, res) => res.json(manifest));
app.get("/manifest.json", (req, res) => res.json(manifest));
app.get("/stream/:type/:id.json", async (req, res) => {
    const imdbId = req.params.id.split(":")[0];
    const streams = await extractStreams(imdbId);
    res.json({ streams });
});

module.exports = app;
