import {
    MIN_OWNER_DRAFT_LIMIT,
    MODULE_NAME,
    PANEL_BATCH_SIZE,
    PANEL_INITIAL_BATCH_SIZE,
    UI_TITLE,
} from '../constants.js';
import { getRelationOrder } from '../core/draft-relations.js';

const FILTER_ALL = 'all';
const FILTER_OTHER_OWNER = 'other-owner';

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${month}/${day} ${hours}:${minutes}`;
}

function formatFloor(floor) {
    return `#${Math.max(0, Number(floor ?? 0))}`;
}

function createFilterOptions(hasCurrentChat) {
    if (hasCurrentChat) {
        return [
            { id: FILTER_ALL, label: '全部' },
            { id: 'exact', label: '一致' },
            { id: 'ahead', label: '高于当前' },
            { id: 'behind', label: '低于当前' },
            { id: 'diverged', label: '已分叉' },
            { id: 'other-chat', label: '其他聊天' },
            { id: FILTER_OTHER_OWNER, label: '其他角色' },
        ];
    }

    return [{ id: FILTER_ALL, label: '全部' }];
}

function sortRecords(records, currentOwnerKey) {
    return [...records].sort((left, right) => {
        if (currentOwnerKey) {
            const ownerDiff = Number(right.ownerKey === currentOwnerKey) - Number(left.ownerKey === currentOwnerKey);
            if (ownerDiff !== 0) {
                return ownerDiff;
            }
        }

        const statusDiff = Number(left.draftStatus === 'archived') - Number(right.draftStatus === 'archived');
        if (statusDiff !== 0) {
            return statusDiff;
        }

        const relationDiff = getRelationOrder(left.relation) - getRelationOrder(right.relation);
        if (relationDiff !== 0) {
            return relationDiff;
        }

        return Number(right.updatedAt) - Number(left.updatedAt);
    });
}

function filterRecords(records, filterKey, currentOwnerKey, hasCurrentChat) {
    if (!hasCurrentChat || !currentOwnerKey) {
        return filterKey === FILTER_ALL ? records : [];
    }

    if (filterKey === FILTER_OTHER_OWNER) {
        return records.filter((record) => record.ownerKey !== currentOwnerKey);
    }

    const currentOwnerRecords = records.filter((record) => record.ownerKey === currentOwnerKey);
    if (filterKey === FILTER_ALL) {
        return currentOwnerRecords;
    }

    return currentOwnerRecords.filter((record) => record.relation === filterKey);
}

function createFilterChip(option, active) {
    const button = $('<button type="button" class="gcdg-chip"></button>');
    button.attr('data-filter', option.id);
    button.toggleClass('is-active', active);
    button.text(option.label);
    return button;
}

function getFilterLabel(filterKey, hasCurrentChat) {
    return createFilterOptions(hasCurrentChat).find((option) => option.id === filterKey)?.label || '全部';
}

function getEmptyText(filterKey, hasCurrentChat) {
    if (!hasCurrentChat) {
        return '暂无草稿';
    }

    if (filterKey === FILTER_OTHER_OWNER) {
        return '暂无其他角色草稿';
    }

    if (filterKey === FILTER_ALL) {
        return '当前角色下暂无草稿';
    }

    return '当前角色下暂无这类草稿';
}

function getNextVisibleCount(currentCount) {
    return currentCount + PANEL_BATCH_SIZE;
}

function createTag(label, kind) {
    if (!label) {
        return null;
    }

    const tag = $('<span class="gcdg-draft-tag"></span>');
    tag.addClass(`is-${kind}`);
    tag.text(label);
    return tag;
}

function createDraftRow(record) {
    const row = $(`
        <div class="gcdg-draft-row">
            <div class="gcdg-draft-head">
                <div class="gcdg-draft-main">
                    <div class="gcdg-draft-label"></div>
                    <div class="gcdg-draft-meta"></div>
                </div>
                <div class="gcdg-draft-floor"></div>
            </div>
            <div class="gcdg-draft-tags"></div>
            <div class="gcdg-draft-preview"></div>
            <div class="gcdg-draft-actions">
                <button class="menu_button gcdg-draft-action" data-action="preview">预览</button>
                <button class="menu_button gcdg-draft-action gcdg-draft-action-recover" data-action="recover">恢复</button>
                <button class="menu_button gcdg-draft-action" data-action="export">导出</button>
                <button class="menu_button gcdg-draft-action" data-action="discard">丢弃</button>
            </div>
        </div>
    `);

    row.attr('data-draft-key', record.draftKey);
    row.addClass(`is-relation-${record.relation}`);
    row.toggleClass('is-archived', record.draftStatus === 'archived');
    row.find('.gcdg-draft-label').text(record.label);
    row.find('.gcdg-draft-meta').text(formatTime(record.updatedAt));
    row.find('.gcdg-draft-preview').text(record.lastPreview);
    row.find('.gcdg-draft-floor').text(formatFloor(record.floor));
    const tags = row.find('.gcdg-draft-tags');
    const statusTag = createTag(record.statusLabel, record.draftStatus);
    const relationTag = createTag(record.relationLabel, record.relation);

    if (statusTag) {
        tags.append(statusTag);
    }

    if (relationTag) {
        tags.append(relationTag);
    }

    if (record.relation === 'ahead' && record.draftStatus === 'unsynced') {
        row.find('.gcdg-draft-action-recover').addClass('gcdg-button-primary');
    }

    return row;
}

function bindDraftActions(root, getActions) {
    root.on('click', '.gcdg-draft-action', function () {
        const row = $(this).closest('[data-draft-key]');
        const draftKey = row.attr('data-draft-key');
        const action = $(this).attr('data-action');
        const actions = getActions();

        if (!draftKey) {
            return;
        }

        if (action === 'recover') {
            actions.recoverDraft(draftKey);
        }

        if (action === 'preview') {
            actions.previewDraft(draftKey);
        }

        if (action === 'export') {
            actions.exportDraft(draftKey);
        }

        if (action === 'discard') {
            actions.discardDraft(draftKey);
        }
    });
}

export function createPanel({ getSettings, onOwnerLimitChange, onSettingsChange }) {
    let root = null;
    let actions = {
        clearAllDrafts: () => {},
        previewDraft: () => {},
        recoverDraft: () => {},
        exportDraft: () => {},
        discardDraft: () => {},
        openAbout: () => {},
    };
    let model = {
        currentOwnerKey: null,
        hasCurrentChat: false,
        records: [],
    };
    let filterKey = FILTER_ALL;
    let visibleCount = PANEL_INITIAL_BATCH_SIZE;

    function hasCurrentOwnerContext() {
        return Boolean(model.hasCurrentChat && model.currentOwnerKey);
    }

    function getCurrentOwnerLimit() {
        const rawLimit = getSettings().ownerDraftLimit;
        return Number.isFinite(Number(rawLimit)) ? String(rawLimit) : '';
    }

    function renderOwnerLimitControls() {
        const input = root.find('#gcdg_owner_limit');
        input.val(getCurrentOwnerLimit());
    }

    function renderFilterControls() {
        const wrap = root.find('[data-category-controls]');
        const options = createFilterOptions(hasCurrentOwnerContext());
        const validIds = new Set(options.map((option) => option.id));
        if (!validIds.has(filterKey)) {
            filterKey = FILTER_ALL;
        }

        wrap.empty();
        options.forEach((option) => {
            wrap.append(createFilterChip(option, option.id === filterKey));
        });
    }

    function renderLoadMore(totalCount, renderedCount) {
        const wrap = root.find('[data-draft-loadmore]');
        if (totalCount <= renderedCount) {
            wrap.prop('hidden', true);
            return;
        }

        wrap.prop('hidden', false);
        root.find('[data-draft-loadmore-meta]').text(`已显示 ${renderedCount} / ${totalCount}`);
        root.find('[data-draft-loadmore-button]')
            .text(`继续显示 ${Math.min(PANEL_BATCH_SIZE, totalCount - renderedCount)} 张`);
    }

    function resetVisibleCount() {
        visibleCount = PANEL_INITIAL_BATCH_SIZE;
    }

    function renderList() {
        const list = root.find('[data-draft-list]');
        const empty = root.find('[data-empty-state]');
        const loadMore = root.find('[data-draft-loadmore]');
        const allVisible = sortRecords(
            filterRecords(model.records, filterKey, model.currentOwnerKey, hasCurrentOwnerContext()),
            model.currentOwnerKey,
        );
        const renderedCount = Math.min(visibleCount, allVisible.length);
        const visible = allVisible.slice(0, renderedCount);

        list.empty();
        root.find('[data-draft-count]').text(String(allVisible.length));
        root.find('[data-filter-caption]').text(getFilterLabel(filterKey, hasCurrentOwnerContext()));
        root.find('[data-filter-count]').text(`${allVisible.length} 张`);

        if (allVisible.length === 0) {
            empty.removeClass('displayNone');
            empty.text(getEmptyText(filterKey, hasCurrentOwnerContext()));
            list.addClass('displayNone');
            loadMore.prop('hidden', true);
            return;
        }

        empty.addClass('displayNone');
        list.removeClass('displayNone');
        visible.forEach((record) => list.append(createDraftRow(record)));
        renderLoadMore(allVisible.length, renderedCount);
    }

    function renderAll() {
        if (!root) {
            return;
        }

        renderOwnerLimitControls();
        renderFilterControls();
        renderList();
    }

    function saveOwnerLimit() {
        const rawValue = String(root.find('#gcdg_owner_limit').val() ?? '').trim();
        if (!rawValue) {
            void onOwnerLimitChange({ limit: null });
            return;
        }

        const value = Math.floor(Number(rawValue));
        if (!Number.isFinite(value) || value < MIN_OWNER_DRAFT_LIMIT) {
            toastr.warning(`至少保留 ${MIN_OWNER_DRAFT_LIMIT} 份草稿。`, UI_TITLE);
            root.find('#gcdg_owner_limit').val(getCurrentOwnerLimit());
            return;
        }

        void onOwnerLimitChange({ limit: value });
    }

    function bindSettings() {
        root.find('#gcdg_enabled').on('change', function () {
            onSettingsChange({ enabled: $(this).prop('checked') });
        });

        root.find('#gcdg_suppress_official_chat_save_toast').on('change', function () {
            onSettingsChange({ suppressOfficialChatSaveToast: $(this).prop('checked') });
        });
        root.find('[data-owner-limit-save]').on('click', saveOwnerLimit);
        root.find('[data-owner-limit-clear]').on('click', () => {
            root.find('#gcdg_owner_limit').val('');
            void onOwnerLimitChange({ limit: null });
        });
        root.find('#gcdg_owner_limit').on('keydown', function (event) {
            if (event.key !== 'Enter') {
                return;
            }

            event.preventDefault();
            saveOwnerLimit();
        });

        root.find('#gcdg_clear_all').on('click', () => actions.clearAllDrafts());
        root.find('[data-open-about]').on('click', () => actions.openAbout());
        root.on('click', '[data-filter]', function () {
            const next = $(this).attr('data-filter');
            if (!next || next === filterKey) {
                return;
            }

            filterKey = next;
            resetVisibleCount();
            renderAll();
        });
        root.find('[data-draft-loadmore-button]').on('click', () => {
            visibleCount = getNextVisibleCount(visibleCount);
            renderList();
        });
        bindDraftActions(root, () => actions);
    }

    function syncSettings() {
        const settings = getSettings();
        root.find('#gcdg_enabled').prop('checked', Boolean(settings.enabled));
        root.find('#gcdg_suppress_official_chat_save_toast').prop('checked', Boolean(settings.suppressOfficialChatSaveToast));
    }

    return {
        mount(html) {
            $('#extensions_settings2').append(html);
            root = $(`#${MODULE_NAME}_panel`);
            root.find('.gcdg-title').text(UI_TITLE);
            bindSettings();
            syncSettings();
            renderAll();
        },

        setActions(nextActions) {
            actions = { ...actions, ...nextActions };
        },

        focus() {
            if (!root) {
                return;
            }

            const extensionsDrawer = $('#rm_extensions_block');
            const extensionsToggle = $('#extensions-settings-button .drawer-toggle');
            if (extensionsDrawer.length && extensionsToggle.length && !extensionsDrawer.hasClass('openDrawer')) {
                extensionsToggle.trigger('click');
            }

            window.setTimeout(() => {
                const content = root.find('.inline-drawer-content');
                if (content.length && !content.is(':visible')) {
                    root.find('.inline-drawer-toggle').trigger('click');
                }

                root[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 180);
        },

        renderDrafts(nextModel) {
            model = nextModel ?? model;
            resetVisibleCount();
            renderAll();
        },
    };
}
