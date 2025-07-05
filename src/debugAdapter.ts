import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, ContinuedEvent, StackFrame, Source } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as child_process from 'child_process';
import path = require('path');
import * as vscode from 'vscode';
import { OutputEvent } from '@vscode/debugadapter';
import { Response } from 'express';
import { Range } from 'vscode';
import * as fs from 'fs';
import fetch from 'node-fetch';
import { PlangHelper } from './PlangHelper';
import { Util } from './Util';
import { ObjectValue, SimpleValue } from './models/Models';


export class GoalDebugSession extends DebugSession {


    private readonly DEBUGGER_THREAD_ID = 1;
    private plangProcess?: child_process.ChildProcess;
    public isPaused: boolean = false;
    public editor?: vscode.TextEditor;
    public httpResponse?: Response | null;
    public data: any;

    diagnosticCollection = vscode.languages.createDiagnosticCollection('goal');
    step: any;
    goal: any;
    instruction: any;
    goalVars: any;
    memoryStack: any;
    absolutePath: string = '';
    stepAbsolutePath: string = '';

    private StringType = 'string';
    private hoverFunction: vscode.Disposable | undefined;
    private debugHighlightDecorationType: vscode.TextEditorDecorationType;
    private highlightDecorationType: vscode.TextEditorDecorationType;
    private stopOnNext: boolean = false;
    private variablesRefCache: SimpleValue[] = [];
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
        response.body.supportsStepBack = true;
        response.body.supportsDataBreakpoints = true;
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsFunctionBreakpoints = true;
        response.body.supportsBreakpointLocationsRequest = true;
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsStepInTargetsRequest = true;
        response.body.supportsGotoTargetsRequest = true;
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;

        response.body.supportsClipboardContext = true;



        this.sendResponse(response);
    }


    protected override customRequest(command: string, response: DebugProtocol.Response, args: any): void {
        if (command === 'copy') {
            const variableValue = args.value;
            vscode.env.clipboard.writeText(variableValue); // Copy to clipboard
            this.sendResponse(response);
            return;
        }

        super.customRequest(command, response, args);
    }
    protected override dispatchRequest(request: DebugProtocol.Request): void {
        if (request.arguments?.context == 'clipboard') {
            vscode.env.clipboard.writeText(request.arguments?.expression); // Copy to clipboard
        }
        if (request.command === 'copy') {
            const valueToCopy = (request.arguments as { value: string }).value;

            vscode.env.clipboard.writeText(valueToCopy).then(() => {
                this.sendResponse({ request_seq: request.seq, success: true } as DebugProtocol.Response);
            });

            return;
        }

        super.dispatchRequest(request);
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
        this.diagnosticCollection.clear();
        this.hoverFunction?.dispose();

        super.disconnectRequest(response, args);
    }

    protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
        if (this.plangProcess) {
            this.plangProcess.kill();
            this.plangProcess = undefined;
        }

        this.hoverFunction?.dispose();

        this.httpResponse = null;
        super.terminateRequest(response, args);
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
        this.continueWithRequest(response, args, undefined);
    }

    public continueWithRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments | undefined, obj: any): void {
        this.clearDecorations();
        this.isPaused = false;
        this.stopOnNext = false;
        this.nextStepFile = this.editor?.document.fileName;

        if (!(this.httpResponse! as any).closed) {
            if (!obj) obj = {};
            obj.ok = true;
            let responseObj = JSON.stringify(obj);
            this.httpResponse!.send(responseObj);

            this.httpResponse = null;
        }

        this.sendResponse(response);
        this.sendEvent(new ContinuedEvent(this.DEBUGGER_THREAD_ID));

    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.clearDecorations();
        this.isPaused = false;
        this.nextStepFile = this.editor?.document.fileName;
        this.stopOnNext = true;

        this.sendEvent(new ContinuedEvent(this.DEBUGGER_THREAD_ID));
        this.sendResponse(response);

        this.httpResponse!.send('{"ok":true}');
        this.httpResponse = null;


    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request): void {
        this.isSteppingInto = false;
        this.clearDecorations();
        this.stopOnNext = false;

        this.sendEvent(new ContinuedEvent(this.DEBUGGER_THREAD_ID));
        this.sendResponse(response);

        this.httpResponse!.send('{"ok":true}');
        this.httpResponse = null;

    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this.isSteppingInto = true;
        this.clearDecorations();
        this.stopOnNext = true;

        this.sendEvent(new ContinuedEvent(this.DEBUGGER_THREAD_ID));
        this.sendResponse(response);

        this.httpResponse!.send('{"ok":true}');
        this.httpResponse = null;


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



    public async checkBreakpoint(data: any, res: any) {
        try {
            if (this.httpResponse != null) {
                console.log('response not null')
                return;
            }
            if (this.stopOnNext && !data["!Step"]) {
                res.send('{"continue":true}');
                return;
            }
            if (!this.stopOnNext && data["line"]) {
                let breakpoints = vscode.debug.breakpoints;
                let line = data["line"];
                let goalFilePath = path.normalize(data["AbsolutePath"]).toLowerCase();
                let fileBreakpoints = breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint
                    && bp.enabled && bp.location.range.start.line == (line - 1) &&
                    path.normalize(bp.location.uri.fsPath).toLowerCase() === goalFilePath
                ) as vscode.SourceBreakpoint[];
                res.send('{"continue":' + (fileBreakpoints.length > 0) + '}');
                return;
            }

            if (!data["AbsolutePath"] || !data["!Step"]) {
                res.send('{"ok":true}');
                return;
            }

            this.absolutePath = data["AbsolutePath"];
            this.stepAbsolutePath = data["StepAbsolutePath"];
            this.step = data["!Step"];
            this.goal = data["!Goal"];
            this.goalVars = data["!GoalVariables"];
            this.memoryStack = data["!MemoryStack"];
            this.instruction = data["!Instruction"];
            let error = data["!Error"];
            if (error != null && error != '') {
                if (typeof (error) == this.StringType) {
                    try {
                        error = JSON.parse(error);
                    } catch (e) {
                        console.error('json parse on error', error)
                        console.error(e)
                    }
                }
                if (this.step.Hash != error.Step.Hash) {
                    error = null;
                }
                //this.step = error.Step;
                //this.goal = error.Goal;
            }
            this.diagnosticCollection.clear()
            if (!this.step) return;

            const goalAbsolutePath = path.normalize(this.absolutePath).toLowerCase();
            let fileBreakpoints: vscode.SourceBreakpoint[] = [];
            let breakpoints = vscode.debug.breakpoints;

            fileBreakpoints = breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint
                && bp.enabled && bp.location.range.start.line == (this.step.LineNumber - 1) &&
                path.normalize(bp.location.uri.fsPath).toLowerCase() === goalAbsolutePath
            ) as vscode.SourceBreakpoint[];


            if (error != null && error != '') {

                error = await this.setupErrorBreakpoint(error, fileBreakpoints);
            }

            if (!this.stopOnNext && fileBreakpoints.length == 0) {
                res.send('{"ok":true}');
                return;
            }

            this.data = data;

            const document = await vscode.workspace.openTextDocument(this.absolutePath);
            if (this.nextStepFile == '') this.nextStepFile = document.fileName;

            const lineNr = Math.max(0, this.step.LineNumber - 1);
            let line = document.lineAt(0);
            if (document.lineCount > lineNr) {
                line = document.lineAt(lineNr);
            }

            const editor = await vscode.window.showTextDocument(document);
            editor.revealRange(line.range, vscode.TextEditorRevealType.InCenter);

            this.isSteppingInto = false;

            this.isPaused = true;
            this.editor = editor;
            this.httpResponse = res;
            this.nextStepFile = document.fileName;

            this.setDebugDecorations([line.range]);
            this.sendEvent(new StoppedEvent('breakpoint', 1));

            return true;

        } catch (e) {
            console.error(e);
            res.send('{"ok":true}');
        }
    }



    private async setupErrorBreakpoint(error: any, fileBreakpoints: vscode.SourceBreakpoint[]) {
        if (typeof (error) == this.StringType) {
            error = JSON.parse(error);
        }
        const document = await vscode.workspace.openTextDocument(this.absolutePath);
        if (this.nextStepFile == '') this.nextStepFile = document.fileName;

        const lineNr = Math.max(0, this.step.LineNumber - 1);
        let line = document.lineAt(0);
        if (document.lineCount > lineNr) {
            line = document.lineAt(lineNr);
        }


        let fileUri = vscode.Uri.file(this.absolutePath);
        //let lineNumber = ;
        let errorLocation = new vscode.Location(fileUri, line.range);

        fileBreakpoints.push(new vscode.SourceBreakpoint(errorLocation));

        let errorMessage = error.Message;
        if (!errorMessage && error.Exception.Message) {
            errorMessage = error.Exception.Message;
        }

        const diagnostic = new vscode.Diagnostic(
            line.range,
            errorMessage,
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.relatedInformation = [];
        if (error.FixSuggestion) {
            diagnostic.relatedInformation?.push(
                new vscode.DiagnosticRelatedInformation(
                    errorLocation,
                    "FixSuggestion: " + error.FixSuggestion
                )
            );
        }
        if (error.HelpfullLinks) {
            diagnostic.relatedInformation?.push(
                new vscode.DiagnosticRelatedInformation(
                    errorLocation,
                    "HelpfullLinks: " + error.HelpfullLinks
                )
            );
        }

        this.diagnosticCollection.set(fileUri, [diagnostic]);
        return error;
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {

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
            if (!(args as any).source) return;

            var fileUri = vscode.Uri.file((args as any).source.path);
            var diagnostic = this.diagnosticCollection.get(fileUri);
            if (diagnostic && diagnostic.length > 0 && diagnostic[0].range.start.line == (args as any).line - 1) {
                let diagnosticMessage = diagnostic[0].message;
                diagnosticMessage += diagnostic[0].relatedInformation?.map(d => d.message).join("\n");
                if (!this.stepAbsolutePath) return;

                const data = fs.readFileSync(this.stepAbsolutePath).toString();
                let prFile = JSON.parse(data) as any;

                var result = await PlangHelper.Call('diagnostics', { error: diagnosticMessage, stepText: this.step.Text, action: prFile.Action });
                response.body = {
                    result: " ❌ ERROR\n\t" + diagnosticMessage + "\n 💡 HINT\n\t" + Util.wrapText(result.trim()),
                    variablesReference: 0
                };
                this.sendResponse(response);

            } else if (args.expression != '') {

                let variableName = `%${args.expression}%`;

                let objectValue = this.getObjectValue(variableName)
                if (!objectValue) {
                    var keyToSearchFor = this.getKey(args.expression);
                    objectValue = this.getObjectValue(keyToSearchFor)
                }
                if (!objectValue) return;

                let responseBody = this.getResponseBody(objectValue) as any;

                response.body = responseBody;
                this.sendResponse(response);
            }

        }

    }

    getResponseBody(ov: SimpleValue) {
        if (this.UseValue(ov.Type, ov)) {
            return { result: ov.Value, variablesReference: 0 }
        }
        return { result: ov.Type, variablesReference: ov.ObjectReferenceId ?? 0 };
    }


    getValue(variable: DebugProtocol.Variable, variableName: string): string {
        for (const valueKey of Object.keys(variable.value)) {
            console.log(valueKey);
        }
        return '';

    }

    protected addPropertyToObject(obj: any, key: string) {
        if (!obj) {
            return;
        }
        if (typeof (obj) == this.StringType) {
            obj = JSON.parse(obj);
        }

        if (obj.length) {
            for (let i = 0; i < obj.length; i++) {
                let value: SimpleValue = { Name: key, Type: typeof (obj[i]), Value: obj[i] };
                this.addObject(value);
            }
        } else {
            var propertyNames = Object.getOwnPropertyNames(obj);
            for (var i = 0; i < propertyNames.length; i++) {
                let val = obj[propertyNames[i]];

                let value: SimpleValue = { Name: propertyNames[i], Type: typeof (val), Value: val };
                this.addObject(value);
            }
        }
    }


    protected addMemoryStack(memoryStack: any) {
        for (let i = 0; i < memoryStack.length; i++) {
            this.addObject(memoryStack[i] as ObjectValue);
        }
    }


    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        this.variables = [];

        if (args.variablesReference === 1 && this.data) {
            this.loadVariableReferences();
            this.checkForModule();

            response.body = {
                variables: this.variables
            };
            this.sendResponse(response);
            return;
        }

        this.loadVariablePanel(args.variablesReference);        

        response.body = {
            variables: this.variables
        };
        this.sendResponse(response);
    }

    loadVariablePanel(variablesReference: number) {
        
        var obj = this.getObjectValueById(variablesReference);
        if (!obj) return;
        

        if (obj && obj.Type != this.StringType) {
            if (obj.Type == "!Properties") {
                var values = obj.Value as any;
                for (const key in values) {
                    if (values.hasOwnProperty(key)) {
                        const item = values[key] as any;
                        if (item) {
                            let value: SimpleValue = { Name: item.PathAsVariable, Type: typeof (item.Value), Value: item.Value };

                            this.addObject(value);
                        }
                    }
                }
            } else if (obj.Value && typeof (obj.Value) != 'string') {
                let values = Object.getOwnPropertyNames(obj.Value);
                for (const key of values) {
                    let val: any = (obj.Value as any)[key];
                    if (val == undefined) {
                        this.addNull(key);
                    } else {
                        let value: SimpleValue = { Name: key, Type: typeof (val), Value: val };
                        this.addObject(value);
                    }
                }
            } else if (!obj.Value) {
                let values = Object.getOwnPropertyNames(obj);
                for (const key of values) {
                    let val: any = (obj as any)[key];
                    if (val) {
                        let value: SimpleValue = { Name: key, Type: typeof (val), Value: val };
                        this.addObject(value);
                    } else {
                        this.addNull(key);
                    }
                }
            }
        }
        if (obj.Type != '!Properties' && obj.Properties && obj.Properties.length > 0) {

            var objectValue = {} as ObjectValue
            objectValue.Name = "!Properties";
            objectValue.Type = "!Properties"
            objectValue.PathAsVariable = "%!Properties%"
            objectValue.ObjectReferenceId = ++this.currentVariablesRef;
            const { ...objWithoutProperties } = obj.Properties;

            objectValue.Value = objWithoutProperties;

            this.addObject(objectValue);
        }

        if (obj.Type != '!ObjectValue') {
            let objectProperties = Object.getOwnPropertyNames(obj);
            var objectValue = {} as ObjectValue
            objectValue.Name = "!ObjectValue";
            objectValue.Type = "!ObjectValue"
            objectValue.PathAsVariable = "!ObjectValue"
            objectValue.ObjectReferenceId = ++this.currentVariablesRef;
            if (obj.Properties) {
                const { ObjectReferenceId, Value, Properties, ...objWithoutProperties } = obj;
                objectValue.Value = objWithoutProperties;
            } else {
                objectValue.Value = obj;
            }
            this.addObject(objectValue);

        }
    }

    loadVariableReferences() {
        
        var memoryStack = this.data["!MemoryStack"];
        this.addMemoryStack(memoryStack);

        var error = this.data["!Error"];
        if (error) {
            this.addObject(error);
        }
        var event = this.data["!Event"];
        if (event) {
            event.Name = "!Event";

            this.addObject(event);
        }
        var step = this.data["!Step"];
        if (step) {
            step.Name = "!Step";
            this.addObject(step);
        }
        var goal = this.data["!Goal"];
        if (goal) {
            goal.Name = "!Goal";
            this.addObject(goal);
        }
        //this.addPropertyToObject(this.data);

        if (typeof this.goalVars == this.StringType) {
            this.goalVars = JSON.parse(this.goalVars);
        }
        for (let i = 0; i < this.goalVars.length; i++) {
            let value: SimpleValue = { Name: this.goalVars[i].VariableName, Type: typeof (this.goalVars[i].Value), Value: this.goalVars[i].Value };

            this.addObject(value);
        }
    }

    private showLens : any;

    checkForModule() {
        if (this.showLens) {
            let variableName = this.showLens.instruction.Function.ReturnValues[0].VariableName;
            let objectValue = this.getObjectValue(variableName);
            if (!objectValue) return;
            
            this.sendEvent({
                event: 'showLens',
                body: { objectValue },
                type: 'event',
                seq: 0 // (VS Code fills this in)
            });
            this.showLens = undefined;
        }

        if (this.step.ModuleType.indexOf("LlmModule") == -1) return;

        if (!this.instruction || !this.instruction.Function || !this.instruction.Function.ReturnValues || this.instruction.Function.ReturnValues.length == 0) return;

        this.showLens = { step: this.step, instruction: this.instruction};
        /* = (instr) => {
            
        }*/
    }

    addNull(key: string) {
        this.variables.push({
            name: key,
            type: 'null',
            value: 'null',
            variablesReference: 0
        });

    }

    getObjectValueById(id: number): ObjectValue {
        return this.variablesRefCache.find(p => p.ObjectReferenceId == id) as ObjectValue;
    }

    getObjectValue(name: string): SimpleValue | undefined {
        try {
            var value = this.variablesRefCache.find(p => p.Name.toLowerCase() == name.toLowerCase());
            if (value) return value;
        } catch (e) {
            console.log(e);
        }
        var value = this.variablesRefCache.find(p => (p as ObjectValue).PathAsVariable && (p as ObjectValue).PathAsVariable.toLowerCase() == name.toLowerCase());
        return value;
    }

    isObjectValue(val: SimpleValue | ObjectValue): val is ObjectValue {
        return 'Events' in val;
    }

    addObject(value: SimpleValue) {

        try {
            var valueInReference = this.getObjectValue(value.Name);


            if (this.isObjectValue(value)) {

            } else {
            }

            if (valueInReference) {
                value.ObjectReferenceId = valueInReference.ObjectReferenceId;
            } else {
                value.ObjectReferenceId = ++this.currentVariablesRef;
            }
            /*
            if (val && val.Type && val.Type.startsWith('System.String,')) {
                val.Type = this.StringType;
            }
            if (val && objectValue && objectValue.Type == val.Type && val.Value) {
                objectValue.Value = val.Value;
                this.variables.push({
                    name: key,
                    type: objectValue.Type,
                    value: this.cleanValue(objectValue),
                    variablesReference: objectValue.ObjectReferenceId
                });
                return;
            } else if (objectValue) {
                //this.variablesRefCache = this.variablesRefCache.filter(p => p.VariableName !== key);
                //this.variables = this.variables.filter(p => p.variablesReference !== objectValue?.ObjectReferenceId);
            }
    
    
            if (!val) {
                objectValue.Value = new String('');
                objectValue.ObjectReferenceId = 0;
                objectValue.Type = this.StringType;
            } else if (!val.Value && !val.Type) {
                objectValue.Value = val ?? null;
                if (val.Type) {
                    objectValue.Type = val.Type;
                } else {
                    objectValue.Type = typeof val;
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
    
                if (val.Type == this.StringType) {
                    objectValue.Type = this.StringType;
                    objectValue.ObjectReferenceId = 0;
                } else if (val.Type.startsWith('Newtonsoft.Json.Linq')) {
                    objectValue.Type = val.Type;
                    if (val.Value.toString().indexOf('[object Object]') == -1) {
                        val.Value = val.Value;
                        objectValue.ObjectReferenceId = 0;
                    } else {
                        objectValue.Value = val.Value;
                        objectValue.ObjectReferenceId = ++this.currentVariablesRef;
                    }
    
                } else {
                    objectValue.ObjectReferenceId = ++this.currentVariablesRef;
                    objectValue.Type = (val.Type ?? (val.Value as ObjectValue)?.Type ?? "Object");
                }
            }
            objectValue.Name = key;
    
            if (!objectValue.ObjectReferenceId) {
                objectValue.ObjectReferenceId = ++this.currentVariablesRef;
            }
            */
            this.addValue(value);
            /*
            this.variablesRefCache.push(objectValue);
            let item = {
                name: key,
                type: objectValue.Type,
                value: this.cleanValue(objectValue),
                variablesReference: objectValue.ObjectReferenceId,
            };
            this.variables.push(item);*/
        } catch (e) {
            console.log(e);
        }

    }

    addValue(value: SimpleValue) {
        let i = this.variablesRefCache.findIndex(v => v.ObjectReferenceId === value.ObjectReferenceId);
        if (i >= 0) {
            this.variablesRefCache[i] = value;
        } else {
            this.variablesRefCache.push(value);
        }

        let item = {
            name: value.Name,
            type: value.Type,
            value: this.cleanValue(value),
            variablesReference: value.ObjectReferenceId
        } as DebugProtocol.Variable;

        i = this.variables.findIndex(v => v.name === item.name);
        if (i >= 0) {
            this.variables[i] = item;
        } else {
            this.variables.push(item);
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

        if (val.Type == this.StringType && val.Value.toString() != "[object Object]") {
            val = val.Value ?? '';
        } else if (typeof val == 'object') {
            val = (this.UseValue(val.Type, val)) ? val.Value : 'Object';
        }
        if (val == null) val = 'null';

        val = val.toString().replaceAll('\n', '').replaceAll('\r', '').replaceAll('\t', '');

        return val;
    }

    private UseValue(type : any, val : any) {
        if (!type) return true;

        const allowed = ["number", 'bool', "System.String", "System.Double", "System.Int", "System.Bool", "System.Date", "System.Guid"];
        
        let useValue = allowed.some(prefix => type.startsWith(prefix));
        console.log(useValue + ' | type:', type, val);
        return useValue;
    }
}



