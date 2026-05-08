const STOPWORDS = new Set([
  'min', 'max', 'sec', 'the', 'and', 'for', 'with', 'bez',
  'part', 'vol', 'day', 'week', 'beactivetv', 'mp4', 'mkv', 'avi', 'mov', 'webm',
  'trening', 'exercise', 'minut', 'minuty', 'i'
]);

const SECTION_WORDS = new Set([
  'rozgrzewka', 'wyciszenie', 'stretching', 'warmup', 'cooldown', 'mobility'
]);

function extractKeywords(text) {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOPWORDS.has(w));
}

function matchVideo(name, videos) {
  const targetKeys = extractKeywords(name);
  if (!targetKeys.length) return null;

  let bestVideo = null;
  let bestScore = -1000;
  let maxMatches = 0;

  for (const v of videos) {
    const videoKeys = extractKeywords(v.filename);
    if (!videoKeys.length) continue;

    let matches = 0;
    for (const k of targetKeys) if (videoKeys.includes(k)) matches++;
    if (matches === 0) continue;

    let penalty = 0;
    for (const k of videoKeys) {
      if (SECTION_WORDS.has(k) && !targetKeys.includes(k)) {
        penalty += 2.0;
      }
    }

    const filteredVideoKeys = videoKeys.filter(k => 
      targetKeys.includes(k) || !/^\d+$/.test(k)
    );
    const precision = matches / filteredVideoKeys.length;
    const score = precision - penalty;
    
    if (matches > maxMatches) {
      maxMatches = matches;
      bestScore = score;
      bestVideo = v.filename;
    } else if (matches === maxMatches && score > bestScore) {
      bestScore = score;
      bestVideo = v.filename;
    }
  }

  return bestVideo;
}

const videos = [
  { filename: "Mission Beach Body BeActiveTV.mp4" },
  { filename: "Mission Beach Body II BeActiveTV (4 i 16).mp4" },
  { filename: "Mission beach body II - wyciszenie BeActiveTV.mp4" },
  { filename: "Summer Body HIIT BeActiveTV (3 i 11).mp4" },
  { filename: "Summer body HIIT - rozgrzewka BeActiveTV.mp4" }
];

const testCases = [
  "Mission Beach Body",
  "Mission Beach Body II",
  "Summer Body HIIT"
];

testCases.forEach(name => {
  const matched = matchVideo(name, videos);
  console.log(`Workout: "${name}" -> Matched Video: "${matched}"`);
});
