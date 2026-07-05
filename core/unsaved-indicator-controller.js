import { isChatSaving, isGenerating, saveChatConditional } from '../../../../../script.js';
import {
    ABNORMAL_SAVE_GRACE_MS,
    AUTO_RETRY_DELAYS_MS,
    SAVE_NOISE_SUPPRESS_MS,
    SAVE_STATE_POLL_MS,
    TRACKED_EVENTS,
    VERIFY_CONFIRM_DELAY_MS,
    VERIFY_MAX_ATTEMPTS,
} from '../constants.js';
import { getCurrentDraftIdentity, getCurrentDraftRecord } from './chat-context.js';
import { fetchTargetChat } from './recovery-target.js';
import { createSaveObserver } from './save-observer.js';
import {
    buildBaselineState,
    cancelRetryTimer,
    createEmptyUnsavedState,
    createRetryState,
    getUnsavedStartIndex,
    hasAbnormalCandidateContent,
    hasVisibleFailureContent,
    patchRuntimeFlags,
    resetRetryState,
} from './unsaved-state.js';
import { createGlobalUnsavedStatus } from '../ui/global-unsaved-status.js';
import { applyUnsavedMarkers, clearUnsavedMarkers } from '../ui/unsaved-indicator.js';

const DEFAULT_MODE = 'append';
const IDLE_GENERATING_MODE = 'replace';
const MESSAGE_RECEIVE_REPLACE_TYPES = new Set(['continue', 'regenerate', 'swipe']);
const START_EVENT_MODES = Object.freeze({
    MESSAGE_EDITED: 'replace',
    MESSAGE_RECEIVED: DEFAULT_MODE,
    MESSAGE_SENT: DEFAULT_MODE,
    MESSAGE_SWIPED: 'replace',
});

function bindContextEvent(context, listeners, eventName, handler) {
    const listener = (...args) => handler(...args);
    context.eventSource.on(context.eventTypes[eventName], listener);
    listeners.push(() => context.eventSource.removeListener(context.eventTypes[eventName], listener));
}

function createTransactionState() {
    return {
        awaitUntil: 0,
        dirtyIndex: null,
        mode: DEFAULT_MODE,
        revision: 0,
        settledChatLength: 0,
        status: 'idle',
        suppressUntil: 0,
        verifyAttempts: 0,
        verifyTimer: 0,
    };
}

function cancelVerifyTimer(transaction) {
    if (!transaction.verifyTimer) {
        return;
    }

    window.clearTimeout(transaction.verifyTimer);
    transaction.verifyTimer = 0;
}

function resetTransaction(transaction, { keepSuppress = false } = {}) {
    const suppressUntil = keepSuppress ? transaction.suppressUntil : 0;
    const settledChatLength = keepSuppress ? transaction.settledChatLength : 0;

    cancelVerifyTimer(transaction);
    transaction.awaitUntil = 0;
    transaction.dirtyIndex = null;
    transaction.mode = DEFAULT_MODE;
    transaction.revision += 1;
    transaction.settledChatLength = settledChatLength;
    transaction.status = 'idle';
    transaction.suppressUntil = suppressUntil;
    transaction.verifyAttempts = 0;
}

function settleTransaction(transaction, chatLength) {
    resetTransaction(transaction);
    transaction.settledChatLength = chatLength;
    transaction.suppressUntil = Date.now() + SAVE_NOISE_SUPPRESS_MS;
}

function startTransaction(transaction, generating, mode = DEFAULT_MODE, dirtyIndex = null) {
    cancelVerifyTimer(transaction);
    transaction.awaitUntil = Date.now() + ABNORMAL_SAVE_GRACE_MS;
    transaction.dirtyIndex = dirtyIndex;
    transaction.mode = mode;
    transaction.revision += 1;
    transaction.status = generating ? 'generating' : 'awaiting-save';
    transaction.verifyAttempts = 0;
}

function resolveStartMode(eventName, sourceType) {
    if (eventName !== 'MESSAGE_RECEIVED') {
        return START_EVENT_MODES[eventName] ?? null;
    }

    return MESSAGE_RECEIVE_REPLACE_TYPES.has(String(sourceType ?? ''))
        ? 'replace'
        : DEFAULT_MODE;
}

function isSuppressedNoise(transaction, eventName, chatLength) {
    return eventName === 'MESSAGE_UPDATED'
        && Date.now() < transaction.suppressUntil
        && chatLength <= transaction.settledChatLength;
}

function renderState(runtime) {
    const identity = getCurrentDraftIdentity();
    const visible = identity && runtime.state.hasBaseline && identity.draftKey === runtime.state.draftKey;
    if (!visible) {
        clearUnsavedMarkers();
        runtime.statusCard.hide();
        return;
    }

    const failed = runtime.transaction.status === 'failed';
    if (hasVisibleFailureContent(runtime.context.chat.length, runtime.state, runtime.retry, runtime.transaction, failed)) {
        applyUnsavedMarkers({
            chatLength: runtime.context.chat.length,
            hasPendingDeletion: runtime.state.hasPendingDeletion,
            messageIds: runtime.state.unsavedMessageIndices,
            savedPrefixLength: getUnsavedStartIndex(runtime.state, runtime.context.chat.length, runtime.transaction),
        });
        runtime.statusCard.hide();
        return;
    }

    clearUnsavedMarkers();
    runtime.statusCard.hide();
}

function createRenderScheduler(runtime) {
    let frameId = 0;

    return {
        schedule() {
            if (frameId) {
                return;
            }

            frameId = window.requestAnimationFrame(() => {
                frameId = 0;
                renderState(runtime);
            });
        },
        cancel() {
            if (!frameId) {
                return;
            }

            window.cancelAnimationFrame(frameId);
            frameId = 0;
        },
    };
}

async function refreshBaseline(runtime) {
    runtime.refreshInFlight = true;
    const record = getCurrentDraftRecord();
    if (!record) {
        runtime.state = createEmptyUnsavedState();
        runtime.refreshInFlight = false;
        runtime.scheduler.schedule();
        return false;
    }

    const token = ++runtime.refreshToken;

    try {
        const target = await fetchTargetChat(record);
        const active = getCurrentDraftIdentity();
        if (!active || active.draftKey !== record.draftKey || token !== runtime.refreshToken) {
            runtime.refreshInFlight = false;
            return false;
        }

        runtime.state = buildBaselineState({
            draftKey: record.draftKey,
            isGenerating: Boolean(isGenerating()),
            isSaving: Boolean(isChatSaving),
            localMessages: record.chatData,
            remoteMessages: target.exists ? target.chatData : [],
        });
    } catch (error) {
        console.warn('Failed to refresh unsaved message baseline.', error);
    }

    runtime.refreshInFlight = false;
    runtime.scheduler.schedule();
    return true;
}

function scheduleVerification(runtime, delay = 0) {
    const revision = runtime.transaction.revision;

    cancelVerifyTimer(runtime.transaction);
    runtime.transaction.status = 'verifying';
    runtime.transaction.verifyTimer = window.setTimeout(() => {
        runtime.transaction.verifyTimer = 0;
        void runVerification(runtime, revision);
    }, delay);
}

async function runVerification(runtime, revision) {
    if (revision !== runtime.transaction.revision) {
        return;
    }

    runtime.transaction.verifyAttempts += 1;
    await refreshBaseline(runtime);
    if (revision !== runtime.transaction.revision) {
        return;
    }

    const hasCandidate = runtime.state.hasBaseline
        && hasAbnormalCandidateContent(runtime.context.chat.length, runtime.state, runtime.transaction);

    if (!hasCandidate) {
        settleTransaction(runtime.transaction, runtime.context.chat.length);
        resetRetryState(runtime.retry);
        runtime.scheduler.schedule();
        return;
    }

    if (runtime.transaction.verifyAttempts < VERIFY_MAX_ATTEMPTS) {
        scheduleVerification(runtime, VERIFY_CONFIRM_DELAY_MS);
        return;
    }

    runtime.transaction.status = 'failed';
    evaluateRetry(runtime);
}

function scheduleRetry(runtime, attempt) {
    cancelRetryTimer(runtime.retry);
    runtime.retry.status = 'scheduled';
    runtime.retry.scheduledAttempt = attempt;
    const token = ++runtime.retry.token;
    const delay = AUTO_RETRY_DELAYS_MS[attempt - 1] ?? AUTO_RETRY_DELAYS_MS.at(-1);

    runtime.retry.timer = window.setTimeout(() => {
        if (token !== runtime.retry.token) {
            return;
        }

        runtime.retry.timer = 0;
        runtime.retry.scheduledAttempt = 0;
        void performRetry(runtime, attempt);
    }, delay);
}

function evaluateRetry(runtime) {
    const hasCandidate = runtime.state.hasBaseline
        && hasAbnormalCandidateContent(runtime.context.chat.length, runtime.state, runtime.transaction);

    if (!hasCandidate || runtime.transaction.status !== 'failed') {
        resetRetryState(runtime.retry);
        runtime.scheduler.schedule();
        return;
    }

    if (runtime.state.isGenerating || runtime.state.isSaving) {
        runtime.retry.status = 'waiting-generation';
        runtime.scheduler.schedule();
        return;
    }

    if (runtime.retry.inFlightAttempt || runtime.retry.timer || runtime.retry.status === 'failed-draft') {
        runtime.scheduler.schedule();
        return;
    }

    const nextAttempt = runtime.retry.completedAttempts + 1;
    if (nextAttempt > AUTO_RETRY_DELAYS_MS.length) {
        runtime.retry.status = 'failed-draft';
        runtime.scheduler.schedule();
        return;
    }

    scheduleRetry(runtime, nextAttempt);
    runtime.scheduler.schedule();
}

function handleSaveSettled(runtime, result) {
    const active = getCurrentDraftIdentity();
    if (!active || active.draftKey !== result.identity?.draftKey) {
        return;
    }

    cancelRetryTimer(runtime.retry);
    runtime.transaction.revision += 1;

    if (!result.ok) {
        runtime.retry.status = runtime.state.isGenerating || runtime.state.isSaving
            ? 'waiting-generation'
            : 'scheduled';
        runtime.transaction.verifyAttempts = 0;
        scheduleVerification(runtime);
        runtime.scheduler.schedule();
        return;
    }

    scheduleVerification(runtime);
}

function normalizeDirtyIndex(value) {
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 ? index : null;
}

function handleDirtyMutation(runtime, eventName, dirtyIndex, sourceType) {
    const identity = getCurrentDraftIdentity();
    if (!identity) {
        runtime.state = createEmptyUnsavedState();
        resetRetryState(runtime.retry);
        resetTransaction(runtime.transaction);
        runtime.scheduler.schedule();
        return;
    }

    if (!runtime.state.hasBaseline || runtime.state.draftKey !== identity.draftKey) {
        void refreshBaseline(runtime);
        return;
    }

    runtime.state = patchRuntimeFlags(runtime.state, {
        isGenerating: Boolean(isGenerating()),
        isSaving: Boolean(isChatSaving),
    });

    const chatLength = runtime.context.chat.length;
    if (isSuppressedNoise(runtime.transaction, eventName, chatLength)) {
        runtime.scheduler.schedule();
        return;
    }

    if (eventName === 'MESSAGE_DELETED') {
        runtime.scheduler.schedule();
        return;
    }

    const startMode = resolveStartMode(eventName, sourceType);
    if (startMode && runtime.transaction.status === 'idle') {
        startTransaction(runtime.transaction, runtime.state.isGenerating, startMode, dirtyIndex);
        resetRetryState(runtime.retry);
    } else if ((eventName === 'MESSAGE_UPDATED' || startMode) && runtime.transaction.status !== 'idle') {
        runtime.transaction.awaitUntil = Date.now() + ABNORMAL_SAVE_GRACE_MS;
    }

    if (
        dirtyIndex !== null
        && (runtime.transaction.dirtyIndex === null || dirtyIndex < runtime.transaction.dirtyIndex)
    ) {
        runtime.transaction.dirtyIndex = dirtyIndex;
    }

    runtime.scheduler.schedule();
}

function handleRuntimeTick(runtime) {
    const wasGenerating = runtime.lastGenerating;
    runtime.state = patchRuntimeFlags(runtime.state, {
        isGenerating: Boolean(isGenerating()),
        isSaving: Boolean(isChatSaving),
    });
    runtime.lastGenerating = runtime.state.isGenerating;

    if (!wasGenerating && runtime.state.isGenerating && runtime.transaction.status === 'idle') {
        startTransaction(
            runtime.transaction,
            true,
            IDLE_GENERATING_MODE,
            Math.max(0, runtime.context.chat.length - 1),
        );
        resetRetryState(runtime.retry);
    }

    if (runtime.transaction.status === 'generating' && !runtime.state.isGenerating) {
        runtime.transaction.status = 'awaiting-save';
        runtime.transaction.awaitUntil = Date.now() + ABNORMAL_SAVE_GRACE_MS;
    }

    if (
        runtime.transaction.status === 'awaiting-save'
        && Date.now() >= runtime.transaction.awaitUntil
        && !runtime.transaction.verifyTimer
        && !runtime.refreshInFlight
    ) {
        scheduleVerification(runtime);
        return;
    }

    if (runtime.transaction.status === 'failed') {
        evaluateRetry(runtime);
        return;
    }

    runtime.scheduler.schedule();
}

async function performRetry(runtime, attempt) {
    if (runtime.state.isGenerating || runtime.state.isSaving || runtime.retry.inFlightAttempt) {
        runtime.scheduler.schedule();
        return;
    }

    runtime.retry.status = 'retrying';
    runtime.retry.inFlightAttempt = attempt;
    runtime.transaction.status = 'awaiting-save';
    runtime.transaction.awaitUntil = Date.now() + ABNORMAL_SAVE_GRACE_MS;
    runtime.transaction.revision += 1;
    runtime.scheduler.schedule();

    try {
        await saveChatConditional();
    } catch (error) {
        console.warn('Automatic chat save retry failed to execute.', error);
    } finally {
        runtime.retry.completedAttempts = Math.max(runtime.retry.completedAttempts, attempt);
        runtime.retry.inFlightAttempt = 0;
        runtime.state = patchRuntimeFlags(runtime.state, {
            isGenerating: Boolean(isGenerating()),
            isSaving: Boolean(isChatSaving),
        });
        if (!runtime.transaction.verifyTimer && runtime.transaction.status !== 'verifying') {
            scheduleVerification(runtime, VERIFY_CONFIRM_DELAY_MS);
        }
    }
}

function registerEvents(runtime) {
    TRACKED_EVENTS.forEach((eventName) => bindContextEvent(runtime.context, runtime.listeners, eventName, (...args) => {
        handleDirtyMutation(runtime, eventName, normalizeDirtyIndex(args[0]), args[1]);
    }));

    bindContextEvent(runtime.context, runtime.listeners, 'CHAT_CHANGED', () => {
        runtime.state = createEmptyUnsavedState();
        resetRetryState(runtime.retry);
        resetTransaction(runtime.transaction);
        runtime.scheduler.schedule();
        void refreshBaseline(runtime);
    });
    bindContextEvent(runtime.context, runtime.listeners, 'USER_MESSAGE_RENDERED', () => runtime.scheduler.schedule());
    bindContextEvent(runtime.context, runtime.listeners, 'CHARACTER_MESSAGE_RENDERED', () => runtime.scheduler.schedule());
}

function disposeListeners(listeners) {
    listeners.splice(0).forEach((dispose) => dispose());
}

export function createUnsavedIndicatorController({ onExportDraft, onRecoverDraft }) {
    const runtime = {
        context: SillyTavern.getContext(),
        listeners: [],
        observer: null,
        refreshInFlight: false,
        refreshToken: 0,
        retry: createRetryState(),
        savePollTimer: 0,
        scheduler: null,
        state: createEmptyUnsavedState(),
        statusCard: createGlobalUnsavedStatus({
            onExport: () => onExportDraft(),
            onRecover: () => onRecoverDraft(),
            onRetry: () => {
                resetRetryState(runtime.retry);
                void performRetry(runtime, 1);
            },
        }),
        lastGenerating: false,
        transaction: createTransactionState(),
    };

    runtime.scheduler = createRenderScheduler(runtime);
    runtime.observer = createSaveObserver({
        getIdentity: () => getCurrentDraftIdentity(),
        onSaveSettled: (result) => handleSaveSettled(runtime, result),
    });

    return {
        async init() {
            runtime.observer.install();
            registerEvents(runtime);
            runtime.savePollTimer = window.setInterval(() => handleRuntimeTick(runtime), SAVE_STATE_POLL_MS);
            await refreshBaseline(runtime);
            runtime.lastGenerating = runtime.state.isGenerating;
        },
        async destroy() {
            disposeListeners(runtime.listeners);
            runtime.scheduler.cancel();
            runtime.observer.destroy();
            resetTransaction(runtime.transaction);
            cancelRetryTimer(runtime.retry);
            if (runtime.savePollTimer) {
                window.clearInterval(runtime.savePollTimer);
            }
            runtime.statusCard.destroy();
            clearUnsavedMarkers();
        },
    };
}
