import * as vscode from 'vscode';
import { Info } from './Info';

vscode.commands.registerCommand('myExtension.runMyCommand', () => {
	/**/
});

export class CodeProvider implements vscode.TreeDataProvider<Info> {

	private _onDidChangeTreeData: vscode.EventEmitter<Info | undefined | null | void> = new vscode.EventEmitter<Info | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<Info | undefined | null | void> = this._onDidChangeTreeData.event;
	public treeView?: vscode.TreeView<Info>;

	data: Info[];

	constructor() {
		this.data = [];
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: Info): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	
	}

	getChildren(element?: Info | undefined): vscode.ProviderResult<Info[]> {
		if (element === undefined) {
			return this.data;
		}
		return element.children;
	}
}
