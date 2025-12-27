import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { GoalDebugAdapterDescriptorFactoryV2 } from './GoalDebugAdapterDescriptorFactoryV2';
import { PathHelper } from '../PathHelper';

export class StartDebuggerV2 {
    private debugFactory: GoalDebugAdapterDescriptorFactoryV2;
    private context: vscode.ExtensionContext;
    private lastRuntimeValue: string | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.debugFactory = new GoalDebugAdapterDescriptorFactoryV2();

        // Register the V2 debug adapter with a new debug type
        context.subscriptions.push(
            vscode.debug.registerDebugAdapterDescriptorFactory('goal-v2', this.debugFactory)
        );
    }

    public getDebugFactory(): GoalDebugAdapterDescriptorFactoryV2 {
        return this.debugFactory;
    }

    /**
     * Start a V2 debug session
     */
    public async start(fileName: string | null = null, csdebug: boolean = false): Promise<void> {
        // If already debugging, continue
        if (vscode.debug.activeDebugSession?.type === 'goal-v2') {
            vscode.commands.executeCommand('workbench.action.debug.continue');
            return;
        }

        // Get workspace folder
        const editor = vscode.window.activeTextEditor;
        const folderPath = PathHelper.getRootPath(editor?.document.fileName);

        if (!folderPath) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        // Prompt for parameters
        let startFile = fileName || 'Start';
        if (fileName) {
            this.lastRuntimeValue = fileName;
        }

        const command = await vscode.window.showInputBox({
            prompt: "Enter parameters (optional). Press Enter to start debugging.",
            placeHolder: "(Optional) goal file or parameters",
            value: this.lastRuntimeValue
        });

        if (command === undefined) {
            return; // User cancelled
        }

        this.lastRuntimeValue = command;

        // Parse command for start file
        if (command.trim()) {
            const parts = command.trim().split(/\s+/);
            const goalFile = parts.find(p => p.endsWith('.goal') || !p.includes('='));
            if (goalFile && !goalFile.includes('=')) {
                startFile = goalFile;
            }
        }

        // Get current breakpoints as PrPaths
        const breakpoints = this.getBreakpointsForWorkspace(folderPath);

        // Create debug configuration
        const debugConfiguration: vscode.DebugConfiguration = {
            type: 'goal-v2',
            name: 'PLang Debug V2',
            request: 'launch',
            cwd: folderPath,
            goalPath: startFile,
            breakpoints: breakpoints
        };

        // Start debugging
        const workspaceFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(folderPath),
            name: path.basename(folderPath),
            index: 0
        };

        await vscode.debug.startDebugging(workspaceFolder, debugConfiguration);
    }

    /**
     * Get all breakpoints for the workspace as PrPaths
     */
    private getBreakpointsForWorkspace(workspacePath: string): string[] {
        const prPaths: string[] = [];
        const breakpoints = vscode.debug.breakpoints;

        for (const bp of breakpoints) {
            if (bp instanceof vscode.SourceBreakpoint && bp.enabled) {
                const filePath = bp.location.uri.fsPath;

                // Only include breakpoints within this workspace
                if (filePath.startsWith(workspacePath)) {
                    const lineNumber = bp.location.range.start.line + 1;
                    const prPath = this.convertToPrPath(workspacePath, filePath, lineNumber);
                    if (prPath) {
                        prPaths.push(prPath);
                    }
                }
            }
        }

        return prPaths;
    }

    /**
     * Convert a goal file path and line number to a .pr file path
     */
    private convertToPrPath(workspacePath: string, goalFilePath: string, lineNumber: number): string | null {
        try {
            // Get relative path from workspace
            const relativePath = path.relative(workspacePath, goalFilePath);

            // Remove .goal extension
            const basePath = relativePath.replace(/\.goal$/, '');

            // Build path would be .build/<basePath>/
            const buildFolder = path.join(workspacePath, '.build', basePath);

            if (!fs.existsSync(buildFolder)) {
                return null;
            }

            // Read the goal file to find which step is at this line
            const goalContent = fs.readFileSync(goalFilePath, 'utf8');
            const lines = goalContent.split('\n');

            // Find the step at this line number
            let stepIndex = 0;
            for (let i = 0; i < lineNumber && i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('-')) {
                    stepIndex++;
                }
            }

            if (stepIndex === 0) {
                return null; // Not on a step line
            }

            // Format step number as two digits
            const stepNumber = stepIndex.toString().padStart(2, '0');

            // The .pr file path
            const prFileName = `${stepNumber}. *.pr`;

            // Find the actual .pr file
            const files = fs.readdirSync(buildFolder);
            const prFile = files.find(f => f.startsWith(`${stepNumber}.`) && f.endsWith('.pr'));

            if (prFile) {
                return path.join('.build', basePath, prFile);
            }

            return null;
        } catch (e) {
            console.error('Error converting to PrPath:', e);
            return null;
        }
    }
}

/**
 * Register the V2 debug type in package.json contribution
 * Add this to your package.json:
 * 
 * "contributes": {
 *   "debuggers": [
 *     {
 *       "type": "goal-v2",
 *       "label": "PLang Debug V2",
 *       "program": "./out/DebugAdapterV2.js",
 *       "runtime": "node",
 *       "configurationAttributes": {
 *         "launch": {
 *           "required": [],
 *           "properties": {
 *             "goalPath": {
 *               "type": "string",
 *               "description": "Goal file to debug",
 *               "default": "Start"
 *             },
 *             "cwd": {
 *               "type": "string",
 *               "description": "Working directory"
 *             },
 *             "breakpoints": {
 *               "type": "array",
 *               "description": "Initial breakpoints as PrPaths"
 *             }
 *           }
 *         }
 *       },
 *       "initialConfigurations": [
 *         {
 *           "type": "goal-v2",
 *           "request": "launch",
 *           "name": "PLang Debug V2"
 *         }
 *       ]
 *     }
 *   ]
 * }
 */