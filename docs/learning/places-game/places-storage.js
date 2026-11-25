function createPlacesStorage(countries) {
    const prefix = 'project-lab:places-game:';

    function recordKey(record) {
        return prefix + record + ':v1';
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function letter(value) {
        return typeof value === 'string' && /^[A-Z]$/.test(value) ? value : 'any';
    }

    function settings(value) {
        const { country, start, end, minutes, spelling, hints } = isObject(value) ? value : {};
        return {
            country: country === 'any' || countries.has(country) ? country : 'placeAndCountry',
            start: letter(start),
            end: letter(end),
            minutes: ['1', '2', '3', '5', 'practice'].includes(minutes) ? minutes : '1',
            spelling: ['strict', 'relaxed'].includes(spelling) ? spelling : 'standard',
            hints: ['clues', 'after'].includes(hints) ? hints : 'examples'
        };
    }

    function checkedSettings(value) {
        if (!isObject(value)) return null;
        const valid = settings(value);
        const validRequired = ['country', 'start', 'end', 'minutes'].every(key => valid[key] === value[key]);
        const validSpelling = value.spelling === undefined || valid.spelling === value.spelling;
        return validRequired && validSpelling ? valid : null;
    }

    function boundedText(value, limit) {
        return typeof value === 'string' ? value.slice(0, limit) : '';
    }

    function lengthValue(value) {
        const number = Number(boundedText(value, 32));
        return Number.isSafeInteger(number) && number >= 1 ? String(number) : '';
    }

    function preferences(value) {
        const { setup, search, leaveMode, showRules, showSearch, presets } = isObject(value) ? value : {};
        const filters = isObject(search) ? search : {};
        const saved = new Map();
        // Retain setups saved before the new five-favorite limit.
        for (const preset of Array.isArray(presets) ? presets.slice(0, 12) : []) {
            const name = boundedText(preset?.name, 48).trim();
            const setup = checkedSettings(preset?.setup);
            if (name && setup) saved.set(name.toLowerCase(), { name, setup });
        }
        return {
            setup: settings(setup),
            leaveMode: ['pause', 'save'].includes(leaveMode) ? leaveMode : 'count',
            search: {
                country: countries.has(filters.country) ? filters.country : 'any',
                start: letter(filters.start),
                end: letter(filters.end),
                include: boundedText(filters.include, 256),
                exclude: boundedText(filters.exclude, 256),
                min: lengthValue(filters.min),
                max: lengthValue(filters.max)
            },
            showRules: showRules === true,
            showSearch: showSearch === true,
            presets: [...saved.values()]
        };
    }

    function validID(id) {
        return typeof id === 'string' && /^[a-z\d-]{1,64}$/i.test(id);
    }

    function checkedAssists(value) {
        if (!Array.isArray(value) || value.some(aid => !['clue', 'examples', 'search'].includes(aid))) return null;
        return [...new Set(value)];
    }

    function challengeKey({ country, start, end, minutes, spelling }) {
        return JSON.stringify([country, start, end, minutes, spelling]);
    }

    function scoreCategory(assists) {
        return assists === null ? 'unknown' : assists.length ? 'assisted' : 'unassisted';
    }

    function groupScores(entries) {
        const groups = new Map();
        for (const entry of entries) {
            const key = challengeKey(entry.setup);
            let group = groups.get(key);
            if (!group) {
                group = { setup: entry.setup, recent: [], best: {} };
                groups.set(key, group);
            }
            if (group.recent.length < 5) group.recent.push(entry);
            const category = scoreCategory(entry.assists);
            if (entry.score > (group.best[category]?.score ?? -1)) group.best[category] = entry;
        }
        return groups;
    }

    function history(value, practice = false) {
        if (!Array.isArray(value)) return [];
        const knownIds = new Set();
        const entries = value.flatMap(entry => {
            const setup = checkedSettings(entry?.setup);
            if (!setup || (setup.minutes === 'practice') !== practice || !validID(entry.id) || knownIds.has(entry.id) ||
                !Number.isSafeInteger(entry.score) || entry.score < 0 || entry.score > 150_000 ||
                !Number.isSafeInteger(entry.finishedAt) || entry.finishedAt <= 0 || entry.finishedAt > 8.64e15) {
                return [];
            }
            knownIds.add(entry.id);
            return [{ id: entry.id, score: entry.score, finishedAt: entry.finishedAt, setup, assists: checkedAssists(entry.assists) }];
        }).sort((a, b) => b.finishedAt - a.finishedAt);
        // Keep the recent history, five attempts per challenge, and older personal bests.
        const retained = new Set(entries.slice(0, 20));
        for (const { recent, best } of groupScores(entries).values()) {
            for (const entry of [...recent, ...Object.values(best)]) retained.add(entry);
        }
        return entries.filter(entry => retained.has(entry));
    }

    function round(value) {
        const setup = checkedSettings(value?.setup);
        const { id, remainingMs, guesses } = isObject(value) ? value : {};
        if (!setup || !validID(id) || !Array.isArray(guesses)) return null;
        const practice = setup.minutes === 'practice';
        const validTime = practice ? remainingMs === null :
            Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs <= Number(setup.minutes) * 60_000;
        if (!validTime) return null;

        return {
            id,
            setup,
            remainingMs,
            guesses: (practice ? guesses : guesses.slice(0, 4096)).flatMap(place => {
                if (typeof place?.city !== 'string' || !place.city.trim() || place.city.length > 256 ||
                    !countries.has(place.country)) return [];
                return [{ city: place.city, country: place.country }];
            }),
            attempts: checkedAttempts(value.attempts),
            assists: checkedAssists(value.assists)
        };
    }

    function checkedAttempts(value) {
        if (!Array.isArray(value)) return [];
        return value.flatMap(attempt => {
            const { guess, outcome, detail } = isObject(attempt) ? attempt : {};
            if (typeof guess !== 'string' || !guess.trim() || guess.length > 257 ||
                !['exact', 'corrected', 'duplicate', 'miss'].includes(outcome)) return [];
            return [{ guess, outcome, detail: boundedText(detail, 512) }];
        });
    }

    return {
        normalize: { preferences, history, 'practice-history': value => history(value, true), round },
        challengeKey,
        groupScores,
        scoreCategory,
        available: true,

        read(record) {
            let stored;
            try {
                stored = window.localStorage.getItem(recordKey(record));
            } catch {
                this.available = false;
            }
            try {
                return stored ? this.normalize[record](JSON.parse(stored)) : null;
            } catch {
                return null;
            }
        },

        write(record, value) {
            try {
                window.localStorage.setItem(recordKey(record), JSON.stringify(value));
                return true;
            } catch {
                this.available = false;
                return false;
            }
        },

        remove(record) {
            try {
                window.localStorage.removeItem(recordKey(record));
                return true;
            } catch {
                this.available = false;
                return false;
            }
        }
    };
}
