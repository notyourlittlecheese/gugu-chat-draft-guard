import { createDraftPreviewView } from './preview-renderer.js';

function setActionBusy(root, disabled) {
    root.find('[data-preview-action], [data-preview-load-button]').prop('disabled', disabled);
}

export async function showDraftPreviewPopup({ record, onRecover, onExport, onDiscard }) {
    const context = SillyTavern.getContext();
    const view = createDraftPreviewView(record);
    const root = view.element;
    const popup = new context.Popup(root, context.POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: false,
        leftAlign: true,
        onOpen: (instance) => {
            instance.dlg.classList.add('gcdg-preview-popup');
            view.scrollToLatest();
        },
    });

    let busy = false;
    root.on('click', '[data-preview-action]', async function () {
        if (busy) {
            return;
        }

        const action = $(this).attr('data-preview-action');
        busy = true;
        setActionBusy(root, true);

        try {
            if (action === 'close') {
                await popup.complete(context.POPUP_RESULT.CANCELLED);
                return;
            }

            if (action === 'recover') {
                const recovered = await onRecover(record);
                if (recovered) {
                    await popup.complete(context.POPUP_RESULT.CANCELLED);
                }
            }

            if (action === 'export') {
                await onExport(record);
            }

            if (action === 'discard') {
                const discarded = await onDiscard(record);
                if (discarded) {
                    await popup.complete(context.POPUP_RESULT.CANCELLED);
                }
            }
        } finally {
            busy = false;
            setActionBusy(root, false);
        }
    });

    await popup.show();
}
