const STOPWORDS = new Set([
  'min', 'max', 'sec', 'the', 'and', 'for', 'with', 'bez',
  'part', 'vol', 'day', 'week', 'beactivetv', 'mp4', 'mkv', 'avi', 'mov', 'webm',
  'trening', 'exercise', 'minut', 'minuty', 'i'
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
  let bestScore = -1;
  let maxMatches = 0;

  for (const v of videos) {
    const videoKeys = extractKeywords(v.filename);
    if (!videoKeys.length) continue;

    let matches = 0;
    for (const k of targetKeys) if (videoKeys.includes(k)) matches++;
    if (matches === 0) continue;

    const precision = matches / videoKeys.length;
    
    if (matches > maxMatches) {
      maxMatches = matches;
      bestScore = precision;
      bestVideo = v.filename;
    } else if (matches === maxMatches && precision > bestScore) {
      bestScore = precision;
      bestVideo = v.filename;
    }
  }

  return bestVideo;
}

const videos = [
  { filename: "Mission Beach Body BeActiveTV.mp4" },
  { filename: "Mission Beach Body II BeActiveTV (4 i 16).mp4" }
];

const testCases = [
  "Mission Beach Body",
  "Mission Beach Body II"
];

testCases.forEach(name => {
  const matched = matchVideo(name, videos);
  console.log(`Workout: "${name}" -> Matched Video: "${matched}"`);
});
