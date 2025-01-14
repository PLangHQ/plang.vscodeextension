import * as vscode from 'vscode';
import * as os from 'os';
import { GoalDebugAdapterDescriptorFactory } from './GoalDebugAdapterDescriptorFactory';
import { PathHelper } from './PathHelper';
import * as path from 'path';
import * as fs from 'fs'
import { Constants } from './Constants';

export class StartDebugger {

    lastRuntimeValue: string | undefined = undefined;
    debugDescriptor: GoalDebugAdapterDescriptorFactory;
    context: vscode.ExtensionContext

    public constructor(context: vscode.ExtensionContext) {
        this.debugDescriptor = new GoalDebugAdapterDescriptorFactory();
        this.context = context;

        
        context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('goal', this.debugDescriptor));
/*
        const stopDebuggerCommand = vscode.commands.registerCommand('extension.stopDebugger', () => {
            vscode.debug.stopDebugging();
            vscode.window.showInformationMessage('Debugger stopped.');
        });*/
    }

    public getDebugDescriptor() {
        return this.debugDescriptor;
    }

    public async start(fileName:string | null) {
        if (vscode.debug.activeDebugSession) {
            // Continue the current debug session
            vscode.commands.executeCommand('workbench.action.debug.continue');
            return;
        }

        if (fileName && fileName != null) {
            this.lastRuntimeValue = fileName;
        }

        if (this.debugDescriptor.debugSession && vscode.debug.activeDebugSession) return;

        let runtimeExecutable = 'plang';
        const platform = os.platform();
        if (platform.indexOf('win') != -1) {
            runtimeExecutable += '.exe';
        }
        let command = await vscode.window.showInputBox({
            prompt: "Please enter a parameter value. By default you don't need a parameter, just press Enter",
            placeHolder: "(Optional) Enter parameter here",
            value: this.lastRuntimeValue
        });
        if (command === undefined) return;

        let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'Plang';
        if (llmService != 'Plang') {
            if (command === undefined) { command = ''; }
            if (command.indexOf('--llmservice') == -1) {
                command += ' --llmservice=' + llmService;
            }
        } else if (command === undefined) {
            return;
        }
        this.lastRuntimeValue = command;
        const regex = /(?<option>--\w+(=\w+)?)|(?<param>\w+=[\p{L}\p{N}:\\_\\.\\-]+)|(?<param2>\w+=["']+[\p{L}\p{N}:\s\\_\\.\\-]+["']+)|(?<file>[\w\/\\\.]+)/gu;

        let match;
        let options = '';
        let parameter = '';
        let startFile = 'Start';

        var args = ['exec'];
/*
        args.push('watch');
        args.push('--project');
        args.push("C:\\Users\\Ingi Gauti\\source\\repos\\plang\\PlangConsole\\PlangConsole.csproj")
        args.push('exec');
        //args.push('plang.exe')
*/

        while ((match = regex.exec(command)) !== null && match.groups) {
            if (match.groups.option) {
                options = match.groups.option;
                args.push(options);
            } else if (match.groups.param) {
                parameter = match.groups.param;
                args.push(parameter);
            } else if (match.groups.param2) {
                parameter = match.groups.param2;
                args.push(parameter);
            } else if (match.groups.file) {
                startFile = match.groups.file;

            }
        }
        args.push(startFile);
        args.push('--detailerror');
        var editor = vscode.window.activeTextEditor;
        var folderPath = PathHelper.getRootPath(editor?.document.fileName);

        var startBuildFile = path.join(folderPath, '.build', startFile, Constants.GoalFileName);
        if (fs.existsSync(startBuildFile)) {
            let content = fs.readFileSync(startBuildFile, 'utf8');
            runtimeExecutable = content.indexOf('"ModuleType": "PLang.Modules.WindowAppModule"') != -1 ? 'plangw' : 'plang';
            const platform = os.platform();
            if (platform.indexOf('win') != -1) {
                runtimeExecutable += '.exe';
            }
        }
        
        args.push('--debug');
        let debugConfiguration: vscode.DebugConfiguration = {
            type: 'goal',
            name: 'PLang Debug',
            request: 'launch',
            program: runtimeExecutable,
            console: "integratedTerminal",
            args: args,
            cwd: folderPath,
            internalConsoleOptions: "openOnSessionStart"
        };

        vscode.debug.onDidStartDebugSession(session => {
            console.log(`Debug session started: ${session.name}`);
        });
    
        vscode.debug.onDidTerminateDebugSession(session => {
            console.log(`Debug session terminated: ${session.name}`);
        });

        const folderUri = vscode.Uri.file(folderPath);
        var workspaceFolder = {
            uri : folderUri
        } as vscode.WorkspaceFolder;

        await vscode.debug.startDebugging(workspaceFolder, debugConfiguration).then(
            (value) => {
                console.log('value:', value)
            }, (reason) => {
                console.log('reason:', reason)
            }
        );
    }
}