import * as vscode from 'vscode';
import * as fs from 'fs';
import { GoalParser } from '../GoalParser';
import { PlangHelper } from '../PlangHelper';
import { Util } from '../Util';
import { PathHelper } from '../PathHelper';
import path = require('path');

import { StartDebugger } from '../StartDebugger';

interface Box {
    name: string;
    hash: string;
    steps: Steps[];
}

interface Steps {
    name: string;
    status: string;
    extraInfo: string;
    hash: string;
    variables: any[] | undefined;
}

export class PlangWebviewExecViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'plangWebviewExec';
    private _view?: vscode.WebviewView;
    private boxes: Box[] = [];
    private context: vscode.ExtensionContext;
        private startDebugger : StartDebugger;
        private portNumber : number;

    constructor(context: vscode.ExtensionContext, startDebugger : StartDebugger, portNumber : number) {
        this.context = context;
        this.startDebugger = startDebugger;
        this.portNumber = portNumber;
    }


    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = ''
        this.DisplayExecutionPanel();

        webviewView.webview.onDidReceiveMessage(
            message => {
                console.log('onDidReceiveMessage', message);
                switch (message.command) {
                    case 'run':
                        this.run(); // Call extension function
                        break;                    
            }
            },
            undefined,
            this.context.subscriptions
        );

        var editor = Util.getEditor();
        if (!editor) return;
        this.baseAppPath = PathHelper.getRootPath(editor.document.fileName);
    }

    public async run() {
        this.startDebugger.start('', this.portNumber, false);
    }


    hasLoaded = false;
    public async DisplayExecutionPanel(): Promise<void> {
        if (!this._view) return;
        if (!this.hasLoaded) {
            this._view!.webview.html = await this.getHtmlContent();
            this.hasLoaded = true;
        }

        var editor = Util.getEditor();
        if (!editor) return;

        this.baseAppPath = PathHelper.getRootPath(editor.document.fileName);
    }
    baseAppPath: string = '';
    public async executeFunc(obj: any) {

        if (obj.action == 'start') {
            this.startFunc(obj.goal, obj.isOs);
        } else if (obj.action == 'end') {
            this.endFunc();
        } else if (obj.action == 'start_step' || obj.action == 'end_step') {
            if (!this.boxes) return;
            
            var steps = this.boxes[this.boxes.length - 1].steps;
            let isDone = true;
            for (var i = 0; i < steps.length; i++) {
                if (steps[i].hash != obj.step.Hash) {
                    if (isDone) {
                        steps[i].status = 'executed'
                    } else {
                        steps[i].status = 'waiting_to_executed'
                    }
                } else {
                    isDone = false;
                    steps[i].status = 'executing';
                    steps[i].variables = obj.variables;
                    await this.openFile(obj.step);
                }
            }

            this.boxes[this.boxes.length - 1].steps = steps;
            this.updateWebview();
        }

    }

    arrowDecoration : vscode.TextEditorDecorationType | undefined;

    public getArrowDeocoration() {

        if (this.arrowDecoration) return this.arrowDecoration;

        this.arrowDecoration = vscode.window.createTextEditorDecorationType({
            before: {
                contentText: '➡️',  // or '➔' or '➤' depending what arrow you like
                margin: '0 8px 0 0',
                color: 'gray',
                width: '20px'
            }
        });

        return this.arrowDecoration;
    }
    
    
    public async openFile(step: any) {        

        const fileUri = vscode.Uri.file(path.join(this.baseAppPath, step.RelativeGoalPath));
        const document = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(document, {
            preserveFocus: true,
            viewColumn: vscode.ViewColumn.One,
            preview: false
        });
        const position = new vscode.Position(step.LineNumber - 1, 0); // VS Code lines are 0-based

        editor.setDecorations(this.getArrowDeocoration(), []);
        editor.setDecorations(this.getArrowDeocoration(), [new vscode.Range(position, position)]);
    }

    public startFunc(goal: any, isOs : boolean) {

        if (isOs) return;

        let steps: Steps[] = [];
        if (goal.GoalSteps) {
            for (let i = 0; i < goal.GoalSteps.length; i++) {
                let step = goal.GoalSteps[i];
                steps.push({ name: step.Text, hash: step.Hash, status: 'waiting_to_executed', extraInfo: '', variables: undefined });
            }
        }
        this.boxes.push({
            name: goal.GoalName,
            steps: steps,
            hash: goal.Hash
        });
        this.updateWebview();
    }

    public endFunc() {
        this.boxes.pop();
        this.updateWebview();

    }

    public async Clear() {
        
        this.boxes = [];
        var i = 0;

        this._view?.webview.postMessage({
            type: 'debuggerOffline'
        });
        
        this.arrowDecoration?.dispose();
        

    }

    public async debuggerStarting() {
        this._view?.webview.postMessage({
            type: 'debuggerStarting'
        });
        this.boxes = []
        this.updateWebview();
    }

    private async updateWebview() {
        this._view?.webview.postMessage({
            type: 'updateBoxes',
            boxes: this.boxes
        });
    }


    private async getHtmlContent(): Promise<string> {
        const boxesData = JSON.stringify(this.boxes);
        var html = await PlangHelper.Call('ExecutionPath', { boxesData });
        return html;
    }

}
