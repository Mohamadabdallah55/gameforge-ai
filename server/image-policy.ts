export function blockedImageOrigin(...values: (string | undefined)[]) {
  const patron =
    /(?:wikipedia|wikimedia|wikimedia-commons|wikipedia-commons|wikimedia_commons|wikidata|mediawiki|wikisource|wikinews|wikivoyage|wiktionary|wikibooks|wikiquote|wikiversity|wikifunctions|wikimediafoundation|wmflabs|wmcloud|w\.wiki)/i;
  return values.some((raw) => {
    if (!raw) return false;
    let text = raw;
    for (let i = 0; i < 3; i++) {
      try {
        text = decodeURIComponent(text);
      } catch {
        break;
      }
    }
    return patron.test(text);
  });
}
