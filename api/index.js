const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7001;
const TMDB_KEY = "f090bb54758cabaf2312cdbf31fa6e55";

// هوية الإضافة لستريمو
const manifest = {
  id: "community.asdpics.abdulluhx",
  version: "1.6.0",
  name: "Asd Pics by Abdulluh.X",
  description: "إضافة لمتابعة وسحب البث من سيرفرات عرب سيد والمشغل الرئيسي مباشرة",
  logo: "https://asd.pics/templates/Default/images/logo.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// جلب تفاصيل المادة من TMDB للبحث والتوجيه الاحتياطي
async function getTmdbMeta(imdbId, type) {
  try {
    const tmdbType = type === "movie" ? "movie" : "tv";
    const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`;
    const res = await fetch(findUrl);
    const data = await res.json();
    
    const result = (data.movie_results && data.movie_results[0]) || (data.tv_results && data.tv_results[0]);
    if (!result) return null;
    
    const detailsUrl = `https://api.themoviedb.org/3/${tmdbType}/${result.id}?api_key=${TMDB_KEY}&language=ar-SA`;
    const detailsRes = await fetch(detailsUrl);
    const arData = await detailsRes.json();
    
    return {
      arabicTitle: arData.name || arData.title || result.name || result.title || "",
      englishTitle: result.name || result.title || ""
    };
  } catch (e) {
    return null;
  }
}

// بناء وتوجيه روابط البث المباشرة بناءً على السيرفر الفعلي للموقع (reviewrate)
async function getAsdPicsStreams(imdbId, type, season, episode) {
  const meta = await getTmdbMeta(imdbId, type);
  const streams = [];

  // 1. الرابط الفعلي والأساسي للمشغل التابع لعرب سيد (m.reviewrate.net)
  // يتم بناؤه وتمريره مباشرة ليعمل داخل مشغل ستريمو أو مشغل خارجي
  const embedUrl = `https://m.reviewrate.net/watch/${imdbId}`; 

  streams.push({
    name: "Arabseed | عرب سيد",
    title: `🎬 سيرفر المشاهدة الرئيسي (مباشر وسريع)`,
    url: embedUrl,
    behaviorHints: {
      notWebReady: false,
      headers: {
        "Referer": "https://asd.pics/",
        "Origin": "https://asd.pics"
      }
    }
  });

  // 2. توفير خيار البحث المباشر في المتصفح لتفادي مشاكل الحظر المؤقت
  if (meta) {
    const queryTitle = meta.arabicTitle || meta.englishTitle;
    const webSearchUrl = `https://asd.pics/home7/?story=${encodeURIComponent(queryTitle)}&do=search&subaction=search`;
    
    streams.push({
      name: "Arabseed | المتصفح",
      title: `🌐 افتح صفحة المادة مباشرة في المتصفح`,
      externalUrl: webSearchUrl,
      behaviorHints: {
        notWebReady: false
      }
    });
  }

  return streams;
}

// مسارات ستريمو
app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

app.get("/", (req, res) => {
  res.json(manifest);
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const parts = id.split(":");
  const imdbId = parts[0];
  const season = parseInt(parts[1] || "1");
  const episode = parseInt(parts[2] || "1");

  try {
    const streams = await getAsdPicsStreams(imdbId, type, season, episode);
    res.json({ streams });
  } catch (e) {
    res.json({ streams: [] });
  }
});

module.exports = app;
