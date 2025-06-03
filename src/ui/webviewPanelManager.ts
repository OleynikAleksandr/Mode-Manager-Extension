import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
// Roo: Removed ArchiveLoader import as it's no longer used
import { handleApplyModeChanges } from '../core/workspaceModifier'; // Adjusted import path
// Roo: Removed generateRooModesListFile import as it's no longer used

// Roo: Removed HandleLoadRooCommanderArchiveFunction type
// Roo: Removed GenerateRooModesListFileFunction type

let currentWebviewPanel: vscode.WebviewPanel | undefined;

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const htmlFilePath = vscode.Uri.joinPath(context.extensionUri, 'out', 'ui_dist', 'index.html');
    let htmlContent = fs.readFileSync(htmlFilePath.fsPath, 'utf8');
    const nonce = getNonce();

    // CSP: разрешаем стили и скрипты из webview.cspSource (что включает наши localResourceRoots),
    // а также 'unsafe-inline' для стилей, если они будут инлайновыми (Vite может так делать для мелких стилей).
    // Для скриптов используем nonce для основного бандла Vite.
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src ${webview.cspSource};`;
    console.log("Generated CSP for Vite:", csp);

    htmlContent = htmlContent.replace(
        '<head>',
        `<head>
    <meta http-equiv="Content-Security-Policy" content="${csp}">`
    );

    // Vite генерирует пути к ресурсам относительно index.html.
    // Мы должны преобразовать их в webview URI.
    // Пример: <script type="module" crossorigin src="/assets/index-CD74b8Vz.js"></script>
    //         <link rel="stylesheet" crossorigin href="/assets/index-D_UVv7S-.css">
    // Обработаем <script> и <link> теги, которые Vite вставляет.

    // Обновленное регулярное выражение для обработки путей, начинающихся с / или ./
    htmlContent = htmlContent.replace(/(src|href)="(\.?\/assets\/[^"]+)"/g, (match, attr, assetPathWithDot) => {
        // Удаляем начальную точку, если она есть, чтобы получить чистый путь относительно ui_dist
        const cleanAssetPath = assetPathWithDot.startsWith('./') ? assetPathWithDot.substring(2) : assetPathWithDot;
        const assetDiskPath = vscode.Uri.joinPath(context.extensionUri, 'out', 'ui_dist', cleanAssetPath);
        const assetWebviewUri = webview.asWebviewUri(assetDiskPath);
        console.log(`Replacing asset path: Original: ${assetPathWithDot}, Cleaned: ${cleanAssetPath}, Webview URI: ${assetWebviewUri.toString()}`); // Добавим лог
        return `${attr}="${assetWebviewUri.toString()}"`;
    });

    // Добавляем nonce к главному скрипту Vite (который обычно имеет type="module")
    // Ищем <script type="module" src="..."></script>
    htmlContent = htmlContent.replace(
        /(<script type="module"[^>]*src="[^"]*")>/g,
        `$1 nonce="${nonce}">`
    );

    return htmlContent;
}

export async function createAndShowWebviewPanel(
    context: vscode.ExtensionContext
    // Roo: Removed archiveLoaderInstance parameter
    // Roo: Removed handleLoadRooCommanderArchive parameter
    // generateRooModesListFile is now imported directly
    // handleApplyModeChanges is imported directly
) {
    console.log('Mode-Manager-Extension (webviewPanelManager): createAndShowWebviewPanel called.');
    const storagePath = context.globalStorageUri.fsPath;
    const column = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;

    if (currentWebviewPanel) {
        currentWebviewPanel.reveal(column);
        return;
    }

    currentWebviewPanel = vscode.window.createWebviewPanel(
        'modeManagerView',
        'Roo Code Mode Management',
        column || vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'out', 'ui_dist')
            ]
        }
    );

    currentWebviewPanel.webview.html = getWebviewContent(context, currentWebviewPanel.webview);

    // Initial data will be loaded by App.tsx sending 'requestStacksList' after 'webviewReady'
    // No need to call loadAndSendData here anymore.

    // Handle messages from the webview
    currentWebviewPanel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'applyModeChanges':
                    console.log('Mode-Manager-Extension (webviewPanelManager): Received mode changes:', message.selectedModes);
                    await handleApplyModeChanges(context, message.selectedModes, currentWebviewPanel);
                    return;
                case 'cancelModeChanges':
                    console.log('Mode-Manager-Extension (webviewPanelManager): Mode changes cancelled. Closing panel.');
                    if (currentWebviewPanel) {
                        currentWebviewPanel.dispose();
                    }
                    return;
                case 'webviewReady':
                    console.log('Mode-Manager-Extension (webviewPanelManager): Webview is ready to receive data.');
                    // App.tsx will now send 'requestStacksList' to trigger initial data load.
                    return;
                case 'requestStacksList':
                    console.log(`Mode-Manager-Extension (webviewPanelManager): Received request for stacks list in language: ${message.lang}`);
                    try {
                        const lang = message.lang === 'ru' ? 'ru' : message.lang === 'ua' ? 'ua' : 'en'; // Sanitize lang
                        const requestedStacksFileName = `stacks_by_framework_${lang}.md`;
                        // Stacks files are in extensionPath/roo-commander, not globalStorageUri
                        const requestedStacksFilePath = path.join(context.extensionPath, 'roo-commander', requestedStacksFileName);

                        let initiallySelectedModesOrdered: Array<{ slug: string, order: number }> = [];
                        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
                            const workspaceRoomodesPath = path.join(workspaceRoot, '.roomodes');
                            if (await fs.pathExists(workspaceRoomodesPath)) {
                                try {
                                    const roomodesFileContent = await fs.readFile(workspaceRoomodesPath, 'utf-8');
                                    const parsedRoomodes = JSON.parse(roomodesFileContent);
                                    if (parsedRoomodes && Array.isArray(parsedRoomodes.customModes)) {
                                        initiallySelectedModesOrdered = parsedRoomodes.customModes
                                            .map((mode: any, index: number) => {
                                                if (mode && typeof mode.slug === 'string') {
                                                    return { slug: mode.slug, order: index };
                                                }
                                                return null;
                                            })
                                            .filter((item: { slug: string, order: number } | null): item is { slug: string, order: number } => item !== null);
                                        console.log(`Mode-Manager-Extension (webviewPanelManager - requestStacksList): Loaded modes with order from ${workspaceRoomodesPath}:`, initiallySelectedModesOrdered);
                                    }
                                } catch (err) {
                                    console.error(`Mode-Manager-Extension (webviewPanelManager - requestStacksList): Error reading or parsing ${workspaceRoomodesPath}:`, err);
                                }
                            }
                        }

                        if (await fs.pathExists(requestedStacksFilePath)) {
                            const stacksContent = await fs.readFile(requestedStacksFilePath, 'utf-8');
                            currentWebviewPanel?.webview.postMessage({
                                command: 'loadStacks',
                                data: stacksContent,
                                selectedModesOrdered: initiallySelectedModesOrdered, // Send initial selection state
                                language: lang
                            });
                        } else {
                            console.error(`Mode-Manager-Extension (webviewPanelManager): File ${requestedStacksFileName} not found at path: ${requestedStacksFilePath}`);
                            currentWebviewPanel?.webview.postMessage({
                                command: 'loadStacksError',
                                message: `Failed to load stacks list (${requestedStacksFileName} not found).`
                            });
                        }
                    } catch (e: any) {
                        console.error(`Mode-Manager-Extension (webviewPanelManager): Error reading ${message.lang} stacks file:`, e);
                        currentWebviewPanel?.webview.postMessage({
                            command: 'loadStacksError',
                            message: `Error reading stacks file for language ${message.lang}.`
                        });
                    }
                    return;
            }
        },
        undefined,
        context.subscriptions
    );

    // Handle panel visibility changes
    currentWebviewPanel.onDidChangeViewState(
        async e => {
            const panel = e.webviewPanel;
            if (panel.visible) {
                console.log('Mode-Manager-Extension (webviewPanelManager): Panel became visible. App.tsx should request data if needed.');
                // No longer call loadAndSendData. App.tsx will send 'requestStacksList'
                // if it determines it needs to reload data (e.g., if its state is empty or stale).
            }
        },
        null,
        context.subscriptions
    );

    currentWebviewPanel.onDidDispose(
        () => {
            currentWebviewPanel = undefined;
        },
        null,
        context.subscriptions
    );
}

// loadAndSendData function is now removed.

export function disposeCurrentWebviewPanel() {
    if (currentWebviewPanel) {
        currentWebviewPanel.dispose();
        currentWebviewPanel = undefined;
    }
}

export function isWebviewPanelVisible(): boolean {
    return !!currentWebviewPanel;
}