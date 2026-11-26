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
            spelling: ['strict', 'accent-friendly', 'relaxed'].includes(spelling) ? spelling : 'standard',
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
        const { setup, search, leaveMode, soundMode, showRules, showSearch, presets } = isObject(value) ? value : {};
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
            soundMode: ['time-up', 'all'].includes(soundMode) ? soundMode : 'off',
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

    function checkedDaily(value) {
        if (typeof value?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
            typeof value.revision !== 'string' || !/^[a-f0-9]{16}$/.test(value.revision)) return null;
        const date = new Date(value.date + 'T00:00:00Z');
        return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value.date)
            ? { date: value.date, revision: value.revision } : null;
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
            const daily = checkedDaily(entry.daily);
            return [{
                id: entry.id, score: entry.score, finishedAt: entry.finishedAt, setup,
                assists: checkedAssists(entry.assists),
                ...(daily && !practice ? { daily } : {})
            }];
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
            assists: checkedAssists(value.assists),
            daily: practice ? null : checkedDaily(value.daily)
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

let timer;
let roundDeadline = null;
let pausedMs = 0;
let nextSaveAt;
let score = 0;
const guessedPlaces = [];
const acceptedAnswers = new Set();
let shownClueKey;
let latestGuess;
let guessEditVersion = 0;
let activeRound;
let selectedDaily = null;
let nextRoundId = 0;
let guessQueue = Promise.resolve();
let restoringRound;
let readingSavedState = false;
let roundLoadState = 'idle';
let roundJob;
let audioContext;

const catalog = JSON.parse(document.getElementById('countryCatalog').textContent);
const countryIndexes = new Map(catalog.countries.map((country, index) => [country, index]));
const filterLetters = ['', ...'abcdefghijklmnopqrstuvwxyz'];
const decodedFilterCounts = new WeakMap();
const storage = createPlacesStorage(countryIndexes);
const legacyStorage = window.chrome?.storage?.local;
const legacyKeys = ['gameState', 'gameSettings', 'searchFilters'];
const savedSetupLimit = 5;
let savedSetups = [];
const scoreHistories = { history: [], 'practice-history': [] };
let placesWorker;
let nextJobId = 0;
const dictionaryStates = new Map();
const pendingJobs = new Map();
const resultRequests = new WeakMap();

const rulesBtn = document.getElementById('rulesBtn');
const rulesContainer = document.getElementById('rulesContainer');
const showSearchBtn = document.getElementById('showSearchBtn');
const searchContainer = document.getElementById('searchContainer');
const letterSelect = document.getElementById('letterSelect');
const endLetterSelect = document.getElementById('endLetterSelect');
const countrySelect = document.getElementById('countrySelect');
const timeSelect = document.getElementById('timeSelect');
const spellingSelect = document.getElementById('spellingSelect');
const timerDisplay = document.getElementById('timer');
const timerIcon = document.getElementById('timerIcon');
const timerCaption = document.getElementById('timerCaption');
const scoreDisplay = document.getElementById('score');
const placeInput = document.getElementById('placeInput');
const enterBtn = document.getElementById('enterBtn');
const guessStatus = document.getElementById('guessStatus');
const startBtn = document.getElementById('startBtn');
const startLabel = document.getElementById('startLabel');
const startIcon = document.getElementById('startIcon');
const roundLoadStatus = document.getElementById('roundLoadStatus');
const roundFilterWarning = document.getElementById('roundFilterWarning');
const sharedSetupStatus = document.getElementById('sharedSetupStatus');
const pauseBtn = document.getElementById('pauseBtn');
const pauseLabel = document.getElementById('pauseLabel');
const pauseIcon = document.getElementById('pauseIcon');
const resetBtn = document.getElementById('resetBtn');
const displayBtn = document.getElementById('displayBtn');
const displayLabel = document.getElementById('displayLabel');
const displayIcon = document.getElementById('displayIcon');
const exampleLabel = document.getElementById('exampleLabel');
const guessedPlacesContainer = document.getElementById('guessedPlaces');
const examplePlacesContainer = document.getElementById('examplePlaces');
const roundReview = document.getElementById('roundReview');
const reviewBest = document.getElementById('reviewBest');
const scorebookSetup = document.getElementById('scorebookSetup');
const dailyChallengeBtn = document.getElementById('dailyChallengeBtn');
const dailyChallengeRules = document.getElementById('dailyChallengeRules');
const dailyChallengeLocked = document.getElementById('dailyChallengeLocked');
const dailyRoundLabel = document.getElementById('dailyRoundLabel');
const reviewNote = document.getElementById('reviewNote');
const reviewAttempts = document.getElementById('reviewAttempts');
const reviewFilters = document.getElementById('reviewFilters');
const retryRoundBtn = document.getElementById('retryRoundBtn');

const searchIncludeInput = document.getElementById('searchIncludeInput');
const searchExcludeInput = document.getElementById('searchExcludeInput');
const searchMinLengthInput = document.getElementById('searchMinLengthInput');
const searchMaxLengthInput = document.getElementById('searchMaxLengthInput');
const searchLengthWarning = document.getElementById('searchLengthWarning');
const searchBtn = document.getElementById('searchBtn');
const searchResultsContainer = document.getElementById('searchResults');
const searchStartLetterSelect = document.getElementById('searchStartLetterSelect');
const searchEndLetterSelect = document.getElementById('searchEndLetterSelect');
const searchCountrySelect = document.getElementById('searchCountrySelect');
const preferencesBtn = document.getElementById('preferencesBtn');
const preferencesDialog = document.getElementById('preferencesDialog');
const preferencesStatus = document.getElementById('preferencesStatus');
const leaveMode = document.getElementById('leaveMode');
const leaveModeHint = document.getElementById('leaveModeHint');
const hintMode = document.getElementById('hintMode');
const hintModeHelp = document.getElementById('hintModeHelp');
const soundMode = document.getElementById('soundMode');
const setupName = document.getElementById('setupName');
const savedSetupList = document.getElementById('savedSetupList');
const setupStatus = document.getElementById('setupStatus');
const copyCurrentSetupBtn = document.getElementById('copyCurrentSetupBtn');
const saveCurrentSetupBtn = document.getElementById('saveCurrentSetupBtn');
const setupLinkFallback = document.getElementById('setupLinkFallback');
const setupLinkText = document.getElementById('setupLinkText');
const setupLinkVersion = '1';
const roundFields = {
    country: { input: countrySelect, label: 'Country / Mode' },
    start: { input: letterSelect, label: 'Starting Letter' },
    end: { input: endLetterSelect, label: 'Ending Letter' },
    minutes: { input: timeSelect, label: 'Time Limit' },
    spelling: { input: spellingSelect, label: 'Spelling' },
    hints: { input: hintMode, label: 'Hints in Preferences' }
};
const sharedSetupIssues = new Map();
let hasSharedSetup = false;
const clearDataBtn = document.getElementById('clearDataBtn');
const clearDataPrompt = document.getElementById('clearDataPrompt');

function setupIntegerInputValidation(inputElement) {
    inputElement.addEventListener('input', function() {
        const digits = this.value.replace(/[^\d]/g, '');
        this.value = digits ? Math.max(1, parseInt(digits, 10)) : '';
        handleSearchFiltersChange();
    });

    inputElement.addEventListener('keydown', function(event) {
        if (['.', 'e', 'E', '+', '-'].includes(event.key)) {
            event.preventDefault();
        }
    });
}

function dictionaryReady(country) {
    return dictionaryStates.get('any') === 'ready' || dictionaryStates.get(country) === 'ready';
}

function getPlacesWorker() {
    if (placesWorker) return placesWorker;

    const worker = new Worker('places-worker.js?v=12');
    placesWorker = worker;
    worker.addEventListener('message', ({ data }) => {
        if (placesWorker !== worker) return;
        if (data.dictionary) {
            dictionaryStates.set(data.dictionary, data.state);
            updateStartButton();
            return;
        }

        const job = pendingJobs.get(data.id);
        if (!job) return;
        if (data.progress) {
            job.onProgress?.(data.progress);
            return;
        }

        pendingJobs.delete(data.id);
        if (data.error) job.reject(new Error(data.error));
        else job.resolve(data.result);
    });
    worker.addEventListener('error', () => {
        if (placesWorker !== worker) return;
        worker.terminate();
        placesWorker = undefined;
        dictionaryStates.clear();
        if (activeRound) activeRound.index = undefined;
        for (const job of pendingJobs.values()) job.reject(new Error('Place dictionary worker stopped'));
        pendingJobs.clear();
        updateStartButton();
    });
    const { revision, countries } = catalog;
    worker.postMessage({ type: 'init', catalog: { revision, countries } });
    return worker;
}

function requestPlaces(type, payload, onProgress) {
    const id = ++nextJobId;
    const promise = new Promise((resolve, reject) => {
        try {
            const worker = getPlacesWorker();
            worker.postMessage({ id, type, ...payload });
            pendingJobs.set(id, { resolve, reject, onProgress });
        } catch (error) {
            reject(error);
        }
    });
    return {
        promise,
        cancel() {
            const job = pendingJobs.get(id);
            if (!job) return;
            pendingJobs.delete(id);
            placesWorker.postMessage({ id, type: 'cancel' });
            job.resolve(undefined);
        }
    };
}

function initGame() {
    const sortedCountries = [...catalog.countries].sort();
    const hasUnitedStates = sortedCountries.includes('United States');

    const letterOptionsFragment = document.createDocumentFragment();
    for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const option = document.createElement('option');
        option.value = letter;
        option.textContent = letter;
        letterOptionsFragment.appendChild(option);
    }
    letterSelect.innerHTML = '<option value="any" selected>Any Letter</option>';
    endLetterSelect.innerHTML = '<option value="any" selected>Any Letter</option>';
    searchStartLetterSelect.innerHTML = '<option value="any" selected>Any Letter</option>';
    searchEndLetterSelect.innerHTML = '<option value="any" selected>Any Letter</option>';

    letterSelect.appendChild(letterOptionsFragment.cloneNode(true));
    endLetterSelect.appendChild(letterOptionsFragment.cloneNode(true));
    searchStartLetterSelect.appendChild(letterOptionsFragment.cloneNode(true));
    searchEndLetterSelect.appendChild(letterOptionsFragment.cloneNode(true));


    const searchCountryOptionsFragment = document.createDocumentFragment();
    const anyCountryOptionForSearch = document.createElement('option');
    anyCountryOptionForSearch.value = "any";
    anyCountryOptionForSearch.textContent = "Any";
    anyCountryOptionForSearch.selected = true;
    searchCountryOptionsFragment.appendChild(anyCountryOptionForSearch);

    if (hasUnitedStates) {
        const usOption = document.createElement('option');
        usOption.value = "United States";
        usOption.textContent = "United States";
        searchCountryOptionsFragment.appendChild(usOption);
    }
    sortedCountries.forEach(country => {
        if (country !== "United States") {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            searchCountryOptionsFragment.appendChild(option);
        }
    });
    searchCountrySelect.innerHTML = '';
    searchCountrySelect.appendChild(searchCountryOptionsFragment);


    const gameCountryOptionsFragment = document.createDocumentFragment();
    const placeAndCountryModeOption = document.createElement('option');
    placeAndCountryModeOption.value = 'placeAndCountry';
    placeAndCountryModeOption.textContent = 'Place and Country';
    gameCountryOptionsFragment.appendChild(placeAndCountryModeOption);

    const anyCountryOptionForGame = document.createElement('option');
    anyCountryOptionForGame.value = 'any';
    anyCountryOptionForGame.textContent = 'Any Country';
    gameCountryOptionsFragment.appendChild(anyCountryOptionForGame);

    if (hasUnitedStates) {
        const usOption = document.createElement('option');
        usOption.value = "United States";
        usOption.textContent = "United States";
        gameCountryOptionsFragment.appendChild(usOption);
    }
    sortedCountries.forEach(country => {
        if (country !== "United States") {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            gameCountryOptionsFragment.appendChild(option);
        }
    });
    countrySelect.innerHTML = '';
    countrySelect.appendChild(gameCountryOptionsFragment);

    loadGameState();

    for (const [key, { input }] of Object.entries(roundFields)) {
        input.addEventListener('change', () => handleRoundSettingChange(key));
    }

    searchBtn.addEventListener('click', performSearch);
    [searchIncludeInput, searchExcludeInput, searchMinLengthInput, searchMaxLengthInput].forEach(input => {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') performSearch();
        });
    });

    setupIntegerInputValidation(searchMinLengthInput);
    setupIntegerInputValidation(searchMaxLengthInput);

    searchStartLetterSelect.addEventListener('change', handleSearchFiltersChange);
    searchEndLetterSelect.addEventListener('change', handleSearchFiltersChange);
    searchCountrySelect.addEventListener('change', handleSearchFiltersChange);
    searchIncludeInput.addEventListener('input', handleSearchFiltersChange);
    searchExcludeInput.addEventListener('input', handleSearchFiltersChange);
}

function clearExamples() {
    shownClueKey = undefined;
    cancelResults(examplePlacesContainer);
    let message = 'Click "Display Places" to see examples';
    if (studyToolsLocked()) message = 'Search and examples unlock after the round';
    else if (hintMode.value === 'clues') message = restoringRound ? 'Loading saved round…' : 'Choose "Get a clue" for a hint';
    showResultMessage(examplePlacesContainer, message);
}

function studyToolsLocked() {
    return sharedSetupIssues.has('hints') || (hintMode.value === 'after' &&
        (!activeRound?.finishedAt || Boolean(selectedDaily && selectedDaily !== activeRound.daily)));
}

function updateStudyTools() {
    const clues = hintMode.value === 'clues';
    const locked = studyToolsLocked();
    displayLabel.textContent = clues ? 'Get a clue' : 'Display Places';
    displayIcon.className = clues ? 'fas fa-lightbulb' : 'fas fa-list';
    exampleLabel.textContent = clues ? 'Clue' : 'Example Places';
    displayBtn.disabled = locked || sharedSetupIssues.size > 0 || (clues && Boolean(restoringRound));
    showSearchBtn.disabled = locked;
    if (locked) {
        setPanelVisibility(showSearchBtn, searchContainer, false);
        cancelResults(searchResultsContainer);
        showResultMessage(searchResultsContainer, 'Search results will appear here');
    }
    const help = {
        examples: 'See up to eight place names that match your filters.',
        clues: 'Get a matching place’s country and letter count.',
        after: 'Search and examples unlock when the timer ends or you finish practice.'
    };
    hintModeHelp.textContent = hintMode.disabled ? 'Finish or reset the round to change this setting.' :
        sharedSetupIssues.get('hints') ?? help[hintMode.value];
}

function refreshSetup() {
    clearExamples();
    roundJob?.cancel();
    roundJob = undefined;
    roundLoadState = 'idle';
    updateStartButton();
}

function handleRoundSettingChange(key) {
    setDailySelection(null);
    const repaired = sharedSetupIssues.delete(key);
    if (repaired) {
        clearSharedField(key);
        updateSharedSetupStatus();
    }
    if (key === 'country') updatePlaceInputPlaceholder();
    if (key === 'minutes') updateTimerDisplay();
    if (key === 'hints') {
        updateStudyTools();
        clearExamples();
    }
    if (repaired || ['country', 'start', 'end'].includes(key)) refreshSetup();
    const saved = savePreferences();
    if (key === 'hints') preferencesStatus.textContent = saved ? '' : storageWarning;
}

function setPanelVisibility(button, panel, isVisible) {
    panel.hidden = !isVisible;
    button.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
}

rulesBtn.addEventListener('click', function() {
    setPanelVisibility(rulesBtn, rulesContainer, rulesBtn.getAttribute('aria-expanded') === 'false');
    savePreferences();
});

showSearchBtn.addEventListener('click', function() {
    if (showSearchBtn.disabled) return;
    const open = searchContainer.hidden;
    setPanelVisibility(showSearchBtn, searchContainer, open);
    if (!open && cancelResults(searchResultsContainer)) {
        showResultMessage(searchResultsContainer, 'Search results will appear here');
    }
    if (open && searchResultsContainer.querySelector('.place-item')) markRoundAid('search');
    savePreferences();
});


function filterLetter(value) {
    return value === 'any' ? '' : value.toLowerCase();
}

function roundFilters() {
    const selection = countrySelect.value;
    return {
        country: selection === 'placeAndCountry' ? 'any' : selection || 'any',
        start: filterLetter(letterSelect.value),
        end: filterLetter(endLetterSelect.value)
    };
}

function setupAnswerCount({ country, start, end }) {
    const { worldwideNames, worldwidePairs, byCountry } = catalog.filterCounts;
    const packed = country === 'any' ?
        (countrySelect.value === 'placeAndCountry' ? worldwidePairs : worldwideNames) :
        byCountry[countryIndexes.get(country)];
    let counts = decodedFilterCounts.get(packed);
    const axisSize = filterLetters.length;
    if (!counts) {
        counts = new Uint32Array(axisSize ** 2);
        let offset = 0;
        for (const value of packed) {
            if (value < 0) offset -= value;
            else counts[offset++] = value;
        }
        decodedFilterCounts.set(packed, counts);
    }
    const row = filterLetters.indexOf(start);
    const column = filterLetters.indexOf(end);
    return counts[row * axisSize + column];
}

function roundIsOpen(round = activeRound) {
    return Boolean(round && !round.finishedAt);
}

function updateStartButton() {
    const loading = readingSavedState || roundLoadState === 'loading';
    dailyChallengeBtn.disabled = readingSavedState || countrySelect.disabled;
    dailyChallengeLocked.hidden = !dailyChallengeBtn.disabled;
    const running = Boolean(activeRound?.playing);
    const finishing = Boolean(activeRound?.finishing);
    const canResume = roundIsOpen() && !running && !finishing;
    const canFinish = roundIsOpen() && activeRound.setup.minutes === 'practice' && !finishing;
    const finishInStartSlot = canFinish && running;
    const finishInPauseSlot = canFinish && canResume;
    const filters = roundFilters();
    const empty = !readingSavedState && !roundIsOpen() && !restoringRound && !sharedSetupIssues.size &&
        setupAnswerCount(filters) === 0;
    startBtn.disabled = (running && !finishInStartSlot) || empty || finishing || sharedSetupIssues.size > 0;
    pauseBtn.disabled = !running && !finishInPauseSlot;
    if (loading) startBtn.setAttribute('aria-disabled', 'true');
    else startBtn.removeAttribute('aria-disabled');
    const warning = empty ? 'No places match these filters. Try another country or letter' : '';
    if (roundFilterWarning.textContent !== warning) roundFilterWarning.textContent = warning;

    let label = 'Load places';
    let status = '';
    if (finishing) {
        label = 'Finishing…';
        status = label;
    } else if (running) label = finishInStartSlot ? 'Finish Practice' : 'Start Game';
    else if (loading) {
        label = 'Loading places…';
        status = label;
    } else if (roundLoadState === 'failed') {
        label = 'Retry loading';
        status = 'Could not load places. Retry loading to try again.';
    } else if (canResume) {
        label = 'Resume Game';
        status = 'Round paused. Select Resume Game when ready.';
    } else if (empty || dictionaryReady(filters.country) || sharedSetupIssues.size) label = 'Start Game';
    startLabel.textContent = label;
    startIcon.className = finishInStartSlot || finishing ? 'fas fa-flag-checkered' : 'fas fa-play';
    pauseLabel.textContent = finishInPauseSlot ? 'Finish Practice' : 'Pause';
    pauseIcon.className = finishInPauseSlot ? 'fas fa-flag-checkered' : 'fas fa-pause';
    if (roundLoadStatus.textContent !== status) roundLoadStatus.textContent = status;
}

function invalidateRound() {
    if (activeRound) {
        activeRound.index?.cancel();
        activeRound.reviewJob?.cancel();
        for (const job of activeRound.guesses) job.cancel();
        activeRound = undefined;
    }
    guessQueue = Promise.resolve();
    latestGuess = undefined;
    placesWorker?.postMessage({ type: 'clearRound' });
    showGuessFeedback('');
    roundReview.hidden = true;
    roundReview.open = false;
    reviewAttempts.replaceChildren();
    reviewFilters.replaceChildren();
}

function newAttemptId() {
    return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function prepareRound(starting = false) {
    const filters = roundFilters();
    const needsResume = restoringRound;
    const indexing = starting || needsResume;
    const round = {
        id: ++nextRoundId,
        attemptId: needsResume?.id ?? newAttemptId(),
        setup: currentSettings(),
        daily: selectedDaily,
        filters,
        needsCountry: countrySelect.value === 'placeAndCountry',
        guesses: new Set(),
        attempts: needsResume?.attempts ?? [],
        assists: needsResume ? needsResume.assists : [],
        playing: false
    };
    if (starting) {
        invalidateRound();
        clearExamples();
        setRoundSettingsDisabled(true);
    }

    roundLoadState = 'loading';
    const job = indexing ? indexRound(round, needsResume?.guesses) : requestPlaces('setup', { filters });
    roundJob = job;
    updateStartButton();
    try {
        const result = await job.promise;
        if (roundJob !== job) return;
        const count = needsResume ? result.count : result;
        roundLoadState = 'idle';
        roundJob = undefined;
        if (indexing && count > 0) activeRound = round;

        if (needsResume) {
            restoringRound = undefined;
            if (hintMode.value === 'clues') {
                updateStudyTools();
                clearExamples();
            }
            if (count > 0) {
                for (const place of result.guesses) appendGuessedPlace(place, round);
                score = guessedPlaces.length;
                updateScoreDisplay();
                saveRound();
            } else {
                // A dictionary update can leave a restored setup with no eligible places.
                pausedMs = 0;
                updateTimerDisplay();
                setRoundSettingsDisabled(false);
                discardSavedRound(round.attemptId);
            }
        }
        if (starting) {
            if (count > 0) beginRound();
            else setRoundSettingsDisabled(false);
        }
    } catch {
        if (roundJob !== job) return;
        roundJob = undefined;
        roundLoadState = 'failed';
        if (starting) setRoundSettingsDisabled(false);
    }
    updateStartButton();
}

function indexRound(round, savedGuesses) {
    round.index ??= requestPlaces('round', {
        roundId: round.id,
        filters: round.filters,
        needsCountry: round.needsCountry,
        spelling: round.setup.spelling,
        savedGuesses
    });
    return round.index;
}

function setRoundSettingsDisabled(disabled) {
    letterSelect.disabled = disabled;
    endLetterSelect.disabled = disabled;
    countrySelect.disabled = disabled;
    timeSelect.disabled = disabled;
    spellingSelect.disabled = disabled;
    hintMode.disabled = disabled;
    updateStudyTools();
    if (hintMode.value === 'after') clearExamples();
    updateSavedSetupAvailability();
}

function setGuessingEnabled(enabled) {
    placeInput.disabled = !enabled;
    enterBtn.disabled = !enabled;
}

function prepareSound() {
    if (soundMode.value === 'off') return;
    try {
        const AudioContext = window.AudioContext ?? window.webkitAudioContext;
        if (!AudioContext) return;
        audioContext ??= new AudioContext();
        if (audioContext.state !== 'running') audioContext.resume().catch(() => {});
    } catch {
        // The browser can block audio while the game continues.
    }
}

function playSound(cue) {
    const correct = cue === 'correct';
    if (soundMode.value === 'off' || (correct && soundMode.value !== 'all') ||
        audioContext?.state !== 'running') return;

    const now = audioContext.currentTime;
    const end = now + (correct ? 0.12 : 0.32);
    const tone = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    tone.frequency.setValueAtTime(correct ? 660 : 520, now);
    tone.frequency.exponentialRampToValueAtTime(correct ? 880 : 330, end - 0.04);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(correct ? 0.05 : 0.07, now + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.001, end);
    tone.connect(envelope);
    envelope.connect(audioContext.destination);
    tone.addEventListener('ended', () => {
        tone.disconnect();
        envelope.disconnect();
    }, { once: true });
    tone.start(now);
    tone.stop(end);
}

startBtn.addEventListener('click', function() {
    if (readingSavedState || roundJob || startBtn.disabled) return;
    prepareSound();
    if (roundIsOpen()) {
        if (!activeRound.playing) resumeRound();
        else if (activeRound.setup.minutes === 'practice') finishPractice();
        return;
    }
    prepareRound(!restoringRound && dictionaryReady(roundFilters().country));
});

function beginRound() {
    clearSharedSetup();
    const { minutes } = activeRound.setup;
    pausedMs = minutes === 'practice' ? 0 : Number(minutes) * 60_000;
    score = 0;
    placeInput.value = '';
    clearGuessedPlaces();

    updateScoreDisplay();
    updatePlaceInputPlaceholder();

    resumeRound();
    if (!searchContainer.hidden && searchResultsContainer.querySelector('.place-item')) markRoundAid('search');
}

function pauseRound() {
    const remainingMs = getRemainingMs();
    if (roundDeadline !== null && remainingMs === 0) {
        finishRound();
        return;
    }
    const moveFocus = !document.hidden && document.activeElement === pauseBtn;
    activeRound.playing = false;
    stopTimer();
    pausedMs = remainingMs;
    setGuessingEnabled(false);
    updateTimerDisplay(remainingMs);
    updateStartButton();
    if (moveFocus) startBtn.focus({ preventScroll: true });
    saveRound();
}

function resumeRound() {
    // The dictionary can finish indexing after the player has already switched away.
    if (document.hidden && leaveMode.value !== 'count') {
        updateTimerDisplay();
        updateStartButton();
        saveRound();
        return;
    }

    const now = performance.now();
    roundDeadline = activeRound.setup.minutes === 'practice' ? null : now + pausedMs;
    activeRound.playing = true;
    pausedMs = 0;
    nextSaveAt = now + 5000;
    setGuessingEnabled(true);
    updateTimerDisplay();
    updateStartButton();
    if (!document.hidden) placeInput.focus();
    refreshTimer();
    if (leaveMode.value === 'save') saveRound();
    else discardSavedRound(activeRound?.attemptId);
}

pauseBtn.addEventListener('click', function() {
    if (activeRound?.playing) pauseRound();
    else if (roundIsOpen() && activeRound.setup.minutes === 'practice' && !activeRound.finishing) finishPractice();
});

function resetAttempt() {
    if (readingSavedState) legacyStorage?.remove(['gameState']);
    const attemptId = activeRound?.attemptId ?? restoringRound?.id;
    stopTimer();
    invalidateRound();
    score = 0;
    clearGuessedPlaces();
    restoringRound = undefined;
    readingSavedState = false;

    updateTimerDisplay();
    updateScoreDisplay();

    setGuessingEnabled(false);
    setRoundSettingsDisabled(false);
    placeInput.value = '';

    discardSavedRound(attemptId);
    refreshSetup();
}

resetBtn.addEventListener('click', resetAttempt);

function updatePlaceInputPlaceholder() {
    if (countrySelect.value === 'placeAndCountry') {
        placeInput.placeholder = 'e.g., Paris, France';
    } else {
        placeInput.placeholder = 'Enter a place name';
    }
}

function showGuessFeedback(message, correct = false) {
    guessStatus.classList.toggle('guess-correct', correct);
    guessStatus.textContent = message;
}

function reportGuess(submission, message, correct = false) {
    if (latestGuess !== submission) return;
    // Keep new typing intact if the worker answered after the player moved on.
    if (!correct && !activeRound?.finishing && roundIsOpen() &&
        (activeRound.setup.minutes === 'practice' || getRemainingMs() > 0) &&
        guessEditVersion === submission.editVersion && !placeInput.value) {
        placeInput.value = submission.text;
    }
    showGuessFeedback(message, correct);
}

function guessProblem(reason, needsCountry) {
    if (reason === 'country') return 'Check the country';
    if (reason === 'ambiguous') return needsCountry
        ? 'More than one place matches. Try the exact place and country names'
        : 'More than one place matches. Try the exact spelling or add the country';
    if (reason === 'unavailable') return 'Could not check that answer. Try entering it again';
    return 'Place not found for this round';
}

function enterPlace() {
    if (!activeRound?.playing) return;
    if (roundDeadline !== null && getRemainingMs() === 0) {
        finishRound();
        return;
    }

    const text = placeInput.value;
    const guess = text.trim();
    showGuessFeedback('');
    placeInput.focus({ preventScroll: true });
    if (!guess) return;
    prepareSound();

    const submission = { text, editVersion: guessEditVersion };
    latestGuess = submission;
    placeInput.value = '';

    const round = activeRound;
    const index = indexRound(round);
    const lookup = index.promise.then(() => {
        if (activeRound !== round) return;
        const job = requestPlaces('guess', { roundId: round.id, guess, includeFeedback: true });
        round.guesses.add(job);
        return job.promise.finally(() => round.guesses.delete(job));
    }).catch(() => {
        if (round.index === index) round.index = undefined;
        return { reason: 'unavailable' };
    });

    // Apply results in submission order, even if a reply arrives after pausing or expiry.
    guessQueue = guessQueue.then(async () => {
        const result = await lookup;
        if (activeRound !== round) return;

        const attempt = { guess: guess.length > 256 ? `${guess.slice(0, 256)}…` : guess };
        if (!result?.place) {
            attempt.outcome = 'miss';
            attempt.detail = result?.reason ?? 'not-found';
            reportGuess(submission, guessProblem(attempt.detail, round.needsCountry));
        } else {
            const place = { city: result.place.city, country: result.place.country_name };
            const label = round.needsCountry || result.accentCorrection === 'pair' ?
                `${place.city}, ${place.country}` : place.city;
            if (appendGuessedPlace(place, round)) {
                score++;
                updateScoreDisplay();
                reportGuess(submission, result.accentCorrection ? `Counted as ${label}` : 'Counted', true);
                playSound('correct');
                attempt.outcome = result.match;
            } else {
                reportGuess(submission, 'Already counted');
                attempt.outcome = 'duplicate';
            }
            attempt.detail = label;
        }

        round.attempts.push(attempt);
        if (roundIsOpen(round)) saveRound();
        else if (attempt.outcome === 'exact' || attempt.outcome === 'corrected') recordScore(round);
    });
}

function showResultMessage(container, message, retry, retryLabel = 'Retry loading') {
    const status = document.createElement('p');
    status.className = 'text-muted';
    status.setAttribute('role', 'status');
    status.textContent = message;
    container.replaceChildren(status);
    if (retry) {
        const button = document.createElement('button');
        button.className = 'btn btn-outline-secondary btn-sm';
        button.type = 'button';
        button.textContent = retryLabel;
        button.addEventListener('click', retry);
        container.append(button);
    }
}

function cancelResults(container) {
    const job = resultRequests.get(container);
    if (!job) return false;
    resultRequests.delete(container);
    job.cancel();
    return true;
}

async function requestResults(container, type, payload, emptyMessage, retry, render = renderPlaces) {
    cancelResults(container);
    const country = payload.filters.country;
    if (!dictionaryReady(country)) showResultMessage(container, 'Loading places…');
    else if (type === 'search') showResultMessage(container, 'Searching…');
    else if (type === 'clue') showResultMessage(container, 'Looking for a clue…');

    const job = requestPlaces(type, payload, message => {
        if (resultRequests.get(container) === job) showResultMessage(container, message);
    });
    resultRequests.set(container, job);
    try {
        const results = await job.promise;
        if (resultRequests.get(container) !== job) return;
        if (results.length === 0) showResultMessage(container, emptyMessage);
        else {
            render(container, results);
            if (type !== 'clue') markRoundAid(type);
        }
        if (type !== 'search') container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch {
        if (resultRequests.get(container) === job) {
            showResultMessage(container, 'Could not load places.', retry);
        }
    } finally {
        if (resultRequests.get(container) === job) resultRequests.delete(container);
    }
}

function validateSearchLengthRange() {
    const minLength = parseInt(searchMinLengthInput.value || '0', 10);
    const maxLength = searchMaxLengthInput.value ? parseInt(searchMaxLengthInput.value, 10) : Infinity;
    const invalid = minLength > maxLength;
    const warning = invalid ? 'Minimum length must be at most the maximum' : '';
    if (searchLengthWarning.textContent !== warning) searchLengthWarning.textContent = warning;
    for (const input of [searchMinLengthInput, searchMaxLengthInput]) {
        if (invalid) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
    }
    return invalid ? null : { minLength, maxLength };
}

function handleSearchFiltersChange() {
    validateSearchLengthRange();
    if (cancelResults(searchResultsContainer)) {
        showResultMessage(searchResultsContainer, 'Search results will appear here');
    }
    savePreferences();
}

function searchTerms(input) {
    return input.value.toLowerCase().split(',').map(term => term.trim()).filter(Boolean);
}

function performSearch() {
    const range = validateSearchLengthRange();
    if (!range || searchContainer.hidden || studyToolsLocked()) return;

    const filters = {
        ...range,
        country: searchCountrySelect.value,
        start: filterLetter(searchStartLetterSelect.value),
        end: filterLetter(searchEndLetterSelect.value),
        includeTerms: searchTerms(searchIncludeInput),
        excludeTerms: searchTerms(searchExcludeInput)
    };
    requestResults(searchResultsContainer, 'search', { filters },
        'No places found matching your criteria', performSearch);
}

function markRoundAid(aid) {
    if (!roundIsOpen() || activeRound.finishing || activeRound.assists?.includes(aid) ||
        (roundDeadline !== null && getRemainingMs() === 0)) return;
    (activeRound.assists ??= []).push(aid);
    saveRound();
}

function showExamples() {
    if (displayBtn.disabled) return;
    const round = roundIsOpen() ? activeRound : undefined;
    const filters = round?.filters ?? roundFilters();
    if (!round && setupAnswerCount(filters) === 0) {
        showResultMessage(examplePlacesContainer, 'No places found matching current game filters');
        return;
    }
    const payload = { filters, roundId: round?.id };
    if (hintMode.value === 'clues') {
        showClue(payload);
        return;
    }
    requestResults(examplePlacesContainer, 'examples', payload,
        'No places found matching current game filters', showExamples);
}

function showClue(payload) {
    const needsCountry = countrySelect.value === 'placeAndCountry';
    const spelling = spellingSelect.value;
    const usesRoundGuesses = activeRound?.needsCountry === needsCountry &&
        Object.entries(payload.filters).every(([key, value]) => activeRound.filters[key] === value);
    const guessed = usesRoundGuesses ? [...acceptedAnswers] : [];
    shownClueKey = undefined;
    requestResults(examplePlacesContainer, 'clue', { ...payload, needsCountry, guessed, spelling },
        'No unguessed places match these filters', showExamples, (container, [clue]) => {
            // An answer can score while the worker is choosing a clue.
            if (usesRoundGuesses && acceptedAnswers.has(clue.answerKey)) {
                showExamples();
                return;
            }
            shownClueKey = clue.answerKey;
            markRoundAid('clue');
            const letters = clue.letters === 1 ? 'letter' : 'letters';
            showResultMessage(container, `A place in ${clue.country} with ${clue.letters} ${letters}`);
        });
}

displayBtn.addEventListener('click', showExamples);

function renderPlaces(container, places) {
    const rows = places.map(place => {
        const row = document.createElement('div');
        row.className = 'place-item';
        const city = document.createElement('strong');
        city.textContent = place.city;
        row.append(city, `, ${place.country_name}`);
        return row;
    });
    container.replaceChildren(...rows);
}

function getRemainingMs(now = performance.now()) {
    return roundDeadline === null ? pausedMs : Math.max(0, roundDeadline - now);
}

function stopTimer() {
    clearTimeout(timer);
    timer = undefined;
    roundDeadline = null;
    pausedMs = 0;
}

async function finishPractice() {
    const round = activeRound;
    const finishButton = round.playing ? startBtn : pauseBtn;
    const moveFocus = document.activeElement === finishButton;
    round.playing = false;
    round.finishing = true;
    setGuessingEnabled(false);
    updateStartButton();
    // Count guesses submitted before Finish Practice, even if the worker is still checking them.
    await guessQueue;
    if (activeRound !== round) return;
    round.finishing = false;
    finishRound();
    showGuessFeedback('Practice complete. Review your guessed places below.', true);
    if (moveFocus && !document.hidden &&
        (document.activeElement === document.body || document.activeElement === finishButton)) {
        document.getElementById('guessedPlacesTitle').focus();
    }
}

function finishRound() {
    if (!roundIsOpen()) return;
    const timeIsUp = roundDeadline !== null;
    activeRound.finishedAt = Date.now();
    activeRound.playing = false;
    stopTimer();
    updateTimerDisplay(0);
    setGuessingEnabled(false);
    setRoundSettingsDisabled(false);
    updateStartButton();
    discardSavedRound(activeRound?.attemptId);
    recordScore(activeRound);
    reviewBest.hidden = true;
    reviewNote.hidden = false;
    reviewNote.textContent = 'Checking your last guesses…';
    reviewAttempts.hidden = true;
    retryRoundBtn.disabled = true;
    roundReview.hidden = false;
    if (timeIsUp) playSound('time-up');
}

roundReview.addEventListener('toggle', async () => {
    const round = activeRound;
    if (!roundReview.open || !round?.finishedAt || round.reviewRendered) return;
    await guessQueue;
    if (!roundReview.open || activeRound !== round || round.reviewRendered) return;
    renderRoundReview(round);
});

function renderRoundReview(round) {
    round.reviewRendered = true;
    const misses = new Map();
    const entries = document.createDocumentFragment();
    let reviewedPoints = 0;
    for (const { guess, outcome, detail } of round.attempts) {
        const row = document.createElement('li');
        row.className = 'list-group-item py-1 px-2';
        const name = document.createElement('strong');
        const result = document.createElement('span');
        result.className = 'text-muted ms-2';
        name.textContent = guess;
        if (outcome === 'exact') {
            result.textContent = 'Accepted as typed · +1 point';
            reviewedPoints++;
        } else if (outcome === 'corrected') {
            result.textContent = `Accepted with a correction · ${detail} · +1 point`;
            reviewedPoints++;
        } else if (outcome === 'duplicate') {
            result.textContent = `Already counted · ${detail}`;
        } else {
            result.textContent = guessProblem(detail, round.needsCountry);
            if (detail !== 'unavailable') {
                const targets = misses.get(guess) ?? [];
                targets.push(result);
                misses.set(guess, targets);
            }
        }
        row.append(name, result);
        entries.append(row);
    }
    reviewAttempts.replaceChildren(entries);
    reviewAttempts.hidden = !round.attempts.length;
    reviewNote.textContent = reviewedPoints < score ? 'Earlier guesses are listed under Guessed Places.'
        : round.attempts.length ? '' : 'No guesses were submitted this round.';
    reviewNote.hidden = !reviewNote.textContent;
    if (Number.isInteger(round.previousBest) && score > round.previousBest) {
        const category = round.assists.length ? 'with hints' : 'without hints';
        reviewBest.textContent = `New personal best ${category} · ${pointsLabel(score)}, up from ${round.previousBest}`;
        reviewBest.hidden = false;
    }
    retryRoundBtn.disabled = false;
    const { country, start, end } = round.filters;
    if (misses.size && (country !== 'any' || start || end)) explainReviewMisses(round, misses);
}

async function explainReviewMisses(round, misses) {
    const { filters, needsCountry, setup: { spelling } } = round;
    const guesses = [...misses.keys()];
    showResultMessage(reviewFilters, 'Checking which filters ruled out guesses…');
    const job = requestPlaces('review', { filters, needsCountry, spelling, guesses });
    round.reviewJob = job;
    try {
        const results = await job.promise;
        if (activeRound !== round) return;
        const rules = {
            country: `Country must be ${filters.country}`,
            start: `Must start with ${filters.start.toUpperCase()}`,
            end: `Must end with ${filters.end.toUpperCase()}`
        };
        results.forEach((excluded, index) => {
            if (!excluded?.length) return;
            const reason = excluded.map(rule => rules[rule]).join(' · ');
            for (const target of misses.get(guesses[index])) {
                target.textContent = `Outside the filters · ${reason}`;
            }
        });
        reviewFilters.replaceChildren();
    } catch {
        if (activeRound === round) {
            showResultMessage(reviewFilters, 'Could not check the filters.', () => explainReviewMisses(round, misses), 'Retry filter check');
        }
    } finally {
        if (round.reviewJob === job) round.reviewJob = undefined;
    }
}

retryRoundBtn.addEventListener('click', () => {
    if (!activeRound?.finishedAt || !activeRound.reviewRendered) return;
    prepareSound();
    applySettings(activeRound.setup, activeRound.daily);
    savePreferences();
    roundJob?.cancel();
    prepareRound(true);
    startBtn.focus({ preventScroll: true });
});

function refreshTimer() {
    if (roundDeadline === null) return;

    const now = performance.now();
    const remainingMs = getRemainingMs(now);
    if (remainingMs === 0) {
        finishRound();
        return;
    }

    updateTimerDisplay(remainingMs);
    if (now >= nextSaveAt) {
        saveRound(remainingMs);
        nextSaveAt = now + 5000;
    }

    // Wake at the next displayed second, including a fractional last second after resume.
    timer = setTimeout(refreshTimer, Math.ceil(remainingMs % 1000 || 1000));
}

function updateTimerDisplay(remainingMs = getRemainingMs()) {
    const practice = timeSelect.value === 'practice';
    timerCaption.hidden = practice;
    timerIcon.className = practice ? 'fas fa-book' : 'fas fa-clock';
    if (practice) {
        timerDisplay.textContent = 'Practice';
        return;
    }
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function updateScoreDisplay() {
    scoreDisplay.textContent = score;
}

function clearGuessedPlaces() {
    guessedPlaces.length = 0;
    acceptedAnswers.clear();
    const empty = document.createElement('p');
    empty.className = 'text-muted';
    empty.textContent = 'No places guessed yet';
    guessedPlacesContainer.replaceChildren(empty);
}

function appendGuessedPlace(place, { needsCountry, setup: { spelling } }) {
    const answerName = name => spelling === 'accent-friendly' ? name.toLowerCase().normalize() : name.toLowerCase();
    const city = answerName(place.city);
    const key = needsCountry ? JSON.stringify([city, answerName(place.country)]) : city;
    if (acceptedAnswers.has(key)) return false;

    acceptedAnswers.add(key);
    if (shownClueKey === key) clearExamples();
    if (guessedPlaces.length === 0) guessedPlacesContainer.firstElementChild?.remove();
    guessedPlaces.push(place);

    const row = document.createElement('div');
    row.className = 'place-item';
    row.textContent = needsCountry && place.country ? `${place.city}, ${place.country}` : place.city;
    guessedPlacesContainer.append(row);
    return true;
}

function currentSettings() {
    return Object.fromEntries(Object.entries(roundFields).map(([key, { input }]) => [key, input.value]));
}

function loadSharedSetup() {
    const params = new URLSearchParams(window.location.search);
    hasSharedSetup = params.has('setup');
    if (!hasSharedSetup) return false;

    if (params.getAll('setup').length !== 1 || params.get('setup') !== setupLinkVersion) {
        sharedSetupStatus.textContent = 'This setup link uses an unsupported format. Choose your own rules to play.';
        refreshSetup();
        return true;
    }

    const setup = {};
    for (const [key, { input, label }] of Object.entries(roundFields)) {
        const values = params.getAll(key);
        const value = values[0];
        if (values.length === 1 && value && Array.from(input.options).some(option => option.value === value)) {
            setup[key] = value;
            continue;
        }

        const placeholder = new Option('Choose again', '');
        placeholder.disabled = true;
        placeholder.dataset.sharedPlaceholder = '';
        input.add(placeholder, 0);
        input.setAttribute('aria-invalid', 'true');
        if (key !== 'hints') {
            const description = input.getAttribute('aria-describedby');
            input.setAttribute('aria-describedby', description ? `${description} sharedSetupStatus` : 'sharedSetupStatus');
        }

        const supplied = value?.length > 64 ? `${value.slice(0, 64)}…` : value;
        const message = values.length > 1 ? `${label} has more than one value` :
            supplied ? `${label} “${supplied}” is unavailable` : `${label} is missing`;
        sharedSetupIssues.set(key, message);
        setup[key] = '';
    }

    applySettings(setup);
    updateSharedSetupStatus();
    refreshSetup();
    return true;
}

function clearSharedField(key) {
    const { input } = roundFields[key];
    input.querySelector('[data-shared-placeholder]')?.remove();
    input.removeAttribute('aria-invalid');
    const descriptions = input.getAttribute('aria-describedby')?.split(' ').filter(id => id !== 'sharedSetupStatus');
    if (descriptions?.length) input.setAttribute('aria-describedby', descriptions.join(' '));
    else input.removeAttribute('aria-describedby');
}

function updateSharedSetupStatus() {
    const blocked = sharedSetupIssues.size > 0;
    sharedSetupStatus.classList.toggle('text-muted', !blocked);
    sharedSetupStatus.textContent = blocked
        ? `${[...sharedSetupIssues.values()].join('. ')}. Choose again to start.`
        : 'Shared setup loaded. Start Game when ready.';
    copyCurrentSetupBtn.disabled = blocked;
    saveCurrentSetupBtn.disabled = blocked;
    updateStudyTools();
}

function clearSharedSetup() {
    if (!hasSharedSetup) return;
    hasSharedSetup = false;
    for (const key of sharedSetupIssues.keys()) clearSharedField(key);
    sharedSetupIssues.clear();
    sharedSetupStatus.textContent = '';
    copyCurrentSetupBtn.disabled = false;
    saveCurrentSetupBtn.disabled = false;

    const url = new URL(window.location.href);
    for (const key of ['setup', ...Object.keys(roundFields)]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url);
}

async function copySetupLink(setup) {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ setup: setupLinkVersion, ...setup }).toString();
    url.hash = '';
    setupLinkText.value = url.href;
    setupLinkFallback.hidden = true;
    try {
        await navigator.clipboard.writeText(url.href);
        if (preferencesDialog.open && setupLinkText.value === url.href) showSetupStatus(true, 'Setup link copied');
    } catch {
        if (!preferencesDialog.open || setupLinkText.value !== url.href) return;
        setupLinkFallback.hidden = false;
        showSetupStatus(true, 'Copy the selected link');
        setupLinkText.focus();
        setupLinkText.select();
    }
}

function dailyChallengeFor(date = new Date().toISOString().slice(0, 10)) {
    const { worldwide, regions } = catalog.dailyStarts;
    let seed = 2166136261;
    for (const character of `${date}/${catalog.revision}`) {
        seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
    }
    const [countryIndex, starts] = (seed & 1) && regions.length
        ? regions[(seed >>> 1) % regions.length] : [-1, worldwide];
    return {
        daily: { date, revision: catalog.revision },
        setup: {
            country: catalog.countries[countryIndex] ?? 'any',
            start: starts[(seed >>> 12) % starts.length],
            end: 'any',
            minutes: seed & 256 ? '2' : '1',
            spelling: 'standard',
            hints: 'after'
        }
    };
}

function setDailySelection(daily) {
    selectedDaily = daily;
    dailyRoundLabel.hidden = !daily;
    dailyRoundLabel.textContent = daily ? `Daily challenge · ${daily.date} UTC` : '';
}

function applySettings(setup, daily = null) {
    const expected = daily?.revision === catalog.revision ? dailyChallengeFor(daily.date).setup : null;
    const validDaily = expected && storage.challengeKey(expected) === storage.challengeKey(setup) && setup.hints === expected.hints;
    setDailySelection(validDaily ? daily : null);
    for (const [key, { input }] of Object.entries(roundFields)) input.value = setup[key];
    updatePlaceInputPlaceholder();
    updateTimerDisplay();
    updateStudyTools();
    clearExamples();
}

function savePreferences() {
    const setup = sharedSetupIssues.size ? storage.read('preferences')?.setup ?? storage.normalize.preferences().setup : currentSettings();
    return storage.write('preferences', {
        setup,
        leaveMode: leaveMode.value,
        soundMode: soundMode.value,
        search: {
            country: searchCountrySelect.value,
            start: searchStartLetterSelect.value,
            end: searchEndLetterSelect.value,
            include: searchIncludeInput.value,
            exclude: searchExcludeInput.value,
            min: searchMinLengthInput.value,
            max: searchMaxLengthInput.value
        },
        showRules: !rulesContainer.hidden,
        showSearch: !searchContainer.hidden,
        presets: savedSetups
    });
}

function applyPreferences(preferences) {
    const { setup, search, showRules, showSearch, presets } = preferences;
    applySettings(setup);
    leaveMode.value = preferences.leaveMode;
    soundMode.value = preferences.soundMode;
    updateLeaveModeHint();
    searchCountrySelect.value = search.country;
    searchStartLetterSelect.value = search.start;
    searchEndLetterSelect.value = search.end;
    searchIncludeInput.value = search.include;
    searchExcludeInput.value = search.exclude;
    searchMinLengthInput.value = search.min;
    searchMaxLengthInput.value = search.max;
    validateSearchLengthRange();
    setPanelVisibility(rulesBtn, rulesContainer, showRules);
    setPanelVisibility(showSearchBtn, searchContainer, showSearch && !studyToolsLocked());
    savedSetups = presets;
}

function saveRound(remainingMs = getRemainingMs()) {
    if (leaveMode.value !== 'save' || !roundIsOpen()) return;
    const practice = activeRound.setup.minutes === 'practice';
    if (!practice && remainingMs === 0) {
        if (roundDeadline !== null) finishRound();
        return;
    }
    storage.write('round', {
        id: activeRound.attemptId,
        setup: activeRound.setup,
        remainingMs: practice ? null : remainingMs,
        guesses: guessedPlaces,
        attempts: activeRound.attempts,
        assists: activeRound.assists,
        ...(activeRound.daily ? { daily: activeRound.daily } : {})
    });
}

function discardSavedRound(attemptId) {
    if (attemptId && storage.read('round')?.id === attemptId) storage.remove('round');
}

function recordScore(round) {
    const entry = { id: round.attemptId, setup: round.setup, finishedAt: round.finishedAt, score, assists: round.assists, daily: round.daily };
    const record = round.setup.minutes === 'practice' ? 'practice-history' : 'history';
    const history = (storage.available ? storage.read(record) : null) ?? scoreHistories[record];
    const earlier = history.filter(item => item.id !== entry.id);
    if (round.previousBest === undefined) {
        const category = storage.scoreCategory(entry.assists);
        const key = storage.challengeKey(entry.setup);
        const best = storage.groupScores(earlier).get(key)?.best[category];
        round.previousBest = category === 'unknown' ? null : best?.score ?? null;
    }
    scoreHistories[record] = storage.normalize[record]([entry, ...earlier]);
    storage.write(record, scoreHistories[record]);
    if (preferencesDialog.open) renderScorebook(scorebookSetup.value);
}

function loadScoreHistories() {
    for (const record of Object.keys(scoreHistories)) {
        scoreHistories[record] = storage.read(record) ?? scoreHistories[record];
    }
}

function restoreGame(preferences, savedRound) {
    applyPreferences(preferences ?? storage.normalize.preferences());
    if (loadSharedSetup()) return;
    if (!savedRound) {
        refreshSetup();
        return;
    }

    restoringRound = savedRound;
    applySettings(savedRound.setup, savedRound.daily);
    if (setupAnswerCount(roundFilters()) === 0) {
        restoringRound = undefined;
        discardSavedRound(savedRound.id);
        refreshSetup();
        return;
    }
    pausedMs = savedRound.remainingMs ?? 0;
    updateTimerDisplay();
    setGuessingEnabled(false);
    setRoundSettingsDisabled(true);
    prepareRound();
}

function loadGameState() {
    const preferences = storage.read('preferences');
    loadScoreHistories();
    const savedRound = storage.read('round');
    if (!legacyStorage || (preferences && savedRound)) {
        restoreGame(preferences, savedRound);
        return;
    }

    readingSavedState = true;
    updateStartButton();
    legacyStorage.get(legacyKeys, (result = {}) => {
        if (!readingSavedState) return;
        readingSavedState = false;
        const round = result.gameState;
        const setup = result.gameSettings;
        const filters = result.searchFilters;
        const current = storage.read('preferences');
        let imported = current ?? preferences;
        let resumable = savedRound;
        const migrated = [];

        if (!imported && (setup || filters || round)) {
            imported = storage.normalize.preferences({
                setup: {
                    country: setup?.selectedCountryValue,
                    start: setup?.letter,
                    end: setup?.endLetter,
                    minutes: setup?.timeLimit
                },
                search: {
                    country: filters?.country,
                    start: filters?.startLetter,
                    end: filters?.endLetter,
                    include: filters?.includeTerm,
                    exclude: filters?.excludeTerm,
                    min: filters?.minLength,
                    max: filters?.maxLength
                },
                showRules: round?.isRulesVisible,
                showSearch: round?.isSearchVisible
            });
            if (storage.write('preferences', imported)) migrated.push('gameSettings', 'searchFilters');
        }
        if (!resumable && round) {
            resumable = storage.normalize.round({
                id: newAttemptId(),
                setup: imported?.setup,
                remainingMs: round.remainingMs ?? Number(round.timeLeft) * 1000,
                guesses: round.guessedPlaces ?? []
            });
            if (resumable && storage.write('round', resumable)) migrated.push('gameState');
        }
        if (migrated.length) legacyStorage.remove(migrated);
        restoreGame(imported, resumable);
    });
}

function updateSavedSetupAvailability() {
    const locked = countrySelect.disabled;
    for (const button of savedSetupList.querySelectorAll('.saved-setup-apply')) button.disabled = locked;
    document.getElementById('loadSetupHint').hidden = !locked || !savedSetups.length;
}

function renderSavedSetups() {
    savedSetupList.replaceChildren(...savedSetups.map((preset, index) => {
        const item = document.createElement('li');
        item.className = 'd-flex flex-wrap gap-2';

        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'btn btn-outline-primary btn-sm saved-setup-apply';
        apply.textContent = preset.name;
        apply.setAttribute('aria-label', `Apply ${preset.name}`);
        apply.addEventListener('click', () => {
            if (countrySelect.disabled) return;
            clearSharedSetup();
            applySettings(preset.setup);
            refreshSetup();
            savePreferences();
            preferencesDialog.close();
            document.getElementById('settings-heading').focus();
        });

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn btn-outline-secondary btn-sm';
        copy.textContent = 'Copy setup link';
        copy.setAttribute('aria-label', `Copy setup link for ${preset.name}`);
        copy.addEventListener('click', () => copySetupLink(preset.setup));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-outline-secondary btn-sm';
        remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete ${preset.name}`);
        remove.addEventListener('click', () => {
            savedSetups.splice(index, 1);
            const saved = savePreferences();
            showSetupStatus(saved, saved ? `Deleted ${preset.name}` : storageWarning);
            renderSavedSetups();
            const nextRow = savedSetupList.children[index] ?? savedSetupList.lastElementChild;
            (nextRow?.querySelector('button:last-child') ?? setupName).focus();
        });

        const actions = document.createElement('div');
        actions.className = 'd-flex gap-2';
        actions.append(copy, remove);
        item.append(apply, actions);
        return item;
    }));
    document.getElementById('emptySetups').hidden = Boolean(savedSetups.length);
    document.getElementById('savedSetupHint').textContent = savedSetups.length > savedSetupLimit
        ? 'Your earlier setups are still here. To save a new one, bring the list below five or use a saved name.'
        : 'Save up to five favorites. Select a saved name to apply it.';
    updateSavedSetupAvailability();
}

function showSetupStatus(success, message) {
    setupStatus.classList.toggle('text-muted', success);
    setupStatus.textContent = message;
}

const scoreDates = new Intl.DateTimeFormat(undefined, { dateStyle: 'short' });
const aidLabels = { clue: 'Clues', examples: 'Examples', search: 'Search' };

function challengeLabel(setup) {
    const country = { placeAndCountry: 'Place and Country', any: 'Any Country' }[setup.country] ?? setup.country;
    const time = setup.minutes === 'practice' ? 'Untimed practice' : `${setup.minutes} min`;
    const spelling = spellingSelect.querySelector(`[value="${setup.spelling}"]`).textContent;
    const letters = setup.start === 'any' && setup.end === 'any' ? '' :
        ` · ${setup.start === 'any' ? 'Any' : setup.start} → ${setup.end === 'any' ? 'Any' : setup.end}`;
    return `${country}${letters} · ${spelling} · ${time}`;
}

function renderScorebook(preferred) {
    const current = currentSettings();
    const currentKey = storage.challengeKey(current);
    const groups = storage.groupScores(Object.values(scoreHistories).flat());
    const options = [new Option(`Current setup · ${challengeLabel(current)}`, currentKey)];
    for (const [key, group] of groups) {
        if (key !== currentKey) options.push(new Option(challengeLabel(group.setup), key));
    }
    scorebookSetup.replaceChildren(...options);
    scorebookSetup.value = groups.has(preferred) ? preferred : currentKey;
    renderScorebookChallenge(groups.get(scorebookSetup.value));
    renderScoreHistory('savedScores', 'emptyScores', scoreHistories.history);
    renderScoreHistory('savedPracticeScores', 'emptyPracticeScores', scoreHistories['practice-history']);
}

function renderScorebookChallenge(group) {
    document.getElementById('scorebookEmpty').hidden = Boolean(group);
    const bests = document.getElementById('scorebookBests');
    const recent = document.getElementById('scorebookRecent');
    bests.hidden = recent.hidden = document.getElementById('scorebookRecentTitle').hidden = !group;
    const bestLabels = { unassisted: 'Best without hints', assisted: 'Best with hints', unknown: 'Best with hint use unknown' };
    const bestRows = group ? Object.entries(bestLabels).flatMap(([category, label]) => {
        const best = group.best[category];
        if (!best) return [];
        const row = document.createElement('li');
        const heading = document.createElement('strong');
        heading.textContent = label;
        row.append(heading, ` · ${pointsLabel(best.score)}`);
        return [row];
    }) : [];
    bests.replaceChildren(...bestRows);
    recent.replaceChildren(...(group?.recent ?? []).map(entry => {
        const row = document.createElement('li');
        row.textContent = `${pointsLabel(entry.score)} · ${scoreDetails(entry)}`;
        return row;
    }));
}

function pointsLabel(score) {
    return `${score} ${score === 1 ? 'point' : 'points'}`;
}

function assistsLabel(assists) {
    if (assists === null) return 'Hint use unknown';
    return assists.length ? assists.map(aid => aidLabels[aid]).join(', ') : 'No hints';
}

function scoreDetails(entry) {
    const date = entry.daily ? `Daily challenge ${entry.daily.date} UTC` : scoreDates.format(entry.finishedAt);
    return `${assistsLabel(entry.assists)} · ${date}`;
}

function renderScoreHistory(listId, emptyId, entries) {
    const list = document.getElementById(listId);
    list.replaceChildren(...entries.slice(0, 20).map(entry => {
        const row = document.createElement('li');
        row.textContent = `${pointsLabel(entry.score)} · ${challengeLabel(entry.setup)} · ${scoreDetails(entry)}`;
        return row;
    }));
    list.hidden = !entries.length;
    document.getElementById(emptyId).hidden = Boolean(entries.length);
}

scorebookSetup.addEventListener('change', () => {
    const group = storage.groupScores(Object.values(scoreHistories).flat()).get(scorebookSetup.value);
    renderScorebookChallenge(group);
});

function setClearPrompt(visible) {
    clearDataPrompt.hidden = !visible;
    clearDataBtn.hidden = visible;
}

const storageWarning = 'This browser is blocking game storage. Changes may be lost when you leave';
const leaveModeHints = {
    count: 'Timed rounds keep counting in the background. Refreshing starts fresh.',
    pause: 'The round pauses in the background. Resume in this tab when you return. Refreshing starts fresh.',
    save: 'The round pauses when you leave. This browser saves your progress so you can resume after refreshing.'
};

function updateLeaveModeHint() {
    leaveModeHint.textContent = leaveModeHints[leaveMode.value];
}

leaveMode.addEventListener('change', () => {
    updateLeaveModeHint();
    if (leaveMode.value === 'save') saveRound();
    else discardSavedRound(activeRound?.attemptId ?? restoringRound?.id);
    preferencesStatus.textContent = savePreferences() && storage.available ? '' : storageWarning;
});

soundMode.addEventListener('change', () => {
    prepareSound();
    preferencesStatus.textContent = savePreferences() ? '' : storageWarning;
});
preferencesDialog.querySelector('form[method="dialog"]').addEventListener('submit', prepareSound);

copyCurrentSetupBtn.addEventListener('click', () => {
    if (!sharedSetupIssues.size) copySetupLink(currentSettings());
});

dailyChallengeBtn.addEventListener('click', () => {
    if (dailyChallengeBtn.disabled) return;
    clearSharedSetup();
    const { daily, setup } = dailyChallengeFor();
    applySettings(setup, daily);
    refreshSetup();
    preferencesDialog.close();
    startBtn.focus();
});

preferencesBtn.addEventListener('click', () => {
    const { daily, setup } = dailyChallengeFor();
    const country = setup.country === 'any' ? 'Any country' : setup.country;
    const time = setup.minutes === '1' ? '1 minute' : `${setup.minutes} minutes`;
    dailyChallengeRules.textContent = `${daily.date} UTC · ${country} · Starts with ${setup.start} · ${time} · Standard spelling · Hints after the round`;
    renderSavedSetups();
    setupStatus.textContent = '';
    setupLinkFallback.hidden = true;
    setupLinkText.value = '';
    if (storage.available) loadScoreHistories();
    renderScorebook();
    setClearPrompt(false);
    preferencesStatus.textContent = storage.available ? '' : storageWarning;
    preferencesDialog.showModal();
});

document.getElementById('saveSetupForm').addEventListener('submit', event => {
    event.preventDefault();
    if (sharedSetupIssues.size) return;
    const name = setupName.value.trim();
    if (!name) {
        showSetupStatus(false, 'Enter a name for this setup');
        setupName.focus();
        return;
    }

    const key = name.toLowerCase();
    const index = savedSetups.findIndex(preset => preset.name.toLowerCase() === key);
    if (index === -1 && savedSetups.length >= savedSetupLimit) {
        showSetupStatus(false, 'Make room for a new setup or reuse a saved name');
        return;
    }

    const setup = { name, setup: currentSettings() };
    if (index === -1) savedSetups.push(setup);
    else savedSetups[index] = setup;
    const saved = savePreferences();
    showSetupStatus(saved, saved ? `Saved ${name}` : storageWarning);
    setupName.value = '';
    renderSavedSetups();
});

clearDataBtn.addEventListener('click', () => {
    setClearPrompt(true);
    document.getElementById('cancelClearDataBtn').focus();
});

document.getElementById('cancelClearDataBtn').addEventListener('click', () => {
    setClearPrompt(false);
    clearDataBtn.focus();
});

document.getElementById('confirmClearDataBtn').addEventListener('click', () => {
    legacyStorage?.remove(legacyKeys);
    clearSharedSetup();
    applyPreferences(storage.normalize.preferences());
    cancelResults(searchResultsContainer);
    showResultMessage(searchResultsContainer, 'Search results will appear here');
    resetAttempt();
    const records = ['round', 'preferences', ...Object.keys(scoreHistories)];
    const cleared = records.map(record => storage.remove(record)).every(Boolean);
    for (const record of Object.keys(scoreHistories)) scoreHistories[record] = [];
    setupName.value = '';
    setupStatus.textContent = '';
    setupLinkFallback.hidden = true;
    setupLinkText.value = '';
    renderSavedSetups();
    renderScorebook();
    setClearPrompt(false);
    clearDataBtn.focus();
    preferencesStatus.textContent = cleared ? 'Saved game data cleared' : 'This browser blocked access to saved data';
});

enterBtn.addEventListener('click', enterPlace);
placeInput.addEventListener('input', () => {
    guessEditVersion++;
    showGuessFeedback('');
});
placeInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        enterPlace();
    }
});

function handleLeaving() {
    if (!activeRound?.playing) return;
    if (leaveMode.value !== 'count') pauseRound();
    else if (roundDeadline !== null && getRemainingMs() === 0) finishRound();
}

function catchUpTimer() {
    if (roundDeadline === null) return;
    clearTimeout(timer);
    refreshTimer();
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) handleLeaving();
    else catchUpTimer();
});
window.addEventListener('pagehide', handleLeaving);
window.addEventListener('pageshow', event => {
    if (event.persisted) catchUpTimer();
});

initGame();
