import * as vscode from 'vscode';
import * as os from 'os';
import { GoalDebugAdapterDescriptorFactory } from './GoalDebugAdapterDescriptorFactory';
import { PathHelper } from './PathHelper';
import * as path from 'path';
import * as fs from 'fs'
import { Constants } from './Constants';
import { GoalParser } from './GoalParser';
import { FileSorter } from './FileSorter';

export class DebugVariableHighlighter {
    private goalSteps: Record<string, string[]> = {
        "%name%": ["Step 1: First Name", "Step 2: Last Name", "Step 3: Full Name"],
        "%age%": ["Step 1: Birth Year", "Step 2: Age Calculation", "Step 3: Display Age"],
    };

    constructor() {
        vscode.languages.registerHoverProvider({ scheme: 'file', language: 'goal' }, {
            provideHover: async (document, position) => await this.provideHover(document, position)
        });
        this.goalParser = new GoalParser();
    }

    public dispose() {}
    private goalParser : GoalParser;

    private async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const range = document.getWordRangeAtPosition(position, /%\w+%/);
        if (!range) return;

        var [goal, step] = this.goalParser.getStepAndGoal(position.line);
        if (!step) return;

        const variable = document.getText(range);
        return await this.getHoverContent(variable, goal, step);
    }

    private async getHoverContent(variable: string, goal: any, step : any): Promise<vscode.Hover | undefined> {
        let statePath = path.join(goal.AbsoluteGoalFolderPath, '.debug', 'states', goal.RelativePrFolderPath);
        if (!fs.existsSync(statePath)) {
            return;
        }
        
        const fileSorter = new FileSorter(statePath);
        var stateFiles = await fileSorter.getFilesSortedByModified()
        for (let i =0;i<stateFiles.length;i++) {
            let filePath = path.join(statePath, stateFiles[i]);
            const content = fs.readFileSync(filePath, { encoding: "utf-8" });

            let json = JSON.parse(content);

            var b = 0;
        }
        const steps = this.goalSteps[variable] || ["No info available"];
        const maxStep = steps.length - 1;
        const currentInfo = steps[step];

        const prevStep = step > 0 ? step - 1 : maxStep;
        const nextStep = step < maxStep ? step + 1 : 0;

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        markdown.appendMarkdown(`**${variable}**\n`);
        markdown.appendMarkdown(`> ${currentInfo}\n\n`);

        // Add navigation arrows using VS Code command links
        markdown.appendMarkdown(
            `[⬅️ Previous](command:extension.showInfo?${encodeURIComponent(JSON.stringify([variable, prevStep]))})` +
            ` | ` +
            `[Next ➡️](command:extension.showInfo?${encodeURIComponent(JSON.stringify([variable, nextStep]))})`
        );

        return new vscode.Hover(markdown);
    }
    
  
}