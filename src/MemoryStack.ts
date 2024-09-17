import * as vscode from 'vscode';
import fetch from 'node-fetch';


export class MemoryStackInfo extends vscode.TreeItem  {
	public children : any[] = [];
	constructor(
		public readonly label: string,
		public readonly description: any,
		public readonly fileToOpen : string
	) {
		const type = typeof description;
		const isNativeType = type == 'string' || type == 'number' || type == 'boolean';

		super(label, isNativeType ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded);
		
		
	

		if (isNativeType) {
			this.description = description;
		} else if (Array.isArray(description)) {
			for (let i=0;i<description.length;i++) {
				this.children.push(new MemoryStackInfo(description[i], '', ''));
			}

		} else if (description != null && description != undefined) {
			var props = Object.getOwnPropertyNames(description);
			for (var i = 0; i < props.length; i++) {
				let action = description[props[i]];
				this.children.push(new MemoryStackInfo(props[i], action, ''));
			}
		}
	}

}

export class MemoryStackProvider implements vscode.TreeDataProvider<MemoryStackInfo> {

	private _onDidChangeTreeData: vscode.EventEmitter<MemoryStackInfo | undefined | null | void> = new vscode.EventEmitter<MemoryStackInfo | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<MemoryStackInfo | undefined | null | void> = this._onDidChangeTreeData.event;
	public treeView?: vscode.TreeView<MemoryStackInfo>;

	data: MemoryStackInfo[];

	constructor() {
		this.data = [];
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: MemoryStackInfo): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return loadMemoryStack().then(function(json) {
			if (json == null) return new vscode.TreeItem('Debugger not available');

			const treeItem = new vscode.TreeItem(element.label);

			if (typeof element.description == 'string') {
				treeItem.description = element.description;
			} else {
                if (!element || !element.description) {
                    return new vscode.TreeItem("");
                }

				var props = Object.getOwnPropertyNames(element.description);
				for (var i = 0; i < props.length; i++) {
					let action = element.description[props[i]];
					if (typeof action == 'string') {
						treeItem.description = element.description;
					} else {
						treeItem.description = JSON.stringify(element.description);
					}
				}
	
			}
		//	treeItem.iconPath = new vscode.ThemeIcon('debug-restart', '#eb4034');
			treeItem.command = element.command;
			treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
			return treeItem;

		})
		
	}

	getChildren(element?: MemoryStackInfo | undefined): vscode.ProviderResult<MemoryStackInfo[]> {
		if (element === undefined) {
			return this.data;
		}
		return element.children;
	}
}
async function loadMemoryStack() {
	var response = await fetch('http://localhost:150000/api/memorystack.goal');
	if (response.ok) {
		var json = await response.json();
		return json;
	}
	return null;
}


