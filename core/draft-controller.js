import { DEFAULT_SETTINGS, SNAPSHOT_DEBOUNCE_MS, TRACKED_EVENTS, UI_TITLE } from '../constants.js';
import { downloadDraftRecord, getCurrentDraftIdentity, getCurrentDraftRecord } from './chat-context.js';
import {
    canRecoverToCurrentChat,
    getFloor,
    getRelationLabel,
    getStatusLabel,
    isPrefixMatch,
    isSameChatData,
    resolveDraftRelation,
} from './draft-relations.js';
import { createRecoveredChatId, fetchTargetChat, getRecordCharacterAvatar, openTargetChat, saveRecordToTarget } from './recovery-target.js';
import { showDraftPreviewPopup } from '../ui/preview-popup.js';

const UNSYNCED_STATUSES = Object.freeze(['unsynced']);
const IMMEDIATE_SNAPSHOT_EVENTS = Object.freeze([
    'USER_MESSAGE_RENDERED',
    'CHARACTER_MESSAGE_RENDERED',
]);
const SNAPSHOT_EVENTS = Object.freeze([
    ...TRACKED_EVENTS,
    ...IMMEDIATE_SNAPSHOT_EVENTS,
]);

function sortByNewest(records) {
    return [...records].sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
}

function sortByCompleteness(records) {
    return [...records].sort((left, right) => {
        const messageDiff = Number(right.messageCount ?? 0) - Number(left.messageCount ?? 0);
        if (messageDiff !== 0) {
            return messageDiff;
        }

        return Number(right.updatedAt) - Number(left.updatedAt);
    });
}

export function createDraftController({ getSettings, panel, store }) {
    const context = SillyTavern.getContext();
    const listeners = [];
    let pendingRecord = null;
    let saveTimer = null;
    let lastPromptToken = '';

    function settings() {
        return { ...DEFAULT_SETTINGS, ...getSettings() };
    }

    function bindContextEvent(eventName, handler) {
        context.eventSource.on(context.eventTypes[eventName], handler);
        listeners.push(() => context.eventSource.removeListener(context.eventTypes[eventName], handler));
    }

    function bindWindowEvent(eventName, handler) {
        window.addEventListener(eventName, handler);
        listeners.push(() => window.removeEventListener(eventName, handler));
    }

    function decoratePanelRecord(record, currentIdentity, currentRecord) {
        const relation = resolveDraftRelation(currentIdentity, currentRecord, record);

        return {
            ...record,
            floor: getFloor(record?.messageCount),
            relation,
            relationLabel: getRelationLabel(relation),
            statusLabel: getStatusLabel(record.draftStatus),
            isCurrentOwner: Boolean(currentIdentity?.ownerKey) && currentIdentity.ownerKey === record.ownerKey,
            isLowerThanCurrent: relation === 'behind',
        };
    }

    async function refreshDrafts() {
        const drafts = await store.listLatest();
        const currentIdentity = getCurrentDraftIdentity();
        const currentRecord = getCurrentDraftRecord();
        panel.renderDrafts({
            currentOwnerKey: currentIdentity?.ownerKey ?? null,
            hasCurrentChat: Boolean(currentIdentity && currentRecord),
            records: drafts.map((record) => decoratePanelRecord(record, currentIdentity, currentRecord)),
        });
    }

    async function findOwnerFallback(identity) {
        if (!identity?.ownerKey) {
            return null;
        }

        const latest = await store.getLatestForOwner(identity.ownerKey, { statuses: UNSYNCED_STATUSES });
        if (latest) {
            return latest;
        }

        const drafts = await store.listLatest({ statuses: UNSYNCED_STATUSES });
        return drafts.find((record) => canRecoverToCurrentChat(identity, record)) ?? null;
    }

    async function getRecoveryVersions(record) {
        const versions = await store.listSnapshots(record.draftKey);
        return versions.length > 0 ? versions : [record];
    }

    async function analyzeRecovery(record) {
        const versions = await getRecoveryVersions(record);
        const exact = await fetchTargetChat(record);
        const newestVersions = sortByNewest(versions);
        const exactMatch = exact.exists
            ? newestVersions.find((item) => isSameChatData(item.chatData, exact.chatData)) ?? null
            : null;
        const extendingVersions = exact.exists
            ? sortByNewest(versions.filter((item) =>
                Number(item.messageCount ?? 0) > Number(exact.chatData.length)
                && isPrefixMatch(exact.chatData, item.chatData),
            ))
            : [];

        if (!exact.exists) {
            const best = sortByCompleteness(versions)[0] ?? record;
            return {
                mode: 'create',
                record: best,
                target: {
                    ...exact.target,
                    chatId: createRecoveredChatId(best),
                    characterAvatar: exact.target.characterAvatar ?? getRecordCharacterAvatar(record),
                },
                exact,
            };
        }

        const extending = extendingVersions[0] ?? null;
        if (extending && (!exactMatch || Number(extending.updatedAt) > Number(exactMatch.updatedAt))) {
            return {
                mode: 'overwrite',
                record: extending,
                target: exact.target,
                exact,
            };
        }

        if (exactMatch) {
            return {
                mode: 'synced',
                record: exactMatch,
                target: exact.target,
                exact,
            };
        }

        const latest = newestVersions[0] ?? record;
        return {
            mode: 'create',
            record: latest,
            target: {
                ...exact.target,
                chatId: createRecoveredChatId(latest),
                characterAvatar: exact.target.characterAvatar ?? getRecordCharacterAvatar(latest),
            },
            exact,
        };
    }

    async function archiveSnapshot(record) {
        if (!record) {
            return;
        }

        await store.archiveSnapshot(record.draftKey, record.chatHash, record.chatHash);
    }

    function getLatestPendingRecord() {
        if (!pendingRecord) {
            return null;
        }

        const current = getCurrentDraftRecord();
        if (current && current.draftKey === pendingRecord.draftKey) {
            return current;
        }

        return pendingRecord;
    }

    async function flushPending() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }

        if (!pendingRecord) {
            return;
        }

        const record = getLatestPendingRecord();
        pendingRecord = null;
        if (!record) {
            return;
        }

        await store.save(record);
        await refreshDrafts();
    }

    function scheduleSnapshot() {
        if (!settings().enabled) {
            return;
        }

        const record = getCurrentDraftRecord();
        if (!record || record.messageCount === 0) {
            return;
        }

        pendingRecord = record;
        if (saveTimer) {
            clearTimeout(saveTimer);
        }

        saveTimer = window.setTimeout(() => {
            void flushPending();
        }, SNAPSHOT_DEBOUNCE_MS);
    }

    function snapshotNow() {
        if (!settings().enabled) {
            return;
        }

        const record = getCurrentDraftRecord();
        if (!record || record.messageCount === 0) {
            return;
        }

        pendingRecord = record;
        void flushPending();
    }

    async function archiveCurrentIfSynced() {
        const currentIdentity = getCurrentDraftIdentity();
        const current = getCurrentDraftRecord();
        if (!currentIdentity || !current) {
            return false;
        }

        const exact = await store.getLatest(currentIdentity.draftKey, { statuses: UNSYNCED_STATUSES });
        if (!exact || !isSameChatData(exact.chatData, current.chatData)) {
            return false;
        }

        await archiveSnapshot(exact);
        return true;
    }

    async function syncCurrentChatSnapshot() {
        const currentIdentity = getCurrentDraftIdentity();
        const current = getCurrentDraftRecord();
        if (!currentIdentity || !current || current.messageCount === 0) {
            return false;
        }

        const snapshots = await store.listSnapshots(currentIdentity.draftKey);
        const exact = snapshots.find((snapshot) => snapshot.chatHash === current.chatHash) ?? null;
        if (exact) {
            if (exact.draftStatus !== 'archived') {
                await store.archiveSnapshot(currentIdentity.draftKey, current.chatHash, current.chatHash);
            }
            return false;
        }

        await store.save(current);
        await store.archiveSnapshot(current.draftKey, current.chatHash, current.chatHash);
        return true;
    }

    async function recoverDraft(record) {
        await flushPending();

        try {
            const plan = await analyzeRecovery(record);

            if (plan.mode === 'synced') {
                await archiveSnapshot(plan.record);
                toastr.info('原聊天已经包含这份草稿，已转为本地备份。', UI_TITLE);
                await refreshDrafts();
                return true;
            }

            await saveRecordToTarget(plan.record, plan.target, plan.exact.chatMetadata);
            await openTargetChat(plan.target);
            await archiveSnapshot(plan.record);

            const successMessage = plan.mode === 'overwrite'
                ? '本地草稿已恢复到原聊天，并保留为本地备份。'
                : '本地草稿已恢复到新聊天，并保留为本地备份。';

            toastr.success(successMessage, UI_TITLE);
            await refreshDrafts();
            return true;
        } catch (error) {
            console.error(error);
            toastr.error(error instanceof Error ? error.message : '恢复失败，请查看控制台日志。', UI_TITLE);
            return false;
        }
    }

    async function exportDraft(record) {
        downloadDraftRecord(record);
        toastr.info('草稿已导出为 jsonl 文件。', UI_TITLE);
    }

    async function exportCurrentDraft() {
        await flushPending();

        const current = getCurrentDraftRecord();
        if (current) {
            await exportDraft(current);
            return;
        }

        const identity = getCurrentDraftIdentity();
        if (!identity) {
            toastr.info('当前聊天没有可导出的草稿。', UI_TITLE);
            return;
        }

        const latest = await store.getLatest(identity.draftKey);
        if (!latest) {
            toastr.info('当前聊天没有可导出的草稿。', UI_TITLE);
            return;
        }

        await exportDraft(latest);
    }

    async function previewDraft(record) {
        await showDraftPreviewPopup({
            record,
            onRecover: recoverDraft,
            onExport: exportDraft,
            onDiscard: discardDraft,
        });
    }

    async function discardDraft(record) {
        await store.discard(record.draftKey);
        toastr.success('本地草稿已丢弃。', UI_TITLE);
        await refreshDrafts();
        return true;
    }

    async function showRecoveryPrompt(record) {
        const popupContent = `
            <div class="gcdg-popup">
                <div class="gcdg-popup-title">检测到未同步的本地草稿</div>
                <div class="gcdg-popup-meta">${record.label}</div>
                <div class="gcdg-popup-preview">${record.lastPreview}</div>
            </div>
        `;
        const popup = new context.Popup(popupContent, context.POPUP_TYPE.TEXT, '', {
            okButton: '恢复草稿',
            cancelButton: '稍后处理',
            wide: true,
            customButtons: [
                { text: '导出草稿', result: context.POPUP_RESULT.CUSTOM1 },
                { text: '丢弃草稿', result: context.POPUP_RESULT.CUSTOM2 },
            ],
            defaultResult: context.POPUP_RESULT.AFFIRMATIVE,
        });
        const result = await popup.show();

        if (result === context.POPUP_RESULT.AFFIRMATIVE) {
            await recoverDraft(record);
            return;
        }

        if (result === context.POPUP_RESULT.CUSTOM1) {
            await exportDraft(record);
            return;
        }

        if (result === context.POPUP_RESULT.CUSTOM2) {
            await discardDraft(record);
        }
    }

    async function promptCurrentDraft({ force = false } = {}) {
        const currentIdentity = getCurrentDraftIdentity();
        const current = getCurrentDraftRecord();

        if (!currentIdentity || !current) {
            if (force) {
                toastr.info('当前聊天没有可恢复的本地草稿。', UI_TITLE);
            }
            return;
        }

        const exact = await store.getLatest(currentIdentity.draftKey, { statuses: UNSYNCED_STATUSES });
        if (exact) {
            if (isSameChatData(exact.chatData, current.chatData)) {
                await archiveSnapshot(exact);
                await refreshDrafts();
                if (force) {
                    toastr.info('当前聊天已同步，本地草稿已转为备份。', UI_TITLE);
                }
                return;
            }

            const promptToken = `${exact.draftKey}:${exact.chatHash}`;
            if (!force && promptToken === lastPromptToken) {
                return;
            }

            lastPromptToken = promptToken;
            await showRecoveryPrompt(exact);
            return;
        }

        const latest = await findOwnerFallback(currentIdentity);
        if (!latest) {
            if (force) {
                toastr.info('当前聊天没有可恢复的本地草稿。', UI_TITLE);
            }
            return;
        }

        const plan = await analyzeRecovery(latest);
        if (plan.mode === 'synced') {
            await archiveSnapshot(plan.record);
            await refreshDrafts();
            if (force) {
                toastr.info('原聊天已经包含这份草稿，已转为本地备份。', UI_TITLE);
            }
            return;
        }

        const promptToken = `${plan.record.draftKey}:${plan.record.chatHash}:${plan.mode}`;
        if (!force && promptToken === lastPromptToken) {
            return;
        }

        lastPromptToken = promptToken;
        await showRecoveryPrompt(plan.record);
    }

    async function handleChatChanged() {
        await flushPending();
        lastPromptToken = '';
        await archiveCurrentIfSynced();
        await syncCurrentChatSnapshot();
        await refreshDrafts();
    }

    async function clearAllDrafts() {
        await store.clear();
        toastr.success('本地草稿已清空。', UI_TITLE);
        await refreshDrafts();
    }

    function flushBeforeExit() {
        if (!pendingRecord) {
            return;
        }

        const record = getLatestPendingRecord();
        pendingRecord = null;
        if (!record) {
            return;
        }

        void store.save(record).then(() => refreshDrafts());
    }

    return {
        async init() {
            SNAPSHOT_EVENTS.forEach((eventName) => {
                const handler = IMMEDIATE_SNAPSHOT_EVENTS.includes(eventName)
                    ? snapshotNow
                    : scheduleSnapshot;
                bindContextEvent(eventName, handler);
            });
            bindContextEvent('CHAT_CHANGED', () => {
                void handleChatChanged();
            });
            bindWindowEvent('pagehide', flushBeforeExit);
            bindWindowEvent('beforeunload', flushBeforeExit);
            bindWindowEvent('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    flushBeforeExit();
                }
            });

            panel.setActions({
                clearAllDrafts: () => {
                    void clearAllDrafts();
                },
                previewDraft: (draftKey) => {
                    void store.getLatest(draftKey).then((record) => record && previewDraft(record));
                },
                recoverDraft: (draftKey) => {
                    void store.getLatest(draftKey).then((record) => record && recoverDraft(record));
                },
                exportDraft: (draftKey) => {
                    void store.getLatest(draftKey).then((record) => record && exportDraft(record));
                },
                discardDraft: (draftKey) => {
                    void store.getLatest(draftKey).then((record) => record && discardDraft(record));
                },
            });

            await refreshDrafts();
            if (getCurrentDraftIdentity()) {
                await handleChatChanged();
            }
        },

        async promptCurrentDraft(options = { force: true }) {
            await promptCurrentDraft(options);
        },

        async exportCurrentDraft() {
            await exportCurrentDraft();
        },

        async enforceOwnerDraftLimit() {
            await store.enforceOwnerLimit();
            await refreshDrafts();
        },

        async destroy() {
            await flushPending();
            listeners.forEach((dispose) => dispose());
        },
    };
}
