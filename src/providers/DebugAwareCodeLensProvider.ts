import * as vscode from 'vscode';
import { findVariableRanges } from '../extension';
import { ObjectValue } from '../models/Models';

export class DebugAwareCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    private objectValue: ObjectValue | undefined;
    private lenses: Array<vscode.CodeLens>;

    constructor() {
        this.lenses = [];
    }

    setShowLens(objectValue : ObjectValue) {
        this.objectValue = objectValue;
        this._onDidChangeCodeLenses.fire();
    }


    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        if (!this.objectValue) return this.lenses;

        const ranges = await findVariableRanges(this.objectValue.PathAsVariable);
       
        var currentLenses = ranges.map(range =>
            new vscode.CodeLens(range, {
                title: 'Debug LLM Chat',
                command: "loadChat",
                arguments: [this.objectValue],
            })
        );
        this.objectValue = undefined;

        for (let b = 0; b < currentLenses.length; b++) {
             let insert = true;
            for (let i = 0; i < this.lenses.length; i++) {               
                if (this.lenses[i].range == currentLenses[b].range) {
                    insert = false;
                }
                
            }
            if (insert) this.lenses.push(currentLenses[b]);
        }

        return this.lenses;
    }
}