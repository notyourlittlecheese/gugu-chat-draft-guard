function cloneValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value ?? null));
}

function sanitizeFileLabel(value) {
    return String(value ?? 'Recovered Chat').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Recovered Chat';
}

function formatTimestamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}@${hours}h${minutes}m${seconds}s`;
}

function buildChatHeader(chatMetadata) {
    return {
        chat_metadata: chatMetadata ?? {},
        user_name: 'unused',
        character_name: 'unused',
    };
}

function getRecordLabel(record) {
    const [label] = String(record?.label ?? '').split(' · ');
    return label || record?.ownerLabel || 'Recovered Chat';
}

export function parseDraftKey(draftKey) {
    const groupMatch = String(draftKey ?? '').match(/^group:([^:]+):(.+)$/);
    if (groupMatch) {
        return {
            isGroup: true,
            groupId: groupMatch[1],
            chatId: groupMatch[2],
        };
    }

    const characterMatch = String(draftKey ?? '').match(/^character:(.+)$/);
    if (characterMatch) {
        return {
            isGroup: false,
            groupId: null,
            chatId: characterMatch[1],
        };
    }

    return null;
}

export function getRecordCharacterAvatar(record) {
    if (record?.characterAvatar) {
        return record.characterAvatar;
    }

    const ownerMatch = String(record?.ownerKey ?? '').match(/^character-owner:(.+)$/);
    if (ownerMatch && !ownerMatch[1].startsWith('character-id:')) {
        return ownerMatch[1];
    }

    return Array.isArray(record?.chatData)
        ? record.chatData.find((message) => !message?.is_user && !message?.is_system && typeof message?.original_avatar === 'string')
            ?.original_avatar ?? null
        : null;
}

export function createRecoveredChatId(record) {
    return `${sanitizeFileLabel(getRecordLabel(record))} - recovered - ${formatTimestamp()}`;
}

export async function fetchTargetChat(record, chatId) {
    const context = SillyTavern.getContext();
    const parsed = parseDraftKey(record?.draftKey);

    if (!parsed) {
        throw new Error('草稿目标标识无效，无法恢复。');
    }

    if (parsed.isGroup) {
        const response = await fetch('/api/chats/group/get', {
            method: 'POST',
            cache: 'no-cache',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ id: chatId ?? parsed.chatId }),
        });

        if (!response.ok) {
            throw new Error('读取群聊原文件失败。');
        }

        const data = await response.json();
        const header = Array.isArray(data) && data[0]?.chat_metadata ? data[0] : null;

        return {
            exists: Array.isArray(data) && data.length > 0,
            target: { ...parsed, chatId: chatId ?? parsed.chatId },
            chatData: header ? data.slice(1) : [],
            chatMetadata: header?.chat_metadata ?? {},
        };
    }

    const avatar = getRecordCharacterAvatar(record);
    if (!avatar) {
        throw new Error('无法识别草稿对应角色，不能恢复。');
    }

    const response = await fetch('/api/chats/get', {
        method: 'POST',
        cache: 'no-cache',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            ch_name: record?.ownerLabel ?? getRecordLabel(record),
            file_name: chatId ?? parsed.chatId,
            avatar_url: avatar,
        }),
    });

    if (!response.ok) {
        throw new Error('读取原聊天文件失败。');
    }

    const data = await response.json();
    const header = Array.isArray(data) && data[0]?.chat_metadata ? data[0] : null;

    return {
        exists: Array.isArray(data) && data.length > 0,
        target: { ...parsed, chatId: chatId ?? parsed.chatId, characterAvatar: avatar },
        chatData: header ? data.slice(1) : [],
        chatMetadata: header?.chat_metadata ?? {},
    };
}

export async function saveRecordToTarget(record, target, exactMetadata) {
    const context = SillyTavern.getContext();
    const nextMetadata = cloneValue(record?.chatMetadata ?? {});
    const integrity = exactMetadata?.integrity ?? nextMetadata.integrity ?? crypto.randomUUID();

    nextMetadata.integrity = integrity;
    const chatPayload = [buildChatHeader(nextMetadata), ...cloneValue(record?.chatData ?? [])];

    if (target.isGroup) {
        const response = await fetch('/api/chats/group/save', {
            method: 'POST',
            cache: 'no-cache',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({
                id: target.chatId,
                chat: chatPayload,
            }),
        });

        if (!response.ok) {
            throw new Error('群聊恢复保存失败。');
        }

        return;
    }

    const response = await fetch('/api/chats/save', {
        method: 'POST',
        cache: 'no-cache',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            ch_name: record?.ownerLabel ?? getRecordLabel(record),
            file_name: target.chatId,
            chat: chatPayload,
            avatar_url: target.characterAvatar,
        }),
    });

    if (!response.ok) {
        throw new Error('单聊恢复保存失败。');
    }
}

export async function openTargetChat(target) {
    const context = SillyTavern.getContext();

    if (target.isGroup) {
        const group = context.groups.find((item) => String(item.id) === String(target.groupId));
        if (!group) {
            throw new Error('找不到草稿对应群聊，无法切换到恢复后的聊天。');
        }

        if (!Array.isArray(group.chats)) {
            group.chats = [];
        }

        if (!group.chats.includes(target.chatId)) {
            group.chats.push(target.chatId);
            const response = await fetch('/api/groups/edit', {
                method: 'POST',
                cache: 'no-cache',
                headers: context.getRequestHeaders(),
                body: JSON.stringify(group),
            });

            if (!response.ok) {
                throw new Error('恢复后的群聊已保存，但写入群聊列表失败。');
            }
        }

        await context.openGroupChat(target.groupId, target.chatId);
        return;
    }

    const characterId = context.characters.findIndex((character) => character?.avatar === target.characterAvatar);
    if (characterId < 0) {
        throw new Error('找不到草稿对应角色，无法切换到恢复后的聊天。');
    }

    if (String(context.characterId) !== String(characterId)) {
        await context.selectCharacterById(characterId);
    }

    await context.openCharacterChat(target.chatId);
}
