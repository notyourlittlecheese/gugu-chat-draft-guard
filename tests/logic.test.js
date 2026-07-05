import assert from 'node:assert/strict';
import test from 'node:test';

import { createDraftStore } from '../storage/draft-store.js';
import { createSaveObserver } from '../core/save-observer.js';
import { areMessagesEquivalent } from '../core/message-signature.js';
import { buildBaselineState } from '../core/unsaved-state.js';

test('message comparison ignores presentation-only identity fields', () => {
    const left = {
        mes: 'same text',
        name: 'Old name',
        force_avatar: '/old.png',
        original_avatar: '/old-original.png',
        extra: { display_text: 'decorated old text' },
    };
    const right = {
        mes: 'same text',
        name: 'New name',
        force_avatar: '/new.png',
        original_avatar: '/new-original.png',
        extra: { display_text: 'decorated new text' },
    };

    assert.equal(areMessagesEquivalent(left, right), true);
    assert.equal(areMessagesEquivalent(left, { ...right, mes: 'changed text' }), false);
});

test('unsaved baseline records only the messages that actually differ', () => {
    const localMessages = [
        { mes: 'unchanged 0' },
        { mes: 'changed locally' },
        { mes: 'unchanged 2' },
        { mes: 'new local message' },
    ];
    const remoteMessages = [
        { mes: 'unchanged 0' },
        { mes: 'old remote value' },
        { mes: 'unchanged 2' },
    ];

    const state = buildBaselineState({
        draftKey: 'character:test',
        isGenerating: false,
        isSaving: false,
        localMessages,
        remoteMessages,
    });

    assert.deepEqual(state.unsavedMessageIndices, [1, 3]);
});

test('draft list returns the newest snapshot even when it is shorter', async () => {
    let memory = {};
    const localforage = {
        createInstance() {
            return {
                async getItem() {
                    return structuredClone(memory);
                },
                async setItem(_key, value) {
                    memory = structuredClone(value);
                },
                async removeItem() {
                    memory = {};
                },
            };
        },
    };
    const store = createDraftStore(localforage, () => ({
        archivedMaxSnapshots: 1,
        ownerDraftLimit: null,
        unsyncedMaxSnapshots: 3,
    }));
    const base = {
        draftKey: 'character:test',
        ownerKey: 'character-owner:test.png',
        ownerLabel: 'Test',
        isGroup: false,
        chatMetadata: {},
    };

    await store.save({
        ...base,
        updatedAt: 100,
        messageCount: 2,
        lastPreview: 'old second message',
        chatHash: 'older-longer',
        chatData: [{ mes: 'first' }, { mes: 'second' }],
    });
    await store.save({
        ...base,
        updatedAt: 200,
        messageCount: 1,
        lastPreview: 'new first message',
        chatHash: 'newer-shorter',
        chatData: [{ mes: 'first' }],
    });

    const latest = await store.getLatest(base.draftKey);
    assert.equal(latest.chatHash, 'newer-shorter');
});

test('save observer recognizes compressed current-chat requests', async () => {
    const originalWindow = globalThis.window;
    const results = [];
    globalThis.window = {
        fetch: async () => ({ ok: true }),
    };

    try {
        const observer = createSaveObserver({
            getIdentity: () => ({ draftKey: 'character:test-chat' }),
            onSaveSettled: (result) => results.push(result),
        });
        observer.install();
        await globalThis.window.fetch('/api/chats/save', {
            method: 'POST',
            body: new Uint8Array([1, 2, 3]),
        });
        observer.destroy();

        assert.equal(results.length, 1);
        assert.equal(results[0].ok, true);
    } finally {
        globalThis.window = originalWindow;
    }
});
