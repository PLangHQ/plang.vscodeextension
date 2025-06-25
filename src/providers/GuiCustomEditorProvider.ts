import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class GuiCustomEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'goal.guiCustomEditor';
    private _view?: vscode.WebviewPanel;
    private uri? : vscode.Uri;
    constructor(private readonly context: vscode.ExtensionContext) { }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file('C:/Users/Ingi Gauti/source/repos/plang/os/apps/Plang/Gui')
            ]
        };

        webviewPanel.webview.html = ``;

        this._view = webviewPanel;
    }

    public setHtmlContent(html: string, uri : vscode.Uri) {
        if (this._view) {
            html = this.fixHtmlLinks(html, this._view.webview, 'C:/Users/Ingi Gauti/source/repos/plang/os/apps/Plang/Gui');
            this._view.webview.html = html;

            this.uri = uri;
        }
    }

    // Fix local resource URLs for scripts/styles/img in gui.html
    private fixHtmlLinks(html: string, webview: vscode.Webview, htmlPath: string): string {
        // Replace src/href attributes for local files
        return html.replace(
            /(src|href)="([^"]+)"/g,
            (match, p1, p2) => {
                if (p2.startsWith('http') || p2.startsWith('vscode-resource')) return match;
                const absPath = path.join(htmlPath, p2);
                const uri = webview.asWebviewUri(vscode.Uri.file(absPath));
                return `${p1}="${uri}"`;
            }
        );
    }


    async saveCustomDocument(
        document: vscode.CustomDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        // Write the content where you want
        const filePath = this.uri;

        let i = 0;

        // Use fs/promises or vscode API to write file content
        // Optionally perform extra actions (build, process, etc)
    }

    async saveCustomDocumentAs(
        document: vscode.CustomDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        const filePath = this.uri;

        let i = 0;

    }
}
