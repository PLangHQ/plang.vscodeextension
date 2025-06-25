import * as vscode from 'vscode';
import * as fs from 'fs';
import { GoalParser } from '../GoalParser';
import { PlangHelper } from '../PlangHelper';
import { Util } from '../Util';

export class PlangWebviewChatViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'plangWebviewChat';
    private _view?: vscode.WebviewView;
    private goalParser : GoalParser;

    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.goalParser = new GoalParser();
        this.context = context;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        console.log('resolveWebviewView for PlangWebviewViewProvider')
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true
        };


        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'chat':
                        this.chat(message.data); // Call extension function
                        break;                    
            }
            },
            undefined,
            this.context.subscriptions
        );
        webviewView.webview.html = "Loading..."
        this.DisplayChatPanel();            
    }

    public async DisplayChatPanel(): Promise<void> {
        if (!this._view) return;

        var [goal, step] = this.goalParser.getStepAndGoal()
        let lineNumber = (step) ? step.LineNumber : -1;
    
        var html = await PlangHelper.Call('ChatPanel', {currrentFile: goal.AbsoluteGoalFolderPath });
        
        this._view!.webview.html = html;
    }
    
    
    public async chat(message : any) {
    
        const editor = Util.getEditor();
        if (!editor) return;
        /*
        let baseAppPath = PathHelper.getRootPath(editor.document.fileName);
        let fullFilePath = path.join(baseAppPath, filePath)
        if (!filePath.startsWith('/')) {
            var dirPath = path.dirname(editor.document.fileName);
            fullFilePath = path.join(dirPath, filePath);
        }
    
        const document = await vscode.workspace.openTextDocument(fullFilePath);
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
        */
    }





    
    
}
