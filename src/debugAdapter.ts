import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, ContinuedEvent, StackFrame, Source } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as child_process from 'child_process';
import path = require('path');
import * as vscode from 'vscode';
import { OutputEvent } from '@vscode/debugadapter';
import { Response } from 'express';
import { Range } from 'vscode';


type ObjectValue = {
    VariableName: string;
    Value: object;
    Type: string;
    Initiated: boolean;
    ObjectReferenceId: number;
    Events: any[];
};


export class GoalDebugSession extends DebugSession {

    private readonly DEBUGGER_THREAD_ID = 1;
    private plangProcess?: child_process.ChildProcess;
    public isPaused: boolean = false;
    public editor?: vscode.TextEditor;
    public httpResponse?: Response | null;
    public data: any;

    step: any;
    goal: any;
    memoryStack: any;
    absolutePath: string = '';

    private debugHighlightDecorationType: vscode.TextEditorDecorationType;
    private highlightDecorationType: vscode.TextEditorDecorationType;
    private stopOnNext: boolean = false;
    private variablesRefCache: ObjectValue[] = [];
    private currentVariablesRef = 2;
    public variables: DebugProtocol.Variable[] = [];
    private nextStepFile: string | undefined = '';
    private isSteppingInto: boolean = false;
    constructor() {
        super();
        this.sendEvent(new InitializedEvent());

        this.debugHighlightDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'yellow', // choose your desired color
            color: 'black'
        });
        this.highlightDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'lightyellow', // choose your desired color
            color: 'black'
        });
    }



    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = response.body || {};
        response.body.supportsSetVariable = true;
        response.body.supportsStepBack = true;        // supports the step back feature
        response.body.supportsStepInTargetsRequest = true; // supports the step in feature
        response.body.supportsGotoTargetsRequest = true;   // supports the goto feature
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;


        this.sendResponse(response);
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        this.sendResponse(response);
    }

    public handleMessage(msg: DebugProtocol.ProtocolMessage): void {
        super.handleMessage(msg);

        if (msg.type === 'request') {
            const request = msg as DebugProtocol.Request;
            if (request.command === 'evaluate' && request.arguments?.context === 'repl') {
                const evaluateRequest = request as DebugProtocol.EvaluateRequest;
                const userInput = evaluateRequest.arguments.expression;

                // Send the input to your process
                this.plangProcess!.stdin!.write(userInput + '\n');
            }
        }
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments): void {
        const program = (args as any).program;

        this.plangProcess = child_process.spawn(program, (args as any).args, { cwd: (args as any).cwd });
        this.plangProcess.stdout!.on('data', (data) => {
            //console.log(`stdout: ${data}`);
            this.sendEvent(new OutputEvent(data.toString(), 'stdout'));
        });

        this.plangProcess.stderr!.on('data', (data) => {
            console.error(`stderr: ${data}`);
            this.sendEvent(new OutputEvent(data.toString(), 'stdout'));
        });

        this.plangProcess.on('close', (code) => {

            this.clearDecorations();

            this.sendEvent(new OutputEvent(`Exiting with code ${code}`, 'stdout'));
            this.sendEvent(new TerminatedEvent());
        });

        this.sendResponse(response);

    }

    public clearDecorations() {
        if (!this.editor) return;
        this.editor!.setDecorations(this.debugHighlightDecorationType, []);
        this.editor!.setDecorations(this.highlightDecorationType, []);
    }
    public setDebugDecorations(range: Range[]) {
        if (!this.editor) return;
        this.editor!.setDecorations(this.debugHighlightDecorationType, range);
        this.editor!.setDecorations(this.highlightDecorationType, []);
    }
    public setDecorations(range: Range[]) {
        if (!this.editor) return;

        this.editor!.setDecorations(this.debugHighlightDecorationType, []);
        this.editor!.setDecorations(this.highlightDecorationType, range);
    }
    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        if (this.plangProcess) {
            this.plangProcess.kill();
            this.plangProcess = undefined;
        }
        this.httpResponse = null;
        super.disconnectRequest(response, args);
    }

    protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
        if (this.plangProcess) {
            this.plangProcess.kill();
            this.plangProcess = undefined;
        }
        this.httpResponse = null;
        super.terminateRequest(response, args);
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        if (this.editor) {
            this.editor.setDecorations(this.highlightDecorationType, []);
        }
        // Handle setting breakpoints. Use args.breakpoints to get the locations where breakpoints are set.
        this.sendResponse(response);
    }
    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        // Return the single thread
        response.body = {
            threads: [
                {
                    id: this.DEBUGGER_THREAD_ID,
                    name: "Main Thread"
                }
            ]
        };
        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.clearDecorations();
        this.isPaused = false;
        this.stopOnNext = false;
        this.nextStepFile = this.editor?.document.fileName;
        if (!(this.httpResponse! as any).closed) {
            this.httpResponse!.send('{"ok":true}');
            this.httpResponse = null;
        }
        this.sendEvent(new ContinuedEvent(this.DEBUGGER_THREAD_ID));
        // You can send your HTTP response here or set some flag to indicate your POST handler to respond
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.clearDecorations();
        this.isPaused = false;
        this.httpResponse!.send('{"ok":true}');
        this.httpResponse = null;
        this.sendEvent(new ContinuedEvent(this.DEBUGGER_THREAD_ID));
        this.nextStepFile = this.editor?.document.fileName;
        this.stopOnNext = true;
        // You can send your HTTP response here or set some flag to indicate your POST handler to respond, but ensure you pause again on the next line of execution
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this.isSteppingInto = true;
        this.clearDecorations();
        this.httpResponse!.send('{"ok":true}');
        this.httpResponse = null;
        this.stopOnNext = true;

        this.sendEvent(new ContinuedEvent(this.DEBUGGER_THREAD_ID));
        this.sendResponse(response);

    }

    public goToLine(a: any) {
        console.log(a.lineNumber);
    }

    protected gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments): void {
        const { source, line } = args;

        const targets = [{
            id: line, // A unique identifier for the goto target. Using line number just for demonstration.
            label: `Line ${line}`, // Description of the goto target.
            line: line,
            column: 1, // Assuming the target starts at column 1 for simplicity.
            endLine: line,
            endColumn: 1000 // Some hypothetical column value. You'd adjust based on the actual source.
        }];

        response.body = { targets };
        //this.httpResponse!.send('{"ok":true, "go_to":' + line + '}');
        this.sendResponse(response);
    }
    protected addPropertyToObject(obj: any) {
        if (!obj) {
            return;
        }
        var propertyNames = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < propertyNames.length; i++) {
            let val = obj[propertyNames[i]];
            this.addObject(val, propertyNames[i]);
        }
    }
    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        this.variables = [];

        if (args.variablesReference === 1 && this.data) {

            if (this.memoryStack) {
                this.addPropertyToObject(this.memoryStack);
            } else {
                this.addPropertyToObject(this.data);
            }

            response.body = {
                variables: this.variables
            };
            this.sendResponse(response);
            return;
        }

        var obj = this.variablesRefCache.find(p => p.ObjectReferenceId == args.variablesReference);
        if (!obj) return;

        let names = Object.getOwnPropertyNames(obj);
        if (obj.Value) {
            names = Object.getOwnPropertyNames(obj.Value);
        }
        for (const key of names) {
            let val: any = (obj.Value as any)[key];
            if (val) {
                this.addObject(val, obj.VariableName + '.' + key);
            } else {
                this.addNull(obj.VariableName + '.' + key);
            }
        }

        response.body = {
            variables: this.variables
        };
        this.sendResponse(response);
    }
    /*
    addStringVariable(key: string, val: any) {
        var variable = this.variables.find(p => p.name == key);
        if (!variable) {
            this.variables.push({
                name: key,
                value: String(this.cleanValue(val)),
                variablesReference: 0
            });
        } else {
            variable.value = String(this.cleanValue(val));
        }
    }*/

    addNull(key: string) {
        this.variables.push({
            name: key,
            type: 'null',
            value: 'null',
            variablesReference: 0
        });

    }
    addObject(val: ObjectValue, key: string) {
        try {


            var objectValue = this.variablesRefCache.find(p => p.VariableName == key);
            if (val && val.Type && val.Type.startsWith('System.String,')) {
                val.Type = "String";
            }
            if (val && objectValue && objectValue.Type == val.Type) {
                objectValue.Value = val.Value;
                this.variables.push({
                    name: key,
                    type: objectValue.Type,
                    value: this.cleanValue(objectValue),
                    variablesReference: objectValue.ObjectReferenceId
                });
                return;
            } else if (objectValue) {
                this.variablesRefCache = this.variablesRefCache.filter(p => p.VariableName !== key);
                this.variables = this.variables.filter(p => p.variablesReference !== objectValue?.ObjectReferenceId);
            }

            if (!objectValue) objectValue = {} as ObjectValue;

            if (!val) {
                objectValue.Value = new String('');
                objectValue.ObjectReferenceId = 0;
                objectValue.Type = 'String';
            } else if (!val.Value && !val.Type) {
                objectValue.Value = val ?? null;
                if (val.Type) {
                    objectValue.Type = val.Type;
                }
                if ((objectValue.Value as ObjectValue)?.Initiated == false) {
                    objectValue.ObjectReferenceId = 0;
                } else if (objectValue.Value?.toString().startsWith('[object Object]')) {
                    objectValue.ObjectReferenceId = ++this.currentVariablesRef;
                } else {
                    objectValue.ObjectReferenceId = 0;
                }
            } else {
                objectValue = val;

                if (val.Type == 'String') {
                    objectValue.Type = "String";
                    objectValue.ObjectReferenceId = 0;
                } else if (val.Type.startsWith('Newtonsoft.Json.Linq')) {
                    objectValue.Type = val.Type;
                    if (val.Value.toString() != '[object Object]') {
                        val.Value = val.Value
                    } else {
                        objectValue.Value = val.Value;
                        objectValue.ObjectReferenceId = ++this.currentVariablesRef;
                    }

                } else {
                    objectValue.ObjectReferenceId = ++this.currentVariablesRef;
                    objectValue.Type = (val.Type ?? (val.Value as ObjectValue)?.Type ?? "Object");
                }
            }
            objectValue.VariableName = key;


            this.variablesRefCache.push(objectValue);
            this.variables.push({
                name: key,
                type: objectValue.Type,
                value: this.cleanValue(objectValue),
                variablesReference: objectValue.ObjectReferenceId
            });
        } catch (e) {
            console.log(e);
        }

    }

    private cleanValue(val: any): string {
        if (!val || val == null) return '';

        var objValue = null;
        if (val.ObjectReferenceId && !val.Type) {
            objValue = val.Value;
        }
        if (Array.isArray(val.Value)) {
            return '[' + val.Value.length + ']';
        }
        if (!val.Initiated && objValue != null) {
            if (objValue.Type != null) return ' (' + objValue.Type + ')';
            return '';
        }
        if (!val.Type && val.Value && val.Value.Type === null) {
            return 'null';
        }

        if (val.Type == 'String' && val.Value.toString() != "[object Object]") {
            val = val.Value ?? '';
        } else if (typeof val == 'object') {
            val = (typeof val.Value == 'object') ? 'Object' : (val.Value ?? '');
        }
        val = val.toString().replaceAll('\n', '').replaceAll('\r', '').replaceAll('\t', '');
        return val;
    }

    private cleanVarValue(val: any): string {
        if (!val || val == null) return '';

        if (typeof val == 'object') {
            val = (val.value && typeof val.value != 'object') ? val.value : 'BObject';
        }
        val = val.toString().replaceAll('\n', '').replaceAll('\r', '').replaceAll('\t', '');
        return val;
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        response.body = {
            scopes: [{
                name: "Local",
                variablesReference: 1,
                expensive: false
            }]
        };
        this.sendResponse(response);
    }
    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const frames: DebugProtocol.StackFrame[] = [];

        // For instance, to display a simple stack frame:
        frames.push(new StackFrame(1, this.goal.GoalName, new Source(this.step.Text, this.absolutePath), this.step.LineNumber, 0));

        // ... populate with your data ...

        response.body = {
            stackFrames: frames,
            totalFrames: frames.length
        };
        this.sendResponse(response);
    }
    private getKey(name: string) {
        if (name.indexOf('.') == -1) return name;
        return name.substring(0, name.indexOf('.'));
    }
    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

        response.body = {
            result: '',
            variablesReference: 0
        };

        if (args.context == 'variables') {
            response.body = {
                result: args.expression,
                variablesReference: 0
            };
        } else if (args.context == 'hover') {

            let objectValue = this.variablesRefCache.find(p => p.VariableName == args.expression);
            if (!objectValue) {
                var keyToSearchFor = this.getKey(args.expression);
                objectValue = this.variablesRefCache.find(p => p.VariableName == keyToSearchFor);
            }

            response.body = {
                result: objectValue?.Value.toString() ?? '',
                variablesReference: objectValue?.ObjectReferenceId ?? 0
            };

        }
        this.sendResponse(response);
    }

    getValue(variable: DebugProtocol.Variable, variableName: string): string {
        for (const valueKey of Object.keys(variable.value)) {
            console.log(valueKey);
        }
        return '';

    }


    public async checkBreakpoint(data: any, res: any) {
        try {
            if (this.httpResponse != null) return;
            if (!data["AbsolutePath"] || !data["!Step"]) {
                res.send('{"ok":true}');
                return;
            }

            this.absolutePath = data["AbsolutePath"];
            this.step = data["!Step"];
            this.goal = data["!Goal"];
            this.memoryStack = data["!MemoryStack"];

            const goalAbsolutePath = path.normalize(this.absolutePath).toLowerCase();

            const breakpoints = vscode.debug.breakpoints;
            const fileBreakpoints = breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint
                && bp.enabled && bp.location.range.start.line == (this.step.LineNumber - 1) &&
                path.normalize(bp.location.uri.fsPath).toLowerCase() === goalAbsolutePath
            ) as vscode.SourceBreakpoint[];

            if (!this.stopOnNext && fileBreakpoints.length == 0) {
                res.send('{"ok":true}');
                return;
            }

            this.data = data;

            const document = await vscode.workspace.openTextDocument(this.absolutePath);
            if (this.nextStepFile == '') this.nextStepFile = document.fileName;


            const editor = await vscode.window.showTextDocument(document);
            const lineNr = this.step.LineNumber - 1;
            let line = editor.document.lineAt(0);
            if (editor.document.lineCount > lineNr) {
                line = editor.document.lineAt(lineNr);
            }
            editor.revealRange(line.range, vscode.TextEditorRevealType.InCenter);

            this.isSteppingInto = false;

            this.isPaused = true;
            this.editor = editor;
            this.httpResponse = res;

            this.nextStepFile = document.fileName;
            this.variablesRefCache = [];
            this.setDebugDecorations([line.range]);
            this.sendEvent(new StoppedEvent('breakpoint', 1));
            return true;

        } catch (e) {
            console.error(e);
        }
    }
}




