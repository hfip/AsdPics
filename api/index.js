const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

// 1. إعداد تعريف الإضافة (Manifest)
const builder = new addonBuilder({
    id: "org.dexworld.asd",
    name: "DexWorld ASD",
    version: "1.0.0",
    description: "سحب مباشر من ASD لبرنامج ستريمو",
    resources: ["stream"],
    types: ["movie", "series"],
    catalogs: [],
    idPrefixes: ["tt"] // لدعم معرفات IMDb
});

// 2. منطق سحب الرابط المباشر (The Scraper Logic)
async function getDirectLink(mediaId) {
    try {
        // الرابط الأساسي للموقع (تأكد من تحديث النطاق إذا تغير)
        const baseUrl = "https://m.asd.ink/home7/";
        
        // محاكاة طلب بمتصفح حقيقي لتجاوز الحمايات البسيطة
        const response = await axios.get(baseUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                'Referer': 'https://m.asd.ink/'
            }
        });

        const $ = cheerio.load(response.data);
        
        // البحث عن الـ Iframe الذي يحتوي على المشغل
        let videoUrl = "";
        $('iframe').each((i, elem) => {
            const src = $(elem).attr('src');
            if (src && (src.includes('player') || src.includes('video'))) {
                videoUrl = src.startsWith('//') ? 'https:' + src : src;
            }
        });

        // ملاحظة: في حال وجود تشفير، نقوم بجلب الرابط من داخل السكربت
        if (!videoUrl) {
            const scripts = $('script').html();
            const match = scripts.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/);
            if (match) videoUrl = match[1];
        }

        return videoUrl || null;
    } catch (error) {
        console.error("Scraping Error:", error);
        return null;
    }
}

// 3. معالج البث (Stream Handler)
builder.defineStreamHandler(async (args) => {
    // جلب الرابط المباشر عند طلب المستخدم للمشاهدة
    const directUrl = await getDirectLink(args.id);

    if (directUrl) {
        return {
            streams: [
                {
                    title: "DexWorld - HD Server",
                    url: directUrl,
                    description: "رابط مباشر مستخرج من ASD"
                }
            ]
        };
    } else {
        return { streams: [] };
    }
});

// 4. تصدير الكود ليعمل كـ Serverless Function على Vercel
module.exports = builder.getInterface();
