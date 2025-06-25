import * as vscode from 'vscode';
import { Info, IPlangIDETreeItem } from './Info';

export class CodeProvider implements vscode.TreeDataProvider<IPlangIDETreeItem> {

	private _onDidChangeTreeData: vscode.EventEmitter<IPlangIDETreeItem | undefined | null | void> = new vscode.EventEmitter<IPlangIDETreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<IPlangIDETreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
	public treeView?: vscode.TreeView<IPlangIDETreeItem>;

	data: IPlangIDETreeItem[];

	constructor() {
		this.data = [];
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: IPlangIDETreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element as vscode.TreeItem;
	
	}

	getChildren(element?: IPlangIDETreeItem | undefined): vscode.ProviderResult<IPlangIDETreeItem[]> {
		if (element === undefined) {
			return this.data;
		}
		return element.children;
	}
}
