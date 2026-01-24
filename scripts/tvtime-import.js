#!/usr/bin/env node
// Usage (from repo root):
//   node scripts/tvtime-import.js --input temp/tv-time-personal-data
//   node scripts/tvtime-import.js --input temp/tv-time-personal-data --overrides /path/to/overrides.json
//   node scripts/tvtime-import.js --input temp/tv-time-personal-data --history tracking-prod-records-v2.csv
//
// Output files (default):
//   temp/tv-time-personal-data/episodely-import.json
//   temp/tv-time-personal-data/episodely-import-report.json
//
// Overrides file format (JSON map):
//   {
//     "The Office (US)": 526,
//     "Battlestar Galactica (2003)": 814
//   }
//
// Notes:
// - The script resolves show/episode IDs via the TVmaze API.
// - Use --delay <ms> to throttle TVmaze requests (default 250ms).
// - The report lists unmatched shows/episodes for manual fixes.
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const options = parseArgs(process.argv.slice(2));

if (options.help) {
    printUsage();
    process.exit(0);
}

const inputDir = options.input || options.dir || 'temp/tv-time-personal-data';
const outputPath =
    options.output || path.join(inputDir, 'episodely-import.json');
const reportPath =
    options.report || path.join(inputDir, 'episodely-import-report.json');
const cachePath = options.cache || path.join(inputDir, '.tvmaze-cache.json');
const overridesPath = options.overrides;
const useCache = !options['no-cache'];
const delayMs = options.delay ? Number(options.delay) : 250;
const verbose = Boolean(options.verbose);

const shows = new Map();
const episodeWatchCounts = { total: 0 };
let lastRequestAt = 0;

const showSources = [
    { file: 'followed_tv_show.csv', nameField: 'tv_show_name', dateField: 'created_at' },
    { file: 'followed_tv_show_source.csv', nameField: 'tv_show_name', dateField: 'created_at' },
    { file: 'user_tv_show_data.csv', nameField: 'tv_show_name', dateField: null },
];

const historyFile = options.history || 'tracking-prod-records-v2.csv';

for (const source of showSources) {
    await loadShowList(source);
}

await loadWatchHistory(historyFile);

if (shows.size === 0) {
    console.error('No shows found. Check the input directory or file names.');
    process.exit(1);
}

const cache = useCache ? loadCache(cachePath) : { shows: {}, episodes: {} };
const overrides = overridesPath ? loadOverrides(overridesPath) : {};
const report = {
    unmatchedShows: [],
    unmatchedEpisodes: [],
    yearConflicts: [],
    countryConflicts: [],
};

const output = {
    version: 1,
    exportedAt: new Date().toISOString(),
    shows: [],
};

for (const show of shows.values()) {
    if (show.yearConflict) {
        report.yearConflicts.push({ name: show.name, baseName: show.baseName });
    }
    if (show.countryConflict) {
        report.countryConflicts.push({ name: show.name, baseName: show.baseName });
    }

    const resolved = await resolveShow(show, overrides, cache, delayMs, verbose);
    if (!resolved) {
        report.unmatchedShows.push({
            name: show.name,
            baseName: show.baseName,
            yearHint: show.yearHint,
            countryHint: show.countryHint,
        });
        continue;
    }

    const episodeMap = await getEpisodeMap(
        resolved.id,
        cache,
        delayMs,
        verbose
    );
    const watchedEpisodes = [];
    for (const [episodeKey, watchedAt] of show.watchedEpisodes.entries()) {
        const episodeId = episodeMap.get(episodeKey);
        if (!episodeId) {
            const [season, episode] = episodeKey.split(':');
            report.unmatchedEpisodes.push({
                show: show.name,
                season: Number(season),
                episode: Number(episode),
            });
            continue;
        }
        watchedEpisodes.push({
            tvmazeEpisodeId: episodeId,
            watchedAt: watchedAt || undefined,
        });
    }

    output.shows.push({
        tvmazeId: resolved.id,
        name: show.name,
        addedAt: show.addedAt || undefined,
        watchedEpisodes,
    });
}

if (useCache) {
    saveCache(cachePath, cache);
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(
    `Converted ${output.shows.length} shows. ` +
        `Wrote ${outputPath} and ${reportPath}.`
);

if (report.unmatchedShows.length > 0) {
    console.log(
        `Unmatched shows: ${report.unmatchedShows.length}. ` +
            `Use --overrides to map them.`
    );
}

if (report.unmatchedEpisodes.length > 0) {
    console.log(
        `Unmatched episodes: ${report.unmatchedEpisodes.length}. ` +
            `Check season/episode numbering or show matches.`
    );
}

async function loadShowList(source) {
    const filePath = path.join(inputDir, source.file);
    const hadFile = await forEachCsvRow(filePath, (row) => {
        const name = (row[source.nameField] || '').trim();
        if (!name) return;
        const addedAt = source.dateField
            ? normalizeDate(row[source.dateField])
            : null;
        addOrUpdateShow(name, addedAt);
    });
    if (!hadFile && verbose) {
        console.log(`Missing ${source.file}, skipping.`);
    }
}

async function loadWatchHistory(fileName) {
    const filePath = path.join(inputDir, fileName);
    const hadFile = await forEachCsvRow(filePath, (row) => {
        const name = (row.series_name || '').trim();
        if (!name) return;
        const seasonNumber = parseInt(row.season_number, 10);
        const episodeNumber = parseInt(row.episode_number, 10);
        if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
            return;
        }
        const watchedAt =
            normalizeDate(row.created_at) || normalizeDate(row.updated_at);

        const entry = addOrUpdateShow(name, null);
        const episodeKey = `${seasonNumber}:${episodeNumber}`;
        const existing = entry.watchedEpisodes.get(episodeKey);
        if (!existing || (watchedAt && watchedAt < existing)) {
            entry.watchedEpisodes.set(episodeKey, watchedAt || null);
        }
        episodeWatchCounts.total += 1;
    });
    if (!hadFile) {
        console.error(`Missing ${fileName}. Provide --history to set the file.`);
        process.exit(1);
    }
}

function addOrUpdateShow(name, addedAt) {
    const hints = extractHints(name);
    const key = normalizeName(hints.baseName);
    let entry = shows.get(key);

    if (!entry) {
        entry = {
            name,
            baseName: hints.baseName,
            yearHint: hints.yearHint || null,
            countryHint: hints.countryHint || null,
            yearConflict: false,
            countryConflict: false,
            addedAt: addedAt || null,
            watchedEpisodes: new Map(),
        };
        shows.set(key, entry);
        return entry;
    }

    if (shouldPreferName(entry.name, name)) {
        entry.name = name;
    }

    if (!entry.yearHint && hints.yearHint) {
        entry.yearHint = hints.yearHint;
    } else if (
        entry.yearHint &&
        hints.yearHint &&
        entry.yearHint !== hints.yearHint
    ) {
        entry.yearHint = null;
        entry.yearConflict = true;
    }

    if (!entry.countryHint && hints.countryHint) {
        entry.countryHint = hints.countryHint;
    } else if (
        entry.countryHint &&
        hints.countryHint &&
        entry.countryHint !== hints.countryHint
    ) {
        entry.countryHint = null;
        entry.countryConflict = true;
    }

    if (addedAt && (!entry.addedAt || addedAt < entry.addedAt)) {
        entry.addedAt = addedAt;
    }

    return entry;
}

function shouldPreferName(current, candidate) {
    if (!current) return true;
    const currentHasHint = /\([^)]*\)/.test(current);
    const candidateHasHint = /\([^)]*\)/.test(candidate);
    if (!currentHasHint && candidateHasHint) return true;
    return candidate.length > current.length;
}

function extractHints(name) {
    const trimmed = name.trim();
    let baseName = trimmed;
    let yearHint = null;
    let countryHint = null;
    const match = trimmed.match(/\s*\(([^)]+)\)\s*$/);
    if (match) {
        const hint = match[1].trim();
        baseName = trimmed.slice(0, match.index).trim() || trimmed;
        const yearMatch = hint.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            yearHint = yearMatch[0];
        } else {
            const countryMatch = hint.match(/^(US|UK|AU|CA|NZ)$/i);
            if (countryMatch) {
                countryHint = countryMatch[1].toUpperCase();
            }
        }
    }
    return { baseName, yearHint, countryHint };
}

function normalizeName(value) {
    return value
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeDate(value) {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/.test(trimmed)) {
        return `${trimmed.replace(' ', 'T')}Z`;
    }
    if (/^\\d{4}-\\d{2}-\\d{2}T/.test(trimmed)) {
        return trimmed;
    }
    return null;
}

async function resolveShow(show, overrides, cache, delay, logVerbose) {
    const override = lookupOverride(show, overrides);
    if (override) {
        return { id: override, name: show.name };
    }

    const cacheKey = [
        normalizeName(show.baseName),
        show.yearHint || '',
        show.countryHint || '',
    ].join('|');
    if (cache.shows[cacheKey]) {
        return cache.shows[cacheKey];
    }

    const results = await tvmazeSearch(show.baseName, delay);
    if (!results.length) {
        if (logVerbose) {
            console.log(`No TVmaze match for "${show.name}".`);
        }
        return null;
    }

    const best = pickBestCandidate(results, show);
    if (!best) {
        return null;
    }

    cache.shows[cacheKey] = {
        id: best.id,
        name: best.name,
        premiered: best.premiered,
    };
    return cache.shows[cacheKey];
}

function lookupOverride(show, overrides) {
    if (!overrides || Object.keys(overrides).length === 0) {
        return null;
    }
    const keys = [
        show.name,
        show.baseName,
        normalizeName(show.name),
        normalizeName(show.baseName),
    ];
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
            const value = overrides[key];
            if (typeof value === 'number') return value;
            if (typeof value === 'string') return Number(value);
            if (value && typeof value.id === 'number') return value.id;
            if (value && typeof value.id === 'string') return Number(value.id);
        }
    }
    return null;
}

function pickBestCandidate(results, show) {
    const baseName = normalizeName(show.baseName);
    let best = null;
    let bestScore = -Infinity;

    for (const result of results) {
        const candidate = result.show;
        if (!candidate) continue;
        const candidateName = normalizeName(candidate.name || '');
        let score = (result.score || 0) * 10;

        if (candidateName === baseName) {
            score += 50;
        } else if (
            candidateName.includes(baseName) ||
            baseName.includes(candidateName)
        ) {
            score += 10;
        }

        if (show.yearHint && candidate.premiered) {
            if (candidate.premiered.startsWith(show.yearHint)) {
                score += 30;
            }
        }

        if (show.countryHint) {
            const country = candidate.network?.country?.code ||
                candidate.webChannel?.country?.code;
            if (country === show.countryHint) {
                score += 15;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    return best;
}

async function getEpisodeMap(showId, cache, delay, logVerbose) {
    const cached = cache.episodes[String(showId)];
    if (cached) {
        return new Map(Object.entries(cached));
    }

    const episodes = await tvmazeFetch(`/shows/${showId}/episodes`, delay);
    const map = new Map();
    for (const episode of episodes) {
        if (!episode || episode.season == null || episode.number == null) {
            continue;
        }
        map.set(`${episode.season}:${episode.number}`, episode.id);
    }

    cache.episodes[String(showId)] = Object.fromEntries(map);
    if (logVerbose) {
        console.log(`Loaded ${map.size} episodes for show ${showId}.`);
    }
    return map;
}

async function tvmazeSearch(query, delay) {
    const results = await tvmazeFetch(
        `/search/shows?q=${encodeURIComponent(query)}`,
        delay
    );
    return Array.isArray(results) ? results : [];
}

async function tvmazeFetch(pathname, delay) {
    await rateLimit(delay);
    const response = await fetch(`https://api.tvmaze.com${pathname}`, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'episodely-importer',
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`TVmaze error ${response.status}: ${text}`);
    }

    return response.json();
}

async function rateLimit(delay) {
    if (!delay || Number.isNaN(delay)) {
        return;
    }
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    if (elapsed < delay) {
        await new Promise((resolve) => setTimeout(resolve, delay - elapsed));
    }
    lastRequestAt = Date.now();
}

function loadCache(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            shows: parsed.shows || {},
            episodes: parsed.episodes || {},
        };
    } catch (error) {
        return { shows: {}, episodes: {} };
    }
}

function saveCache(filePath, cache) {
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2));
}

function loadOverrides(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
}

async function forEachCsvRow(filePath, onRow) {
    if (!fs.existsSync(filePath)) {
        return false;
    }

    const input = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    let headers = null;

    for await (const line of rl) {
        if (!line.trim()) continue;
        const values = parseCsvLine(line);
        if (!headers) {
            headers = values;
            continue;
        }
        const row = {};
        for (let index = 0; index < headers.length; index += 1) {
            row[headers[index]] = values[index] ?? '';
        }
        await onRow(row);
    }

    return true;
}

function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    const trimmed = line.replace(/\\r$/, '');

    for (let i = 0; i < trimmed.length; i += 1) {
        const char = trimmed[i];
        if (char === '"') {
            if (inQuotes && trimmed[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            parsed.help = true;
            continue;
        }
        if (!arg.startsWith('--')) {
            continue;
        }
        const [key, valueFromEq] = arg.slice(2).split('=');
        if (valueFromEq !== undefined) {
            parsed[key] = valueFromEq;
            continue;
        }
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            parsed[key] = next;
            i += 1;
        } else {
            parsed[key] = true;
        }
    }
    return parsed;
}

function printUsage() {
    console.log(`Usage: node scripts/tvtime-import.js [options]

Options:
  --input <dir>       Folder with TV Time export (default: temp/tv-time-personal-data)
  --history <file>    History CSV file name (default: tracking-prod-records-v2.csv)
  --output <file>     Output JSON file path
  --report <file>     Output report JSON path
  --overrides <file>  JSON map of show names to TVmaze IDs
  --cache <file>      Cache file path (default: .tvmaze-cache.json)
  --no-cache          Disable reading/writing cache
  --delay <ms>        Delay between TVmaze requests (default: 250)
  --verbose           Extra logging
  --help              Show this help
`);
}
