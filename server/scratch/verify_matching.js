const STOPWORDS = new Set([
  'min', 'max', 'sec', 'the', 'and', 'for', 'with', 'bez',
  'part', 'vol', 'day', 'week', 'beactivetv', 'mp4', 'mkv', 'avi', 'mov', 'webm',
  'trening', 'exercise', 'minut', 'minuty'
]);

function extractKeywords(text) {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOPWORDS.has(w));
}

const testCases = [
  { tsv: "Target - Jędrne Pośladki", file: "Target - jędrne pośladki BeActiveTV (5 i 20).mp4" },
  { tsv: "Mission Beach Body", file: "Mission Beach Body BeActiveTV.mp4" },
  { tsv: "Best Self Max - Max Strength", file: "Best self max Max strength BeActiveTV.mp4" },
  { tsv: "Summer Body HIIT", file: "Summer Body HIIT BeActiveTV (3 i 11).mp4" }
];

testCases.forEach(({ tsv, file }) => {
  const tKeys = extractKeywords(tsv);
  const fKeys = extractKeywords(file);
  const matches = tKeys.filter(k => fKeys.includes(k));
  const precision = matches.length / fKeys.length;
  const score = precision + matches.length * 0.01;
  
  console.log(`TSV: "${tsv}"`);
  console.log(`File: "${file}"`);
  console.log(`TKeys: [${tKeys.join(', ')}]`);
  console.log(`FKeys: [${fKeys.join(', ')}]`);
  console.log(`Matches: ${matches.length}, Score: ${score.toFixed(4)}`);
  console.log('---');
});
