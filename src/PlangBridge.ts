import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import {
    DebugSession,
    InitializedEvent,
    TerminatedEvent,
    StoppedEvent,
    ContinuedEvent,
    OutputEvent,
    Scope
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { PathHelper } from './PathHelper';

/**
 * GoalToCallInfo structure matching PLang's class
 */
interface GoalToCallInfo {
    Name: string;
    Parameters: Record<string, any>;
    Path?: string | undefined;
}

/**
 * Message from PLang IDE to TypeScript
 */
interface PlangOutMessage {
    type: 'execute' | 'text';
    method?: string;
    parameters?: any;
    callback?: GoalToCallInfo;
    content?: string;
    channel?: string;
}

/**
 * Message from TypeScript to PLang IDE
 */
interface PlangInMessage {
    type: 'call';
    goalToCall: GoalToCallInfo;
}

/**
 * Panel types
 */
type PanelType = 'code' | 'chat' | 'exec';

/**
 * PlangBridge - Thin bridge between VS Code and PLang IDE
 * 
 * Generic method mappings:
 * - ui.* → VS Code UI APIs
 * - debug.* → VS Code Debug Adapter Protocol
 * - editor.* → VS Code Editor APIs
 */
export class PlangBridge extends DebugSession {
    private static THREAD_ID = 1;

    // PLang IDE process
    private plangProcess?: child_process.ChildProcess;
    private readline?: readline.Interface;

    // Webview panels
    private panels: Map<PanelType, vscode.WebviewView> = new Map();

    // Debug state
    private isDebugging = false;

    // Decorations for debugging
    private debugHighlightDecorationType: vscode.TextEditorDecorationType;
    private errorDecorationType: vscode.TextEditorDecorationType;
    private diagnosticCollection = vscode.languages.createDiagnosticCollection('plang');

    constructor() {
        super();

        this.debugHighlightDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'yellow',
            color: 'black'
        });

        this.errorDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editorError.background'),
            color: 'black'
        });
    }

    /**
     * Start the PLang IDE process
     */
    public async start(): Promise<void> {
        const plangIdePath = path.join(PathHelper.PlangFolderPath, 'system');
        const plangPath = PathHelper.PlangExecutable;

        this.plangProcess = child_process.spawn(
            plangPath,
            ['p', '/tools/ide/StartIde', '!system.contentType=plang/jsonl', '!system.csdebug'],
            {
                cwd: plangIdePath,
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );

        // Set up readline for JSON line parsing
        this.readline = readline.createInterface({
            input: this.plangProcess.stdout!,
            crlfDelay: Infinity
        });

        // Handle incoming messages from PLang IDE
        this.readline.on('line', (line) => {
            this.handlePlangMessage(line);
        });

        // Handle stderr
        this.plangProcess.stderr?.on('data', (data) => {
            console.error('PLang IDE stderr:', data.toString());
        });

        // Handle process exit
        this.plangProcess.on('close', (code) => {
            console.log(`PLang IDE process exited with code ${code}`);
        });
    }

    /**
     * Register a webview panel
     */
    public registerPanel(type: PanelType, view: vscode.WebviewView): void {
        this.panels.set(type, view);

        // Set up message handling from webview
        view.webview.onDidReceiveMessage(message => {
            if (message.type === 'callGoal' && message.goalToCall) {
                this.callGoal(message.goalToCall);
            }
        });
    }

    
    public onLineSelected(editor: vscode.TextEditor, line: number) {
        const filePath = editor.document.uri.fsPath;
        const lineNumber = line + 1; // VS Code is 0-indexed, PLang is 1-indexed
        
        this.callGoal({Name: 'editor/LineSelected', Parameters: {
                filePath: filePath,
                lineNumber: lineNumber
            }} as GoalToCallInfo);
       
    }


    /**
     * Call a goal in PLang IDE
     */
    public callGoal(goalToCall: GoalToCallInfo): void {
        const message: PlangInMessage = {
            type: 'call',
            goalToCall
        };
        this.sendToPlang(message);
    }

    /**
     * Send message to PLang IDE via stdin
     */
    private sendToPlang(message: PlangInMessage): void {
        if (this.plangProcess?.stdin?.writable) {
            this.plangProcess.stdin.write(JSON.stringify(message) + '\n');
        }
    }

    /**
     * Handle incoming JSON line from PLang IDE
     */
    private handlePlangMessage(line: string): void {
        try {
            const message: PlangOutMessage = JSON.parse(line);

            if (message.type === 'execute') {
                this.handleExecuteMessage(message);
            } else if (message.type === 'text') {
                // Plain text output
                if (this.isDebugging) {
                    this.sendEvent(new OutputEvent(message.content + '\n', 'stdout'));
                }
            } else {
                console.log("Plang output", message);
                this.sendEvent(new OutputEvent(line + '\n', 'stdout'));

            }
        } catch (e) {
            // Not JSON, treat as plain text
            console.log('PLang output:', line);
        }
    }

    /**
     * Handle execute messages from PLang IDE
     * 
     * Generic method mapping:
     * - ui.renderPanel → render HTML in a panel
     * - ui.showMessage → show notification
     * - ui.showInput → show input dialog
     * - editor.open → open a file
     * - editor.highlight → highlight a line
     * - debug.* → debug adapter events
     */
    private async handleExecuteMessage(message: PlangOutMessage): Promise<void> {
        const { method, parameters, callback } = message;

        let result: any;
        let success = true;
        let error: string | undefined;

        try {
            // Parse method namespace
            const [namespace, action] = (method || '').split('.');

            switch (namespace) {
                case 'ui':
                    result = await this.handleUiMethod(action, parameters);
                    break;

                case 'editor':
                    result = await this.handleEditorMethod(action, parameters);
                    break;

                case 'debug':
                    result = await this.handleDebugMethod(action, parameters);
                    break;

                default:
                    console.warn('Unknown method namespace:', namespace);
            }
        } catch (e: any) {
            success = false;
            error = e.toString();
            console.error('Error executing method:', method, e);
        }

        // If callback specified, call the goal with result
        if (callback) {
            const goalToCall: GoalToCallInfo = {
                Name: callback.Name,
                Path: callback.Path,
                Parameters: {
                    ...callback.Parameters,
                    success,
                    result,
                    error
                }
            };
            this.callGoal(goalToCall);
        }
    }

    /**
     * Handle ui.* methods
     */
    private async handleUiMethod(action: string, parameters: any): Promise<any> {
        switch (action) {
            case 'renderPanel':
                return this.renderPanel(parameters.panel, parameters.html);

            case 'showMessage':
                return this.showMessage(parameters.type, parameters.message);

            case 'showInput':
                return vscode.window.showInputBox({
                    prompt: parameters.prompt,
                    placeHolder: parameters.placeholder,
                    value: parameters.value
                });

            case 'showQuickPick':
                return vscode.window.showQuickPick(parameters.items, {
                    placeHolder: parameters.placeholder
                });

            default:
                console.warn('Unknown ui action:', action);
        }
    }

    /**
     * Handle editor.* methods
     */
    private async handleEditorMethod(action: string, parameters: any): Promise<any> {
        switch (action) {
            case 'open':
                const doc = await vscode.workspace.openTextDocument(parameters.path);
                await vscode.window.showTextDocument(doc);
                return true;

            case 'highlight':
                await this.highlightLine(parameters.path, parameters.line);
                return true;

            case 'clearHighlight':
                this.clearDecorations();
                return true;

            case 'showError':
                await this.showError(parameters.path, parameters.line, parameters.error);
                return true;

            default:
                console.warn('Unknown editor action:', action);
        }
    }

    /**
     * Handle debug.* methods
     */
    private async handleDebugMethod(action: string, parameters: any): Promise<any> {
        switch (action) {
            case 'startSession':
                return vscode.debug.startDebugging(
                    parameters.workspaceFolder ? { uri: vscode.Uri.file(parameters.workspaceFolder) } as vscode.WorkspaceFolder : undefined,
                    parameters.config
                );

            case 'stopped':
                this.handleDebuggerStopped(parameters);
                break;

            case 'continued':
                this.handleDebuggerContinued();
                break;

            case 'terminated':
                this.handleDebuggerTerminated(parameters);
                break;

            case 'output':
                this.sendEvent(new OutputEvent(parameters.text + '\n', parameters.category || 'stdout'));
                break;

            case 'exception':
                await this.showError(parameters.path, parameters.line, parameters.error);
                break;

            case 'setVariables':
                this.currentMemoryStack = parameters.memoryStack;
                break;

            case 'setCallStack':
                this.currentCallStack = parameters.callStack;
                break;

            default:
                console.warn('Unknown debug action:', action);
        }
    }

    /**
     * Render HTML in a panel with PLang bridge injected
     */
    private renderPanel(panelType: PanelType, html: string): boolean {
        const panel = this.panels.get(panelType);
        if (!panel) {
            console.warn('Panel not registered:', panelType);
            return false;
        }

        // Inject the PLang bridge script
        const bridgeScript = this.getBridgeScript();
        const wrappedHtml = this.wrapHtmlWithBridge(html, bridgeScript);

        panel.webview.html = wrappedHtml;
        return true;
    }

    /**
     * Get the PLang bridge script to inject into webviews
     */
    private getBridgeScript(): string {
        return `
<script>
(function() {
    const vscode = acquireVsCodeApi();
    
    window.plang = {
        /**
         * Call a PLang goal
         * @param {string} name - Goal name
         * @param {object} parameters - Goal parameters
         * @param {string} path - Goal path (optional, defaults to name)
         */
        callGoal: function(name, parameters, path) {
            vscode.postMessage({
                type: 'callGoal',
                goalToCall: {
                    Name: name,
                    Parameters: parameters || {},
                    Path: path
                }
            });
        }
    };
})();
</script>
`;
    }

    /**
     * Wrap HTML with the bridge script
     */
    private wrapHtmlWithBridge(html: string, bridgeScript: string): string {
        // If HTML has <head>, inject there
        if (html.includes('<head>')) {
            return html.replace('<head>', '<head>' + bridgeScript);
        }
        // If HTML has <html>, inject after
        if (html.includes('<html>')) {
            return html.replace('<html>', '<html>' + bridgeScript);
        }
        // Otherwise prepend
        return bridgeScript + html;
    }

    /**
     * Show a message notification
     */
    private async showMessage(type: string, message: string): Promise<string | undefined> {
        switch (type) {
            case 'error':
                return vscode.window.showErrorMessage(message);
            case 'warning':
                return vscode.window.showWarningMessage(message);
            case 'info':
            default:
                return vscode.window.showInformationMessage(message);
        }
    }

    // ========== Debugger State ==========

    private currentMemoryStack: any = {};
    private currentCallStack: any[] = [];
    private variablesRefCache: Map<number, any> = new Map();
    private nextVariableRef = 1;

    private handleDebuggerStopped(parameters: any): void {
        this.isDebugging = true;
        if (parameters.path && parameters.line) {
            this.highlightLine(parameters.path, parameters.line);
        }
        this.sendEvent(new StoppedEvent(parameters.reason || 'breakpoint', PlangBridge.THREAD_ID));
    }

    private handleDebuggerContinued(): void {
        this.clearDecorations();
        this.sendEvent(new ContinuedEvent(PlangBridge.THREAD_ID));
    }

    private handleDebuggerTerminated(parameters: any): void {
        this.isDebugging = false;
        this.clearDecorations();
        this.sendEvent(new TerminatedEvent());
    }

    private async highlightLine(filePath: string, lineNumber: number): Promise<void> {
        if (!filePath) return;

        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(document);
            const line = document.lineAt(Math.max(0, lineNumber - 1));
            editor.revealRange(line.range, vscode.TextEditorRevealType.InCenter);
            editor.setDecorations(this.debugHighlightDecorationType, [line.range]);
        } catch (e) {
            console.error('Error highlighting line:', e);
        }
    }

    private async showError(filePath: string, lineNumber: number, error: any): Promise<void> {
        if (!filePath) return;

        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(document);
            const line = document.lineAt(Math.max(0, lineNumber - 1));
            editor.setDecorations(this.errorDecorationType, [line.range]);

            const fileUri = vscode.Uri.file(filePath);
            const diagnostic = new vscode.Diagnostic(
                line.range,
                error?.Message || error?.toString() || 'Unknown error',
                vscode.DiagnosticSeverity.Error
            );
            this.diagnosticCollection.set(fileUri, [diagnostic]);
        } catch (e) {
            console.error('Error showing error:', e);
        }
    }

    private clearDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.debugHighlightDecorationType, []);
            editor.setDecorations(this.errorDecorationType, []);
        }
        this.diagnosticCollection.clear();
    }

    // ========== Debug Adapter Protocol ==========

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        args: DebugProtocol.InitializeRequestArguments
    ): void {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsSetVariable = true;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this.sendResponse(response);
    }

    protected launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: DebugProtocol.LaunchRequestArguments
    ): void {
        // PLang IDE handles the actual launch via debugger/StartDebugger goal
        this.isDebugging = true;
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [{ id: PlangBridge.THREAD_ID, name: 'Main Thread' }]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ): void {
        response.body = {
            stackFrames: this.currentCallStack || [],
            totalFrames: this.currentCallStack?.length || 0
        };
        this.sendResponse(response);
    }

    protected scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments
    ): void {
        response.body = {
            scopes: [new Scope('Local', 1, false)]
        };
        this.sendResponse(response);
    } 

    protected variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): void {
        const variables: DebugProtocol.Variable[] = [];

        if (args.variablesReference === 1 && this.currentMemoryStack) {
            for (const [name, value] of Object.entries(this.currentMemoryStack)) {
                variables.push(this.createVariable(name, value));
            }
        } else {
            const obj = this.variablesRefCache.get(args.variablesReference);
            if (obj && typeof obj === 'object') {
                for (const [name, value] of Object.entries(obj)) {
                    variables.push(this.createVariable(name, value));
                }
            }
        }

        response.body = { variables };
        this.sendResponse(response);
    }

    private createVariable(name: string, value: any): DebugProtocol.Variable {
        let variablesReference = 0;
        let displayValue: string;

        if (value === null || value === undefined) {
            displayValue = 'null';
        } else if (typeof value === 'object') {
            if (Array.isArray(value)) {
                displayValue = `Array[${value.length}]`;
            } else {
                displayValue = 'Object';
            }
            variablesReference = ++this.nextVariableRef;
            this.variablesRefCache.set(variablesReference, value);
        } else {
            displayValue = String(value);
        }

        return {
            name,
            value: displayValue,
            variablesReference,
            type: typeof value
        };
    }

    protected continueRequest(
        response: DebugProtocol.ContinueResponse,
        args: DebugProtocol.ContinueArguments
    ): void {
        this.callGoal({
            Name: 'Continue',
            Parameters: args,
            Path: 'debugger/Continue'
        });
        this.sendResponse(response);
    }

    protected nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments
    ): void {
        this.callGoal({
            Name: 'StepOver',
            Parameters: args,
            Path: 'debugger/StepOver'
        });
        this.sendResponse(response);
    }

    protected stepInRequest(
        response: DebugProtocol.StepInResponse,
        args: DebugProtocol.StepInArguments
    ): void {
        this.callGoal({
            Name: 'Step',
            Parameters: args,
            Path: 'debugger/Step'
        });
        this.sendResponse(response);
    }

    protected stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        args: DebugProtocol.StepOutArguments
    ): void {
        this.callGoal({
            Name: 'StepOut',
            Parameters: args,
            Path: 'debugger/StepOut'
        });
        this.sendResponse(response);
    }

    protected disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        args: DebugProtocol.DisconnectArguments
    ): void {
        this.callGoal({
            Name: 'Stop',
            Parameters: args,
            Path: 'debugger/Stop'
        });
        this.isDebugging = false;
        this.clearDecorations();
        this.sendResponse(response);
    }

    protected terminateRequest(
        response: DebugProtocol.TerminateResponse,
        args: DebugProtocol.TerminateArguments
    ): void {
        this.callGoal({
            Name: 'Stop',
            Parameters: args,
            Path: 'debugger/Stop'
        });
        this.isDebugging = false;
        this.clearDecorations();
        this.sendResponse(response);
    }

    protected setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): void {
        const breakpoints: DebugProtocol.Breakpoint[] = [];

        if (args.breakpoints) {
            for (const bp of args.breakpoints) {
                breakpoints.push({
                    verified: true,
                    line: bp.line
                });
            }
        }

        this.callGoal({
            Name: 'SetBreakpoints',
            Parameters: { source: args.source, breakpoints: args.breakpoints },
            Path: 'debugger/SetBreakpoints'
        });

        response.body = { breakpoints };
        this.sendResponse(response);
    }

    protected evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ): void {
        const varName = args.expression.replace(/%/g, '');

        if (this.currentMemoryStack?.[varName] !== undefined) {
            const value = this.currentMemoryStack[varName];
            response.body = {
                result: typeof value === 'object' ? JSON.stringify(value) : String(value),
                variablesReference: 0
            };
        } else {
            response.body = {
                result: 'undefined',
                variablesReference: 0
            };
        }

        this.sendResponse(response);
    }

    /**
     * Cleanup on dispose
     */
    public dispose(): void {
        this.clearDecorations();

        if (this.readline) {
            this.readline.close();
        }

        if (this.plangProcess) {
            this.plangProcess.kill();
        }
    }
}