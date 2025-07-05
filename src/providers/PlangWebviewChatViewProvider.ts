import * as vscode from 'vscode';
import * as fs from 'fs';
import { GoalParser } from '../GoalParser';
import { PlangHelper } from '../PlangHelper';
import { Util } from '../Util';
import { GoalDebugAdapterDescriptorFactory } from '../GoalDebugAdapterDescriptorFactory';
import { ObjectValue } from '../models/Models';
import { PlangProcess } from '../PlangProcess';

export class PlangWebviewChatViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'plangWebviewChat';
    private _view?: vscode.WebviewView;
    private goalParser : GoalParser;
    private debugFactory : GoalDebugAdapterDescriptorFactory;
    private context: vscode.ExtensionContext;
    private plangProcess : any;

    constructor(context: vscode.ExtensionContext, debugFactory : GoalDebugAdapterDescriptorFactory) {
        this.goalParser = new GoalParser();
        this.context = context;
        this.debugFactory = debugFactory;
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
        
       // this.loadChat(null);
    }

    public async loadChat(objectValue : any) {
        await vscode.commands.executeCommand('workbench.view.extension.plangChatSidebar');
        /*
        if (this.plangProcess == null) {
            this.plangProcess = new PlangProcess('/apps/Plang/apps/Ide/');
        }

        let args = [ 'content=hello', '--csdebug' ];
        this.plangProcess.callGoal('HtmlOut', args, (content : string) => {
            this._view!.webview.html = content;
            vscode.commands.executeCommand(PlangWebviewChatViewProvider.viewType + '.focus');
        }, (error : string) => {

            console.error(error);
        }, (delta : string) => {
            console.log(delta);
        });
        */


        var html = await PlangHelper.Call('ChatPanel', {llm: objectValue.Properties[0] });
        
        this._view!.webview.html = html;
        vscode.commands.executeCommand(PlangWebviewChatViewProvider.viewType + '.focus');
        
        

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
