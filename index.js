import { localforage } from '../../../../lib.js';
import { DEFAULT_SETTINGS, MIN_OWNER_DRAFT_LIMIT, MODULE_FOLDER, MODULE_NAME } from './constants.js';
import { createChatSaveToastSuppressor } from './core/chat-save-toast-suppressor.js';
import { createDraftController } from './core/draft-controller.js';
import { createUnsavedIndicatorController } from './core/unsaved-indicator-controller.js';
import { createDraftStore } from './storage/draft-store.js';
import { showAboutPopup } from './ui/about-popup.js';
import { createPanel } from './ui/panel.js';

let controller = null;
let store = null;
let unsavedIndicatorController = null;
let toastSuppressor = null;
let wandButton = null;

function getContext() {
    return SillyTavern.getContext();
}

function cloneDefaults(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}

function getSettings() {
    const context = getContext();

    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = cloneDefaults(DEFAULT_SETTINGS);
    }

    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
        if (!Object.hasOwn(context.extensionSettings[MODULE_NAME], key)) {
            context.extensionSettings[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
        }
    });

    return context.extensionSettings[MODULE_NAME];
}

function updateSettings(patch) {
    Object.assign(getSettings(), patch);
    getContext().saveSettingsDebounced();
}

async function updateOwnerDraftLimit(limit) {
    if (limit === null || limit === undefined || String(limit).trim() === '') {
        updateSettings({ ownerDraftLimit: null });

        if (controller) {
            await controller.enforceOwnerDraftLimit();
        }
        return;
    }

    const parsedLimit = Number(limit);
    const nextLimit = Number.isFinite(parsedLimit)
        ? Math.max(MIN_OWNER_DRAFT_LIMIT, Math.floor(parsedLimit))
        : null;

    updateSettings({ ownerDraftLimit: nextLimit });

    if (controller) {
        await controller.enforceOwnerDraftLimit();
    }
}

function mountWandButton(panel) {
    const menu = $('#extensionsMenu');
    if (!menu.length || $('#gcdg_wand_container').length) {
        return;
    }

    const container = $('<div id="gcdg_wand_container" class="extension_container"></div>');
    const button = $(`
        <div class="list-group-item flex-container interactable">
            <div class="fa-solid fa-shield-halved extensionsMenuExtensionButton"></div>
            <span>聊天守护</span>
        </div>
    `);

    button.on('click', () => {
        panel.focus();
        menu.hide();
    });
    container.append(button);
    menu.append(container);
    wandButton = container;
}

async function init() {
    const context = getContext();
    const panel = createPanel({
        getSettings,
        onSettingsChange: updateSettings,
        onOwnerLimitChange: ({ limit }) => updateOwnerDraftLimit(limit),
    });
    const html = await context.renderExtensionTemplateAsync(MODULE_FOLDER, 'settings');

    panel.mount(html);
    mountWandButton(panel);
    toastSuppressor = createChatSaveToastSuppressor({ getSettings });
    toastSuppressor.install();
    store = createDraftStore(localforage, getSettings);
    controller = createDraftController({
        getSettings,
        panel,
        store,
    });
    panel.setActions({
        openAbout: () => {
            void showAboutPopup();
        },
    });
    await controller.init();
    unsavedIndicatorController = createUnsavedIndicatorController({
        onExportDraft: () => {
            void controller.exportCurrentDraft();
        },
        onRecoverDraft: () => {
            panel.focus();
        },
    });
    await unsavedIndicatorController.init();
}

void init();

export async function onDelete() {
    if (controller) {
        await controller.destroy();
    }

    if (unsavedIndicatorController) {
        await unsavedIndicatorController.destroy();
    }

    if (toastSuppressor) {
        toastSuppressor.destroy();
    }

    if (wandButton) {
        wandButton.remove();
        wandButton = null;
    }

    if (store) {
        await store.clear();
    }
}
