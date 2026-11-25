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

// Each axis starts with Any, followed by A–Z. Lowercase boundaries outside a–z match only Any.
const letters = ['', ...'abcdefghijklmnopqrstuvwxyz'];
const axisSize = letters.length;

function countFilters(names) {
    const counts = new Uint32Array(axisSize ** 2);
    for (const name of names) {
        const start = letters.indexOf(name[0]);
        const end = letters.indexOf(name.at(-1));
        counts[0]++;
        if (start > 0) counts[start * axisSize]++;
        if (end > 0) counts[end]++;
        if (start > 0 && end > 0) counts[start * axisSize + end]++;
    }
    return counts;
}

function packCounts(counts) {
    // Positive values are counts. Negative values skip zeros, and trailing zeros are implicit.
    const packed = [];
    let zeros = 0;
    for (const count of counts) {
        if (count === 0) {
            zeros++;
        } else {
            if (zeros) packed.push(-zeros);
            packed.push(count);
            zeros = 0;
        }
    }
    return packed;
}

function verifyCounts(packed, names, label, distinct = false) {
    const decoded = packed.flatMap(value => value < 0 ? Array(-value).fill(0) : [value]);
    if (decoded.length > axisSize ** 2) throw new Error(`Too many filter counts for ${label}`);
    for (const [row, start] of letters.entries()) {
        const startingNames = names.filter(name => name.startsWith(start));
        for (const [column, end] of letters.entries()) {
            const matches = startingNames.filter(name => name.endsWith(end));
            const expected = distinct ? new Set(matches).size : matches.length;
            const actual = decoded[row * axisSize + column] ?? 0;
            if (actual !== expected) {
                throw new Error(`Incorrect filter count for ${label}, ${start || 'Any'}…${end || 'Any'}: ${actual}, expected ${expected}`);
            }
        }
    }
}

const namesByCountry = countries.map(([, cities]) => cities.map(city => city.toLowerCase()));
const pairNames = namesByCountry.flat();
const distinctNames = [...new Set(pairNames)];
const distinctCounts = countFilters(distinctNames);
const countsByCountry = namesByCountry.map(countFilters);
const filterCounts = {
    worldwideNames: packCounts(distinctCounts),
    worldwidePairs: packCounts(countFilters(pairNames)),
    byCountry: countsByCountry.map(packCounts)
};

if (check) {
    verifyCounts(filterCounts.worldwideNames, pairNames, 'Any Country', true);
    verifyCounts(filterCounts.worldwidePairs, pairNames, 'Place and Country');
    filterCounts.byCountry.forEach((packed, index) => verifyCounts(packed, namesByCountry[index], countries[index][0]));
}

function eligibleStarts(counts) {
    return letters.filter((letter, index) => letter && counts[index * axisSize] >= 60).join('').toUpperCase();
}

const worldwide = eligibleStarts(distinctCounts);
const regions = countsByCountry.flatMap((counts, index) => {
    const starts = eligibleStarts(counts);
    return starts ? [[index, starts]] : [];
});
if (!worldwide) throw new Error('The daily challenge needs a starting letter with at least 60 distinct places');
const catalog = JSON.stringify({
    revision,
    countries: countries.map(([country]) => country),
    dailyStarts: { worldwide, regions },
    filterCounts
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
