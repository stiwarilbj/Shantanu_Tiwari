let catalog;
let countryIndexes;
let setupPool;
let round;
const loadedPlaces = new Map();
const pendingLoads = new Map();
const activeRequests = new Set();

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

async function runRequest(type, { filters, roundId, needsCountry, guess }, id, cancelled) {
    switch (type) {
        case 'setup':
            return (await getSetupPlaces(filters)).length;
        case 'round': {
            const places = await getSetupPlaces(filters);
            if (cancelled()) return;
            const groups = await indexRound(places, needsCountry, cancelled);
            if (!cancelled()) round = { id: roundId, places, groups, needsCountry };
            return places.length;
        }
        case 'guess':
            if (round?.id !== roundId) throw new Error('Round index is unavailable');
            return findMatchingPlace(round, guess);
        case 'examples': {
            const places = round && round.id === roundId ? round.places : await getSetupPlaces(filters);
            if (cancelled()) return;
            // Floyd sampling selects up to eight distinct indexes without scanning the pool.
            const indexes = new Set();
            for (let index = Math.max(0, places.length - 8); index < places.length; index++) {
                const picked = Math.floor(Math.random() * (index + 1));
                indexes.add(indexes.has(picked) ? index : picked);
            }
            return shuffle([...indexes].map(index => places[index]));
        }
        case 'search': {
            const places = await loadPlaces(filters.country);
            if (cancelled()) return;
            self.postMessage({ id, progress: 'Searching…' });
            return searchPlaces(places, filters, cancelled);
        }
        default:
            throw new Error('Unknown place dictionary request');
    }
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

function* expandCountries(countries) {
    for (const [country, cities] of countries) {
        const known = loadedPlaces.get(country);
        if (known) {
            yield* known;
        } else {
            for (const city of cities) yield { city, country_name: country };
        }
    }
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
            const countries = new Map(data.countries.map(([name]) => [name, []]));
            await visitInBatches(expandCountries(data.countries), place => {
                countries.get(place.country_name).push(place);
            });
            const placesByCountry = [...countries.values()];
            const places = [];
            await visitInBatches(inDictionaryOrder(placesByCountry, data.runs), place => places.push(place));
            for (const [name, entries] of countries) loadedPlaces.set(name, entries);
            loadedPlaces.set(country, places);
        } else {
            const [name, cities] = data;
            if (name !== country || !Array.isArray(cities)) throw new Error('Unexpected country dictionary');
            const places = [];
            await visitInBatches(expandCountries([data]), place => places.push(place));
            if (!loadedPlaces.has(country)) loadedPlaces.set(country, places);
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
    if (country !== 'any' && place.country_name !== country) return false;
    if (!start && !end) return true;
    const city = place.city.toLowerCase();
    return city.startsWith(start) && city.endsWith(end);
}

function getSetupPlaces({ country, start, end }) {
    const key = JSON.stringify([country, start, end]);
    if (setupPool?.key === key) return setupPool.promise;

    const promise = loadPlaces(country).then(async dictionary => {
        if (country === 'any' && !start && !end) return dictionary;
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

async function indexRound(places, needsCountry, cancelled) {
    const groups = new Map();
    await visitInBatches(places, (place, index) => {
        const country = needsCountry ? place.country_name.toLowerCase() : '';
        let group = groups.get(country);
        if (!group) {
            group = { byName: new Map(), byLength: new Map() };
            groups.set(country, group);
        }
        const city = place.city.toLowerCase();
        if (group.byName.has(city)) return;

        group.byName.set(city, index);
        if (!group.byLength.has(city.length)) group.byLength.set(city.length, []);
        group.byLength.get(city.length).push(city);
    }, cancelled);
    return groups;
}

async function searchPlaces(places, filters, cancelled) {
    const { country, start, end, minLength, maxLength, includeTerms, excludeTerms } = filters;
    const results = [];
    let matches = 0;
    await visitInBatches(places, place => {
        if (!matchesFilters(place, country, start, end)) return;
        if (place.city.length < minLength || place.city.length > maxLength) return;
        if (includeTerms.length || excludeTerms.length) {
            const city = place.city.toLowerCase();
            const name = place.country_name.toLowerCase();
            const matchesTerm = term => city.includes(term) || name.includes(term);
            if (!includeTerms.every(matchesTerm) || excludeTerms.some(matchesTerm)) return;
        }

        // Each match has the same chance of appearing in the bounded sample.
        matches++;
        if (results.length < 100) results.push(place);
        else {
            const slot = Math.floor(Math.random() * matches);
            if (slot < results.length) results[slot] = place;
        }
    }, cancelled);
    return shuffle(results);
}

function shuffle(places) {
    for (let index = places.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [places[index], places[other]] = [places[other], places[index]];
    }
    return places;
}

function findMatchingPlace({ places, groups, needsCountry }, guess) {
    const lowerGuess = guess.toLowerCase();
    const parts = needsCountry ? lowerGuess.split(',').map(part => part.trim()) : [lowerGuess];
    if (needsCountry && parts.length < 2) return null;

    // Either name can contain commas, so try each possible separator.
    const candidatePairs = needsCountry ? parts.slice(0, -1).map((_, index) => [
        parts.slice(0, index + 1).join(', '),
        parts.slice(index + 1).join(', '),
    ]) : [[lowerGuess, '']];

    // When multiple splits match, keep the first answer in dictionary order.
    let firstIndex = Infinity;
    for (const [guessedCity, guessedCountry] of candidatePairs) {
        const index = groups.get(guessedCountry)?.byName.get(guessedCity);
        if (index !== undefined) firstIndex = Math.min(firstIndex, index);
    }
    if (firstIndex !== Infinity) return places[firstIndex];

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
    return firstIndex === Infinity ? null : places[firstIndex];
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
