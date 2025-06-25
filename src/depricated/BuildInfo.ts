import * as vscode from 'vscode';


export class BuildInfo extends vscode.TreeItem  {
	public children : any[] = [];
	constructor(
		public readonly label: string
	) {
        
		
		
        super(label, vscode.TreeItemCollapsibleState.None);
		

    }
}