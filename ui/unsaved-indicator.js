function getChatRoot() {
    return document.querySelector('#chat');
}

function createBadge() {
    const badge = document.createElement('span');
    badge.className = 'gcdg-unsaved-badge';
    badge.textContent = '未保存';
    return badge;
}

function getBadgeHost(messageElement) {
    return messageElement.querySelector('.ch_name .alignItemsBaseline')
        ?? messageElement.querySelector('.ch_name')
        ?? messageElement.querySelector('.mes_block');
}

function getUnsavedMessages(chatRoot, unsavedStart, chatLength) {
    return Array.from(chatRoot.querySelectorAll('.mes[mesid]'))
        .filter((element) => {
            const messageId = Number(element.getAttribute('mesid'));
            return Number.isInteger(messageId) && messageId >= unsavedStart && messageId < chatLength;
        });
}

export function clearUnsavedMarkers() {
    const chatRoot = getChatRoot();
    if (!chatRoot) {
        return;
    }

    chatRoot.querySelectorAll('.gcdg-unsaved-message, .gcdg-unsaved-first, .gcdg-unsaved-middle, .gcdg-unsaved-last, .gcdg-unsaved-single')
        .forEach((element) => element.classList.remove(
            'gcdg-unsaved-message',
            'gcdg-unsaved-first',
            'gcdg-unsaved-middle',
            'gcdg-unsaved-last',
            'gcdg-unsaved-single',
        ));
    chatRoot.querySelectorAll('.gcdg-unsaved-badge, .gcdg-unsaved-banner')
        .forEach((element) => element.remove());
}

export function applyUnsavedMarkers({
    chatLength,
    hasPendingDeletion,
    savedPrefixLength,
}) {
    const chatRoot = getChatRoot();
    if (!chatRoot) {
        return;
    }

    clearUnsavedMarkers();

    const unsavedStart = Math.min(savedPrefixLength, chatLength);
    const unsavedCount = Math.max(0, chatLength - unsavedStart);
    if (unsavedCount === 0 && !hasPendingDeletion) {
        return;
    }

    const unsavedMessages = getUnsavedMessages(chatRoot, unsavedStart, chatLength);
    unsavedMessages.forEach((messageElement) => {
        const host = getBadgeHost(messageElement);

        if (host && !host.querySelector('.gcdg-unsaved-badge')) {
            host.append(createBadge());
        }
    });
}
