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
        const { country, start, end, minutes, spelling } = isObject(value) ? value : {};
        return {
            country: country === 'any' || countries.has(country) ? country : 'placeAndCountry',
            start: letter(start),
            end: letter(end),
            minutes: ['1', '2', '3', '5'].includes(minutes) ? minutes : '1',
            spelling: ['strict', 'relaxed'].includes(spelling) ? spelling : 'standard'
        };
    }

    function checkedSettings(value) {
        if (!isObject(value)) return null;
        const valid = settings(value);
        // Older saved setups and rounds used Standard before this field existed.
        return Object.keys(valid).every(key => key === 'spelling' || valid[key] === value[key]) ? valid : null;
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

    function history(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, 50).flatMap(entry => {
            const setup = checkedSettings(entry?.setup);
            if (!setup || !validID(entry.id) ||
                !Number.isSafeInteger(entry.score) || entry.score < 0 || entry.score > 150_000 ||
                !Number.isSafeInteger(entry.finishedAt) || entry.finishedAt <= 0 || entry.finishedAt > 8.64e15) {
                return [];
            }
            return [{ id: entry.id, score: entry.score, finishedAt: entry.finishedAt, setup }];
        }).slice(0, 20);
    }

    function round(value) {
        const setup = checkedSettings(value?.setup);
        const { id, remainingMs, guesses } = isObject(value) ? value : {};
        if (!setup || !validID(id) || !Number.isFinite(remainingMs) || remainingMs <= 0 ||
            remainingMs > Number(setup.minutes) * 60_000 || !Array.isArray(guesses)) return null;

        return {
            id,
            setup,
            remainingMs,
            guesses: guesses.slice(0, 4096).flatMap(place => {
                if (typeof place?.city !== 'string' || !place.city.trim() || place.city.length > 256 ||
                    !countries.has(place.country)) return [];
                return [{ city: place.city, country: place.country }];
            })
        };
    }

    return {
        normalize: { preferences, history, round },
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
