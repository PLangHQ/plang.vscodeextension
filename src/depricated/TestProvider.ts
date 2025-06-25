import * as vscode from 'vscode';




export class TestInfo extends vscode.TreeItem {
	public children: any[] = [];
	constructor(
		public readonly label: string,
		public readonly description?: any,
		public readonly fileToOpen?: string
	) {
		const type = typeof description;
		const isNativeType = type == 'string' || type == 'number' || type == 'boolean';

		super(label, vscode.TreeItemCollapsibleState.Collapsed);


		if (isNativeType) {
			this.description = description.toString();
		} else if (Array.isArray(description)) {
			for (let i = 0; i < description.length; i++) {
				this.children.push(new TestInfo(description[i], '', ''));
			}
		} else if (description == null || description == undefined) {
			this.description = null;
		} else {
			var props = Object.getOwnPropertyNames(description);
			for (var i = 0; i < props.length; i++) {
				if (props[i] == 'description') continue;

				let action = description[props[i]];
				this.children.push(new TestInfo(props[i], action, ''));
			}
		}
	}

}

export class TestProvider implements vscode.TreeDataProvider<TestInfo> {

	private _onDidChangeTreeData: vscode.EventEmitter<TestInfo | undefined | null | void> = new vscode.EventEmitter<TestInfo | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TestInfo | undefined | null | void> = this._onDidChangeTreeData.event;
	public treeView?: vscode.TreeView<TestInfo>;

	data: TestInfo[];

	constructor() {
		this.data = [];
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TestInfo): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	getChildren(element?: TestInfo | undefined): vscode.ProviderResult<TestInfo[]> {
		if (element === undefined) {
			return this.data;
		}
		return element.children;
	}
}
