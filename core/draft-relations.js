import {
    areMessagesEquivalent,
    isComparablePrefix,
    isSameComparableChatData,
} from './message-signature.js';

export function getFloor(messageCount) {
    return Math.max(0, Number(messageCount ?? 0) - 1);
}

export function areMessagesEqual(left, right) {
    return areMessagesEquivalent(left, right);
}

export function isSameChatData(left, right) {
    return isSameComparableChatData(left, right);
}

export function isPrefixMatch(shorter, longer) {
    return isComparablePrefix(shorter, longer);
}

export function getRecordOwnerLabel(record) {
    if (record?.ownerLabel) {
        return record.ownerLabel;
    }

    const [label] = String(record?.label ?? '').split(' · ');
    return label || null;
}

export function canRecoverToCurrentChat(identity, record) {
    if (!identity || !record) {
        return false;
    }

    if (identity.draftKey === record.draftKey) {
        return true;
    }

    if (identity.ownerKey && identity.ownerKey === record.ownerKey) {
        return true;
    }

    if (identity.groupId || record.isGroup) {
        return false;
    }

    return Boolean(identity.ownerLabel) && identity.ownerLabel === getRecordOwnerLabel(record);
}

export function resolveDraftRelation(currentIdentity, currentRecord, record) {
    if (!record) {
        return 'other-owner';
    }

    if (!currentIdentity || !currentRecord) {
        return 'other-owner';
    }

    if (record.ownerKey !== currentIdentity.ownerKey) {
        return 'other-owner';
    }

    if (record.draftKey !== currentIdentity.draftKey) {
        return 'other-chat';
    }

    if (isSameChatData(record.chatData, currentRecord.chatData)) {
        return 'exact';
    }

    if (isPrefixMatch(currentRecord.chatData, record.chatData)) {
        return 'ahead';
    }

    if (isPrefixMatch(record.chatData, currentRecord.chatData)) {
        return 'behind';
    }

    return 'diverged';
}

export function getRelationLabel(relation) {
    if (relation === 'exact') {
        return '一致';
    }

    if (relation === 'ahead') {
        return '高于当前';
    }

    if (relation === 'behind') {
        return '低于当前';
    }

    if (relation === 'diverged') {
        return '已分叉';
    }

    if (relation === 'other-chat') {
        return '其他聊天';
    }

    return '其他角色';
}

export function getRelationOrder(relation) {
    if (relation === 'ahead') {
        return 0;
    }

    if (relation === 'diverged') {
        return 1;
    }

    if (relation === 'behind') {
        return 2;
    }

    if (relation === 'exact') {
        return 3;
    }

    if (relation === 'other-chat') {
        return 4;
    }

    return 5;
}

export function getStatusLabel(status) {
    return status === 'archived' ? '' : '未归档';
}
