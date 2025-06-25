import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import fetch from "node-fetch";
import { PathHelper } from "./PathHelper";
import * as vscode from 'vscode';

export class PlangHelper {

    public static async Call(path: string, body: any, method: string = 'POST'): Promise<string> {
        try {
            var response = await fetch('http://localhost:60878/' + path, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            var text = response.text();
            return text;
        } catch (e) {
            console.error('Error in PlangHelper.Call:', e);
            return '';
        }

    }

    static outputChannel: vscode.OutputChannel;
    static plangProcess: ChildProcessWithoutNullStreams;

    public static async spawnPlang(app: string, parameters: any[], projectFolderPath: string): Promise<ChildProcessWithoutNullStreams> {
        var args = [app, 'output=html'];

        for (var i = 0; i < parameters.length; i++) {
            if (typeof (parameters[i]) === 'string') {
                args.push(parameters[i]);
            } else {
                Object.keys(parameters[i]).forEach((key: any) => {
                    let value = parameters[i][key];
                    if (value.indexOf(' ') != -1) {
                        value = '"' + value + '"';
                    }
                    args.push(key + '=' + value);
                });
            }
        }

        return spawn("plang", args, { cwd: projectFolderPath });
    }

    public static async RunApp(app: string, parameters: any[]): Promise<void> {
        if (this.outputChannel == null) {
            this.outputChannel = vscode.window.createOutputChannel("PlangOutput");
            this.outputChannel.show(true);
        }
        var editor = vscode.window.activeTextEditor;
        var projectFolderPath = PathHelper.getRootPath(editor?.document.fileName);

        //parameters.push('--csdebug');
        if (this.plangProcess && !this.plangProcess.killed) {
            (this.plangProcess as ChildProcessWithoutNullStreams).kill();
        }
        this.outputChannel.clear();
        let outputBuffer = '';
        let isWaitingForFullOutput = false;
        let bufferTimeout: NodeJS.Timeout | null = null;
        this.plangProcess = await PlangHelper.spawnPlang(app, parameters, projectFolderPath);
        this.plangProcess.stdout!.on('data', async (data) => {
            let chunk = data.toString();
            outputBuffer += chunk;

            if (bufferTimeout) {
                clearTimeout(bufferTimeout);
            }

            bufferTimeout = setTimeout(() => {
                if (outputBuffer.includes("[Ask]")) {
                    this.showCustomInput(outputBuffer, this.plangProcess, parameters, projectFolderPath);
                } else {
                    this.outputChannel.appendLine(outputBuffer.trim());
                    this.outputChannel.show(true);
                }

                outputBuffer = "";
                bufferTimeout = null;
            }, 300);

        });

        this.plangProcess.stderr!.on('data', (data) => {
            console.error(`stderr: ${data}`);

            this.outputChannel.appendLine(data);
            this.outputChannel.show(true);
            //this.sendEvent(new OutputEvent(data.toString(), 'stdout'));
            if (!this.plangProcess.killed) this.plangProcess.kill();
        });

        this.plangProcess.on('close', (code) => {
            console.error(`terminal close code: ${code}`);
            if (!this.plangProcess.killed) this.plangProcess.kill();
            //this.sendEvent(new OutputEvent(`Exiting with code ${code}`, 'stdout'));
            //this.sendEvent(new TerminatedEvent());
        });

    }

    static panel: vscode.WebviewPanel | undefined;

    // Function to show a custom input Webview
    public static showCustomInput(question: string, plangProcess: ChildProcessWithoutNullStreams, parameters: any[], projectFolderPath: string) {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'customInput',
                'Tests',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
        }
        let processes: ChildProcessWithoutNullStreams[] = [];
        this.panel.webview.html = this.getWebviewContent(question);
        let panel = this.panel;

        // Listen for messages from Webview
        this.panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'submit') {
                plangProcess.stdin.write(message.text + "\n"); // Send input back to the process
                this.panel?.dispose();
            }

            if (message.command === 'runTest') {
                let args2: any[] = [];

                parameters.forEach((item: any) => {
                    let props = Object.getOwnPropertyNames(item);
                    if (props.length == 0 || props[0] == '') return;

                    args2.push(item);
                });

                message.parameters.forEach((item: any) => {
                    let props = Object.getOwnPropertyNames(item);
                    if (props.length == 0 || props[0] == '') return;

                    args2.push(item);
                });
                let process = await PlangHelper.spawnPlang('/apps/Tests/RunTest', args2, projectFolderPath);
                processes.push(process);

                process.stdout!.on('data', async (data) => {
                    let output = data.toString();
                    console.error(`stdout: ${data}`);

                    panel.webview.postMessage({
                        command: 'testResult',
                        result: {
                            output: output,
                            id: message.id.replace('test_', '')
                        }
                    });
                    process.kill();
                });

                process.stderr!.on('data', (data) => {
                    console.error(`stderr: ${data}`);

                    this.outputChannel.appendLine(data);
                    this.outputChannel.show(true);

                    process.kill();
                    //this.sendEvent(new OutputEvent(data.toString(), 'stdout'));
                });


            }
        });

        this.panel.onDidDispose(() => {
            processes.forEach((process) => {
                if (!process.killed) process.kill();
            });
            this.panel = undefined;
        });
    }

    // Function to generate Webview HTML
    public static getWebviewContent(question: string): string {
        return `
    <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Unit Test</title>
    <script type="module" src="https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.20.0/cdn/shoelace.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.20.0/cdn/themes/light.css">
</head>
<body>
        ${question}
</body>
</html>
    `;
    }
}