const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");

// حل توافقية node-fetch مع Vercel
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7001;
const WATCH_BASE = "https://m.reviewrate.net";
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";

// الهيدرز المعتمدة لتطابق كامل مع تطبيق Cloudstream
const EXACT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7",
    "Upgrade-Insecure-Requests": "1"
};

const manifest = {
    id: "community.asdpics.abdulluhx",
    version: "2.6.0",
    name: "Arabseed Premium | عرب سيد",
    description: "سحب البث المباشر (HLS/MP4) وتشغيله داخلياً في ستريمو",
    logo: "https://asd.pics/templates/Default/images/logo.png",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

// دالة محاكاة طلبات POST (المرحلة الحاسمة في فيديو التحليل)
async function postToArabseed(path, body, referer) {
    const params = new URLSearchParams();
    for (const key in body) params.append(key, body[key]);

    const res = await fetch(`${WATCH_BASE}${path}`, {
        method: "POST",
        headers: {
            "User-Agent": EXACT_HEADERS["User-Agent"],
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
            "Origin": WATCH_BASE
        },
        body: params.toString(),
        timeout: 8000
    });
    return await res.text();
}

async function extractStreams(imdbId) {
    const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;
    const streams = [];
    const seen = new Set();

    try {
        // 1. جلب الصفحة لاستخراج csrf_token و post_id
        const html = await fetch(watchUrl, { headers: EXACT_HEADERS }).then(res => res.text());
        const csrfToken = html.match(/['"]csrf_token['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
        const postId = html.match(/post_id['" ]\s*:\s*['" ]?(\d+)/)?.[1] || html.match(/data-post=["'](\d+)["']/)?.[1];

        if (!csrfToken || !postId) return [];

        // 2. طلب قائمة السيرفرات (POST 1)
        const serverListHtml = await postToArabseed("/get__watch__server/", { post_id: postId, csrf_token: csrfToken }, watchUrl);
        const $ = load(serverListHtml);
        const serverIds = [];
        
        $("li[data-server]").each((_i, el) => {
            const sId = $(el).attr("data-server");
            const qual = $(el).attr("data-quality") || "Auto";
            serverIds.push({ id: sId, quality: qual });
        });

        // 3. طلب الرابط الفعلي (POST 2) والدخول للـ iframe
        for (const server of serverIds.slice(0, 4)) {
            const jsonRes = await postToArabseed("/get__watch__server/", {
                post_id: postId,
                csrf_token: csrfToken,
                server: server.id,
                quality: server.quality
            }, watchUrl);

            try {
                const parsed = JSON.parse(jsonRes);
                let iframeUrl = parsed.server;
                if (iframeUrl) {
                    if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                    
                    // الدخول للـ iframe لسحب رابط الفيديو الخام
                    const embedHtml = await fetch(iframeUrl, { 
                        headers: { "User-Agent": EXACT_HEADERS["User-Agent"], "Referer": watchUrl } 
                    }).then(res => res.text());
                    
                    // فك روابط m3u8 و mp4
                    const videoLinks = embedHtml.match(/https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*/gi) || [];
                    videoLinks.forEach(link => {
                        if (!seen.has(link)) {
                            seen.add(link);
                            const isHls = link.includes(".m3u8");
                            streams.push({
                                title: `🎬 سيرفر ${server.id} (${isHls ? "HLS" : "MP4"}) - ${server.quality}p`,
                                url: link,
                                behaviorHints: {
                                    notWebReady: false,
                                    headers: { "Referer": iframeUrl, "Origin": new URL(iframeUrl).origin }
                                }
                            });
                        }
                    });
                }
            } catch (e) {}
        }
    } catch (e) { console.error("Extraction error:", e); }
    return streams;
}

app.get("/", (req, res) => res.json(manifest));
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/stream/:type/:id.json", async (req, res) => {
    const imdbId = req.params.id.split(":")[0];
    console.log(`[Arabseed] Processing ID: ${imdbId}`);
    try {
        const streams = await extractStreams(imdbId);
        res.json({ streams });
    } catch (e) {
        res.json({ streams: [] });
    }
});

module.exports = app;
