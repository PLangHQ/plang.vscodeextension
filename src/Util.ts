import * as vscode from 'vscode';

export class Util {
    public static getEditor() {
        const editor = vscode.window.visibleTextEditors.find(
            editor => editor.document.uri.scheme === 'file'
        );
    
        return editor;
    }

    public static wrapText(text: string, maxLineLength = 80): string {
        const words = text.split(" ");
        let currentLine = "";
        let result = "";
    
        for (const word of words) {
            if ((currentLine + word).length > maxLineLength) {
                result += currentLine.trim() + "\n";
                currentLine = "";
            }
            currentLine += word + " ";
        }
        return (result + " " + currentLine).trim();
    }
}