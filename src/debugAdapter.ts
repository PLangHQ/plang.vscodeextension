import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, ContinuedEvent, StackFrame, Source } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as child_process from 'child_process';
import path = require('path');
import * as vscode from 'vscode';
import * as fs from 'fs';
import { OutputEvent } from '@vscode/debugadapter';
import { Response } from 'express';
import { Range } from 'vscode';
import { getRootPath, getStartPath } from './extension';
import { validateHeaderName } from 'http';

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
            if (request.command === 'evaluate') {
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
        this.plangProcess.stdin!.on('data', (data) => {
            console.log('answer');
            this.sendEvent(new OutputEvent(data.toString(), 'stdin'));
        });

        this.plangProcess.stdout!.on('data', (data) => {
            console.log(`stdout: ${data}`);
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
        this.editor!.setDecorations(this.debugHighlightDecorationType, []);
        this.editor!.setDecorations(this.highlightDecorationType, []);
    }
    public setDebugDecorations(range: Range[]) {
        this.editor!.setDecorations(this.debugHighlightDecorationType, range);
        this.editor!.setDecorations(this.highlightDecorationType, []);
    }
    public setDecorations(range: Range[]) {
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
        var propertyNames = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < propertyNames.length; i++) {
            let val = obj[propertyNames[i]];
            this.addObject(val, propertyNames[i]);
        }
    }
    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        this.variables = [];

        if (args.variablesReference === 1 && this.data) {
            if (this.data.memoryStack) {
                this.addPropertyToObject(this.data.memoryStack);
            }

            if (this.data.exception) {
                var exception = { exception: this.data.exception }
                this.addPropertyToObject(exception);
            }
            response.body = {
                variables: this.variables
            };
            this.sendResponse(response);
            return;
        }

        var obj = this.variablesRefCache.find(p => p.ObjectReferenceId == args.variablesReference);
        if (!obj) return;

        for (const key of Object.getOwnPropertyNames(obj.Value)) {
            let val: any = (obj.Value as any)[key];
            this.addObject(val, obj.VariableName + '.' + key);
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
    addObject(val: ObjectValue, key: string) {
        try {


            var objectValue = this.variablesRefCache.find(p => p.VariableName == key);
            if (val.Type && val.Type.startsWith('System.String,')) {
                val.Type = "String";
            }
            if (objectValue && objectValue.Type == val.Type) {
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

                if (objectValue.Value?.toString().startsWith('[object Object]')) {
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
                    objectValue.Type = (val.Type ?? "Object");
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
        frames.push(new StackFrame(1, this.data!.goal.GoalName, new Source(this.data.step.Text, this.data.absolutePath), this.data!.step.LineNumber + 1, 0));

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

            let variableName = args.expression;
            /*
                        let value = this.cleanVarValue(this.variables[i]);
                        if (args.expression.indexOf('(') != -1) {
                            variableName = variableName.substring(0, variableName.lastIndexOf('.'));
                        } else if (variableName.indexOf('.') != -1) {
            
                            value = this.getValue(this.variables[i], variableName)
                        } else if (value == 'Object') {
                            value = JSON.stringify(this.variablesRefCache[this.variables[i].variablesReference]);
                        }*/
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
            if (!data.absolutePath || !data.step) {
                res.send('{"ok":true}');
                return;
            }

            const goalAbsolutePath = path.normalize(data.absolutePath).toLowerCase();

            const breakpoints = vscode.debug.breakpoints;
            const fileBreakpoints = breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint) as vscode.SourceBreakpoint[];
            let targetBreakpoints : any[] = [];
            for (var i=0;i<fileBreakpoints.length;i++) {

                var point = fileBreakpoints[i];
                if (path.normalize(point.location.uri.fsPath).toLowerCase() === goalAbsolutePath) {
                    targetBreakpoints.push(point);
                }
            }

            let targetBreakpoint: any = null;
            if (!this.stopOnNext) {
                for (let i = 0; targetBreakpoints != undefined && i < targetBreakpoints.length; i++) {
                    if (!targetBreakpoints[i].enabled) continue;
                    if (targetBreakpoints[i].location.range.start.line == data.step.LineNumber) {
                        targetBreakpoint = targetBreakpoints[i];
                        i = targetBreakpoints.length;
                    }
                }

                if (targetBreakpoint == null) {
                    res.send('{"ok":true}');
                    return;
                }
            }

            const document = await vscode.workspace.openTextDocument(data.absolutePath);
            if (this.nextStepFile == '') this.nextStepFile = document.fileName;


            const editor = await vscode.window.showTextDocument(document);
            const line = editor.document.lineAt(data.step.LineNumber);
            editor.revealRange(line.range, vscode.TextEditorRevealType.InCenter);

            this.isSteppingInto = false;
            this.editor = editor;
            this.isPaused = true;
            this.httpResponse = res;
            this.data = data;
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




