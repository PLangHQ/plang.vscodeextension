import * as vscode from 'vscode';
import { GoalDebugSession } from '../debugAdapter';

export class PlangCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private readonly session: GoalDebugSession) {}

    provideCompletionItems(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        _tk: vscode.CancellationToken,
        ctx: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const vars = doc.getText().match(/%[^%\s\n]+%/g) ?? [];
        if (!vars.length) return [];

        const varRange = doc.getWordRangeAtPosition(pos, /%[^%\s\n]*%?/);
        if (!varRange) return [];

        const typed = doc.getText(varRange).replace(/%$/, ''); // drop trailing % if present
        const items: vscode.CompletionItem[] = [];

        for (const raw of vars) {
            if (!raw.startsWith(typed) || items.find(i => i.label === raw)) continue;

            const item = new vscode.CompletionItem(raw, vscode.CompletionItemKind.Text);
            item.textEdit = vscode.TextEdit.replace(varRange, raw);

            const name = raw.replace(/%/g, '');
            const v = this.session?.variables.find(x => x.name === name);
            if (v) item.detail = JSON.stringify(v);

            items.push(item);
        }
        return items;
    }
}
