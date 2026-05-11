const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const WATCH_BASE = "https://m.reviewrate.net";
// البصمة المستخدمة في ملف CloudflareSolver الخاص بك
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const manifest = {
    id: "community.asdpics.abdulluhx",
    version: "3.0.0",
    name: "Arabseed Pro | عرب سيد",
    description: "سحب البث المباشر بناءً على نظام GameHub الرسمي",
    logo: "https://asd.pics/templates/Default/images/logo.png",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

// دالة محاكاة طلبات POST (المرحلة الحاسمة في GameHubExtractor.kt)
async function postToReviewRate(path, body, referer) {
    const params = new URLSearchParams();
    for (const key in body) params.append(key, body[key]);

    const res = await fetch(`${WATCH_BASE}${path}`, {
        method: "POST",
        headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
            "Origin": WATCH_BASE
        },
        body: params.toString()
    });
    return await res.text();
}

async function extractStreams(imdbId) {
    const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;
    const streams = [];
    const seen = new Set();

    try {
        // 1. جلب الصفحة (استخراج التوكن كما في GameHubExtractor.kt)
        const html = await fetch(watchUrl, { headers: { "User-Agent": USER_AGENT, "Referer": "https://asd.pics/" } }).then(res => res.text());
        const csrfToken = html.match(/['"]csrf_token['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
        const postId = html.match(/post_id['" ]\s*:\s*['" ]?(\d+)/)?.[1] || html.match(/data-post=["'](\d+)["']/)?.[1];

        if (!csrfToken || !postId) return [];

        // 2. طلب قائمة السيرفرات (POST 1)
        const serverListHtml = await postToReviewRate("/get__watch__server/", { post_id: postId, csrf_token: csrfToken }, watchUrl);
        const $ = load(serverListHtml);
        const servers = [];
        $("li[data-server]").each((_i, el) => {
            servers.push({ id: $(el).attr("data-server"), quality: $(el).attr("data-quality") || "1080" });
        });

        // 3. طلب الـ iframe الحقيقي لكل سيرفر (POST 2 كما في فيديو التحليل)
        for (const srv of servers.slice(0, 3)) {
            const jsonRes = await postToReviewRate("/get__watch__server/", {
                post_id: postId,
                csrf_token: csrfToken,
                server: srv.id,
                quality: srv.quality
            }, watchUrl);

            try {
                const parsed = JSON.parse(jsonRes);
                let iframeUrl = parsed.server;
                if (iframeUrl) {
                    if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                    
                    // 4. استخراج روابط البث الخام (m3u8/mp4) من داخل الـ iframe
                    const embedHtml = await fetch(iframeUrl, { headers: { "User-Agent": USER_AGENT, "Referer": watchUrl } }).then(res => res.text());
                    const videoLinks = embedHtml.match(/https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*/gi) || [];
                    
                    videoLinks.forEach(link => {
                        if (!seen.has(link) && !link.includes("google")) {
                            seen.add(link);
                            const isHls = link.includes("m3u8");
                            streams.push({
                                title: `🎬 سيرفر ${srv.id} (${isHls ? "HLS" : "MP4"}) - ${srv.quality}p`,
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

// حل مشكلة "Cannot GET /"
app.get("/", (req, res) => res.json(manifest));
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/stream/:type/:id.json", async (req, res) => {
    const imdbId = req.params.id.split(":")[0];
    const streams = await extractStreams(imdbId);
    res.json({ streams });
});

module.exports = app;
