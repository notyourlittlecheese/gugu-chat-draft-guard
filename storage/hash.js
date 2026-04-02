function normalizeValue(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeValue);
    }

    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                result[key] = normalizeValue(value[key]);
                return result;
            }, {});
    }

    return value;
}

export function stableStringify(value) {
    return JSON.stringify(normalizeValue(value));
}

export function hashString(input) {
    let hash = 0x811c9dc5;

    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildChatHash(payload) {
    return hashString(stableStringify(payload));
}
