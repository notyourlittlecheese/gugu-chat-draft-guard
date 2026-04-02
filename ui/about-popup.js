const ABOUT_LINKS = Object.freeze([
    { label: '作者', value: '清绝', href: '', icon: 'fa-regular fa-user' },
    { label: '博客', value: 'blog.qjyg.de', href: 'https://blog.qjyg.de/blog/gugu-chat-draft-guard', icon: 'fa-solid fa-book-open' },
    { label: '仓库', value: 'canaan723/gugu-chat-draft-guard', href: 'https://gitee.com/canaan723/gugu-chat-draft-guard', icon: 'fa-solid fa-code-branch' },
]);

function renderAboutRow(item) {
    const action = item.href
        ? `
            <button
                type="button"
                class="menu_button gcdg-about-link"
                data-about-url="${item.href}"
                aria-label="打开${item.label}"
                title="打开${item.label}"
            >
                <i class="${item.icon}"></i>
            </button>
        `
        : `
            <span class="gcdg-about-icon" aria-hidden="true">
                <i class="${item.icon}"></i>
            </span>
        `;

    return `
        <div class="gcdg-about-row">
            <div class="gcdg-about-main">
                <div class="gcdg-about-label">${item.label}</div>
                <div class="gcdg-about-value">${item.value}</div>
            </div>
            ${action}
        </div>
    `;
}

function buildAboutRoot() {
    return $(`
        <section class="gcdg-about-sheet">
            <header class="gcdg-about-hero">
                <div class="gcdg-about-title">关于</div>
                <div class="gcdg-about-subtitle">咕咕助手 - 聊天草稿守护</div>
                <div class="gcdg-about-note">浏览器本地草稿兜底层</div>
            </header>

            <section class="gcdg-about-card">
                <div class="gcdg-section-title">项目信息</div>
                <div class="gcdg-about-grid">
                    ${ABOUT_LINKS.map(renderAboutRow).join('')}
                </div>
            </section>

            <section class="gcdg-about-card">
                <div class="gcdg-section-title">开源协议</div>
                <div class="gcdg-about-license">AGPL-3.0-or-later</div>
                <div class="gcdg-about-note">
                    你可以免费使用、修改和分发本项目；公开分发修改版或以网络服务形式提供时，需要继续提供对应源码与协议文本。
                </div>
            </section>

            <footer class="gcdg-about-toolbar">
                <button type="button" class="menu_button gcdg-preview-action" data-about-action="close">关闭</button>
            </footer>
        </section>
    `);
}

export async function showAboutPopup() {
    const context = SillyTavern.getContext();
    const root = buildAboutRoot();
    const popup = new context.Popup(root, context.POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: false,
        large: false,
        allowVerticalScrolling: true,
        leftAlign: true,
        onOpen: (instance) => {
            instance.dlg.classList.add('gcdg-about-popup');
        },
    });

    root.on('click', '[data-about-url]', function () {
        const url = $(this).attr('data-about-url');
        if (!url) {
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    });

    root.on('click', '[data-about-action="close"]', async () => {
        await popup.complete(context.POPUP_RESULT.CANCELLED);
    });

    await popup.show();
}
