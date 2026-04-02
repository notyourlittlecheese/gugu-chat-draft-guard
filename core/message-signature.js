const ROOT_MESSAGE_KEYS = Object.freeze([
    'name',
    'force_avatar',
    'original_avatar',
]);

const EXTRA_MESSAGE_KEYS = Object.freeze([
    'type',
    'append_title',
    'image',
    'images',
    'inline_image',
    'attachments',
    'files',
    'tool_invocations',
    'uses_system_ui',
    'isSmallSys',
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeValue(item));
    }

    if (!isPlainObject(value)) {
        return value;
    }

    return Object.keys(value)
        .sort()
        .reduce((result, key) => {
            const normalized = normalizeValue(value[key]);
            if (normalized !== undefined) {
                result[key] = normalized;
            }
            return result;
        }, {});
}

function includeValue(target, key, value) {
    if (value === undefined || value === null || value === '') {
        return;
    }

    target[key] = normalizeValue(value);
}

function createComparableExtra(extra) {
    if (!isPlainObject(extra)) {
        return null;
    }

    const comparable = {};
    EXTRA_MESSAGE_KEYS.forEach((key) => includeValue(comparable, key, extra[key]));

    return Object.keys(comparable).length > 0 ? comparable : null;
}

function getComparableText(message) {
    return message?.extra?.display_text || message?.mes || '';
}

function getComparableReasoning(message) {
    return message?.extra?.reasoning_display_text ?? message?.extra?.reasoning ?? '';
}

function getComparableTitle(message) {
    return message?.title || message?.extra?.title || '';
}

export function createComparableMessage(message) {
    if (!isPlainObject(message)) {
        return null;
    }

    const comparable = {};
    ROOT_MESSAGE_KEYS.forEach((key) => includeValue(comparable, key, message[key]));
    includeValue(comparable, 'text', getComparableText(message));
    includeValue(comparable, 'reasoning', getComparableReasoning(message));
    includeValue(comparable, 'bias', message?.extra?.bias);
    includeValue(comparable, 'title', getComparableTitle(message));

    if (message.is_user === true) {
        comparable.is_user = true;
    }

    if (message.is_system === true) {
        comparable.is_system = true;
    }

    const extra = createComparableExtra(message.extra);
    if (extra) {
        comparable.extra = extra;
    }

    return comparable;
}

export function stableStringify(value) {
    return JSON.stringify(normalizeValue(value));
}

export function areMessagesEquivalent(left, right) {
    return stableStringify(createComparableMessage(left))
        === stableStringify(createComparableMessage(right));
}

export function createComparableChatData(chatData) {
    if (!Array.isArray(chatData)) {
        return [];
    }

    return chatData.map((message) => createComparableMessage(message));
}

export function isSameComparableChatData(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
        return false;
    }

    if (left.length !== right.length) {
        return false;
    }

    return left.every((message, index) => areMessagesEquivalent(message, right[index]));
}

export function isComparablePrefix(shorter, longer) {
    if (!Array.isArray(shorter) || !Array.isArray(longer)) {
        return false;
    }

    if (shorter.length > longer.length) {
        return false;
    }

    return shorter.every((message, index) => areMessagesEquivalent(message, longer[index]));
}
