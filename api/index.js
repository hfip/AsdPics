const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

const WATCH_BASE = "https://m.reviewrate.net";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const manifest = {
    id: "community.asdpics.abdulluhx",
    version: "2.5.0",
    name: "Arabseed Premium | عرب سيد",
    description: "سحب البث المباشر (HLS/MP4) بناءً على تحليل نظام GameHub الرسمي",
    logo: "https://asd.pics/templates/Default/images/logo.png",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

// دالة محاكاة طلبات POST الخاصة بـ Arabseed (بناءً على ملف Arabseed.kt)
async function postToArabseed(path, body, referer) {
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
        // 1. جلب الصفحة الرئيسية لاستخراج التوكن والمعرف (بناءً على GameHubExtractor.kt)
        const html = await fetch(watchUrl, { headers: { "User-Agent": USER_AGENT } }).then(res => res.text());
        const csrfToken = html.match(/['"]csrf_token['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
        const postId = html.match(/post_id['" ]\s*:\s*['" ]?(\d+)/)?.[1] || html.match(/data-post=["'](\d+)["']/)?.[1];

        if (!csrfToken || !postId) return [];

        // 2. طلب قائمة السيرفرات (المرحلة الأولى من POST كما في فيديو التحليل)
        const serverListHtml = await postToArabseed("/get__watch__server/", { post_id: postId, csrf_token: csrfToken }, watchUrl);
        const $ = load(serverListHtml);
        const serverIds = [];
        
        $("li[data-server]").each((_i, el) => {
            serverIds.push($(el).attr("data-server"));
        });

        // 3. طلب الرابط الفعلي لكل سيرفر (المرحلة الثانية من POST)
        for (const sId of serverIds.slice(0, 5)) { // جلب أول 5 سيرفرات لضمان السرعة
            const jsonRes = await postToArabseed("/get__watch__server/", {
                post_id: postId,
                csrf_token: csrfToken,
                server: sId
            }, watchUrl);

            try {
                const parsed = JSON.parse(jsonRes);
                let iframeUrl = parsed.server;
                if (iframeUrl && !seen.has(iframeUrl)) {
                    if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                    seen.add(iframeUrl);

                    // 4. الدخول للـ iframe وسحب روابط الـ m3u8 والـ mp4 مباشرة
                    const embedHtml = await fetch(iframeUrl, { headers: { "User-Agent": USER_AGENT, "Referer": watchUrl } }).then(res => res.text());
                    
                    // بحث عن m3u8
                    const m3u8s = embedHtml.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi) || [];
                    m3u8s.forEach(url => {
                        if (!seen.has(url)) {
                            seen.add(url);
                            streams.push({
                                title: `📺 سيرفر ${streams.length + 1} (HLS)`,
                                url: url
                            });
                        }
                    });

                    // بحث عن mp4 (سيرفر Boutique)
                    const mp4s = embedHtml.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/gi) || [];
                    mp4s.forEach(url => {
                        if (!seen.has(url)) {
                            seen.add(url);
                            streams.push({
                                title: `🎬 سيرفر ${streams.length + 1} (MP4)`,
                                url: url
                            });
                        }
                    });
                }
            } catch (e) {}
        }
    } catch (e) {
        console.error("Extraction error:", e);
    }
    return streams;
}

app.get("/manifest.json", (req, res) => res.json(manifest));
app.get("/stream/:type/:id.json", async (req, res) => {
    const imdbId = req.params.id.split(":")[0];
    const rawStreams = await extractStreams(imdbId);
    
    const streams = rawStreams.map(s => ({
        name: "Arabseed by Abdulluh.X",
        title: s.title,
        url: s.url,
        behaviorHints: {
            notWebReady: false,
            headers: { "Referer": WATCH_BASE + "/" }
        }
    }));
    res.json({ streams });
});

module.exports = app;
