import * as vscode from 'vscode';
import * as fs from 'fs';
import { GoalParser } from './GoalParser';
import { PlangHelper } from './PlangHelper';
import { PathHelper } from './PathHelper';
import * as path from 'path';
import { Util } from './Util';
import { StartDebugger } from './StartDebugger';

export class PlangWebviewViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'plangWebview';
    private _view?: vscode.WebviewView;
    private goalParser : GoalParser;
    
    private buildTerminal: vscode.Terminal | undefined;
    private runTerminal: vscode.Terminal | undefined;
    private startDebugger : StartDebugger;
    private context: vscode.ExtensionContext;
    private debugServerPort : number ;

    constructor(context: vscode.ExtensionContext, startDebugger : StartDebugger, debugServerPort : number) {
        this.goalParser = new GoalParser();
        this.startDebugger = startDebugger;
        this.context = context;
        this.debugServerPort = debugServerPort;
        console.log('constructor for PlangWebviewViewProvider')
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
                    case 'openFile':
                        this.openFile(message.data); // Call extension function
                        break;
                    case 'build':
                        this.build(); // Call extension function
                        break;
                    case 'rebuildStep':
                        this.rebuildStep(message.data); // Call extension function
                        break;
                    case 'run':
                        this.run(message.data.onlyFile, message.data.csdebug); // Call extension function
                        break;                    
            }
            },
            undefined,
            this.context.subscriptions
        );
        webviewView.webview.html = "Loading..."
        this.DisplayCodePanel();

            
    }

    public async DisplayCodePanel(): Promise<void> {
        if (!this._view) return;
        
        var [goal, step] = this.goalParser.getStepAndGoal()
        let lineNumber = (step) ? step.LineNumber : -1;
        let html = '';
        if (!goal) {
            html = await PlangHelper.Call('GoalNotFound', {appPath: ''});
        } else {
            html = await PlangHelper.Call('CodePanel', {appPath: goal.AbsoluteGoalFolderPath, goalBuildPath: goal.path, lineNumber: lineNumber});
        }
        
        this._view!.webview.html = html;
    }

    private loadBuildTerminal(folderPath : string) {
        if (!this.buildTerminal || this.buildTerminal.exitStatus) {
            this.buildTerminal = vscode.window.createTerminal({ name: 'PLang build', cwd: folderPath });
        } else {
            this.buildTerminal.sendText('cd "' + folderPath + '"');
            this.buildTerminal.sendText('clear');
        }

    }
    
    public async build() {
        var editor = Util.getEditor();
        var folderPath = PathHelper.getRootPath(editor?.document.fileName);
        this.loadBuildTerminal(folderPath);
       
        let llmServiceParam = '';
        let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'Plang';
        if (llmService != 'Plang') {
            llmServiceParam = '--llmservice=' + llmService;
        }
        
        editor?.document.save();
        this.buildTerminal!.show();
        this.buildTerminal!.sendText('plang build ' + llmServiceParam.trim());
    }
    
    public async rebuildStep(filePath : any) {
        var editor = vscode.window.activeTextEditor;
        var folderPath = PathHelper.getRootPath(editor?.document.fileName);
    
        var prFilePath = path.join(folderPath, filePath);
    
        var extension = path.extname(prFilePath);
    
        if (extension == '.pr' && fs.existsSync(prFilePath)) {
            fs.rmSync(prFilePath);
        }
        this.loadBuildTerminal(folderPath);

        let llmServiceParam = '';
        let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'Plang';
        if (llmService != 'Plang') {
            llmServiceParam = '--llmservice=' + llmService;
        }
        
        editor?.document.save();
        this.buildTerminal!.show();
        this.buildTerminal!.sendText('plang build ' + llmServiceParam.trim());
    
    }
    
    
    
    public async openFile(filePath : any) {
    
        const editor = Util.getEditor();
        if (!editor) return;
    
        let baseAppPath = PathHelper.getRootPath(editor.document.fileName);
        let fullFilePath = path.join(baseAppPath, filePath)
        if (!filePath.startsWith('/')) {
            var dirPath = path.dirname(editor.document.fileName);
            fullFilePath = path.join(dirPath, filePath);
        }
    
        const document = await vscode.workspace.openTextDocument(fullFilePath);
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
        
    }

    public async run(onlyFile: boolean, csdebug : boolean = false) {
        let fileName = '';
        if (onlyFile) {
            var editor = Util.getEditor();
            if (editor) {
                let baseAppPath = PathHelper.getRootPath(editor.document.fileName);
                fileName = editor!.document.fileName.replace(baseAppPath, '')
            }
        }

        this.startDebugger.start(fileName, this.debugServerPort, csdebug);
    }




    
    
}
