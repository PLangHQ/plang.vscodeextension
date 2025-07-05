import * as fs from 'fs'
import * as path from 'path';
import { exec } from "child_process";
import * as os from "os";
import * as vscode from 'vscode';

export class PathHelper {
    public static PlangFolderPath : string;
    public static PlangExecutable : string;
    public static PlangExecutableArgs : string[];

    public static getRootPath(dir: any, counter: number = 0): string {
        if (!dir) return '';
        
        var stats = null;        
        if (fs.existsSync(dir.toString())) {
            stats = fs.statSync(dir.toString())
        } else {
            return "";
        }

        if (stats != null && stats.isFile()) {
            dir = path.dirname(dir)
        }

        var buildDir = path.join(dir, '.build');
        if (fs.existsSync(buildDir)) return path.normalize(dir);

        if (fs.existsSync(path.join(dir, 'Start.goal'))) { return dir; }
        if (!dir.endsWith('setup') && fs.existsSync(path.join(dir, 'Setup.goal'))) { return dir;}

        let parentDir = path.join(dir, '../');
        if (parentDir == dir) return '';
        if (counter > 50 || parentDir == '..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..\\..') {
            console.error('To deep call for dir:' + dir + " | parentDir:" + parentDir + " | buildDir:" + buildDir);
            return '';
        }
        try {
            return this.getRootPath(parentDir, ++counter);
        } catch (e) {
            console.error("Max call stack, parentDir:" + parentDir + " | counter:" + counter);
            console.error(e);
            return '';
        }
    }

    public static async getPlangPath(args : string[] | undefined = undefined) : Promise<string> {
        return await this.runExec(args).then(pathToExecutable => {
            PathHelper.PlangFolderPath = path.dirname(pathToExecutable);
            PathHelper.PlangExecutable = pathToExecutable;
            PathHelper.PlangExecutableArgs = args ?? [];

            return path.dirname(pathToExecutable);
        }).catch(async error => {
            let text = `You must install plang before you can start using this extension.
            
            Install information at https://github.com/PLangHQ/plang/blob/main/Documentation/Install.md
            `;
            const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
            await vscode.window.showTextDocument(doc);
            throw error;
        });
    }

    public static async runExec(args : string[] | undefined = undefined): Promise<string> {
        return new Promise((resolve, reject) => {
            const plangExec = os.platform() === "win32" ? "plang.exe" : "plang";
            if (args && !args.includes('--csdebug')) {
                if (process.env.PlangCSharpDev) {
                    let pathToExecutable = path.join(process.env.PlangCSharpDev, plangExec);
                    if (pathToExecutable != '') return resolve(pathToExecutable);
                }
            }
            
            const cmd = os.platform() === "win32" ? "where plang.exe" : "which plang";
            exec(cmd, (err, stdout) => {
                if (err || !stdout) {
                    reject("plang.exe not found in PATH");
                } else {
                    resolve(stdout.split(os.EOL)[0].trim());
                }
            });
        });
    }
}