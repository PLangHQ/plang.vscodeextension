import * as vscode from 'vscode';

export class TextDecoration {

    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;

        this.updateDecorations = this.updateDecorations.bind(this);
    }

    public triggerUpdateDecorations(): void {
        this.updateDecorations();
    }


    public updateDecorations(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        let goal = this.context.globalState.get('goal') as any;
        if (!goal || !goal.GoalSteps) return;

        // Create a map to store decoration options for each module type
        const decorations: { [moduleType: string]: vscode.DecorationOptions[] } = {};
        const aggregatedDecorations: { [decorationType: string]: vscode.DecorationOptions[] } = {};

        for (var i = 0; i < goal.GoalSteps.length; i++) {
            var step = goal.GoalSteps[i];

            const decorationType = this.decorationsMap[step.ModuleType];
            if (!decorationType) continue; // Skip if the module type is not recognized

            // Find the range corresponding to the step
            const range = this.findRangeForStep(editor.document, step);
            if (!range || editor.document.lineCount <= range.end.line) continue; // If no matching range is found, skip

            // Create a decoration for the range
            const decoration = { range };

            const decorationKey = decorationType.key;
            if (!aggregatedDecorations[decorationKey]) {
                aggregatedDecorations[decorationKey] = [];
            }
            aggregatedDecorations[decorationKey].push(decoration);

            // Add the decoration to the appropriate module type array
            if (!decorations[step.ModuleType]) {
                decorations[step.ModuleType] = [];
            }
            decorations[step.ModuleType].push(decoration);
        }

        for (const decorationKey in aggregatedDecorations) {
            const decorationType = this.getDecorationTypeFromKey(decorationKey);
            if (decorationType) {
                editor.setDecorations(decorationType, aggregatedDecorations[decorationKey]);
            }
        }
        /*const decorationTypes : any = {};
        // Apply the decorations for each module type
        for (const moduleType in decorations) {
            const decorationType = this.decorationsMap[moduleType];
            if (decorationType) {
                if (!decorationTypes[decorationType.key]) {
                    decorationTypes[decorationType.key] = [];
                } 
                decorationTypes[decorationType.key].push(decorations[moduleType]);
            }

        }

        for (const key in decorationTypes) {
            const decorations = decorationTypes[key];
            if (decorations) {
                editor.setDecorations(decorationTypes[key], decorations);
            }
        }*/
    }
    private getDecorationTypeFromKey(key: string): vscode.TextEditorDecorationType | undefined {
        for (const moduleType in this.decorationsMap) {
            const decorationType = this.decorationsMap[moduleType];
            if (decorationType.key === key) {
                return decorationType;
            }
        }
        return undefined;
    }
    private findRangeForStep(document: vscode.TextDocument, step: any): vscode.Range | null {

        const text = document.getText();
        const lines = text.split('\n');

        let startLine: number | undefined = step.LineNumber - 1;
        let endLine: number | undefined = startLine;
        try {
            for (let i = startLine + 1; i < lines.length; i++) {
                if (!lines[i].trim().startsWith('-') && lines[i].trim() != '') {
                    endLine++;
                } else {
                    i = lines.length;
                }
            }
        } catch (e) {
            console.log(e);
        }
        try {
            if (startLine !== undefined && endLine !== undefined && endLine >= startLine) {
                const startPos = new vscode.Position(startLine, 0);
                const endPos = new vscode.Position(endLine, lines[endLine].length);
                return new vscode.Range(startPos, endPos);
            }
        } catch (e) {
            console.log(e);
        }
        return null; // If no matching range is found
    }


    // Create the decoration types
    private dataManagementDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#FF6347', // Tomato color for Data Management and Storage
    });

    private fileIoDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#4682B4', // SteelBlue for File and I/O Operations
    });

    private networkWebDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#32CD32', // LimeGreen for Network and Web Operations
    });

    private securityCryptoDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#8A2BE2', // BlueViolet for Security and Cryptography
    });

    private programmingScriptingDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#FFD700', // Gold for Programming and Scripting
    });

    private controlFlowDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#FF4500', // OrangeRed for Control Flow
    });

    private aiMlDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#7B68EE', // MediumSlateBlue for AI/ML
    });

    private uiInteractionDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#00CED1', // DarkTurquoise for UI and Interaction
    });

    private miscellaneousDecorationType = vscode.window.createTextEditorDecorationType({
        color: '#DC143C', // Crimson for Miscellaneous
    });

    // Map each module to its corresponding decoration type
    private decorationsMap: { [moduleType: string]: vscode.TextEditorDecorationType } = {
        // Data Management and Storage
        'PLang.Modules.DbModule': this.dataManagementDecorationType,
        'PLang.Modules.CachingModule': this.dataManagementDecorationType,
        'PLang.Modules.ListDictionaryModule': this.dataManagementDecorationType,
        'PLang.Modules.LocalOrGlobalVariableModule': this.dataManagementDecorationType,

        // File and I/O Operations
        'PLang.Modules.FileModule': this.fileIoDecorationType,
        'PLang.Modules.CompressionModule': this.fileIoDecorationType,
        'PLang.Modules.LoggerModule': this.fileIoDecorationType,
        'PLang.Modules.OutputModule': this.fileIoDecorationType,
        'PLang.Modules.TemplateEngineModule': this.fileIoDecorationType,
        'PLang.Modules.TerminalModule': this.fileIoDecorationType,

        // Network and Web Operations
        'PLang.Modules.HttpModule': this.networkWebDecorationType,
        'PLang.Modules.WebserverModule': this.networkWebDecorationType,
        'PLang.Modules.WebCrawlerModule': this.networkWebDecorationType,
        'PLang.Modules.BlockchainModule': this.networkWebDecorationType,

        // Security and Cryptography
        'PLang.Modules.CryptographicModule': this.securityCryptoDecorationType,
        'PLang.Modules.IdentityModule': this.securityCryptoDecorationType,
        'PLang.Modules.EnvironmentModule': this.securityCryptoDecorationType,

        // Programming and Scripting
        'PLang.Modules.CodeModule': this.programmingScriptingDecorationType,
        'PLang.Modules.PythonModule': this.programmingScriptingDecorationType,
        'PLang.Modules.InjectModule': this.programmingScriptingDecorationType,
        'PLang.Modules.ThrowErrorModule': this.programmingScriptingDecorationType,

        // Control Flow
        'PLang.Modules.ConditionalModule': this.controlFlowDecorationType,
        'PLang.Modules.LoopModule': this.controlFlowDecorationType,
        'PLang.Modules.CallGoalModule': this.controlFlowDecorationType,
        'PLang.Modules.FilterModule': this.controlFlowDecorationType,
        'PLang.Modules.ScheduleModule': this.controlFlowDecorationType,

        // AI/ML
        'PLang.Modules.LlmModule': this.aiMlDecorationType,

        // UI and Interaction
        'PLang.Modules.UiModule': this.uiInteractionDecorationType,
        'PLang.Modules.WindowAppModule': this.uiInteractionDecorationType,
        'PLang.Modules.MessageModule': this.uiInteractionDecorationType,
    };

}