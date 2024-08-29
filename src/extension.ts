// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import { DocumentationProvider } from './DocumentationProvider';
import { CodeProvider } from './CodeProvider';
import { SourceCodeProvider } from './SourceCodeProvider';
import { Info } from './Info';
import * as path from 'path';
import * as express from 'express';
import * as cp from 'child_process';
import { Server } from 'http';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent } from '@vscode/debugadapter';
import { GoalDebugSession } from './debugAdapter'
import { GoalDebugAdapterDescriptorFactory } from './GoalDebugAdapterDescriptorFactory';
import { PlangCompletionProvider } from './PlangCompletionProvider';
import * as chokidar from 'chokidar';
import { error } from 'console';

import { TextDecoration } from './TextDecoration';
import { StartDebugger } from './StartDebugger';
import { PathHelper } from './PathHelper';
import { Constants } from './Constants';

let sourceProvider: SourceCodeProvider;
let documentationProvider: DocumentationProvider;
let codeProvider: CodeProvider;

let runTerminal: vscode.Terminal;
let buildTerminal: vscode.Terminal;
let server: Server;
let startDebugger : StartDebugger;

let debugDescriptor: GoalDebugAdapterDescriptorFactory;
export let llmService: string;
let extContext: vscode.ExtensionContext;
let textDecoration : TextDecoration;
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    extContext = context;    
    setupServer();

    startDebugger = new StartDebugger(context);
    debugDescriptor = startDebugger.getDebugDescriptor();

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider('goal', new PlangCompletionProvider(debugDescriptor.debugSession!), '%'));

    isBuilding = false;

    let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'plang';
    Info.RebuildFile = Info.ClickToBuildStr + '(' + llmService + ')';

    let disposable = vscode.commands.registerCommand('plang.selectLLMService', async () => {
        const options = ['Plang', 'OpenAI'];
        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Choose LLM code builder service',
        });

        if (selected) {
            await vscode.workspace.getConfiguration().update('plang.llmservice', selected, vscode.ConfigurationTarget.Global);
            displayStep(vscode.window.activeTextEditor);
        }
    });

    context.subscriptions.push(disposable);

    setupDebugger(context);

    console.log('Extension is activated!');
    documentationProvider = new DocumentationProvider();
    var documentationTreeView = vscode.window.createTreeView('documentation', {
        treeDataProvider: documentationProvider,
    });
    documentationProvider.treeView = documentationTreeView;

    sourceProvider = new SourceCodeProvider();
    var sourceTreeView = vscode.window.createTreeView('source', {
        treeDataProvider: sourceProvider,
    });
    sourceProvider.treeView = sourceTreeView;

    codeProvider = new CodeProvider();
    var codeTreeView = vscode.window.createTreeView('code', {
        treeDataProvider: codeProvider,
    });
    codeProvider.treeView = codeTreeView;


    context.subscriptions.push(vscode.commands.registerCommand('extension.runGoalFile', () => {
        Run(true);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.run', () => {
        Run(false)
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.goToLine', (a, b, c) => {
        debugDescriptor.debugSession?.goToLine(a)
        console.log(a, b, c);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.regenerateStep', (filePath) => {
        regenerateStep(filePath);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('extension.findUsage', async (filePath) => {
        findUsage();
       
    }));

    

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
                vscode.commands.executeCommand('workbench.view.extension.' + viewId);
            }
        })
    );

    textDecoration = new TextDecoration(extContext);
    vscode.window.onDidChangeActiveTextEditor(loadGoal, null, context.subscriptions);
    loadGoal();
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(event => {
            const editor = event.textEditor;

            if (editor.document.fileName.endsWith('.goal')) {
                // Get the line number
                displayStep(editor);
            }
        })
    );


}

function loadGoal() {
    var editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const lineNumber = editor.selection.start.line;
    const [goal, step, prFile, fullMatch] = getStepAndGoal(editor, lineNumber);
    extContext.globalState.update('goal', goal);
    extContext.globalState.update('step', step);
    extContext.globalState.update('prFile', prFile);

}

let isBuilding = false;


function setupDebugger(context: vscode.ExtensionContext) {

    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((debugSession) => {
        // Check if the terminated session is the one we're interested in
        var ds = debugDescriptor.debugSession as GoalDebugSession;
        //if (debugSession === ds) {
        // Debug session has ended, reset debugDescriptor.debugSession
        debugDescriptor.debugSession?.clearDecorations();
        debugDescriptor.debugSession = undefined;

        console.log('Debug session ended');
        //}
    }));

    let disposable = vscode.commands.registerCommand('extension.startPLangDebug', async (fileName : string) => {
        startDebugger.start(fileName);        
    });

    context.subscriptions.push(disposable);
}

function goToGoal(a: any) {
    //should navigate to a goal if user is at !CallGoal
}

function Run(onlyFile: boolean) {
    var editor = vscode.window.activeTextEditor;
    var folderPath = PathHelper.getRootPath(editor?.document.fileName);
    if (!runTerminal || runTerminal.exitStatus) {
        runTerminal = vscode.window.createTerminal('PLang runner');
    } else {
        runTerminal.sendText('clear')
    }
    let cmd = 'plang run';
    if (onlyFile) {
        cmd += ' ' + path.basename(editor!.document.fileName);
    }
    runTerminal.sendText(`cd "${folderPath}"`)
    runTerminal.show(true);
    runTerminal.sendText(cmd);

    DebugSession.run(GoalDebugSession)
}

function displayStep(editor?: vscode.TextEditor, refreshSourceView = true) {
    try {
        if (!editor) return;

        sourceProvider.data = [];
        if (documentationProvider.treeView) documentationProvider.treeView.message = '';
        documentationProvider.data = [];
        codeProvider.data = [];

        const lineNumber = editor.selection.start.line;
        var textInLine = editor.document.lineAt(lineNumber).text;
        const [goal, step, prFile, fullMatch] = getStepAndGoal(editor, lineNumber);
        extContext.globalState.update('goal', goal);
        extContext.globalState.update('step', step);
        extContext.globalState.update('prFile', prFile);

        

        if (goal == undefined) {

            documentationProvider.data = ['File not build'];
            documentationProvider.refresh();

            codeProvider.data = [new Info('Not built', Info.RebuildFile, editor.document.fileName)];
            codeProvider.data.push(new Info('Win: Ctrl+shift+b', '', ''))
            codeProvider.data.push(new Info('Mac: cmd+k', '', ''))
            codeProvider.data.push(new Info('This may take few mins', '', ''));
            codeProvider.data.push(new Info('=========', '', ''));
            codeProvider.data.push(new Info('Help to build steps', '', 'https://github.com/PLangHQ/plang/tree/main/Documentation/modules/README.md#writing-plang-code'));
            codeProvider.refresh();
            sourceProvider.refresh();
            return;
        } else if (goal.GoalName == textInLine) {
            documentationProvider.treeView!.message = goal.GoalName;

            documentationProvider.refresh();

            codeProvider.data = [new Info(goal.GoalName, goal.GoalName, editor.document.fileName)];
            codeProvider.data.push(new Info('Step count', goal.GoalSteps.length, ''));
            codeProvider.data.push(new Info('Open pr file', 'Click to open', goal.path));
            if (goal.GoalApiInfo != null) {
                codeProvider.data.push(new Info('-- Http Response Information --', '', ''));
                codeProvider.data.push(new Info('Method', goal.GoalApiInfo.Method, ''));
                documentationProvider.treeView!.message = goal.GoalApiInfo.Description;
                codeProvider.data.push(new Info('ContentEncoding', goal.GoalApiInfo.ContentEncoding, ''));
                codeProvider.data.push(new Info('ContentType', goal.GoalApiInfo.ContentType, ''));
                codeProvider.data.push(new Info('MaxContentLengthInBytes', goal.GoalApiInfo.MaxContentLengthInBytes, ''));
                if (goal.GoalApiInfo.CacheControlPrivateOrPublic != null) {
                    codeProvider.data.push(new Info('CacheControlPrivateOrPublic', goal.GoalApiInfo.CacheControlPrivateOrPublic, ''));
                }
                if (goal.GoalApiInfo.CacheControlMaxAge != null) {
                    codeProvider.data.push(new Info('CacheControlMaxAge', goal.GoalApiInfo.CacheControlMaxAge, ''));
                }
                if (goal.GoalApiInfo.NoCacheOrNoStore != null) {
                    codeProvider.data.push(new Info('NoCacheOrNoStore', goal.GoalApiInfo.NoCacheOrNoStore, ''));
                }
            }


            codeProvider.data.push(new Info('====', '======', ''));
            codeProvider.data.push(new Info('Run this file', "Run " + goal.GoalName, 'prompt:' + goal.RelativeGoalPath, startDebugger));
            codeProvider.data.push(new Info('Rebuild', Info.RebuildFile, goal.RelativePrPath));

            codeProvider.data.push(new Info('====', '======', ''));
            codeProvider.data.push(new Info('Help to build steps', '', 'https://github.com/PLangHQ/plang/tree/main/Documentation/modules#writing-plang-code'));
            codeProvider.refresh();
            sourceProvider.refresh();
            return;
        }
        if (isBuilding) return;
        if (textInLine.trim().startsWith('/')) {
            codeProvider.refresh();
            sourceProvider.refresh();
            documentationProvider.refresh();
            return;
        }
        if ((!step && step == null) || step.PrFileName == null || !prFile) {
           
            documentationProvider.data = ['Step has changed'];
            documentationProvider.refresh();

            codeProvider.data = [new Info('Step has changed', Info.RebuildFile, editor.document.fileName)];
            codeProvider.data.push(new Info('====', '======', ''));
            codeProvider.data.push(new Info('Help me to build steps', '', 'https://github.com/PLangHQ/plang/tree/main/Documentation/modules#writing-plang-code'));
        
            codeProvider.refresh();
            sourceProvider.refresh();
            return;
        }
        if (step != null) {
            documentationProvider.treeView!.message = step.Description;
        }
        documentationProvider.refresh();

        if (refreshSourceView) ShowCode('');
        codeProvider.treeView!.message = '';
        if (prFile) {

            codeProvider.data.push(new Info('Module', step.ModuleType, ''));
            codeProvider.data.push(new Info('Documentation', 'Click to open', 'https://github.com/PLangHQ/plang/blob/main/Documentation/modules/' + step.ModuleType + '.md'));
            codeProvider.data.push(new Info('Open pr file', 'Click to open', prFile.path));
            if (prFile.Action) {
                if (prFile.Action.Code) {
                    ShowCode(prFile.Action.Code);
                }

                DisplayAction(prFile.Action, prFile.path);

            } else {
                codeProvider.data.push(new Info(prFile.Action, prFile, prFile.path));
            }
            DisplayEventHandlers(step.ErrorHandlers, step.PrFileName);
            DisplayGoalInfo(codeProvider, goal, step);
            codeProvider.data.push(new Info('====', '======', ''));
            codeProvider.data.push(new Info('Run this file', "Run " + goal.GoalName, 'prompt:' + goal.RelativeGoalPath));
            codeProvider.data.push(new Info('Rebuild', Info.RebuildFile, prFile.path));
        } else if (step.ErrorHandlers && step.ErrorHandlers) {
            codeProvider.data.push(new Info('Module', step.ModuleType, goal.path));
            codeProvider.data.push(new Info('Open pr file', 'Click to open', goal.path));
            DisplayEventHandlers(step.ErrorHandlers, step.PrFileName);

            codeProvider.data.push(new Info('====', '======', ''));
            codeProvider.data.push(new Info('Run this file', "Run " + goal.GoalName, 'prompt:' + goal.RelativeGoalPath));
            codeProvider.data.push(new Info('Rebuild', Info.RebuildFile, goal.path));
        }

        codeProvider.refresh();
        sourceProvider.refresh();
        documentationProvider.refresh();
        if (!fullMatch) {
            addLineForDecoration(lineNumber);
        } else {
            removeLineForDecoration(lineNumber);
        }
        decorate();
    } catch (e) {
        console.error(e);
        return;
    }
}
let decorationLines: number[] = [];
function DisplayGoalInfo(codeProvider: any, goal: any, step: any) {
    var goalStepInfo = null;
    for (var i = 0; i < goal.GoalSteps.length; i++) {
        if (goal.GoalSteps[i].Text == step.Text) {
            goalStepInfo = goal.GoalSteps[i];
        }
    }
    if (goalStepInfo == null) return;

    if (goalStepInfo.CacheHandler != null) {
        var info = new Info('CacheHandler', goalStepInfo.CacheHandler, '');
        codeProvider.data.push(info);
    }
    if (goalStepInfo.ErrorHandler != null) {
        codeProvider.data.push(new Info('ErrorHandler', goalStepInfo.ErrorHandler, ''));
    }
    if (goalStepInfo.RetryHandler != null) {
        codeProvider.data.push(new Info('RetryHandler', goalStepInfo.RetryHandler, ''));
    }
}

function ShowCode(code: string) {

    sourceProvider.treeView!.message = code.replaceAll('α', '.');
    sourceProvider.refresh();
}

function DisplayEventHandlers(eventHandlers : any, filePath : string) {
    if (!eventHandlers) return;
    codeProvider.data.push(new Info("EventHandlers", eventHandlers, filePath));

}

function DisplayAction(action: any, filePath: string) {
    var props = Object.getOwnPropertyNames(action);
    for (let b = 0; b < props.length; b++) {
        let property = action[props[b]];
        if (props[b] == 'Implementation' || props[b] == 'Code') {

        } else {
            codeProvider.data.push(new Info(props[b], property, filePath));
        }
    }
}
function addLineForDecoration(line: number) {
    decorationLines.push(line);
}
function removeLineForDecoration(line: number) {
    decorationLines = decorationLines.filter(num => num !== line);
}



function decorate() {
    /*
    let activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) return;



    const decorationsArray: vscode.DecorationOptions[] = [];
    activeEditor.setDecorations(decorationType, []);
    for (let i = 0; i < decorationLines.length; i++) {
        const decoration = {
            range: new vscode.Range(new vscode.Position(decorationLines[i], 0), new vscode.Position(decorationLines[i], 0))
        };

        decorationsArray.push(decoration);
    }

    activeEditor.setDecorations(decorationType, decorationsArray);
    */
}

function getStepAndGoal(editor: vscode.TextEditor, lineNumber: number): [any, any, any, boolean] {

    let baseAppPath = PathHelper.getRootPath(editor.document.fileName);
    if (baseAppPath == '') baseAppPath = path.dirname(editor.document.fileName);

    let filePath = editor.document.fileName.replace(baseAppPath, '');
    let goalBuildPath = path.join(baseAppPath, '.build', filePath.replace('.goal', ''));

    const [goalText, goalLineNr, isFirstGoal] = getGoal(editor, lineNumber);
    const goalPath = (isFirstGoal) ? goalBuildPath :
        path.join(goalBuildPath, goalText);
    const goalFilePath = path.join(goalPath, Constants.GoalFileName);
    if (!fs.existsSync(goalFilePath)) {
        return [undefined, undefined, undefined, false];
    }
    let goalPrFileContent = '';
    let [stepText, lineNr2] = ['', 0];
    let goal = null;
    try {
        [stepText, lineNr2] = getStep(editor, lineNumber, goalLineNr);
        goalPrFileContent = fs.readFileSync(goalFilePath).toString();
        if (goalPrFileContent != '') {
            goal = JSON.parse(goalPrFileContent);
        }
    } catch (e) {
        console.error(e);
        console.info("content:'" + goalPrFileContent + "'");
    }
    if (goal == null || goal == '') {
        return [null, null, undefined, false]
    }
    goal.path = goalFilePath;
    let step;
    let nr;
    let fullMatch = false;
    for (let i = 0; stepText != '' && i < goal.GoalSteps.length; i++) {
        try {
            if (goal.GoalSteps[i].Text.trim() == stepText.trim()) {
                nr = (i + 1).toString().padStart(2, '0');
                step = goal.GoalSteps[i];
                fullMatch = true;
                i = goal.GoalSteps.length;
            } else if (goal.GoalSteps[i].Text.indexOf(stepText.trim()) != -1) {
                nr = (i + 1).toString().padStart(2, '0');
                step = goal.GoalSteps[i];
                i = goal.GoalSteps.length;
            }
        } catch (e) {
            console.log('jeebbbb')
        }
    }

    if (step == undefined) {
        return [goal, null, undefined, false]
    }
    if (step.RelativePrPath == null) {
        return [goal, step, null, fullMatch];
    }
    const prFilePath = path.join(baseAppPath, step.RelativePrPath);
    if (!fs.existsSync(prFilePath)) {
        return [goal, step, null, fullMatch];
    }

    const prFileContent = fs.readFileSync(prFilePath);
    const prFile = JSON.parse(prFileContent.toString());

    prFile.path = prFilePath;
    return [goal, step, prFile, fullMatch]
}

function getStep(editor: vscode.TextEditor, lineNumber: number, goalLineNr: number): [string, number] {
    if (lineNumber < 0 || editor.document.lineCount < lineNumber) return ['', 0];
    try {
        var line: vscode.TextLine = editor.document.lineAt(lineNumber);
        if (line.text.trim().startsWith('-')) {
            return [line.text.replace('-', '').trim(), lineNumber];
        }

        if (line.text.trim().startsWith('/')) {
            return getStep(editor, lineNumber + 1, goalLineNr);
        }

        if (line.text.startsWith(' ') || line.text.startsWith('\t')) {
            return getStep(editor, lineNumber - 1, goalLineNr)
        }
        return ['', lineNumber];
    } catch (e) {
        console.error('Illegal value for line: lineNumber is : ' + lineNumber);
        console.error(e);
        return ['', 0];
    }
}

function getGoal(editor: vscode.TextEditor, lineNumber: number): [string, number, boolean] {
    if (lineNumber < 0) return ['', 0, true];

    var line: vscode.TextLine = editor.document.lineAt(lineNumber);

    if (line.text != '' && line.text[0] && line.text[0].match(/^[a-zA-Z0-9]+$/)) {
        var firstGoal = isFirstGoal(editor, lineNumber);
        return [line.text, lineNumber, firstGoal];
    }

    return getGoal(editor, lineNumber - 1)
}

function isFirstGoal(editor: vscode.TextEditor, lineNumber: number) {
    if (lineNumber == 0) return true;

    lineNumber--;
    var line: vscode.TextLine = editor.document.lineAt(lineNumber);
    if (line.text != '' && line.text[0].match(/^[a-zA-Z0-9]+$/)) {
        return false;
    }
    if (lineNumber == 0) return true;

    return isFirstGoal(editor, lineNumber);
}

// This method is called when your extension is deactivated
export function deactivate() {
    if (server) {
        server.close();
    }

}


function setupServer() {
    console.log("Setup debug server");

    const app = express();
    app.use(express.json({ limit: '500mb' }));
    app.use(express.urlencoded({ limit: '500mb', extended: true }));
    app.post('/', async (req, res) => {
        try {
            const data = req.body;

            if (debugDescriptor.debugSession) {
                await debugDescriptor.debugSession!.checkBreakpoint(data, res);
            } else {
                res.send('{"ok":true}');
            }
        } catch (e) {
            console.error(e);
        }


    });
    try {
        server = app.listen(60877, () => {
            console.log('Server started on port 60877');
        });
        server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`Port 60877 is already in use. Cannot start debug server. `);
            } else {
                console.error(`An error occurred: ${err.message}`);
            }
        });


        console.log('this is server', server);
    } catch (e) {
        console.log('Port 60877 is being used')
    }
}

function regenerateStep(filePath: any) {
    var editor = vscode.window.activeTextEditor;
    var fileOrFolderPath = (filePath) ? filePath.path : editor?.document.fileName;
    codeProvider.data = [new Info('Rebuilding', '', '')];
    codeProvider.refresh();
    var extension = path.extname(fileOrFolderPath);
    if (!fs.existsSync(fileOrFolderPath) && fs.existsSync(fileOrFolderPath.substring(1))) {
        fileOrFolderPath = fileOrFolderPath.substring(1);
    }
    if (extension == '.pr' && fs.existsSync(fileOrFolderPath)) {
        fs.rmSync(fileOrFolderPath);
    }

    var folderPath = PathHelper.getRootPath(fileOrFolderPath);
    if (folderPath == '') {
        console.log('Could not find build folder');
        codeProvider.data.push(new Info('This may take some time', '', ''))
        codeProvider.data.push(new Info('Build info is in Source panel', '', ''))

        codeProvider.data.push(new Info('You can run "plang build" in terminal', '', ''))
        folderPath = path.dirname(fileOrFolderPath);
    }

    var editor = vscode.window.activeTextEditor;
    var folderPath = PathHelper.getRootPath(editor?.document.fileName);
    if (!buildTerminal || buildTerminal.exitStatus) {
        buildTerminal = vscode.window.createTerminal({ name: 'PLang build', cwd: folderPath });
    } else {
        buildTerminal.sendText('cd "' + folderPath + '"');
        buildTerminal.sendText('clear');
    }
    let llmServiceParam = '';
    let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'Plang';
    if (llmService != 'Plang') {
        llmServiceParam = '--llmservice=' + llmService;
    }
    
    editor?.document.save();
    buildTerminal.show();
    buildTerminal.sendText('plang build ' + llmServiceParam.trim());

    const watcher = chokidar.watch(folderPath, {
        persistent: true, ignoreInitial: true,
    });


    watcher.on('change', (path) => {
        if (path.indexOf('.') == 0) return;

        if (lastFileChange == null) {
            lastFileChange = new Date().getTime();
            setTimeout(() => {
                var editor = vscode.window.activeTextEditor;
                callDisplayStep(editor);
            }, 1000);
        }



    });


}
let lastFileChange: number | null = null;
function callDisplayStep(editor: any) {
    displayStep(editor, false);
    lastFileChange = null;
}

async function findUsage() {
    var editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const fileName = editor.document.fileName;
    const lineNumber = editor.selection.start.line;
    var textInLine = editor.document.lineAt(lineNumber).text;

    var [goal, step, prFile] = getStepAndGoal(editor, lineNumber);
    if (step == null && goal == null) return;

    var rootPath = PathHelper.getRootPath(fileName);
    if (step == null) {
        var specificPath = path.join(rootPath, '.build');
        const normalizedPath = specificPath.replace(/\\/g, '/');
        const pattern = `${normalizedPath}/**/*.pr`;
        const files = await findPrFilesAtPath(specificPath);
        for (var i=0;i<files.length;i++) {
            if (files[i].indexOf('00. Goal.pr') == -1) continue;

            const data = await fs.readFileSync(files[i]);
            var prObj = JSON.parse( data.toString());
            for (var b=0;b<prObj.GoalSteps.length;b++) {
                if (prObj.GoalSteps[b].ModuleType == 'PLang.Modules.CallGoalModule') {
                    var modulePath = path.join(rootPath, prObj.GoalSteps[b].RelativePrPath);
                    const modulePrFile = await fs.readFileSync(modulePath);
                    var modulePrObj = JSON.parse( modulePrFile.toString());
                    if (modulePrObj.Action.Parameters && modulePrObj.Action.Parameters[0].Value == goal.GoalName) {
                        console.log('hallo')
                    }
                    var o =0;
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