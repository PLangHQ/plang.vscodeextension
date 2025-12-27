import {
    DebugSession,
    InitializedEvent,
    TerminatedEvent,
    StoppedEvent,
    ContinuedEvent,
    OutputEvent,
    StackFrame,
    Source,
    Scope
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import * as readline from 'readline';
import { PathHelper } from '../PathHelper';

/**
 * Message types from PLang IDE app to TypeScript
 */
interface PlangMessage {
    type: 'text' | 'execute' | 'render' | 'ask';
    method?: string;
    params?: any;
    content?: any;
    id?: string;
    question?: string;
}

/**
 * Message types from TypeScript to PLang IDE app
 */
interface TypeScriptMessage {
    type: 'call' | 'answer';
    goal?: string;
    params?: any;
    id?: string;
    value?: any;
}

/**
 * Debug state received from the debugged app
 */
interface DebugState {
    memoryStack: any;
    callStack: CallStackFrame[];
    prPath: string;
    reason: string;
    error?: any;
}

interface CallStackFrame {
    goalName: string;
    stepText: string;
    lineNumber: number;
    filePath: string;
    depth: number;
}

export class GoalDebugSessionV2 extends DebugSession {
    private static THREAD_ID = 1;

    private plangIdeProcess?: child_process.ChildProcess;
    private readline?: readline.Interface;

    private isPaused = false;
    private currentState?: DebugState;
    private pendingAsks: Map<string, (value: any) => void> = new Map();

    // Decorations
    private debugHighlightDecorationType: vscode.TextEditorDecorationType;
    private errorDecorationType: vscode.TextEditorDecorationType;
    private diagnosticCollection = vscode.languages.createDiagnosticCollection('goal-v2');

    // Variable handling
    private variablesRefCache: Map<number, any> = new Map();
    private nextVariableRef = 1;

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
     * Initialize the debug adapter capabilities
     */
    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        args: DebugProtocol.InitializeRequestArguments
    ): void {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsStepBack = false;
        response.body.supportsSetVariable = true;
        response.body.supportsBreakpointLocationsRequest = true;

        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        args: DebugProtocol.ConfigurationDoneArguments
    ): void {
        this.sendResponse(response);
    }

    /**
     * Launch the debug session
     */
    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: DebugProtocol.LaunchRequestArguments & {
            program?: string;
            cwd?: string;
            goalPath?: string;
            breakpoints?: string[];
        }
    ): Promise<void> {
        const cwd = args.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const goalPath = args.goalPath || '';
        const breakpoints = this.getBreakpointsAsPrPaths();

        // Start the PLang IDE app
        await this.startPlangIdeApp(cwd, goalPath, breakpoints);

        this.sendResponse(response);
    }

    /**
     * Start the PLang IDE app and set up stdin/stdout communication
     */
    private async startPlangIdeApp(cwd: string, goalPath: string, breakpoints: string[]): Promise<void> {
        const plangIdePath = path.join(__dirname, 'plang');

        // Spawn the PLang IDE app
        this.plangIdeProcess = child_process.spawn(
            PathHelper.PlangExecutable,
            ['p', 'debugger/StartDebugger', `goalPath=${goalPath}`, `breakpoints=${JSON.stringify(breakpoints)}`],
            {
                cwd: plangIdePath,
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );

        // Set up readline for JSON line parsing
        this.readline = readline.createInterface({
            input: this.plangIdeProcess.stdout!,
            crlfDelay: Infinity
        });

        // Handle incoming messages from PLang IDE app
        this.readline.on('line', (line) => {
            this.handlePlangMessage(line);
        });

        // Handle stderr
        this.plangIdeProcess.stderr?.on('data', (data) => {
            this.sendEvent(new OutputEvent(data.toString(), 'stderr'));
        });

        // Handle process exit
        this.plangIdeProcess.on('close', (code) => {
            this.sendEvent(new OutputEvent(`PLang IDE process exited with code ${code}\n`, 'console'));
            this.sendEvent(new TerminatedEvent());
        });
    }

    /**
     * Handle incoming JSON line messages from PLang IDE app
     */
    private handlePlangMessage(line: string): void {
        try {
            const message: PlangMessage = JSON.parse(line);

            switch (message.type) {
                case 'execute':
                    this.handleExecuteMessage(message);
                    break;
                case 'text':
                    this.sendEvent(new OutputEvent(String(message.content) + '\n', 'stdout'));
                    break;
                case 'ask':
                    // Handle ask messages if needed
                    break;
                case 'render':
                    // Handle render messages if needed
                    break;
            }
        } catch (e) {
            // Not JSON, treat as plain text output
            this.sendEvent(new OutputEvent(line + '\n', 'stdout'));
        }
    }

    /**
     * Handle execute messages - these call TypeScript methods
     */
    private handleExecuteMessage(message: PlangMessage): void {
        const method = message.method;
        const params = message.params;

        switch (method) {
            case 'debugger.stopped':
                this.handleStopped(params);
                break;
            case 'debugger.continued':
                this.handleContinued();
                break;
            case 'debugger.terminated':
                this.handleTerminated(params);
                break;
            case 'debugger.setVariables':
                this.handleSetVariables(params);
                break;
            case 'debugger.setCallStack':
                this.handleSetCallStack(params);
                break;
            case 'debugger.output':
                this.handleOutput(params);
                break;
            case 'debugger.exception':
                this.handleException(params);
                break;
        }
    }

    /**
     * Send a message to the PLang IDE app via stdin
     */
    private sendToPlangIde(message: TypeScriptMessage): void {
        if (this.plangIdeProcess?.stdin?.writable) {
            this.plangIdeProcess.stdin.write(JSON.stringify(message) + '\n');
        }
    }

    /**
     * Call a goal in the PLang IDE app
     */
    private callGoal(goalName: string, params: any = {}): void {
        this.sendToPlangIde({
            type: 'call',
            goal: goalName,
            params
        });
    }

    // ========== Debugger Method Handlers ==========

    private async handleStopped(params: { reason: string; prPath: string }): Promise<void> {
        this.isPaused = true;

        // Get the goal file path from prPath
        const filePath = await this.prPathToGoalPath(params.prPath);
        const lineNumber = await this.getLineNumberFromPrPath(params.prPath);

        if (filePath) {
            await this.highlightLine(filePath, lineNumber);
        }

        this.sendEvent(new StoppedEvent(params.reason || 'breakpoint', GoalDebugSessionV2.THREAD_ID));
    }

    private handleContinued(): void {
        this.isPaused = false;
        this.clearDecorations();
        this.sendEvent(new ContinuedEvent(GoalDebugSessionV2.THREAD_ID));
    }

    private handleTerminated(params: { reason: string }): void {
        this.clearDecorations();
        this.sendEvent(new OutputEvent(`Debug session ended: ${params?.reason || 'unknown'}\n`, 'console'));
        this.sendEvent(new TerminatedEvent());
    }

    private handleSetVariables(memoryStack: any): void {
        this.variablesRefCache.clear();
        this.nextVariableRef = 1;
        this.currentState = { ...this.currentState, memoryStack } as DebugState;
    }

    private handleSetCallStack(callStack: CallStackFrame[]): void {
        this.currentState = { ...this.currentState, callStack } as DebugState;
    }

    private handleOutput(params: { text: string; category: string }): void {
        const category = params.category === 'stderr' ? 'stderr' : 'stdout';
        this.sendEvent(new OutputEvent(params.text + '\n', category));
    }

    private async handleException(params: { prPath: string; error: any }): Promise<void> {
        const filePath = await this.prPathToGoalPath(params.prPath);
        const lineNumber = await this.getLineNumberFromPrPath(params.prPath);

        if (filePath) {
            await this.showError(filePath, lineNumber, params.error);
        }
    }

    // ========== VS Code Debug Protocol Handlers ==========

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [{ id: GoalDebugSessionV2.THREAD_ID, name: 'Main Thread' }]
        };
        this.sendResponse(response);
    }

    protected stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ): void {
        const frames: StackFrame[] = [];

        if (this.currentState?.callStack) {
            for (let i = 0; i < this.currentState.callStack.length; i++) {
                const frame = this.currentState.callStack[i];
                frames.push(new StackFrame(
                    i,
                    frame.goalName,
                    new Source(path.basename(frame.filePath), frame.filePath),
                    frame.lineNumber,
                    0
                ));
            }
        }

        response.body = {
            stackFrames: frames,
            totalFrames: frames.length
        };
        this.sendResponse(response);
    }

    protected scopesRequest(
        response: DebugProtocol.ScopesResponse,
        args: DebugProtocol.ScopesArguments
    ): void {
        response.body = {
            scopes: [
                new Scope('Local', 1, false)
            ]
        };
        this.sendResponse(response);
    }

    protected variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): void {
        const variables: DebugProtocol.Variable[] = [];

        if (args.variablesReference === 1 && this.currentState?.memoryStack) {
            // Root level - show all variables from memoryStack
            for (const [name, value] of Object.entries(this.currentState.memoryStack)) {
                variables.push(this.createVariable(name, value));
            }
        } else {
            // Nested object
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
        this.callGoal('debugger/Continue');
        this.sendResponse(response);
    }

    protected nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments
    ): void {
        this.callGoal('debugger/StepOver');
        this.sendResponse(response);
    }

    protected stepInRequest(
        response: DebugProtocol.StepInResponse,
        args: DebugProtocol.StepInArguments
    ): void {
        this.callGoal('debugger/Step');
        this.sendResponse(response);
    }

    protected stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        args: DebugProtocol.StepOutArguments
    ): void {
        this.callGoal('debugger/StepOut');
        this.sendResponse(response);
    }

    protected pauseRequest(
        response: DebugProtocol.PauseResponse,
        args: DebugProtocol.PauseArguments
    ): void {
        // Pause not directly supported - would need runtime support
        this.sendResponse(response);
    }

    protected disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        args: DebugProtocol.DisconnectArguments
    ): void {
        this.callGoal('debugger/Stop');
        this.cleanup();
        this.sendResponse(response);
    }

    protected terminateRequest(
        response: DebugProtocol.TerminateResponse,
        args: DebugProtocol.TerminateArguments
    ): void {
        this.callGoal('debugger/Stop');
        this.cleanup();
        this.sendResponse(response);
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        const breakpoints: DebugProtocol.Breakpoint[] = [];

        if (args.breakpoints) {
            for (const bp of args.breakpoints) {
                breakpoints.push({
                    verified: true,
                    line: bp.line
                });
            }
        }

        // Send updated breakpoints to PLang IDE app
        const prPaths = this.getBreakpointsAsPrPaths();
        this.callGoal('debugger/SetBreakpoints', { breakpoints: prPaths });

        response.body = { breakpoints };
        this.sendResponse(response);
    }

    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ): Promise<void> {
        // For hover or watch
        if (args.context === 'hover' || args.context === 'watch') {
            const varName = args.expression.replace(/%/g, '');

            if (this.currentState?.memoryStack?.[varName] !== undefined) {
                const value = this.currentState.memoryStack[varName];
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
        } else {
            // REPL evaluation
            this.callGoal('debugger/Evaluate', { expression: args.expression });
            response.body = {
                result: 'evaluating...',
                variablesReference: 0
            };
        }

        this.sendResponse(response);
    }

    // ========== Helper Methods ==========

    private getBreakpointsAsPrPaths(): string[] {
        const prPaths: string[] = [];
        const breakpoints = vscode.debug.breakpoints;

        for (const bp of breakpoints) {
            if (bp instanceof vscode.SourceBreakpoint && bp.enabled) {
                // Convert file path + line to PrPath
                // This is a simplified version - you may need to adjust based on your .pr file structure
                const filePath = bp.location.uri.fsPath;
                const line = bp.location.range.start.line + 1;

                // You'll need to implement the actual conversion logic
                // based on how .pr files map to .goal files
                const prPath = this.goalPathToPrPath(filePath, line);
                if (prPath) {
                    prPaths.push(prPath);
                }
            }
        }

        return prPaths;
    }

    private goalPathToPrPath(goalFilePath: string, lineNumber: number): string | null {
        // TODO: Implement conversion from goal file path + line to .pr path
        // This requires reading the goal file and finding the corresponding step
        // For now, return a placeholder
        return null;
    }

    private async prPathToGoalPath(prPath: string): Promise<string | null> {
        // TODO: Implement conversion from .pr path to goal file path
        // This requires reading the .pr file to get the source location
        return null;
    }

    private async getLineNumberFromPrPath(prPath: string): Promise<number> {
        // TODO: Implement getting line number from .pr file
        return 1;
    }

    private async highlightLine(filePath: string, lineNumber: number): Promise<void> {
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
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(document);

            const line = document.lineAt(Math.max(0, lineNumber - 1));
            editor.setDecorations(this.errorDecorationType, [line.range]);

            const fileUri = vscode.Uri.file(filePath);
            const diagnostic = new vscode.Diagnostic(
                line.range,
                error.Message || error.toString(),
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

    private cleanup(): void {
        this.clearDecorations();

        if (this.readline) {
            this.readline.close();
            this.readline = undefined;
        }

        if (this.plangIdeProcess) {
            this.plangIdeProcess.kill();
            this.plangIdeProcess = undefined;
        }
    }
}