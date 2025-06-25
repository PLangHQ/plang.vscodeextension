import * as vscode from 'vscode';

export class DocumentationProvider implements vscode.TreeDataProvider<string> {

	public treeView? : vscode.TreeView<string>;
	private _onDidChangeTreeData: vscode.EventEmitter<string | undefined | null | void> = new vscode.EventEmitter<string | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<string | undefined | null | void> = this._onDidChangeTreeData.event;

	data: string[];

	constructor() {
		this.data = [];
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: string): vscode.TreeItem | Thenable<vscode.TreeItem> {
		const treeItem = new vscode.TreeItem(element);
		return treeItem;
	}

	getChildren(element?: string | undefined): vscode.ProviderResult<string[]> {
		if (element === undefined) {
			return this.data;
		}
		return [];
	}
}
