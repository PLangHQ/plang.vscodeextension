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
import * as os from 'os';

let sourceProvider: SourceCodeProvider;
let documentationProvider: DocumentationProvider;
let codeProvider: CodeProvider;
export const GoalFileName = '00. Goal.pr';
let runTerminal: vscode.Terminal;
let buildTerminal: vscode.Terminal;
let server: Server;
let debugDescriptor: GoalDebugAdapterDescriptorFactory;
export let llmService : string;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	

	setupServer()
	debugDescriptor = new GoalDebugAdapterDescriptorFactory();
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider('goal', new PlangCompletionProvider(debugDescriptor.debugSession!), '%'));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('goal', debugDescriptor));
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

	context.subscriptions.push(vscode.commands.registerCommand('extension.goToGoal', (a, b, c, d) => {
		var editor = vscode.window.activeTextEditor;
		var folderPath = getRootPath(editor?.document.fileName);
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
let isBuilding = false;
let lastRuntimeValue : string | undefined = undefined;

function setupDebugger(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((debugSession ) => {
        // Check if the terminated session is the one we're interested in
		var ds = debugDescriptor.debugSession as GoalDebugSession;
        //if (debugSession === ds) {
            // Debug session has ended, reset debugDescriptor.debugSession
			debugDescriptor.debugSession?.clearDecorations();
            debugDescriptor.debugSession = undefined;
			
            console.log('Debug session ended');
        //}
    }));

	let disposable = vscode.commands.registerCommand('extension.startPLangDebug', async () => {
				
		if (vscode.debug.activeDebugSession) {
            // Continue the current debug session
            vscode.commands.executeCommand('workbench.action.debug.continue');
			return;
		}

		if (debugDescriptor.debugSession && vscode.debug.activeDebugSession) return;

		let runtimeExecutable = 'plang';
		const platform = os.platform();
		if (platform.indexOf('win') != -1) {
			runtimeExecutable += '.exe';
		}
		let command = await vscode.window.showInputBox({
            prompt: "Please enter a parameter value. By default you don't need a parameter, just press Enter",
            placeHolder: "(Optional) Enter parameter here", 
			value: lastRuntimeValue
        });
		
		let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'Plang';
		if (llmService != 'Plang') {
			if (command === undefined) { command = ''; }
			command += ' --llmservice=' + llmService;
		} else if (command === undefined) {
            return;
        }
		lastRuntimeValue = command;	
		const regex = /(?<option>--\w+(=\w+)?)|(?<param>\w+=["']?[\w\s:\\_]+["']?)|(?<file>[\w\/\\]+)/g;

		let match;
		let options = '';
		let parameter = '';
		let startFile = 'Start';

		var args = ['exec'];
		while ((match = regex.exec(command)) !== null && match.groups) {
			if (match.groups.option) {
				options = match.groups.option;
				args.push(options);
			} else if (match.groups.param) {
				parameter = match.groups.param;
				args.push(parameter);
			} else if (match.groups.file) {
				startFile = match.groups.file;
				
			}
		}
		args.push(startFile);
		var editor = vscode.window.activeTextEditor;
		var folderPath = getRootPath(editor?.document.fileName);

		var startBuildFile = path.join(folderPath, '.build', startFile, GoalFileName);
		if (fs.existsSync(startBuildFile)) {
			// Read the file and determine the correct executable
			let content = fs.readFileSync(startBuildFile, 'utf8');
			runtimeExecutable = content.indexOf('"ModuleType": "PLang.Modules.WindowAppModule"') != -1 ? 'plangw' : 'plang';
			const platform = os.platform();
			if (platform.indexOf('win') != -1) {
				runtimeExecutable += '.exe';
			}
		}
		
		
		args.push('--debug');
        // Define the debug configuration
        let debugConfiguration : vscode.DebugConfiguration = {
            type: 'goal',
            name: 'PLang Debug',
            request: 'launch',
            program: runtimeExecutable,
			console: "integratedTerminal",
            args: args,
			cwd: folderPath
        };
		
        // Start the debugger with the custom configuration
        await vscode.debug.startDebugging(folderPath, debugConfiguration).then(
			(value) => {
				console.log('value:', value)
			}, (reason) => {
				console.log('reason:', reason)
			}
		);
	});

    context.subscriptions.push(disposable);
}

function goToGoal(a: any) {
	//should navigate to a goal if user is at !CallGoal
}

function Run(onlyFile: boolean) {
	var editor = vscode.window.activeTextEditor;
	var folderPath = getRootPath(editor?.document.fileName);
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
	if (goal == undefined) {

		documentationProvider.data = ['File not build'];
		documentationProvider.refresh();

		codeProvider.data = [new Info('Not built', Info.RebuildFile, editor.document.fileName)];
		codeProvider.data.push(new Info('Win: Ctrl+shift+b', '', ''))
		codeProvider.data.push(new Info('Mac: cmd+k', '', ''))
		codeProvider.data.push(new Info('This may take few mins', '', ''));
		codeProvider.data.push(new Info('=========', '', ''));
		codeProvider.data.push(new Info('Help to build steps', '', 'https://github.com/PLangHQ/plang/tree/main/Documentation/modules#writing-plang-code'));
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

		codeProvider.data = [new Info('Step has changed', Info.RebuildFile, editor.document.fileName)]
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
		codeProvider.data.push(new Info('Documentation', 'Click to open', 'https://github.com/PLangHQ/plang/blob/main/Documentation/modules/' + step.ModuleType + '.md'));
		codeProvider.data.push(new Info('Module', step.ModuleType, ''));
		codeProvider.data.push(new Info('Open pr file', 'Click to open', prFile.path));
		if (prFile.Action) {
			if (prFile.Action.Code) {
				ShowCode(prFile.Action.Code);
			}

			DisplayAction(prFile.Action, prFile.path);

		} else {
			codeProvider.data.push(new Info(prFile.Action, prFile, prFile.path));
		}
		DisplayGoalInfo(codeProvider, goal, step);
		codeProvider.data.push(new Info('====', '======', ''));
		codeProvider.data.push(new Info('Rebuild', Info.RebuildFile, prFile.path));
	} else if (step.Custom && step.Custom.Event) {
		codeProvider.data.push(new Info('Module', step.ModuleType, goal.path));
		codeProvider.data.push(new Info('Open pr file', 'Click to open', goal.path));
		DisplayAction(step.Custom.Event, step.PrFileName);

		codeProvider.data.push(new Info('====', '======', ''));
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
function DisplayGoalInfo(codeProvider : any, goal : any, step : any) {
	var goalStepInfo = null;
	for (var i=0;i<goal.GoalSteps.length;i++) {
		if (goal.GoalSteps[i].Text == step.Text) {
			goalStepInfo = goal.GoalSteps[i];	
		}
	}
	if (goalStepInfo == null) return;

	if (goalStepInfo.CacheHandler != null) {
		var info = new Info('CacheHandler',goalStepInfo.CacheHandler, '');
		codeProvider.data.push(info);
	}
	if (goalStepInfo.ErrorHandler != null) {
		codeProvider.data.push(new Info('ErrorHandler', goalStepInfo.ErrorHandler , ''));
	}
	if (goalStepInfo.RetryHandler != null) {
		codeProvider.data.push(new Info('RetryHandler', goalStepInfo.RetryHandler, ''));
	}
}

function ShowCode(code: string) {

	sourceProvider.treeView!.message = code.replaceAll('α', '.');
	sourceProvider.refresh();
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

let iconPath = vscode.Uri.file('C:\\Users\\ingig\\source\\repos\\PseudoVSCode\\p-language\\media\\icon.svg');

const decorationType = vscode.window.createTextEditorDecorationType({
	gutterIconPath: iconPath,
	gutterIconSize: 'contain', // optional, can be 'auto', 'contain', 'cover', or any CSS size

});

function decorate() {
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
}

function getStepAndGoal(editor: vscode.TextEditor, lineNumber: number): [any, any, any, boolean] {

	let baseAppPath = getRootPath(editor.document.fileName);
	if (baseAppPath == '') baseAppPath = path.dirname(editor.document.fileName);

	let filePath = editor.document.fileName.replace(baseAppPath, '');
	let goalBuildPath = path.join(baseAppPath, '.build', filePath.replace('.goal', ''));

	const [goalText, goalLineNr, isFirstGoal] = getGoal(editor, lineNumber);
	const goalPath = (isFirstGoal) ? goalBuildPath :
		path.join(goalBuildPath, goalText);
	const goalFilePath = path.join(goalPath, GoalFileName);
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
	if (goal == null || goal == '' ) {
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
	if (lineNumber < 0) return ['', 0];

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
export function getRootPath(dir: any, counter : number = 0) {
	var stats = null;
	if (fs.existsSync(dir.toString())) {
		stats = fs.statSync(dir.toString())
	}	
	
	if (stats != null && stats.isFile()) {
		dir = path.dirname(dir)
	}

	var buildDir = path.join(dir, '.build');
	if (fs.existsSync(buildDir)) return path.normalize(dir);

	if (fs.existsSync(path.join(dir, 'Start.goal')) || fs.existsSync(path.join(dir, 'Setup.goal'))) { return dir; }

	let parentDir = path.join(dir, '../');
	if (parentDir == dir) return '';
	if (counter > 50) {
		console.error('To deep call for dir:' + dir + " | parentDir:" + parentDir);
		return '';
	}
	return getRootPath(parentDir, counter++);
}
export function getStartPath(dir: any) {
	var stats = fs.statSync(dir.toString())
	if (stats.isFile()) {
		dir = path.dirname(dir)
	}
	if (fs.existsSync(path.join(dir, 'Start.goal'))) { return dir; }
	dir = path.normalize(dir);

	let parentDir = path.join(dir, '../');
	if (parentDir == dir) return '';

	return getStartPath(parentDir);

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
		console.log('this is server', server);
	}  catch (e) {
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

	var folderPath = getRootPath(fileOrFolderPath);
	if (folderPath == '') {
		console.log('Could not find build folder');
		codeProvider.data.push(new Info('This may take some time', '', ''))
		codeProvider.data.push(new Info('Build info is in Source panel', '', ''))

		codeProvider.data.push(new Info('You can run "plang build" in terminal', '', ''))
		folderPath = path.dirname(fileOrFolderPath);
	}

	var editor = vscode.window.activeTextEditor;
	var folderPath = getRootPath(editor?.document.fileName);
	if (!buildTerminal || buildTerminal.exitStatus) {
		buildTerminal = vscode.window.createTerminal({ name: 'PLang build', cwd: folderPath });
	} else {
		buildTerminal.sendText('cd "' + folderPath + '"');
		buildTerminal.sendText('clear');
	}
	let llmServiceParam= '';
	let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'Plang';
	if (llmService != 'Plang') {
		llmServiceParam = '--llmservice=' + llmService;
	}
	editor?.document.save();
	buildTerminal.show();
	buildTerminal.sendText('plang build ' + llmServiceParam);

	const watcher = chokidar.watch(folderPath, {
		persistent: true, ignoreInitial: true,
	});


	watcher.on('change', (path) => {
		if (path.indexOf('.db') != -1 || path.indexOf('.git') != -1) return;

		if (lastFileChange == null) {
			lastFileChange = new Date().getTime();
			setTimeout(() => {
				var editor = vscode.window.activeTextEditor;
				callDisplayStep(editor);
			}, 1000);
		}


		
	});

	
}
let lastFileChange : number | null = null;
function callDisplayStep(editor : any) {
	displayStep(editor, false);
	lastFileChange = null;
}

