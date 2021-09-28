// region vars
const REQUEST_TABLE_WRAPPER = document.getElementById('requestTableWrapper');
const BTN_CLEAR_REQUESTS = document.getElementById('btnClearRequests');
const REPEAT_REQUEST_DIALOG = document.getElementById('repeatRequestDialog');
const repeatRequestDialogUrl = document.getElementById('repeatRequestDialogUrl');
const repeatRequestDialogMethod = document.getElementById('repeatRequestDialogMethod');
const repeatRequestDialog = document.getElementById('repeatRequestDialog');
const BLOCK_TAB = chrome.devtools.panels.themeName !== 'dark';
const { getMessage } = chrome.i18n;
const MOUSE_POSITION = {
    x: 0,
    y: 0
};
const menuItemMapping = {
    '1': 'repeatRequest'
}
// endregion

// region init
    chrome.contextMenus.onClicked.addListener((info) => {
        switch (menuItemMapping[info.menuItemId]) {
            case 'repeatRequest': (() => {
                    const entry = document.elementFromPoint(MOUSE_POSITION.x, MOUSE_POSITION.y)?.closest('tr');

                    if (!entry) {
                        return;
                    }

                    const data = JSON.parse(entry.dataset.request);

                    openRepeatRequestDialog(data);
                })();
                break;
            default:
                return;
        }
    })
    chrome.devtools.network.onRequestFinished.addListener(appendRequest);
    chrome.devtools.network.onNavigated.addListener(clearRequests);
    BTN_CLEAR_REQUESTS.addEventListener('click', clearRequests.bind(null, true));

    const COLUMNS = [
        {
            name: "Name",
            hidden: false,
            data: row => row.request.url,
            render: cell => {
                if (!cell) {
                    return null;
                }

                const url = new URL(cell);
                const pathParts = url.pathname.split('/').filter(x => x !== '');


                if (url.href.startsWith('data:')) {
                    return cell;
                }

                if (url.pathname === '/') {
                    return url.host;
                }

                return pathParts[pathParts.length -1] + url.search;
            },
            tooltip: row => row.request.url,
            onDbClick: requestData => repeatRequest(requestData)
        },
        {
            name: "Path",
            hidden: true,
            data: row => row.request?.url ? new URL(row.request.url).pathname : null
        },
        {
            name: "URL",
            hidden: true,
            data: row => row.request?.url
        },
        {
            name: "Method",
            hidden: false,
            data: row => row.request?.method
        },
        {
            name: "Status",
            hidden: false,
            data: row => row,
            tooltip: row => (row.response?.status && row.response?.status !== 0) ? STATUS_CODE[row.response?.status] : null,
            render: cell => {
                if (cell.timings.connect === -1 && cell.response.status === 0) {
                    return '(failed)';
                }

                if (cell.response._error) {
                    return '(blocked)';
                }

                if (cell.response.status === 0) {
                    return '(blocked: DevTools)';
                }

                return cell.response?.status;
            }
        },
        {
            name: "Protocol",
            hidden: true,
            data: row => 'TBD'
        },
        {
            name: "Scheme",
            hidden: true,
            data: row => row.request?.url ? new URL(row.request.url).protocol.slice(0, -1) : null
        },
        {
            name: "Domain",
            hidden: true,
            data: row => row.request?.url ? new URL(row.request.url).host : null
        },
        {
            name: "Remote address",
            hidden: true,
            data: row => row.serverIPAddress
        },
        {
            name: "Remote address space",
            hidden: true,
            data: row => 'TBD'
        },
        {
            name: "Type",
            hidden: false,
            data: row => row._resourceType
        },
        {
            name: "Initiator",
            hidden: false,
            data: row => row?._initiator?.type,
            render: cell => {
                if (cell === 'other') {
                    return `<span class="network-table-subtle">Other</span>`;
                }

                return cell;
            }
        },
        {
            name: "Initiator address space",
            hidden: true,
            data: row => 'TBD (e.g. PUBLIC)'
        },
        {
            name: "Cookies",
            hidden: true,
            data: row => row?.response?.cookies?.length ?? null
        },
        {
            name: "Set cookies",
            hidden: true,
            data: row => 'TBD'
        },
        {
            name: "Size",
            hidden: false,
            data: row => row,
            render: cell => getFormattedSize(cell),
        },
        {
            name: "Time",
            hidden: false,
            data: row => Math.round(row.time - row.timings?._blocked_queueing),
            render: cell => getFormattedTime(cell),
        },
        {
            name: "Priority",
            hidden: true,
            data: row => row._priority
        },
        {
            name: "Connection Id",
            hidden: true,
            data: row => row.connection
        }
    ];
    const VISIBLE_COLUMNS_COUNT = COLUMNS.filter(column => !column.hidden).length;

    document.documentElement.style.setProperty('--visible-column-count', VISIBLE_COLUMNS_COUNT.toString());
    const REQUEST_TABLE = new RequestTable(REQUEST_TABLE_WRAPPER, COLUMNS);

    initContextMenuListener();
    initRepeatRequestDialog();
// endregion

function initContextMenuListener() {
    REQUEST_TABLE.getTableBody().addEventListener('mouseenter', () => {
        chrome.contextMenus.update('1', { visible: true });
        chrome.contextMenus.update('2', { visible: true });
    });

    REQUEST_TABLE.getTableBody().addEventListener('mouseleave', () => {
        chrome.contextMenus.update('1', { visible: false });
        chrome.contextMenus.update('2', { visible: false });
    });
    document.addEventListener('mousemove', e => {
        MOUSE_POSITION.x = e.x;
        MOUSE_POSITION.y = e.y;
    })
}


// region utils
function appendRequest(requestData) {
    REQUEST_TABLE.addRequest(requestData);
}

function clearRequests(forceClear=false) {
    if (forceClear || localStorage.getItem('preserveLog') === 'false') {
        REQUEST_TABLE.clearEntries();
    }
}

async function repeatRequest(requestData) {
    const { method, url, headers } = requestData.request;
    const preparedHeaders = Object.fromEntries(headers.filter(x => !x.name.startsWith(':')).map(x => [x.name, x.value]));
    const modifiedRequestData = {
        ...requestData,
        _initiator: {
            type: `
                <abbr
                    class="network-table-initiator"
                    title="${getMessage('extensionName')}"
                >
                    ${getMessage('extensionShortName')}
                </abbr>
            `
        },
        time: -1,
        timings: {
            blocked: 0,
            dns: -1,
            ssl: -1,
            connect: -1,
            send: 0,
            wait: 0,
            receive: 0,
            _blocked_queueing: 0
        }
    }

    REQUEST_TABLE.addRequest(modifiedRequestData);
    await fetch(url, {
        method,
        headers: preparedHeaders
    });
}

function initRepeatRequestDialog() {
    const repeatRequestCloseBtn = document.querySelector('.dialog-close');
    const repeatRequestPanelHeader = document.querySelector('.repeatRequestPanelHeader');
    const repeatRequestPanel = document.querySelector('.repeatRequestPanel');
    const availableMethods = [ 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'COPY', 'HEAD', 'OPTIONS', 'LINK', 'UNLINK', 'PURGE', 'LOCK', 'UNLOCK', 'PROPFIND', 'VIEW' ];
    const availablePanels = [ 'Params', 'Authorization', 'Headers', 'Body' ];

    repeatRequestCloseBtn.addEventListener('click', () => repeatRequestDialog.close());

    repeatRequestDialogUrl.setAttribute('placeholder', getMessage('repeatRequestDialogUrl'));

    availableMethods.forEach(method => {
        const option = document.createElement('option');
        option.value = method;
        option.textContent = method;

        repeatRequestDialogMethod.appendChild(option);
    });

    availablePanels.forEach(panel => {
        const button = document.createElement('button');
        button.textContent = getMessage(`repeatRequestDialogPanel${panel}`);
        button.classList.add('repeatRequestPanelDialogPanelButton');

        if (panel === 'Params') {
            button.classList.add('is-active');
            document.querySelector('div[data-panel-id="Params"]').classList.add('is-active');
        }

        button.addEventListener('click', () => {
            document.querySelector('.repeatRequestPanelDialogPanelButton.is-active').classList.remove('is-active');
            button.classList.add('is-active');
            document.querySelector('div[data-panel-id].is-active').classList.remove('is-active');
            document.querySelector(`div[data-panel-id="${panel}"]`).classList.add('is-active');
        });

        repeatRequestPanelHeader.appendChild(button);
    });
}

function openRepeatRequestDialog(requestData) {
    const headerPanel = repeatRequestDialog.querySelector('div[data-panel-id="Headers"] tbody');

    repeatRequestDialogMethod.value = requestData?.request?.method;
    repeatRequestDialogUrl.value = requestData?.request?.url ?? '';
    requestData.request.headers.filter(x => !x.name.startsWith(':')).forEach(header => {
        createInputTableEntry('Headers', header.name, header.value);
    })
    REPEAT_REQUEST_DIALOG.showModal();
}

function createInputTableEntry(panelId, key, value) {
    const tableBody = document.querySelector(`div[data-panel-id="${panelId}"] tbody`);
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>
            <input
                type="text"
                value="${key}"
                spellcheck="false"
            >
        </td>
        <td>
            <input
            type="text"
            value="${value}"
            spellcheck="false"
            >
        </td>
    `;

    tableBody.appendChild(tr);
}

// endregion