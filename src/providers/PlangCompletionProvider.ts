import * as vscode from 'vscode';
import { GoalDebugSession } from '../debugAdapter';
import { match } from 'assert';

export class PlangCompletionProvider implements vscode.CompletionItemProvider {
    public debugSession?: GoalDebugSession;
    public constructor(debuggerInstance: GoalDebugSession) {
        this.debugSession = debuggerInstance;
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const fileText = document.getText();
        const pattern = /%[^%\n\s]+%/g;
        const matches = fileText.match(pattern) || [];
        const linePrefix = document.lineAt(position).text.substring(0, position.character);
        const currentVariable = linePrefix.substring(linePrefix.lastIndexOf('%'), position.character);
        let completionItems: vscode.CompletionItem[] = [];

        if (context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter && currentVariable.startsWith("%")) {
           
            for (let i = 0; i < matches.length; i++) {
                var item = completionItems.find(p => p.label == matches[i]);
                if (item || matches[i].endsWith('%')) continue;

                item = new vscode.CompletionItem(matches[i], vscode.CompletionItemKind.Text);

                for (let i = 0; this.debugSession && i < this.debugSession?.variables.length; i++) {
                    if (this.debugSession?.variables[i].name == matches[i].replaceAll('%', '')) {
                        item.detail = JSON.stringify(this.debugSession?.variables[i]);
                        i = this.debugSession.variables.length;
                    }
                }
                item.insertText = matches[i].substring(1);
                completionItems.push(item);
            
            }
        } else {
            let word = '';
            const wordAtPosition = document.getWordRangeAtPosition(position);
            if (wordAtPosition) {
                word = document.getText(wordAtPosition);
            }
            if (word == '') return [];

            for (let i = 0; i < matches.length; i++) {
                var item = completionItems.find(p => p.label == matches[i]);
                if (item) continue;

                if (matches[i].indexOf(word) != -1) {
                    item = new vscode.CompletionItem(matches[i], vscode.CompletionItemKind.Text);
                    item.insertText = matches[i].substring(1);
                    completionItems.push(item);
                }
            }
        
        }
        return completionItems;
    }
}
