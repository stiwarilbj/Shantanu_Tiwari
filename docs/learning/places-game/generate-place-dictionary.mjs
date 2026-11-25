import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';

const sourceFile = new URL('./PlacesData.js', import.meta.url);
const pageFile = new URL('./index.html', import.meta.url);
const worldFile = new URL('./places/world.json', import.meta.url);
const countryDirectory = new URL('./places/countries/', import.meta.url);
const source = readFileSync(sourceFile, 'utf8').trimEnd();
const declaration = 'const citiesData = ';

if (!source.startsWith(declaration) || !source.endsWith(';')) {
    throw new Error('Expected PlacesData.js to contain a citiesData array');
}

const places = JSON.parse(source.slice(declaration.length, -1));
const forbiddenCharacters = /[\\/]/;
const seen = new Set();
const countryIndexes = new Map();
const countries = [];
const runs = [];

for (const place of places) {
    if (typeof place.city !== 'string' || typeof place.country_name !== 'string') continue;

    const city = place.city.trim();
    const country = place.country_name.trim();
    if (!city || !country || forbiddenCharacters.test(city) || forbiddenCharacters.test(country)) continue;

    // Match the original browser cleanup, which kept the first spelling for each pair.
    const key = `${city.toLowerCase()}|${country.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!countryIndexes.has(country)) {
        countryIndexes.set(country, countries.length);
        countries.push([country, []]);
    }

    const countryIndex = countryIndexes.get(country);
    countries[countryIndex][1].push(city);

    // Record consecutive places from each country so matching keeps its original order.
    const lastRun = runs.at(-1);
    if (lastRun?.[0] === countryIndex) {
        lastRun[1]++;
    } else {
        runs.push([countryIndex, 1]);
    }
}

const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === '--check';
if (args.length && !check) {
    throw new Error('Usage: node generate-place-dictionary.mjs [--check]');
}

const world = JSON.stringify({ countries, runs }) + '\n';
const revision = createHash('sha256').update(world).digest('hex').slice(0, 16);
// Count distinct city answers, since a place-only round scores a shared name once.
function eligibleStarts(cities) {
    const counts = new Map();
    for (const city of new Set(cities.map(city => city.toLowerCase()))) {
        const start = city[0];
        counts.set(start, (counts.get(start) ?? 0) + 1);
    }
    return Array.from('abcdefghijklmnopqrstuvwxyz').filter(start => counts.get(start) >= 60).join('').toUpperCase();
}

const worldwide = eligibleStarts(countries.flatMap(([, cities]) => cities));
const regions = countries.flatMap(([, cities], index) => {
    const starts = eligibleStarts(cities);
    return starts ? [[index, starts]] : [];
});
if (!worldwide) throw new Error('The daily challenge needs a starting letter with at least 60 distinct places');
const catalog = JSON.stringify({
    revision,
    countries: countries.map(([country]) => country),
    dailyStarts: { worldwide, regions }
}).replaceAll('<', '\\u003c');
const catalogTag = /(<script type="application\/json" id="countryCatalog">)[^<]*(<\/script>)/;
const page = readFileSync(pageFile, 'utf8');
if (!catalogTag.test(page)) throw new Error('Missing countryCatalog in index.html');
const updatedPage = page.replace(catalogTag, (_, opening, closing) => opening + catalog + closing);

if (!check) mkdirSync(countryDirectory, { recursive: true });
const outputs = new Map([[pageFile, updatedPage], [worldFile, world]]);
const countryFiles = new Set();
countries.forEach((group, index) => {
    const filename = `${index}.json`;
    countryFiles.add(filename);
    outputs.set(new URL(filename, countryDirectory), JSON.stringify(group) + '\n');
});

for (const [file, contents] of outputs) {
    if (check) {
        if (readFileSync(file, 'utf8') !== contents) {
            throw new Error(`${file.pathname} is out of date. Run node generate-place-dictionary.mjs`);
        }
    } else {
        writeFileSync(file, contents);
    }
}
for (const filename of readdirSync(countryDirectory)) {
    if (!/^\d+\.json$/.test(filename) || countryFiles.has(filename)) continue;
    if (check) throw new Error(`Unneeded country dictionary ${filename}. Run node generate-place-dictionary.mjs`);
    unlinkSync(new URL(filename, countryDirectory));
}

console.log(`${seen.size} playable places across ${countries.length} countries, ${Buffer.byteLength(world)} worldwide bytes`);
