import * as vscode from 'vscode';
import { StartDebugger } from './StartDebugger';
import fetch from 'node-fetch';


export class Info extends vscode.TreeItem  {
	public static ClickToBuildStr = 'Click to build';
	public static RebuildFile = 'Click to build';
	public children : any[] = [];
	constructor(
		public readonly label: string,
		public readonly description: any,
		public readonly fileToOpen : string,
        runDebugger? : StartDebugger
	) {
		const type = typeof description;
		const isNativeType = type == 'string' || type == 'number' || type == 'boolean';
		if (isNativeType) {
			label = label.toString().replaceAll('α', '.');
		}		
		
		super(label, isNativeType ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded);

		if (fileToOpen != '') {
			if (Info.IsToBuild(description)) {
				let llmService = vscode.workspace.getConfiguration('plang').get<string>('llmservice') ?? 'Plang';

				Info.RebuildFile = Info.ClickToBuildStr + ' (' + llmService + ' LLM service)';
				description = Info.RebuildFile;

				let args = [vscode.Uri.file(fileToOpen)]
				this.command = {
					command: 'extension.regenerateStep',
					title: '',
					arguments: args
				};
            } else if (fileToOpen.indexOf('prompt:') != -1) {
                let fileName = fileToOpen.replace('prompt:', '');
                this.command = {
                    command: 'extension.startPLangDebug', 
                    title: 'Start debugging file',
                    arguments: [fileName]
                };  
            } else if (fileToOpen.indexOf('line:') != -1) {    
                var i = 0;
                let prFileName = fileToOpen.substring(fileToOpen.indexOf(':')+1);
                this.command = {
                    command: 'extension.runFromStep', 
                    title: 'Run step',
                    arguments: [prFileName]
                }; 
                
			} else {
				var arg = (fileToOpen.indexOf('http') != -1) ? vscode.Uri.parse(fileToOpen) : vscode.Uri.file(fileToOpen); 
				this.command = {
					command: 'vscode.open',
					title: '',
					arguments: [arg]
				};
			}
		}
		
		if (isNativeType) {
			description = description.toString().replaceAll('α', '.');
			this.description = description;
		} else if (Array.isArray(description)) {
			for (let i=0;i<description.length;i++) {
				if (description[i].Type) {
					if (description[i].VariableName) {
						this.children.push(new Info(description[i].Type, description[i].VariableName, ''));
					} else {
						this.children.push(new Info(description[i].Name, description[i].Value, ''));
					}
				} else {
					this.children.push(new Info(description[i], description[i], ''));
				}
			}

		} else if (description != null && description != undefined) {
			if (label == "ReturnValue" && description.Type == null) {
				this.children.push(new Info('void', '', ''));
				return;
			};
			if (label == "ReturnValue" && description.Value == '') {
				this.children.push(new Info('Not written to variable', 'Not written to variable', ''));
				return;
			};
            if (!description) {
                return;
            }
			var props = Object.getOwnPropertyNames(description);
			for (var i = 0; i < props.length; i++) {
				let action = description[props[i]];
				this.children.push(new Info(props[i], action, ''));
			}
		}
	}

	public static IsToBuild(str : string) : boolean {
		if (!str || typeof str != 'string') return false;

		return (str.indexOf(this.ClickToBuildStr) != -1);
	}

}
