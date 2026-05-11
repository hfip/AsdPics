const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const WATCH_BASE = "https://m.reviewrate.net";
// استخدام البصمة الدقيقة الموجودة في ملف CloudflareSolver.kt الخاص بك
const EXACT_USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const manifest = {
    id: "community.asdpics.abdulluhx",
    version: "2.7.0",
    name: "Arabseed Premium | عرب سيد",
    description: "سحب البث المباشر (HLS/MP4) بناءً على تحليل نظام GameHub الرسمي",
    logo: "https://asd.pics/templates/Default/images/logo.png",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

// دالة محاكاة طلبات POST (بناءً على منطق GameHubExtractor.kt)
async function postToReviewRate(path, body, referer) {
    const params = new URLSearchParams();
    for (const key in body) params.append(key, body[key]);

    const res = await fetch(`${WATCH_BASE}${path}`, {
        method: "POST",
        headers: {
            "User-Agent": EXACT_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
            "Origin": WATCH_BASE
        },
        body: params.toString(),
        timeout: 10000
    });
    return await res.text();
}

async function extractStreams(imdbId) {
    const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;
    const streams = [];
    const seen = new Set();

    try {
        // 1. جلب الصفحة لاستخراج التوكن ومعرف البوست (بناءً على Arabseed.kt)
        const response = await fetch(watchUrl, { 
            headers: { 
                "User-Agent": EXACT_USER_AGENT,
                "Referer": "https://asd.pics/" 
            } 
        });
        const html = await response.text();

        // استخراج التوكن والمعرف باستخدام Regex المطابق لملفك
        const csrfToken = html.match(/['"]csrf_token['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
        const postId = html.match(/data-post=["'](\d+)["']/)?.[1] || html.match(/post_id['" ]\s*:\s*['" ]?(\d+)/)?.[1];

        if (!csrfToken || !postId) {
            console.log("Failed to extract tokens");
            return [];
        }

        // 2. طلب قائمة السيرفرات - POST 1
        const ajaxUrl = "/get__watch__server/";
        const serverListHtml = await postToReviewRate(ajaxUrl, { 
            post_id: postId, 
            csrf_token: csrfToken 
        }, watchUrl);

        const $ = load(serverListHtml);
        const servers = [];
        $("li[data-server]").each((_i, el) => {
            servers.push({
                id: $(el).attr("data-server"),
                quality: $(el).attr("data-quality") || "1080"
            });
        });

        // 3. طلب الرابط الفعلي لكل سيرفر - POST 2
        for (const srv of servers.slice(0, 3)) { // فحص أول 3 سيرفرات لضمان السرعة
            const serverJson = await postToReviewRate(ajaxUrl, {
                post_id: postId,
                csrf_token: csrfToken,
                server: srv.id,
                quality: srv.quality
            }, watchUrl);

            try {
                const parsed = JSON.parse(serverJson);
                let iframeUrl = parsed.server;
                if (iframeUrl) {
                    if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;

                    // 4. استخراج روابط m3u8 و mp4 من صفحة السيرفر
                    const embedRes = await fetch(iframeUrl, { 
                        headers: { "User-Agent": EXACT_USER_AGENT, "Referer": watchUrl } 
                    });
                    const embedHtml = await embedRes.text();

                    // البحث عن روابط الفيديو المباشرة
                    const videoLinks = embedHtml.match(/https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*/gi) || [];
                    videoLinks.forEach(link => {
                        if (!seen.has(link) && !link.includes("google") && !link.includes("static")) {
                            seen.add(link);
                            const isHls = link.includes("m3u8");
                            streams.push({
                                title: `🎬 سيرفر ${srv.id} (${isHls ? "HLS" : "MP4"}) - ${srv.quality}p`,
                                url: link,
                                behaviorHints: {
                                    notWebReady: false,
                                    headers: { "Referer": iframeUrl }
                                }
                            });
                        }
                    });
                }
            } catch (e) {}
        }
    } catch (err) {
        console.error("Extraction error:", err);
    }
    return streams;
}

// المسارات الأساسية
app.get("/", (req, res) => res.json(manifest));
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/stream/:type/:id.json", async (req, res) => {
    const imdbId = req.params.id.split(":")[0];
    try {
        const streams = await extractStreams(imdbId);
        res.json({ streams });
    } catch (e) {
        res.json({ streams: [] });
    }
});

module.exports = app;
