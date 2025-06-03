// Main VS Code extension file for Mode-Manager.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra'; // Using fs-extra for file operation convenience
import { initializeModeManagerLogic } from './index'; // Import ModeManager initialization logic
// Roo: Removed ArchiveLoader import
// import { registerCommands } from './commands'; // Uncomment when commands are ready
import { handleApplyModeChanges } from './core/workspaceModifier'; // Added import
import { createAndShowWebviewPanel, disposeCurrentWebviewPanel } from './ui/webviewPanelManager'; // Roo: Added new imports
// Roo: Removed generateRooModesListFile import as it's no longer used
import { ActivityBarViewProvider } from './ui/activityBarViewProvider'; // New import

// Roo: Removed archiveLoaderInstance

/**
 * This function is called when your extension is activated.
 * Activation occurs according to the events defined in package.json (activationEvents).
 * @param context The extension context provided by VS Code.
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Mode-Manager-Extension: Extension "mode-manager-extension" is activating...');

    try {
        const extensionGlobalStoragePath = context.globalStorageUri.fsPath;
        console.log(`Mode-Manager-Extension: Using VS Code provided globalStorageUri.fsPath for extension storage: ${extensionGlobalStoragePath}`);

        try {
            await fs.ensureDir(extensionGlobalStoragePath);
            console.log(`Mode-Manager-Extension: Successfully ensured base global storage directory exists at: ${extensionGlobalStoragePath}`);
        } catch (storageError) {
            console.error(`Mode-Manager-Extension: Error ensuring or writing to global storage directory at ${extensionGlobalStoragePath}:`, storageError);
            vscode.window.showErrorMessage(`Mode-Manager: Failed to create or access extension storage path. See console for details. Path: ${extensionGlobalStoragePath}`);
        }
        // Roo: New logic to handle embedded roo-commander components
        const sourceCommanderPath = path.join(context.extensionPath, 'roo-commander');
        const targetRooPath = path.join(extensionGlobalStoragePath, '.roo');
        const targetRuruPath = path.join(extensionGlobalStoragePath, '.ruru');
        const targetRoomodesPath = path.join(extensionGlobalStoragePath, '.roomodes');
        // Roo: Paths for mode list files (roo_modes_list_*.md) are removed as they are no longer copied.

        const sourceRooPath = path.join(sourceCommanderPath, '.roo');
        const sourceRuruPath = path.join(sourceCommanderPath, '.ruru');
        const sourceRoomodesPath = path.join(sourceCommanderPath, '.roomodes');
        // Roo: Source paths for mode list files (roo_modes_list_*.md) are removed.


        try {
            // Check if core components exist in global storage
            const rooComponentsExist = await fs.pathExists(targetRoomodesPath) &&
                await fs.pathExists(targetRooPath) &&
                await fs.pathExists(targetRuruPath);
            // Roo: modeListFilesExist check is removed.

            if (!rooComponentsExist) { // Only check for Roo components now
                console.log('Mode-Manager-Extension: Core Roo Commander components not found in globalStorage. Copying from extension bundle...');

                // Ensure source paths exist for core components
                if (!await fs.pathExists(sourceCommanderPath)) {
                    throw new Error(`Source roo-commander directory not found at ${sourceCommanderPath}. Cannot initialize components.`);
                }
                if (!await fs.pathExists(sourceRooPath)) {
                    throw new Error(`Source .roo directory not found at ${sourceRooPath}.`);
                }
                if (!await fs.pathExists(sourceRuruPath)) {
                    throw new Error(`Source .ruru directory not found at ${sourceRuruPath}.`);
                }
                if (!await fs.pathExists(sourceRoomodesPath)) {
                    throw new Error(`Source .roomodes file not found at ${sourceRoomodesPath}.`);
                }
                // Roo: Checks for source mode list files are removed.

                // Clear any partial old state in global storage before copying Roo components
                console.log('Mode-Manager-Extension: Clearing and copying Roo components...');
                if (await fs.pathExists(targetRooPath)) await fs.remove(targetRooPath);
                if (await fs.pathExists(targetRuruPath)) await fs.remove(targetRuruPath);
                if (await fs.pathExists(targetRoomodesPath)) await fs.remove(targetRoomodesPath);

                await fs.copy(sourceRooPath, targetRooPath);
                console.log(`Mode-Manager-Extension: Copied .roo to ${targetRooPath}`);
                await fs.copy(sourceRuruPath, targetRuruPath);
                console.log(`Mode-Manager-Extension: Copied .ruru to ${targetRuruPath}`);
                await fs.copy(sourceRoomodesPath, targetRoomodesPath);
                console.log(`Mode-Manager-Extension: Copied .roomodes to ${targetRoomodesPath}`);
                
                vscode.window.showInformationMessage('Mode Manager: Roo Commander components initialized/updated from extension bundle.');
            } else {
                console.log('Mode-Manager-Extension: Core Roo Commander components found in globalStorage.');
            }

            // Always update globalState with the paths for Roo components
            await context.globalState.update('rooCommander_rooPath', targetRooPath);
            await context.globalState.update('rooCommander_ruruPath', targetRuruPath);
            await context.globalState.update('rooCommander_roomodesPath', targetRoomodesPath);
            // Roo: globalState updates for roo_modes_list_*.md paths are removed.
            console.log('Mode-Manager-Extension: Paths to Roo Commander components in globalStorage saved to globalState.');

            // Roo: Removed generation and copying logic for roo_modes_list_*.md files.
            // Stacks_by_framework_*.md files are part of the extension bundle and read directly, not copied.

        } catch (error: any) {
            console.error('Mode-Manager-Extension: Error initializing Roo Commander components from extension bundle:', error);
            vscode.window.showErrorMessage(`Mode-Manager: Failed to initialize Roo Commander components. ${error.message}`);
            // If components fail to initialize, further extension functionality might be compromised.
            // Depending on the severity, we might choose to prevent further activation steps.
            // For now, we log the error and let activation proceed, other parts might fail gracefully.
        }
        // End Roo: New logic

        const modeManagerInstance = await initializeModeManagerLogic();
        console.log('Mode-Manager-Extension: ModeManager initialized successfully.', modeManagerInstance.getModes());

        // Roo: Removed archiveLoaderInstance initialization and loadArchiveUserCommand
        // The logic for loading archives is being removed. Components are now bundled.

        let disposable = vscode.commands.registerCommand('mode-manager-extension.helloWorld', () => {
            vscode.window.showInformationMessage('Hello from Mode Manager Extension!');
        });
        context.subscriptions.push(disposable);

        const openModesViewCommand = vscode.commands.registerCommand('mode-manager-extension.openPanel', async () => {
            await createAndShowWebviewPanel(
                context
                // Roo: archiveLoaderInstance argument removed
                // Roo: handleLoadRooCommanderArchive argument removed
                // generateRooModesListFile is now directly used by webviewPanelManager or called separately
            );
        });
        context.subscriptions.push(openModesViewCommand);

        // Register the ActivityBarViewProvider
        const activityBarProvider = new ActivityBarViewProvider(context.extensionUri);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(ActivityBarViewProvider.viewType, activityBarProvider)
        );

        vscode.window.showInformationMessage('Mode Manager Extension activated successfully!');
        console.log('Mode-Manager-Extension: Extension "mode-manager-extension" activated successfully.');

    } catch (error) {
        console.error('Mode-Manager-Extension: Error during extension activation:', error);
        vscode.window.showErrorMessage('Error activating Mode Manager Extension. See console for details.');
    }
}

export function deactivate() {
    console.log('Mode-Manager-Extension: Extension "mode-manager-extension" is deactivating.');
    disposeCurrentWebviewPanel();
}

// Roo: Functions createModesViewPanel, getWebviewContent, and getNonce
// have been moved to ui/webviewPanelManager.ts

// Function handleApplyModeChanges has been moved to core/workspaceModifier.ts

// Roo: Function handleLoadRooCommanderArchive removed as archive loading functionality is deprecated.

// Roo: Function generateRooModesListFile was removed as it's no longer used.

// Function to encapsulate data loading and sending logic (if needed to call from multiple places)
/*
async function loadAndSendDataToWebview(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
    try {
        let actualModesFilePath = '';
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            actualModesFilePath = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'roo_modes_list.md').fsPath;
        } else {
            actualModesFilePath = path.join(context.extensionPath, '..', 'roo_modes_list.md'); // Less reliable path
        }

        if (await fs.pathExists(actualModesFilePath)) { // Changed to async
            const modesContent = await fs.readFile(actualModesFilePath, 'utf-8'); // Changed to async
            // Assume initially selected modes are stored or retrieved somewhere
            const initiallySelectedIds: string[] = []; // TODO: Load saved selected modes
            panel.webview.postMessage({ command: 'loadModes', data: modesContent, selected: initiallySelectedIds });
        } else {
            console.error(`Mode-Manager-Extension: File roo_modes_list.md not found at path: ${actualModesFilePath}`);
            panel.webview.postMessage({ command: 'loadModesError', message: 'Failed to load mode list (file not found).' });
        }
    } catch (e: any) {
        console.error('Mode-Manager-Extension: Error reading roo_modes_list.md:', e);
        panel.webview.postMessage({ command: 'loadModesError', message: 'Error reading mode list file.' });
    }
}
*/