import * as vscode from 'vscode';
import * as fs from 'fs';
import { GoalParser } from '../GoalParser';
import { PlangHelper } from '../PlangHelper';
import { PathHelper } from '../PathHelper';
import * as path from 'path';
import { Util } from '../Util';
import { StartDebugger } from '../StartDebugger';
import { PlangWebviewExecViewProvider } from './PlangWebviewExecViewProvider';
import { GuiCustomEditorProvider } from './GuiCustomEditorProvider';
import { PlangWebviewChatViewProvider } from './PlangWebviewChatViewProvider';
import { GoalDebugAdapterDescriptorFactory } from '../GoalDebugAdapterDescriptorFactory';

export class PlangWebviewViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'plangWebview';
    private _view?: vscode.WebviewView;
    private goalParser: GoalParser;

    private buildTerminal: vscode.Terminal | undefined;
    private runTerminal: vscode.Terminal | undefined;
    private startDebugger: StartDebugger;
    private context: vscode.ExtensionContext;
    private debugServerPort: number;
    private guiEditor : GuiCustomEditorProvider;
    private chatProvider : PlangWebviewChatViewProvider;
    private debugFactory : GoalDebugAdapterDescriptorFactory;

    constructor(context: vscode.ExtensionContext, startDebugger: StartDebugger, debugServerPort: number, guiEditor : GuiCustomEditorProvider, 
        chatProvider : PlangWebviewChatViewProvider, debugFactory : GoalDebugAdapterDescriptorFactory) {
        this.goalParser = new GoalParser();
        this.startDebugger = startDebugger;
        this.context = context;
        this.debugServerPort = debugServerPort;
        this.guiEditor = guiEditor;
        this.chatProvider = chatProvider;
        this.debugFactory = debugFactory;
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


        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openFile':
                        this.openFile(message.data); // Call extension function
                        break;
                    case 'build':
                        this.build(message.data.csdebug); // Call extension function
                        break;
                    case 'rebuildStep':
                        this.rebuildStep(message.data); // Call extension function
                        break;
                    case 'run':
                        this.run(message.data.onlyFile, message.data.csdebug); // Call extension function
                        break;
                    case 'gui':
                        this.buildGUI(); // Call extension function
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
        webviewView.webview.html = "Loading..."
        this.DisplayCodePanel();


    }

    public async DisplayCodePanel(type: string = ''): Promise<void> {
        if (!this._view) return;

        let html = '';
        if (type == 'llm') {
            var editor = Util.getEditor();

            html = await PlangHelper.Call('RenderLlm', { filePath: editor?.document.fileName });
            this._view!.webview.html = html;
            return;
        }
        var [goal, step, instruction] = this.goalParser.getStepAndGoal()
        let lineNumber = (step) ? step.LineNumber : -1;

        if (!goal) {
            html = await PlangHelper.Call('GoalNotFound', { appPath: '' });
        } else {
            html = await PlangHelper.Call('CodePanel', { appPath: goal.AbsoluteGoalFolderPath, goalBuildPath: goal.path, lineNumber: lineNumber });
        }

        if (step && step.ModuleType == 'PLang.Modules.LlmModule') {
            if (this.debugFactory.debugSession) {
                let variableName = instruction.Function.ReturnValues[0].VariableName;
               // this.chatProvider.loadChat(variableName);
            }            
        }

        this._view!.webview.html = html;
    }

    private loadBuildTerminal(folderPath: string) {
        if (!this.buildTerminal || this.buildTerminal.exitStatus) {
            this.buildTerminal = vscode.window.createTerminal({ name: 'PLang build', cwd: folderPath });
        } else {
            this.buildTerminal.sendText('cd "' + folderPath + '"');
            this.buildTerminal.sendText('clear');
        }

    }

    plangHelper = new PlangHelper();
    public async buildGUI() {
        await this.plangHelper.runApp('gui', async (output) => {
            
            let command = await vscode.window.showInputBox({
                        prompt: "What page are you creating? Frontpage, product page, category, search result, etc.",
                        value: ''
            });
            if (command === undefined) return;

            const uri = vscode.Uri.parse('untitled:' + path.join(command + '.gui'));
            await vscode.workspace.openTextDocument(uri);
            await vscode.commands.executeCommand(
                'vscode.openWith',
                uri,
                GuiCustomEditorProvider.viewType
            );

           this.guiEditor.setHtmlContent(output, uri);
        }, (error) => {
            console.log('error:' + error);
        }, (question, processName) => {
            console.log('question:' + question);
        }, ['/apps/Plang/Gui/ShowGuiBuilder']);

        //await this.plangHelper.sendInput('gui', 'test input');
    }

    public async build(csdebug: boolean) {
        var editor = Util.getEditor();
        var folderPath = PathHelper.getRootPath(editor?.document.fileName);
        this.loadBuildTerminal(folderPath);

        let llmServiceParam = '';
        let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'Plang';
        if (llmService != 'Plang') {
            llmServiceParam = '--llmservice=' + llmService;
        }
        if (csdebug) {
            llmServiceParam += ' --csdebug';
        }

        editor?.document.save();
        this.buildTerminal!.show();
        this.buildTerminal!.sendText('plang build ' + llmServiceParam.trim());
    }

    public async rebuildStep(data: any) {
        let filePath = data.path;
        let debug = data.debug;
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
        if (debug) {
            llmServiceParam += ' --csdebug';
        }
        editor?.document.save();
        this.buildTerminal!.show();
        this.buildTerminal!.sendText('plang build ' + llmServiceParam.trim());

    }



    public async openFile(filePath: any) {

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

    public async run(onlyFile: boolean, csdebug: boolean = false) {
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
