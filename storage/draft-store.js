import { STORAGE_KEY, STORAGE_NAME } from '../constants.js';

const DEFAULT_DRAFT_STATUS = 'unsynced';

function sortSnapshots(records) {
    return [...records].sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
}

function normalizeStatus(value) {
    return value === 'archived' ? 'archived' : DEFAULT_DRAFT_STATUS;
}

function getRecordOwnerKey(record) {
    if (record?.ownerKey) {
        return record.ownerKey;
    }

    const groupMatch = typeof record?.draftKey === 'string'
        ? record.draftKey.match(/^group:([^:]+):/)
        : null;

    if (groupMatch) {
        return `group-owner:${groupMatch[1]}`;
    }

    const avatar = Array.isArray(record?.chatData)
        ? record.chatData.find((message) => !message?.is_user && !message?.is_system && typeof message?.original_avatar === 'string')
            ?.original_avatar
        : null;

    return avatar ? `character-owner:${avatar}` : null;
}

function hydrateRecord(record) {
    if (!record) {
        return null;
    }

    const ownerKey = getRecordOwnerKey(record);
    const draftStatus = normalizeStatus(record.draftStatus);

    return {
        ...record,
        draftStatus,
        archivedAt: draftStatus === 'archived' ? Number(record.archivedAt ?? record.updatedAt ?? Date.now()) : null,
        lastSyncedHash: record.lastSyncedHash ?? null,
        ownerKey: ownerKey ?? null,
    };
}

function filterByStatuses(records, statuses) {
    if (!Array.isArray(statuses) || statuses.length === 0) {
        return records;
    }

    const allowed = new Set(statuses.map((status) => normalizeStatus(status)));
    return records.filter((record) => allowed.has(normalizeStatus(record.draftStatus)));
}

function getPreferredSnapshot(records) {
    return sortSnapshots(records).map((record) => hydrateRecord(record)).at(0) ?? null;
}

function getDisplaySnapshot(records, statuses) {
    const hydrated = sortSnapshots(records).map((record) => hydrateRecord(record));
    const filtered = filterByStatuses(hydrated, statuses);
    return getPreferredSnapshot(filtered);
}

function listLatestRecords(records, statuses) {
    return Object.values(records)
        .map((snapshots) => getDisplaySnapshot(snapshots, statuses))
        .filter(Boolean)
        .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
}

function trimSnapshots(records, settings) {
    const unsyncedLimit = Math.max(1, Number(settings.unsyncedMaxSnapshots ?? settings.maxSnapshots) || 3);
    const archivedLimit = Math.max(1, Number(settings.archivedMaxSnapshots) || 1);
    const unsynced = [];
    const archived = [];

    sortSnapshots(records).forEach((record) => {
        if (normalizeStatus(record.draftStatus) === 'archived') {
            if (archived.length < archivedLimit) {
                archived.push(record);
            }
            return;
        }

        if (unsynced.length < unsyncedLimit) {
            unsynced.push(record);
        }
    });

    return [...unsynced, ...archived];
}

function getOwnerDraftLimit(settings) {
    const rawLimit = settings.ownerDraftLimit;
    const parsedLimit = Number(rawLimit);
    if (!Number.isFinite(parsedLimit)) {
        return null;
    }

    return Math.max(1, Math.floor(parsedLimit));
}

function sortOwnerDrafts(left, right) {
    const statusDiff = Number(left.snapshot.draftStatus === 'archived') - Number(right.snapshot.draftStatus === 'archived');
    if (statusDiff !== 0) {
        return statusDiff;
    }

    return Number(right.snapshot.updatedAt) - Number(left.snapshot.updatedAt);
}

function applyOwnerLimit(records, ownerKey, settings) {
    if (!ownerKey) {
        return records;
    }

    const limit = getOwnerDraftLimit(settings);
    if (limit === null) {
        return records;
    }

    const ownerDrafts = Object.entries(records)
        .map(([draftKey, snapshots]) => ({ draftKey, snapshot: getDisplaySnapshot(snapshots) }))
        .filter((entry) => entry.snapshot && getRecordOwnerKey(entry.snapshot) === ownerKey)
        .sort(sortOwnerDrafts);

    if (ownerDrafts.length <= limit) {
        return records;
    }

    const nextRecords = { ...records };
    ownerDrafts.slice(limit).forEach(({ draftKey }) => {
        delete nextRecords[draftKey];
    });
    return nextRecords;
}

function applyAllOwnerLimits(records, settings) {
    const limit = getOwnerDraftLimit(settings);
    if (limit === null) {
        return records;
    }

    const ownerKeys = new Set(
        Object.values(records)
            .map((snapshots) => getDisplaySnapshot(snapshots))
            .filter(Boolean)
            .map((snapshot) => getRecordOwnerKey(snapshot))
            .filter(Boolean),
    );

    let nextRecords = records;
    ownerKeys.forEach((ownerKey) => {
        nextRecords = applyOwnerLimit(nextRecords, ownerKey, settings);
    });
    return nextRecords;
}

export function createDraftStore(localforage, getSettings) {
    const database = localforage.createInstance({
        name: STORAGE_NAME,
        storeName: 'drafts',
    });

    async function readAll() {
        return await database.getItem(STORAGE_KEY) ?? {};
    }

    async function writeAll(value) {
        await database.setItem(STORAGE_KEY, value);
    }

    function settings() {
        return getSettings();
    }

    return {
        async listLatest(options = {}) {
            const records = await readAll();
            return listLatestRecords(records, options.statuses);
        },

        async getLatest(draftKey, options = {}) {
            const records = await readAll();
            const snapshots = records[draftKey] ?? [];
            return getDisplaySnapshot(snapshots, options.statuses);
        },

        async listSnapshots(draftKey, options = {}) {
            const records = await readAll();
            return filterByStatuses(
                sortSnapshots(records[draftKey] ?? []).map((record) => hydrateRecord(record)),
                options.statuses,
            );
        },

        async listLatestByOwner(ownerKey, options = {}) {
            if (!ownerKey) {
                return [];
            }

            const records = await readAll();
            return listLatestRecords(records, options.statuses)
                .filter((record) => getRecordOwnerKey(record) === ownerKey);
        },

        async getLatestForOwner(ownerKey, options = {}) {
            if (!ownerKey) {
                return null;
            }

            const records = await readAll();
            return listLatestRecords(records, options.statuses)
                .find((record) => getRecordOwnerKey(record) === ownerKey) ?? null;
        },

        async save(record) {
            const nextRecord = hydrateRecord({
                ...record,
                draftStatus: DEFAULT_DRAFT_STATUS,
                archivedAt: null,
                lastSyncedHash: null,
            });
            const records = await readAll();
            const snapshots = sortSnapshots(records[nextRecord.draftKey] ?? [])
                .filter((snapshot) => snapshot.chatHash !== nextRecord.chatHash);

            snapshots.unshift(nextRecord);
            records[nextRecord.draftKey] = trimSnapshots(snapshots, settings());
            await writeAll(applyOwnerLimit(records, nextRecord.ownerKey, settings()));
        },

        async archiveSnapshot(draftKey, chatHash, lastSyncedHash = chatHash) {
            const records = await readAll();
            const snapshots = sortSnapshots(records[draftKey] ?? []);
            const nextSnapshots = snapshots.map((snapshot) => {
                if (snapshot.chatHash !== chatHash) {
                    return hydrateRecord(snapshot);
                }

                return hydrateRecord({
                    ...snapshot,
                    draftStatus: 'archived',
                    archivedAt: Date.now(),
                    lastSyncedHash,
                });
            });

            if (nextSnapshots.length === 0) {
                return;
            }

            records[draftKey] = trimSnapshots(nextSnapshots, settings());
            await writeAll(applyOwnerLimit(records, getRecordOwnerKey(nextSnapshots[0]), settings()));
        },

        async discardSnapshot(draftKey, chatHash) {
            const records = await readAll();
            const snapshots = sortSnapshots(records[draftKey] ?? [])
                .filter((snapshot) => snapshot.chatHash !== chatHash);

            if (snapshots.length === 0) {
                delete records[draftKey];
            } else {
                records[draftKey] = snapshots;
            }

            await writeAll(records);
        },

        async discard(draftKey) {
            const records = await readAll();
            delete records[draftKey];
            await writeAll(records);
        },

        async clear() {
            await database.removeItem(STORAGE_KEY);
        },

        async enforceOwnerLimit() {
            const records = await readAll();
            await writeAll(applyAllOwnerLimits(records, settings()));
        },
    };
}
