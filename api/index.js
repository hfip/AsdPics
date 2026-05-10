const https = require("https");
const http = require("http");

const BASE_URL = "https://arabseed.ink";
const WATCH_BASE = "https://m.reviewrate.net"; // نطاق المشغل المباشر لتخطي الحماية
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";

// إعداد الهيدرز المطابقة تماماً لتطبيق Cloudstream لضمان تجاوز فلترة الحماية
const EXACT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1"
};

const MANIFEST = {
    id: "community.arabseed.abdulluhx",
    version: "1.1.0",
    name: "ArabSeed by Abdulluh.X",
    description: "إضافة متطورة لسحب البث المباشر (m3u8 / mp4) وتشغيله داخلياً وبدون خروج من ستريمو",
    logo: "https://asd.pics/templates/Default/images/logo.png",
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
                headers: Object.assign({}, EXACT_HEADERS, headers || {})
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
            const client = url.startsWith("https") ? https : http;
            const req = client.request({
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: "POST",
                headers: Object.assign({}, EXACT_HEADERS, {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Content-Length": Buffer.byteLength(bodyStr),
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": headers?.Referer || WATCH_BASE,
                    "Origin": WATCH_BASE
                }, headers || {})
            }, (res) => {
                const chunks = [];
                res.on("data", c => chunks.push(c));
                res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("utf-8")); });
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
        arabicTitle: arData.title || arData.name || item.title || item.name || ""
    };
}

// دالة تفكيك واستخراج روابط البث المباشرة من المشغل مباشرة
async function extractDirectGameHubStreams(imdbId) {
    const embedUrl = `${WATCH_BASE}/embed-${imdbId}.html`;
    const watchUrl = `${WATCH_BASE}/watch/${imdbId}`;

    // 1. طلب صفحة الـ embed مباشرة لتفادي فلترة Cloudflare لنطاق عرب سيد الرئيسي
    let html = await fetchText(embedUrl, { "Referer": "https://asd.pics/" });
    if (!html || html.length < 500) {
        html = await fetchText(watchUrl, { "Referer": "https://asd.pics/" });
    }
    if (!html) return [];

    const streams = [];
    const seen = new Set();

    // 2. استخراج csrf_token والـ post_id (objId) من كود المشغل
    const csrfTokenMatch = html.match(/['" ]csrf_token['" ]\s*:\s*['"]([^'"]+)['"]/);
    const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;

    let objId = null;
    const objIdMatch = html.match(/['" ]objId['" ]\s*:\s*['" ]?(\d+)['" ]?/i) || html.match(/post_id['" ]\s*:\s*['" ]?(\d+)['" ]?/i);
    if (objIdMatch) {
        objId = objIdMatch[1];
    } else {
        objId = imdbId.replace(/\D/g, ""); // استخراج الرقم من معرف IMDb كاحتياط
    }

    // 3. إرسال طلب الـ POST لاستخراج السيرفرات الحقيقية
    if (csrfToken && objId) {
        const ajaxUrl = `${WATCH_BASE}/get__watch__server/`;
        const postDataBody = {
            "post_id": objId,
            "csrf_token": csrfToken
        };

        const ajaxResponse = await postData(ajaxUrl, postDataBody, { "Referer": embedUrl });

        if (ajaxResponse) {
            // أ) جلب روابط الـ m3u8
            const m3u8Pattern = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi;
            let m3u8Match;
            while ((m3u8Match = m3u8Pattern.exec(ajaxResponse)) !== null) {
                let streamUrl = m3u8Match[0];
                if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
                    streamUrl = streamUrl.slice(0, -1);
                }
                if (!seen.has(streamUrl)) {
                    seen.add(streamUrl);

                    let serverLabel = "سيرفر البث الرئيسي HLS";
                    if (streamUrl.includes("s1q2105.com")) serverLabel = "عرب سيد أساسي (HLS)";
                    if (streamUrl.includes("vmwesa.online")) serverLabel = "سيرفر سحابي VMW";
                    if (streamUrl.includes("r66nv9ed.com")) serverLabel = "سيرفر سريع Sprint";
                    if (streamUrl.includes("tnmr.org")) serverLabel = "سيرفر ممتاز HLS";

                    streams.push({
                        url: streamUrl,
                        title: serverLabel
                    });
                }
            }

            // ب) جلب روابط الـ MP4 (سيرفر Boutique)
            const mp4Pattern = /https?:\/\/[^\s"']+\.mp4[^\s"']*/gi;
            let mp4Match;
            while ((mp4Match = mp4Pattern.exec(ajaxResponse)) !== null) {
                let streamUrl = mp4Match[0];
                if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
                    streamUrl = streamUrl.slice(0, -1);
                }
                if (!seen.has(streamUrl)) {
                    seen.add(streamUrl);

                    let serverLabel = "سيرفر MP4 مباشر";
                    if (streamUrl.includes("boutique")) serverLabel = "سيرفر Boutique المباشر";

                    streams.push({
                        url: streamUrl,
                        title: serverLabel
                    });
                }
            }
        }
    }

    // 4. فحص احتياطي لكود الـ HTML الأساسي في حال توفر الروابط مباشرة بداخله
    const fallbackPattern = /https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*/gi;
    let fallbackMatch;
    while ((fallbackMatch = fallbackPattern.exec(html)) !== null) {
        let streamUrl = fallbackMatch[0];
        if (streamUrl.endsWith(")") || streamUrl.endsWith("'") || streamUrl.endsWith('"')) {
            streamUrl = streamUrl.slice(0, -1);
        }
        if (!seen.has(streamUrl) && !streamUrl.includes("templates") && !streamUrl.includes("assets")) {
            seen.add(streamUrl);
            const isHls = streamUrl.includes(".m3u8");
            streams.push({
                url: streamUrl,
                title: `سيرفر مباشر احتياطي (${isHls ? "HLS" : "MP4"})`
              });
        }
    }

    return streams;
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
            const imdbId = parts[0]; // استخراج الـ IMDb ID مباشرة للفتح الفوري (مثل tt1757678)

            console.log("[ArabSeed] Fetching stream links for IMDb ID: " + imdbId);
            const rawStreams = await extractDirectGameHubStreams(imdbId);
            
            // صياغة الروابط لتعود بصيغة البث المباشر المتوافقة مع مشغل ستريمو الداخلي
            const streams = rawStreams.map(s => ({
                name: "ArabSeed by Abdulluh.X",
                title: `🎬 ${s.title}`,
                url: s.url,
                behaviorHints: {
                    notWebReady: false,
                    headers: {
                        "Referer": `${WATCH_BASE}/`,
                        "Origin": WATCH_BASE
                    }
                }
            }));

            console.log("[ArabSeed] Total streams successfully extracted: " + streams.length);
            return res.end(JSON.stringify({ streams }));
        } catch (e) {
            console.error("[ArabSeed] Error: " + e.message);
            return res.end(JSON.stringify({ streams: [] }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
};
