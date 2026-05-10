import express from "express";
import cors from "cors";
import { load } from "cheerio";
import fetch from "node-fetch";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;
const BASE_URL = "https://asd.pics";

// ─── إعدادات الذاكرة المؤقتة (Cache) لتسريع الأداء وتفادي الحظر ───
const pageCache = new Map();
const PAGE_TTL = 5 * 60 * 1000; // 5 دقائق

async function fetchHtml(url) {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL) return cached.html;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.3",
        "Referer": BASE_URL,
      },
      timeout: 8000
    });
    const html = await res.text();
    pageCache.set(url, { html, ts: Date.now() });
    return html;
  } catch (err) {
    console.error("خطأ أثناء جلب الصفحة:", err);
    return null;
  }
}

// ─── مخرجات الـ Manifest الخاصة بإضافة Stremio ───
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.asdpics.addon",
    version: "1.0.0",
    name: "Asd Pics (عرب سيد)",
    description: "إضافة لسحب البث والكتالوجات من موقع Asd Pics للمحتوى العربي والأجنبي",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"], // يدعم معرفات IMDB القياسية ttXXXXXXX
    background: "https://asd.pics/templates/Default/images/logo.png",
    logo: "https://asd.pics/templates/Default/images/logo.png",
  });
});

// ─── مسار جلب روابط البث (Stream Handler) ───
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  
  // فك ترميز المعرف (مثال لـ IMDB: tt1234567:1:5 للمسلسلات أو tt1234567 للأفلام)
  const parts = id.split(":");
  const imdbId = parts[0];
  const season = parts[1];
  const episode = parts[2];

  console.log(`[+] طلب بث جديد لـ: ${type} | معرف: ${imdbId} | موسم: ${season} | حلقة: ${episode}`);

  try {
    // 1. جلب اسم الفيلم أو المسلسل باللغة العربية عبر TMDB API لضمان مطابقة البحث في الموقع العربي
    const mediaName = await getArabicNameFromTMDB(imdbId, type);
    if (!mediaName) {
      return res.json({ streams: [] });
    }

    // 2. البحث عن الصفحة الخاصة بالمحتوى داخل الموقع
    const targetPageUrl = await searchInSite(mediaName, type, season, episode);
    if (!targetPageUrl) {
       return res.json({ streams: [] });
    }

    // 3. تحليل الصفحة وجلب روابط البث (mp4 و m3u8)
    const html = await fetchHtml(targetPageUrl);
    if (!html) return res.json({ streams: [] });

    const $ = load(html);
    const streams = [];

    // فحص جميع عناصر الفيديو، المشغلات، الروابط، والإطارات في الصفحة
    $("iframe, a, source, video").each((_i, el) => {
      let src = $(el).attr("src") || $(el).attr("href") || $(el).attr("data-src") || $(el).attr("data-link");
      
      if (src) {
        if (src.startsWith("//")) src = `https:${src}`;
        if (src.startsWith("/")) src = `${BASE_URL}${src}`;

        // فلترة الروابط المستهدفة بناءً على المصادر المرفقة وسيرفرات البث المعروفة للموقع
        if (
          src.includes(".m3u8") || 
          src.includes(".mp4") || 
          src.includes("boutique") || 
          src.includes("tnmr.org") || 
          src.includes("vmwesa.online") || 
          src.includes("r66nv9ed.com")
        ) {
          streams.push({
            title: `🎬 Asd Pics - جودة متعددة (${src.includes("mp4") ? "MP4" : "HLS/M3U8"})`,
            url: src,
            behaviorHints: {
              notWebReady: !src.includes("mp4"), // روابط HLS تحتاج مشغل خارجي في بعض الأجهزة
              referer: targetPageUrl
            }
          });
        }
      }
    });

    res.json({ streams });
  } catch (err) {
    console.error("حدث خطأ أثناء معالجة البث:", err);
    res.status(500).json({ streams: [] });
  }
});

// ─── دالة جلب الاسم العربي من TMDB ───
async function getArabicNameFromTMDB(imdbId, type) {
  try {
    const tmdbType = type === "movie" ? "movie" : "tv";
    // استخدام مفتاح TMDB عام أو يمكنك استبداله بمفتاحك الخاص
    const tmdbUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=f090bb54758cabaf2312cdbf31fa6e55&external_source=imdb_id&language=ar`;
    
    const res = await fetch(tmdbUrl);
    const data = await res.json();
    
    const results = data.movie_results || data.tv_results;
    if (results && results.length > 0) {
      return results[0].title || results[0].name;
    }
  } catch (e) {
    console.error("فشل جلب الاسم من TMDB:", e);
  }
  return null;
}

// ─── دالة البحث داخل الموقع للحصول على رابط الصفحة المباشر ───
async function searchInSite(keyword, type, season, episode) {
  // صياغة رابط البحث المناسب لمحرك بحث الموقع
  const searchUrl = `${BASE_URL}/home7/?story=${encodeURIComponent(keyword)}&do=search&subaction=search`;
  const html = await fetchHtml(searchUrl);
  if (!html) return null;

  const $ = load(html);
  let matchedUrl = null;

  // البحث عن أول رابط مقال أو تدوينة يطابق اسم المحتوى
  $("a").each((_i, el) => {
    const text = $(el).text().trim().toLowerCase();
    const href = $(el).attr("href");

    if (href && text.includes(keyword.toLowerCase())) {
      matchedUrl = href;
      return false; // إيقاف البحث عند أول نتيجة متوافقة
    }
  });

  // إذا كان مسلسلاً، نحاول توجيه الرابط لصفحة الحلقة مباشرة
  if (matchedUrl && type === "series" && episode) {
    const pageHtml = await fetchHtml(matchedUrl);
    if (pageHtml) {
      const $page = load(pageHtml);
      $page("a").each((_i, el) => {
        const linkText = $page(el).text().trim();
        const linkHref = $page(el).attr("href");
        
        // البحث عن الحلقة المطلوبة في الصفحة (مثل: "الحلقة 5" أو "الحلقة الخامسة" أو صيغة "1x5")
        if (linkHref && (linkText.includes(`الحلقة ${episode}`) || linkText.includes(`${season}x${episode}`))) {
          matchedUrl = linkHref;
          return false;
        }
      });
    }
  }

  return matchedUrl;
}

app.listen(PORT, () => {
  console.log(`Addon successfully running on port ${PORT}`);
});
