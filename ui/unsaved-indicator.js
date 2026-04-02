function getChatRoot() {
    return document.querySelector('#chat');
}

function createBadge() {
    const badge = document.createElement('span');
    badge.className = 'gcdg-unsaved-badge';
    badge.textContent = '未保存';
    return badge;
}

function createBanner() {
    const banner = document.createElement('div');
    banner.className = 'gcdg-unsaved-banner';
    const dot = document.createElement('span');
    dot.className = 'gcdg-unsaved-banner-dot';
    dot.setAttribute('aria-hidden', 'true');

    const content = document.createElement('span');
    content.className = 'gcdg-unsaved-banner-text';
    content.textContent = '未保存区';

    banner.append(dot, content);
    return banner;
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

function getRegionClass(index, total) {
    if (total <= 1) {
        return 'gcdg-unsaved-single';
    }

    if (index === 0) {
        return 'gcdg-unsaved-first';
    }

    if (index === total - 1) {
        return 'gcdg-unsaved-last';
    }

    return 'gcdg-unsaved-middle';
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
    const banner = createBanner();
    const anchor = unsavedMessages[0] ?? chatRoot.firstElementChild;

    if (anchor) {
        anchor.before(banner);
    } else {
        chatRoot.prepend(banner);
    }

    unsavedMessages.forEach((messageElement, index) => {
        const host = getBadgeHost(messageElement);
        messageElement.classList.add('gcdg-unsaved-message', getRegionClass(index, unsavedMessages.length));

        if (host && !host.querySelector('.gcdg-unsaved-badge')) {
            host.append(createBadge());
        }
    });
}
