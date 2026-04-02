import { addCopyToCodeBlocks, default_avatar, default_user_avatar, system_avatar } from '../../../../../script.js';
import { SCROLL_BEHAVIOR } from '../../../../constants.js';
import { user_avatar } from '../../../../personas.js';
import { PREVIEW_BATCH_SIZE } from '../constants.js';

function cloneValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value ?? null));
}

function resolveAvatarUrl(context, type, value, fallback) {
    if (!value || value === 'none') {
        return fallback;
    }
    if (/^(?:https?:|data:|\/)/.test(value) || value.startsWith('img/')) {
        return value;
    }
    return context.getThumbnailUrl(type, value);
}

function getDisplayName(context, record, message) {
    if (typeof message?.name === 'string' && message.name.trim()) {
        return message.name;
    }
    if (message?.is_user) {
        return context.name1 || 'User';
    }
    return record?.ownerLabel || '角色';
}

function getUserAvatarUrl(context, message) {
    if (typeof message?.force_avatar === 'string' && message.force_avatar) {
        return resolveAvatarUrl(context, 'persona', message.force_avatar, default_user_avatar);
    }
    return user_avatar
        ? context.getThumbnailUrl('persona', user_avatar)
        : default_user_avatar;
}

function getCharacterAvatarUrl(context, record, message) {
    const avatar = message?.original_avatar || message?.force_avatar || record?.characterAvatar;
    return resolveAvatarUrl(context, 'avatar', avatar, default_avatar);
}

function getMessageAvatarUrl(context, record, message) {
    if (message?.is_user) {
        return getUserAvatarUrl(context, message);
    }
    if (message?.is_system) {
        return resolveAvatarUrl(context, 'avatar', message?.force_avatar, system_avatar);
    }
    return getCharacterAvatarUrl(context, record, message);
}

function formatTimestamp(context, sendDate) {
    const timestamp = context.timestampToMoment(sendDate);
    return timestamp?.isValid?.() ? timestamp.format('LL LT') : '';
}

function getSanitizerOverrides(message) {
    return message?.extra?.uses_system_ui ? { MESSAGE_ALLOW_SYSTEM_UI: true } : {};
}

function getMessageHtml(context, record, message, messageId) {
    const text = message?.extra?.display_text || message?.mes || '';
    return context.messageFormatting(
        text,
        getDisplayName(context, record, message),
        Boolean(message?.is_system),
        Boolean(message?.is_user),
        messageId,
        getSanitizerOverrides(message),
        false,
    );
}

function getReasoningHtml(context, record, message, messageId) {
    const reasoning = message?.extra?.reasoning_display_text ?? message?.extra?.reasoning ?? '';
    if (!reasoning) {
        return '';
    }
    return context.messageFormatting(
        reasoning,
        getDisplayName(context, record, message),
        false,
        false,
        messageId,
        {},
        true,
    );
}

function applyReadonlyState(messageElement) {
    messageElement.addClass('gcdg-preview-readonly');
    messageElement.find('.for_checkbox').remove();
    messageElement.find('.del_checkbox').remove();
    messageElement.find('.mes_buttons').remove();
    messageElement.find('.mes_edit_buttons').remove();
    messageElement.find('.swipe_left').remove();
    messageElement.find('.swipeRightBlock').remove();
    messageElement.find('.mes_bookmark').remove();
    messageElement.find('.mes_reasoning_actions').remove();
    messageElement.find('.mes').removeAttr('title');
}

function applyReasoning(context, record, messageElement, message, messageId) {
    const details = messageElement.find('.mes_reasoning_details');
    const reasoningHtml = getReasoningHtml(context, record, message, messageId);
    if (!reasoningHtml) {
        details.remove();
        return;
    }
    details.find('.mes_reasoning').html(reasoningHtml);
    details.prop('open', Boolean(context.powerUserSettings?.reasoning?.auto_expand));
}

function populateMessageMeta(context, record, messageElement, message, index) {
    const displayName = getDisplayName(context, record, message);
    const timestamp = formatTimestamp(context, message?.send_date);
    const timestampTitle = `${message?.extra?.api ? message.extra.api + ' - ' : ''}${message?.extra?.model ?? ''}`;
    messageElement.attr({
        mesid: index,
        ch_name: displayName,
        is_user: Boolean(message?.is_user),
        is_system: Boolean(message?.is_system),
        type: message?.extra?.type ?? '',
    });
    messageElement.find('.avatar img').attr('src', getMessageAvatarUrl(context, record, message));
    messageElement.find('.name_text').text(displayName);
    messageElement.find('.mesIDDisplay').text(`#${index}`);
    messageElement.find('.timestamp').text(timestamp).attr('title', timestampTitle);
    messageElement.attr('title', message?.title || '');
}

function populateMessageBody(context, record, messageElement, message, index) {
    const messageHtml = getMessageHtml(context, record, message, index);
    messageElement.find('.mes_text').html(messageHtml);
    if (message?.extra?.bias) {
        messageElement.find('.mes_bias').html(
            context.messageFormatting(message.extra.bias, '', false, false, -1, {}, false),
        );
    }
    context.ensureMessageMediaIsArray(message);
    context.appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.NONE);
    addCopyToCodeBlocks(messageElement);
}

function buildPreviewMessage(context, record, message, index) {
    const element = $('#message_template .mes').clone();
    applyReadonlyState(element);
    populateMessageMeta(context, record, element, message, index);
    applyReasoning(context, record, element, message, index);
    populateMessageBody(context, record, element, message, index);
    if (message?.extra?.isSmallSys) {
        element.addClass('smallSysMes');
    }
    if (Array.isArray(message?.extra?.tool_invocations)) {
        element.addClass('toolCall');
    }
    return element;
}

function withPreviewChat(context, previewChat, callback) {
    const liveChat = context.chat;
    const originalChat = liveChat.slice();
    liveChat.splice(0, liveChat.length, ...previewChat);
    try {
        return callback(previewChat);
    } finally {
        liveChat.splice(0, liveChat.length, ...originalChat);
    }
}

function formatHeaderTimestamp(value) {
    const date = new Date(value ?? Date.now());
    return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString();
}

function createPreviewState(record) {
    const previewChat = cloneValue(record?.chatData ?? []);
    const totalCount = previewChat.length;
    return {
        record,
        previewChat,
        totalCount,
        loadedStart: Math.max(0, totalCount - PREVIEW_BATCH_SIZE),
        isLoading: false,
    };
}

function getLoadedCount(state) {
    return state.totalCount - state.loadedStart;
}

function buildSheet(record) {
    const sheet = $(`
        <section class="gcdg-preview-sheet">
            <header class="gcdg-preview-top">
                <div class="gcdg-preview-title" data-preview-title></div>
                <div class="gcdg-preview-subtitle" data-preview-subtitle></div>
                <div class="gcdg-preview-status" data-preview-status></div>
            </header>
            <div class="gcdg-preview-scroll" data-preview-scroll>
                <div class="gcdg-preview-chatwrap">
                    <div class="gcdg-preview-loadbar" data-preview-loadbar hidden>
                        <div class="gcdg-preview-remaining" data-preview-remaining></div>
                        <button type="button" class="menu_button gcdg-preview-load" data-preview-load-button></button>
                    </div>
                    <div class="gcdg-preview-chat" data-preview-chat></div>
                </div>
            </div>
            <footer class="gcdg-preview-toolbar">
                <button type="button" class="menu_button gcdg-preview-action gcdg-preview-action-primary" data-preview-action="recover">恢复</button>
                <button type="button" class="menu_button gcdg-preview-action" data-preview-action="export">导出</button>
                <button type="button" class="menu_button gcdg-preview-action gcdg-preview-action-danger" data-preview-action="discard">丢弃</button>
                <button type="button" class="menu_button gcdg-preview-action" data-preview-action="close">关闭</button>
            </footer>
        </section>
    `);
    sheet.find('[data-preview-title]').text(record?.label || '本地草稿');
    return sheet;
}

function updatePreviewSummary(sheet, state) {
    sheet.find('[data-preview-subtitle]').text(formatHeaderTimestamp(state.record?.updatedAt));
    sheet.find('[data-preview-status]').text(`已加载 ${getLoadedCount(state)} / ${state.totalCount} 条`);
}

function updateLoadControls(sheet, state) {
    const remaining = state.loadedStart;
    const loadbar = sheet.find('[data-preview-loadbar]');
    const button = sheet.find('[data-preview-load-button]');
    if (remaining <= 0) {
        loadbar.prop('hidden', true);
        return;
    }
    loadbar.prop('hidden', false);
    loadbar.find('[data-preview-remaining]').text(`还有 ${remaining} 条未加载`);
    button.prop('disabled', state.isLoading)
        .text(state.isLoading ? '加载中…' : `继续加载 ${Math.min(PREVIEW_BATCH_SIZE, remaining)} 条`);
}

function buildPreviewBatch(context, state, start, end) {
    const fragment = document.createDocumentFragment();
    withPreviewChat(context, state.previewChat, () => {
        for (let index = start; index < end; index += 1) {
            fragment.append(buildPreviewMessage(context, state.record, state.previewChat[index], index)[0]);
        }
    });
    return fragment;
}

function renderInitialBatch(context, sheet, state) {
    sheet.find('[data-preview-chat]').get(0)
        .append(buildPreviewBatch(context, state, state.loadedStart, state.totalCount));
    updatePreviewSummary(sheet, state);
    updateLoadControls(sheet, state);
}

function scrollToLatest(sheet) {
    const scroll = sheet.find('[data-preview-scroll]').get(0);
    if (!scroll) {
        return;
    }

    window.requestAnimationFrame(() => {
        scroll.scrollTop = scroll.scrollHeight;
    });
}

function loadOlderBatch(context, sheet, state) {
    if (state.isLoading || state.loadedStart <= 0) {
        return;
    }
    state.isLoading = true;
    updateLoadControls(sheet, state);
    window.requestAnimationFrame(() => {
        const scroll = sheet.find('[data-preview-scroll]').get(0);
        const container = sheet.find('[data-preview-chat]').get(0);
        const previousHeight = scroll.scrollHeight;
        const end = state.loadedStart;
        const start = Math.max(0, end - PREVIEW_BATCH_SIZE);
        container.prepend(buildPreviewBatch(context, state, start, end));
        state.loadedStart = start;
        scroll.scrollTop += scroll.scrollHeight - previousHeight;
        state.isLoading = false;
        updatePreviewSummary(sheet, state);
        updateLoadControls(sheet, state);
    });
}

export function createDraftPreviewView(record) {
    const context = SillyTavern.getContext();
    const state = createPreviewState(record);
    const sheet = buildSheet(record);
    if (state.totalCount === 0) {
        sheet.find('[data-preview-chat]').append('<div class="gcdg-preview-empty">草稿里没有消息。</div>');
        updatePreviewSummary(sheet, state);
        return {
            element: sheet,
            scrollToLatest: () => {},
        };
    }
    renderInitialBatch(context, sheet, state);
    sheet.on('click', '[data-preview-load-button]', () => loadOlderBatch(context, sheet, state));
    return {
        element: sheet,
        scrollToLatest: () => scrollToLatest(sheet),
    };
}

export function renderDraftPreview(record) {
    return createDraftPreviewView(record).element;
}
