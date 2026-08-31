import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import https from 'node:https';

const baseUrl = 'https://www.metacritic.com/browse/game/';
const outputPath = resolve('src/data/metacritic-games.json');
const firstPage = Number.parseInt(process.env.METACRITIC_START_PAGE ?? '1', 10);
const pageCount = Number.parseInt(process.env.METACRITIC_PAGES ?? '598', 10);
const concurrency = Math.min(6, Math.max(1, Number.parseInt(process.env.METACRITIC_CONCURRENCY ?? '4', 10)));

function fetchPage(page) {
  return new Promise((resolveRequest, reject) => {
    const request = https.get(`${baseUrl}?page=${page}`, {
      headers: { 'User-Agent': 'GameWheelCatalogBuilder/1.0 (+local catalog refresh)' }
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => response.statusCode === 200 ? resolveRequest(body) : reject(new Error(`Page ${page}: HTTP ${response.statusCode}`)));
    });
    request.setTimeout(30_000, () => request.destroy(new Error(`Page ${page}: timeout`)));
    request.on('error', reject);
  });
}

function decode(value) {
  return value.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
}

function parseGames(html) {
  const games = [];
  const pattern = /<img[^>]+alt="([^"]+)"[^>]+src="([^"]+)"[^>]*>[\s\S]{0,2400}?data-title="([^"]+)"/g;
  for (const match of html.matchAll(pattern)) {
    const title = decode(match[3]).trim();
    const image = decode(match[2]).trim();
    if (title && image.startsWith('https://www.metacritic.com/')) games.push({ title, image });
  }
  return games;
}

async function main() {
  const allGames = new Map();
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    JSON.parse(await readFile(outputPath, 'utf8')).forEach(game => allGames.set(game.title.toLocaleLowerCase(), game));
  } catch { /* A missing catalog starts empty. */ }
  let nextPage = firstPage;
  let completed = 0;
  const saveCatalog = () => writeFile(outputPath, `${JSON.stringify([...allGames.values()].sort((left, right) => left.title.localeCompare(right.title)))}\n`);
  async function worker() {
    while (nextPage <= pageCount) {
      const page = nextPage++;
      const games = parseGames(await fetchPage(page));
      games.forEach(game => allGames.set(game.title.toLocaleLowerCase(), game));
      completed += 1;
      if (completed % 25 === 0 || page === pageCount) {
        await saveCatalog();
        console.log(`Metacritic: сторінки ${firstPage}–${pageCount}, виконано ${completed}; у каталозі ${allGames.size} ігор.`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await saveCatalog();
  console.log(`Каталог записано: ${allGames.size} ігор → ${outputPath}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
