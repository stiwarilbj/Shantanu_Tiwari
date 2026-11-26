let catalog;
let countryIndexes;
let setupPool;
let round;
const MAX_CACHED_ROUND_INDEXES = 2;
const roundIndexes = new Map();
const loadedPlaces = new Map();
const pendingLoads = new Map();
const preparedCountries = new Map();
const activeRequests = new Set();
const nonAscii = /[^\x00-\x7f]/u;
const countryAliases = new Map([
    ['us', 'united states'], ['usa', 'united states'],
    ['u.s.', 'united states'], ['u.s.a.', 'united states'],
    ['united states of america', 'united states'],
    ['uk', 'united kingdom'], ['u.k.', 'united kingdom'],
    ['uae', 'united arab emirates'], ['u.a.e.', 'united arab emirates'],
    ['czechia', 'czech republic'], ['turkiye', 'turkey'],
    ['brasil', 'brazil'], ['bahamas', 'the bahamas'],
    ['ivory coast', "cote d'ivoire (ivory coast)"],
    ["cote d'ivoire", "cote d'ivoire (ivory coast)"],
    ['cote d’ivoire', "cote d'ivoire (ivory coast)"]
]);

self.addEventListener('message', async ({ data: { id, type, ...payload } }) => {
    if (type === 'init') {
        catalog = payload.catalog;
        countryIndexes = new Map(catalog.countries.map((country, index) => [country, index]));
        return;
    }
    if (type === 'cancel') {
        activeRequests.delete(id);
        return;
    }
    if (type === 'clearRound') {
        round = undefined;
        return;
    }

    activeRequests.add(id);
    const cancelled = () => !activeRequests.has(id);
    try {
        const result = await runRequest(type, payload, id, cancelled);
        if (!cancelled()) self.postMessage({ id, result });
    } catch (error) {
        if (!cancelled()) self.postMessage({ id, error: error.message });
    } finally {
        activeRequests.delete(id);
    }
});

async function runRequest(type, payload, id, cancelled) {
    const { filters, roundId, needsCountry, guess, includeFeedback, savedGuesses, spelling = 'standard' } = payload;
    switch (type) {
        case 'setup':
            return (await getSetupPlaces(filters)).length;
        case 'round': {
            const key = poolKey(filters);
            const cacheKey = JSON.stringify([catalog.revision, key, needsCountry, spelling]);
            let index = roundIndexes.get(cacheKey);
            if (index) {
                roundIndexes.delete(cacheKey);
            } else {
                const places = await getSetupPlaces(filters);
                if (cancelled()) return;
                const lookup = await indexRound(places, needsCountry, spelling, cancelled);
                if (cancelled()) return;
                index = { key, places, needsCountry, spelling, ...lookup };
            }
            // Keep dictionary positions and their ordered place list together across attempts.
            roundIndexes.set(cacheKey, index);
            if (roundIndexes.size > MAX_CACHED_ROUND_INDEXES) {
                roundIndexes.delete(roundIndexes.keys().next().value);
            }
            round = { ...index, id: roundId };
            const { places, groups } = index;
            if (savedGuesses) {
                const guesses = savedGuesses.flatMap(({ city, country }) => {
                    const countryKey = needsCountry || allowsMissingAccents(spelling) ? nameKey(country, spelling) : '';
                    const group = groups.get(countryKey);
                    const place = places[group?.byName.get(nameKey(city, spelling))];
                    return place ? [{ city: place.city, country: place.country.name }] : [];
                });
                return { count: places.length, guesses };
            }
            return places.length;
        }
        case 'guess': {
            if (round?.id !== roundId) throw new Error('Round index is unavailable');
            const result = round.spelling === 'standard' ? checkGuess(round, guess) : checkSpellingGuess(round, guess);
            if (!result.place) return includeFeedback ? result : null;
            const place = displayPlace(result.place);
            return includeFeedback ? { ...result, place } : place;
        }
        case 'review':
            return reviewExclusions(payload, cancelled);
        case 'examples':
        case 'clue': {
            const places = round && round.id === roundId ? round.places : await getSetupPlaces(filters);
            if (cancelled()) return;
            if (type === 'clue') return findClue(places, payload);
            return samplePlaces(places, 8).map(displayPlace);
        }
        case 'search': {
            const places = await loadPlaces(filters.country);
            if (cancelled()) return;
            self.postMessage({ id, progress: 'Searching…' });
            return (await searchPlaces(places, filters, cancelled))?.map(displayPlace);
        }
        default:
            throw new Error('Unknown place dictionary request');
    }
}

function displayPlace({ city, country }) {
    return { city, country_name: country.name };
}

function findClue(places, { needsCountry, guessed, spelling }) {
    const excluded = new Set(guessed);
    const identitySpelling = spelling === 'accent-friendly' ? spelling : 'standard';
    const first = Math.floor(Math.random() * places.length);
    for (let offset = 0; offset < places.length; offset++) {
        const place = places[(first + offset) % places.length];
        // Use the same identity as scoring, including shared names in Place and Country mode.
        const name = dictionaryNameKey(place, identitySpelling);
        const answerKey = needsCountry ? JSON.stringify([name, dictionaryNameKey(place.country, identitySpelling)]) : name;
        if (!excluded.has(answerKey)) {
            return [{ answerKey, country: place.country.name, letters: place.city.match(/\p{L}/gu)?.length ?? 0 }];
        }
    }
    return [];
}

async function visitInBatches(items, visit, cancelled = () => false) {
    let deadline = performance.now() + 4;
    let visited = 0;
    for (const item of items) {
        visit(item, visited++);
        if (visited % 256 === 0 && performance.now() >= deadline) {
            // Let incoming messages, including guesses and cancellations, run between batches.
            await new Promise(resolve => setTimeout(resolve, 0));
            if (cancelled()) return;
            deadline = performance.now() + 4;
        }
    }
}

function storeComposedName(record) {
    const composed = record.lower.normalize();
    if (composed !== record.lower) record.composed = composed;
    return record;
}

function prepareCountry(name, cities) {
    const known = preparedCountries.get(name);
    if (known) return known;

    // A region and the worldwide dictionary can share this work while either is loading.
    const country = storeComposedName({ name, lower: name.toLowerCase() });
    const places = [];
    const preparation = visitInBatches(cities, city => {
        places.push(storeComposedName({ city, lower: city.toLowerCase(), country }));
    }).then(() => places).catch(error => {
        preparedCountries.delete(name);
        throw error;
    });
    preparedCountries.set(name, preparation);
    return preparation;
}

function* inDictionaryOrder(placesByCountry, runs) {
    const nextCityIndexes = placesByCountry.map(() => 0);
    for (const [countryIndex, count] of runs) {
        const places = placesByCountry[countryIndex];
        const first = nextCityIndexes[countryIndex];
        const end = first + count;
        for (let index = first; index < end; index++) yield places[index];
        nextCityIndexes[countryIndex] = end;
    }
}

function loadPlaces(country) {
    if (loadedPlaces.has(country)) return Promise.resolve(loadedPlaces.get(country));
    if (pendingLoads.has(country)) return pendingLoads.get(country);

    const worldwide = country === 'any';
    const file = worldwide ? 'world.json' : `countries/${countryIndexes.get(country)}.json`;
    self.postMessage({ dictionary: country, state: 'loading' });
    const request = fetch(`places/${file}?v=${catalog.revision}`).then(async response => {
        if (!response.ok) throw new Error(`Place download failed with HTTP ${response.status}`);

        const data = await response.json();
        if (worldwide) {
            const placesByCountry = [];
            for (const [name, cities] of data.countries) {
                placesByCountry.push(await prepareCountry(name, cities));
            }
            const places = [];
            await visitInBatches(inDictionaryOrder(placesByCountry, data.runs), place => places.push(place));
            for (const [index, [name]] of data.countries.entries()) loadedPlaces.set(name, placesByCountry[index]);
            loadedPlaces.set(country, places);
        } else {
            const [name, cities] = data;
            if (name !== country || !Array.isArray(cities)) throw new Error('Unexpected country dictionary');
            loadedPlaces.set(country, await prepareCountry(name, cities));
        }
        self.postMessage({ dictionary: country, state: 'ready' });
        return loadedPlaces.get(country);
    }).catch(error => {
        // A concurrent worldwide load may already have provided this country.
        if (loadedPlaces.has(country)) return loadedPlaces.get(country);
        self.postMessage({ dictionary: country, state: 'failed' });
        throw error;
    }).finally(() => pendingLoads.delete(country));

    pendingLoads.set(country, request);
    return request;
}

function matchesFilters(place, country, start, end) {
    if (country !== 'any' && place.country.name !== country) return false;
    if (!start && !end) return true;
    return place.lower.startsWith(start) && place.lower.endsWith(end);
}

function poolKey({ country, start, end }) {
    return JSON.stringify([country, start, end]);
}

function getSetupPlaces(filters) {
    const { country, start, end } = filters;
    const key = poolKey(filters);
    if (setupPool?.key === key) return setupPool.promise;

    const promise = loadPlaces(country).then(async dictionary => {
        if (!start && !end) return dictionary;
        const places = [];
        await visitInBatches(dictionary, place => {
            if (matchesFilters(place, country, start, end)) places.push(place);
        });
        return places;
    }).catch(error => {
        if (setupPool?.promise === promise) setupPool = undefined;
        throw error;
    });
    setupPool = { key, promise };
    return promise;
}

function nameKey(name, spelling) {
    const lower = name.toLowerCase();
    return spelling === 'standard' ? lower : lower.normalize();
}

function dictionaryNameKey(record, spelling) {
    return spelling === 'standard' ? record.lower : record.composed ?? record.lower;
}

function foldName(name) {
    return name.normalize('NFD').replace(/\p{M}/gu, '');
}

function foldedDictionaryName(record) {
    if (record.folded !== undefined) return record.folded;
    const name = dictionaryNameKey(record);
    if (!nonAscii.test(name)) return name;
    record.folded = foldName(name);
    return record.folded;
}

function allowsMissingAccents(spelling) {
    return spelling === 'accent-friendly' || spelling === 'relaxed';
}

async function indexRound(places, needsCountry, spelling, cancelled) {
    const groups = new Map();
    const useAccentLookup = allowsMissingAccents(spelling);
    const useTypoLookup = spelling === 'standard' || spelling === 'relaxed';
    const foldedNames = useAccentLookup ? new Map() : null;
    await visitInBatches(places, (place, index) => {
        const country = needsCountry || useAccentLookup ? dictionaryNameKey(place.country, spelling) : '';
        let group = groups.get(country);
        if (!group) {
            group = { byName: new Map(), byLength: new Map() };
            groups.set(country, group);
        }
        const city = dictionaryNameKey(place, spelling);
        if (group.byName.has(city)) return;

        group.byName.set(city, index);
        if (useTypoLookup) {
            if (!group.byLength.has(city.length)) group.byLength.set(city.length, []);
            group.byLength.get(city.length).push(city);
        }
        if (useAccentLookup) {
            const key = foldedDictionaryName(place);
            const existing = foldedNames.get(key);
            if (existing === undefined) foldedNames.set(key, index);
            else if (Array.isArray(existing)) existing.push(index);
            else foldedNames.set(key, [existing, index]);
        }
    }, cancelled);
    return { groups, foldedNames };
}

async function searchPlaces(dictionary, filters, cancelled) {
    const { country, start, end, minLength, maxLength, includeTerms, excludeTerms } = filters;
    const limit = 100;
    const hasTerms = includeTerms.length > 0 || excludeTerms.length > 0;
    const key = poolKey(filters);
    let knownPool = null;
    if (!start && !end) knownPool = dictionary;
    else if (round?.key === key) knownPool = round.places;
    else if (setupPool?.key === key) knownPool = await setupPool.promise;

    if (cancelled()) return;
    if (knownPool && !hasTerms && minLength === 0 && maxLength === Infinity) {
        return samplePlaces(knownPool, limit);
    }

    const results = [];
    let matches = 0;
    await visitInBatches(knownPool ?? dictionary, place => {
        if (!knownPool && !matchesFilters(place, country, start, end)) return;
        if (place.city.length < minLength || place.city.length > maxLength) return;
        if (hasTerms) {
            const matchesTerm = term => place.lower.includes(term) || place.country.lower.includes(term);
            if (!includeTerms.every(matchesTerm) || excludeTerms.some(matchesTerm)) return;
        }

        // Each match has the same chance of appearing in the bounded sample.
        matches++;
        if (results.length < limit) results.push(place);
        else {
            const slot = Math.floor(Math.random() * matches);
            if (slot < results.length) results[slot] = place;
        }
    }, cancelled);
    return shuffle(results);
}

function samplePlaces(places, limit) {
    // Floyd sampling draws distinct indexes with one lookup per result.
    const indexes = new Set();
    for (let index = Math.max(0, places.length - limit); index < places.length; index++) {
        const picked = Math.floor(Math.random() * (index + 1));
        indexes.add(indexes.has(picked) ? index : picked);
    }
    return shuffle([...indexes].map(index => places[index]));
}

function shuffle(places) {
    for (let index = places.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [places[index], places[other]] = [places[other], places[index]];
    }
    return places;
}

function standardPairs(parts) {
    // Either name can contain commas, so try each possible separator.
    return parts.slice(0, -1).map((_, index) => [
        parts.slice(0, index + 1).join(', '),
        parts.slice(index + 1).join(', '),
    ]);
}

function checkGuess({ places, groups, needsCountry }, guess) {
    const lowerGuess = guess.toLowerCase();
    const parts = needsCountry ? lowerGuess.split(',').map(part => part.trim()) : [lowerGuess];
    if (needsCountry && parts.length < 2) return { reason: 'country' };

    const candidatePairs = needsCountry ? standardPairs(parts) : [[lowerGuess, '']];

    // When multiple splits match, keep the first answer in dictionary order.
    let firstIndex = Infinity;
    for (const [guessedCity, guessedCountry] of candidatePairs) {
        const index = groups.get(guessedCountry)?.byName.get(guessedCity);
        if (index !== undefined) firstIndex = Math.min(firstIndex, index);
    }
    if (firstIndex !== Infinity) return { place: places[firstIndex], match: 'exact' };

    for (const [guessedCity, guessedCountry] of candidatePairs) {
        for (const [country, group] of groups) {
            if (country !== guessedCountry && !isCloseMatch(country, guessedCountry)) continue;

            for (let length = guessedCity.length - 1; length <= guessedCity.length + 1; length++) {
                const cities = group.byLength.get(length);
                if (!cities) continue;
                for (const city of cities) {
                    if (city === guessedCity || isCloseMatch(city, guessedCity)) {
                        // Each bucket lists cities in dictionary order.
                        firstIndex = Math.min(firstIndex, group.byName.get(city));
                        break;
                    }
                }
            }
        }
    }
    if (firstIndex !== Infinity) return { place: places[firstIndex], match: 'corrected' };

    if (needsCountry) {
        if (!parts.at(-1)) return { reason: 'country' };
        // An exact city in a different country is a useful hint after both matching passes fail.
        for (const group of groups.values()) {
            if (candidatePairs.some(([city]) => group.byName.has(city))) return { reason: 'country' };
        }
    }
    return { reason: 'not-found' };
}

function splitNames(guess) {
    const pairs = [];
    for (let comma = guess.indexOf(','); comma !== -1; comma = guess.indexOf(',', comma + 1)) {
        const city = guess.slice(0, comma).trim();
        const country = guess.slice(comma + 1).trim();
        if (city && country) pairs.push([city, country]);
    }
    return pairs;
}

async function reviewExclusions({ filters, needsCountry, spelling, guesses }, cancelled) {
    const relaxed = spelling === 'relaxed';
    const useAccentLookup = allowsMissingAccents(spelling);
    const requests = new Map();
    const results = guesses.map(() => null);
    for (const [index, guess] of guesses.entries()) {
        const typed = nameKey(guess, spelling);
        const pairs = spelling === 'standard' ? standardPairs(typed.split(',').map(part => part.trim())) : splitNames(typed);
        const names = needsCountry ? pairs : [[typed, ''], ...pairs.filter(([, country]) => country)];
        for (const [city, country] of names) {
            if (!city || (needsCountry && !country)) continue;
            const key = useAccentLookup ? foldName(city) : city;
            const matches = requests.get(key) ?? [];
            matches.push({ index, city, country });
            requests.set(key, matches);
        }
    }
    if (!requests.size) return results;

    const { country, start, end } = filters;
    function inspect(place, foundLocally) {
        const city = dictionaryNameKey(place, spelling);
        const key = useAccentLookup ? foldedDictionaryName(place) : city;
        const matches = requests.get(key);
        if (!matches) return;
        const placeCountry = dictionaryNameKey(place.country, spelling);
        for (const match of matches) {
            const current = results[match.index];
            if (foundLocally?.has(match.index) || current?.length === 0) continue;
            if (useAccentLookup && !keepsTypedAccents(match.city, city, key)) continue;
            if (match.country && match.country !== placeCountry &&
                (!useAccentLookup || !matchesAccentCountry(match.country, place.country, relaxed))) continue;

            const excluded = [];
            if (!matchesFilters(place, country, '', '')) excluded.push('country');
            if (!matchesFilters(place, 'any', start, '')) excluded.push('start');
            if (!matchesFilters(place, 'any', '', end)) excluded.push('end');
            if (!current || excluded.length < current.length) results[match.index] = excluded;
        }
    }

    const dictionary = await loadPlaces(country);
    if (cancelled()) return;
    await visitInBatches(dictionary, place => inspect(place), cancelled);
    if (!cancelled() && country !== 'any' && results.some(result => result === null)) {
        const foundLocally = new Set(results.flatMap((result, index) => result ? [index] : []));
        const worldwide = await loadPlaces('any');
        if (cancelled()) return;
        await visitInBatches(worldwide, place => inspect(place, foundLocally), cancelled);
    }
    return results;
}

function foldedMatches(foldedNames, foldedCity) {
    const match = foldedNames.get(foldedCity);
    return Array.isArray(match) ? match : match === undefined ? [] : [match];
}

function keepsTypedAccents(typed, canonical, folded) {
    if (typed === folded) return true;
    const characters = Array.from(typed.normalize('NFD'));
    let next = 0;
    // Only a mark can be skipped. Each mark the player typed stays with its original letter.
    for (const character of canonical.normalize('NFD')) {
        if (character === characters[next]) next++;
        else if (!/\p{M}/u.test(character)) return false;
    }
    return next === characters.length;
}

function matchesAccentCountry(typed, country, relaxed) {
    const canonical = dictionaryNameKey(country);
    const folded = foldName(typed);
    const alias = relaxed ? countryAliases.get(folded) : undefined;
    return alias ? alias === canonical :
        foldedDictionaryName(country) === folded && keepsTypedAccents(typed, canonical, folded);
}

function findAccentAnswer({ places, foldedNames, needsCountry, spelling }, attempts) {
    const relaxed = spelling === 'relaxed';
    let match;
    for (const [city, country] of attempts) {
        const foldedCity = foldName(city);
        for (const index of foldedMatches(foldedNames, foldedCity)) {
            const place = places[index];
            const name = dictionaryNameKey(place);
            const countryName = dictionaryNameKey(place.country);
            if (country && !matchesAccentCountry(country, place.country, relaxed)) continue;
            if (!keepsTypedAccents(city, name, foldedCity)) continue;
            if (match) {
                if (match.index === index) continue;
                if (relaxed || needsCountry || match.name !== name) return { reason: 'ambiguous' };
                // A city shared by several countries scores once in Accent-friendly place-only rounds.
                if (match.index < index) continue;
            }
            const restoredAccent = city !== name ||
                (country && country !== countryName && foldName(country) === foldedDictionaryName(place.country));
            match = { index, name, accentCorrection: restoredAccent ? (country ? 'pair' : 'place') : undefined };
        }
    }
    if (!match) return null;
    const result = { place: places[match.index], match: 'corrected' };
    if (match.accentCorrection) result.accentCorrection = match.accentCorrection;
    return result;
}

// Keep Standard's one-edit allowance in Relaxed when it identifies one place.
function findRelaxedTypo({ groups, places }, attempts) {
    let match;
    for (const [city, country] of attempts) {
        const alias = countryAliases.get(foldName(country));
        for (const [countryName, group] of groups) {
            if (country && (alias ? countryName !== alias :
                countryName !== country && !isCloseMatch(countryName, country))) continue;
            for (let length = city.length - 1; length <= city.length + 1; length++) {
                for (const key of group.byLength.get(length) ?? []) {
                    if (key !== city && !isCloseMatch(key, city)) continue;
                    const index = group.byName.get(key);
                    if (match !== undefined && match !== index) return { reason: 'ambiguous' };
                    match = index;
                }
            }
        }
    }
    if (match !== undefined) return { place: places[match], match: 'corrected' };
    return null;
}

function checkSpellingGuess(round, guess) {
    const { groups, places, foldedNames, needsCountry, spelling } = round;
    const city = nameKey(guess.trim(), spelling);
    const pairs = splitNames(city);
    if (needsCountry && !pairs.length) return { reason: 'country' };

    if (!needsCountry) {
        const exactCity = !foldedNames ? groups.get('')?.byName.get(city) :
            foldedMatches(foldedNames, foldName(city)).find(index => dictionaryNameKey(places[index]) === city);
        if (exactCity !== undefined) return { place: places[exactCity], match: 'exact' };
    }

    if (needsCountry || foldedNames) {
        let exactPair = Infinity;
        for (const [city, country] of pairs) {
            const index = groups.get(country)?.byName.get(city);
            if (index !== undefined) exactPair = Math.min(exactPair, index);
        }
        if (exactPair !== Infinity) return { place: places[exactPair], match: 'exact' };
    }

    if (foldedNames) {
        const attempts = needsCountry ? pairs : [[city, ''], ...pairs];
        const accent = findAccentAnswer(round, attempts);
        if (accent) return accent;
        if (spelling === 'relaxed') {
            const typo = findRelaxedTypo(round, attempts);
            if (typo) return typo;
        }
    }

    if (needsCountry) {
        for (const [city] of pairs) {
            if (foldedNames) {
                const folded = foldName(city);
                if (foldedMatches(foldedNames, folded).some(index =>
                    spelling === 'relaxed' || keepsTypedAccents(city, dictionaryNameKey(places[index]), folded))) {
                    return { reason: 'country' };
                }
            } else {
                for (const group of groups.values()) {
                    if (group.byName.has(city)) return { reason: 'country' };
                }
            }
        }
    }
    return { reason: 'not-found' };
}

function isCloseMatch(first, second) {
    if (Math.abs(first.length - second.length) > 1) return false;
    if (first.length > second.length) [first, second] = [second, first];

    let firstIndex = 0;
    while (firstIndex < first.length && first[firstIndex] === second[firstIndex]) firstIndex++;
    if (firstIndex === first.length) return first.length !== second.length;

    // Skip the extra character in the longer string, or consume a substitution or swap.
    let secondIndex = firstIndex + 1;
    if (first.length === second.length) {
        if (first[firstIndex] === second[secondIndex] && first[secondIndex] === second[firstIndex]) {
            secondIndex++;
        }
        firstIndex = secondIndex;
    }

    while (firstIndex < first.length) {
        if (first[firstIndex] !== second[secondIndex]) return false;
        firstIndex++;
        secondIndex++;
    }
    return true;
}
