// api/index.js
const { addonBuilder } = require("stremio-addon-sdk");
const cheerio = require("cheerio");

// ============ 1. إعداد البروكسي الآمن والدومين الفعال ============
const GOOGLE_PROXY_URL = "https://script.google.com/macros/s/AKfycbwzwsaeYrNMVo39ot5D2ah72SWsN1NaKa-_0yagRowbZNnByWwBiu94mO6mAUjwVGhSrQ/exec";
const BASE_URL = "https://m.asd.ink";

// ============ 2. إعداد تعريف الإضافة (Manifest) ============
const builder = new addonBuilder({
    id: "org.dexworld.asd.pro",
    name: "DexWorld ArabSeed Pro",
    version: "1.1.0",
    description: "سحب مباشر وفك تشفير سيرفرات عرب سيد لبرنامج ستريميو عبر بروكسي جوجل",
    resources: ["stream"],
    types: ["movie", "series"],
    catalogs: [],
    idPrefixes: ["tt"] // لدعم معرفات IMDb الدولية للأفلام والمسلسلات
});

// دالة وسيطة لطلب البيانات عبر سيرفرات جوجل لتجنب حظر IP الخاص بـ Vercel
async function fetchViaProxy(targetUrl) {
    try {
        const proxyUrl = `${GOOGLE_PROXY_URL}?action=get_links&url=${encodeURIComponent(targetUrl)}`;
        const response = await fetch(proxyUrl, { method: 'GET' });
        if (!response.ok) return null;
        
        const buffer = await response.arrayBuffer();
        return new TextDecoder('utf-8').decode(buffer);
    } catch (err) {
        console.error("Proxy Fetch Error:", err.message);
        return null;
    }
}

// ============ 3. منطق سحب الروابط وتفكيك التشفير المباشر ============
async function getDirectLinks(imdbId, type) {
    const streams = [];
    try {
        // أ) جلب اسم الفيلم أو المسلسل من API ستريميو العالمي للبحث عنه في عرب سيد
        const metaResponse = await fetch(`https://v3-cinemeta.stremio.com/meta/${type}/${imdbId}.json`);
        const metaData = await metaResponse.json();
        const mediaTitle = metaData.meta ? metaData.meta.name : "";

        if (!mediaTitle) return [];

        // ب) البحث عن العنوان داخل عرب سيد عبر دالة البحث بالبروكَسي
        const searchUrl = `${GOOGLE_PROXY_URL}?action=search&q=${encodeURIComponent(mediaTitle)}`;
        const searchHtml = await (await fetch(searchUrl)).text();
        const $s = cheerio.load(searchHtml);
        
        // التقاط رابط أول نتيجة بحث مطابقة من كود الصفحة
        let targetPageUrl = $s('.MovieBlock a, .Block--Item a, article a, .movie__block a').first().attr('href');
        if (!targetPageUrl) return [];

        // ت) التحويل الإجباري لصفحة المشاهدة المباشرة /watch/ لتخطي حمايات الواجهة
        let watchUrl = targetPageUrl.endsWith('/') ? `${targetPageUrl}watch/` : `${targetPageUrl}/watch/`;
        const watchHtml = await fetchViaProxy(watchUrl);
        if (!watchHtml) return [];

        const $w = cheerio.load(watchHtml);
        const servers = [];

        // th) فك تشفير روابط play.php?url=BASE64 المخفية لحل مشكلة عدم التشغيل والمصادر الفارغة
        const b64Regex = /play\.php\?url=([a-zA-Z0-9+/=]+)/g;
        let match;
        while ((match = b64Regex.exec(watchHtml)) !== null) {
            try {
                let b64Str = match[1];
                const padding = 4 - (b64Str.length % 4);
                if (padding !== 4) b64Str += '='.repeat(padding);
                const decoded = Buffer.from(b64Str, 'base64').toString('utf-8');
                if (decoded.startsWith('http') && !servers.some(s => s.link === decoded)) {
                    servers.push({ name: 'عرب سيد مباشر ⚡', link: decoded });
                }
            } catch (e) {}
        }

        // ج) سحب المشغلات التقليدية الـ iframes كخطة دعم ثانية
        $w('iframe').each((i, elem) => {
            const src = $w(elem).attr('src');
            if (src && src.startsWith('http') && !servers.some(s => s.link === src)) {
                servers.push({ name: `مشغل مدمج ${i + 1}`, link: src });
            }
        });

        // ح) فحص السيرفرات المستخرجة وجلب الروابط الصافية (.mp4 / .m3u8) بالتوازي لتفادي الـ Timeout
        const optimizedServers = servers.slice(0, 3);
        for (const server of optimizedServers) {
            const serverHtml = await fetchViaProxy(server.link);
            if (!serverHtml) continue;

            // سحب روابط HLS m3u8 للتشغيل الذكي
            const m3u8Matches = serverHtml.match(/https?:\/\/[^\s"'<>\\)]+\.m3u8[^\s"'<>\\)]*/gi);
            if (m3u8Matches) {
                [...new Set(m3u8Matches)].forEach(videoUrl => {
                    streams.push({
                        title: `🎬 DexWorld [${server.name}]\n🔗 الجودة: تلقائية HLS`,
                        url: videoUrl.replace(/\\\//g, '/'),
                        behaviorHints: {
                            notWebReady: false,
                            proxyHeaders: { request: { "Referer": server.link, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
                        }
                    });
                });
            }

            // سحب روابط MP4 المباشرة للتحميل المباشر والتشغيل
            const mp4Matches = serverHtml.match(/https?:\/\/[^\s"'<>\\)]+\.mp4[^\s"'<>\\)]*/gi);
            if (mp4Matches) {
                [...new Set(mp4Matches)].forEach(videoUrl => {
                    streams.push({
                        title: `🎬 DexWorld [${server.name}]\n🔗 الجودة: سورس مباشر MP4`,
                        url: videoUrl.replace(/\\\//g, '/'),
                        behaviorHints: {
                            notWebReady: false,
                            proxyHeaders: { request: { "Referer": server.link, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
                        }
                    });
                });
            }
        }

        // خطة بديلة نظيفة في حال لم نجد جودات مفكوكة (نفتح الرابط في متصفح خارجي بدلاً من شاشة الخطأ السوداء)
        if (streams.length === 0) {
            streams.push({
                name: "DexWorld Web",
                title: "🌐 فتح صفحة المشاهدة الخارجية المباشرة",
                externalUrl: watchUrl
            });
        }

    } catch (error) {
        console.error("DexWorld Scraper Error:", error);
    }
    return streams;
}

// ============ 4. معالج البث (Stream Handler) التابع لـ SDK ============
builder.defineStreamHandler(async (args) => {
    const streams = await getDirectLinks(args.id, args.type);
    return { streams };
});

// تصدير الواجهة لتتوافق كدالة Serverless وحيدة داخل مجلد api
const addonInterface = builder.getInterface();

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // تحويل مسارات Vercel الداخلية وتمريرها لمكتبة ستريميو لتعالجها تلقائياً
    const url = req.url;
    if (url === '/' || url === '/manifest.json') {
        return res.status(200).json(addonInterface.manifest);
    }

    // معالجة طلب الـ Stream المباشر من التطبيق
    const streamMatch = url.match(/^\/stream\/([^/]+)\/(.+)\.json$/);
    if (streamMatch) {
        const [, type, id] = streamMatch;
        const result = await getDirectLinks(decodeURIComponent(id), type);
        return res.status(200).json({ streams: result });
    }

    return res.status(404).json({ error: 'Not found' });
}
