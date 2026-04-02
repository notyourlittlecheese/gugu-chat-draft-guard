export const MODULE_NAME = 'gugu_chat_draft_guard';
export const MODULE_FOLDER = 'third-party/gugu-chat-draft-guard';
export const UI_TITLE = '咕咕助手 - 聊天草稿守护';
export const STORAGE_NAME = 'GuguChatDraftGuard';
export const STORAGE_KEY = 'draft-records';
export const SNAPSHOT_DEBOUNCE_MS = 800;
export const MAX_PREVIEW_CHARS = 120;
export const PREVIEW_BATCH_SIZE = 50;
export const PANEL_INITIAL_BATCH_SIZE = 6;
export const PANEL_BATCH_SIZE = 6;
export const SAVE_STATE_POLL_MS = 250;
export const ABNORMAL_SAVE_GRACE_MS = 2500;
export const SAVE_NOISE_SUPPRESS_MS = 3000;
export const VERIFY_CONFIRM_DELAY_MS = 900;
export const VERIFY_MAX_ATTEMPTS = 2;
export const AUTO_RETRY_DELAYS_MS = Object.freeze([1200, 3000]);
export const MIN_OWNER_DRAFT_LIMIT = 1;

export const TRACKED_EVENTS = Object.freeze([
    'MESSAGE_SENT',
    'MESSAGE_RECEIVED',
    'MESSAGE_EDITED',
    'MESSAGE_DELETED',
    'MESSAGE_SWIPED',
    'MESSAGE_UPDATED',
]);

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    unsyncedMaxSnapshots: 3,
    archivedMaxSnapshots: 1,
    ownerDraftLimit: 7,
    maxSnapshots: 3,
    suppressOfficialChatSaveToast: false,
});
