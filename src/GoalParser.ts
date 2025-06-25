import * as vscode from 'vscode';
import { PathHelper } from './PathHelper';
import * as fs from 'fs';
import * as path from 'path';
import { Constants } from './depricated/Constants';

export class GoalParser {


    public getStepAndGoal(lineNumber : number|undefined = undefined) : [any, any, any, boolean] {
        var editor = vscode.window.activeTextEditor;
        if (!editor) return [null, null, null, false];

        if (!lineNumber) {
            lineNumber = editor.selection.start.line;
        }

        let baseAppPath = PathHelper.getRootPath(editor.document.fileName);
        if (baseAppPath == '') baseAppPath = path.dirname(editor.document.fileName);

        let filePath = editor.document.fileName.replace(baseAppPath, '');
        let goalBuildPath = path.join(baseAppPath, '.build', filePath.replace('.goal', ''));

        const [goalText, goalLineNr, isFirstGoal] = this.getGoal(editor, lineNumber);
        const goalPath = (isFirstGoal) ? goalBuildPath :
            path.join(goalBuildPath, goalText);
        const goalFilePath = path.join(goalPath, Constants.GoalFileName);
        if (!fs.existsSync(goalFilePath)) {
            return [undefined, undefined, undefined, false];
        }
        let goalPrFileContent = '';
        let [stepText, lineNr2] = ['', 0];
        let goal = null;
        try {
            [stepText, lineNr2] = this.getStep(editor, lineNumber, goalLineNr);
            goalPrFileContent = fs.readFileSync(goalFilePath).toString();
            if (goalPrFileContent != '') {
                goal = JSON.parse(goalPrFileContent);
            }
        } catch (e) {
            console.error(e);
            console.info("content:'" + goalPrFileContent + "'");
        }
        if (goal == null || goal == '') {
            return [null, null, undefined, false]
        }
        goal.AbsoluteGoalFolderPath = baseAppPath;
        goal.path = goalFilePath;
        let step;
        let nr;
        let fullMatch = false;
        /*
        for (let i = 0; stepText != '' && i < goal.GoalSteps.length; i++) {
            if (goal.GoalSteps[i].LineNumber <= lineNumber + 1) {
                nr = (i + 1).toString().padStart(2, '0');
                step = goal.GoalSteps[i];
                fullMatch = true;
            } else {
                i =  goal.GoalSteps.length;
            }
        }*/
        for (let i = 0; !step && stepText != '' && i < goal.GoalSteps.length; i++) {
            try {
                
                if (this.matchStep(goal.GoalSteps[i].Text, stepText.trim())) {
                    nr = (i + 1).toString().padStart(2, '0');
                    step = goal.GoalSteps[i];
                    fullMatch = true;
                    i = goal.GoalSteps.length;
                } else if (goal.GoalSteps[i].Text.indexOf(stepText.trim()) != -1) {
                    nr = (i + 1).toString().padStart(2, '0');
                    step = goal.GoalSteps[i];
                    i = goal.GoalSteps.length;
                }
            } catch (e) {
                console.log('jeebbbb')
            }

        }

        
        if (step == undefined) {
            return [goal, null, undefined, false]
        }
        if (step.RelativePrPath == null) {
            return [goal, step, null, fullMatch];
        }
        const prFilePath = path.join(baseAppPath, step.RelativePrPath);
        if (!fs.existsSync(prFilePath)) {
            return [goal, step, null, fullMatch];
        }
    
        const prFileContent = fs.readFileSync(prFilePath);
        const prFile = JSON.parse(prFileContent.toString());
    
        prFile.path = prFilePath;
        return [goal, step, prFile, fullMatch]
    }

    public matchStep(step : string, stepText : string) : boolean {
        let cleanStep = step.replaceAll("\n", "").replaceAll("\r", "").replaceAll("\t", "").replaceAll(' ', '').trim();
        let cleanStepText = stepText.replaceAll("\n", "").replaceAll("\r", "").replaceAll("\t", "").replaceAll(' ', '').trim();
        return cleanStep == cleanStepText;
    }
    
    public getGoal(editor: vscode.TextEditor, lineNumber: number): [string, number, boolean] {
        if (lineNumber < 0) return ['', 0, true];
    
        var line: vscode.TextLine = editor.document.lineAt(lineNumber);
    
        if (line.text != '' && line.text[0] && line.text[0].match(/^[a-zA-Z0-9]+$/)) {
            var firstGoal = this.isFirstGoal(editor, lineNumber);
            return [line.text, lineNumber, firstGoal];
        }
    
        return this.getGoal(editor, lineNumber - 1)
    }
    
    public isFirstGoal(editor: vscode.TextEditor, lineNumber: number) : boolean {
        if (lineNumber == 0) return true;
    
        lineNumber--;
        var line: vscode.TextLine = editor.document.lineAt(lineNumber);
        if (line.text != '' && line.text[0].match(/^[a-zA-Z0-9]+$/)) {
            return false;
        }
        if (lineNumber == 0) return true;
    
        return this.isFirstGoal(editor, lineNumber);
    }
    

    public getStep(editor: vscode.TextEditor, lineNumber: number, goalLineNr: number): [string, number] {
        if (lineNumber < 0 || editor.document.lineCount < lineNumber) return ['', 0];
        try {
            var line: vscode.TextLine = editor.document.lineAt(lineNumber);
            if (line.text.trim().startsWith('-')) {
                let stepText = line.text.trim();
                for (let i = lineNumber+1;i<editor.document.lineCount;i++) {
                    line = editor.document.lineAt(i);
                    if (line.text.trim().startsWith('-')) {
                        i = editor.document.lineCount;
                    } else if (!line.text.match('[^\w]+')) {
                        i = editor.document.lineCount;
                    } else {
                        stepText += '\n' + line.text;
                    }
                }
                return [stepText.replace('-', '').trim(), lineNumber];
            }

            if (line.text.trim().startsWith('/')) {
                return this.getStep(editor, lineNumber + 1, goalLineNr);
            }

            if (line.text.startsWith(' ') || line.text.startsWith('\t')) {
                if (lineNumber - 1 == 0) {
                    return ['', lineNumber];
                }
                return this.getStep(editor, lineNumber - 1, goalLineNr)
            }
            return ['', lineNumber];
        } catch (e) {
            console.error('Illegal value for line: lineNumber is : ' + lineNumber);
            console.error(e);
            return ['', 0];
        }
    }
}