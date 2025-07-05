// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';
import { Server } from 'http';
import { GoalDebugSession } from './debugAdapter'
import { GoalDebugAdapterDescriptorFactory } from './GoalDebugAdapterDescriptorFactory';
import { PlangCompletionProvider } from './providers/PlangCompletionProvider';
import 'source-map-support/register';
import { TextDecoration } from './TextDecoration';
import { StartDebugger } from './StartDebugger';
import { PathHelper } from './PathHelper';
import { Constants } from './depricated/Constants';
import * as child_process from 'child_process';
import { PlangHelper } from './PlangHelper';
import { DebugVariableHighlighter } from './depricated/DebugVariableHighlighter';
import { GoalParser } from './GoalParser';
import { Util } from './Util';
import { PlangWebviewViewProvider } from './providers/PlangWebviewViewProvider';
import { PlangWebviewChatViewProvider } from './providers/PlangWebviewChatViewProvider';
import { PlangWebviewExecViewProvider } from './providers//PlangWebviewExecViewProvider';
import { GuiCustomEditorProvider } from './providers/GuiCustomEditorProvider';
import { DebugAwareCodeLensProvider } from './providers/DebugAwareCodeLensProvider';
import { ObjectValue } from './models/Models';



let server: Server;
let startDebugger: StartDebugger;
let debugVariableHighlighter: DebugVariableHighlighter

let debugFactory: GoalDebugAdapterDescriptorFactory;
let debugSession : GoalDebugSession;
export let llmService: string;
let extContext: vscode.ExtensionContext;
let textDecoration: TextDecoration;
let goalParser: GoalParser;
let plangWebview: PlangWebviewViewProvider;
let plangWebviewChat: PlangWebviewChatViewProvider;
let plangWebviewExecPath: PlangWebviewExecViewProvider;
let guiEditor: GuiCustomEditorProvider;
let llmDecoratorType: vscode.TextEditorDecorationType;
let plangFolderPath : string;
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    
    // set csdebug on codepanel => args = ['--csdebug'], it will then point to PATH plang instance
    let args: any[] = [];
    plangFolderPath = await PathHelper.getPlangPath(args)

    extContext = context;
    goalParser = new GoalParser();

    debugVariableHighlighter = new DebugVariableHighlighter();
    context.subscriptions.push(debugVariableHighlighter);

    startDebugger = new StartDebugger(context);

    debugFactory = startDebugger.getDebugFactory();
    debugSession = debugFactory.debugSession!;

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider('goal', new PlangCompletionProvider(debugSession), '%'));

    guiEditor = new GuiCustomEditorProvider(context);
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(GuiCustomEditorProvider.viewType, guiEditor, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
    }));

    const lensProvider = new DebugAwareCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider('goal', lensProvider)
    );


     vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
        if (e.event === 'showLens') {
            lensProvider.setShowLens(e.body.objectValue);
        }
    });

  

    await setupServer();
    setupPlangServer().then(() => {
        console.log('I am here');
        let portNumber = (server.address() as any).port ?? 60788;

        plangWebviewChat = new PlangWebviewChatViewProvider(context, debugFactory);
        plangWebview = new PlangWebviewViewProvider(context, startDebugger, portNumber, guiEditor, plangWebviewChat, debugFactory);
        let plangWebviewProvider = vscode.window.registerWebviewViewProvider(PlangWebviewViewProvider.viewType, plangWebview, { webviewOptions: { retainContextWhenHidden: true } });
        context.subscriptions.push(plangWebviewProvider);
        
        let plangWebviewChatProvider = vscode.window.registerWebviewViewProvider(PlangWebviewChatViewProvider.viewType, plangWebviewChat, { webviewOptions: { retainContextWhenHidden: true } });
        context.subscriptions.push(plangWebviewChatProvider);

        vscode.commands.registerCommand('loadChat', (objectValue : ObjectValue) => {
            plangWebviewChat.loadChat(objectValue);
        })

        plangWebviewExecPath = new PlangWebviewExecViewProvider(context, startDebugger, portNumber);
        let plangWebviewExecProvider = vscode.window.registerWebviewViewProvider(PlangWebviewExecViewProvider.viewType, plangWebviewExecPath, { webviewOptions: { retainContextWhenHidden: true } });
        context.subscriptions.push(plangWebviewExecProvider);
        startDebugger.setExecPathPanel(plangWebviewExecPath);

        vscode.commands.executeCommand('workbench.view.extension.plangInfoSidebar');

    }).catch((e) => {
        console.error('I had error');
        console.error(e);
    });

    let disposable = vscode.commands.registerCommand('plang.selectLLMService', async () => {
        const options = ['Plang', 'OpenAI'];
        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Choose LLM code builder service',
        });

        if (selected) {
            await vscode.workspace.getConfiguration().update('plang.llmservice', selected, vscode.ConfigurationTarget.Global);
        }
    });

    context.subscriptions.push(disposable);

    setupDebugger(context);

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('goal');
    context.subscriptions.push(diagnosticCollection);

    console.log('Extension is activated!');

    context.subscriptions.push(vscode.commands.registerCommand('extension.runGoalFile', () => {
        plangWebview.run(true, false);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.run', () => {
        plangWebview.run(false, false);
    }));



    context.subscriptions.push(vscode.commands.registerCommand('extension.goToLine', (a, b, c) => {
        debugSession.goToLine(a)
        console.log(a, b, c);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.createStepTest', async (filePath) => {
        const [goal, step, prFile, fullMatch] = goalParser.getStepAndGoal();
        let absoluteGoalPrPath = path.join(goal.AbsoluteGoalFolderPath, goal.RelativePrFolderPath, Constants.GoalFileName)
        var result = await PlangHelper.Call("CreateStepTest",
            [{ "goalPath": absoluteGoalPrPath }, { "stepPrFileName": step.PrFileName }]);
        console.log(result);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('extension.build', () => {
        plangWebview.build(false);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('extension.runApp', async (app: string, parameters: any) => {
        await runApp(app, parameters);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('extension.findUsage', async (filePath) => {
        findUsage();

    }));


    

   
    llmDecoratorType = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.file('/media/icon.svg'),
        gutterIconSize: 'contain'
    });





    context.subscriptions.push(vscode.commands.registerCommand('extension.goToGoal', (a, b, c, d) => {
        var editor = vscode.window.activeTextEditor;
        goToGoal(a);
    }));

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.fileName.endsWith('.goal')) {
                // The id of the view container to reveal
                const viewId = 'PLang'; // replace with the id of your view

                // Reveal the view
                //vscode.commands.executeCommand('workbench.view.extension.' + viewId);
            }

            if (document.fileName.endsWith('.llm')) {
                var i = 0;
            }
        })
    );

    textDecoration = new TextDecoration(extContext);
    /*
    vscode.window.onDidChangeActiveTextEditor(loadGoal, null, context.subscriptions);
    loadGoal();
*/
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(event => {
            const editor = event.textEditor;

            if (editor.document.fileName.endsWith('.goal')) {
                plangWebview.DisplayCodePanel();
                plangWebviewChat.DisplayChatPanel();
                plangWebviewExecPath.DisplayExecutionPanel();
            } else if (editor.document.fileName.endsWith('.llm')) {
                plangWebview.DisplayCodePanel('llm');
            }
        })
    );

}


function setupDebugger(context: vscode.ExtensionContext) {

    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((debugSession) => {
        // Check if the terminated session is the one we're interested in
        var ds = debugFactory.debugSession as GoalDebugSession;
        //if (debugSession === ds) {
        // Debug session has ended, reset debugFactory.debugSession
        debugFactory.debugSession?.clearDecorations();
        debugFactory.debugSession = undefined;

        console.log('Debug session ended');
        plangWebviewExecPath.Clear();
        //}
    }));

    let disposable = vscode.commands.registerCommand('extension.startPLangDebug', async (fileName: string) => {
        startDebugger.start(fileName, (server.address() as any).port ?? 60788, false);
    });
    let disposable2 = vscode.commands.registerCommand('extension.runFromStep', async (prFileName: any) => {
        continueWithRequest(prFileName, false)
    });
    let disposable3 = vscode.commands.registerCommand('extension.runFromStepCSharpDebugger', async (prFileName: any) => {
        continueWithRequest(prFileName, true)
    });

    function continueWithRequest(prFileName: any, csharpDebugger: boolean) {
        if (!prFileName.path && prFileName.path.indexOf('.goal') == -1) return;

        var editor = Util.getEditor();
        if (!editor) return;

        const lineNumber = editor.selection.start.line;
        const [goal, step, prFile, fullMatch] = goalParser.getStepAndGoal();

        const fileUri = vscode.Uri.file(prFileName.path); // assuming 'fileName' is the full path to the file
        const position = new vscode.Position(lineNumber, 0); // line number is 0-indexed

        // Create the location for the breakpoint
        const location = new vscode.Location(fileUri, position);
        // Create the breakpoint
        const breakpoint = new vscode.SourceBreakpoint(location);

        let breakpoints = vscode.debug.breakpoints;
        let goalPath = path.join(goal.AbsoluteGoalFolderPath, goal.RelativeGoalPath);

        let fileBreakpoints = breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint
            && bp.enabled && bp.location.range.start.line == (step.LineNumber - 1) &&
            path.normalize(bp.location.uri.fsPath).toLowerCase() === goalPath.toLowerCase()
        ) as vscode.SourceBreakpoint[];

        if (fileBreakpoints.length == 0) {
            // Add breakpoint to the debug session
            vscode.debug.addBreakpoints([breakpoint]);
        }
        debugFactory.debugSession!.continueWithRequest(currentResponse, undefined, { prFileName: step.RelativePrPath, csharpDebugger: csharpDebugger });
    };
    context.subscriptions.push(disposable);
    context.subscriptions.push(disposable2);
    context.subscriptions.push(disposable3);
}

function goToGoal(a: any) {
    //should navigate to a goal if user is at !CallGoal
}



// This method is called when your extension is deactivated
export function deactivate() {
    if (server) {
        console.error(`Closing webserver`);
        server.close();
    } else {
        console.error(`Server instance could not be found to shutdown`);
    }

}

let currentResponse: any = null;
async function setupServer() {
    console.log("Setup debug server");

    const app = express();
    app.use(express.json({ limit: '500mb' }));
    app.use(express.urlencoded({ limit: '500mb', extended: true }));
    app.post('/', async (req, res) => {
        try {
            currentResponse = res;
            const data = req.body;
            if (data.type && data.type == 'execution') {
                await plangWebviewExecPath.executeFunc(data);
                res.send('{"ok":true}');
            } else if (debugFactory.debugSession) {
                let result = await debugFactory.debugSession!.checkBreakpoint(data, res);
                console.log('result', result);
            } else {
                res.send('{"ok":true}');
            }

            //currentResponse = null;
        } catch (e) {
            console.error(e);
            res.send('{"ok":true}');
        } finally {
            //currentResponse = null;

        }
    });

    server = await startListening(app);
}

async function setupPlangServer() {
    return new Promise(async (resolve, reject) => {
        const plangServerPath = path.join(__dirname, "plang");
        let plangExec = PathHelper.PlangExecutable;
        let plangArgs = PathHelper.PlangExecutableArgs;

        let plangServer = child_process.spawn(plangExec, plangArgs, { cwd: plangServerPath });
        plangServer.stdout!.on('data', (data: any) => {
            console.log(`plangSever stdout: ${data}`);

            if (data.includes('Keeping app alive')) { // Adjust this condition
                resolve(1);
            }
        });

        plangServer.stderr!.on('data', (data: any) => {
            console.error(`plangServer stderr: ${data}`);
        });

        plangServer.on('close', (code: any) => {
            console.log('plangServer close:', code)
        });
    });
}

async function startListening(app: express.Application, port: number = 60877): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            console.log(`Server started on port ${port}`);
            resolve(server); // Return the valid server instance
        });

        server.on('error', async (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${port} is in use. Trying port ${port + 2}...`);
                resolve(await startListening(app, port + 2)); // Try next port
            } else {
                reject(err); // Fatal error
            }
        });
    });

}

async function runApp(app: string, parameters: any[]) {

    await PlangHelper.RunApp("/apps/" + app, parameters);

}

async function findUsage() {
    var editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const fileName = editor.document.fileName;
    const lineNumber = editor.selection.start.line;
    var textInLine = editor.document.lineAt(lineNumber).text;

    var [goal, step, prFile] = goalParser.getStepAndGoal();
    if (step == null && goal == null) return;

    var rootPath = PathHelper.getRootPath(fileName);
    if (step == null) {
        var specificPath = path.join(rootPath, '.build');
        const normalizedPath = specificPath.replace(/\\/g, '/');
        const pattern = `${normalizedPath}/**/*.pr`;
        const files = await findPrFilesAtPath(specificPath);
        for (var i = 0; i < files.length; i++) {
            if (files[i].indexOf('00. Goal.pr') == -1) continue;

            const data = await fs.readFileSync(files[i]);
            var prObj = JSON.parse(data.toString());
            for (var b = 0; b < prObj.GoalSteps.length; b++) {
                if (prObj.GoalSteps[b].ModuleType == 'PLang.Modules.CallGoalModule') {
                    var modulePath = path.join(rootPath, prObj.GoalSteps[b].RelativePrPath);
                    const modulePrFile = await fs.readFileSync(modulePath);
                    var modulePrObj = JSON.parse(modulePrFile.toString());
                    if (modulePrObj.Action.Parameters && modulePrObj.Action.Parameters[0].Value == goal.GoalName) {
                        console.log('hallo')
                    }
                    var o = 0;
                }
            }
        }
        var b = 0;
    }

    var i = 0;
}

async function findPrFilesAtPath(dir: string): Promise<string[]> {
    let results: string[] = [];

    async function recurse(currentDir: string) {
        const files = await fs.promises.readdir(currentDir, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(currentDir, file.name);
            if (file.isDirectory()) {
                await recurse(fullPath);
            } else if (file.isFile() && fullPath.endsWith('.pr')) {
                results.push(fullPath);
            }
        }
    }

    await recurse(dir);
    return results;
}

export async function findVariableRanges(variableName: string | undefined = undefined): Promise<vscode.Range[]> {
    let editor = await Util.getEditor();
    if (!editor) return [];

    var document = editor.document;

    const ranges: vscode.Range[] = [];
    const text = document.getText();
    const regex = /%[a-zA-Z0-9_]+%/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (variableName && variableName != match[0]) continue;

        const start = document.positionAt(match.index);
        const end = document.positionAt(match.index + match[0].length);
        ranges.push(new vscode.Range(start, end));
    }
    return ranges;
}

export async function setLlmRequest(variableName: string) {
    var ranges = await findVariableRanges(variableName);

    var editor = await Util.getEditor();
    if (!editor) return;

    //editor.setDecorations(llmDecoratorType, ranges);

}