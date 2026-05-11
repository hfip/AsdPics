const express = require("express");
const cors = require("cors");
const { load } = require("cheerio");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

// --- إعدادات ScrapingBee بالمفتاح الخاص بك ---
const SCRAPINGBEE_KEY = "AYDMQOEF8G5QN3B7ER570SRSJUXITKBZ39019BGGWABEPFEW2XDQZ8Q654O65IE0BXPBZ7CPRLDRRL7C";
const WATCH_BASE = "https://m.reviewrate.net";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const manifest = {
    id: "community.asdpics.abdulluhx",
    version: "4.5.0",
    name: "Arabseed Bee | عرب سيد",
    description: "سحب وتشغيل البث المباشر (HLS/MP4) بتجاوز حماية Cloudflare عبر ScrapingBee",
    logo: "https://asd.pics/templates/Default/images/logo.png",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

// دالة جلب البيانات عبر ScrapingBee (لحل لغز Cloudflare برمجياً)
async function fetchViaBee(url, method = "GET", body = null) {
    // تفعيل render_js و premium_proxy لضمان تخطي الحماية بنجاح
    let beeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_KEY}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true`;
    
    const options = {
        method: method,
        headers: { "User-Agent": USER_AGENT }
    };

    if (method === "POST" && body) {
        const bodyParams = new URLSearchParams(body).toString();
        beeUrl += `&method=POST&body=${encodeURIComponent(bodyParams)}`;
    }

    try {
        const res = await fetch(beeUrl, options);
        return await res.text();
    } catch (e) {
        console.error("[-] ScrapingBee Error:", e.message);
        return null;
    }
}

async function extractStreams(imdbId) {
    const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;
    const streams = [];
    const seen = new Set();

    try {
        // 1. جلب صفحة المشغل الأساسية لاستخراج التوكنات
        const html = await fetchViaBee(watchUrl);
        if (!html) return [];

        const csrfToken = html.match(/['"]csrf_token['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
        const postId = html.match(/post_id['" ]\s*:\s*['" ]?(\d+)/)?.[1] || html.match(/data-post=["'](\d+)["']/)?.[1];

        if (!csrfToken || !postId) return [];

        // 2. طلب قائمة السيرفرات (Ajax POST)
        const ajaxUrl = `${WATCH_BASE}/get__watch__server/`;
        const serverListHtml = await fetchViaBee(ajaxUrl, "POST", { post_id: postId, csrf_token: csrfToken });
        
        if (!serverListHtml) return [];
        const $ = load(serverListHtml);
        const servers = [];
        $("li[data-server]").each((_i, el) => {
            servers.push({ 
                id: $(el).attr("data-server"), 
                quality: $(el).attr("data-quality") || "1080" 
            });
        });

        // 3. استخراج روابط الـ iframe والـ m3u8 المباشرة
        for (const srv of servers.slice(0, 3)) {
            const jsonRes = await fetchViaBee(ajaxUrl, "POST", {
                post_id: postId,
                csrf_token: csrfToken,
                server: srv.id,
                quality: srv.quality
            });

            try {
                const parsed = JSON.parse(jsonRes);
                let iframeUrl = parsed.server;
                if (iframeUrl) {
                    if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
                    
                    // الدخول للـ iframe وفحص روابط الفيديو الخام
                    const embedHtml = await fetchViaBee(iframeUrl);
                    const videoLinks = embedHtml.match(/https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*/gi) || [];
                    
                    videoLinks.forEach(link => {
                        if (!seen.has(link) && !link.includes("google")) {
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
    } catch (e) {}
    return streams;
}

// مسارات Vercel وستريمو
app.get("/", (req, res) => res.json(manifest));
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/stream/:type/:id.json", async (req, res) => {
    const imdbId = req.params.id.split(":")[0];
    const streams = await extractStreams(imdbId);
    res.json({ streams });
});

module.exports = app;
