import { parseDraftKey } from './recovery-target.js';

function getRequestUrl(input) {
    if (typeof input === 'string') {
        return input;
    }

    return input?.url ?? '';
}

function getRequestMethod(input, init) {
    if (init?.method) {
        return String(init.method).toUpperCase();
    }

    if (typeof input === 'object' && input?.method) {
        return String(input.method).toUpperCase();
    }

    return 'GET';
}

function parseJsonBody(body) {
    if (typeof body !== 'string') {
        return null;
    }

    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

function matchSaveRequest(identity, url, payload) {
    const parsed = parseDraftKey(identity?.draftKey);
    if (!parsed) {
        return false;
    }

    if (url.includes('/api/chats/group/save')) {
        return parsed.isGroup && String(payload?.id ?? '') === String(parsed.chatId);
    }

    if (url.includes('/api/chats/save')) {
        return !parsed.isGroup && String(payload?.file_name ?? '') === String(parsed.chatId);
    }

    return false;
}

export function createSaveObserver({ getIdentity, onSaveSettled }) {
    let originalFetch = null;

    return {
        install() {
            if (originalFetch) {
                return;
            }

            originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = getRequestUrl(input);
                const method = getRequestMethod(input, init);

                if (method !== 'POST' || !url.includes('/api/chats/')) {
                    return originalFetch(input, init);
                }

                const identity = getIdentity();
                const payload = parseJsonBody(init?.body);
                if (!matchSaveRequest(identity, url, payload)) {
                    return originalFetch(input, init);
                }

                try {
                    const response = await originalFetch(input, init);
                    onSaveSettled({
                        identity,
                        ok: response.ok,
                        payload,
                        url,
                    });
                    return response;
                } catch (error) {
                    onSaveSettled({
                        identity,
                        ok: false,
                        payload,
                        url,
                    });
                    throw error;
                }
            };
        },

        destroy() {
            if (!originalFetch) {
                return;
            }

            window.fetch = originalFetch;
            originalFetch = null;
        },
    };
}
