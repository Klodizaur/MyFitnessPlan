const STOPWORDS = new Set([
  'min', 'max', 'sec', 'the', 'and', 'for', 'with', 'bez',
  'part', 'vol', 'day', 'week'
]);

function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśźż]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOPWORDS.has(w));
}

const tsvName = "Target - Jędrne Pośladki";
const fileName = "Target - jędrne pośladki BeActiveTV (5 i 20).mp4";

console.log("TSV Keywords:", extractKeywords(tsvName));
console.log("File Keywords:", extractKeywords(fileName));

const tsvNFC = tsvName.normalize('NFC');
const fileNFC = fileName.normalize('NFC');

console.log("TSV NFC Keywords:", extractKeywords(tsvNFC));
console.log("File NFC Keywords:", extractKeywords(fileNFC));
