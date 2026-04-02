const MOBILE_STATUS_QUERY = '(max-width: 560px)';
const MOBILE_STATUS_MARGIN_PX = 12;
const MOBILE_STATUS_MIN_TOP_PX = 8;
const MOBILE_STATUS_DEFAULT_BOTTOM_OFFSET_PX = 86;

function ensureRoot() {
    let root = document.querySelector('.gcdg-global-status');
    if (root) {
        return root;
    }

    root = document.createElement('section');
    root.className = 'gcdg-global-status';
    root.innerHTML = `
        <div class='gcdg-global-status-shell'>
            <div class='gcdg-global-status-head'>
                <span class='gcdg-global-status-kicker'>聊天草稿恢复</span>
                <div class='gcdg-global-status-title'></div>
            </div>
            <div class='gcdg-global-status-progress'>
                <div class='gcdg-global-status-track'>
                    <span class='gcdg-global-status-fill'></span>
                </div>
                <div class='gcdg-global-status-progress-label'></div>
            </div>
            <div class='gcdg-global-status-actions'>
                <button type='button' class='menu_button gcdg-status-action gcdg-status-action-primary' data-action='retry'>重试</button>
                <button type='button' class='menu_button gcdg-status-action' data-action='export'>导出</button>
                <button type='button' class='menu_button gcdg-status-action' data-action='recover'>草稿</button>
            </div>
        </div>
    `;
    document.body.append(root);
    return root;
}

function parseRgbColor(value) {
    const matches = String(value).match(/\d+(\.\d+)?/g);
    if (!matches || matches.length < 3) {
        return null;
    }

    return matches.slice(0, 3).map(Number);
}

function getLuminance([red, green, blue]) {
    const channels = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function resolveThemeMode() {
    if (!document.body) {
        return 'dark';
    }

    const styles = getComputedStyle(document.body);
    const probe = document.createElement('span');
    probe.style.position = 'fixed';
    probe.style.opacity = '0';
    probe.style.pointerEvents = 'none';
    probe.style.color = styles.getPropertyValue('--SmartThemeBodyColor').trim() || styles.color;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();

    const rgb = parseRgbColor(resolved);
    if (!rgb) {
        return 'dark';
    }

    return getLuminance(rgb) >= 0.62 ? 'dark' : 'light';
}

function setButtonState(button, disabled) {
    if (!button) {
        return;
    }

    button.disabled = disabled;
    button.classList.toggle('disabled', disabled);
}

function isMobileStatusViewport() {
    return window.matchMedia(MOBILE_STATUS_QUERY).matches;
}

function resolveBottomOffsetPx() {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.bottom = 'calc(var(--bottomFormBlockSize, 76px) + env(safe-area-inset-bottom) + 10px)';
    probe.style.pointerEvents = 'none';
    probe.style.opacity = '0';
    document.body.append(probe);
    const bottom = Number.parseFloat(getComputedStyle(probe).bottom);
    probe.remove();
    return Number.isFinite(bottom) ? bottom : MOBILE_STATUS_DEFAULT_BOTTOM_OFFSET_PX;
}

function getViewportMetrics() {
    const viewport = window.visualViewport;
    return {
        height: viewport?.height ?? window.innerHeight,
        left: window.scrollX + (viewport?.offsetLeft ?? 0),
        top: window.scrollY + (viewport?.offsetTop ?? 0),
        width: viewport?.width ?? window.innerWidth,
    };
}

function updateRootPosition(root) {
    if (!root) {
        return;
    }

    if (!isMobileStatusViewport()) {
        root.style.position = '';
        root.style.left = '';
        root.style.top = '';
        root.style.right = '';
        root.style.bottom = '';
        return;
    }

    const viewport = getViewportMetrics();
    const bottomOffset = resolveBottomOffsetPx();
    const top = Math.max(
        viewport.top + MOBILE_STATUS_MIN_TOP_PX,
        viewport.top + viewport.height - bottomOffset - root.offsetHeight,
    );
    const left = Math.max(
        viewport.left + MOBILE_STATUS_MARGIN_PX,
        viewport.left + viewport.width - MOBILE_STATUS_MARGIN_PX - root.offsetWidth,
    );

    root.style.position = 'absolute';
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
}

export function createGlobalUnsavedStatus({ onExport, onRecover, onRetry }) {
    let root = null;
    let actionsBound = false;
    let positionBound = false;

    function handlePositionChange() {
        updateRootPosition(root);
    }

    function bindActions() {
        if (!root || actionsBound) {
            return;
        }

        root.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (!button) {
                return;
            }

            const action = button.getAttribute('data-action');
            if (action === 'retry') {
                onRetry();
            }

            if (action === 'export') {
                onExport();
            }

            if (action === 'recover') {
                onRecover();
            }
        });

        actionsBound = true;
    }

    function bindPosition() {
        if (positionBound) {
            return;
        }

        window.addEventListener('resize', handlePositionChange);
        window.addEventListener('scroll', handlePositionChange, { passive: true });
        window.visualViewport?.addEventListener('resize', handlePositionChange);
        window.visualViewport?.addEventListener('scroll', handlePositionChange);
        positionBound = true;
    }

    function unbindPosition() {
        if (!positionBound) {
            return;
        }

        window.removeEventListener('resize', handlePositionChange);
        window.removeEventListener('scroll', handlePositionChange);
        window.visualViewport?.removeEventListener('resize', handlePositionChange);
        window.visualViewport?.removeEventListener('scroll', handlePositionChange);
        positionBound = false;
    }

    return {
        render(model) {
            root = ensureRoot();
            bindActions();
            bindPosition();

            const themeMode = resolveThemeMode();
            root.className = `gcdg-global-status gcdg-theme-${themeMode} is-visible is-${model.variant}`;
            root.querySelector('.gcdg-global-status-title').textContent = model.title;
            root.querySelector('.gcdg-global-status-progress-label').textContent = model.progress?.label ?? '';
            const ratio = model.progress?.total
                ? Math.max(0, Math.min(1, model.progress.current / model.progress.total))
                : 0;
            root.querySelector('.gcdg-global-status-fill').style.setProperty('--gcdg-progress-ratio', String(ratio));
            updateRootPosition(root);

            setButtonState(root.querySelector('[data-action="retry"]'), !model.canRetry);
            setButtonState(root.querySelector('[data-action="export"]'), !model.canExport);
            setButtonState(root.querySelector('[data-action="recover"]'), !model.canRecover);
        },

        hide() {
            root = root ?? document.querySelector('.gcdg-global-status');
            if (!root) {
                return;
            }

            root.classList.remove('is-visible');
            updateRootPosition(root);
        },

        destroy() {
            root = root ?? document.querySelector('.gcdg-global-status');
            unbindPosition();
            if (!root) {
                return;
            }

            root.remove();
            root = null;
            actionsBound = false;
        },
    };
}
