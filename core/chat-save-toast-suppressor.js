const CHAT_SAVE_ERROR_TITLE = 'Chat could not be saved';
const CHAT_SAVE_ERROR_BODY = 'Check the server connection and reload the page to prevent data loss.';

function shouldSuppressChatSaveToast(getSettings, message, title) {
    if (!getSettings().suppressOfficialChatSaveToast) {
        return false;
    }

    const normalizedTitle = String(title ?? '').trim();
    const normalizedMessage = String(message ?? '').trim();
    return normalizedTitle === CHAT_SAVE_ERROR_TITLE
        || (normalizedMessage === CHAT_SAVE_ERROR_BODY && /chat/i.test(normalizedTitle));
}

export function createChatSaveToastSuppressor({ getSettings }) {
    let originalError = null;

    return {
        install() {
            if (originalError || !globalThis.toastr?.error) {
                return;
            }

            originalError = globalThis.toastr.error.bind(globalThis.toastr);
            globalThis.toastr.error = function patchedToastrError(message, title, ...args) {
                if (shouldSuppressChatSaveToast(getSettings, message, title)) {
                    return undefined;
                }

                return originalError(message, title, ...args);
            };
        },

        destroy() {
            if (!originalError || !globalThis.toastr) {
                return;
            }

            globalThis.toastr.error = originalError;
            originalError = null;
        },
    };
}
