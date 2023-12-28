import * as vscode from 'vscode';


export class Info extends vscode.TreeItem  {
	public static RebuildFile = 'Click to build';
	public children : any[] = [];
	constructor(
		public readonly label: string,
		public readonly description: any,
		public readonly fileToOpen : string
	) {
		const type = typeof description;
		const isNativeType = type == 'string' || type == 'number' || type == 'boolean';
		if (isNativeType) {
			label = label.toString().replaceAll('α', '.');
		}
		
		
		super(label, isNativeType ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded);

		
		if (fileToOpen != '') {
			if (description == Info.RebuildFile) {
				this.command = {
					command: 'extension.regenerateStep',
					title: '',
					arguments: [vscode.Uri.file(fileToOpen)]
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
					this.children.push(new Info(description[i].Name, description[i].Value, ''));
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

			var props = Object.getOwnPropertyNames(description);
			for (var i = 0; i < props.length; i++) {
				let action = description[props[i]];
				this.children.push(new Info(props[i], action, ''));
			}
		}
	}

}
