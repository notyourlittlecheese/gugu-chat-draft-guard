import { AUTO_RETRY_DELAYS_MS } from '../constants.js';
import { getCurrentDraftRecord } from './chat-context.js';
import { areMessagesEquivalent } from './message-signature.js';

function getCommonPrefixLength(localMessages, remoteMessages) {
    const compareLength = Math.min(localMessages.length, remoteMessages.length);
    let index = 0;

    while (index < compareLength && areMessagesEquivalent(localMessages[index], remoteMessages[index])) {
        index += 1;
    }

    return index;
}

export function createEmptyUnsavedState() {
    return {
        draftKey: '',
        hasBaseline: false,
        hasPendingDeletion: false,
        isGenerating: false,
        isSaving: false,
        remoteMessageCount: 0,
        savedPrefixLength: 0,
    };
}

function isReplaceMode(transaction) {
    return transaction?.mode === 'replace';
}

export function createRetryState() {
    return {
        completedAttempts: 0,
        inFlightAttempt: 0,
        scheduledAttempt: 0,
        status: 'idle',
        timer: 0,
        token: 0,
    };
}

export function buildBaselineState({ draftKey, isGenerating, isSaving, localMessages, remoteMessages }) {
    return {
        draftKey,
        hasBaseline: true,
        hasPendingDeletion: remoteMessages.length > localMessages.length,
        isGenerating,
        isSaving,
        remoteMessageCount: remoteMessages.length,
        savedPrefixLength: getCommonPrefixLength(localMessages, remoteMessages),
    };
}

export function patchRuntimeFlags(state, { isGenerating, isSaving }) {
    return {
        ...state,
        isGenerating,
        isSaving,
    };
}

export function getUnsavedStartIndex(state, chatLength, transaction) {
    if (isReplaceMode(transaction)) {
        return Math.min(state.savedPrefixLength, chatLength);
    }

    return Math.min(state.remoteMessageCount, chatLength);
}

export function getUnsavedCount(chatLength, state, transaction) {
    return Math.max(0, chatLength - getUnsavedStartIndex(state, chatLength, transaction));
}

export function hasAbnormalCandidateContent(chatLength, state, transaction) {
    if (isReplaceMode(transaction)) {
        return state.savedPrefixLength < chatLength;
    }

    return getUnsavedCount(chatLength, state, transaction) > 0;
}

export function hasVisibleFailureContent(chatLength, state, retry, transaction, failed) {
    const hasRetryFlow = retry.inFlightAttempt
        || retry.scheduledAttempt
        || retry.completedAttempts > 0
        || retry.status === 'failed-draft'
        || retry.status === 'scheduled'
        || retry.status === 'waiting-generation'
        || retry.status === 'updated-during-retry';

    return hasAbnormalCandidateContent(chatLength, state, transaction) && (failed || hasRetryFlow);
}

export function getRetryAttempt(retry) {
    return retry.inFlightAttempt || retry.scheduledAttempt || retry.completedAttempts;
}

export function cancelRetryTimer(retry) {
    if (!retry.timer) {
        return;
    }

    window.clearTimeout(retry.timer);
    retry.timer = 0;
    retry.token += 1;
    retry.scheduledAttempt = 0;
}

export function resetRetryState(retry) {
    cancelRetryTimer(retry);
    retry.completedAttempts = 0;
    retry.inFlightAttempt = 0;
    retry.status = 'idle';
}

function getPlannedRetryAttempt(retry) {
    const explicitAttempt = getRetryAttempt(retry);
    if (explicitAttempt) {
        return explicitAttempt;
    }

    return Math.min(AUTO_RETRY_DELAYS_MS.length, retry.completedAttempts + 1);
}

function buildProgressModel(retry, transaction) {
    const current = transaction?.status === 'failed'
        ? getPlannedRetryAttempt(retry)
        : Math.max(0, Math.min(AUTO_RETRY_DELAYS_MS.length, getRetryAttempt(retry)));

    return {
        current,
        label: `重试 ${current}/${AUTO_RETRY_DELAYS_MS.length}`,
        total: AUTO_RETRY_DELAYS_MS.length,
    };
}

export function buildGlobalStatusModel(context, state, retry, transaction, failed) {
    const chatLength = context.chat.length;
    if (!state.hasBaseline || !hasVisibleFailureContent(chatLength, state, retry, transaction, failed)) {
        return null;
    }

    const hasCurrentDraft = Boolean(getCurrentDraftRecord());
    const progress = buildProgressModel(retry, transaction);

    if (retry.status === 'failed-draft') {
        return {
            canExport: hasCurrentDraft,
            canRecover: hasCurrentDraft,
            canRetry: true,
            progress,
            title: '请手动重试或导出文件',
            variant: 'failed',
        };
    }

    if (retry.status === 'updated-during-retry') {
        return {
            canExport: hasCurrentDraft,
            canRecover: hasCurrentDraft,
            canRetry: false,
            progress,
            title: '内容已更新',
            variant: 'updated',
        };
    }

    if (retry.status === 'waiting-generation' || (state.isGenerating && failed)) {
        return {
            canExport: hasCurrentDraft,
            canRecover: hasCurrentDraft,
            canRetry: false,
            progress,
            title: '等待当前回复结束后自动重试',
            variant: 'waiting',
        };
    }

    if (retry.status === 'retrying' || retry.status === 'scheduled' || retry.scheduledAttempt || failed) {
        return {
            canExport: hasCurrentDraft,
            canRecover: hasCurrentDraft,
            canRetry: false,
            progress,
            title: `正在自动重试 ${progress.current}/${progress.total}`,
            variant: 'retrying',
        };
    }

    return null;
}
