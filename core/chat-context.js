import { MAX_PREVIEW_CHARS } from '../constants.js';
import { createComparableChatData } from './message-signature.js';
import { buildChatHash } from '../storage/hash.js';

function cloneValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value ?? null));
}

function getLastPreview(chatData) {
    const lastMessage = [...chatData].reverse().find((message) => typeof message?.mes === 'string' && message.mes.trim());

    if (!lastMessage) {
        return '暂无消息';
    }

    const preview = lastMessage.mes.replace(/\s+/g, ' ').trim();
    return preview.length > MAX_PREVIEW_CHARS
        ? `${preview.slice(0, MAX_PREVIEW_CHARS)}...`
        : preview;
}

function buildLabel(context, chatId, groupId) {
    if (groupId) {
        const group = context.groups.find((item) => item.id == groupId);
        return group?.name ? `${group.name} · ${chatId}` : `群聊 · ${chatId}`;
    }

    return context.name2 ? `${context.name2} · ${chatId}` : `聊天 · ${chatId}`;
}

function buildDraftKey(chatId, groupId) {
    return groupId ? `group:${groupId}:${chatId}` : `character:${chatId}`;
}

function buildChatHeader(chatMetadata) {
    return {
        chat_metadata: chatMetadata ?? {},
        user_name: 'unused',
        character_name: 'unused',
    };
}

function buildComparableChatHash(chatData) {
    return buildChatHash({
        chatData: createComparableChatData(chatData),
    });
}

function buildOwnerInfo(context) {
    if (context.groupId) {
        const group = context.groups.find((item) => item.id == context.groupId);

        return {
            ownerKey: `group-owner:${context.groupId}`,
            ownerLabel: group?.name ?? '群聊',
            groupId: context.groupId,
            characterAvatar: null,
        };
    }

    const character = context.characters?.[context.characterId] ?? null;
    const characterAvatar = character?.avatar ?? null;
    const ownerToken = characterAvatar ?? `character-id:${context.characterId ?? 'unknown'}`;

    return {
        ownerKey: `character-owner:${ownerToken}`,
        ownerLabel: context.name2 ?? character?.name ?? '角色',
        groupId: null,
        characterAvatar,
    };
}

export function getCurrentDraftRecord() {
    const context = SillyTavern.getContext();
    const chatId = context.getCurrentChatId();

    if (!chatId) {
        return null;
    }

    const groupId = context.groupId;
    const chatData = cloneValue(context.chat);
    const chatMetadata = cloneValue(context.chatMetadata);
    const ownerInfo = buildOwnerInfo(context);
    const draftKey = buildDraftKey(chatId, groupId);

    return {
        draftKey,
        ...ownerInfo,
        label: buildLabel(context, chatId, groupId),
        isGroup: Boolean(groupId),
        updatedAt: Date.now(),
        messageCount: chatData.length,
        lastPreview: getLastPreview(chatData),
        chatHash: buildComparableChatHash(chatData),
        chatData,
        chatMetadata,
    };
}

export function getCurrentDraftIdentity() {
    const context = SillyTavern.getContext();
    const chatId = context.getCurrentChatId();

    if (!chatId) {
        return null;
    }

    const groupId = context.groupId;
    const ownerInfo = buildOwnerInfo(context);

    return {
        draftKey: buildDraftKey(chatId, groupId),
        ownerKey: ownerInfo.ownerKey,
        ownerLabel: ownerInfo.ownerLabel,
        characterAvatar: ownerInfo.characterAvatar,
        chatId,
        groupId,
    };
}

export function downloadDraftRecord(record) {
    const header = buildChatHeader(record.chatMetadata);
    const jsonl = [header, ...(record.chatData ?? [])]
        .map((line) => JSON.stringify(line))
        .join('\n');
    const safeLabel = record.label.replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([jsonl], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `${safeLabel}-draft.jsonl`;
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
